import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { installDiscovery } from '../core/discovery.js'
import { installRequirementReview } from '../core/requirement-review.js'
import { dispatch } from '../core/rpc.js'
import { readPrd, savePrd } from '../core/prd.js'
import { discoverySkillName, discoverySkillMarker } from '../core/skill.js'
import { makeRoot, seedAIReview, stubSpawnHost, waitFor } from './util.js'

test('a PRD with headings and comments but no content cannot enter review', async t => {
  const root = await makeRoot(t)
  const { ctx } = stubSpawnHost(root)
  const { routes } = installDiscovery(ctx, { readOnlyChildren: new Set() })
  const call = (method, input) => dispatch(method, { root, ...input }, new AbortController().signal, routes)
  await call('project/init')
  const { data: { id } } = await call('requirement/create', { title: '表单保存', fields: { q_pain: '保存失败要保留输入' } })
  const prd = await call('prd/save', { reqIds: [id], markdown: '# 表单保存\n\n## 验收标准\n\n<!-- 需要补齐 -->' })
  assert.equal(prd.ok, true)
  const options = (await call('preparation/options', { reqId: id })).data
  assert.deepEqual(options.prds.map(({ id }) => id), [prd.data.id])
  assert.equal(options.hasReviewablePrd, false)
  assert.equal((await call('preparation/open', { reqId: id, kind: 'prototype' })).code, 'REVIEW_PRD_REQUIRED')
  for (const [method, input] of [['requirement/move', { to: 'reviewing' }], ['requirement/review', { action: 'submit' }]]) {
    assert.equal((await call(method, { id, ...input })).code, 'REVIEW_PRD_REQUIRED')
  }
  assert.equal((await call('requirement/get', { id })).data.status, 'backlog')
})

test('approval cannot move a requirement with missing preparation to ready', async t => {
  const root = await makeRoot(t)
  const call = (method, input) => dispatch(method, { root, ...input }, new AbortController().signal)
  await call('project/init')
  const { data: { id } } = await call('requirement/create', { title: '表单保存', fields: { q_pain: '保存失败要保留输入' } })
  await seedAIReview(root, id, { submit: true, preparation: false })
  const result = await call('requirement/move', { id, to: 'ready' })
  assert.equal(result.code, 'PREPARATION_REQUIRED')
  assert.match(result.message, /discovery, prototype$/u)
  assert.equal((await call('requirement/get', { id })).data.status, 'reviewing')
  await seedAIReview(root, id)
  const dir = join(root, '.project', 'requirements', id)
  for (const [field, name] of [['discovery', 'discovery/1.md'], ['prototype', 'prototypes/1.json']]) {
    const file = join(dir, name)
    const content = await readFile(file, 'utf8')
    await unlink(file)
    const blocked = await call('requirement/review', { id, action: 'approve' })
    assert.equal(blocked.code, 'PREPARATION_REQUIRED')
    assert.equal(blocked.message, `missing preparation: ${field}`)
    await writeFile(file, content)
  }
  const [prd] = (await call('prd/list', { reqId: id })).data
  const draft = await call('prd/save', { ...prd, markdown: '# 只有标题的草稿' })
  assert.equal(draft.ok, true)
  assert.equal((await call('requirement/review', { id, action: 'approve' })).code, 'REVIEW_PRD_REQUIRED')
  assert.equal((await call('requirement/get', { id })).data.status, 'reviewing')
})

test('ready tasks can be planned and edited, but development needs their complete definitions', async t => {
  const root = await makeRoot(t)
  const call = (method, input) => dispatch(method, { root, ...input }, new AbortController().signal)
  await call('project/init')
  const { data: { id } } = await call('requirement/create', { title: '表单保存', fields: { q_pain: '保存失败要保留输入' } })
  await seedAIReview(root, id, { submit: true })
  assert.equal((await call('requirement/review', { id, action: 'approve' })).ok, true)
  const start = () => call('requirement/move', { id, to: 'in_progress' })
  const get = async () => (await call('requirement/get', { id })).data
  const before = await get()
  assert.equal((await start()).code, 'DEV_TASKS_REQUIRED')
  assert.equal((await call('requirement/startDev', { id })).code, 'DEV_TASKS_REQUIRED')
  const { data: task } = await call('issue/create', { reqId: id, title: '实现重试', fields: { problemOverview: '保存失败可重试', acceptance: ' ' } })
  const incomplete = await start()
  assert.equal(incomplete.code, 'DEV_TASK_FIELDS_REQUIRED')
  assert.deepEqual(JSON.parse(incomplete.message), [{ title: '实现重试', fields: ['acceptance'] }])
  assert.equal((await call('issue/move', { reqId: id, id: task.id, to: 'blocked', blockedReason: '等待开工' })).code, 'REQ_NOT_ACTIVE')
  assert.equal((await get()).hash, before.hash)
  assert.equal((await call('issue/update', { reqId: id, id: task.id, patch: { acceptance: '可以再次保存原输入' } })).ok, true)

  const damaged = join(root, '.project', 'requirements', id, 'issues', 'iss-20000101-abcdef.md')
  await writeFile(damaged, '缺少任务元数据')
  assert.equal((await start()).code, 'DELIVERY_DATA_INCOMPLETE')
  assert.equal((await get()).status, 'ready')
  await unlink(damaged)
  assert.equal((await start()).data.to, 'in_progress')
  assert.equal((await get()).issues[0].status, 'todo')
})

