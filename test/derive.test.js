import assert from 'node:assert/strict'
import test from 'node:test'
import { progressOf, deriveRequirement, currentDoing, todaySuggestion, rankSuggestions, homeSummary } from '../core/derive.js'

const NOW = Date.parse('2026-11-12T12:00:00+08:00')
const iso = ms => new Date(ms).toISOString()
const req = (over = {}) => ({ id: 'r', title: '需求', status: 'in_progress', order: 0, goal: 'g', scope: 's', acceptance: 'a', updated: iso(NOW), ...over })
const done = { id: 'd', status: 'done', acceptance: '结果符合预期', result: '结果', evidence: '依据', updated: iso(NOW) }

test('progress done/(total-cancelled); in_review not counted; zero denominator -> null', () => {
  assert.equal(progressOf([{ status: 'done' }, { status: 'todo' }]), 0.5)
  assert.equal(progressOf([{ status: 'done' }, { status: 'cancelled' }]), 1)
  assert.equal(progressOf([{ status: 'done' }, { status: 'in_review' }]), 0.5)
  assert.equal(progressOf([]), null)
  assert.equal(progressOf([{ status: 'cancelled' }]), null)
})

test('derive flags: blocked / needsClarification / stalled / submittable / acceptable', () => {
  assert.equal(deriveRequirement(req(), [{ status: 'blocked' }], NOW).blocked, true)
  assert.equal(deriveRequirement(req({ status: 'backlog', goal: '' }), [], NOW).needsClarification, true)
  assert.equal(deriveRequirement(req({ status: 'backlog' }), [], NOW).needsClarification, false)
  assert.equal(deriveRequirement(req({ status: 'backlog', q_pain: '概述', goal: '', scope: '', acceptance: '' }), [], NOW).needsClarification, false)
  assert.equal(deriveRequirement(req({ updated: iso(NOW - 8 * 86400000) }), [], NOW).stalled, true)
  assert.equal(deriveRequirement(req({ updated: iso(NOW - 1 * 86400000) }), [], NOW).stalled, false)
  // Submittable needs the full PRD 9.5 conditions, not just terminal tasks.
  assert.equal(deriveRequirement(req({ deliverySummary: 's' }), [done], NOW).submittable, true)
  assert.equal(deriveRequirement(req(), [done], NOW).submittable, false) // no summary
  assert.equal(deriveRequirement(req({ deliverySummary: 's' }), [{ status: 'done' }], NOW).submittable, false) // no result/evidence
  assert.equal(deriveRequirement(req({ deliverySummary: 's' }), [], NOW).submittable, false)
  assert.equal(deriveRequirement(req({ status: 'pending' }), [], NOW).acceptable, true)
})

test('a previous delivery does not mark a reopened requirement as submittable', () => {
  const reopened = req({ deliveryStartedAt: NOW, deliverySummary: '摘要', deliverySummaryAt: NOW + 1000, cancelImpact: '不影响范围', cancelImpactAt: NOW })
  const sibling = { ...done, id: 'c', resultAt: NOW - 1000, evidenceAt: NOW - 1000 }
  const oldDelivery = { ...done, resultAt: NOW - 1000, evidenceAt: NOW - 1000 }
  const newDelivery = { ...done, resultAt: NOW + 1000, evidenceAt: NOW + 1000 }

  assert.equal(deriveRequirement(reopened, [sibling, oldDelivery], NOW).submittable, false)
  assert.equal(todaySuggestion([reopened], { r: [sibling, oldDelivery] }, NOW), null)
  assert.equal(deriveRequirement(reopened, [sibling, newDelivery], NOW).submittable, true)
  assert.equal(todaySuggestion([reopened], { r: [sibling, newDelivery] }, NOW).kind, 'submittable')
  assert.equal(deriveRequirement(reopened, [{ ...sibling, status: 'cancelled' }, newDelivery], NOW).submittable, false)
})

test('derive counts share one口径 with the home summary', () => {
  const issues = [{ status: 'blocked' }, { status: 'in_review' }, done, { status: 'cancelled' }]
  const d = deriveRequirement(req(), issues, NOW)
  assert.equal(d.blockedCount, 1)
  assert.equal(d.inReviewCount, 1)
  assert.equal(d.doneCount, 1)
  assert.equal(d.cancelledCount, 1)
})

test('currentDoing picks lowest-order in-progress requirement and first non-terminal issue', () => {
  const reqs = [req({ id: 'high', order: 5 }), req({ id: 'low', order: 1 })]
  const by = { high: [{ id: 'h1', status: 'todo', order: 0 }], low: [{ id: 'l1', status: 'done', order: 0 }, { id: 'l2', status: 'doing', order: 1 }] }
  assert.deepEqual(currentDoing(reqs, by), { reqId: 'low', issueId: 'l2' })
})

test('currentDoing skips terminal-only requirements', () => {
  const reqs = [req({ id: 'a', order: 0 })]
  assert.equal(currentDoing(reqs, { a: [{ id: 'x', status: 'done' }] }), null)
})

