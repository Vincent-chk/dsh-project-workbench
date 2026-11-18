// Stage-1 prototype integration tests with a stub Host context: links, run lock
// dedup, server-set human actor, and turn/end record sync over REAL fixture events.
// Live DSH behavior (session.create/prompt, guards, steer) is verified on the Host.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs, { readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installPrototype, ensureDemoData } from '../core/prototype.js'
import { ACCEPTANCE_FLAG, installTools } from '../core/tools.js'
import * as store from '../core/store.js'
import { makeRoot } from './util.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureEvents = readFileSync(join(here, 'fixtures', 'session-events', 'normal.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))

function stubCtx(root, { promptDelayMs = 0 } = {}) {
  const listeners = {}
  const agents = new Map()
  const prompts = []
  const tools = new Map()
  const contexts = new Map()
  let created = 0
  const ctx = {
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    on(name, fn) { (listeners[name] ??= []).push(fn); return () => {} },
    tools: { guard: () => () => {}, register: def => { tools.set(def.name, def); return () => {} } },
    systemPrompt: { context: def => { contexts.set(def.name, def); return () => {} } },
    agents: { get: sid => agents.get(sid) },
    sessions: { get: sid => agents.get(sid)?.session },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      create: async () => {
        const sessionId = `session-stub-${++created}`
        const session = { id: sessionId, header: { cwd: root }, seq: 0, snapshotEvents: () => [] }
        agents.set(sessionId, { session, status: 'idle' })
        return { sessionId }
      },
      prompt: async (request, signal) => {
        prompts.push({ request, signal })
        const agent = agents.get(request.sessionId)
        if (agent) agent.status = 'running'
        if (promptDelayMs) await new Promise(r => setTimeout(r, promptDelayMs))
        return { accepted: true }
      },
      cancel: async ({ sessionId }) => {
        const agent = agents.get(sessionId)
        if (agent) agent.status = 'idle'
        return { accepted: true }
      },
    },
    logger: { warn: () => {} },
  }
  return { ctx, listeners, agents, prompts, tools, contexts }
}

const emit = (listeners, name, ...args) => Promise.all((listeners[name] ?? []).map(fn => fn(...args)))
const waitFor = async fn => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 10)) } throw new Error('waitFor timeout') }

test('model demo tools require an enabled session and a target in the same project', async t => {
  const root = await makeRoot(t)
  const otherRoot = await makeRoot(t)
  const originalRead = readFileSync
  let enabled = `${root}\n`
  const read = t.mock.method(fs, 'readFileSync', (path, ...args) =>
    path === ACCEPTANCE_FLAG ? enabled : originalRead(path, ...args))
  syncBuiltinESMExports()
  t.after(() => { read.mock.restore(); syncBuiltinESMExports() })

  const { ctx, agents, tools } = stubCtx(root)
  installPrototype(ctx)
  const { sessionId } = await ctx.sessionController.create()
  const caller = { agent: agents.get(sessionId) }
  const foreign = { session: { id: 'other-session', header: { cwd: otherRoot } } }
  agents.set(foreign.session.id, foreign)
  const enter = tools.get('workbench_demo_enter').execute
  const stop = tools.get('workbench_demo_stop').execute
  const state = tools.get('workbench_demo_state').execute

  assert.throws(() => enter({ root: otherRoot }, { agent: foreign }), { code: 'DEMO_DISABLED' })
  assert.throws(() => enter({ root: otherRoot }, caller), { code: 'WORKSPACE_MISMATCH' })
  assert.throws(() => state({ root, sessionId: foreign.session.id }, caller), { code: 'WORKSPACE_MISMATCH' })
  assert.throws(() => stop({ sessionId: foreign.session.id }, caller), { code: 'WORKSPACE_MISMATCH' })

  const demo = JSON.parse(await enter({ root }, caller))
  assert.equal((JSON.parse(await state({ root, sessionId: demo.sessionId }, caller))).task.id, demo.issueId)
  assert.equal(JSON.parse(await stop({ sessionId: demo.sessionId }, caller)).accepted, true)
  enabled = ''
  assert.throws(() => state({ root, sessionId: demo.sessionId }, caller), { code: 'DEMO_DISABLED' })
})

