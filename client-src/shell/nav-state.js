// Pure main-workbench navigation and list derivation (no React), so node --test
// can cover the rules: per-project view state, detail history, page lists and reorder.
import { TERMINAL_ISSUE } from '../../core/state.js'
import { reviewRecords } from '../workbench-content.js'

export const PAGES = ['home', 'board', 'pool', 'review', 'ready', 'dev', 'blocked', 'pending', 'records', 'wiki', 'arch', 'prds', 'sync']
// PRD §7.1 internal menu. 'sync' (进展建议) stays an auxiliary top-bar entry, not a menu page.
export const MENU = [
  { page: 'home', label: 'navHome' },
  { page: 'board', label: 'navBoard' },
  { group: 'navRequirements', items: [{ page: 'pool', label: 'navPool' }, { page: 'review', label: 'navReview' }, { page: 'ready', label: 'navReady' }] },
  { group: 'navDevelopment', items: [{ page: 'dev', label: 'navDev' }, { page: 'blocked', label: 'navBlocked' }] },
  { group: 'navAcceptance', items: [{ page: 'pending', label: 'navPending' }, { page: 'records', label: 'navRecords' }] },
  { group: 'navResources', items: [{ page: 'wiki', label: 'navWiki' }, { page: 'arch', label: 'navArch' }, { page: 'prds', label: 'navPrds' }] },
]
export const statusPage = status => ({ backlog: 'pool', reviewing: 'review', ready: 'ready', in_progress: 'dev', pending: 'pending', completed: 'board' }[status] ?? 'board')

export const COLS = ['backlog', 'reviewing', 'ready', 'in_progress', 'pending', 'completed']
// Manually selectable transitions; the host guards every move (PRD §10.3).
export const MOVES = {
  backlog: { reviewing: 'move' },
  reviewing: { ready: 'move', backlog: 'reason' },
  ready: { in_progress: 'move' },
  in_progress: { pending: 'submitDelivery' },
  pending: { completed: 'confirmComplete', in_progress: 'reopenRequirement' },
  completed: { in_progress: 'reopenRequirement' },
}
export const ISSUE_MOVES = {
  todo: { blocked: 'block', cancelled: 'cancelTask' },
  doing: { blocked: 'block', todo: 'returnTodo', cancelled: 'cancelTask' },
  blocked: { todo: 'returnTodo', cancelled: 'cancelTask' },
  in_review: { done: 'demoConfirm', todo: 'returnTodo', cancelled: 'cancelTask' },
  done: { todo: 'reopen' },
  cancelled: { todo: 'restoreTask' },
}

export const defaultViewState = () => ({ page: 'home', params: null, filters: {}, history: [] })
export function normalizeViewState(raw) {
  if (!raw || typeof raw !== 'object') return defaultViewState()
  return {
    page: PAGES.includes(raw.page) ? raw.page : 'home',
    params: raw.params && typeof raw.params === 'object' ? raw.params : null,
    filters: raw.filters && typeof raw.filters === 'object' ? raw.filters : {},
    history: Array.isArray(raw.history) ? raw.history : [],
  }
}
export const filterOf = (view, page) => view.filters[page] ?? {}
export const withFilter = (view, page, patch) => ({ ...view, filters: { ...view.filters, [page]: { ...filterOf(view, page), ...patch } } })

// Details open over the origin page; back restores it. A jump from one detail to
// another pushes the previous position so back returns there first (PRD §7.1).
// A cross-page open (e.g. a home reminder landing on the task's requirement
// page) also remembers its origin page, so "返回" goes back to where the user
// clicked, keeping that page's filters.
export function openDetail(view, params, page = view.page) {
  const history = view.params
    ? [...view.history, { page: view.page, params: view.params }]
    : (page !== view.page ? [...view.history, { page: view.page, params: null }] : view.history)
  return { ...view, page, params, history }
}
export function backOf(view) {
  if (view.history.length) {
    const prev = view.history[view.history.length - 1]
    return { ...view, page: prev.page, params: prev.params, history: view.history.slice(0, -1) }
  }
  return { ...view, params: null }
}

