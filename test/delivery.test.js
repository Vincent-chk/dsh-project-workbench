// Stage-3 §3.6: automatic delivery summary + acceptance submission after the
// last task passes acceptance. Stub Host children; real store + RPC hooks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installDelivery, taskConditions } from '../core/delivery.js'
import { dispatch } from '../core/rpc.js'
import * as store from '../core/store.js'
import { makeRoot, issueFileHash, stubSpawnHost, childReply, waitFor } from './util.js'

async function devReq(root, title = '需求') {
  await store.initProject(root)
  const { data } = await store.createRequirement(root, title)
  await store.updateRequirement(root, data.id, { goal: 'g', scope: 's', acceptance: 'a' })
  await store.moveRequirement(root, data.id, 'reviewing')
  await store.moveRequirement(root, data.id, 'ready')
  await store.moveRequirement(root, data.id, 'in_progress')
  return data.id
}
async function fullIssue(root, reqId, title = '任务') {
  const { data } = await store.createIssue(root, reqId, title)
  await store.updateIssue(root, reqId, data.id, { problemOverview: 'p', triggerPath: 't', acceptance: 'a', resultSummary: 'r', evidence: 'e' })
  return data.id
}
const reqOf = async (root, reqId) => (await store.scanProject(root)).requirements.find(r => r.id === reqId)
const confirm = async (root, reqId, id, hooks) => dispatch('issue/confirm', { root, reqId, id, fileHash: await issueFileHash(root, reqId, id) }, new AbortController().signal, {}, hooks)

function setup(t, root) {
  const { ctx, children } = stubSpawnHost(root)
  const delivery = installDelivery(ctx, { readOnlyChildren: new Set() })
  // The store fires the terminal trigger for every entry (RPC + adoption).
  const off = store.onTaskTerminal((r, id) => void delivery.maybeSubmit(r, id))
  t.after(off)
  const hooks = {}
  const status = async reqId => (await delivery.routes['delivery/status']({ root, reqId })).job
  return { ctx, children, delivery, hooks, status }
}

test('last confirmed task drafts a summary and submits the requirement to pending', async t => {
  const root = await makeRoot(t)
  const { children, hooks, status } = setup(t, root)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  await confirm(root, reqId, a, hooks)
  await new Promise(r => setTimeout(r, 30)) // let the first check settle: B still open → no child
  assert.equal(children.length, 0)
  assert.equal((await reqOf(root, reqId)).status, 'in_progress')
  await confirm(root, reqId, b, hooks)
  await waitFor(() => children.length === 1)
  assert.ok(children[0].prompt.includes('交付摘要'))
  children[0].resolve(childReply({ summary: '两个任务均完成', cancelImpact: '' }))
  await waitFor(async () => (await status(reqId))?.status === 'done')
  const req = await reqOf(root, reqId)
  assert.equal(req.status, 'pending')
  assert.equal(req.deliverySummary, '两个任务均完成')
})

test('delivery prompt includes actual command output and forbids invented results or no-limit claims', async t => {
  const root = await makeRoot(t)
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  t.after(() => { Date.now = realNow })
  const { children, hooks, status } = setup(t, root)
  const reqId = await devReq(root)
  const { data: { id } } = await store.createIssue(root, reqId, '任务')
  await store.updateIssue(root, reqId, id, { acceptance: 'a' })
  const at = new Date(now + 1000).toISOString()
  await store.appendObjectiveSync(root, reqId, id, { sid: 'test', entries: [
    { seq: 1, line: `- 执行命令：node -e "greet(' 小明 ')"（结果 ok，会话 test 第 1 条，${at}）\n  输出：${JSON.stringify('你好， 小明 ！\n')}` },
  ] })
  now += 2000
  await store.updateIssue(root, reqId, id, { resultSummary: '已核对函数结果', evidence: '实际命令输出已保存' })
  await confirm(root, reqId, id, hooks)
  await waitFor(() => children.length === 1)
  assert.match(children[0].prompt, /你好， 小明 ！/)
  assert.match(children[0].prompt, /只有实际输入和对应输出都在记录中时/)
  assert.match(children[0].prompt, /limitsRecorded 为 false 时只能写“本轮未记录限制”/)
  const facts = JSON.parse(children[0].prompt.match(/\n```json\n([\s\S]*?)\n```/)[1])
  assert.equal(facts.tasks[0].limitsRecorded, false)
  children[0].resolve(childReply({ summary: '本轮未记录限制；带空格名字的实际输出保留空格。' }))
  await waitFor(async () => (await status(reqId))?.status === 'done')
})