test('V-1 prototype: locate creates one session + link; view never prompts', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  assert.ok(located.created)
  assert.equal(prompts.length, 0) // view sends no prompt
  const link = JSON.parse(await readFile(join(root, '.project', '.local', 'links', `${located.sessionId}.json`), 'utf8'))
  assert.equal(link.issueId, demo.issues[0].id)
  assert.equal(link.reqId, demo.reqId)
  assert.equal(typeof link.startSeq, 'number')
  // Same task locates the SAME session (reuse, no second create).
  const again = await proto.locate(root, demo.issues[0].id)
  assert.equal(again.sessionId, located.sessionId)
  assert.ok(again.reused)
})

test('V-1: concurrent first view and start share one newly created session', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const issueId = demo.issues[0].id
  const create = ctx.sessionController.create
  let createCount = 0
  let releaseCreate
  let signalEntered
  const entered = new Promise(resolve => { signalEntered = resolve })
  const gate = new Promise(resolve => { releaseCreate = resolve })
  ctx.sessionController.create = async (...args) => {
    createCount++
    signalEntered()
    await gate
    return create(...args)
  }

  const firstView = proto.locate(root, issueId)
  await entered // hold the first create open while other entry points arrive
  const otherView = proto.locate(root, issueId)
  const start = proto.runStart(root, issueId)
  const otherStart = proto.runStart(root, issueId)
  await new Promise(resolve => setTimeout(resolve, 30))
  const createsWhileHeld = createCount
  releaseCreate()
  const [viewA, viewB, runA, runB] = await Promise.all([firstView, otherView, start, otherStart])
  assert.equal(createsWhileHeld, 1)
  assert.equal(createCount, 1)
  assert.equal(new Set([viewA.sessionId, viewB.sessionId, runA.sessionId, runB.sessionId]).size, 1)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].request.sessionId, viewA.sessionId)
  const links = await readdir(join(root, '.project', '.local', 'links'))
  assert.deepEqual(links.filter(name => name.endsWith('.json')), [`${viewA.sessionId}.json`])
})

test('V-1: a failed session creation does not block a queued locate retry', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const create = ctx.sessionController.create
  let calls = 0
  ctx.sessionController.create = async (...args) => {
    if (++calls === 1) throw new Error('create failed')
    return create(...args)
  }
  const [first, retry] = await Promise.allSettled([
    proto.locate(root, demo.issues[0].id),
    proto.locate(root, demo.issues[0].id),
  ])
  assert.equal(first.status, 'rejected')
  assert.match(first.reason.message, /create failed/)
  assert.equal(retry.status, 'fulfilled')
  assert.ok(retry.value.created)
  assert.equal(calls, 2)
  assert.equal(prompts.length, 0)
})

test('V-1 prototype: run lock + requestId dedup — one prompt per run', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const issueId = demo.issues[0].id
  const started = await proto.runStart(root, issueId)
  assert.ok(started.started)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].request.requestId, started.runId) // runId doubles as DSH requestId
  assert.equal(prompts[0].request.mode, 'queue')
  assert.ok(prompts[0].signal instanceof AbortSignal)
  // While the session runs, another start enters the existing session: NO second prompt.
  const second = await proto.runStart(root, issueId)
  assert.ok(second.alreadyRunning)
  assert.equal(second.runId, started.runId)
  assert.equal(prompts.length, 1)
  // §4.5: a STARTING lock whose request WAS accepted is never cleared on idleness.
  const { writeFile: wf, readFile: rf } = await import('node:fs/promises')
  const lockPath = join(root, '.project', '.local', 'runs', `${issueId}.json`)
  const lock = JSON.parse(await rf(lockPath, 'utf8'))
  await wf(lockPath, JSON.stringify({ ...lock, state: 'starting' }))
  const agent0 = agents.get(started.sessionId)
  agent0.status = 'idle'
  agent0.session.snapshotEvents = () => [{ seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'user', rpcId: started.runId }, content: [] } }]
  const third = await proto.runStart(root, issueId)
  assert.ok(third.alreadyStarting)
  assert.equal(prompts.length, 1)
  // A residual STARTING lock with NO accepted request (reload mid-submit)
  // re-submits the SAME requestId (host dedups) — never a new id.
  agent0.session.snapshotEvents = () => []
  const fourth = await proto.runStart(root, issueId)
  assert.ok(fourth.started)
  assert.equal(prompts.length, 2)
  assert.equal(prompts[1].request.requestId, started.runId) // same id, no duplicate run
  await wf(lockPath, JSON.stringify({ ...lock, state: 'running', runId: prompts[1].request.requestId }))
  // After the run's OWN turn ended (its request message + turn/start + turn/end),
  // the lock is reconciled and a new run may prompt with a fresh requestId.
  const agent = agents.get(started.sessionId)
  agent.status = 'idle'
  agent.session.snapshotEvents = () => [
    { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: 1, type: 'user/message', data: { source: { kind: 'user', rpcId: prompts[1].request.requestId }, content: [] } },
    { seq: 5, time: 1, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  agent.session.seq = 6
  const fifth = await proto.runStart(root, issueId)
  assert.ok(fifth.started)
  assert.equal(prompts.length, 3)
  assert.notEqual(prompts[2].request.requestId, prompts[1].request.requestId)
})