const orderOf = item => (typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : Number.MAX_SAFE_INTEGER)
const byOrder = (a, b) => orderOf(a) - orderOf(b) || String(a.created ?? '').localeCompare(String(b.created ?? '')) || String(a.id).localeCompare(String(b.id))
// 任务栏与排序写入共用同一显示口径（order → created → id），与派生计算一致；
// 只按文件名显示会让写入的 order 不生效。
export const sortedTasks = issues => [...(issues ?? [])].sort(byOrder)
// A skipped or unreadable object makes project totals and empty reminders
// incomplete; a data-problem banner alone must not present them as zero.
export const homeSummaryIncomplete = (home, error = null) => !!error || (home?.diagnostics ?? []).some(d =>
  ['READ_FAILED', 'MISSING_FRONTMATTER', 'INVALID_STATUS', 'SCHEMA_TOO_NEW', 'MISSING_FIELD', 'DUPLICATE_ID'].includes(d.code))

// One reminder per task, pointing to an actual session awaiting interaction.
export function awaitingAuthSessions(facts, sessionStatus) {
  const waiting = new Map()
  for (const fact of facts ?? []) {
    if (!fact.issueId || waiting.has(fact.issueId)) continue
    const linked = Array.isArray(fact.sessionIds) ? fact.sessionIds : [fact.sessionId].filter(Boolean)
    // Prefer the active run's session when it is one of the associations.
    const candidates = fact.sessionId && linked.includes(fact.sessionId)
      ? [fact.sessionId, ...linked.filter(id => id !== fact.sessionId)] : linked
    const sessionId = candidates.find(id => sessionStatus?.get(id)?.pendingInteraction?.kind === 'approval')
    if (sessionId) waiting.set(fact.issueId, sessionId)
  }
  return waiting
}

// Snapshot primitive identity fields before an asynchronous Host read.
export function snapshotAuthStatus(sessionStatus) {
  const result = new Map()
  for (const [id, status] of sessionStatus ?? []) {
    const p = status?.pendingInteraction
    if (p?.kind === 'approval') result.set(id, { pendingInteraction: {
      kind: p.kind, sessionId: p.sessionId, key: p.key, callId: p.callId, toolName: p.toolName,
    } })
  }
  return result
}

export function homeDuringAuthRefresh(home, stale) {
  return !home || !stale ? home : { ...home, authRefreshing: true,
    reminders: (home.reminders ?? []).filter(item => item.kind !== 'awaitingAuth' && !item.kinds?.includes('awaitingAuth')) }
}

// A Host audit request is not itself a user-visible pending interaction. Only
// a unique match to each currently published approval can supply a start time.
export function awaitingAuthDetails(facts, sessionStatus) {
  const selected = awaitingAuthSessions(facts, sessionStatus)
  const details = new Map()
  for (const fact of facts ?? []) {
    if (!selected.has(fact.issueId) || details.has(fact.issueId)) continue
    const ids = [...new Set(Array.isArray(fact.sessionIds) ? fact.sessionIds : [fact.sessionId].filter(Boolean))]
    const pending = ids.map(id => [id, sessionStatus?.get(id)?.pendingInteraction])
      .filter(([, item]) => item?.kind === 'approval')
    const matched = pending.map(([sessionId, item]) => {
      if (item.sessionId !== sessionId || typeof item.key !== 'string' || !item.key ||
          typeof item.callId !== 'string' || !item.callId || typeof item.toolName !== 'string' || !item.toolName) return null
      const candidates = (fact.approvalRequests ?? []).filter(a => a.sessionId === sessionId && a.callId === item.callId &&
        a.toolName === item.toolName && typeof a.approvalId === 'string' && a.approvalId &&
        Number.isFinite(a.askedAt) && a.askedAt > 0 && a.askedAt <= Date.now())
      return candidates.length === 1 ? candidates[0] : null
    })
    const known = pending.length > 0 && matched.every(Boolean)
    const askedAt = known ? Math.min(...matched.map(a => a.askedAt)) : null
    details.set(fact.issueId, {
      sessionId: known ? pending[matched.findIndex(a => a.askedAt === askedAt)][0] : selected.get(fact.issueId),
      askedAt,
      identity: JSON.stringify(pending.map(([id, item], index) => [id, item?.key ?? null, item?.callId ?? null,
        item?.toolName ?? null, matched[index]?.approvalId ?? null, matched[index]?.askedAt ?? null])),
    })
  }
  return details
}
const byUpdatedDesc = (a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? ''))
export const titleMatch = (item, query) => !String(query ?? '').trim() || String(item.title ?? '').toLowerCase().includes(String(query).trim().toLowerCase())
const inStatus = (requirements, status, query) => requirements.filter(r => r.status === status && titleMatch(r, query))

