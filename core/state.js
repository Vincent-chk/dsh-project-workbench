// Pure state-machine guards (PRD §10.3). Every rejection carries a
// human-readable reason; no I/O here. Actors: 'human' | 'ai' | 'system'.
// The tables bind buttons, drag, RPC and AI tools alike; unlisted moves fail.

export const REQUIREMENT_STATES = ['backlog', 'reviewing', 'ready', 'in_progress', 'pending', 'completed']
export const ISSUE_STATES = ['todo', 'doing', 'blocked', 'in_review', 'done', 'cancelled']
export const TERMINAL_ISSUE = new Set(['done', 'cancelled'])
export const REVIEW_TASK_PURPOSE = 'requirement_review'
export const PREPARATION_TASKS = Object.freeze({
  discovery: '需求深挖',
  prd: 'PRD 撰写',
  prototype: '流程图与原型',
})

export function aiReviewReports(reviews = []) {
  return reviews.filter(record => record.kind === 'ai_review' && record.by === 'ai' && record.decision === 'reported' &&
    typeof record.marker === 'string' && !!record.marker.trim() &&
    typeof record.opinion === 'string' && !!record.opinion.trim())
}


const REQUIREMENT_EDGES = new Set([
  'backlog>reviewing',
  'reviewing>ready',
  'reviewing>backlog',
  'ready>in_progress',
  'ready>backlog',
  'in_progress>backlog',
  'in_progress>pending',
  'pending>completed',
  'pending>in_progress',
  'completed>in_progress',
])

const ISSUE_EDGES = new Set([
  'todo>doing',
  'todo>blocked',
  'doing>blocked',
  'blocked>doing',
  'doing>in_review',
  'todo>in_review', 'blocked>in_review',
  'in_review>doing',
  'todo>done', 'doing>done', 'blocked>done', 'in_review>done',
  'todo>cancelled', 'doing>cancelled', 'blocked>cancelled', 'in_review>cancelled',
  'done>todo',
  'cancelled>todo',
  'doing>todo', 'blocked>todo', 'in_review>todo',
])

// Requirement moves are human decisions; only acceptance submission may be
// automatic (PRD §11.3). Issue completion/cancellation/reopen are human-only.
const AUTO_REQUIREMENT_EDGES = new Set(['in_progress>pending'])
const HUMAN_ONLY_ISSUE_EDGES = new Set([
  'todo>in_review', 'blocked>in_review',
  'in_review>doing',
  'todo>done', 'doing>done', 'blocked>done', 'in_review>done',
  'todo>cancelled', 'doing>cancelled', 'blocked>cancelled', 'in_review>cancelled',
  'done>todo', 'cancelled>todo', 'doing>todo', 'blocked>todo', 'in_review>todo',
])

const reject = (code, reason) => ({ ok: false, code, reason })
const ok = () => ({ ok: true })
const blank = v => typeof v !== 'string' || !v.trim()

// Earlier records used the goal alone to describe the work.
export function requirementOverview({ q_pain, goal }) {
  return String(q_pain ?? '').trim() || String(goal ?? '').trim()
}

export const TASK_CONTENT_FIELDS = ['title', 'problemOverview', 'acceptance', 'triggerPath', 'rootCause', 'description', 'refs']

export function taskOverview({ problemOverview, description }) {
  return (typeof problemOverview === 'string' && problemOverview.trim()) ||
    (typeof description === 'string' && description.trim()) || ''
}

export function taskContentBlockers(issue) {
  const missing = []
  if (typeof issue.title !== 'string' || blank(issue.title)) missing.push('title')
  if (!taskOverview(issue)) missing.push('problemOverview')
  return missing
}

export function changesReviewedRequirement(current, patch) {
  return requirementOverview(current) !== requirementOverview({ ...current, ...patch }) ||
    ['goal', 'scope', 'q_out', 'acceptance', 'q_success'].some(key =>
      Object.hasOwn(patch, key) && String(patch[key] ?? '') !== String(current[key] ?? ''))
}

// A delivery is fresh only if BOTH a result and verification evidence were
// produced at/after `since`. Confirmed objective records count as evidence;
// an unverified ("待核实") list does not. Updating only one of result /
// evidence leaves the other stale. `since === 0` means legacy (no delivery start).
export function freshDelivery(issue, since) {
  if (!since) return true
  const objectiveAt = issue.hasObjective ? Number(issue.objectiveAt) || 0 : 0
  const resultAt = Number(issue.resultAt) || 0
  const evidenceAt = Math.max(blank(issue.evidence) ? 0 : Number(issue.evidenceAt) || 0, objectiveAt)
  // Evidence produced after the summary can contradict it (e.g. a retry that
  // succeeds after an earlier failure). Require a fresh summary for those facts.
  return resultAt >= since && evidenceAt >= since && resultAt >= evidenceAt
}
// Effective verification evidence: explicit evidence or CONFIRMED objective records.
export const effectiveEvidence = issue => !blank(issue.evidence) ? issue.evidence : issue.hasObjective ? '客观记录' : ''