test('an approved requirement can return for review when its PRD changes', async t => {
  const root = await makeRoot(t)
  const call = (method, input) => dispatch(method, { root, ...input }, new AbortController().signal)
  await call('project/init')
  const { data: { id } } = await call('requirement/create', { title: '表单保存', fields: { q_pain: '保存失败要保留输入' } })
  const approve = () => call('requirement/review', { id, action: 'approve' })
  const start = () => call('requirement/startDev', { id })
  await seedAIReview(root, id, { submit: true })
  assert.equal((await approve()).ok, true)
  const { data: task } = await call('issue/create', { reqId: id, title: '实现重试', fields: { problemOverview: '保存失败可重试', acceptance: '可以再次保存原输入' } })
  const [prd] = (await call('prd/list', { reqId: id })).data
  assert.equal((await call('prd/save', { ...prd, markdown: '# 更新后的表单保存\n\n保存失败时显示原因，并保留上次输入。' })).ok, true)
  assert.equal((await start()).code, 'REVIEW_APPROVAL_STALE')
  assert.equal((await call('requirement/move', { id, to: 'backlog', reason: '更新了范围' })).code, 'REVIEW_INVALIDATION_REQUIRED')
  const returned = await call('requirement/move', { id, to: 'backlog', reason: '更新了范围', confirmReviewInvalid: true })
  assert.equal(returned.data.to, 'backlog')
  await seedAIReview(root, id, { submit: true })
  assert.equal((await approve()).ok, true)
  assert.equal((await start()).ok, true)
  const { data: req } = await call('requirement/get', { id })
  assert.deepEqual(req.issues.map(item => item.id), [task.id])
  assert.equal(req.reviews.filter(item => item.decision === 'returned').length, 1)
})

