// Stage-3 formal AI tools (tech §5): session-derived task identity, shared
// store guards, human-content preservation, draft/propose previews, sync-before
// submit, and the current-task dynamic context. Stub Host; real store + files.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installLinks } from '../core/link.js'
import { installTools } from '../core/tools.js'
import * as store from '../core/store.js'
import { adoptProposal, listProposals } from '../core/proposals.js'
import { makeRoot, seedAIReview, issueFileHash, seedReviewPrd, startTestDevelopment } from './util.js'

function stubCtx() {
  const agents = new Map()
  const tools = new Map()
  const contexts = new Map()
  let created = 0
  const ctx = {
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    on() { return () => {} },
    tools: { guard: () => () => {}, register: def => { tools.set(def.name, def); return () => {} } },
    systemPrompt: { context: def => { contexts.set(def.name, def); return () => {} } },
    agents: { get: sid => agents.get(sid), list: () => [...agents.values()] },
    sessions: { get: sid => agents.get(sid)?.session },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      create: async ({ cwd } = {}) => {
        const sessionId = `session-stub-${++created}`
        agents.set(sessionId, { session: { id: sessionId, header: { cwd }, seq: 0, snapshotEvents: () => [] }, status: 'idle' })
        return { sessionId }
      },
      prompt: async () => ({ accepted: true }),
      cancel: async () => ({ accepted: true }),
    },
    logger: { warn: () => {} },
  }
  return { ctx, agents, tools, contexts }
}

async function devReq(root, title = '需求') {
  await store.initProject(root)
  const { data } = await store.createRequirement(root, title)
  await store.updateRequirement(root, data.id, { goal: 'g', scope: 's', acceptance: 'a' })
  await seedReviewPrd(root, data.id)
  await store.moveRequirement(root, data.id, 'reviewing')
  await seedAIReview(root, data.id)
  await store.moveRequirement(root, data.id, 'ready')
  await startTestDevelopment(root, data.id)
  return data.id
}
async function fullIssue(root, reqId, title = '任务') {
  const { data } = await store.createIssue(root, reqId, title)
  await store.updateIssue(root, reqId, data.id, { problemOverview: 'p', triggerPath: 't', acceptance: '三个场景通过' })
  return data.id
}
const issueOf = async (root, reqId, id) => (await store.scanProject(root)).requirements.find(r => r.id === reqId).issues.find(i => i.id === id)
const bashEvents = (sid, seq, time, command) => [
  { seq, time, type: 'tool/call', data: { turn: 1, step: 1, callId: `c${seq}`, name: 'bash', arguments: JSON.stringify({ command }) } },
  { seq: seq + 1, time: time + 1, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: `c${seq}`, content: [{ type: 'text', text: /(?:^|\s)--test(?:\s|$)/.test(command) ? '# tests 1\n# pass 1\n# fail 0\n[exit code: 0]' : 'ok\n[exit code: 0]' }] } } },
]

async function setup(t, { link = true } = {}) {
  const root = await makeRoot(t)
  const { ctx, agents, tools, contexts } = stubCtx()
  const links = installLinks(ctx)
  installTools(ctx, links)
  const reqId = await devReq(root)
  const issueId = await fullIssue(root, reqId)
  let agent = null
  if (link) {
    const located = await links.locate(root, issueId)
    agent = agents.get(located.sessionId)
  } else {
    const created = await ctx.sessionController.create({ cwd: root })
    agent = agents.get(created.sessionId)
  }
  const exec = { agent }
  const call = (name, args = {}) => tools.get(name).execute(args, exec)
  return { root, reqId, issueId, agent, exec, call, tools, contexts, links, ctx }
}

test('no link: reads explain, writes refuse; identity always comes from the session', async t => {
  const { call } = await setup(t, { link: false })
  assert.equal(await call('workbench_task_get'), '当前会话未关联任务')
  assert.equal(await call('workbench_req_get'), '当前会话未关联任务')
  // No-link writes explain rather than error (tech §5.2).
  assert.equal(await call('workbench_task_note', { text: 'x' }), '当前会话未关联任务')
  assert.equal(await call('workbench_task_submit', { summary: 'x' }), '当前会话未关联任务')
})

