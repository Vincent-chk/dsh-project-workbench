import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PAGES, MENU, statusPage, defaultViewState, normalizeViewState, filterOf, withFilter,
  openDetail, backOf, poolItems, reviewItems, readyItems, devItems, pendingItems, boardItems,
  recordItems, blockedItems, failureItems, riskItems, reorderPlan, continueReorder, waitParts, MOVES, ISSUE_MOVES,
} from '../client-src/shell/nav-state.js'

const req = (id, status, extra = {}) => ({ id, title: '需求' + id, status, issues: [], reviews: [], ...extra })
const issue = (id, status, extra = {}) => ({ id, title: '任务' + id, status, ...extra })

test('home and board are the first two top-level destinations', () => {
  assert.deepEqual(MENU.filter(entry => !entry.group).map(entry => entry.page), ['home', 'board'])
  assert.deepEqual(MENU.find(entry => entry.group === 'navDevelopment').items.map(item => item.page), ['dev', 'blocked'])
  const pages = MENU.flatMap(e => e.group ? e.items.map(i => i.page) : [e.page])
  assert.deepEqual(pages, PAGES.filter(page => page !== 'sync'))
  assert.equal(statusPage('backlog'), 'pool')
  assert.equal(statusPage('pending'), 'pending')
  assert.equal(statusPage('completed'), 'board')
  assert.equal(statusPage(undefined), 'board')
})

test('view state normalizes and isolates filters per page', () => {
  assert.deepEqual(normalizeViewState(null), defaultViewState())
  assert.equal(normalizeViewState({ page: 'bogus' }).page, 'home')
  const v = normalizeViewState({ page: 'dev', params: { reqId: 'r1' }, filters: { dev: { query: 'x' } }, history: [] })
  assert.equal(v.page, 'dev')
  assert.deepEqual(filterOf(v, 'dev'), { query: 'x' })
  assert.deepEqual(filterOf(v, 'pool'), {})
  const v2 = withFilter(v, 'pool', { query: 'y' })
  assert.deepEqual(filterOf(v2, 'pool'), { query: 'y' })
  assert.deepEqual(filterOf(v2, 'dev'), { query: 'x' }) // dev filter untouched
})

test('detail history: open pushes origin, back restores it; A→B→A keeps position', () => {
  let v = { ...defaultViewState(), page: 'pool' }
  v = withFilter(v, 'pool', { query: 'keep' })
  v = openDetail(v, { reqId: 'r1', issueId: null })
  assert.equal(v.params.reqId, 'r1')
  assert.equal(v.history.length, 0) // first detail remembers origin via page, no stack entry yet
  // jump from requirement detail to a task detail pushes the requirement position
  v = openDetail(v, { reqId: 'r1', issueId: 'i1' })
  assert.equal(v.history.length, 1)
  v = backOf(v)
  assert.deepEqual(v.params, { reqId: 'r1', issueId: null })
  v = backOf(v)
  assert.equal(v.params, null)
  assert.equal(v.page, 'pool')
  assert.deepEqual(filterOf(v, 'pool'), { query: 'keep' }) // filter preserved through the round trip
  // back with no history just clears params
  assert.deepEqual(backOf({ ...defaultViewState(), page: 'home' }).params, null)
})

test('cross-page locate (home reminder): back returns to the origin page', () => {
  let v = { ...defaultViewState(), page: 'home' }
  v = openDetail(v, { reqId: 'r1', issueId: 'i1' }, 'dev')
  assert.equal(v.page, 'dev')
  assert.deepEqual(v.history, [{ page: 'home', params: null }])
  v = backOf(v)
  assert.equal(v.page, 'home') // not left on 开发中 (U5-02 rework)
  assert.equal(v.params, null)
  // blocked page locating a task inside its requirement also returns to the origin list
  let b = openDetail({ ...defaultViewState(), page: 'blocked' }, { reqId: 'r1', issueId: null }, 'dev')
  b = backOf(b)
  assert.equal(b.page, 'blocked')
})

