// Stage-3 §3.5: requirement organize / task split produce preview proposals via
// a read-only child of the project's own session; adoption is the human decision.
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installAssist } from '../core/assist.js'
import { adoptProposal, listProposals, markDismissed } from '../core/proposals.js'
import * as store from '../core/store.js'
import { makeRoot, seedAIReview, stubSpawnHost, childReply, waitFor, seedReviewPrd } from './util.js'

async function reqIn(root, status, title = '需求') {
  await store.initProject(root)
  const { data } = await store.createRequirement(root, title)
  if (status === 'backlog') return data.id
  await store.updateRequirement(root, data.id, { goal: 'g', scope: 's', acceptance: 'a' })
  await seedReviewPrd(root, data.id)
  await store.moveRequirement(root, data.id, 'reviewing')
  if (status === 'reviewing') return data.id
  await seedAIReview(root, data.id)
  await store.moveRequirement(root, data.id, 'ready')
  if (status === 'ready') return data.id
  await store.moveRequirement(root, data.id, 'in_progress')
  return data.id
}
const reqOf = async (root, id) => (await store.scanProject(root)).requirements.find(r => r.id === id)

function setup(t, root) {
  const { ctx, agents, children } = stubSpawnHost(root)
  const assist = installAssist(ctx, { readOnlyChildren: new Set() })
  return { ctx, agents, children, assist }
}

test('organize drafts a preview; the requirement changes only on adoption', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'backlog')
  const pending = assist.routes['requirement/organize']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({ q_pain: '用户留空时需要提示。' }))
  const res = await pending
  assert.equal(res.proposalIds.length, 1)
  const before = await reqOf(root, reqId)
  assert.equal(before.q_pain, '') // unchanged before adoption
  const [proposal] = await listProposals(root)
  assert.equal(proposal.kind, 'req_draft')
  assert.equal(proposal.status, 'pending')
  assert.ok(proposal.baseHash) // captured for the late-edit conflict check
  await adoptProposal(root, proposal.id)
  const after = await reqOf(root, reqId)
  assert.equal(after.q_pain, '用户留空时需要提示。')
  assert.equal(after.goal, '')
  assert.equal(after.scope, '')
  assert.equal(after.acceptance, '')
  assert.equal(after.status, 'backlog') // adoption never sends to review
})

test('a partial draft keeps missing facts blank and explains what the user can add', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'backlog')
  await store.updateRequirement(root, reqId, { scope: '只处理名字为空的情况' })
  const pending = assist.routes['requirement/organize']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({ q_pain: ' ', goal: '', scope: ' ', acceptance: '空名字显示提示' }))
  await pending

  const [proposal] = await listProposals(root)
  assert.equal(proposal.reason, '请补充需求概述。')
  assert.deepEqual(proposal.suggested_patch, { acceptance: '空名字显示提示' })
  await adoptProposal(root, proposal.id)
  const req = await reqOf(root, reqId)
  assert.equal(req.scope, '只处理名字为空的情况')
  assert.equal(req.q_pain, '')
  assert.equal(req.acceptance, '空名字显示提示')
})

test('a human edit before adoption makes the draft conflict, not overwrite', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'backlog')
  const pending = assist.routes['requirement/organize']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({ goal: 'AI 目标', scope: 'AI 范围', acceptance: 'AI 标准' }))
  await pending
  await store.updateRequirement(root, reqId, { goal: '人工先改了目标' })
  const [proposal] = await listProposals(root)
  await assert.rejects(adoptProposal(root, proposal.id), e => e.code === 'CONFLICT')
  assert.equal((await reqOf(root, reqId)).goal, '人工先改了目标')
  // The proposal stays pending so the user can dismiss or re-run organize.
  assert.equal((await listProposals(root))[0].status, 'pending')
})