test('the AI toolset has no human-only actions', async t => {
  const { tools } = await setup(t)
  for (const name of ['workbench_task_get', 'workbench_task_update', 'workbench_task_draft', 'workbench_task_note', 'workbench_task_start', 'workbench_task_block', 'workbench_task_submit', 'workbench_task_propose', 'workbench_req_get']) {
    assert.ok(tools.has(name), `${name} registered`)
  }
  for (const name of ['workbench_task_confirm', 'workbench_task_cancel', 'workbench_task_reopen', 'workbench_req_review', 'workbench_req_accept', 'workbench_req_start_dev']) {
    assert.ok(!tools.has(name), `${name} must not exist`)
  }
})

test('task_get returns the six info fields, status and result; req_get the requirement', async t => {
  const { root, reqId, issueId, call } = await setup(t)
  await store.updateIssue(root, reqId, issueId, { rootCause: '待分析' })
  const got = JSON.parse(await call('workbench_task_get'))
  assert.equal(got.title, '任务')
  assert.equal(got.status, '待处理')
  assert.equal(got.problemOverview, 'p')
  assert.equal(got.triggerPath, 't')
  assert.equal(got.acceptance, '三个场景通过')
  assert.equal(got.requirement, '需求')
  const req = JSON.parse(await call('workbench_req_get'))
  assert.equal(req.overview, 'g')
  assert.equal(req.goal, 'g')
  assert.equal(req.scope, 's')
})

test('task_update replaces the root-cause placeholder but preserves human content', async t => {
  const { root, reqId, issueId, call } = await setup(t)
  await store.updateIssue(root, reqId, issueId, { rootCause: '待分析' })
  assert.equal(await call('workbench_task_update', { field: 'rootCause', text: '空名字未判断' }), '已记录')
  assert.equal((await issueOf(root, reqId, issueId)).rootCause, '空名字未判断')
  // Human edits the cause; the AI must append, not overwrite.
  await store.updateIssue(root, reqId, issueId, { rootCause: '人工结论：缺少空值判断' })
  const msg = await call('workbench_task_update', { field: 'rootCause', text: '补充：全空格同样未处理' })
  assert.ok(msg.includes('保留原有内容'))
  const cause = (await issueOf(root, reqId, issueId)).rootCause
  assert.ok(cause.includes('人工结论：缺少空值判断'))
  assert.ok(cause.includes('[AI 补充] 补充：全空格同样未处理'))
  // The three draft-only fields are not writable here.
  await assert.rejects(call('workbench_task_update', { field: 'acceptance', text: '降低标准' }), e => e.code === 'INVALID_FIELD')
})

test('task_update rejects a stale read when a human saves a new root cause', async t => {
  const { root, reqId, issueId, call, ctx, links } = await setup(t)
  const read = Promise.withResolvers()
  const proceed = Promise.withResolvers()
  installTools(ctx, { ...links, async issueOf(...args) {
    const snapshot = await links.issueOf(...args)
    read.resolve()
    await proceed.promise
    return snapshot
  } })
  const rejected = assert.rejects(call('workbench_task_update', { field: 'rootCause', text: 'AI 补充' }), { code: 'CONFLICT' })
  await read.promise
  try {
    await store.updateIssue(root, reqId, issueId, { rootCause: '人工调查结果' })
  } finally {
    proceed.resolve()
  }
  await rejected
  assert.equal((await issueOf(root, reqId, issueId)).rootCause, '人工调查结果')
})

test('task_draft writes a pending proposal; formal fields change only on adoption', async t => {
  const { root, reqId, issueId, call } = await setup(t)
  await store.updateIssue(root, reqId, issueId, { problemOverview: '' })
  const msg = await call('workbench_task_draft', { field: 'problemOverview', text: '草稿：空名字无提示' })
  assert.ok(msg.includes('待采用'))
  assert.equal((await issueOf(root, reqId, issueId)).problemOverview, '') // unchanged before adoption
  const [proposal] = await listProposals(root)
  assert.equal(proposal.kind, 'field_draft')
  assert.equal(proposal.status, 'pending')
  assert.deepEqual(proposal.suggested_patch, { problemOverview: '草稿：空名字无提示' })
  assert.ok(proposal.evidence[0].startsWith('draft://')) // source marker, not fabricated execution evidence
  await adoptProposal(root, proposal.id)
  assert.equal((await issueOf(root, reqId, issueId)).problemOverview, '草稿：空名字无提示')
  const again = await adoptProposal(root, proposal.id)
  assert.ok(again.data.alreadyAdopted) // repeated adoption does not re-apply
})