test('list derivation filters by status and title, with the documented sort', () => {
  const rs = [
    req('a', 'backlog', { updated: '2026-11-02T00:00:00Z' }),
    req('b', 'backlog', { updated: '2026-11-03T00:00:00Z', title: '登录问题' }),
    req('c', 'reviewing', { submittedAt: '2026-11-02T00:00:00Z' }),
    req('d', 'reviewing', { submittedAt: '2026-11-01T00:00:00Z' }),
    req('e', 'ready', { order: 2 }),
    req('f', 'ready', { order: 1 }),
  ]
  assert.deepEqual(poolItems(rs, '').map(r => r.id), ['b', 'a']) // updated desc
  assert.deepEqual(poolItems(rs, '登录').map(r => r.id), ['b'])
  assert.deepEqual(reviewItems(rs, '').map(r => r.id), ['d', 'c']) // submitted asc
  assert.deepEqual(readyItems(rs, '').map(r => r.id), ['f', 'e']) // order asc
  assert.deepEqual(boardItems(rs, '', 'ready').map(r => r.id), ['f', 'e'])
  assert.deepEqual(devItems(rs, ''), [])
  assert.deepEqual(pendingItems(rs, ''), [])
})

test('acceptance records: one row per decision, dedup, filter and newest first', () => {
  const rs = [
    req('a', 'completed', { reviews: [
      { kind: 'acceptance', decision: 'approved', at: '2026-11-01T10:00:00Z', marker: 'm1', opinion: '通过', summary: '摘要1' },
      { kind: 'acceptance', decision: 'approved', at: '2026-11-01T10:00:00Z', marker: 'm1', opinion: '通过', summary: '摘要1' }, // duplicate marker
      { kind: 'review', decision: 'approved', at: '2026-11-01T09:00:00Z', marker: 'm0' }, // review, not acceptance
    ] }),
    req('b', 'in_progress', { reviews: [
      { kind: 'acceptance', decision: 'returned', at: '2026-11-03T10:00:00Z', marker: 'm2', opinion: '打回原因', summary: '摘要2' },
    ] }),
  ]
  const all = recordItems(rs, {})
  assert.equal(all.length, 2)
  assert.deepEqual(all.map(r => r.reqId), ['b', 'a']) // newest first
  assert.deepEqual(recordItems(rs, { decision: 'approved' }).map(r => r.reqId), ['a'])
  assert.deepEqual(recordItems(rs, { decision: 'returned' }).map(r => r.reqId), ['b'])
  assert.deepEqual(recordItems(rs, { query: '打回' }).map(r => r.reqId), ['b'])
  assert.deepEqual(recordItems(rs, { query: '需求a' }).map(r => r.reqId), ['a'])
})

test('blocked / failure / risk items derive from existing data only', () => {
  const rs = [
    req('a', 'in_progress', { issues: [
      issue('i1', 'blocked', { blocked_reason: '缺接口', blockedAt: 100, updated: '2026-11-01T00:00:00Z' }),
      issue('i2', 'doing', { verification: { failed: 2 }, objectiveAt: 200 }),
      issue('i3', 'done', { verification: { failed: 1 } }), // terminal → not a failure item
    ] }),
  ]
  const blocked = blockedItems(rs, {})
  assert.equal(blocked.length, 1)
  assert.equal(blocked[0].issueId, 'i1')
  assert.equal(blocked[0].reason, '缺接口')
  assert.deepEqual(blockedItems(rs, { reqId: 'nope' }), [])
  const failures = failureItems(rs)
  assert.deepEqual(failures.map(f => f.issueId), ['i2'])
  assert.equal(failures[0].failed, 2)
  const proposals = [
    { id: 'p1', status: 'pending', kind: 'stalled', target: { reqId: 'a' }, reason: '停滞', evidence: ['x'] },
    { id: 'p2', status: 'pending', kind: 'new_task', target: { reqId: 'a' }, reason: '拆分' }, // draft → excluded
    { id: 'p3', status: 'dismissed', kind: 'stalled', target: { reqId: 'a' }, reason: '已忽略' },
  ]
  assert.deepEqual(riskItems(proposals).map(p => p.id), ['p1'])
})