test('a structured object in place of a delivery summary is never shown as completed prose', async t => {
  const root = await makeRoot(t)
  const { children, hooks, status } = setup(t, root)
  const reqId = await devReq(root)
  const task = await fullIssue(root, reqId)
  await confirm(root, reqId, task, hooks)
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({ summary: { conclusion: '已处理' }, cancelImpact: '' }))
  await waitFor(async () => (await status(reqId))?.status === 'failed')

  const req = await reqOf(root, reqId)
  assert.equal(req.status, 'in_progress')
  assert.equal(req.issues[0].status, 'done')
  assert.equal(req.deliverySummary, '')
})

test('a cancelled task blocks automatic and manual submission until it passes acceptance', async t => {
  const root = await makeRoot(t)
  const { children, delivery, hooks, status } = setup(t, root)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  await confirm(root, reqId, a, hooks)
  await dispatch('issue/move', { root, reqId, id: b, to: 'cancelled', reason: '本轮不做' }, new AbortController().signal, {}, hooks)
  await delivery.maybeSubmit(root, reqId)
  const res = await dispatch('requirement/submit', { root, id: reqId, summary: '人工摘要', cancelImpact: '范围变更', expectFingerprint: store.deliveryFingerprint(await reqOf(root, reqId)) }, new AbortController().signal)
  assert.equal(res.code, 'TASKS_NOT_ACCEPTED')
  assert.equal(children.length, 0)
  assert.equal((await reqOf(root, reqId)).status, 'in_progress')
  await store.moveIssue(root, reqId, b, 'todo', { reason: '恢复任务' })
  await store.updateIssue(root, reqId, b, { resultSummary: 'B 已完成', evidence: 'B 已验证' })
  await confirm(root, reqId, b, hooks)
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({ summary: 'A 和 B 已验收' }))
  await waitFor(async () => (await status(reqId))?.status === 'done')
})

test('no summary when conditions fail: no tasks, all cancelled, open tasks, pendingReopen', async t => {
  const root = await makeRoot(t)
  const { children, delivery } = setup(t, root)
  const empty = await devReq(root, '无任务')
  await delivery.maybeSubmit(root, empty)
  const cancelled = await devReq(root, '全取消')
  const c1 = await fullIssue(root, cancelled, 'C')
  await store.moveIssue(root, cancelled, c1, 'cancelled', { reason: '不做' })
  await delivery.maybeSubmit(root, cancelled)
  const open = await devReq(root, '未终结')
  await fullIssue(root, open, 'D')
  await delivery.maybeSubmit(root, open)
  assert.equal(children.length, 0)
  // pendingReopen blocks even when every task is terminal with fresh results.
  const req = { status: 'in_progress', pendingReopen: { items: [] }, deliveryStartedAt: 0, issues: [{ status: 'done', resultSummary: 'r', evidence: 'e', resultAt: 1, evidenceAt: 1 }] }
  assert.equal(taskConditions(req), false)
  assert.equal(taskConditions({ ...req, pendingReopen: null }), true)
})

test('one summary at a time per requirement; already pending is not re-organized', async t => {
  const root = await makeRoot(t)
  const { children, delivery, hooks, status } = setup(t, root)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  await confirm(root, reqId, a, hooks)
  await waitFor(() => children.length === 1)
  await delivery.maybeSubmit(root, reqId) // still running → no second child
  await delivery.maybeSubmit(root, reqId)
  assert.equal(children.length, 1)
  children[0].resolve(childReply({ summary: 's', cancelImpact: '' }))
  await waitFor(async () => (await status(reqId))?.status === 'done')
  await delivery.maybeSubmit(root, reqId) // pending now → no child
  assert.equal(children.length, 1)
})

test('a workspace path and its symlink share an in-flight summary and its retry', async t => {
  const root = await makeRoot(t)
  const alias = join(await makeRoot(t), 'workspace-alias')
  await symlink(root, alias, 'dir')
  const { children, delivery, hooks, status } = setup(t, root)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  assert.equal((await confirm(root, reqId, a, hooks)).ok, true)
  await waitFor(() => children.length === 1)

  await store.moveIssue(alias, reqId, a, 'todo', { reason: '补充新的结果' })
  await store.updateIssue(alias, reqId, a, { resultSummary: '新结果', evidence: '新依据' })
  assert.equal((await confirm(alias, reqId, a, hooks)).ok, true)
  await delivery.maybeSubmit(alias, reqId)
  const aliasStatus = async () => (await delivery.routes['delivery/status']({ root: alias, reqId })).job
  assert.equal((await aliasStatus()).childId, (await status(reqId)).childId)
  assert.equal(children.length, 1)

  children[0].resolve(childReply({ summary: '旧摘要' }))
  await waitFor(() => children.length === 2)
  assert.match(children[1].prompt, /新结果/)
  children[1].resolve(childReply({ summary: '新摘要' }))
  await waitFor(async () => (await aliasStatus())?.status === 'done')
  const req = await reqOf(root, reqId)
  assert.equal(req.status, 'pending')
  assert.equal(req.deliverySummary, '新摘要')
})