export const poolItems = (requirements, query) => inStatus(requirements, 'backlog', query).slice().sort(byUpdatedDesc)
export const reviewItems = (requirements, query) => inStatus(requirements, 'reviewing', query).slice()
  .sort((a, b) => String(a.submittedAt ?? '').localeCompare(String(b.submittedAt ?? '')))
export const readyItems = (requirements, query) => inStatus(requirements, 'ready', query).slice().sort(byOrder)
export const devItems = (requirements, query) => inStatus(requirements, 'in_progress', query).slice().sort(byOrder)
export const pendingItems = (requirements, query) => inStatus(requirements, 'pending', query).slice().sort(byUpdatedDesc)
export const boardItems = (requirements, query, status) => inStatus(requirements, status, query).slice().sort(byOrder)

// One row per acceptance decision (PRD §7.6); reviewRecords already dedupes by marker.
export function recordItems(requirements, { query = '', decision = '' } = {}) {
  const needle = String(query ?? '').trim().toLowerCase()
  const out = []
  for (const req of requirements) {
    for (const record of reviewRecords(req.reviews)) {
      if (record.kind !== 'acceptance') continue
      if (decision && record.decision !== decision) continue
      if (needle && ![req.title, record.opinion, record.summary].some(v => String(v ?? '').toLowerCase().includes(needle))) continue
      out.push({ reqId: req.id, reqTitle: req.title, reqStatus: req.status, ...record })
    }
  }
  return out.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
}