function taskDeliveryBlockers(issue) {
  const delivery = { ...issue, objectiveAt: issue.acceptedObjectiveAt ?? issue.objectiveAt }
  const missing = []
  if (blank(issue.acceptance)) missing.push('acceptance')
  if (blank(issue.resultSummary ?? issue.result)) missing.push('resultSummary')
  if (blank(effectiveEvidence(delivery))) missing.push('evidence')
  const since = Math.max(Number(issue.deliveryStartedAt) || 0, Number(issue.resultScopeAt) || 0)
  if (!missing.length && !freshDelivery(delivery, since)) missing.push('currentResult')
  return missing
}

export function canDeliverTasks(issues, since = 0) {
  if (!issues.length) return reject('NO_ISSUES', 'no tasks; nothing to accept')
  if (issues.some(issue => issue.status !== 'done')) {
    return reject('TASKS_NOT_ACCEPTED', 'every task must pass acceptance before the requirement can be accepted')
  }
  const incomplete = issues.map(issue => ({ title: issue.title || issue.id, fields: taskDeliveryBlockers(issue) }))
    .filter(issue => issue.fields.length)
  if (incomplete.length) return reject('TASK_DELIVERY_INCOMPLETE', JSON.stringify(incomplete))
  // Previously accepted tasks retain their own result. At least one task must
  // also deliver a new result and evidence after a requirement is reopened.
  if (!issues.some(issue => !blank(effectiveEvidence(issue)) && freshDelivery(issue, since))) {
    return reject('RESULT_EVIDENCE_REQUIRED', 'at least one done task needs a fresh result and verification evidence for this delivery')
  }
  return ok()
}

export function canMoveRequirement({
  from, to, title, issues = [], reason, actor = 'human',
  q_pain, goal, hasAIReview = false, confirmReviewInvalid = false, running = [],
  summary, pendingReopen = null, reqDeliveryStartedAt = 0, summaryAt = 0,
}) {
  if (!REQUIREMENT_STATES.includes(from) || !REQUIREMENT_STATES.includes(to)) {
    return reject('ILLEGAL_TRANSITION', `unknown state: ${from} -> ${to}`)
  }
  if (from === to) return reject('ILLEGAL_TRANSITION', 'already in that state')
  const edge = `${from}>${to}`
  if (!REQUIREMENT_EDGES.has(edge)) {
    return reject('ILLEGAL_TRANSITION', `move ${from} -> ${to} is not allowed`)
  }
  if (actor !== 'human' && !AUTO_REQUIREMENT_EDGES.has(edge)) {
    return reject('HUMAN_ONLY', 'only a person can make this requirement decision')
  }
  if (edge === 'backlog>reviewing') {
    if (blank(title)) return reject('TITLE_REQUIRED', 'a title is required before review')
    if (!requirementOverview({ q_pain, goal })) return reject('REVIEW_INFO_REQUIRED', 'review needs: overview')
  }
  if (edge === 'reviewing>ready' && !hasAIReview) {
    return reject('REVIEW_REPORT_REQUIRED', 'complete an AI review before approving this requirement')
  }
  if (edge === 'ready>in_progress') {
    return canDevelopTasks(issues.filter(issue => !TERMINAL_ISSUE.has(issue.status)))
  }
  if (edge === 'reviewing>backlog' && blank(reason)) {
    return reject('REASON_REQUIRED', 'a return reason is required')
  }
  if (edge === 'ready>backlog' || edge === 'in_progress>backlog') {
    if (!confirmReviewInvalid) return reject('REVIEW_INVALIDATION_REQUIRED', 'substantive change: confirm the original review is invalidated')
    if (blank(reason)) return reject('REASON_REQUIRED', 'describe the substantive change')
    if (from === 'in_progress' && running.length) {
      return reject('RUNNING_ISSUES', `${running.length} task(s) still running; stop them first`)
    }
  }
  if (to === 'pending' || to === 'completed') {
    if (pendingReopen) return reject('REOPEN_PENDING', 'a reopen is still in progress; finish it before submitting')
    const delivery = canDeliverTasks(issues, reqDeliveryStartedAt)
    if (!delivery.ok) return delivery
    if (blank(summary)) return reject('SUMMARY_REQUIRED', 'a delivery summary is required')
    const latestResult = issues.reduce((latest, issue) => Math.max(latest, Number(issue.resultAt) || 0), reqDeliveryStartedAt)
    if (summaryAt < latestResult) {
      return reject('SUMMARY_STALE', 'the delivery summary predates this round or a task result; write a summary of the current delivery')
    }
  }
  if (edge === 'pending>in_progress' || edge === 'completed>in_progress') {
    if (blank(reason)) return reject('REASON_REQUIRED', 'a reason / modification requirement is required')
    if (!issues.length) return reject('REOPEN_SELECTION_REQUIRED', 'select tasks to reopen or add new tasks')
    return canDevelopTasks(issues)
  }
  return ok()
}