test('V-3 prototype: demo/note sets human source server-side, ignores body actor', async t => {
  const root = await makeRoot(t)
  const { ctx } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const res = await proto.routes['demo/note']({ root, reqId: demo.reqId, id: demo.issues[0].id, text: '界面写入验证', actor: 'ai' })
  assert.equal(res.actor, 'human')
  const idx = await store.scanProject(root)
  const issue = idx.requirements.find(r => r.id === demo.reqId).issues.find(i => i.id === demo.issues[0].id)
  assert.ok(issue.activity.some(a => a.includes('人工操作：界面写入验证')))
  assert.ok(!issue.activity.some(a => a.includes('[AI]')))
})

test('V-2/V-5 prototype: turn/end syncs objective records from real events, advances cursor, releases lock', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents, prompts } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const issueId = demo.issues[0].id
  const started = await proto.runStart(root, issueId)
  const agent = agents.get(started.sessionId)
  // The linked session "lived" the real fixture log (turns 1–4, edits + commands).
  // The run's request message is logged INSIDE turn 1 (after its turn/start at seq 4).
  const runMessage = { type: 'user/message', seq: 5, time: 1, data: { source: { kind: 'user', rpcId: started.runId }, content: [] } }
  agent.session.snapshotEvents = from => [runMessage, ...fixtureEvents].filter(e => e.seq >= from)
  agent.session.seq = fixtureEvents[fixtureEvents.length - 1].seq + 1
  agent.status = 'idle'
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } })
  await waitFor(async () => {
    try { return !!(await readFile(join(root, '.project', '.local', 'cursors', `${started.sessionId}.json`), 'utf8')) } catch { return false }
  })
  const cursor = JSON.parse(await readFile(join(root, '.project', '.local', 'cursors', `${started.sessionId}.json`), 'utf8'))
  assert.equal(cursor.lastSeq, agent.session.seq - 1)
  const idx = await store.scanProject(root)
  const issue = idx.requirements.find(r => r.id === demo.reqId).issues.find(i => i.id === issueId)
  const doc = await readFile(join(root, '.project', 'requirements', demo.reqId, 'issues', `${issueId}.md`), 'utf8')
  assert.ok(doc.includes('### 客观记录（系统生成，请勿手改）'))
  assert.ok(doc.includes('改动文件：/demo/ws/bot/state.json'))
  assert.ok(doc.includes('执行命令：'))
  // Failed edits (sandbox/invalid args) never appear as changes.
  assert.ok(!doc.includes('第 82 条'))
  assert.ok(issue.activity.some(a => a.includes('客观记录同步')))
  // Run lock released after the ended run.
  await waitFor(async () => {
    try { await readFile(join(root, '.project', '.local', 'runs', `${issueId}.json`), 'utf8'); return false } catch { return true }
  })
  // No auto-continue: sync must not prompt.
  assert.equal(prompts.length, 1)
  // Re-sync with no new events writes nothing new (cursor idempotent).
  const before = doc
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } })
  await new Promise(r => setTimeout(r, 50))
  assert.equal(await readFile(join(root, '.project', 'requirements', demo.reqId, 'issues', `${issueId}.md`), 'utf8'), before)
})

