// Read-time derived views (PRD §7.3/§7.5, tech §11). Nothing here is persisted.
// Runtime facts (running/awaiting authorization) are passed in by the caller;
// no persistent risk entities are created.
import { TERMINAL_ISSUE, canMoveRequirement, requirementOverview } from './state.js'

const DAY_MS = 86400000
const blank = v => v === undefined || v === null || String(v).trim() === ''
const orderOf = r => (typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : Number.MAX_SAFE_INTEGER)
const msOf = (v, fallback) => { const t = Date.parse(v); return Number.isFinite(t) ? t : fallback }

export function progressOf(issues) {
  const total = issues.length
  const cancelled = issues.filter(i => i.status === 'cancelled').length
  const denom = total - cancelled
  if (denom === 0) return null // display "—" (no tasks or all cancelled)
  const done = issues.filter(i => i.status === 'done').length // in_review is NOT done
  return done / denom
}

export function deriveRequirement(req, issues, now = Date.now()) {
  const updatedMs = Date.parse(req.updated)
  const blocked = issues.filter(i => i.status === 'blocked').length
  const inReview = issues.filter(i => i.status === 'in_review').length
  // Submittable reuses the exact acceptance guard so auto and manual agree.
  const submittable = req.status === 'in_progress' && canMoveRequirement({
    from: 'in_progress', to: 'pending', issues, actor: 'system',
    summary: req.deliverySummary, cancelImpact: req.cancelImpact, pendingReopen: req.pendingReopen,
    reqDeliveryStartedAt: req.deliveryStartedAt, summaryAt: req.deliverySummaryAt, cancelImpactAt: req.cancelImpactAt,
  }).ok
  return {
    progress: progressOf(issues),
    blocked: blocked > 0,
    blockedCount: blocked,
    inReviewCount: inReview,
    doneCount: issues.filter(i => i.status === 'done').length,
    cancelledCount: issues.filter(i => i.status === 'cancelled').length,
    needsClarification: req.status === 'backlog' && (blank(req.title) || !requirementOverview(req)),
    stalled: req.status === 'in_progress' && Number.isFinite(updatedMs) && (now - updatedMs) > 7 * DAY_MS,
    submittable,
    acceptable: req.status === 'pending',
  }
}

// The first non-terminal issue of the lowest-order in-progress requirement.
export function currentDoing(requirements, issuesByReq) {
  const active = requirements.filter(r => r.status === 'in_progress').sort((a, b) => orderOf(a) - orderOf(b))
  for (const req of active) {
    const issues = (issuesByReq[req.id] ?? []).slice().sort((a, b) => orderOf(a) - orderOf(b))
    const first = issues.find(i => !TERMINAL_ISSUE.has(i.status))
    if (first) return { reqId: req.id, issueId: first.id }
  }
  return null
}

// Ranked applicable hints (priority order), one per requirement; the UI skips dismissed ones.
export function rankSuggestions(requirements, issuesByReq, now = Date.now()) {
  const derived = requirements.map(r => ({ req: r, d: deriveRequirement(r, issuesByReq[r.id] ?? [], now) }))
  const out = []; const seen = new Set()
  const push = s => { if (!seen.has(s.reqId)) { seen.add(s.reqId); out.push(s) } }
  for (const x of derived) if (x.d.submittable) push({ kind: 'submittable', reqId: x.req.id })
  for (const x of derived) if (x.d.blocked) push({ kind: 'blocked', reqId: x.req.id })
  const doing = currentDoing(requirements, issuesByReq)
  if (doing) push({ kind: 'currentDoing', ...doing })
  for (const x of derived) if (x.d.needsClarification) push({ kind: 'needsClarification', reqId: x.req.id })
  for (const x of derived) if (x.d.stalled) push({ kind: 'stalled', reqId: x.req.id })
  return out
}

// Single top hint: submittable > blocked > currentDoing > needsClarification > stalled.
export function todaySuggestion(requirements, issuesByReq, now = Date.now()) {
  return rankSuggestions(requirements, issuesByReq, now)[0] ?? null
}