test('organizing again after a human edit can produce the same draft on the new version', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'backlog')
  const draft = { goal: 'AI 目标', scope: 'AI 范围', acceptance: 'AI 标准' }
  async function organize(callCount) {
    const pending = assist.routes['requirement/organize']({ root, id: reqId })
    await waitFor(() => children.length === callCount)
    children[callCount - 1].resolve(childReply(draft))
    return pending
  }

  const { proposalIds: [oldId] } = await organize(1)
  await store.updateRequirement(root, reqId, { q_who: '人工补充的使用人' })
  await assert.rejects(adoptProposal(root, oldId), e => e.code === 'CONFLICT')

  const { proposalIds: [newId] } = await organize(2)
  assert.ok(newId)
  assert.notEqual(newId, oldId)
  assert.deepEqual(await organize(3), { proposalIds: [], skipped: 1 })
  await adoptProposal(root, newId)
  assert.equal((await adoptProposal(root, newId)).data.alreadyAdopted, true)
  const requirement = await reqOf(root, reqId)
  assert.equal(requirement.goal, draft.goal)
  assert.equal(requirement.q_who, '人工补充的使用人')
})

test('organize is limited to the pool; split to development', async t => {
  const root = await makeRoot(t)
  const { assist } = setup(t, root)
  const dev = await reqIn(root, 'in_progress')
  await assert.rejects(assist.routes['requirement/organize']({ root, id: dev }), e => e.code === 'INVALID_STATE')
  const pool = await reqIn(root, 'backlog', '池中需求')
  await assert.rejects(assist.routes['requirement/split']({ root, id: pool }), e => e.code === 'REQ_NOT_ACTIVE')
})

test('split checks the actual project, returns an existing task, and drafts only a separate gap', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'backlog', '修复问候并补终端入口')
  await store.updateRequirement(root, reqId, { q_pain: '空名字没有提示，终端无法发起问候', q_out: '账户系统', acceptance: '空名字提示填写\n终端可发起问候' })
  await seedAIReview(root, reqId)
  for (const status of ['reviewing', 'ready', 'in_progress']) await store.moveRequirement(root, reqId, status)
  const { data: existing } = await store.createIssue(root, reqId, '修复空名字', { problemOverview: '处理空名字', acceptance: '空名字提示填写' })
  await store.addIssueUpdate(root, reqId, existing.id, '空字符串已支持，全空格仍缺提示。')
  await writeFile(join(root, 'README.md'), '当前只支持从库函数发起问候。\n')
  const pending = assist.routes['requirement/split']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  assert.match(children[0].prompt, /账户系统/)
  assert.match(children[0].prompt, /空字符串已支持，全空格仍缺提示/)
  const reply = { items: [
    { id: 'r1', status: 'gap', detail: '全空格仍缺提示' },
    { id: 'r2', status: 'gap', detail: '没有终端入口', sources: [{ path: 'README.md', quote: '当前只支持从库函数发起问候。' }] },
  ], tasks: [
    { requirementIds: ['r1'], title: '处理无名输入', whySeparate: '重复任务' },
    { requirementIds: ['r2'], title: '增加账户系统', whySeparate: '越界任务' },
    { requirementIds: ['r2'], title: '实现终端入口', whySeparate: '与现有库函数修复是独立交付', triggerPath: '凭空写入的入口' },
  ] }
  children[0].resolve(childReply(reply))
  const res = await pending
  assert.equal(res.proposalIds.length, 1)
  assert.deepEqual(res.review.items.map(item => item.status), ['assigned', 'gap'])
  assert.deepEqual(res.review.items[0].taskIds, [existing.id])
  assert.equal(res.review.items[1].sources[0].path, 'README.md')
  assert.equal((await reqOf(root, reqId)).issues.length, 1)

  const retryInput = { root, id: reqId, feedback: '标题再短一点', priorProposalIds: res.proposalIds }
  const failedRedraft = assist.routes['requirement/split'](retryInput)
  await waitFor(() => children.length === 2)
  children[1].resolve(childReply({ tasks: [] }))
  await assert.rejects(failedRedraft, { code: 'ASSIST_FAILED' })
  assert.deepEqual((await listProposals(root)).filter(p => p.status === 'pending').map(p => p.id), res.proposalIds)

  const again = assist.routes['requirement/split'](retryInput)
  await waitFor(() => children.length === 3)
  assert.match(children[2].prompt, /标题再短一点/)
  assert.match(children[2].prompt, /实现终端入口/)
  children[2].resolve(childReply(reply))
  const [proposalId] = (await again).proposalIds
  assert.notEqual(proposalId, res.proposalIds[0])
  assert.equal((await listProposals(root)).filter(p => p.status === 'pending').length, 1)
  await adoptProposal(root, proposalId, { title: '添加本地终端问候' }, { reqId })
  const req = await reqOf(root, reqId)
  assert.equal(req.issues.length, 2)
  assert.deepEqual(req.issues.map(i => i.status), ['todo', 'todo'])
  const added = req.issues.find(i => i.title === '添加本地终端问候')
  assert.equal(added.acceptance, '终端可发起问候')
  assert.equal(added.triggerPath, '')
})