test('V-2 prototype: turn-stopping steers at most once per turn, skips recorded turns', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(located.sessionId)
  const steers = []
  agent.steer = msg => steers.push(msg)
  // Turn 3 of the real fixture has confirmed edits and no workbench record.
  agent.session.snapshotEvents = from => fixtureEvents.filter(e => e.seq >= from)
  agent.session.seq = 200
  const controller = new AbortController()
  const stopping = emit(listeners, 'agent/turn-stopping', { agent, turn: 3, signal: controller.signal })
  controller.abort()
  await stopping
  assert.equal(steers.length, 0)
  await emit(listeners, 'agent/turn-stopping', { agent, turn: 3 })
  assert.equal(steers.length, 1)
  assert.ok(steers[0].content[0].text.includes('workbench_task_note'))
  // Same turn again: no second reminder.
  await emit(listeners, 'agent/turn-stopping', { agent, turn: 3 })
  assert.equal(steers.length, 1)
  // A turn whose activity is already covered by a successful record: no steer.
  const recorded = [
    ...fixtureEvents,
    { seq: 200, time: 1, type: 'tool/call', data: { turn: 3, step: 9, callId: 'wb1', name: 'workbench_task_note', arguments: '{"text":"已记录"}' } },
    { seq: 201, time: 2, type: 'tool/result', data: { turn: 3, step: 9, message: { role: 'tool', toolCallId: 'wb1', content: [{ type: 'text', text: '已记录' }], isError: false } } },
  ]
  agent.session.snapshotEvents = from => recorded.filter(e => e.seq >= from)
  await emit(listeners, 'agent/turn-stopping', { agent, turn: 3 })
  assert.equal(steers.length, 1) // reminded set holds; and activity is covered anyway
})

test('demo data: recognizable titles, unfixed demo.mjs, test file present', async t => {
  const root = await makeRoot(t)
  const demo = await ensureDemoData(root)
  assert.equal(demo.issues.length, 2)
  const demoMjs = await readFile(join(root, 'demo.mjs'), 'utf8')
  assert.ok(demoMjs.includes("return '你好，' + name + '！'")) // NOT pre-fixed
  const testFile = await readFile(join(root, 'demo.test.mjs'), 'utf8')
  assert.ok(testFile.includes('请填写名字'))
  // Idempotent: second call keeps the same ids.
  const again = await ensureDemoData(root)
  assert.deepEqual(again.issues.map(i => i.id), demo.issues.map(i => i.id))
})

// ---- 验收返工回归 ----

const evCall = (seq, callId, name, args) => ({ seq, time: seq, type: 'tool/call', data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) } })
const evResult = (seq, callId, text) => ({ seq, time: seq, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }] } } })
const readCursor = async (root, sid) => { try { return JSON.parse(await readFile(join(root, '.project', '.local', 'cursors', `${sid}.json`), 'utf8')) } catch { return null } }

test('空闲重进任务会补查漏掉的回合，重复查看不重复写也不发送请求', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, prompts } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const a = await proto.locate(root, demo.issues[0].id)
  await proto.locate(root, demo.issues[1].id) // switch to B without changing A's link
  const session = agents.get(a.sessionId).session
  const events = [evCall(5, 'missed', 'bash', { command: 'echo missed-turn-end' }), evResult(6, 'missed', 'ok\n')]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 7 // simulate plugin missing turn/end, not an emitted event
  assert.equal((await proto.locate(root, demo.issues[0].id)).sessionId, a.sessionId)
  const file = join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`)
  const first = await readFile(file, 'utf8')
  assert.ok(first.includes('执行命令：echo missed-turn-end'))
  assert.equal((await readCursor(root, a.sessionId)).lastSeq, 6)
  await proto.locate(root, demo.issues[0].id)
  assert.equal(await readFile(file, 'utf8'), first)
  assert.equal(prompts.length, 0)
  const bFile = join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[1].id}.md`)
  assert.ok(!(await readFile(bFile, 'utf8')).includes('echo missed-turn-end'))
})