export function canMoveIssue({
  from, to, requirementStatus, reason, blockedReason, actor = 'human',
  linked = false, running = false, result, evidence, acceptance, resultFresh = true, resultInvalidated = false,
}) {
  if (!ISSUE_STATES.includes(from) || !ISSUE_STATES.includes(to)) {
    return reject('ILLEGAL_TRANSITION', `unknown state: ${from} -> ${to}`)
  }
  if (from === to) return reject('ILLEGAL_TRANSITION', 'already in that state')
  if (requirementStatus !== 'in_progress') {
    return reject('REQ_NOT_ACTIVE', 'tasks can only change while the requirement is in development')
  }
  const edge = `${from}>${to}`
  if (!ISSUE_EDGES.has(edge)) {
    return reject('ILLEGAL_TRANSITION', `move ${from} -> ${to} is not allowed`)
  }
  if (actor !== 'human' && HUMAN_ONLY_ISSUE_EDGES.has(edge)) {
    return reject('HUMAN_ONLY', 'only a person can confirm, cancel or reopen a task')
  }
  if (edge === 'in_review>doing' && !resultInvalidated && blank(reason)) {
    return reject('REASON_REQUIRED', 'provide the modification request before continuing')
  }
  if (to === 'blocked' && blank(blockedReason)) {
    return reject('BLOCKED_REASON_REQUIRED', 'a specific blocked reason is required')
  }
  if (to === 'cancelled') {
    if (blank(reason)) return reject('REASON_REQUIRED', 'a reason is required to cancel')
    if (running) return reject('RUNNING', 'stop the running task before cancelling')
  }
  if (to === 'in_review') {
    if (actor === 'human' && running) return reject('RUNNING', 'stop the running task before submitting it for acceptance')
    if (blank(acceptance)) return reject('ACCEPTANCE_REQUIRED', 'completion criteria are required before submitting for confirmation')
    if (blank(result) || blank(evidence)) {
      return reject('RESULT_EVIDENCE_REQUIRED', 'submitting for confirmation needs a result and verification evidence')
    }
    if (!resultFresh) return reject('RESULT_STALE', 'the result predates this delivery; produce a new result and evidence')
  }
  if (to === 'done') {
    if (running) return reject('RUNNING', 'stop the running task before confirming completion')
    if (blank(result) || blank(evidence)) {
      return reject('RESULT_EVIDENCE_REQUIRED', 'completion needs a result and verification evidence')
    }
    if (!resultFresh) return reject('RESULT_STALE', 'the result predates this delivery; produce a new result and evidence')
    if (blank(acceptance)) return reject('ACCEPTANCE_REQUIRED', 'completion criteria are required before confirming completion')
  }
  if (to === 'doing' && from === 'todo') {
    if (!linked) return reject('NOT_LINKED', 'link the task to a session before starting')
    if (running) return reject('RUNNING', 'another run of this task is already in progress')
  }
  if (to === 'todo') {
    if (blank(reason)) return reject('REASON_REQUIRED', 'a reason is required to reopen or return the task')
    if (from !== 'done' && from !== 'cancelled' && running) {
      return reject('RUNNING', 'stop the running task before returning it to todo')
    }
  }
  return ok()
}

// Tasks can be planned before development. Execution still requires in_progress.
export function canCreateIssue(requirementStatus) {
  return ['ready', 'in_progress'].includes(requirementStatus)
    ? ok()
    : reject('TASK_PLANNING_NOT_ALLOWED', 'tasks can only be created while the requirement is ready or in development')
}

export function startBlockers(issue) {
  const missing = taskContentBlockers(issue)
  if (blank(issue.acceptance)) missing.push('acceptance')
  return missing
}

function canDevelopTasks(issues) {
  if (!issues.length) return reject('DEV_TASKS_REQUIRED', 'add at least one development task')
  const incomplete = issues.map(issue => ({
    title: (typeof issue.title === 'string' && issue.title.trim()) || issue.id,
    fields: startBlockers(issue),
  }))
    .filter(issue => issue.fields.length)
  return incomplete.length ? reject('DEV_TASK_FIELDS_REQUIRED', JSON.stringify(incomplete)) : ok()
}