test('split preserves an independent gap even when it cites a partially covering task', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'backlog', '空白和非字符串输入都应安全')
  await store.updateRequirement(root, reqId, { q_pain: '空白名字需要提示，其他类型也不能让函数崩溃', acceptance: '空白名字有提示\n非字符串输入不抛出异常' })
  await seedAIReview(root, reqId)
  for (const status of ['reviewing', 'ready', 'in_progress']) await store.moveRequirement(root, reqId, status)
  const { data: existing } = await store.createIssue(root, reqId, '只核对空白名字', { problemOverview: '只核对现有空白行为，不修改代码', acceptance: '空白名字有提示' })
  await writeFile(join(root, 'demo.mjs'), "export function greet(name) {\n  if (!name.trim()) return '请填写名字'\n}\n")
  await writeFile(join(root, 'demo.test.mjs'), "test('正常名字保留问候', () => {})\n")
  const pending = assist.routes['requirement/split']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({
    items: [
      { id: 'r1', status: 'gap', detail: '空白部分由原任务负责，非字符串是独立缺口。', taskIds: [existing.id], sources: [{ path: 'demo.mjs', quote: "if (!name.trim()) return '请填写名字'" }] },
      { id: 'r2', status: 'gap', detail: '现有测试没有非字符串用例。', sources: [{ path: 'demo.test.mjs', quote: "test('正常名字保留问候', () => {})" }] },
    ],
    question: '',
    tasks: [{ requirementIds: ['r1', 'r2'], title: '为非字符串输入增加防护和测试', whySeparate: '原任务只核对空白行为且明确不改代码，无法承接类型防护。' }],
  }))
  const res = await pending
  assert.deepEqual(res.review.items.map(item => item.status), ['gap', 'gap'])
  assert.doesNotMatch(res.review.items[0].detail, /可在原任务补齐|无需新增任务/)
  assert.equal(res.proposalIds.length, 1)
  const [proposal] = await listProposals(root)
  assert.equal(proposal.suggested_patch.title, '为非字符串输入增加防护和测试')
  assert.equal((await reqOf(root, reqId)).issues.length, 1)
})