test('从会话侧栏重进时空闲补查，运行中不扫描也不触发请求', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, prompts } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const a = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(a.sessionId)
  const events = [evCall(5, 'missed', 'bash', { command: 'echo sidebar-catchup' }), evResult(6, 'missed', 'ok\n')]
  let scans = 0
  agent.session.snapshotEvents = from => { scans++; return events.filter(e => e.seq >= from) }
  agent.session.seq = 7
  agent.status = 'running'
  await proto.routes['demo/state']({ root, sessionId: a.sessionId })
  assert.equal(scans, 0)
  assert.equal(await readCursor(root, a.sessionId), null)
  agent.status = 'idle'
  const state = await proto.routes['demo/state']({ root, sessionId: a.sessionId })
  assert.equal(state.cursor.lastSeq, 6)
  assert.equal(state.link.unrecorded, true)
  const file = join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`)
  assert.ok((await readFile(file, 'utf8')).includes('执行命令：echo sidebar-catchup'))
  assert.equal(prompts.length, 0)
})

test('漏记提示写入失败不推进游标，恢复后补查不重复事实', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, prompts } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const session = agents.get(located.sessionId).session
  const events = [
    { seq: 4, time: 4, type: 'turn/start', data: { turn: 1 } },
    evCall(5, 'activity', 'bash', { command: 'echo hint-write-retry' }),
    evResult(6, 'activity', 'ok\n'),
    { seq: 7, time: 7, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 8
  const cursors = join(root, '.project', '.local', 'cursors')
  await mkdir(cursors, { recursive: true })
  await writeFile(join(cursors, `${located.sessionId}.json`), JSON.stringify({ lastSeq: 3 }))
  const links = join(root, '.project', '.local', 'links')
  try {
    // Isolate the failure to the final link/hint write, not the objective file
    // or cursor directory; makeRoot uses the local temp filesystem.
    await chmod(links, 0o555)
    await assert.rejects(proto.routes['demo/state']({ root, sessionId: located.sessionId }),
      e => e.code === 'EACCES' || e.code === 'EPERM')
    assert.equal((await readCursor(root, located.sessionId)).lastSeq, 3)
  } finally {
    await chmod(links, 0o755)
  }
  const recovered = await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(recovered.link.unrecorded, true)
  assert.equal(recovered.cursor.lastSeq, 7)
  const file = join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`)
  const after = await readFile(file, 'utf8')
  assert.equal((after.match(/执行命令：echo hint-write-retry/g) ?? []).length, 1)
  await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(await readFile(file, 'utf8'), after)
  assert.equal(prompts.length, 0)
})

test('空闲检查后新回合启动时不提前扫描，回合结束后只记录一次', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(located.sessionId)
  const events = [
    { seq: 4, time: 4, type: 'turn/start', data: { turn: 1 } },
    evCall(5, 'activity', 'bash', { command: 'echo idle-race' }),
    evResult(6, 'activity', 'idle-race\n'),
  ]
  let status = 'idle', armed = true, scans = 0
  Object.defineProperty(agent, 'status', {
    configurable: true,
    get() {
      // First idle check succeeds; the Host starts a turn during the following
      // async link/cursor read, before the proposed snapshot is taken.
      if (armed) { armed = false; queueMicrotask(() => { status = 'running' }) }
      return status
    },
  })
  agent.session.snapshotEvents = from => { scans++; return events.filter(e => e.seq >= from) }
  agent.session.seq = 7
  await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(status, 'running')
  assert.equal(scans, 0) // second idle check prevented a live-turn snapshot
  assert.equal(await readCursor(root, located.sessionId), null)

  events.push(evCall(7, 'note', 'workbench_task_note', { text: 'done' }), evResult(8, 'note', '已记录'),
    { seq: 9, time: 9, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  agent.session.seq = 10
  status = 'idle'
  await emit(listeners, 'session/event', agent.session, events.at(-1))
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 9)
  const link = JSON.parse(await readFile(join(root, '.project', '.local', 'links', `${located.sessionId}.json`), 'utf8'))
  assert.equal(link.unrecorded ?? false, false)
  const file = join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`)
  assert.equal(((await readFile(file, 'utf8')).match(/执行命令：echo idle-race/g) ?? []).length, 1)
})

test('同回合跨段同步后成功记录可清除该回合漏记，不重复客观记录', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(located.sessionId)
  const events = [
    { seq: 4, time: 4, type: 'turn/start', data: { turn: 1 } },
    evCall(5, 'activity', 'bash', { command: 'echo split-turn' }),
    evResult(6, 'activity', 'split-turn\n'),
  ]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 7
  const early = await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(early.link.unrecorded, true)
  events.push(evCall(7, 'note', 'workbench_task_note', { text: 'done' }), evResult(8, 'note', '已记录'),
    { seq: 9, time: 9, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  agent.session.seq = 10
  await emit(listeners, 'session/event', agent.session, events.at(-1))
  const linkFile = join(root, '.project', '.local', 'links', `${located.sessionId}.json`)
  await waitFor(async () => JSON.parse(await readFile(linkFile, 'utf8')).unrecorded === false)
  const file = join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`)
  await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(((await readFile(file, 'utf8')).match(/执行命令：echo split-turn/g) ?? []).length, 1)
})

