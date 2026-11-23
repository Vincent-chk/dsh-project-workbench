import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'
import * as store from '../core/store.js'
import { PROJECT_DENIAL, TASK_READ_DENIAL } from '../core/write-guard.js'
import { makeRoot, seedAIReview, stubSpawnHost, seedReviewPrd, startTestDevelopment } from './util.js'

test('formal host keeps task entry and write guard without prototype routes, tools or probes', async t => {
  const root = await makeRoot(t)
  const readFile = fsPromises.readFile
  const readFileSync = fs.readFileSync
  const oldProbeReads = []
  const blockedFlag = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    if (['/tmp/pw-stage1-probe.json', '/tmp/pw-stage1-patch-probe.json', '/tmp/pw-fail-note'].includes(path)) {
      oldProbeReads.push(path)
      return '{}'
    }
    return readFile(path, ...args)
  })
  const acceptanceFlag = t.mock.method(fs, 'readFileSync', (path, ...args) =>
    path === '/tmp/pw-acceptance-mode' ? root : readFileSync(path, ...args))
  syncBuiltinESMExports()
  t.after(() => { blockedFlag.mock.restore(); acceptanceFlag.mock.restore(); syncBuiltinESMExports() })

  const { ctx, agents } = stubSpawnHost(root)
  const routes = new Map(), tools = new Map(), guards = []
  const prompts = []
  ctx.sessionController.prompt = async request => { prompts.push(request); return { accepted: true } }
  ctx.skills = { register: () => () => {} }
  ctx.mcpManager = { register: () => () => {} }
  ctx.connection = { fetch: { register: route => { routes.set(route.path, route.fetch); return () => {} } } }
  ctx.tools = {
    register: def => { tools.set(def.name, def); return () => {} },
    guard: fn => { guards.push(fn); return () => {} },
  }
  ctx.effect = effect => {
    const result = effect()
    if (typeof result?.next === 'function') { for (const _ of result) { /* register effects */ } }
    if (typeof result === 'function') t.after(result)
  }
  await apply(ctx)
  await setImmediate()
  const rpc = async (method, input = {}) => (await routes.get('/api/project-workbench')(new Request('http://local', {
    method: 'POST', body: JSON.stringify({ method, input }),
  }))).json()

  for (const method of ['demo/setup', 'demo/locate', 'demo/start', 'demo/stop', 'demo/note', 'demo/state', 'demo/patch-tool']) {
    const result = await rpc(method, { root })
    assert.equal(result.ok, false, method)
    assert.equal(result.code, 'NOT_FOUND', method)
  }
  assert.equal([...tools.keys()].some(name => name.startsWith('workbench_demo_')), false)
  assert.ok(tools.has('workbench_task_get'))
  assert.ok(tools.has('workbench_task_note'))
  assert.ok(guards.some(guard => guard({ name: 'write', arguments: { file_path: '.project/project.md' }, agent: { session: { header: { cwd: root } } } }) === PROJECT_DENIAL))
  assert.deepEqual(oldProbeReads, [], 'formal activation does not start stage-1 flag-file probes')

  await store.initProject(root)
  const reqId = (await store.createRequirement(root, '正式任务')).data.id
  await store.updateRequirement(root, reqId, { goal: '目标', scope: '范围', acceptance: '标准' })
  await seedReviewPrd(root, reqId)
  await store.moveRequirement(root, reqId, 'reviewing')
  await seedAIReview(root, reqId)
  await store.moveRequirement(root, reqId, 'ready')
  await startTestDevelopment(root, reqId)
  const issueId = (await store.createIssue(root, reqId, '正式任务')).data.id
  await store.updateIssue(root, reqId, issueId, { problemOverview: '概述', acceptance: '标准' })
  const located = await rpc('task/locate', { root, issueId })
  assert.equal(located.ok, true)
  const agent = agents.get(located.data.sessionId)
  assert.ok(agent)
  const guardCall = (name, args, currentAgent = agent) => guards.map(guard => guard({ name, arguments: args, agent: currentAgent })).find(Boolean)
  assert.equal(guardCall('bash', { command: 'ls ../.. && ls ../../B/同名验收项目' }), TASK_READ_DENIAL)
  assert.equal(guardCall('read', { file_path: '/another/project/README.md' }), TASK_READ_DENIAL)
  assert.equal(guardCall('read', { file_path: join(root, 'demo.mjs') }), undefined)
  const unlinked = agents.get((await ctx.sessionController.create({ cwd: root })).sessionId)
  assert.equal(guardCall('read', { file_path: '/another/project/README.md' }, unlinked), undefined)
  const task = JSON.parse(await tools.get('workbench_task_get').execute({}, { agent }))
  assert.equal(task.title, '正式任务')
  assert.equal(task.problemOverview, '概述')
  assert.equal(await tools.get('workbench_task_note').execute({ text: '记录真实进展' }, { agent }), '已记录')
  const issue = (await store.scanProject(root)).requirements.find(req => req.id === reqId).issues.find(item => item.id === issueId)
  assert.match(issue.activity.join('\n'), /记录真实进展/)
  const started = await rpc('run/start', { root, issueId, sessionId: located.data.sessionId })
  assert.equal(started.ok, true)
  assert.equal(started.data.started, true)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].sessionId, located.data.sessionId)
  assert.deepEqual(oldProbeReads, [], 'formal note ignores the obsolete failure flag')
})
