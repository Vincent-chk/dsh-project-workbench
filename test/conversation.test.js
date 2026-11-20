import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'
import { readInvocation } from '../core/conversation-commands.js'
import * as store from '../core/store.js'
import { makeRoot, saveReviewPrd, seedAIReview, stubSpawnHost, waitFor } from './util.js'

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
  return { ...a, root, ctx, children, commands, prompts, post, rpc, createAgent, setMode: value => { mode = value }, contexts }
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
  await store.moveRequirement(p.root, id, 'in_progress')
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
  await store.moveRequirement(p.root, id, 'in_progress')
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

test('PRD preview, multi-requirement navigation, conflict reread and explicit save', async t => {
  const p = await setup(t)
  await store.initProject(p.root)
  const id = (await store.createRequirement(p.root, '聊天', { q_pain: '两种风格' })).data.id
  const second = (await store.createRequirement(p.root, '设置', { q_pain: '选择默认风格' })).data.id
  p.begin('/pwb-prd 从聊天和设置写首版 PRD')
  const instructions = p.contexts.get('project-workbench:conversation').text({ agent: p.agent })
  assert.match(instructions, /用户明确表达的决定才能写成已定范围/)
  assert.match(instructions, /依据不足的标准一律标注为建议、待用户确认/)
  assert.match(instructions, /无法证实的描述标注待确认，不要虚构现有工具的问题/)
  assert.match(instructions, /标注为建议或待确认/)
  const draft = await p.tool('prdPreview', { reqIds: [id, second], markdown: '# 聊天首版\n\n## 待定事项\n模型是否离线' })
  assert.deepEqual((await p.rpc('prd/list', { root: p.root, reqId: id })).data, [])
  const preview = (await p.view())[0]
  await p.direct(p.begin('@workbench 查看项目进展'))
  assert.equal((await p.view())[0].id, preview.id)
  assert.equal((await p.act((await p.view())[0], 'confirm', { markdown: '# 聊天首版\n\n离线可用性待定' })).ok, true)
  assert.deepEqual((await p.rpc('prd/list', { root: p.root, reqId: second })).data[0].reqIds, [id, second])
  const original = (await p.rpc('prd/read', { root: p.root, id: draft.prdId })).data
  p.begin('/pwb-prd 更新已有 PRD')
  await p.tool('prdPreview', { reqIds: [id, second], prdId: draft.prdId, version: original.version, markdown: '# 新草稿\n\n同一个 AI' })
  const [card] = await p.view()
  assert.equal(card.updating, true)
  assert.equal(card.latest, undefined)
  const filename = join(p.root, '.project', 'prds', draft.prdId + '.md')
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('离线可用性待定', '手工补充的阅读说明'))
  assert.equal((await p.act(card, 'confirm', { markdown: card.markdown })).code, 'PRD_CONFLICT')
  assert.match(await readFile(filename, 'utf8'), /手工补充/)
  assert.match((await p.act(card, 'reloadPrd')).data.card.latest, /手工补充/)
  assert.equal((await p.act(card, 'confirm', { markdown: '# 新草稿\n\n保留人工补充的阅读说明' })).ok, true)
  const latest = (await p.rpc('prd/read', { root: p.root, id: draft.prdId })).data
  assert.equal(latest.revision, 2)
  assert.match(latest.markdown, /保留人工补充的阅读说明/)
  const requirements = (await store.scanProject(p.root)).requirements
  assert.ok(requirements.every(req => req.status === 'backlog'))
})

test('PRD rejects a redirected project data directory', async t => {
  const p = await setup(t)
  const other = await makeRoot(t)
  await store.initProject(p.root)
  const id = (await store.createRequirement(p.root, '聊天', { q_pain: '两种风格' })).data.id
  await mkdir(join(other, 'prd'))
  await symlink(join(other, 'prd'), join(p.root, '.project', 'prds'))
  p.begin('/pwb-prd')
  await p.tool('prdPreview', { reqIds: [id], markdown: '# 聊天首版' })
  assert.equal((await p.act((await p.view())[0], 'confirm', { markdown: '# 聊天首版' })).code, 'INVALID_PATH')
})
