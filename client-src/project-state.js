// Pure project-state helpers (no React): identity, diagnostics classification and unsaved drafts.
// Kept separate so node --test can cover the rules without a browser.
import { requirementOverview, startBlockers, TASK_CONTENT_FIELDS, taskContentBlockers, taskOverview } from '../core/state.js'

export const projectIdOf = w => (String(w?.workspaceId ?? '').startsWith('folder:') ? null : (w?.workspaceId ?? null))

export const reqDraftKey = (projectKey, reqId) => `${projectKey}|req|${reqId}`
export const issueDraftKey = (projectKey, reqId, issueId) => `${projectKey}|issue|${reqId}|${issueId}`

export const reqDraftFrom = req => ({
  title: req.title ?? '', q_who: req.q_who ?? '',
  q_pain: requirementOverview(req), q_success: req.q_success ?? '', q_out: req.q_out ?? '',
  goal: req.goal ?? '', scope: req.scope ?? '', acceptance: req.acceptance ?? '',
})
export const issueDraftFrom = (issue = {}) => ({
  title: issue.title ?? '', problemOverview: taskOverview(issue), acceptance: issue.acceptance ?? '',
  triggerPath: issue.triggerPath ?? '', rootCause: issue.rootCause ?? '',
  description: issue.description?.trim() !== taskOverview(issue) ? issue.description ?? '' : '',
  refs: Array.isArray(issue.refs) ? issue.refs.join('\n') : '',
})

export function taskFormError(draft, { requireAcceptance = false } = {}) {
  const task = { title: draft.title, problemOverview: draft.problemOverview, acceptance: draft.acceptance }
  const missing = requireAcceptance ? startBlockers(task) : taskContentBlockers(task)
  if (missing.length) return { ok: false, code: 'MISSING_TASK_FIELDS', message: `task needs: ${missing.join(', ')}` }
  return null
}

export function taskContentPatch(draft, issue) {
  const saved = issueDraftFrom(issue)
  const patch = {}
  for (const key of TASK_CONTENT_FIELDS) {
    const value = String(draft[key] ?? saved[key]).trim()
    if (value !== saved[key].trim()) patch[key] = key === 'refs' ? value.split(/\r?\n/).map(ref => ref.trim()).filter(Boolean) : value
  }
  // If the original overview was in the old description, keep it when adding a separate note.
  if (Object.hasOwn(patch, 'description') && !issue?.problemOverview?.trim()) {
    patch.problemOverview = String(draft.problemOverview ?? saved.problemOverview).trim()
  }
  return patch
}

export function newTaskInput(draft) {
  const { title, ...fields } = taskContentPatch(draft)
  return { title, fields }
}
export const sameDraft = (a, b) => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => (a[k] ?? '') === (b[k] ?? ''))
}
export const draftOf = (drafts, key, fallback) => ({ ...fallback, ...(drafts[key]?.fields ?? {}) })

// A failed read must surface as failure, never as "not enabled yet"; a healthy project keeps its diagnostics as a banner.
export function classifyProject(data) {
  const diags = data?.diagnostics ?? []
  const broken = diags.some(d => ['WORKSPACE_MISSING', 'READ_FAILED', 'MISSING_FRONTMATTER'].includes(d.code))
  const notInitialized = !!data && !data.project && diags.some(d => d.code === 'NOT_INITIALIZED') && !broken
  return { diags, notInitialized, readFailed: !!data && !data.project && !notInitialized }
}

// A response may paint only when it still belongs to the current project and is the newest request.
export const freshRead = (currentRoot, requestedRoot, currentSeq, seq) =>
  currentRoot === requestedRoot && currentSeq === seq

// A new edit is a new draft even when its text happens to match the submitted one.
export const clearSubmitted = (current, currentRevision, submittedRevision) =>
  currentRevision === submittedRevision ? '' : current

// Same shape as store.deliveryFingerprint: sha256(JSON([req.hash, sorted task
// [id,hash]])) truncated to 20 hex chars. Key manual submissions (delivery
// summary, acceptance confirm) to the exact requirement AND task content the
// user reviewed; the host re-checks inside its lock and rejects drift.
export async function deliveryFingerprint(req) {
  const tasks = (req.issues ?? []).map(i => [i.id, i.hash]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([req.hash, tasks])))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 20)
}

// Session-keyed async action runner shared by task views.
// A late response from a previous session must apply NOTHING to the current
// session — including success callbacks such as clearing the note input.
export function createCardActions({ getKey, rpc, setBusy, setMsg, reload, failText, formatError = res => `${failText}: ${res.message}` }) {
  let busyKey = null
  return async function act(method, input, onOk) {
    const requested = getKey()
    if (busyKey === requested) return undefined // same-session double click
    busyKey = requested
    setBusy(true); setMsg('')
    const res = await rpc(method, input)
    if (getKey() !== requested) { // switched away mid-action: drop everything
      if (busyKey === requested) busyKey = null
      return res
    }
    busyKey = null
    setMsg(res.ok ? '' : formatError(res))
    setBusy(false)
    if (res.ok) onOk?.()
    reload()
    return res
  }
}
