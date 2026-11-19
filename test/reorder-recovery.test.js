import assert from 'node:assert/strict'
import test from 'node:test'
import { makeRoot, saveReviewPrd } from './util.js'
import { initProject, createRequirement, updateRequirement, moveRequirement, createIssue, scanProject } from '../core/store.js'
import { dispatch } from '../core/rpc.js'
import { sortedTasks, reorderPlan, continueReorder } from '../client-src/shell/nav-state.js'

async function fixture(t, label) {
  const root = await makeRoot(t)
  await initProject(root)
  const reqId = (await createRequirement(root, label)).data.id
  await updateRequirement(root, reqId, { q_pain: '概述' })
  await saveReviewPrd(root, reqId)
  for (const to of ['reviewing', 'ready', 'in_progress']) await moveRequirement(root, reqId, to)
  for (const title of ['甲', '乙', '丙', '丁']) await createIssue(root, reqId, title, { problemOverview: '要做的事' })
  return { root, reqId }
}
const call = (method, input) => dispatch(method, input, new AbortController().signal)

test('partial task reorder continues the same plan in its original project after switching projects', async t => {
  const a = await fixture(t, '项目 A')
  const b = await fixture(t, '项目 B')
  const read = async fixture => sortedTasks((await scanProject(fixture.root)).requirements.find(r => r.id === fixture.reqId).issues)
  const aBefore = await read(a), bBefore = await read(b)
  const desired = [aBefore[1].id, aBefore[0].id, ...aBefore.slice(2).map(i => i.id)]
  const operation = { ...a, kind: 'issue', next: 0, error: null,
    before: aBefore.map(i => ({ id: i.id, order: i.order })),
    steps: reorderPlan(aBefore, aBefore[0].id, 'down').map(p => ({ ...p, hash: aBefore.find(i => i.id === p.id).hash })) }
  let shownProject = a.root, calls = 0, injectFailure = true
  const ops = {
    read: async () => ({ ok: true, items: await read(a) }),
    write: async step => {
      calls++
      if (calls === 2 && injectFailure) return { ok: false, code: 'READ_FAILED' }
      const result = await call('issue/update', { root: operation.root, reqId: operation.reqId,
        id: step.id, patch: { order: step.order }, fileHash: step.hash })
      shownProject = b.root // UI switches after an early write; original operation must finish in A.
      return result
    },
  }
  await continueReorder(operation, ops)
  assert.equal(shownProject, b.root)
  assert.equal(operation.next, 1)
  assert.equal(operation.error.code, 'READ_FAILED')
  assert.deepEqual((await read(b)).map(i => [i.id, i.order, i.hash]), bBefore.map(i => [i.id, i.order, i.hash]))
  injectFailure = false
  await continueReorder(operation, ops)
  assert.equal(operation.error, null)
  assert.deepEqual((await read(a)).map(i => i.id), desired)
  assert.deepEqual((await read(b)).map(i => [i.id, i.order, i.hash]), bBefore.map(i => [i.id, i.order, i.hash]))
})