test('后一回合只有记录调用时不清除前一回合漏记', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(located.sessionId)
  const events = [
    { seq: 4, time: 4, type: 'turn/start', data: { turn: 1 } },
    evCall(5, 'activity', 'bash', { command: 'echo old-unrecorded' }),
    evResult(6, 'activity', 'old-unrecorded\n'),
    { seq: 7, time: 7, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 8
  assert.equal((await proto.routes['demo/state']({ root, sessionId: located.sessionId })).link.unrecorded, true)
  events.push({ seq: 8, time: 8, type: 'turn/start', data: { turn: 2 } },
    { ...evCall(9, 'later-note', 'workbench_task_note', { text: 'different turn' }), data: { ...evCall(9, 'later-note', 'workbench_task_note', { text: 'different turn' }).data, turn: 2 } },
    evResult(10, 'later-note', '已记录'),
    { seq: 11, time: 11, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  agent.session.seq = 12
  await emit(listeners, 'session/event', agent.session, events.at(-1))
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 11)
  const state = await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(state.link.unrecorded, true)
})

test('停止后的迟到命令结果补写客观记录并提示未记', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const session = agents.get(located.sessionId).session
  const events = [
    { seq: 4, time: 4, type: 'turn/start', data: { turn: 1 } },
    evCall(5, 'late', 'bash', { command: 'echo late-after-stop' }),
    { seq: 6, time: 6, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', source: 'user' } } },
    evResult(7, 'late', 'ok\n'),
  ]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 8
  const state = await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(state.link.unrecorded, true)
  assert.equal(state.cursor.lastSeq, 7)
  const file = join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`)
  assert.ok((await readFile(file, 'utf8')).includes('执行命令：echo late-after-stop'))
})

test('同回合成功记录的迟到结果可清除该回合提示', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const session = agents.get(located.sessionId).session
  const events = [
    { seq: 4, time: 4, type: 'turn/start', data: { turn: 1 } },
    evCall(5, 'activity', 'bash', { command: 'echo late-note' }),
    evResult(6, 'activity', 'ok\n'),
    evCall(7, 'note', 'workbench_task_note', { text: 'done' }),
    { seq: 8, time: 8, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', source: 'user' } } },
  ]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 9
  const before = await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(before.link.unrecorded, true)
  assert.ok(before.cursor.lastSeq < 7)
  events.push(evResult(9, 'note', '已记录'))
  session.seq = 10
  const after = await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(after.link.unrecorded, false)
  assert.equal(after.cursor.lastSeq, 9)
  const file = join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`)
  assert.equal(((await readFile(file, 'utf8')).match(/执行命令：echo late-note/g) ?? []).length, 1)
})

test('上一回合的迟到活动不会被后一回合的记录调用掩盖', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const session = agents.get(located.sessionId).session
  const laterNote = evCall(8, 'later-note', 'workbench_task_note', { text: 'other turn' })
  laterNote.data.turn = 2
  const events = [
    { seq: 4, time: 4, type: 'turn/start', data: { turn: 1 } },
    evCall(5, 'late', 'bash', { command: 'echo previous-late' }),
    { seq: 6, time: 6, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', source: 'user' } } },
    { seq: 7, time: 7, type: 'turn/start', data: { turn: 2 } },
    laterNote, evResult(9, 'later-note', '已记录'),
    { seq: 10, time: 10, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
    evResult(11, 'late', 'ok\n'),
  ]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 12
  const state = await proto.routes['demo/state']({ root, sessionId: located.sessionId })
  assert.equal(state.link.unrecorded, true)
})

test('并发人工记录、AI 记录和客观同步不互相覆盖', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents, tools } = stubCtx(root)
  const proto = installPrototype(ctx)
  installTools(ctx, proto.links)
  const demo = await proto.ensureDemoData(root)
  const issueId = demo.issues[0].id
  const located = await proto.locate(root, issueId)
  const agent = agents.get(located.sessionId)
  const events = [evCall(5, 'c1', 'bash', { command: 'echo concurrent-sync' }), evResult(6, 'c1', 'concurrent-sync\n')]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 7
  const aiNote = tools.get('workbench_task_note')
  assert.ok(aiNote)
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await Promise.all(Array.from({ length: 5 }, (_, n) => [
    proto.routes['demo/note']({ root, reqId: demo.reqId, id: issueId, text: `人工并发 ${n}` }),
    aiNote.execute({ text: `AI 并发 ${n}` }, { agent }),
  ]).flat())
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 6)
  const doc = await readFile(join(root, '.project', 'requirements', demo.reqId, 'issues', `${issueId}.md`), 'utf8')
  for (let n = 0; n < 5; n++) {
    assert.ok(doc.includes(`人工操作：人工并发 ${n}`))
    assert.ok(doc.includes(`[AI] AI 并发 ${n}`))
  }
  assert.ok(doc.includes('执行命令：echo concurrent-sync'))
  assert.ok(doc.includes('客观记录同步：'))
})