export function blockedItems(requirements, { query = '', reqId = '' } = {}) {
  const out = []
  for (const req of requirements) {
    if (reqId && req.id !== reqId) continue
    for (const issue of req.issues ?? []) {
      if (issue.status !== 'blocked' || !titleMatch(issue, query)) continue
      out.push({ reqId: req.id, issueId: issue.id, title: issue.title, reqTitle: req.title, reason: issue.blocked_reason ?? '', at: Number(issue.blockedAt) || Date.parse(issue.updated) || 0 })
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

// Execution failures with evidence: failed verification checks recorded for the
// task's current delivery round. No separate risk entity is created.
export function failureItems(requirements) {
  const out = []
  for (const req of requirements) {
    for (const issue of req.issues ?? []) {
      if (TERMINAL_ISSUE.has(issue.status) || !(issue.verification?.failed > 0)) continue
      out.push({ reqId: req.id, issueId: issue.id, title: issue.title, reqTitle: req.title, failed: issue.verification.failed, at: Number(issue.objectiveAt) || Date.parse(issue.updated) || 0 })
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

// AI-recorded risks are pending proposals WITH evidence; content drafts stay in
// the detail pages, state suggestions only locate (PRD §7.8).
export const DRAFT_KINDS = ['req_draft', 'new_task', 'field_draft']
export const riskItems = proposals => (proposals ?? []).filter(p => p.status === 'pending' && !DRAFT_KINDS.includes(p.kind))

// Reorder via the existing order field. Distinct numeric orders swap in two
// writes; otherwise positions are normalized with the swap applied (items are
// created with order 0, so the first reorder establishes the sequence).
export function reorderPlan(list, id, direction) {
  const index = list.findIndex(item => item.id === id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= list.length) return []
  const orders = list.map(item => (typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : null))
  if (orders.every(o => o !== null) && new Set(orders).size === orders.length) {
    return [{ id: list[index].id, order: orders[target] }, { id: list[target].id, order: orders[index] }]
  }
  const positions = list.map((_, i) => i)
  ;[positions[index], positions[target]] = [positions[target], positions[index]]
  return list.map((item, i) => ({ id: item.id, order: positions[i] })).filter((patch, i) => patch.order !== orders[i])
}

// Keep the original plan after a partial write. A retry first checks the
// remaining objects against the versions the user saw, and recognises an
// already-written step if the response was lost. Never overwrite newer data.
export async function continueReorder(operation, { read, write, progress = () => {} }) {
  let current
  if (operation.error) {
    const result = await read()
    if (!result.ok) { operation.error = result; return operation }
    current = new Map(result.items.map(item => [item.id, item]))
    if (operation.kind === 'issue' && operation.before && current.size !== operation.before.length) {
      operation.error = { code: 'CONFLICT' }
      return operation
    }
    const completed = new Map(operation.steps.slice(0, operation.next).map(step => [step.id, step.order]))
    const remaining = new Set(operation.steps.slice(operation.next).map(step => step.id))
    for (const original of operation.before ?? []) {
      const item = current.get(original.id)
      if (!item || (completed.has(original.id) && item.order !== completed.get(original.id)) ||
          (!completed.has(original.id) && !remaining.has(original.id) && item.order !== original.order)) {
        operation.error = { code: 'CONFLICT' }
        return operation
      }
    }
    for (const step of operation.steps.slice(operation.next)) {
      const item = current.get(step.id)
      if (!item || (item.order !== step.order && item.hash !== step.hash)) {
        operation.error = { code: 'CONFLICT' }
        return operation
      }
    }
  }
  operation.error = null
  while (operation.next < operation.steps.length) {
    const step = operation.steps[operation.next]
    if (current?.get(step.id)?.order !== step.order) {
      const result = await write(step)
      if (!result.ok) { operation.error = result; return operation }
    }
    operation.next++
    progress(operation)
  }
  // A different writer may have changed an untouched item while the updates
  // were in flight. Do not report a complete sort until its final order is
  // checked against the intended list.
  if (operation.before) {
    const result = await read()
    if (!result.ok) { operation.error = result; return operation }
    const items = new Map(result.items.map(item => [item.id, item]))
    const targets = new Map(operation.steps.map(step => [step.id, step.order]))
    if ((operation.kind === 'issue' && items.size !== operation.before.length) ||
        operation.before.some(original => !items.has(original.id) ||
          items.get(original.id).order !== (targets.has(original.id) ? targets.get(original.id) : original.order))) {
      operation.error = { code: 'CONFLICT' }
    }
  }
  return operation
}

// Waiting time for home reminders: longest wait first within a priority kind.
export function waitParts(sinceMs, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Number(sinceMs || now)) / 60000))
  if (minutes < 1) return { key: 'waitNow', n: 0 }
  if (minutes < 60) return { key: 'waitMinute', n: minutes }
  if (minutes < 1440) return { key: 'waitHour', n: Math.floor(minutes / 60) }
  return { key: 'waitDay', n: Math.floor(minutes / 1440) }
}

// Latest readable progress line of a requirement (its own activity, else its tasks').
export function latestProgress(req) {
  const lines = [...(req.activity ?? [])]
  for (const issue of req.issues ?? []) lines.push(...(issue.activity ?? []))
  let best = null
  for (const line of lines) {
    const at = Date.parse(String(line).match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\S*/)?.[0] ?? '')
    if (Number.isFinite(at) && (!best || at > best.at)) best = { at, line }
  }
  return best
}