test('a task reopened while the summary drafts wins: no submission', async t => {
  const root = await makeRoot(t)
  const { children, hooks, status } = setup(t, root)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  await confirm(root, reqId, a, hooks)
  await waitFor(() => children.length === 1)
  await store.moveIssue(root, reqId, a, 'todo', { reason: '还要改' })
  children[0].resolve(childReply({ summary: 's', cancelImpact: '' }))
  await waitFor(async () => (await status(reqId))?.status === 'skipped')
  assert.equal((await reqOf(root, reqId)).status, 'in_progress')
})

test('model failure keeps development and the manual path; old results after reopen do not auto-submit', async t => {
  const root = await makeRoot(t)
  const { children, delivery, hooks, status } = setup(t, root)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  await confirm(root, reqId, a, hooks)
  await confirm(root, reqId, b, hooks)
  await waitFor(() => children.length === 1)
  children[0].resolve({ stopReason: 'error', output: [], diagnostic: 'model unavailable' })
  await waitFor(async () => (await status(reqId))?.status === 'failed')
  const req = await reqOf(root, reqId)
  assert.equal(req.status, 'in_progress')
  assert.equal(req.issues[0].status, 'done') // task results are not lost
  assert.ok((await status(reqId)).error.includes('model unavailable'))
  // Manual summary + submit works without the model.
  assert.ok((await dispatch('requirement/submit', { root, id: reqId, summary: '人工补摘要', expectFingerprint: store.deliveryFingerprint(await reqOf(root, reqId)) }, new AbortController().signal)).ok)
  assert.equal((await reqOf(root, reqId)).status, 'pending')
  // Reopen: the old done task's result predates the new delivery round → no auto child.
  await store.reopenRequirement(root, reqId, { reason: '打回', reopen: [a] })
  await store.updateIssue(root, reqId, a, { resultSummary: 'r2', evidence: 'e2' })
  await store.moveIssue(root, reqId, a, 'done', { fileHash: await issueFileHash(root, reqId, a) })
  // A NEW result for the new round satisfies conditions again (explicit check here;
  // in production the terminal write's hook is the only trigger).
  await delivery.maybeSubmit(root, reqId)
  await waitFor(() => children.length === 2)
  const dataBlock = children[1].prompt.match(/\n```json\n([\s\S]*?)\n```/)
  assert.ok(dataBlock, 'the model receives a separate facts block')
  const { tasks } = JSON.parse(dataBlock[1])
  assert.equal(tasks.find(task => task.title === 'A').currentResult, true)
  assert.equal(tasks.find(task => task.title === 'B').currentResult, false)
  children[1].resolve(childReply({ summary: '第二轮', cancelImpact: '' }))
  await waitFor(async () => (await reqOf(root, reqId)).status === 'pending')
  assert.equal((await reqOf(root, reqId)).deliverySummary, '第二轮')
})