test('task_start needs execution facts; records start and blocked recovery', async t => {
  const { root, reqId, issueId, agent, call } = await setup(t)
  await assert.rejects(call('workbench_task_start'), e => e.code === 'NO_ACTIVITY')
  // Pure chat (a user message with no task activity) is NOT a start fact.
  agent.session.snapshotEvents = () => [{ seq: 1, time: Date.now(), type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '聊点别的' }] } }]
  await assert.rejects(call('workbench_task_start'), e => e.code === 'NO_ACTIVITY')
  const now = Date.now()
  agent.session.snapshotEvents = () => [
    { seq: 1, time: now, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: now, type: 'user/message', data: { source: { kind: 'user', rpcId: 'ordinary-chat' } } },
    ...bashEvents(agent.session.id, 3, now, 'cat unrelated.md'),
    { seq: 5, time: now, type: 'tool/call', data: { turn: 1, callId: 'start', name: 'workbench_task_start', arguments: '{}' } },
  ]
  await assert.rejects(call('workbench_task_start'), { code: 'NO_ACTIVITY' })
  assert.equal((await issueOf(root, reqId, issueId)).status, 'todo')
  // Actual engineering activity in this session is a start fact.
  agent.session.snapshotEvents = () => bashEvents(agent.session.id, 2, Date.now(), 'node --test demo.test.mjs')
  assert.equal(await call('workbench_task_start'), '已记录开始处理')
  assert.equal((await issueOf(root, reqId, issueId)).status, 'doing')
  assert.equal(await call('workbench_task_start'), '任务已在处理中') // idempotent
  await call('workbench_task_block', { reason: '缺少接口文档' })
  const blocked = await issueOf(root, reqId, issueId)
  assert.equal(blocked.status, 'blocked')
  const [attempt, failure] = bashEvents(agent.session.id, 6, blocked.blockedAt + 1, 'node --test demo.test.mjs')
  failure.data.message.content = [{ type: 'text', text: '[exit code: 1]' }]
  agent.session.snapshotEvents = () => [attempt, failure]
  await assert.rejects(call('workbench_task_start'), { code: 'NO_ACTIVITY' })
  assert.equal((await issueOf(root, reqId, issueId)).blocked_reason, '缺少接口文档')
  agent.session.snapshotEvents = () => bashEvents(agent.session.id, 8, blocked.blockedAt + 2, 'node --test demo.test.mjs')
  assert.equal(await call('workbench_task_start'), '已记录开始处理') // recovery
  assert.equal((await issueOf(root, reqId, issueId)).status, 'doing')
})

test('task_block requires a specific reason', async t => {
  const { call } = await setup(t)
  await assert.rejects(call('workbench_task_block', { reason: '  ' }), e => e.code === 'BLOCKED_REASON_REQUIRED')
})

