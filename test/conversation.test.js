import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'
import { discoveryQuestionText } from '../core/discovery-qa.js'
import { discoverySkillMarker, discoverySkillName } from '../core/skill.js'
import { readInvocation } from '../core/conversation-commands.js'
import * as store from '../core/store.js'
import { childReply, makeRoot, saveReviewPrd, seedAIReview, stubSpawnHost, waitFor, startTestDevelopment } from './util.js'

async function setup(t) {
  const root = await makeRoot(t)
  const { ctx, agents, children } = stubSpawnHost(root)
  const hooks = new Map(), commands = new Map(), tools = new Map(), fetches = new Map(), contexts = new Map()
  const prompts = []
  let mode = 'workspace-write'
  ctx.sandboxPolicy.resolve = () => ({ mode })
  ctx.skills = { register: () => () => {} }
  ctx.mcpManager = { register: () => () => {} }
  ctx.on = (name, fn) => {
    if (!hooks.has(name)) hooks.set(name, [])
    hooks.get(name).push(fn)
    return () => {}
  }
  ctx.effect = fn => {
    const value = fn()
    if (typeof value?.next === 'function') for (const _ of value) { /* synchronous Host registrations */ }
  }
  ctx.commands = { register: def => { commands.set(def.name, def); return () => commands.delete(def.name) } }
  ctx.inject = (_, fn) => fn(ctx)
  ctx.systemPrompt.context = def => { contexts.set(def.name, def) }
  ctx.tools.register = (def, options) => { tools.set(def.name, { ...def, when: options?.when }); return () => {} }
  ctx.connection = { fetch: { register: ({ path, fetch }) => { fetches.set(path, fetch); return () => {} } } }
  ctx.sessionController.prompt = async req => { prompts.push(req); return { accepted: true } }
  await apply(ctx)

  const createAgent = async cwd => {
    const { sessionId } = await ctx.sessionController.create({ cwd })
    const agent = agents.get(sessionId)
    const events = []
    agent.session.snapshotEvents = () => events
    const emit = (type, data = {}) => {
      const event = { type, data, time: Date.now(), seq: events.length + 1 }
      events.push(event)
      for (const fn of hooks.get('session/event') ?? []) fn(agent.session, event)
    }
    let turn = 0
    const begin = (text, rpcId = 'input-' + ++turn) => {
      if (!turn) turn++
      emit('turn/start', { turn })
      const message = { source: { kind: 'user', rpcId }, content: [{ type: 'text', text }] }
      for (const fn of hooks.get('agent/inbox/claimed') ?? []) fn({ agent, message, turn })
      return message
    }
    const direct = message => (hooks.get('agent/pre-step') ?? []).at(-1)({
      agent, messages: [message], signal: new AbortController().signal,
    }, () => ({ kind: 'enter', messages: [message] }))
    const end = () => emit('turn/end', { turn, reason: { kind: 'completed' } })
    const use = tools.get('workbench_conversation')
    const tool = async (action, args) => JSON.parse(await use.execute({ action, ...args }, { agent }))
    const available = () => use.when({ agent })
    const command = (name, rawInput = '', commandId = 'command-' + name) => commands.get('pwb-' + name).handler({ agent, rawInput, commandId })
    const view = async () => (await rpc('conversation/view', { sessionId })).data.cards
    const act = (card, action, extra) => rpc('conversation/act', { sessionId, cardId: card.id, action, ...extra })
    return { agent, sessionId, emit, begin, direct, end, tool, available, command, view, act }
  }
  const post = async (path, body) => (await fetches.get('/api/project-workbench' + path)(
    new Request('http://local', { method: 'POST', body: JSON.stringify(body) }),
  )).json()
  const rpc = (method, input) => post('', { method, input })
  const a = await createAgent(root)
  return { ...a, root, ctx, agents, children, commands, prompts, post, rpc, createAgent, setMode: value => { mode = value }, contexts }
}

test('native commands and @ syntax preserve ordinary chat and use one Host prompt', async t => {
  const p = await setup(t)
  assert.deepEqual([...p.commands.keys()].sort(), [
    'pwb-architecture-update', 'pwb-help', 'pwb-prd', 'pwb-requirement', 'pwb-status', 'pwb-task', 'pwb-update', 'pwb-wiki-update',
  ])
  assert.match((await p.command('help')).text, /\/pwb-prd/)
  assert.match((await p.command('help')).text, /\/pwb-update/)
  assert.equal((await p.command('status')).kind, 'error')
  assert.equal((await p.command('requirement', '新建本地 AI 聊天网页')).kind, 'success')
  assert.equal(p.prompts.length, 1)
  assert.equal(p.prompts[0].sessionId, p.sessionId)
  assert.equal(p.prompts[0].content[0].text, '/pwb-requirement 新建本地 AI 聊天网页')
  assert.equal(p.available(), false)
  p.begin('普通聊天，不提工作台')
  assert.equal(p.available(), false)
  assert.equal(readInvocation('提到 @workbench 的普通句子'), null)
  assert.equal(readInvocation('@workbench-other'), null)
  await writeFile(join(p.root, 'workbench'), 'workspace file')
  p.begin('@workbench 这个文件')
  assert.equal(p.available(), false)
  p.begin('@workbench: 帮我记一个需求')
  assert.equal(p.available(), true)
})