test('todaySuggestion priority: submittable > blocked > currentDoing > clarify > stalled', () => {
  const submittable = req({ id: 'sub', deliverySummary: 's' })
  const blocked = req({ id: 'blk' })
  const by = { sub: [done], blk: [{ status: 'blocked' }] }
  assert.equal(todaySuggestion([blocked, submittable], by, NOW).kind, 'submittable')
  assert.equal(todaySuggestion([blocked], by, NOW).kind, 'blocked')
  const doing = req({ id: 'do' })
  assert.equal(todaySuggestion([doing], { do: [{ id: 'i', status: 'todo' }] }, NOW).kind, 'currentDoing')
  const clarify = req({ id: 'cl', status: 'backlog', goal: '' })
  assert.equal(todaySuggestion([clarify], { cl: [] }, NOW).kind, 'needsClarification')
  const stalled = req({ id: 'st', updated: iso(NOW - 9 * 86400000) })
  assert.equal(todaySuggestion([stalled], { st: [] }, NOW).kind, 'stalled')
  assert.equal(todaySuggestion([], {}, NOW), null)
})

test('rankSuggestions returns all applicable hints in priority order', () => {
  const submittable = req({ id: 'sub', deliverySummary: 's' })
  const blocked = req({ id: 'blk' })
  const clarify = req({ id: 'cl', status: 'backlog', goal: '' })
  const by = { sub: [done], blk: [{ status: 'blocked' }], cl: [] }
  const ranked = rankSuggestions([clarify, blocked, submittable], by, NOW)
  assert.deepEqual(ranked.map(s => s.kind), ['submittable', 'blocked', 'needsClarification'])
  assert.equal(ranked[0].reqId, 'sub')
  assert.deepEqual(rankSuggestions([], {}, NOW), [])
})

test('home summary: counts, priority order, longest-wait first, task merge', () => {
  const reqs = [
    req({ id: 'rp', status: 'pending', updated: iso(NOW - 1000) }),
    req({ id: 'rr', status: 'reviewing', submittedAt: iso(NOW - 2000) }),
    req({ id: 'rd', status: 'ready', reviewedAt: iso(NOW - 3000) }),
    req({ id: 'ri', status: 'in_progress' }),
  ]
  const by = {
    ri: [
      { id: 'blk', title: '阻塞', status: 'blocked', blocked_reason: '缺依赖', blockedAt: NOW - 5000, updated: iso(NOW - 5000) },
      { id: 'rev', title: '等确认', status: 'in_review', inReviewAt: NOW - 4000, updated: iso(NOW - 4000) },
      { id: 'rev2', title: '等确认2', status: 'in_review', inReviewAt: NOW - 6000, updated: iso(NOW - 6000) },
    ],
  }
  const { reminders, counts } = homeSummary(reqs, by, { now: NOW, running: [{ issueId: 'blk', awaitingAuth: true }] })
  assert.deepEqual(counts, { reviewing: 1, ready: 1, in_progress: 1, pending: 1, blocked: 1, inReview: 2 })
  // blocked+awaitingAuth merge into ONE item for the same task, highest priority first.
  assert.equal(reminders[0].issueId, 'blk')
  assert.deepEqual(reminders[0].kinds.sort(), ['awaitingAuth', 'blocked'])
  // Then in_review by longest wait (rev2 older than rev), then pending, reviewing, ready.
  assert.deepEqual(reminders.map(r => r.issueId ?? r.reqId), ['blk', 'rev2', 'rev', 'rp', 'rr', 'rd'])
  assert.equal(reminders.filter(r => r.issueId === 'blk').length, 1)
})

test('home summary: empty project has zero counts and no reminders', () => {
  const { reminders, counts } = homeSummary([], {}, { now: NOW })
  assert.deepEqual(reminders, [])
  assert.deepEqual(counts, { reviewing: 0, ready: 0, in_progress: 0, pending: 0, blocked: 0, inReview: 0 })
})

test('blocked waiting uses its start time and leaves old or invalid records unknown', () => {
  const issues = [
    { id: 'oldest', status: 'blocked', blockedAt: NOW - 7200000, updated: iso(NOW - 1000) },
    { id: 'legacy', status: 'blocked', updated: iso(NOW - 3600000) },
    { id: 'invalid', status: 'blocked', blockedAt: -1, updated: iso(NOW - 1800000) },
  ]
  const { reminders } = homeSummary([req()], { r: issues }, { now: NOW, running: [{ issueId: 'oldest', awaitingAuth: true }] })
  assert.deepEqual(reminders.map(item => item.issueId), ['oldest', 'legacy', 'invalid'])
  assert.deepEqual(reminders.map(item => item.waitingSince), [NOW - 7200000, null, null])
  assert.deepEqual(reminders[0].kinds.sort(), ['awaitingAuth', 'blocked'])
})

