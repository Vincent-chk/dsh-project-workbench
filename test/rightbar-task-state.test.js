import assert from 'node:assert/strict'
import test from 'node:test'
import { stampNeedsRead, taskChoices, taskRunView, terminalTask } from '../client-src/rightbar/task-state.js'

test('rightbar task choices include terminal states, filter by requirement/title and keep same-title IDs distinct', () => {
  const requirements = [
    { id: 'req-a', title: '需求 A', issues: [
      { id: 'iss-a1', title: '同名任务', status: 'todo' },
      { id: 'iss-a2', title: '同名任务', status: 'done' },
      { id: 'iss-a3', title: '说明', status: 'cancelled', description: '旧项目未验证的场景' },
    ] },
    { id: 'req-b', title: '需求 B', issues: [{ id: 'iss-b1', title: '同名任务', status: 'in_review' }] },
  ]
  const all = taskChoices(requirements)
  assert.deepEqual(all.map(issue => issue.id), ['iss-a1', 'iss-a2', 'iss-a3', 'iss-b1'])
  assert.deepEqual(taskChoices(requirements, { query: '同名' }).map(issue => issue.id), ['iss-a1', 'iss-a2', 'iss-b1'])
  const filtered = taskChoices(requirements, { query: '同名', reqId: 'req-a' })
  assert.deepEqual(filtered.map(issue => issue.id), ['iss-a1', 'iss-a2'])
  assert.equal(filtered[0].requirementTitle, '需求 A')
  assert.equal(filtered[0].reqId, 'req-a')
  assert.equal(terminalTask(filtered[1]), true)
  assert.deepEqual(taskChoices(requirements, { query: '未验证' }).map(issue => issue.id), ['iss-a3'])
})

test('rightbar separates DSH running/authorization from task business state', () => {
  assert.deepEqual(taskRunView({ running: true }, null), { running: true, waiting: false, locked: true, pending: undefined, description: 'runRunning', action: 'viewConversation', switchHint: 'switchRunning' })
  const pending = { kind: 'approval', key: 'p1' }
  assert.deepEqual(taskRunView({ running: false, pendingInteraction: pending }, null), { running: false, waiting: true, locked: true, pending, description: 'runWaiting', action: 'goAuthorize', switchHint: 'switchInteraction' })
  for (const kind of ['question', 'plan-review', 'future-kind', undefined]) {
    const interaction = { kind }
    const view = taskRunView({ running: true, pendingInteraction: interaction }, null)
    assert.equal(view.waiting, true)
    assert.equal(view.locked, true)
    assert.equal(view.description, 'runInteraction')
    assert.equal(view.action, 'viewConversation')
    assert.equal(view.switchHint, 'switchInteraction')
  }
  assert.equal(taskRunView({ running: false }, null).description, 'runIdle')
  assert.equal(taskRunView({ running: false }, null).locked, false)
  assert.equal(taskRunView(undefined, { state: 'starting' }).description, 'runStarting')
  assert.equal(taskRunView(undefined, { state: 'starting' }).switchHint, 'switchPending')
  for (const state of ['starting', 'uncertain', 'running']) assert.equal(taskRunView({ running: false }, { state }).locked, true)
  assert.equal(taskRunView(undefined, null).description, 'unknownRun')
})

test('task stamp polling catches an update between the detail read and the first tick', () => {
  const baseline = { modified: null, hash: 'h1' }
  const first = { modified: 100, hash: 'h1' }
  assert.equal(stampNeedsRead(baseline, first), false)
  assert.equal(stampNeedsRead(baseline, { modified: 100, hash: 'h2' }), true)
  assert.equal(stampNeedsRead(null, first), false)
})

test('task stamp polling reads only a changed stamp or hash after the first tick', () => {
  const first = { modified: 100, hash: 'h1' }
  assert.equal(stampNeedsRead(first, { modified: 100, hash: 'h1' }), false)
  assert.equal(stampNeedsRead(first, { modified: 101, hash: 'h1' }), true)
  assert.equal(stampNeedsRead(first, { modified: 100, hash: 'h2' }), true)
})