test('返工1: 并发 runStart 只提交一次请求', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts } = stubCtx(root, { promptDelayMs: 30 })
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const issueId = demo.issues[0].id
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => proto.runStart(root, issueId)))
  assert.equal(prompts.length, 1)
  const started = results.filter(r => r.started)
  assert.equal(started.length, 1)
  for (const r of results) {
    assert.equal(r.runId, started[0].runId)
    assert.ok(r.started || r.alreadyStarting || r.alreadyRunning)
  }
})

test('返工2: 写文件期间到达的新事件不会越过游标', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(located.sessionId)
  let snapshot = [evCall(5, 'c1', 'bash', { command: 'echo one' }), evResult(6, 'c1', 'one\n')]
  agent.session.snapshotEvents = from => snapshot.filter(e => e.seq >= from)
  // seq 已增长到 12：模拟同步写文件期间 7..11 到达，但快照只到 6。
  agent.session.seq = 12
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await waitFor(async () => !!(await readCursor(root, located.sessionId)))
  assert.equal((await readCursor(root, located.sessionId)).lastSeq, 6) // 不是 11
  // 下一次同步必须能补回 7..8 的新活动。
  snapshot = [...snapshot, evCall(7, 'c2', 'bash', { command: 'echo two' }), evResult(8, 'c2', 'two\n')]
  agent.session.seq = 9
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 8)
  const doc = await readFile(join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`), 'utf8')
  assert.ok(doc.includes('echo one'))
  assert.ok(doc.includes('echo two'))
})

test('返工2: 未结算的工具调用挡住游标，结果到达后才推进', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(located.sessionId)
  let snapshot = [evCall(5, 'c1', 'bash', { command: 'echo pending' })] // 结果尚未到达
  agent.session.snapshotEvents = from => snapshot.filter(e => e.seq >= from)
  agent.session.seq = 6
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await new Promise(r => setTimeout(r, 50))
  const c1 = await readCursor(root, located.sessionId)
  assert.ok(!c1 || c1.lastSeq < 5) // 游标不得越过未结算调用
  snapshot = [...snapshot, evResult(6, 'c1', 'pending\n')]
  agent.session.seq = 7
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 6)
  const doc = await readFile(join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`), 'utf8')
  assert.ok(doc.includes('echo pending'))
})