test('split does not promote old task checks or limits after requirement re-review', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const originalNow = Date.now
  let now = 1794900000000
  Date.now = () => now
  t.after(() => { Date.now = originalNow })

  const reqId = await reqIn(root, 'in_progress')
  const { data: task } = await store.createIssue(root, reqId, '检查行为', { problemOverview: '核对行为', acceptance: 'a' })
  const { data: other } = await store.createIssue(root, reqId, '另一个检查', { problemOverview: '额外检查', acceptance: '其他标准' })
  await store.updateIssue(root, reqId, task.id, { knownLimits: '旧轮未验证窄屏' })
  now += 1000
  await store.appendObjectiveSync(root, reqId, task.id, { sid: 'test', entries: [{ seq: 1,
    line: `- 执行命令：node --test old.test.mjs（结果 ok，测试结论 passed，测试摘要 # fail 0，会话 test 第 1 条，${new Date(now).toISOString()}）` }] })

  now += 1000
  await store.updateRequirement(root, reqId, { goal: '修改后的目标' }, { confirmReviewInvalid: true, reason: '重新评审目标' })
  await seedAIReview(root, reqId)
  for (const status of ['reviewing', 'ready', 'in_progress']) await store.moveRequirement(root, reqId, status)
  now += 1000
  await store.appendObjectiveSync(root, reqId, task.id, { sid: 'test', entries: [{ seq: 2,
    line: `- 改动文件：example.mjs（write，会话 test 第 2 条，${new Date(now).toISOString()}）` }] })
  now += 1000
  const current = (await reqOf(root, reqId)).issues.find(issue => issue.id === task.id)
  await store.updateIssue(root, reqId, task.id, { resultSummary: '本轮已修改示例', evidence: '' }, { fileHash: current.hash, recordResult: true })
  const recorded = (await reqOf(root, reqId)).issues.find(issue => issue.id === task.id)
  await store.confirmIssue(root, reqId, task.id, { fileHash: recorded.hash })
  now += 1000
  await store.appendObjectiveSync(root, reqId, other.id, { sid: 'test', entries: [{ seq: 3,
    line: `- 执行命令：node --test current.test.mjs（结果 ok，测试结论 passed，测试摘要 # fail 0，会话 test 第 3 条，${new Date(now).toISOString()}）` }] })
  now += 1000
  const otherCurrent = (await reqOf(root, reqId)).issues.find(issue => issue.id === other.id)
  await store.updateIssue(root, reqId, other.id, { resultSummary: '本轮验证通过', evidence: '' }, { fileHash: otherCurrent.hash, recordResult: true })
  const otherRecorded = (await reqOf(root, reqId)).issues.find(issue => issue.id === other.id)
  await store.confirmIssue(root, reqId, other.id, { fileHash: otherRecorded.hash })

  const pending = assist.routes['requirement/split']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  const payload = JSON.parse(children[0].prompt.match(/数据：\n```json\n([\s\S]*?)\n```/)[1])
  const fact = payload.tasks.find(issue => issue.id === task.id)
  assert.equal(fact.verified, false)
  assert.equal(fact.verification.passed, 0)
  assert.equal(fact.limits, '')
  assert.equal(fact.unverifiedKnownLimits, '旧轮未验证窄屏')
  const otherFact = payload.tasks.find(issue => issue.id === other.id)
  assert.equal(otherFact.verification.passed, 1)
  assert.equal(otherFact.verified, true)
  children[0].resolve(childReply({ items: [{ id: 'r1', status: 'verified', taskIds: [task.id], detail: '称已验证' }], tasks: [] }))
  const result = await pending
  assert.equal(result.review.items[0].status, 'assigned')
})

test('split distinguishes empty results and unverified claims from generation failures', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'in_progress')
  const { data: task } = await store.createIssue(root, reqId, '任务', { problemOverview: '概述' })
  const pending = assist.routes['requirement/split']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({ items: [{ id: 'r1', status: 'verified', taskIds: [task.id], detail: '假称已验证' }], question: '', tasks: [] }))
  const res = await pending
  assert.equal(res.review.items[0].status, 'assigned')
  assert.doesNotMatch(res.review.items[0].detail, /假称/)
  assert.deepEqual(res.proposalIds, [])
})

test('split cannot publish a new task based on an invented file excerpt', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'in_progress')
  await writeFile(join(root, 'README.md'), '现有处理方式。')
  const pending = assist.routes['requirement/split']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({ items: [{ id: 'r1', status: 'gap', detail: '不存在现有处理方式',
    sources: [{ path: 'README.md', quote: '这个项目还没有处理方式' }] }],
  tasks: [{ requirementIds: ['r1'], title: '添加处理方式', whySeparate: '尚未实现' }] }))
  const result = await pending
  assert.equal(result.review.items[0].status, 'unknown')
  assert.deepEqual(result.proposalIds, [])
  assert.equal((await reqOf(root, reqId)).issues.length, 0)
})

test('split excludes each item in a multi-part scope exclusion', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'backlog')
  await store.updateRequirement(root, reqId, {
    q_pain: '空名字没有提示',
    goal: '空名字时提醒用户填写',
    scope: '只处理示例问候函数，不增加账户、网络服务或其他页面',
    acceptance: '空名字显示填写提示',
  })
  await seedAIReview(root, reqId)
  for (const status of ['reviewing', 'ready', 'in_progress']) await store.moveRequirement(root, reqId, status)
  await writeFile(join(root, 'README.md'), '目前空名字不会给出填写提示。')
  const pending = assist.routes['requirement/split']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  children[0].resolve(childReply({
    items: [{ id: 'r1', status: 'gap', detail: '缺少提示', sources: [{ path: 'README.md', quote: '目前空名字不会给出填写提示。' }] }],
    tasks: [{ requirementIds: ['r1'], title: '增加网络服务', whySeparate: '独立实现' }],
  }))
  const result = await pending
  assert.deepEqual(result.proposalIds, [])
  assert.equal((await listProposals(root)).length, 0)
})