test('new project conversation follows up on one draft, survives retry and respects read-only and workspace ownership', async t => {
  const p = await setup(t)
  await store.initProject(p.root, { name: 'A' })
  const other = await makeRoot(t)
  await store.initProject(other, { name: 'B' })
  const b = await p.createAgent(other)
  const fields = { title: '本地 AI 聊天网页', overview: '与不同风格的 AI 对话' }
  p.begin('@workbench 帮我记一个本地 AI 聊天网页', 'original')
  assert.equal(p.available(), true)
  const draft = await p.tool('addRequirement', { fields, root: other })
  const again = await p.tool('addRequirement', { fields })
  assert.equal(again.id, draft.id)
  assert.equal(again.reused, true)
  assert.equal((await p.view())[0].root, p.root)
  p.end()
  p.begin('同一个 AI，做温柔和毒舌两种')
  assert.equal(p.available(), true)
  await p.tool('editRequirement', { fields: { scope: '温柔和毒舌' } })
  p.end()
  p.begin('面向个人用户')
  assert.equal(p.available(), true)
  await p.tool('editRequirement', { fields: { audience: '个人用户' } })
  const index = await store.scanProject(p.root)
  assert.equal(index.requirements.length, 1)
  assert.equal(index.requirements[0].scope, '温柔和毒舌')
  assert.equal(index.requirements[0].q_who, '个人用户')
  assert.equal((await store.scanProject(other)).requirements.length, 0)
  b.begin('/pwb-requirement 补充 A 的需求')
  await assert.rejects(b.tool('editRequirement', { reqId: draft.id, fields: { scope: '越界' } }), { code: 'REQ_REQUIRED' })
  p.end()
  p.begin('先别记')
  assert.equal(p.available(), false)
  p.begin('@workbench 先讨论，别保存')
  await assert.rejects(p.tool('addRequirement', { fields }), { code: 'READ_ONLY' })
  p.begin('@workbench 新建另一个需求')
  p.setMode('read-only')
  await assert.rejects(p.tool('addRequirement', { fields }), { code: 'READ_ONLY' })
  p.setMode('workspace-write')
  p.emit('plan/mode', { active: true })
  await assert.rejects(p.tool('addRequirement', { fields }), { code: 'PLAN_ACTIVE' })
  p.emit('plan/mode', { active: false })
  p.emit('approval/asked', { id: 'permission' })
  await assert.rejects(p.tool('addRequirement', { fields }), { code: 'APPROVAL_PENDING' })
})

test('pwb-update reuses the current session, records progress and decisions, and deduplicates the same request', async t => {
  const p = await setup(t)
  assert.match((await p.command('update')).text, /启用当前项目/)
  assert.equal(p.prompts.length, 0)
  await store.initProject(p.root)
  const { data: { id } } = await store.createRequirement(p.root, '通知设置', { q_pain: '控制通知', goal: '管理通知频率', scope: '站内提醒', acceptance: '可以配置通知频率' })
  const { data: { id: otherReq } } = await store.createRequirement(p.root, '别的需求', { q_pain: '无关内容' })
  await saveReviewPrd(p.root, id)
  await store.moveRequirement(p.root, id, 'reviewing')
  await seedAIReview(p.root, id)
  await store.moveRequirement(p.root, id, 'ready')
  await startTestDevelopment(p.root, id)
  const { data: { id: issueId } } = await store.createIssue(p.root, id, '设置频率', { problemOverview: '可编辑通知频率', acceptance: '用户可以切换' })
  assert.equal((await p.rpc('link/set', { root: p.root, sessionId: p.sessionId, issueId })).ok, true)
  p.begin('/pwb-requirement 补充别的需求')
  await p.tool('editRequirement', { reqId: otherReq, fields: { scope: '别的范围' } })
  p.end()
  assert.equal((await p.command('update', '', 'sync-notifications')).kind, 'success')
  assert.deepEqual(p.prompts.map(({ sessionId, content }) => [sessionId, content[0].text]), [[p.sessionId, '/pwb-update']])
  p.begin('/pwb-update', 'sync-notifications')
  const { currentTask } = await p.tool('read')
  assert.equal(currentTask.id, issueId)
  const instructions = p.contexts.get('project-workbench:conversation').text({ agent: p.agent })
  assert.match(instructions, /原决定、新决定和影响/)
  const progress = '设置页已加入通知频率。\n已确认变更：每小时提醒改为每日。\n待验证：关闭提醒后的表现。'
  const attempts = await Promise.all([
    p.tool('recordUpdate', { text: progress }),
    p.tool('recordUpdate', { text: progress.replace('设置页已加入通知频率。', '已在设置中加入频率选项。') }),
  ])
  assert.equal(attempts.filter(result => result.reused).length, 1)
  assert.equal(attempts[0].id, issueId)
  const [receipt] = await p.view()
  assert.equal(receipt.kind, 'open')
  assert.equal(receipt.issueId, issueId)
  p.end()
  p.begin('/pwb-update', 'sync-notifications')
  assert.equal((await p.tool('recordUpdate', { text: '重试也不能生成第二条进展。' })).reused, true)
  const req = (await store.scanProject(p.root)).requirements.find(item => item.id === id)
  assert.equal(req.status, 'in_progress')
  assert.equal(req.scope, '站内提醒')
  assert.equal(req.issues[0].status, 'todo')
  assert.equal(req.issues[0].activity.filter(line => line.includes('[会话同步]')).length, 1)
  assert.match(req.issues[0].activity[0], /已确认变更：每小时提醒改为每日/)
  assert.doesNotMatch(req.issues[0].activity[0], /pwb-update:/)
  assert.equal(req.activity.some(line => line.includes('[会话同步]')), false)
  p.end()
  p.begin('/pwb-update 记到通知设置需求')
  const specific = await p.tool('recordUpdate', { reqId: id, text: '已确认发布时向用户解释每日提醒。' })
  assert.equal(specific.id, id)
  assert.equal((await p.view())[0].issueId, undefined)
})