test('未结算调用不阻挡后续已完成活动，迟到结果仍可补回', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(located.sessionId)
  let events = [evCall(5, 'pending', 'bash', { command: 'echo pending' })]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  const end = () => emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  agent.session.seq = 6
  await end()
  await new Promise(r => setTimeout(r, 50))
  // The first result may never arrive, but a later complete command is still recorded.
  events = [...events, evCall(7, 'later', 'bash', { command: 'echo later' }), evResult(8, 'later', 'later\n')]
  agent.session.seq = 9
  await end()
  const file = join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`)
  await waitFor(async () => (await readFile(file, 'utf8')).includes('echo later'))
  const c1 = await readCursor(root, located.sessionId)
  assert.ok(!c1 || c1.lastSeq < 5)
  // If the old result eventually arrives it is paired, and later facts are not duplicated.
  events = [...events, evResult(9, 'pending', 'pending\n')]
  agent.session.seq = 10
  await end()
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 9)
  const doc = await readFile(file, 'utf8')
  assert.equal((doc.match(/执行命令：echo later/g) ?? []).length, 1)
  assert.equal((doc.match(/执行命令：echo pending/g) ?? []).length, 1)
})

test('返工2: 无活动的新范围不清除既有漏记提示；旧 turn/end 不释放新执行锁', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(located.sessionId)
  // 有活动、无成功记录 → unrecorded=true（normal.jsonl 无 workbench 记录）。
  agent.session.snapshotEvents = from => fixtureEvents.filter(e => e.seq >= from)
  agent.session.seq = fixtureEvents[fixtureEvents.length - 1].seq + 1
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } })
  const linkPath = join(root, '.project', '.local', 'links', `${located.sessionId}.json`)
  const readLink = async () => JSON.parse(await readFile(linkPath, 'utf8'))
  await waitFor(async () => (await readLink()).unrecorded === true)
  // 新范围只有聊天、无活动 → 提示保留。
  agent.session.snapshotEvents = from => [{ seq: 300, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '聊天' }] } }].filter(e => e.seq >= from)
  agent.session.seq = 301
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 5, reason: { kind: 'completed' } } })
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 300)
  assert.equal(JSON.parse(await readFile(linkPath, 'utf8')).unrecorded, true)
  // 新执行的锁（sinceSeq 在本 turn/end 之后）不得被旧同步释放。
  const lockPath = join(root, '.project', '.local', 'runs', `${demo.issues[0].id}.json`)
  const { writeFile: wf, mkdir: md } = await import('node:fs/promises')
  await md(dirname(lockPath), { recursive: true })
  await wf(lockPath, JSON.stringify({ runId: 'new-run', sessionId: located.sessionId, state: 'running', sinceSeq: 400 }))
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 5, reason: { kind: 'completed' } } })
  await new Promise(r => setTimeout(r, 50))
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).runId, 'new-run')
})

test('返工4: 报错回合（turn/end error）保存记录且不提交新请求', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents, prompts } = stubCtx(root)
  const proto = installPrototype(ctx)
  const demo = await proto.ensureDemoData(root)
  const located = await proto.locate(root, demo.issues[0].id)
  const agent = agents.get(located.sessionId)
  agent.session.snapshotEvents = from => [evCall(5, 'c1', 'bash', { command: 'echo before-error' }), evResult(6, 'c1', 'before-error\n')].filter(e => e.seq >= from)
  agent.session.seq = 7
  await emit(listeners, 'session/event', agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: 'model request failed' } } })
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 6)
  const doc = await readFile(join(root, '.project', 'requirements', demo.reqId, 'issues', `${demo.issues[0].id}.md`), 'utf8')
  assert.ok(doc.includes('echo before-error'))
  assert.equal(prompts.length, 0) // 报错后不自动续跑
  await waitFor(async () => { try { return JSON.parse(await readFile(join(root, '.project', '.local', 'links', `${located.sessionId}.json`), 'utf8')).unrecorded === true } catch { return false } })
})