test('reopened delivery summary uses only this round’s manual and system evidence', async t => {
  const root = await makeRoot(t)
  const { children, hooks, status } = setup(t, root)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const previousOnly = await fullIssue(root, reqId, '其他旧任务')
  await store.updateIssue(root, reqId, id, { resultSummary: '旧结果', evidence: '上一轮人工依据' })
  const firstRound = (await reqOf(root, reqId)).issues.find(issue => issue.id === id).deliveryStartedAt
  const oldAt = new Date(firstRound + 1).toISOString()
  await store.appendObjectiveSync(root, reqId, id, { sid: 'old', entries: [
    { seq: 1, line: `- 执行命令：old-test（结果 exit:0，会话 old 第 1 条，${oldAt}）` },
    { seq: 2, line: '- 执行命令：old-undated（结果 exit:0，会话 old 第 2 条）' },
  ] })
  await store.appendObjectiveSync(root, reqId, previousOnly, { sid: 'legacy', entries: [
    { seq: 1, line: '- 执行命令：other-old-undated（结果 exit:0，会话 legacy 第 1 条）' },
  ] })
  await confirm(root, reqId, id, hooks)
  await confirm(root, reqId, previousOnly, hooks)
  await waitFor(() => children.length === 1)
  const facts = (child, title = '任务') => JSON.parse(child.prompt.match(/\n```json\n([\s\S]*?)\n```/)[1]).tasks.find(task => task.title === title)
  assert.equal(facts(children[0]).evidence, '上一轮人工依据')
  children[0].resolve(childReply({ summary: '上一轮' }))
  await waitFor(async () => (await status(reqId))?.status === 'done')

  await store.reopenRequirement(root, reqId, { reason: '再次核验', reopen: [id] })
  await store.recordRunStart(root, reqId, id)
  const since = (await reqOf(root, reqId)).issues.find(issue => issue.id === id).deliveryStartedAt
  const newAt = new Date(since + 1).toISOString()
  const realNow = Date.now
  Date.now = () => Math.max(realNow(), since + 2)
  t.after(() => { Date.now = realNow })
  await store.appendObjectiveSync(root, reqId, id, { sid: 'new', entries: [
    { seq: 1, line: `- 执行命令：new-test（结果 exit:0，会话 new 第 1 条，${newAt}）` },
  ] })
  const failedCheck = (await store.createIssue(root, reqId, '保留失败记录的任务')).data.id
  await store.recordRunStart(root, reqId, failedCheck)
  const checkedSince = (await reqOf(root, reqId)).issues.find(issue => issue.id === failedCheck).deliveryStartedAt
  await store.appendObjectiveSync(root, reqId, failedCheck, { sid: 'first-check', entries: [
    { seq: 1, line: `- 执行命令：failed-test（结果 exit:1，会话 first-check 第 1 条，${new Date(checkedSince + 1).toISOString()}）` },
  ] })
  await store.updateIssue(root, reqId, failedCheck, { resultSummary: '本轮人工复核完成', evidence: '人工复核依据' })
  await confirm(root, reqId, failedCheck, hooks)
  await store.updateIssue(root, reqId, id, { resultSummary: '本轮第一项' }, { actor: 'ai' })
  await store.submitIssueResult(root, reqId, id, { summary: '本轮第一项\n\n[AI 补充] 本轮第二项' })
  await confirm(root, reqId, id, hooks)
  await waitFor(() => children.length === 2)
  const task = facts(children[1])
  assert.equal(task.currentResult, true)
  assert.equal(task.resultSummary, '本轮第一项\n\n本轮第二项')
  assert.equal(task.unverifiedResultContext, '')
  assert.equal(task.evidence, '')
  assert.match(task.objective, /new-test/)
  assert.doesNotMatch(task.objective, /old-test/)
  assert.doesNotMatch(task.objective, /old-undated/)
  assert.equal(task.verification.hasManualEvidence, false)
  const oldTask = facts(children[1], '其他旧任务')
  assert.equal(oldTask.currentResult, false)
  assert.equal(oldTask.resultSummary, '')
  assert.equal(oldTask.evidence, '')
  assert.equal(oldTask.objective, '')
  assert.equal(oldTask.verification.passed, 0)
  assert.equal(oldTask.verification.hasManualEvidence, false)
  assert.equal(oldTask.knownLimits, '')
  const checkedTask = facts(children[1], '保留失败记录的任务')
  assert.equal(checkedTask.currentResult, true)
  assert.equal(checkedTask.resultSummary, '本轮人工复核完成')
  assert.equal(checkedTask.verification.failed, 1)
  assert.match(checkedTask.objective, /failed-test/)
  assert.match(children[1].prompt, /失败或未完成检查仍是本轮事实/)
  assert.match(children[1].prompt, /activity.*历史.*不能.*本轮.*验证/)
  const issue = (await reqOf(root, reqId)).issues.find(item => item.id === id)
  assert.equal(issue.evidence, '上一轮人工依据')
  assert.match(issue.objective, /old-test/)
  children[1].resolve(childReply({ summary: '本轮' }))
  await waitFor(async () => (await status(reqId))?.status === 'done')
})

test('a stale done task from the previous round does not trigger a summary', async t => {
  const root = await makeRoot(t)
  const { children, delivery } = setup(t, root)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  await store.moveIssue(root, reqId, a, 'done', { fileHash: await issueFileHash(root, reqId, a) })
  await store.moveIssue(root, reqId, b, 'done', { fileHash: await issueFileHash(root, reqId, b) })
  // Confirming the last task auto-drafts the first-round summary; let it settle.
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({ summary: '第一轮', cancelImpact: '' }))
  await waitFor(async () => (await reqOf(root, reqId)).status === 'pending')
  // Reopen only B; A stays done with its OLD result.
  await store.reopenRequirement(root, reqId, { reason: '打回', reopen: [b] })
  const before = children.length
  const file = join(root, '.project', 'requirements', reqId, 'issues', `${b}.md`)
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: todo', 'status: done'))
  await delivery.maybeSubmit(root, reqId)
  await new Promise(r => setTimeout(r, 30))
  assert.equal(children.length, before) // A's result predates this round; no fresh delivery
  assert.equal((await reqOf(root, reqId)).status, 'in_progress')
})
