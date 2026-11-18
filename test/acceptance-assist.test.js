import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as store from '../core/store.js'
import { installAcceptanceAssist } from '../core/acceptance-assist.js'
import { consumeChildToolAllow } from '../core/spawn.js'
import { makeRoot, stubSpawnHost, issueFileHash, waitFor } from './util.js'

async function fixture(t, issueFields = {}) {
  const root = await makeRoot(t)
  await store.initProject(root)
  const { data: { id: reqId } } = await store.createRequirement(root, '输入提示')
  await store.updateRequirement(root, reqId, { q_pain: '空白提示', acceptance: '空白时提示填写' })
  for (const state of ['reviewing', 'ready', 'in_progress']) await store.moveRequirement(root, reqId, state)
  const { data: { id: issueId } } = await store.createIssue(root, reqId, '处理空白', { problemOverview: '显示提示', acceptance: '空白时提示填写', ...issueFields })
  await store.updateIssue(root, reqId, issueId, { resultSummary: '已实现', evidence: '人工核对' })
  await store.moveIssue(root, reqId, issueId, 'in_review', { fileHash: await issueFileHash(root, reqId, issueId) })
  const { ctx, agents, children } = stubSpawnHost(root)
  const sessionId = 'session-parent'
  agents.set(sessionId, { session: { id: sessionId, header: { cwd: root }, snapshotEvents: () => [] }, status: 'idle' })
  const links = {
    current: { sessionId, reqId, issueId, linkedAt: 'initial', startSeq: 0 },
    locate: async (_root, id) => ({ sessionId, reqId, issueId: id }),
    getLink: async () => ({ link: links.current }),
    serialized: (_sid, fn) => fn(),
  }
  const assist = installAcceptanceAssist(ctx, { links, readOnlyChildren: new Set() })
  return { root, reqId, issueId, sessionId, ctx, agents, children, links, assist }
}
const reply = text => ({ stopReason: 'completed', output: [{ type: 'text', text }] })
const eventLog = [
  { type: 'tool/call', seq: 1, time: 1, data: { callId: 'a', name: 'bash', arguments: JSON.stringify({ command: 'node --test demo.test.mjs' }) } },
  { type: 'tool/result', seq: 2, time: 2, data: { message: { toolCallId: 'a', content: [{ type: 'text', text: 'not ok 1\n[exit code: 1]' }] } } },
  { type: 'tool/call', seq: 3, time: 3, data: { callId: 'b', name: 'bash', arguments: JSON.stringify({ command: 'npm test' }) } },
]

test('verification retains real failed command separately from model report and does not change workbench data', async t => {
  const f = await fixture(t)
  f.ctx.sessionQuery = { observeSession: async () => ({ events: eventLog }) }
  const file = join(f.root, '.project', 'requirements', f.reqId, 'issues', `${f.issueId}.md`)
  const before = await readFile(file, 'utf8')
  const pending = f.assist.routes['acceptance/assist']({ ...f, kind: 'verify' })
  await waitFor(() => f.children.length === 1)
  assert.equal(f.children[0].parentId, f.sessionId)
  assert.match(f.children[0].name, /^[a-z][a-z0-9-]{0,31}$/)
  assert.deepEqual(consumeChildToolAllow(f.children[0].childId), ['read', 'glob', 'grep', 'bash'])
  assert.match(f.children[0].prompt, /失败/)
  await assert.rejects(f.assist.routes['acceptance/assist']({ ...f, kind: 'guide' }), { code: 'ASSIST_BUSY' })
  f.children[0].resolve(reply('模型声称全部通过'))
  const result = await pending
  assert.equal(result.report, '模型声称全部通过')
  assert.equal(result.commands[0].outcome, 'exit:1')
  assert.equal(result.commands[0].testConclusion, 'failed')
  assert.match(result.commands[0].output, /not ok 1/)
  assert.equal(result.commands[1].outcome, 'pending')
  assert.equal(result.commandsUnavailable, false)
  assert.equal(result.stale, false)
  assert.equal(await readFile(file, 'utf8'), before)
})

test('code-only guide request returns before opening a session or starting a child', async t => {
  const f = await fixture(t, { problemOverview: '调整问候函数的返回值', acceptance: '空字符串返回提示，单元测试通过' })
  f.links.locate = () => { throw new Error('should not locate a session') }
  const result = await f.assist.routes['acceptance/assist']({ ...f, kind: 'guide' })
  assert.deepEqual(result, { kind: 'guide', guideStatus: 'not_needed' })
  assert.equal(f.children.length, 0)
})