test('pwb-update needs an identified object and respects read-only and plan mode', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  const { data: { id } } = await store.createRequirement(p.root, '项目设置', { q_pain: '设置项' })
  const { data: { id: similar } } = await store.createRequirement(p.root, '项目设置移动端', { q_pain: '移动端设置' })
  p.setMode('read-only')
  assert.equal((await p.command('update')).kind, 'error')
  p.setMode('workspace-write')
  p.emit('plan/mode', { active: true })
  assert.match((await p.command('update')).text, /计划模式/)
  p.emit('plan/mode', { active: false })
  assert.equal(p.prompts.length, 0)
  p.begin('/pwb-update')
  assert.deepEqual(new Set((await p.tool('read', { query: '项目设置' })).matches.map(item => item.id)), new Set([id]))
  assert.equal((await p.tool('read', { query: '设置' })).matches.length, 2)
  await assert.rejects(p.tool('recordUpdate', { text: '归属不明' }), { code: 'REQ_REQUIRED' })
  await assert.rejects(p.tool('editRequirement', { reqId: id, fields: { scope: '自动覆盖' } }), { code: 'ACTION_NOT_AVAILABLE' })
  await p.tool('remember')
  p.end()
  p.begin('记到项目设置，不是移动端。')
  assert.equal((await p.tool('recordUpdate', { reqId: id, text: '已确认本期只做桌面端。' })).id, id)
  const index = await store.scanProject(p.root)
  assert.match(index.requirements.find(item => item.id === id).activity[0], /会话同步.*只做桌面端/)
  assert.deepEqual(index.requirements.find(item => item.id === similar).activity, [])
  p.end()
  p.begin('/pwb-update 先别同步')
  await assert.rejects(p.tool('recordUpdate', { reqId: id, text: '只讨论' }), { code: 'READ_ONLY' })
})

test('draft removal is confirmed, checked for conflicts, and restorable by name', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  const { data: { id } } = await store.createRequirement(p.root, '待移除', { q_pain: '待核对' })
  p.begin('/pwb-requirement 移除待移除')
  await p.tool('removeRequirement', { reqId: id })
  const [first] = await p.view()
  assert.equal((await store.scanProject(p.root)).requirements.length, 1)
  await store.updateRequirement(p.root, id, { goal: '后来修改' })
  assert.equal((await p.act(first, 'confirm')).code, 'CONFLICT')
  await p.tool('removeRequirement', { reqId: id })
  const [second] = await p.view()
  assert.equal((await p.act(second, 'confirm')).ok, true)
  assert.equal((await store.scanProject(p.root)).requirements.length, 0)
  const names = await p.tool('restoreRequirement')
  assert.equal(names.matches[0].id, id)
  await p.tool('restoreRequirement', { query: '待移除' })
  const [restore] = await p.view()
  assert.equal((await p.act(restore, 'confirm')).ok, true)
  assert.equal((await store.scanProject(p.root)).requirements[0].goal, '后来修改')
})