// Home "需要你处理" + "项目进展" (PRD §7.3). Reminder priority:
// blocked/awaitingAuth(0) > inReview(1) > pending(2) > reviewing(3) > ready(4);
// within a kind, longest wait first. Multiple reminders for one task merge.
const PRIORITY = { awaitingAuth: 0, blocked: 0, inReview: 1, pending: 2, reviewing: 3, ready: 4 }
export function homeSummary(requirements, issuesByReq, { now = Date.now(), running = [] } = {}) {
  const runningByIssue = new Map()
  for (const r of running) if (r?.issueId) runningByIssue.set(r.issueId, r)
  const counts = { reviewing: 0, ready: 0, in_progress: 0, pending: 0, blocked: 0, inReview: 0 }
  const taskItems = new Map() // issueId -> merged reminder
  const reqItems = []

  const addTask = (req, issue, kind, reason, authAskedAt = null) => {
    const prev = taskItems.get(issue.id)
    const blockedAt = Number(issue.blockedAt)
    const inReviewAt = Number(issue.inReviewAt)
    // Only an exact match to the current approval may provide its request time.
    const waitingSince = kind === 'awaitingAuth'
      ? (Number.isFinite(authAskedAt) && authAskedAt > 0 && authAskedAt <= now ? authAskedAt : null)
      : kind === 'blocked'
        ? (Number.isFinite(blockedAt) && blockedAt > 0 ? blockedAt : null) : kind === 'inReview'
          ? (Number.isFinite(inReviewAt) && inReviewAt > 0 ? inReviewAt : null)
          : msOf(issue.updated, null)
    if (prev) {
      if (kind === 'awaitingAuth') prev.authWaitingSince = waitingSince
      if (PRIORITY[kind] < prev.priority) {
        prev.sortSince = waitingSince
        prev.sortUnknown = waitingSince === null
      } else if (PRIORITY[kind] === prev.priority) {
        if (waitingSince === null) prev.sortUnknown = true
        else if (prev.sortSince === null || waitingSince < prev.sortSince) prev.sortSince = waitingSince
      }
      if (!prev.kinds.includes(kind)) prev.kinds.push(kind)
      if (reason && !prev.reasons.includes(reason)) prev.reasons.push(reason)
      prev.priority = Math.min(prev.priority, PRIORITY[kind])
      if (waitingSince !== null && (prev.waitingSince === null || waitingSince < prev.waitingSince)) {
        prev.waitingSince = waitingSince
        prev.waitingKind = kind
      }
    } else {
      taskItems.set(issue.id, {
        reqId: req.id, issueId: issue.id, title: issue.title, reqTitle: req.title,
        kinds: [kind], reasons: reason ? [reason] : [], priority: PRIORITY[kind], waitingSince,
        waitingKind: waitingSince === null ? null : kind,
        sortSince: waitingSince,
        sortUnknown: waitingSince === null,
        ...(kind === 'awaitingAuth' ? { authWaitingSince: waitingSince } : {}),
      })
    }
  }

  for (const req of requirements) {
    const issues = issuesByReq[req.id] ?? []
    if (req.status === 'reviewing') counts.reviewing++
    else if (req.status === 'ready') counts.ready++
    else if (req.status === 'in_progress') counts.in_progress++
    else if (req.status === 'pending') counts.pending++
    for (const issue of issues) {
      if (issue.status === 'blocked') { counts.blocked++; addTask(req, issue, 'blocked', issue.blocked_reason || '任务被阻塞') }
      if (issue.status === 'in_review') { counts.inReview++; addTask(req, issue, 'inReview', '等待确认完成') }
      const run = runningByIssue.get(issue.id)
      if (run?.awaitingAuth) addTask(req, issue, 'awaitingAuth', '等待授权', run.authAskedAt)
    }
    if (req.status === 'pending') reqItems.push({ reqId: req.id, issueId: null, title: req.title, reqTitle: req.title, kinds: ['pending'], reasons: ['等待验收'], priority: PRIORITY.pending, waitingSince: msOf(req.updated, null) })
    if (req.status === 'reviewing') reqItems.push({ reqId: req.id, issueId: null, title: req.title, reqTitle: req.title, kinds: ['reviewing'], reasons: ['等待评审'], priority: PRIORITY.reviewing, waitingSince: msOf(req.submittedAt, null) })
    if (req.status === 'ready') reqItems.push({ reqId: req.id, issueId: null, title: req.title, reqTitle: req.title, kinds: ['ready'], reasons: ['待开发'], priority: PRIORITY.ready, waitingSince: msOf(req.reviewedAt, null) })
  }

  const sortTime = item => Object.hasOwn(item, 'sortSince') ? item.sortSince : item.waitingSince
  const reminders = [...taskItems.values(), ...reqItems]
    // Unknown authorization wait is not an actual time. Put it after known
    // times within a priority rather than treating null as epoch zero.
    .sort((a, b) => a.priority - b.priority ||
      ((a.sortUnknown || sortTime(a) === null) ? ((b.sortUnknown || sortTime(b) === null) ? 0 : 1)
        : (b.sortUnknown || sortTime(b) === null) ? -1 : sortTime(a) - sortTime(b)))
    .map(({ kinds, sortUnknown, sortSince, ...rest }) => ({ ...rest, kind: kinds.slice().sort((a, b) => PRIORITY[a] - PRIORITY[b])[0], kinds }))
  return { reminders, counts }
}