test('reorder swaps distinct orders and normalizes equal orders; edges are no-ops', () => {
  const distinct = [{ id: 'a', order: 1 }, { id: 'b', order: 2 }, { id: 'c', order: 3 }]
  assert.deepEqual(reorderPlan(distinct, 'b', 'up'), [{ id: 'b', order: 1 }, { id: 'a', order: 2 }])
  assert.deepEqual(reorderPlan(distinct, 'a', 'up'), [])
  assert.deepEqual(reorderPlan(distinct, 'c', 'down'), [])
  // all created with order 0 → first reorder establishes positions with the swap applied
  const equal = [{ id: 'a', order: 0 }, { id: 'b', order: 0 }, { id: 'c', order: 0 }]
  const plan = reorderPlan(equal, 'b', 'up')
  assert.deepEqual(plan, [{ id: 'a', order: 1 }, { id: 'c', order: 2 }]) // b keeps 0, a/c shift → b,a,c
  assert.deepEqual(reorderPlan(equal, 'missing', 'up'), [])
})

test('reorder resumes the same partial plan and detects conflicting edits', async () => {
  const items = [
    { id: 'a', order: 0, hash: 'a0' }, { id: 'b', order: 0, hash: 'b0' },
    { id: 'c', order: 0, hash: 'c0' }, { id: 'd', order: 0, hash: 'd0' },
  ]
  const steps = reorderPlan(items, 'a', 'down').map(p => ({ ...p, hash: items.find(i => i.id === p.id).hash }))
  const op = { steps, next: 0, error: null }
  const writes = []
  let fail = true
  const read = async () => ({ ok: true, items })
  const write = async step => {
    writes.push(step.id)
    if (step.id === 'c' && fail) return { ok: false, code: 'READ_FAILED' }
    const item = items.find(i => i.id === step.id)
    assert.equal(item.hash, step.hash)
    item.order = step.order; item.hash += '!'
    return { ok: true }
  }
  await continueReorder(op, { read, write })
  assert.equal(op.next, 1)
  assert.equal(op.error.code, 'READ_FAILED')
  fail = false
  await continueReorder(op, { read, write })
  assert.equal(op.error, null)
  assert.equal(op.next, steps.length)
  assert.equal(writes.filter(id => id === 'a').length, 1)
  assert.deepEqual([...items].sort((a, b) => a.order - b.order).map(i => i.id), ['b', 'a', 'c', 'd'])

  const conflict = { steps: [{ id: 'c', order: 7, hash: 'old' }], next: 0, error: { code: 'READ_FAILED' } }
  await continueReorder(conflict, { read, write })
  assert.equal(conflict.error.code, 'CONFLICT')
  assert.equal(items.find(i => i.id === 'c').order, 2)

  // The write landed but its response was lost. Re-reading must recognise the
  // saved value and continue, not repeat it with an obsolete fingerprint.
  const lost = { steps: [{ id: 'd', order: 8, hash: items.find(i => i.id === 'd').hash }], next: 0, error: null }
  let calls = 0
  await continueReorder(lost, { read, write: async step => {
    calls++
    const item = items.find(i => i.id === step.id)
    item.order = step.order; item.hash += '!'
    return { ok: false, code: 'TRANSPORT_ERROR' }
  } })
  await continueReorder(lost, { read, write: async () => { calls++; return { ok: true } } })
  assert.equal(calls, 1)
  assert.equal(lost.error, null)
  assert.equal(lost.next, 1)
})

test('waiting time buckets and transition tables stay consistent with the guards', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')
  assert.equal(waitParts(now, now).key, 'waitNow')
  assert.deepEqual(waitParts(now - 5 * 60000, now), { key: 'waitMinute', n: 5 })
  assert.deepEqual(waitParts(now - 3 * 3600000, now), { key: 'waitHour', n: 3 })
  assert.deepEqual(waitParts(now - 2 * 86400000, now), { key: 'waitDay', n: 2 })
  // board moves match PRD §10.3 edges
  assert.equal(MOVES.backlog.reviewing, 'move')
  assert.equal(MOVES.reviewing.backlog, 'reason')
  assert.equal(MOVES.in_progress.pending, 'submitDelivery')
  assert.equal(MOVES.pending.completed, 'confirmComplete')
  assert.equal(MOVES.pending.in_progress, 'reopenRequirement')
  assert.equal(MOVES.completed.in_progress, 'reopenRequirement')
  assert.equal(MOVES.backlog.ready, undefined) // illegal cross-column move
  assert.equal(ISSUE_MOVES.in_review.done, 'demoConfirm')
  assert.equal(ISSUE_MOVES.done.todo, 'reopen')
  assert.equal(ISSUE_MOVES.cancelled.todo, 'restoreTask')
})