test('task actions record real results and leave final completion to the existing human endpoint', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  const { data: { id } } = await store.createRequirement(p.root, '聊天网页', { q_pain: '切换风格' })
  await store.updateRequirement(p.root, id, { goal: '完成聊天', scope: '两个风格', acceptance: '两种风格可切换' })
  await saveReviewPrd(p.root, id)
  await store.moveRequirement(p.root, id, 'reviewing')
  await seedAIReview(p.root, id)
  await store.moveRequirement(p.root, id, 'ready')
  await startTestDevelopment(p.root, id)
  p.begin('/pwb-task 新建风格切换')
  const { id: issueId } = await p.tool('addTask', { reqId: id, fields: { title: '风格切换', overview: '切换两种风格', acceptance: '两种风格可切换' } })
  assert.equal(p.prompts.length, 0)
  await p.tool('taskStart', { issueId })
  const [start] = await p.view()
  const res = await p.act(start, 'confirm')
  assert.equal(res.ok, true)
  assert.equal(p.prompts.length, 1)
  assert.equal((await p.act(start, 'confirm')).code, 'CARD_EXPIRED')
  await rm(join(p.root, '.project', '.local', 'runs', issueId + '.json'))
  await store.recordRunStart(p.root, id, issueId)
  await p.tool('taskRecord', { issueId, text: '已实现切换，验证待补。' })
  await assert.rejects(p.tool('taskSubmit', { issueId, text: '已实现切换。' }), { code: 'RESULT_EVIDENCE_REQUIRED' })
  await store.updateIssue(p.root, id, issueId, { resultSummary: '已完成手工核对', evidence: '人工试验，两种风格均可切换' },
    { recordResult: true, fileHash: (await store.taskStamp(p.root, id, issueId)).hash })
  const when = new Date(Date.now() + 2).toISOString()
  await store.appendObjectiveSync(p.root, id, issueId, { sid: 'session-verify', entries: [{
    seq: 1, line: '- 执行命令：npm test（结果 exit:1，测试结论 failed，会话 session-verify 第 1 条，' + when + '）',
  }] })
  await p.tool('taskSubmit', { issueId, text: '两种风格均可切换。' })
  const audit = await p.tool('taskReview', { issueId })
  assert.match(audit.currentEvidence, /均可切换/)
  assert.deepEqual(audit.checks, [{ command: 'npm test', outcome: 'exit:1', status: 'failed' }])
  assert.equal(audit.status, '待验收')
  await p.tool('taskConfirm', { issueId })
  const [confirm] = await p.view()
  assert.equal((await p.act(confirm, 'confirm')).code, 'ACTION_NOT_AVAILABLE')
  assert.equal((await p.act(confirm, 'openTask')).ok, true)
  assert.equal((await store.scanProject(p.root)).requirements[0].issues[0].status, 'in_review')
})

test('Wiki reports the Git preflight and architecture shares a single job with the native and panel entry', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  await writeFile(join(p.root, 'app.js'), 'export const ping = () => 42\n')
  const noGit = await p.command('wiki-update')
  assert.equal(noGit.kind, 'error')
  assert.match(noGit.text, /初始化 Git/)
  assert.equal((await p.view()).some(card => card.type === 'wiki'), false)
  await p.direct(p.begin('@workbench 更新 Wiki'))
  assert.equal((await p.view()).find(card => card.type === 'wiki').code, 'NOT_GIT')

  const start = p.command('architecture-update')
  await waitFor(() => p.children.length === 1)
  assert.match((await start).text, /生成请求已受理/)
  assert.match((await p.command('architecture-update', '查看进度')).text, /正在生成/)
  await p.direct(p.begin('@workbench 更新架构图'))
  const panel = await p.post('/arch-generate', { root: p.root, sessionId: p.sessionId })
  assert.equal(panel.data.alreadyRunning, true)
  assert.equal(p.children.length, 1)
  p.children[0].resolve({ stopReason: 'completed', output: [{ type: 'text', text: '{"arch_error":"ARCH_SOURCE_REQUIRED"}' }] })
  await waitFor(async () => (await p.view()).find(card => card.type === 'arch').code === 'ARCH_SOURCE_REQUIRED')
  const failed = (await p.view()).find(card => card.type === 'arch')
  assert.equal((await p.act(failed, 'dismiss')).ok, true)
  await p.command('architecture-update')
  assert.equal(p.children.length, 1)
  assert.equal((await p.view()).some(card => card.type === 'arch'), false)
  const retry = p.command('architecture-update', '', 'retry')
  await waitFor(() => p.children.length === 2)
  assert.equal((await retry).kind, 'success')
  assert.notEqual((await p.view()).find(card => card.type === 'arch').id, failed.id)
  p.children[1].resolve({ stopReason: 'cancelled', output: [] })
})

test('architecture layout rejection survives the repair and shows an actionable conversation status', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  await writeFile(join(p.root, 'app.js'), 'export const ping = () => 42\n')
  const candidate = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Example', output: 'architecture.html', quality_profile: 'standard' },
    layout: { mode: 'grid', cols: 1 },
    components: [{ id: 'app', type: 'frontend', label: '一个需要足够显示空间才能完整阅读的中文组件名称', row: 0, col: 0, sources: [{ path: 'app.js', line: 1 }] }],
    connections: [],
  }
  const start = p.command('architecture-update')
  await waitFor(() => p.children.length === 1)
  await start
  const reply = { stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify(candidate) }] }
  p.children[0].resolve(reply)
  await waitFor(() => p.children.length === 2)
  p.children[1].resolve(reply)
  const status = async () => (await p.post('/arch-status', { root: p.root })).data
  await waitFor(async () => (await status()).status === 'failed')
  assert.match((await status()).error, /Architecture layout validation failed/)
  assert.equal((await status()).code, 'ARCHIFY_LAYOUT_FAILED')
  const card = (await p.view()).find(card => card.type === 'arch')
  assert.equal(card.code, 'ARCHIFY_LAYOUT_FAILED')
  assert.match(card.message, /未通过布局校验/)
  const progress = (await p.command('architecture-update', '查看进度')).text
  assert.match(progress, /未通过布局校验/)
  assert.doesNotMatch(progress, /component-label-overflow|Architecture layout validation failed/)
})