test('split uses a session of THIS project; none live prepares one there', async t => {
  const root = await makeRoot(t)
  const otherRoot = await makeRoot(t)
  const { ctx, agents, children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'in_progress')
  // A live session of ANOTHER project must not be borrowed.
  const foreign = await ctx.sessionController.create({ cwd: otherRoot })
  void foreign
  const pending = assist.routes['requirement/split']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  const parent = agents.get(children[0].parentId)
  assert.equal(parent.session.header.cwd, root) // prepared in the right project
  children[0].resolve(childReply({ items: [], tasks: [] }))
  await pending
  // An explicit session of another project is refused (no child spawned).
  await assert.rejects(assist.routes['requirement/split']({ root, id: reqId, sessionId: foreign.sessionId }), e => e.code === 'SESSION_NOT_LIVE')
  assert.equal(children.length, 1)
})

test('content edited while the child drafts is reported stale', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'backlog')
  const pending = assist.routes['requirement/organize']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  await store.updateRequirement(root, reqId, { goal: '期间人工修改' })
  children[0].resolve(childReply({ goal: 'AI 目标', scope: 's', acceptance: 'a' }))
  await assert.rejects(pending, e => e.code === 'ASSIST_STALE')
  assert.equal((await listProposals(root)).length, 0) // no stale proposal saved
})

test('model failure surfaces a reason and writes nothing', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'backlog')
  const pending = assist.routes['requirement/organize']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  children[0].resolve({ stopReason: 'error', output: [], diagnostic: 'model unavailable' })
  await assert.rejects(pending, e => e.code === 'ASSIST_FAILED' && e.message.includes('model unavailable'))
  assert.equal((await listProposals(root)).length, 0)
  assert.equal((await reqOf(root, reqId)).goal, '')
})

test('issue field draft can be dismissed, regenerated and adopted without starting the task', async t => {
  const root = await makeRoot(t)
  const { children, assist } = setup(t, root)
  const reqId = await reqIn(root, 'in_progress')
  const { data } = await store.createIssue(root, reqId, '只填标题的任务')
  const draft = { problemOverview: '空名字仍显示空问候，用户不知道要填写。', triggerPath: '调用 greet 时传入空字符串或全空格。', acceptance: '两种空名字都显示填写提示，正常名字保留问候。' }
  async function generate(count) {
    const pending = assist.routes['issue/draft']({ root, reqId, id: data.id })
    await waitFor(() => children.length === count)
    children[count - 1].resolve(childReply(draft))
    return pending
  }

  const first = await generate(1)
  assert.match(children[0].name, /^[a-z][a-z0-9-]{0,31}$/)
  const [oldProposal] = await listProposals(root)
  assert.equal(first.proposalIds[0], oldProposal.id)
  assert.equal(oldProposal.kind, 'field_draft')
  assert.ok(oldProposal.baseHash)
  await markDismissed(root, oldProposal.id)
  let issue = (await reqOf(root, reqId)).issues[0]
  assert.equal(issue.problemOverview, '')
  assert.equal(issue.status, 'todo')

  // Discarding is not a 24h ban on asking for the same missing-field draft again.
  const second = await generate(2)
  assert.notEqual(second.proposalIds[0], oldProposal.id)
  await adoptProposal(root, second.proposalIds[0], { acceptance: '两种空名字显示提示；正常名字不变；保留验证结果。' })
  issue = (await reqOf(root, reqId)).issues[0]
  assert.equal(issue.problemOverview, draft.problemOverview)
  assert.equal(issue.triggerPath, draft.triggerPath)
  assert.equal(issue.acceptance, '两种空名字显示提示；正常名字不变；保留验证结果。')
  assert.equal(issue.status, 'todo') // adoption saves fields only; it never submits work
})