test('guide allows user-facing changes with code context, verifies sources and marks changed requirements stale', async t => {
  const f = await fixture(t, { problemOverview: '调整问候函数用在表单中的提示', triggerPath: '清空页面输入框后点击提交' })
  await writeFile(join(f.root, 'README.md'), '入口：点击本机应用。\n')
  let observed = false
  f.ctx.sessionQuery = { observeSession: async () => { observed = true; return { events: [] } } }
  const pending = f.assist.routes['acceptance/assist']({ ...f, kind: 'guide' })
  await waitFor(() => f.children.length === 1)
  assert.deepEqual(consumeChildToolAllow(f.children[0].childId), ['read', 'glob', 'grep'])
  await appendFile(join(f.root, '.project', 'requirements', f.reqId, 'requirement.md'), '\n人工变更\n')
  const steps = [{ action: '打开本机应用。', expected: '显示输入框。' }]
  const sources = [{ path: 'README.md', quote: '入口：点击本机应用。' }]
  f.children[0].resolve(reply(JSON.stringify({ status: 'steps', steps, sources: [...sources, { path: 'README.md', quote: '不存在' }] })))
  const result = await pending
  assert.equal(result.guideStatus, 'steps')
  assert.deepEqual(result.steps, steps)
  assert.equal(result.stale, true)
  assert.equal(result.sourcesRequested, 2)
  assert.deepEqual(result.sources, sources)
  assert.equal(observed, false)
})

test('guide cannot display unsubstantiated entry instructions', async t => {
  const f = await fixture(t)
  const pending = f.assist.routes['acceptance/assist']({ ...f, kind: 'guide' })
  await waitFor(() => f.children.length === 1)
  f.children[0].resolve(reply(JSON.stringify({ status: 'steps', steps: [{ action: '点刷新。', expected: '显示提示。' }],
    sources: [{ path: 'README.md', quote: '不存在的说明' }] })))
  const result = await pending
  assert.equal(result.guideStatus, 'unknown')
  assert.equal(result.steps, undefined)
})

test('missing child events are explicit, and a model claim is never converted to command evidence', async t => {
  const f = await fixture(t)
  const pending = f.assist.routes['acceptance/assist']({ ...f, kind: 'verify' })
  await waitFor(() => f.children.length === 1)
  f.children[0].resolve(reply('全部检查通过'))
  const result = await pending
  assert.deepEqual(result.commands, [])
  assert.equal(result.commandsUnavailable, true)
})

test('rejects unrelated task, busy parent and a parent from another workspace', async t => {
  const f = await fixture(t)
  const run = input => f.assist.routes['acceptance/assist']({ ...f, kind: 'verify', ...input })
  await assert.rejects(run({ issueId: 'iss-20261118-abcdef' }), { code: 'NOT_FOUND' })
  f.agents.get(f.sessionId).status = 'running'
  await assert.rejects(run({}), { code: 'SESSION_BUSY' })
  f.agents.get(f.sessionId).status = 'waiting'
  await assert.rejects(run({}), { code: 'SESSION_BUSY' })
  f.agents.get(f.sessionId).status = 'idle'
  f.agents.get(f.sessionId).session.header.cwd = '/other'
  await assert.rejects(run({}), { code: 'WORKSPACE_MISMATCH' })
  assert.equal(f.children.length, 0)
})

test('link switching before admission is rejected; switching while running marks result stale', async t => {
  const f = await fixture(t)
  const run = () => f.assist.routes['acceptance/assist']({ ...f, kind: 'verify' })
  f.links.current = { sessionId: f.sessionId, reqId: f.reqId, issueId: 'other-task' }
  await assert.rejects(run(), { code: 'LINK_CHANGED' })
  assert.equal(f.children.length, 0)
  f.links.current = { sessionId: f.sessionId, reqId: f.reqId, issueId: f.issueId, linkedAt: 'initial', startSeq: 0 }
  f.ctx.sessionQuery = { observeSession: async () => ({ events: [] }) }
  const pending = run()
  await waitFor(() => f.children.length === 1)
  // The session was switched away and back to the same task while running.
  f.links.current = { sessionId: f.sessionId, reqId: f.reqId, issueId: f.issueId, linkedAt: 'new-generation', startSeq: 42 }
  f.children[0].resolve(reply('测试结果需要核对'))
  assert.equal((await pending).stale, true)
})