async function startDiscovery(p, reqId) {
  const res = await p.rpc('discovery/open', { root: p.root, reqId })
  assert.equal(res.ok, true, JSON.stringify(res))
  const { sessionId } = res.data
  const prompt = p.prompts.find(item => item.sessionId === sessionId)
  assert.match(prompt.content[0].text, /^\/pwb-grill-me\n/)
  const events = []
  p.agents.get(sessionId).session.snapshotEvents = () => events
  const emit = (type, data) => events.push({ seq: events.length + 1, type, data })
  const content = text => [{ type: 'text', text }]
  const user = (text, source = { kind: 'user' }) => emit('user/message', { source, content: content(text) })
  const assistant = text => emit('assistant/message', { message: { content: content(text) } })
  const start = turn => emit('turn/start', { turn })
  const end = (turn, kind = 'completed') => emit('turn/end', { turn, reason: { kind } })
  return { sessionId, events, user, assistant, start, end, input: { root: p.root, reqId, sessionId }, prompt }
}

function firstQuestion(d, invoke = true) {
  d.start(1)
  d.user(d.prompt.content[0].text, { kind: 'user', rpcId: d.prompt.requestId })
  if (invoke) d.user(discoverySkillMarker, { kind: 'skill-invocation', name: discoverySkillName })
  d.assistant('需要多少种风格？')
  d.end(1)
}

test('discovery question layout preserves choice labels and leaves ambiguous text whole', () => {
  const stem = '**首版交付物**：首版交付物是哪种？'
  const named = [stem, '', '- a) 草稿', '- **b)** 考勤数据', '     包括月底统计', '- **c) 直接提交**', '- d) 仅验证流程'].join('\n')
  assert.deepEqual(discoveryQuestionText(named), { stem, choices: [
    { label: 'a)', text: '草稿' }, { label: 'b)', text: '考勤数据\n包括月底统计' },
    { label: 'c)', text: '直接提交' }, { label: 'd)', text: '仅验证流程' },
  ] })
  assert.deepEqual(discoveryQuestionText(stem + '\n\n1、仅 XLSX\n2、仅 CSV').choices.map(choice => choice.label), ['1、', '2、'])
  for (const text of [stem, stem + '\nA. XLSX 或 B. CSV', stem + '\n- a) 单项',
    stem + '\n- a) XLSX\n- b) CSV\n以上格式都需要与财务核对。',
    stem + '\n```text\na) 示例 A\nb) 示例 B\n```']) {
    assert.deepEqual(discoveryQuestionText(text), { stem: text, choices: [] })
  }
})