test('permission waits do not borrow task update times or override a known blocked wait', () => {
  const issues = [
    { id: 'auth-old-task', status: 'doing', updated: iso(NOW - 86400000) },
    { id: 'block-later-than-update', status: 'blocked', blockedAt: NOW - 2000, updated: iso(NOW - 3600000) },
    { id: 'block-earlier-than-update', status: 'blocked', blockedAt: NOW - 7200000, updated: iso(NOW - 1000) },
    { id: 'auth-new-task', status: 'doing', updated: iso(NOW - 1000) },
  ]
  const running = issues.map(issue => ({ issueId: issue.id, awaitingAuth: true }))
  const { reminders } = homeSummary([req()], { r: issues }, { now: NOW, running })
  // Every merged reminder contains an unknown authorization start, so it is
  // not valid to rank these against one another using only blocked times.
  assert.deepEqual(reminders.map(item => item.issueId), [
    'auth-old-task', 'block-later-than-update', 'block-earlier-than-update', 'auth-new-task',
  ])
  assert.deepEqual(reminders.map(item => item.waitingSince), [null, NOW - 2000, NOW - 7200000, null])
  assert.deepEqual(reminders.map(item => item.waitingKind), [null, 'blocked', 'blocked', null])
})

test('known authorization requests sort by request start; a merge with an unknown start sorts after known waits', () => {
  const issues = [
    { id: 'later', status: 'doing' },
    { id: 'unknown-merge', status: 'blocked', blockedAt: NOW - 9000000 },
    { id: 'earlier', status: 'doing' },
    { id: 'known-merge', status: 'blocked', blockedAt: NOW - 5000 },
  ]
  const running = [
    { issueId: 'later', awaitingAuth: true, authAskedAt: NOW - 1000 },
    { issueId: 'unknown-merge', awaitingAuth: true },
    { issueId: 'earlier', awaitingAuth: true, authAskedAt: NOW - 4000 },
    { issueId: 'known-merge', awaitingAuth: true, authAskedAt: NOW - 3000 },
  ]
  const { reminders } = homeSummary([req()], { r: issues }, { now: NOW, running })
  assert.deepEqual(reminders.map(item => item.issueId), ['known-merge', 'earlier', 'later', 'unknown-merge'])
  assert.equal(reminders[0].waitingSince, NOW - 5000)
  assert.equal(reminders[0].authWaitingSince, NOW - 3000)
  assert.equal(reminders[3].waitingSince, NOW - 9000000) // display known blocked time, not as a complete ordering key
  assert.equal(reminders[3].authWaitingSince, null)
})

test('when confirmation and authorization merge, priority-zero ordering uses authorization time only', () => {
  const issues = [
    { id: 'old-confirm-new-auth', status: 'in_review', inReviewAt: NOW - 9000000 },
    { id: 'unknown-confirm-old-auth', status: 'in_review' },
    { id: 'other-auth', status: 'doing' },
  ]
  const running = [
    { issueId: 'old-confirm-new-auth', awaitingAuth: true, authAskedAt: NOW - 1000 },
    { issueId: 'unknown-confirm-old-auth', awaitingAuth: true, authAskedAt: NOW - 3000 },
    { issueId: 'other-auth', awaitingAuth: true, authAskedAt: NOW - 2000 },
  ]
  const { reminders } = homeSummary([req()], { r: issues }, { now: NOW, running })
  assert.deepEqual(reminders.map(item => item.issueId), ['unknown-confirm-old-auth', 'other-auth', 'old-confirm-new-auth'])
  assert.equal(reminders[2].waitingSince, NOW - 9000000) // confirmation remains visible but does not affect authorization ordering
  assert.equal(reminders[2].authWaitingSince, NOW - 1000)
})

test('missing or invalid blocked and confirmation times stay unknown', () => {
  const issues = [
    { id: 'blocked-missing', status: 'blocked' },
    { id: 'blocked-invalid', status: 'blocked', blockedAt: -1, updated: 'not-a-date' },
    { id: 'blocked-legacy', status: 'blocked', updated: iso(NOW - 60000) },
    { id: 'confirmation-missing', status: 'in_review', updated: iso(NOW - 120000) },
    { id: 'confirmation-invalid', status: 'in_review', updated: 'not-a-date' },
  ]
  const running = issues.map(issue => ({ issueId: issue.id, awaitingAuth: true }))
  const { reminders } = homeSummary([req()], { r: issues }, { now: NOW, running })
  assert.deepEqual(reminders.map(item => item.issueId), [
    'blocked-missing', 'blocked-invalid', 'blocked-legacy', 'confirmation-missing', 'confirmation-invalid',
  ])
  for (const item of reminders) {
    assert.equal(item.waitingSince, null)
    assert.equal(item.waitingKind, null)
  }
})

test('missing or invalid requirement reminder timestamps remain unknown', () => {
  const requirements = [
    req({ id: 'pending', status: 'pending', updated: 'bad' }),
    req({ id: 'reviewing', status: 'reviewing' }),
    req({ id: 'ready', status: 'ready', reviewedAt: 'bad' }),
  ]
  const { reminders } = homeSummary(requirements, {}, { now: NOW })
  assert.deepEqual(reminders.map(item => item.reqId), ['pending', 'reviewing', 'ready'])
  assert.deepEqual(reminders.map(item => item.waitingSince), [null, null, null])
})