test('task_submit syncs objective evidence first, then enters in_review', async t => {
  const { root, reqId, issueId, agent, call } = await setup(t)
  await store.recordRunStart(root, reqId, issueId)
  const now = Date.now()
  const events = [
    { seq: 1, time: now, type: 'turn/start', data: { turn: 1 } },
    ...bashEvents(agent.session.id, 2, now + 1, 'node --test demo.test.mjs'),
    { seq: 4, time: now + 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 5
  const msg = await call('workbench_task_submit', { summary: '修复空名字提示', limits: '仅覆盖示例函数' })
  assert.ok(msg.includes('待验收'))
  const issue = await issueOf(root, reqId, issueId)
  assert.equal(issue.status, 'in_review')
  assert.equal(issue.resultSummary, '修复空名字提示')
  assert.equal(issue.knownLimits, '仅覆盖示例函数')
  assert.ok(issue.hasObjective) // evidence came from the session log, not AI self-report
  const doc = await readFile(join(root, '.project', 'requirements', reqId, 'issues', `${issueId}.md`), 'utf8')
  assert.ok(doc.includes('执行命令：node --test demo.test.mjs'))
  // Submitting again while in_review is a no-op, not an invalidation.
  assert.ok((await call('workbench_task_submit', { summary: '再次提交' })).includes('已处于待验收'))
  await assert.rejects(call('workbench_task_update', { field: 'resultSummary', text: '修改待确认结果' }), { code: 'HUMAN_ONLY' })
  assert.equal((await issueOf(root, reqId, issueId)).status, 'in_review')
})

test('a reopened task keeps old limits as history and preserves new limits written before AI submission', async t => {
  const { root, reqId, issueId, agent, call } = await setup(t)
  await store.updateIssue(root, reqId, issueId, { resultSummary: '上一轮结果', evidence: '上一轮依据', knownLimits: '旧限制' })
  await store.confirmIssue(root, reqId, issueId, { fileHash: await issueFileHash(root, reqId, issueId) })
  await store.submitRequirement(root, reqId, { summary: '上一轮交付' })
  await store.reopenRequirement(root, reqId, { reason: '补充核验', reopen: [issueId] })
  await store.recordRunStart(root, reqId, issueId)
  const start = (await issueOf(root, reqId, issueId)).deliveryStartedAt
  const events = bashEvents(agent.session.id, 2, start + 1, 'node --test demo.test.mjs')
  agent.session.snapshotEvents = (from = 0) => events.filter(event => event.seq >= from)
  agent.session.seq = 4
  const old = JSON.parse(await call('workbench_task_get'))
  assert.equal(old.resultSummary, '')
  assert.equal(old.unverifiedResultContext, '上一轮结果')
  assert.equal(old.knownLimits, '')
  assert.equal(old.unverifiedKnownLimits, '旧限制')
  await call('workbench_task_update', { field: 'resultSummary', text: '本轮先记' })
  await call('workbench_task_update', { field: 'resultSummary', text: '本轮补充结果' })
  await call('workbench_task_update', { field: 'knownLimits', text: '本轮限制' })
  let issue = await issueOf(root, reqId, issueId)
  assert.match(issue.resultSummary, /本轮先记[\s\S]*本轮补充结果/)
  assert.doesNotMatch(issue.resultSummary, /上一轮结果/)
  assert.equal(issue.resultScopeAt, start)
  assert.ok(issue.activity.some(entry => entry.includes('上一轮结果')))
  assert.equal(issue.knownLimits, '本轮限制')
  assert.ok(issue.knownLimitsAt >= start)
  assert.ok(issue.activity.some(entry => entry.includes('旧限制')))
  await call('workbench_task_update', { field: 'knownLimits', text: '本轮补充' })
  issue = await issueOf(root, reqId, issueId)
  assert.match(issue.knownLimits, /本轮限制[\s\S]*本轮补充/)
  await call('workbench_task_submit', { summary: '本轮结果', limits: '本轮额外限制' })
  issue = await issueOf(root, reqId, issueId)
  assert.equal(issue.status, 'in_review')
  assert.match(issue.resultSummary, /本轮先记[\s\S]*本轮补充结果[\s\S]*本轮结果/)
  assert.doesNotMatch(issue.resultSummary, /上一轮结果/)
  assert.match(issue.knownLimits, /本轮限制[\s\S]*本轮补充[\s\S]*本轮额外限制/)
  assert.doesNotMatch(issue.knownLimits, /旧限制/)
  assert.equal(issue.activity.filter(entry => entry.includes('旧限制')).length, 1)
})

test('task_submit without evidence or acceptance refuses and keeps doing', async t => {
  const { root, reqId, issueId, call } = await setup(t)
  await store.recordRunStart(root, reqId, issueId)
  await assert.rejects(call('workbench_task_submit', { summary: '完成了' }), e => e.code === 'RESULT_EVIDENCE_REQUIRED')
  assert.equal((await issueOf(root, reqId, issueId)).status, 'doing')
})

test('after continue-modify, old evidence alone cannot resubmit; new verification can', async t => {
  const { root, reqId, issueId, agent, call } = await setup(t)
  await store.recordRunStart(root, reqId, issueId)
  const t0 = Date.now()
  let events = [
    { seq: 1, time: t0, type: 'turn/start', data: { turn: 1 } },
    ...bashEvents(agent.session.id, 2, t0 + 1, 'node --test demo.test.mjs'),
    { seq: 4, time: t0 + 2, type: 'turn/end', data: { turn: 1 } },
  ]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 5
  await call('workbench_task_submit', { summary: '第一轮结果' })
  const feedback = '请补充全空格场景\n增加一条回归测试'
  await store.continueIssue(root, reqId, issueId, { text: feedback })
  for (const note of ['补充记录一', '补充记录二', '补充记录三']) await store.addIssueUpdate(root, reqId, issueId, note)
  const returned = JSON.parse(await call('workbench_task_get'))
  assert.equal(returned.reworkReason, feedback)
  assert.ok(!returned.recent.some(entry => entry.includes(feedback)))
  const since = (await issueOf(root, reqId, issueId)).deliveryStartedAt
  // Only OLD evidence arrives after the reset → stale.
  events = [...events, ...bashEvents(agent.session.id, 5, since - 1000, 'echo old-check')]
  agent.session.seq = 8
  await assert.rejects(call('workbench_task_submit', { summary: '沿用旧依据' }), e => e.code === 'RESULT_STALE')
  // Fresh verification after the delivery start → accepted.
  events = [...events, ...bashEvents(agent.session.id, 7, Date.now() + 1000, 'node --test demo.test.mjs')]
  agent.session.seq = 10
  await call('workbench_task_submit', { summary: '第二轮结果' })
  assert.equal((await issueOf(root, reqId, issueId)).status, 'in_review')
  assert.equal(JSON.parse(await call('workbench_task_get')).reworkReason, undefined)
})

test('task_propose previews never change formal objects; adoption is the human decision', async t => {
  const { root, reqId, issueId, call } = await setup(t)
  await call('workbench_task_propose', { kind: 'new_task', text: '补充使用说明' })
  await call('workbench_task_propose', { kind: 'cancel', text: '本轮不做' })
  await call('workbench_task_propose', { kind: 'scope', text: '范围补充：仅处理 greet 函数' })
  await call('workbench_task_propose', { kind: 'acceptance', text: '更严格的标准' })
  const proposals = await listProposals(root)
  assert.equal(proposals.length, 4)
  assert.equal((await store.scanProject(root)).requirements[0].issues.length, 1) // no task created
  assert.equal((await issueOf(root, reqId, issueId)).status, 'todo') // not cancelled
  assert.equal((await issueOf(root, reqId, issueId)).acceptance, '三个场景通过') // not lowered
  const byKind = Object.fromEntries(proposals.map(p => [p.kind === 'task_suggestion' ? p.suggested_patch.action : p.kind, p]))
  await assert.rejects(adoptProposal(root, byKind.new_task.id), { code: 'MISSING_TASK_FIELDS' })
  await adoptProposal(root, byKind.new_task.id, { problemOverview: '添加一个输入和输出示例。' })
  await adoptProposal(root, byKind.field_draft.id) // before scope: a field draft conflicts if the task changed since drafting
  await adoptProposal(root, byKind.scope.id)
  await adoptProposal(root, byKind.cancel.id) // cancel last: terminal tasks are read-only afterwards
  const req = (await store.scanProject(root)).requirements[0]
  assert.equal(req.issues.length, 2)
  assert.equal(req.issues.find(i => i.title === '补充使用说明').status, 'todo') // adopted tasks do not auto-start
  const main = req.issues.find(i => i.id === issueId)
  assert.equal(main.status, 'cancelled')
  assert.ok(main.description.includes('范围补充：仅处理 greet 函数'))
  assert.equal(main.acceptance, '更严格的标准')
})

test('writes are refused when the requirement left development or the task is terminal', async t => {
  const { root, reqId, issueId, call } = await setup(t)
  await store.updateIssue(root, reqId, issueId, { resultSummary: 'r', evidence: 'e' })
  await store.moveIssue(root, reqId, issueId, 'done', { fileHash: await issueFileHash(root, reqId, issueId) })
  await assert.rejects(call('workbench_task_note', { text: 'x' }), e => e.code === 'TERMINAL_READ_ONLY')
  await store.submitRequirement(root, reqId, { summary: 's' })
  await assert.rejects(call('workbench_task_note', { text: 'x' }), e => e.code === 'REQ_NOT_ACTIVE')
})

test('a requirement returned to the pool refuses AI writes', async t => {
  const { root, reqId, call } = await setup(t)
  await store.updateRequirement(root, reqId, { goal: '调整后的目标' }, { confirmReviewInvalid: true, reason: '目标调整' })
  assert.equal((await store.scanProject(root)).requirements[0].status, 'backlog')
  await assert.rejects(call('workbench_task_note', { text: 'x' }), e => e.code === 'REQ_NOT_ACTIVE')
})

test('dynamic context renders the linked task and is empty without a link', async t => {
  const { root, agent, contexts } = await setup(t)
  const provider = contexts.get('project-workbench:task')
  assert.ok(provider)
  const text = provider.text({ agent })
  assert.ok(text.includes('当前工作台任务：任务'))
  assert.ok(text.includes('关联需求：需求'))
  assert.ok(text.includes('完成标准：三个场景通过'))
  assert.ok(text.includes('workbench_task_submit'))
  assert.ok(text.length <= 300)
  // An unlinked session contributes nothing.
  const other = { session: { id: 'session-unlinked', header: { cwd: root } } }
  assert.equal(provider.text({ agent: other }), '')
  assert.equal(provider.text({}), '')
})