test('discovery panel projects numbered questions and applies confirmed answers before the AI finishes', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  const { data: { id } } = await store.createRequirement(p.root, '导出订单明细')
  const d = await startDiscovery(p, id)
  d.start(1)
  d.user(d.prompt.content[0].text, { kind: 'user', rpcId: d.prompt.requestId })
  d.user(discoverySkillMarker, { kind: 'skill-invocation', name: discoverySkillName })
  d.assistant([
    '已核对已有的范围。', '❓ **Q1** - **导哪些订单？**', '', '说明和可选范围。', '',
    '```text', 'Q99: 示例中的标签', '```', '', '➡️ 建议当前筛选。', '---',
    '### Q2：谁可以导？ ➡️ 推荐运营。', '---', 'Q3：上限是多少？', '---', 'Q4：怎么提示超限？', '---', '要继续问吗？',
  ].join('\n'))
  const panel = async () => {
    const res = await p.rpc('discovery/session', d.input)
    assert.equal(res.ok, true, JSON.stringify(res))
    return res.data
  }
  assert.deepEqual((await panel()).questions, [])
  d.end(1)
  const first = (await panel()).questions
  assert.deepEqual(first.map(row => row.number), [1, 2, 3, 4])
  assert.match(first[0].question, /说明和可选范围。\n\n```text\nQ99: 示例/)
  assert.doesNotMatch(first[0].question, /建议当前筛选/)
  assert.equal(first[1].question, '谁可以导？')
  assert.equal(first[3].question, '怎么提示超限？')
  assert.ok(first.every(row => row.answered === false))
  assert.deepEqual(Object.keys(first[0]), ['id', 'number', 'round', 'question', 'answered'])
  d.start(2)
  d.user('Q1：当前筛选\n包括已退款订单；**A2**：运营主管')
  d.assistant('Q99：没有完成的提问？')
  assert.deepEqual((await panel()).questions.map(row => row.answered), [true, true, false, false])
  d.end(2, 'error')
  assert.deepEqual((await panel()).questions.map(row => row.answered), [true, true, false, false])
  d.start(3)
  d.user('Q3 和 Q4 合在一起考虑，暂时保留。')
  d.assistant('保留待定。\n\n❓ **Q1** - 要记录操作时间吗？\n---\nQ4：审计记录保留多久？')
  d.end(3)
  d.start(4)
  d.user('第1题：记录操作时间\nQ3：首版一万条')
  d.assistant('建议写入审计日志。\n\nQ8：首版只提供中文表头吗？')
  d.end(4)
  d.start(5)
  d.user('Q2：')
  d.user('可以。')
  d.end(5)
  d.start(6)
  d.user('Q4：保留一年，但两个旧轮次均有这道题。')
  d.assistant('Q9：报表需要覆盖全部月份吗？')
  d.end(6)
  d.start(7)
  d.user('只覆盖上个月。')
  const rows = (await panel()).questions
  assert.deepEqual(rows.map(row => row.answered), [true, true, true, false, true, false, false, true])
  assert.deepEqual(rows.map(row => [row.round, row.number]), [[1, 1], [1, 2], [1, 3], [1, 4], [2, 1], [2, 4], [3, 8], [4, 9]])
  assert.equal(rows[0].id, first[0].id)
  assert.notEqual(rows[0].id, rows[4].id)
})

test('organizing discovery waits for the native turn and preserves legacy wrap-up history', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  const { data: { id } } = await store.createRequirement(p.root, '导出订单明细')
  const d = await startDiscovery(p, id)
  const prepare = extra => p.rpc('discovery/prepare', { ...d.input, ...extra })
  assert.equal((await prepare()).code, 'DISCOVERY_SKILL_REQUIRED')
  d.start(1)
  d.user(d.prompt.content[0].text, { kind: 'user', rpcId: d.prompt.requestId })
  d.user(discoverySkillMarker, { kind: 'skill-invocation', name: discoverySkillName })
  d.assistant('Q1：需要多少种风格？')
  d.end(1)
  assert.equal((await prepare({ sessionId: 'another-session' })).code, 'WORKSPACE_MISMATCH')
  p.agents.get(d.sessionId).status = 'running'
  assert.equal((await prepare()).code, 'SESSION_BUSY')
  p.agents.get(d.sessionId).status = 'idle'
  d.start(2)
  d.user('确认想法，结束头脑风暴。', { kind: 'user', rpcId: 'pwb-discovery-finish-legacy' })
  d.assistant('建议仍待定。\nQ7：模型误把提问放到了收尾回复？')
  const panel = async () => (await p.rpc('discovery/session', d.input)).data
  d.end(2)
  assert.equal((await panel()).questions.length, 1)
  assert.equal((await panel()).questions[0].answered, false)
  assert.equal((await prepare()).code, 'DISCOVERY_ROUND_REQUIRED')
  d.start(3)
  d.user('Q1：首版保留两种风格。')
  d.assistant('建议默认简洁。')
  d.end(3)
  assert.equal((await panel()).questions[0].answered, true)
  assert.equal((await replyToChild(p, prepare(), { ready: true, round: [] })).code, 'DISCOVERY_AI_FAILED')
  const pending = prepare()
  await waitFor(() => p.children.length === 2)
  assert.equal((await prepare()).code, 'DISCOVERY_BUSY')
  const child = p.children.at(-1)
  const transcript = JSON.parse(child.prompt.split('\n').at(-1))
  const round = ['Q1：需要多少种风格？', 'Q1：首版保留两种风格。', '建议默认简洁。']
    .map(text => transcript.find(message => message.text === text).seq)
  child.resolve(childReply({ ready: true, round, markdown: '## 已确认结论\n保留两种风格。' }))
  assert.equal((await pending).ok, true)
  assert.equal(p.prompts.length, 1)
})

async function replyToChild(p, pending, doc) {
  const index = p.children.length
  await waitFor(() => p.children.length > index)
  const child = p.children[index]
  child.resolve(childReply(typeof doc === 'function' ? doc(child.prompt) : doc))
  return pending
}

async function prepareRound(p, d, turn, question, answer, suggestion) {
  d.start(turn)
  d.user(answer)
  d.assistant(suggestion)
  d.end(turn)
  const excerpts = [question, answer, suggestion]
  const res = await replyToChild(p, p.rpc('discovery/prepare', d.input), prompt => {
    const transcript = JSON.parse(prompt.split('\n').at(-1))
    const round = excerpts.map(text => transcript.find(message => message.text === text)?.seq)
    assert.ok(round.every(Number.isSafeInteger))
    return { ready: true, round, markdown: '## 已确认结论\n' + answer + '\n\n## 深化建议\n' + suggestion }
  })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.deepEqual(res.data.round, excerpts.map(quote => d.events.find(event =>
    (event.data.content ?? event.data.message?.content)?.[0]?.text === quote).seq))
  return res.data
}

async function saveDiscovery(p, reqId) {
  const d = await startDiscovery(p, reqId)
  firstQuestion(d)
  const preview = await prepareRound(p, d, 2, '需要多少种风格？', '需要两种', '建议使用简洁和详细两种表达风格。')
  const saved = await p.rpc('discovery/save', { ...d.input, ...preview })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return d
}

function preparationReply(p, sessionId, markdown) {
  const requestId = p.prompts.findLast(prompt => prompt.sessionId === sessionId).requestId
  const session = p.agents.get(sessionId).session
  const events = session.snapshotEvents().slice()
  const add = (type, data) => events.push({ seq: events.length + 1, type, data })
  add('turn/start', { turn: requestId })
  add('user/message', { source: { kind: 'user', rpcId: requestId } })
  add('assistant/message', { message: { content: [{ type: 'text', text: '~~~workbench-prd\n' + markdown + '\n~~~' }] } })
  add('turn/end', { turn: requestId, reason: { kind: 'completed' } })
  session.snapshotEvents = () => events
}

test('PRD command hands off to its preparation session and preserves multi-requirement links and version conflicts', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  const id = (await store.createRequirement(p.root, '聊天', { q_pain: '两种风格' })).data.id
  const second = (await store.createRequirement(p.root, '设置', { q_pain: '选择默认风格' })).data.id
  p.begin('/pwb-prd 从聊天和设置写首版 PRD')
  await assert.rejects(p.tool('prdCreate', { reqIds: [id, second] }), { code: 'DISCOVERY_REQUIRED' })
  await assert.rejects(p.tool('prdPreview', { reqIds: [id], markdown: '# 绕过门槛' }), { code: 'DISCOVERY_REQUIRED' })
  await saveDiscovery(p, id)
  await assert.rejects(p.tool('prdCreate', { reqIds: [id, second] }), { code: 'DISCOVERY_REQUIRED' })
  await saveDiscovery(p, second)

  const sessionsBefore = p.agents.size
  await p.tool('prdCreate', { reqIds: [id, second], text: '检查模型是否离线可用' })
  assert.equal(p.agents.size, sessionsBefore)
  const [launch] = await p.view()
  const opened = await p.act(launch, 'openPreparation')
  assert.equal(opened.ok, true, JSON.stringify(opened))
  const { sessionId } = opened.data
  assert.notEqual(sessionId, p.sessionId)
  assert.match(p.prompts.at(-1).content[0].text, /检查模型是否离线可用/)
  preparationReply(p, sessionId, '# 聊天首版\n\n模型是否离线')
  const preview = async () => (await p.rpc('preparation/session', { root: p.root, sessionId, preview: true })).data.draft
  const save = (draft, markdown) => p.rpc('preparation/save', { root: p.root, sessionId, draftId: draft.id, markdown })
  assert.deepEqual((await p.rpc('prd/list', { root: p.root, reqId: id })).data, [])
  const created = await save(await preview(), '# 聊天首版\n\n离线可用性待定')
  assert.equal(created.ok, true, JSON.stringify(created))
  const prdId = created.data.id
  assert.deepEqual((await p.rpc('prd/list', { root: p.root, reqId: second })).data[0].reqIds, [id, second])
  const read = async () => (await p.rpc('prd/read', { root: p.root, id: prdId })).data
  const original = await read()
  assert.deepEqual(original.discoverySources, [{ reqId: id, version: 1 }, { reqId: second, version: 1 }])

  p.begin('/pwb-prd 更新已有 PRD')
  await p.tool('prdPreview', { prdId, version: original.version, text: '调整离线说明' })
  assert.equal((await p.act((await p.view())[0], 'openPreparation')).data.sessionId, sessionId)
  preparationReply(p, sessionId, '# 新草稿\n\n更新离线说明')
  const filename = join(p.root, '.project', 'prds', prdId + '.md')
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('离线可用性待定', '手工补充的阅读说明'))
  assert.equal((await save(await preview())).code, 'PRD_CONFLICT')
  assert.match(await readFile(filename, 'utf8'), /手工补充/)
  await p.tool('prdPreview', { prdId, version: (await read()).version, text: '保留手工输入' })
  assert.equal((await p.act((await p.view())[0], 'openPreparation')).data.sessionId, sessionId)
  preparationReply(p, sessionId, '# 新草稿\n\n保留人工补充的阅读说明')
  assert.equal((await save(await preview())).ok, true)
  const latest = await read()
  assert.equal(latest.revision, 2)
  assert.deepEqual(latest.discoverySources, original.discoverySources)
  assert.match(latest.markdown, /保留人工补充的阅读说明/)
})

test('discovery reopens the same session, saves independent editions and checks project and phase', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  const { id } = (await store.createRequirement(p.root, '导出订单', { q_pain: '月底需要对账' })).data
  const { id: otherId } = (await store.createRequirement(p.root, '人工 PRD', { q_pain: '支持手工关联' })).data
  const d = await startDiscovery(p, id)
  const ops = [p.rpc('discovery/open', d.input), p.rpc('discovery/open', d.input)]
  assert.deepEqual((await Promise.all(ops)).map(res => res.data.sessionId), [d.sessionId, d.sessionId])
  assert.equal(p.prompts.length, 1)
  assert.equal((await p.rpc('discovery/prepare', d.input)).code, 'DISCOVERY_SKILL_REQUIRED')
  assert.equal((await p.rpc('discovery/prepare', { ...d.input, reqId: otherId })).code, 'WORKSPACE_MISMATCH')
  firstQuestion(d)
  assert.equal((await p.rpc('discovery/prepare', d.input)).code, 'DISCOVERY_ROUND_REQUIRED')
  const first = await prepareRound(p, d, 2, '需要多少种风格？', '需要两种', '建议使用简洁和详细两种表达风格。')
  assert.equal((await p.rpc('prd/generate', { root: p.root, reqIds: [id] })).code, 'DISCOVERY_SAVE_REQUIRED')
  const failed = join(p.root, '.project', 'requirements', id, 'discovery')
  await writeFile(failed, 'invalid directory')
  assert.equal((await p.rpc('discovery/save', { ...d.input, ...first })).code, 'INVALID_PATH')
  await rm(failed)
  const saves = await Promise.all([1, 2].map(() => p.rpc('discovery/save', { ...d.input, ...first })))
  assert.deepEqual(saves.map(res => res.data.version), [1, 1])
  assert.equal((await p.rpc('discovery/prepare', d.input)).code, 'DISCOVERY_NO_NEW')
  d.start(3)
  d.user('想再讨论默认风格')
  d.assistant('默认使用哪种风格？')
  d.end(3)
  const second = await prepareRound(p, d, 4, '默认使用哪种风格？', '默认简洁', '默认简洁；详细模式由用户选择。')
  assert.equal((await p.rpc('discovery/save', { ...d.input, ...second })).data.version, 2)
  assert.deepEqual((await p.rpc('discovery/list', d.input)).data.records.map(it => it.version), [2, 1])
  assert.equal((await p.rpc('discovery/source', { ...d.input, version: 1 })).data.sessionId, d.sessionId)
  const history = p.agents.get(d.sessionId).session
  p.agents.delete(d.sessionId)
  p.ctx.sessionQuery = { observeSession: async () => ({ header: history.header, events: history.snapshotEvents() }) }
  assert.equal((await p.rpc('discovery/open', d.input)).data.sessionId, d.sessionId)
  assert.equal((await p.rpc('discovery/session', d.input)).data.requirement.id, id)
  assert.equal(p.prompts.length, 1)
  await saveReviewPrd(p.root, id)
  await store.moveRequirement(p.root, id, 'reviewing')
  assert.equal((await p.rpc('discovery/open', d.input)).code, 'DISCOVERY_POOL_ONLY')
  assert.equal((await p.rpc('discovery/save', { ...d.input, ...second, previewId: 'uncommitted' })).code, 'DISCOVERY_POOL_ONLY')
  assert.equal((await p.rpc('discovery/save', { ...d.input, ...second })).data.version, 2)
  const target = { root: p.root, reqIds: [id], version: 1, sessionId: p.sessionId }
  const draft = await replyToChild(p, p.rpc('prd/generate', target), { markdown: '# 参考旧版' })
  assert.deepEqual(draft.data.sources, [{ reqId: id, version: 1 }])
  const otherRoot = await makeRoot(t)
  assert.equal((await p.rpc('prd/saveGenerated', { root: otherRoot, id: draft.data.id, markdown: '# 错误工作区' })).code, 'DISCOVERY_PREVIEW_EXPIRED')
  const saved = await p.rpc('prd/saveGenerated', { root: p.root, id: draft.data.id, markdown: '# 修改后的 PRD' })
  assert.equal(saved.data.markdown, '# 修改后的 PRD')

  await saveReviewPrd(p.root, otherId)
  await store.moveRequirement(p.root, otherId, 'reviewing')
  assert.equal((await p.rpc('prd/generate', { root: p.root, reqIds: [otherId] })).code, 'DISCOVERY_POOL_ONLY')
})

test('ordinary chat cannot qualify and a retried Grill Me turn needs valid message evidence', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  const { id } = (await store.createRequirement(p.root, '导出', { q_pain: '按筛选结果导出' })).data
  const d = await startDiscovery(p, id)
  firstQuestion(d, false)
  d.start(2)
  d.user('只导出筛选结果')
  d.assistant('建议保留当前筛选条件')
  d.end(2)
  assert.equal((await p.rpc('discovery/prepare', d.input)).code, 'DISCOVERY_SKILL_REQUIRED')
  assert.equal(p.children.length, 0)
  d.start(3)
  d.user('/' + discoverySkillName)
  d.user(discoverySkillMarker, { kind: 'skill-invocation', name: discoverySkillName })
  d.assistant('导出字段有哪些？')
  d.end(3)
  d.start(4)
  d.user('订单号和金额')
  d.assistant('建议首版只保留订单号和金额。')
  d.end(4)
  const prepared = await replyToChild(p, p.rpc('discovery/prepare', d.input), {
    ready: true,
    round: [1, 3, 2],
    markdown: '## 已确认结论\n不应保存',
  })
  assert.equal(prepared.code, 'DISCOVERY_AI_FAILED')
  assert.deepEqual((await p.rpc('discovery/list', d.input)).data.records, [])
})

test('PRD rejects a redirected project data directory', async t => {
  const p = await setup(t)
  const other = await makeRoot(t)
  await store.initProject(p.root)
  const id = (await store.createRequirement(p.root, '聊天', { q_pain: '两种风格' })).data.id
  await saveDiscovery(p, id)
  await mkdir(join(other, 'prd'))
  await symlink(join(other, 'prd'), join(p.root, '.project', 'prds'))
  p.begin('/pwb-prd')
  await p.tool('prdCreate', { reqIds: [id] })
  const opened = await p.act((await p.view())[0], 'openPreparation')
  const { sessionId } = opened.data
  preparationReply(p, sessionId, '# 聊天首版')
  const { data: { draft } } = await p.rpc('preparation/session', { root: p.root, sessionId, preview: true })
  assert.equal((await p.rpc('preparation/save', { root: p.root, sessionId, draftId: draft.id })).code, 'INVALID_PATH')
})