test('preparation reuses a legacy discovery chat, saves PRD and HTML from separate chats, and reviews the saved version without a session', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, children } = stubSpawnHost(root)
  const events = new Map()
  const prompts = []
  const reviewPrompts = []
  ctx.sessionController.prompt = async request => {
    prompts.push(request)
    append(request.sessionId, 'turn/start', { turn: request.requestId })
    append(request.sessionId, 'user/message', { source: { kind: 'user', rpcId: request.requestId }, content: request.content })
    return { accepted: true }
  }
  ctx.agentDefaultModel = { currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }) }
  ctx.llm = { async *stream(options) {
    reviewPrompts.push(options)
    yield { type: 'text-delta', index: 0, text: '建议：推进\n核对了失败后保留表单。' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const readOnlyChildren = new Set()
  const routes = { ...installDiscovery(ctx, { readOnlyChildren }).routes, ...installRequirementReview(ctx).routes }
  const call = (method, input = {}) => dispatch(method, { root, ...input }, new AbortController().signal, routes)
  const ok = async (method, input) => {
    const response = await call(method, input)
    assert.equal(response.ok, true, JSON.stringify(response))
    return response.data
  }
  function append(id, type, data) {
    if (!events.has(id)) {
      events.set(id, [])
      agents.get(id).session.snapshotEvents = () => events.get(id)
    }
    const list = events.get(id)
    list.push({ type, seq: list.length + 1, data })
  }
  const message = text => [{ type: 'text', text }]
  const assistant = (id, text) => append(id, 'assistant/message', { message: { content: message(text) } })
  const finish = (id, turn) => append(id, 'turn/end', { turn, reason: { kind: 'completed' } })
  await ok('project/init')
  const { id: reqId } = await ok('requirement/create', { title: '保存表单', fields: { q_pain: '保存失败后保留输入' } })

  const old = (await ctx.sessionController.create()).sessionId
  const kickoff = 'old-discovery'
  const legacyDir = join(root, '.project', '.local', 'discovery')
  await mkdir(legacyDir, { recursive: true })
  await writeFile(join(legacyDir, reqId + '.json'), JSON.stringify({ reqId, sessionId: old, requestId: kickoff, started: true }))
  append(old, 'turn/start', { turn: kickoff })
  append(old, 'user/message', { source: { kind: 'user', rpcId: kickoff }, content: message('开始') })
  append(old, 'user/message', { source: { kind: 'skill-invocation', name: discoverySkillName }, content: message(discoverySkillMarker) })
  assistant(old, '❓ **Q1** - **失败时是否保留输入？**')
  finish(old, kickoff)
  append(old, 'turn/start', { turn: 'answer' })
  append(old, 'user/message', { source: { kind: 'user', rpcId: 'answer' }, content: message('保留输入。') })
  assistant(old, '深化建议：保留输入并允许手动重试。')
  finish(old, 'answer')
  const deep = await ok('preparation/open', { reqId, kind: 'discovery' })
  assert.equal(deep.sessionId, old)
  assert.equal(prompts.length, 0)
  const waiting = ok('discovery/prepare', { reqId, sessionId: old })
  await waitFor(() => children.length === 1)
  const transcript = JSON.parse(children[0].prompt.split('\n').findLast(line => line.startsWith('[{')))
  children[0].resolve({ stopReason: 'completed', output: message(JSON.stringify({
    ready: true, round: transcript.map(turn => turn.seq), markdown: '## 已确认\n保存失败保留输入并允许重试。',
  })) })
  const summary = await waiting
  await ok('discovery/save', { reqId, sessionId: old, previewId: summary.previewId, markdown: summary.markdown })
  const prdOptions = { reqId, kind: 'prd', discoveryVersion: 1 }
  const [prd, duplicate] = await Promise.all([ok('preparation/open', prdOptions), ok('preparation/open', prdOptions)])
  assert.deepEqual(duplicate, prd)
  assert.notEqual(prd.sessionId, old)
  assert.match(prompts[0].content[0].text, /保存失败保留输入并允许重试/)
  assistant(prd.sessionId, '~~~workbench-prd\n# 表单保存\n\n保存失败时保留输入并允许重试。\n~~~')
  finish(prd.sessionId, prompts[0].requestId)
  const beforePrdSave = await ok('preparation/options', { reqId })
  assert.deepEqual(beforePrdSave.prds, [])
  assert.deepEqual(beforePrdSave.discoveryVersions, [1])
  assert.equal(beforePrdSave.hasReviewablePrd, false)
  const prdPreview = (await ok('preparation/session', { sessionId: prd.sessionId, preview: true })).draft
  const confirmedPrd = await ok('preparation/save', { sessionId: prd.sessionId, draftId: prdPreview.id, markdown: prdPreview.markdown + '\n\n用户确认需要错误提示。' })
  const linked = await readPrd(root, confirmedPrd.id)
  assert.match(linked.markdown, /用户确认需要错误提示/)
  assert.deepEqual(linked.discoverySources, [{ reqId, version: 1 }])
  const updated = await savePrd(root, { id: linked.id, version: linked.version, reqIds: [reqId],
    markdown: linked.markdown + '\n\n评审前另行补充。' })
  const { record: sessionRevision } = await ok('preparation/session', { sessionId: prd.sessionId, readSaved: true })
  assert.equal(sessionRevision.revision, confirmedPrd.revision)
  assert.equal(sessionRevision.markdown, linked.markdown)
  assert.notEqual(sessionRevision.markdown, updated.markdown)
  assert.equal((await ok('preparation/session', { sessionId: prd.sessionId, preview: true })).draft, null)
  assert.equal((await ok('preparation/options', { reqId })).hasReviewablePrd, true)

  const proto = await ok('preparation/open', { reqId, kind: 'prototype' })
  assert.notEqual(proto.sessionId, prd.sessionId)
  assert.match(prompts[1].content[0].text, /用户确认需要错误提示/)
  const material = {
    summary: '增加保存失败反馈。', flow: [{ from: '输入表单', to: '保留输入', when: '保存失败' }],
    screens: [{ title: '保存失败', state: '等待重试', elements: [{ kind: 'button', label: '重试保存' }] }],
  }
  assistant(proto.sessionId, '~~~workbench-prototype\n' + JSON.stringify(material) + '\n~~~')
  finish(proto.sessionId, prompts[1].requestId)
  const prototypePreview = (await ok('preparation/session', { sessionId: proto.sessionId, preview: true })).draft
  assert.match(prototypePreview.html, /重试保存/)
  assert.doesNotMatch(prototypePreview.html, /<script\b/iu)
  const saved = await ok('preparation/save', { sessionId: proto.sessionId, draftId: prototypePreview.id })
  assert.equal(saved.version, 1)
  assert.match((await ok('preparation/session', { sessionId: proto.sessionId, readSaved: true })).record.html, /重试保存/)
  assert.deepEqual(await ok('preparation/save', { sessionId: proto.sessionId, draftId: prototypePreview.id }), saved)
  assert.deepEqual((await ok('preparation/options', { reqId })).prototypes, [1])

  const req = await ok('requirement/get', { id: reqId })
  assert.deepEqual(Object.keys(req.preparationTasks).sort(), ['discovery', 'prd', 'prototype'])
  assert.deepEqual(req.issues, [])
  agents.clear()
  await ok('requirement/review', { id: reqId, action: 'submit' })
  assert.equal(reviewPrompts.length, 0)
  await ok('requirement/review/start', { id: reqId, after: null })
  let status
  await waitFor(async () => (status = await ok('requirement/review/status', { id: reqId })).state === 'done')
  assert.equal(agents.size, 0)
  assert.match(reviewPrompts[0].messages[0].content[0].text, /重试保存/)
  assert.equal(status.reports[0].source.prototype.version, 1)
  assert.deepEqual(status.reports[0].source.materials.prototype, material)
  const dir = join(root, '.project', 'requirements', reqId, 'prototypes')
  const replacement = { ...JSON.parse(await readFile(join(dir, '1.json'), 'utf8')), version: 2 }
  await writeFile(join(dir, '2.json'), JSON.stringify(replacement))
  assert.equal((await ok('requirement/review/status', { id: reqId })).stale, true)
  assert.equal((await call('requirement/move', { id: reqId, to: 'ready' })).code, 'REVIEW_REPORT_REQUIRED')
  await ok('requirement/review', { id: reqId, action: 'return', reason: '复核失败路径' })
  await ok('requirement/review', { id: reqId, action: 'submit' })
  assert.equal((await call('requirement/review', { id: reqId, action: 'approve' })).code, 'REVIEW_REPORT_REQUIRED')
  assert.equal((await ok('requirement/review/status', { id: reqId })).stale, true)
})

test('PRD collaboration can update a selected existing document without a discovery record', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubSpawnHost(root)
  let kickoff
  ctx.sessionController.prompt = async request => { kickoff = request; return { accepted: true } }
  const routes = installDiscovery(ctx, { readOnlyChildren: new Set() }).routes
  const ok = async (method, input = {}) => {
    const response = await dispatch(method, { root, ...input }, new AbortController().signal, routes)
    assert.equal(response.ok, true, JSON.stringify(response))
    return response.data
  }
  await ok('project/init')
  const { id: reqId } = await ok('requirement/create', { title: '现有说明', fields: { q_pain: '打磨现有流程' } })
  const original = await savePrd(root, { reqIds: [reqId], markdown: '# 原版说明' })
  const { sessionId } = await ok('preparation/open', { reqId, kind: 'prd', prdId: original.id })
  assert.match(kickoff.content[0].text, /原版说明/)
  agents.get(sessionId).session.snapshotEvents = () => [
    { type: 'turn/start', seq: 1, data: { turn: 'first' } },
    { type: 'user/message', seq: 2, data: { source: { kind: 'user', rpcId: kickoff.requestId } } },
    { type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: '~~~workbench-prd\n# 更新说明\n~~~' }] } } },
    { type: 'turn/end', seq: 4, data: { turn: 'first', reason: { kind: 'completed' } } },
  ]
  const { draft } = await ok('preparation/session', { sessionId, preview: true })
  const saved = await ok('preparation/save', { sessionId, draftId: draft.id })
  assert.equal(saved.id, original.id)
  assert.equal(saved.revision, 2)
  assert.equal((await readPrd(root, original.id)).markdown, '# 更新说明')
})
