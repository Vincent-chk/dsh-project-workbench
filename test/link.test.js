// Stage-2 link layer: formal link/get/set/clear/listSessions, task/locate, run/start,
// project ownership, and sync-before-switch (tech §4). Stub Host; real store + files.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { installLinks } from '../core/link.js'
import * as store from '../core/store.js'
import { makeRoot, seedAIReview, issueFileHash, seedReviewPrd, startTestDevelopment } from './util.js'

function stubCtx() {
  const listeners = {}
  const agents = new Map()
  const prompts = []
  let created = 0
  const ctx = {
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    on(name, fn) { (listeners[name] ??= []).push(fn); return () => {} },
    tools: { guard: () => () => {}, register: () => () => {} },
    agents: { get: sid => agents.get(sid) },
    sessions: { get: sid => agents.get(sid)?.session },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      create: async ({ cwd } = {}) => {
        const sessionId = `session-stub-${++created}`
        const session = { id: sessionId, header: { cwd }, seq: 0, snapshotEvents: () => [] }
        agents.set(sessionId, { session, status: 'idle' })
        return { sessionId }
      },
      prompt: async request => { prompts.push(request); const a = agents.get(request.sessionId); if (a) a.status = 'running'; return { accepted: true } },
      cancel: async ({ sessionId }) => { const a = agents.get(sessionId); if (a) a.status = 'idle'; return { accepted: true } },
    },
    logger: { warn: () => {} },
  }
  return { ctx, listeners, agents, prompts }
}
const emit = (listeners, name, ...args) => Promise.all((listeners[name] ?? []).map(fn => fn(...args)))
const waitFor = async fn => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 10)) } throw new Error('waitFor timeout') }

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
  await store.updateIssue(root, reqId, data.id, { problemOverview: 'p', triggerPath: 't', acceptance: 'a' })
  return data.id
}
const readLink = async (root, sid) => JSON.parse(await readFile(join(root, '.project', '.local', 'links', `${sid}.json`), 'utf8'))

test('task runs and status changes wait for a partially saved requirement reopen', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const issueId = await fullIssue(root, reqId)
  const { sessionId } = await links.locate(root, issueId)
  const file = join(root, '.project', 'requirements', reqId, 'requirement.md')
  const original = await readFile(file, 'utf8')
  const plan = { atMs: Date.now(), reason: '接续返工', items: [{ id: issueId, action: 'reopen', done: false }] }
  await writeFile(file, original.replace(/^status: in_progress$/mu, `status: in_progress\npendingReopen: ${JSON.stringify(JSON.stringify(plan))}`))
  await assert.rejects(links.runStart(root, issueId, sessionId), { code: 'REOPEN_PENDING' })
  assert.equal(prompts.length, 0)
  await assert.rejects(store.moveIssue(root, reqId, issueId, 'blocked', { blockedReason: '等待任务就绪' }), { code: 'REOPEN_PENDING' })
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].status, 'todo')
})

test('link/set + get + listSessions + clear with project ownership', async t => {
  const root = await makeRoot(t)
  const { ctx } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const located = await links.locate(root, a)
  const sid = located.sessionId
  assert.equal((await links.getLink(root, sid)).link.issueId, a)
  // Switch to B on the same session.
  const switched = await links.changeLink(root, sid, b)
  assert.equal(switched.link.issueId, b)
  assert.equal(switched.link.reqId, reqId)
  assert.equal((await links.listSessions(root, b)).sessions.length, 1)
  assert.equal((await links.listSessions(root, a)).sessions.length, 0)
  // Clear.
  const cleared = await links.changeLink(root, sid, null)
  assert.equal(cleared.cleared, true)
  assert.equal((await links.getLink(root, sid)).link, null)
})

test('cross-project link is rejected; a session keeps its own workspace', async t => {
  const rootA = await makeRoot(t)
  const rootB = await makeRoot(t)
  const { ctx } = stubCtx()
  const links = installLinks(ctx)
  const reqA = await devReq(rootA, 'A')
  const issA = await fullIssue(rootA, reqA)
  const reqB = await devReq(rootB, 'B')
  const issB = await fullIssue(rootB, reqB)
  const located = await links.locate(rootA, issA)
  // Session belongs to A; trying to link it to B's task is a workspace mismatch.
  await assert.rejects(links.changeLink(rootB, located.sessionId, issB), e => e.code === 'WORKSPACE_MISMATCH')
  // B's own link directory has no record of A's session.
  assert.equal((await links.getLink(rootB, located.sessionId)).link, null)
  assert.equal((await links.getLink(rootA, located.sessionId)).link.issueId, issA)
})

test('switch waits for idle, syncs the original task first, then re-links', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const located = await links.locate(root, a)
  const agent = agents.get(located.sessionId)
  // A real turn with a confirmed command on task A.
  const events = [
    { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'echo task-a-work' }) } },
    { seq: 3, time: 3, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'task-a-work\n' }] } } },
    { seq: 4, time: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 5
  agent.status = 'running'
  // Running session cannot switch.
  await assert.rejects(links.changeLink(root, located.sessionId, b), e => e.code === 'SESSION_BUSY')
  agent.status = 'idle'
  await links.changeLink(root, located.sessionId, b)
  const aFile = join(root, '.project', 'requirements', reqId, 'issues', `${a}.md`)
  assert.ok((await readFile(aFile, 'utf8')).includes('执行命令：echo task-a-work')) // synced to A
  const bFile = join(root, '.project', 'requirements', reqId, 'issues', `${b}.md`)
  assert.ok(!(await readFile(bFile, 'utf8')).includes('echo task-a-work')) // not leaked to B
  assert.equal((await readLink(root, located.sessionId)).issueId, b)
})

test('a failed sync keeps the original link', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const located = await links.locate(root, a)
  const agent = agents.get(located.sessionId)
  const events = [
    { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'echo fail-sync' }) } },
    { seq: 3, time: 3, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok\n' }] } } },
    { seq: 4, time: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 5
  const issuesDir = join(root, '.project', 'requirements', reqId, 'issues')
  await chmod(issuesDir, 0o500) // objective write fails → sync fails
  try {
    await assert.rejects(links.changeLink(root, located.sessionId, b), e => e.code === 'EACCES')
  } finally { await chmod(issuesDir, 0o700) }
  assert.equal((await readLink(root, located.sessionId)).issueId, a) // original kept
  // After recovery the switch succeeds.
  await links.changeLink(root, located.sessionId, b)
  assert.equal((await readLink(root, located.sessionId)).issueId, b)
})

test('run/start enforces requirement stage and pre-start fields', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  // A title-only legacy task still needs the overview and criteria.
  const { data: bare } = await store.createIssue(root, reqId, '缺信息')
  await assert.rejects(links.runStart(root, bare.id), e => e.code === 'MISSING_START_FIELDS')
  assert.equal(prompts.length, 0)
  // A legacy description is enough for the overview, and steps are optional.
  await store.updateIssue(root, reqId, bare.id, { description: '旧说明', acceptance: '核对结果' })
  const ok = bare.id
  const started = await links.runStart(root, ok)
  assert.ok(started.started)
  assert.equal(prompts.length, 1)
  assert.equal((await store.scanProject(root)).requirements[0].issues.find(i => i.id === ok).status, 'todo') // admission alone may be queued
  // A requirement that left development cannot start tasks.
  const req2 = await devReq(root, '第二需求')
  const iss2 = await fullIssue(root, req2, '完成它')
  await store.updateIssue(root, req2, iss2, { resultSummary: 'r', evidence: 'e' })
  await store.moveIssue(root, req2, iss2, 'done', { fileHash: await issueFileHash(root, req2, iss2) })
  await store.submitRequirement(root, req2, { summary: 's' })
  await assert.rejects(links.runStart(root, iss2), e => e.code === 'REQ_NOT_ACTIVE')
})

test('task/locate is view-only: works for incomplete info and completed requirements', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const { data: bare } = await store.createIssue(root, reqId, '只有标题')
  const located = await links.locate(root, bare.id) // no pre-start check
  assert.ok(located.created)
  assert.equal(prompts.length, 0)
  // Complete the requirement; locate still opens the task.
  await store.updateIssue(root, reqId, bare.id, { problemOverview: 'p', triggerPath: 't', acceptance: 'a', resultSummary: 'r', evidence: 'e' })
  await store.moveIssue(root, reqId, bare.id, 'done', { fileHash: await issueFileHash(root, reqId, bare.id) })
  await store.submitRequirement(root, reqId, { summary: 's' })
  await store.moveRequirement(root, reqId, 'completed', { opinion: 'ok' })
  const again = await links.locate(root, bare.id)
  assert.equal(again.sessionId, located.sessionId)
  assert.equal(prompts.length, 0)
})

test('formal routes dispatch through the single envelope shape', async t => {
  const root = await makeRoot(t)
  const { ctx } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId)
  const located = await links.routes['task/locate']({ root, issueId: a })
  const got = await links.routes['link/get']({ root, sessionId: located.sessionId })
  assert.equal(got.link.issueId, a)
  const started = await links.routes['run/start']({ root, issueId: a })
  assert.ok(started.started)
  const sessions = await links.routes['link/listSessions']({ root, issueId: a })
  assert.equal(sessions.sessions.length, 1)
})

// ---- 返工 1：执行锁与切换 ----

const runPath = (root, iss) => join(root, '.project', '.local', 'runs', `${iss}.json`)
const exists = async p => { try { await readFile(p); return true } catch { return false } }

test('unclear acceptance keeps the lock and retries with the SAME requestId', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const iss = await fullIssue(root, reqId)
  let fail = true
  ctx.sessionController.prompt = async req => {
    prompts.push(req)
    if (fail) { const e = new Error('network dropped'); e.code = 'ECONNRESET'; throw e }
    agents.get(req.sessionId).status = 'running'
    return { accepted: true }
  }
  const first = await links.runStart(root, iss)
  assert.ok(first.uncertain)
  assert.equal(await exists(runPath(root, iss)), true) // lock kept
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].status, 'todo') // not started
  fail = false
  const second = await links.runStart(root, iss)
  assert.ok(second.started)
  assert.equal(second.runId, first.runId) // SAME id, no duplicate request
  assert.equal(prompts.length, 2)
  assert.equal(prompts[1].requestId, first.runId)
})

test('explicit host refusal does not mark the task doing and releases the lock', async t => {
  const root = await makeRoot(t)
  const { ctx } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const iss = await fullIssue(root, reqId)
  ctx.sessionController.prompt = async () => { const e = new Error('busy'); e.code = 'session/agent-busy'; throw e }
  await assert.rejects(links.runStart(root, iss), e => e.code === 'PROMPT_REJECTED')
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].status, 'todo') // NOT doing
  assert.equal(await exists(runPath(root, iss)), false)
})

test('a cold session (not in memory) does not release a running lock', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const iss = await fullIssue(root, reqId)
  const started = await links.runStart(root, iss)
  agents.delete(started.sessionId) // session leaves memory; lock remains
  const again = await links.runStart(root, iss)
  assert.ok(again.alreadyRunning)
  assert.equal(again.runId, started.runId)
  assert.equal(await exists(runPath(root, iss)), true)
})

test('an unrelated turn/end does not release the run lock', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const iss = await fullIssue(root, reqId)
  const started = await links.runStart(root, iss)
  const agent = agents.get(started.sessionId)
  agent.status = 'idle'
  // A different turn ended; this run's request message is absent.
  agent.session.snapshotEvents = () => [{ seq: 9, time: 1, type: 'turn/end', data: { turn: 99, reason: { kind: 'completed' } } }]
  const again = await links.runStart(root, iss)
  assert.ok(again.alreadyRunning)
  assert.equal(await exists(runPath(root, iss)), true)
})

test('after switching a session to B, starting A never prompts into B’s session', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const located = await links.locate(root, a)
  const sid = located.sessionId
  await links.changeLink(root, sid, b) // session now belongs to B
  const started = await links.runStart(root, a) // A must get its own session
  assert.ok(started.started)
  assert.notEqual(started.sessionId, sid)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].sessionId, started.sessionId)
  assert.equal((await links.getLink(root, sid)).link.issueId, b) // B unchanged
})

test('rightbar run/start uses the specified current session, not a newer link for the same task', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const issueId = await fullIssue(root, reqId)
  const current = await links.locate(root, issueId)
  const newerSid = 'session-newer-for-same-task'
  agents.set(newerSid, { session: { id: newerSid, header: { cwd: root }, seq: 0, snapshotEvents: () => [] }, status: 'idle' })
  const dir = join(root, '.project', '.local', 'links')
  await writeFile(join(dir, `${newerSid}.json`), JSON.stringify({ sessionId: newerSid, issueId, reqId, linkedAt: new Date(Date.now() + 1000).toISOString(), startSeq: 0 }))

  const started = await links.runStart(root, issueId, current.sessionId)
  assert.ok(started.started)
  assert.equal(started.sessionId, current.sessionId)
  assert.deepEqual(prompts.map(request => request.sessionId), [current.sessionId])
  await assert.rejects(links.runStart(root, issueId, 'session-without-this-link'), e => e.code === 'LINK_CHANGED')
  assert.equal(prompts.length, 1)
})

test('runtime facts and task navigation use the session owning the active run', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const issueId = await fullIssue(root, reqId)
  const current = await links.locate(root, issueId)
  const newerSid = 'session-newer-idle'
  agents.set(newerSid, { session: { id: newerSid, header: { cwd: root }, seq: 0, snapshotEvents: () => [] }, status: 'idle' })
  await writeFile(join(root, '.project', '.local', 'links', `${newerSid}.json`), JSON.stringify({
    sessionId: newerSid, issueId, reqId, linkedAt: new Date(Date.now() + 1000).toISOString(), startSeq: 0,
  }))

  await links.runStart(root, issueId, current.sessionId)
  const active = await links.routes['run/list']({ root })
  assert.equal(active.runs.length, 1)
  assert.equal(active.runs[0].sessionId, current.sessionId)
  assert.deepEqual(active.runs[0].sessionIds, [newerSid, current.sessionId])
  assert.equal(active.runs[0].sessionRunning, true)
  assert.equal(active.runs[0].runState, 'running')
  assert.equal((await links.routes['task/locate']({ root, issueId })).sessionId, current.sessionId)

  // When the execution ends, the ordinary most-recent association wins again.
  await fs.rm(links.runFile(root, issueId))
  const idle = await links.routes['run/list']({ root })
  assert.equal(idle.runs[0].sessionId, newerSid)
  assert.equal(idle.runs[0].runState, null)
  assert.equal((await links.routes['task/locate']({ root, issueId })).sessionId, newerSid)
})

test('locating a specific linked session rejects stale and cross-project associations', async t => {
  const rootA = await makeRoot(t)
  const rootB = await makeRoot(t)
  const { ctx } = stubCtx()
  const links = installLinks(ctx)
  const reqA = await devReq(rootA)
  const issueA = await fullIssue(rootA, reqA, 'A')
  const other = await fullIssue(rootA, reqA, 'other')
  const reqB = await devReq(rootB)
  const issueB = await fullIssue(rootB, reqB, 'B')
  const { sessionId } = await links.locate(rootA, issueA)
  assert.equal((await links.routes['task/locate']({ root: rootA, issueId: issueA, sessionId })).sessionId, sessionId)

  await links.changeLink(rootA, sessionId, other)
  await assert.rejects(links.routes['task/locate']({ root: rootA, issueId: issueA, sessionId }), { code: 'LINK_CHANGED' })
  await assert.rejects(links.routes['task/locate']({ root: rootB, issueId: issueB, sessionId }), { code: 'LINK_CHANGED' })
  // Even an invalid persisted association cannot redirect a live session across projects.
  await mkdir(join(rootB, '.project', '.local', 'links'), { recursive: true })
  await writeFile(join(rootB, '.project', '.local', 'links', `${sessionId}.json`), JSON.stringify({ sessionId, reqId: reqB, issueId: issueB }))
  await assert.rejects(links.routes['task/locate']({ root: rootB, issueId: issueB, sessionId }), { code: 'WORKSPACE_MISMATCH' })
  await assert.rejects(links.routes['task/locate']({ root: rootA, issueId: issueA, sessionId: '../outside' }), { code: 'LINK_CHANGED' })
})

test('locate reuses the most recent available session for a task', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId)
  const older = await links.locate(root, a)
  // A second, newer link for the same task (e.g. created elsewhere).
  const newerSid = 'session-newer'
  agents.set(newerSid, { session: { id: newerSid, header: { cwd: root }, seq: 0, snapshotEvents: () => [] }, status: 'idle' })
  const dir = join(root, '.project', '.local', 'links')
  await writeFile(join(dir, `${newerSid}.json`), JSON.stringify({ sessionId: newerSid, issueId: a, reqId, linkedAt: new Date(Date.now() + 1000).toISOString(), startSeq: 0 }))
  const located = await links.locate(root, a)
  assert.equal(located.sessionId, newerSid) // most recent, not directory-first
  assert.ok(located.reused)
})

test('late-settling records are synced to the original task before switching', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const located = await links.locate(root, a)
  const agent = agents.get(located.sessionId)
  const base = [
    { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'echo early' }) } },
    { seq: 3, time: 3, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'early\n' }] } } },
  ]
  const late = [
    { seq: 4, time: 4, type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'bash', arguments: JSON.stringify({ command: 'echo late' }) } },
    { seq: 5, time: 5, type: 'tool/result', data: { turn: 1, step: 2, message: { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'late\n' }] } } },
    { seq: 6, time: 6, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  let synced = false
  agent.session.snapshotEvents = from => { const evs = synced ? [...base, ...late] : base; synced = true; return evs.filter(e => e.seq >= from) }
  // The log end advances once the late records settle after the first sync.
  Object.defineProperty(agent.session, 'seq', { configurable: true, get() { return synced ? 7 : 4 } })
  await links.changeLink(root, located.sessionId, b)
  const aFile = join(root, '.project', 'requirements', reqId, 'issues', `${a}.md`)
  const aDoc = await readFile(aFile, 'utf8')
  assert.ok(aDoc.includes('echo early'))
  assert.ok(aDoc.includes('echo late')) // late record captured before the switch
  const bFile = join(root, '.project', 'requirements', reqId, 'issues', `${b}.md`)
  assert.ok(!(await readFile(bFile, 'utf8')).includes('echo late'))
  assert.equal((await readLink(root, located.sessionId)).issueId, b)
})

// ---- 第二轮返工 1：占锁/排队/归属/取消竞态 ----

test('a queued or running request blocks switching the session', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const located = await links.locate(root, a)
  // A held run lock (queued/running) for the original task blocks the switch.
  const runsDir = join(root, '.project', '.local', 'runs')
  await mkdir(runsDir, { recursive: true })
  await writeFile(join(runsDir, `${a}.json`), JSON.stringify({ runId: 'r1', sessionId: located.sessionId, state: 'running', since: Date.now(), sinceSeq: 0 }))
  agents.get(located.sessionId).status = 'idle'
  await assert.rejects(links.changeLink(root, located.sessionId, b), e => e.code === 'SESSION_BUSY')
  assert.equal((await readLink(root, located.sessionId)).issueId, a) // unchanged
})

test('after a re-link, a retry does not submit the same request ID to two sessions', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId)
  let fail = true
  ctx.sessionController.prompt = async req => {
    prompts.push(req)
    if (fail) { const e = new Error('dropped'); e.code = 'ECONNRESET'; throw e }
    agents.get(req.sessionId).status = 'running'
    return { accepted: true }
  }
  const first = await links.runStart(root, a) // uncertain; lock on session 1
  assert.ok(first.uncertain)
  const s1 = first.sessionId
  // The task gets a NEW session link (e.g. user re-located elsewhere).
  fail = false
  const s2 = 'session-second'
  agents.set(s2, { session: { id: s2, header: { cwd: root }, seq: 0, snapshotEvents: () => [] }, status: 'idle' })
  const dir = join(root, '.project', '.local', 'links')
  await writeFile(join(dir, `${s2}.json`), JSON.stringify({ sessionId: s2, issueId: a, reqId, linkedAt: new Date(Date.now() + 1000).toISOString(), startSeq: 0 }))
  const second = await links.runStart(root, a)
  assert.ok(second.alreadyStarting)
  assert.equal(second.sessionId, s1)
  assert.equal(second.runId, first.runId)
  assert.equal(prompts[0].sessionId, s1)
  assert.equal(prompts.length, 1)
})

test('a task with a held run lock cannot be cancelled until the run ends', async t => {
  const root = await makeRoot(t)
  const { ctx } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId)
  const started = await links.runStart(root, a)
  assert.ok(started.started)
  // Cancel checks the run lock → rejected while the run is held.
  await assert.rejects(store.moveIssue(root, reqId, a, 'cancelled', { reason: 'x' }), e => e.code === 'RUNNING')
})

// ---- 第二轮返工 2：旧事件补查不刷新过期结果 ----

test('catching up old objective events does not refresh a stale result', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId)
  await store.updateIssue(root, reqId, a, { resultSummary: 'r', evidence: 'e' })
  await store.moveIssue(root, reqId, a, 'done', { fileHash: await issueFileHash(root, reqId, a) })
  await store.submitRequirement(root, reqId, { summary: 's' })
  await store.reopenRequirement(root, reqId, { reason: '打回', reopen: [a] })
  const del = (await store.scanProject(root)).requirements[0].issues.find(i => i.id === a).deliveryStartedAt
  const located = await links.locate(root, a)
  const agent = agents.get(located.sessionId)
  const oldTime = del - 100000 // events from BEFORE this delivery
  const events = [
    { seq: 1, time: oldTime, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: oldTime, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'echo old' }) } },
    { seq: 3, time: oldTime, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'old\n' }] } } },
    { seq: 4, time: oldTime, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 5
  await links.catchUpIdle(root, located.sessionId)
  const issue = (await store.scanProject(root)).requirements[0].issues.find(i => i.id === a)
  assert.ok(issue.hasObjective) // objective evidence recorded
  assert.equal(issue.resultFresh, false) // but it predates this delivery → still stale
})

test('queued request is not marked started and cancellation permits switching', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const events = []
  ctx.sessionController.prompt = async req => {
    events.push({ seq: 0, type: 'agent/inbox/spliced', data: {
      target: 'next-turn', start: 0, inserted: [{ id: 'm', source: { rpcId: req.requestId } }],
    } })
    return { accepted: true }
  }
  const located = await links.locate(root, a)
  const session = agents.get(located.sessionId).session
  session.snapshotEvents = (from = 0) => events.filter(e => e.seq >= from)
  Object.defineProperty(session, 'seq', { get: () => events.length })
  await links.runStart(root, a)
  assert.equal((await store.scanProject(root)).requirements[0].issues.find(i => i.id === a).status, 'todo')
  await assert.rejects(links.changeLink(root, located.sessionId, b), e => e.code === 'SESSION_BUSY')
  events.push({ seq: 1, type: 'agent/inbox/spliced', data: {
    target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled',
  } })
  assert.equal((await links.changeLink(root, located.sessionId, b)).link.issueId, b)
})

test('a stopped run with an abandoned PTC call can switch and unlink', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const { sessionId } = await links.locate(root, a)
  const agent = agents.get(sessionId)
  const events = []
  const push = (type, data) => events.push({ seq: events.length, time: Date.now(), type, data })
  agent.session.snapshotEvents = (from = 0) => events.filter(e => e.seq >= from)
  Object.defineProperty(agent.session, 'seq', { get: () => events.length })

  for (const [turn, current, target] of [[1, a, b], [2, b, null]]) {
    const { runId } = await links.runStart(root, current)
    push('turn/start', { turn })
    push('user/message', { source: { kind: 'user', rpcId: runId } })
    push('tool/call', { turn, callId: `exec-${turn}`, name: 'run_code', arguments: '{}' })
    push('tool/ptc-dispatch-start', { parentCallId: `exec-${turn}`, subCallId: `done-${turn}`, name: 'edit', arguments: JSON.stringify({ file_path: `saved-${turn}.txt` }) })
    push('tool/ptc-dispatch', { subCallId: `done-${turn}`, content: [{ type: 'text', text: 'updated' }] })
    push('tool/ptc-dispatch-start', { parentCallId: `exec-${turn}`, subCallId: `abandoned-${turn}`, name: 'edit', arguments: '{"file_path":"abandoned.txt"}' })
    push('tool/result', { message: { toolCallId: `exec-${turn}`, content: [] } })
    push('turn/end', { turn, reason: { kind: 'aborted' } })
    agent.status = 'idle'

    const changed = await links.changeLink(root, sessionId, target)
    assert.equal(changed.link?.issueId ?? null, target)
    await assert.rejects(readFile(links.runFile(root, current), 'utf8'), { code: 'ENOENT' })
    const file = join(root, '.project', 'requirements', reqId, 'issues', `${current}.md`)
    const doc = await readFile(file, 'utf8')
    assert.match(doc, new RegExp(`saved-${turn}\\.txt`))
    assert.doesNotMatch(doc, /abandoned\.txt/)
  }
})

test('cold completed request is reconciled from durable host observation', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, prompts } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const issueId = await fullIssue(root, reqId)
  ctx.sessionController.prompt = async request => {
    prompts.push(request)
    if (prompts.length === 1) throw new Error('lost acknowledgement')
    return { accepted: true }
  }
  const first = await links.runStart(root, issueId)
  const agent = agents.get(first.sessionId)
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'user/message', data: { source: { rpcId: first.runId } } },
    { seq: 2, type: 'turn/end', data: { turn: 1 } },
  ]
  ctx.sessionQuery = { observeSession: async () => ({ header: agent.session.header, events, [Symbol.dispose]() {} }) }
  agents.delete(first.sessionId)
  const again = await links.runStart(root, issueId)
  assert.ok(again.started)
  assert.notEqual(again.runId, first.runId)
  assert.equal(prompts.length, 2)
})

test('run reservation waits for an in-flight task cancellation to commit', async t => {
  const root = await makeRoot(t)
  const { ctx, prompts } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const issueId = await fullIssue(root, reqId)
  await links.locate(root, issueId)
  let release, entered
  const held = new Promise(resolve => { entered = resolve })
  const resume = new Promise(resolve => { release = resolve })
  const issueFile = join(root, '.project', 'requirements', reqId, 'issues', `${issueId}.md`)
  const realReadFile = fs.readFile
  const realRealpath = fs.realpath
  let intercepted = false
  fs.readFile = async (file, ...args) => {
    if (file === issueFile && !intercepted) {
      intercepted = true
      entered()
      await resume
    }
    return realReadFile(file, ...args)
  }
  let startEnteredLock
  const startAtLock = new Promise(resolve => { startEnteredLock = resolve })
  syncBuiltinESMExports()
  try {
    // Pause the cancellation after it has entered the requirement lock. Calling
    // moveIssue alone does not guarantee queue order: canonicalization is async.
    const cancellation = store.moveIssue(root, reqId, issueId, 'cancelled', { reason: '不需要' })
    await held
    fs.realpath = async (...args) => {
      const result = await realRealpath(...args)
      // The queue continuation runs as a microtask before this event-loop turn.
      setImmediate(startEnteredLock)
      return result
    }
    syncBuiltinESMExports()
    const start = assert.rejects(links.runStart(root, issueId), e => e.code === 'INVALID_STATE')
    await Promise.race([startAtLock, start.then(() => { throw new Error('run settled before reaching the requirement lock') })])
    assert.equal(prompts.length, 0)
    await assert.rejects(readFile(links.runFile(root, issueId), 'utf8'), { code: 'ENOENT' })
    release()
    await cancellation
    await start
    assert.equal(prompts.length, 0)
  } finally {
    release()
    fs.readFile = realReadFile
    fs.realpath = realRealpath
    syncBuiltinESMExports()
  }
})

test('events arriving during link commit keep the original association', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const { sessionId } = await links.locate(root, a)
  const session = agents.get(sessionId).session
  const events = []
  session.snapshotEvents = (from = 0) => events.filter(e => e.seq >= from)
  Object.defineProperty(session, 'seq', { get: () => events.length })
  const realRename = fs.rename
  const file = join(root, '.project', '.local', 'links', `${sessionId}.json`)
  let injected = false
  fs.rename = async (from, to) => {
    if (to === file && !injected) {
      injected = true
      events.push(
        { seq: 0, time: Date.now(), type: 'tool/call', data: { turn: 1, callId: 'late', name: 'bash', arguments: JSON.stringify({ command: 'echo original' }) } },
        { seq: 1, time: Date.now(), type: 'tool/result', data: { turn: 1, message: { toolCallId: 'late', content: [{ type: 'text', text: 'ok' }] } } },
        { seq: 2, time: Date.now(), type: 'turn/end', data: { turn: 1 } },
      )
    }
    return realRename(from, to)
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(links.changeLink(root, sessionId, b), e => e.code === 'SYNC_UNSTABLE')
  } finally {
    fs.rename = realRename
    syncBuiltinESMExports()
  }
  assert.equal((await links.getLink(root, sessionId)).link.issueId, a)
  await links.changeLink(root, sessionId, b)
  const issues = (await store.scanProject(root)).requirements[0].issues
  assert.equal(issues.find(i => i.id === a).hasObjective, true)
  assert.equal(issues.find(i => i.id === b).hasObjective, false)
})

test('run/list reports runtime facts for the whole project without writing', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  // Empty project: no links or runs yet.
  assert.deepEqual(await links.routes['run/list']({ root }), { runs: [] })
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const located = await links.routes['task/locate']({ root, issueId: a })
  const before = await links.routes['run/list']({ root })
  assert.equal(before.runs.length, 1)
  assert.equal(before.runs[0].issueId, a)
  assert.equal(before.runs[0].reqId, reqId)
  assert.equal(before.runs[0].sessionId, located.sessionId)
  assert.equal(before.runs[0].runState, null)
  assert.equal(before.runs[0].sessionLive, true)
  // Start a run: the lock state surfaces, and the session is reported running.
  await links.routes['run/start']({ root, issueId: a })
  const after = await links.routes['run/list']({ root })
  assert.equal(after.runs[0].runState, 'running')
  assert.equal(after.runs[0].sessionRunning, true)
  assert.ok(after.runs[0].runSince > 0)
  // A cold (unloaded) session is still listed from the durable link, not live.
  agents.delete(located.sessionId)
  const cold = await links.routes['run/list']({ root })
  assert.equal(cold.runs[0].sessionLive, false)
  assert.equal(cold.runs[0].issueId, a)
})

test('run/list exposes only unresolved current-turn approval request metadata from linked live sessions in this workspace', async t => {
  const root = await makeRoot(t)
  const otherRoot = await makeRoot(t)
  const { ctx, agents } = stubCtx()
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const issueId = await fullIssue(root, reqId)
  const { sessionId } = await links.locate(root, issueId)
  const agent = agents.get(sessionId)
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'approval/asked', time: 10, data: { id: 'stale', callId: 'old', toolName: 'bash' } },
    { type: 'turn/end', data: { turn: 1 } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'approval/asked', time: 20, data: { id: 'resolved', callId: 'one', toolName: 'bash', reason: 'private reason' } },
    { type: 'approval/decided', data: { id: 'resolved', outcome: 'rejected' } },
    { type: 'approval/asked', time: 30, data: { id: 'open', callId: 'two', toolName: 'bash', reason: 'private reason' } },
    { type: 'approval/asked', time: 40, data: { id: 'without-call', toolName: 'bash' } },
    { type: 'approval/asked', time: 50, data: { id: 'duplicate', callId: 'three', toolName: 'read' } },
    { type: 'approval/asked', time: 51, data: { id: 'duplicate', callId: 'three', toolName: 'read' } },
  ]
  agent.session.snapshotEvents = () => events
  const readRequests = async () => (await links.routes['run/list']({ root })).runs[0].approvalRequests
  assert.deepEqual(await readRequests(), [{ sessionId, approvalId: 'open', callId: 'two', toolName: 'bash', askedAt: 30 }])
  // A link cannot borrow an identically named live session from another project.
  agent.session.header.cwd = otherRoot
  assert.deepEqual(await readRequests(), [])
  agent.session.header.cwd = root
  events.push({ type: 'approval/decided', data: { id: 'open' } })
  assert.deepEqual(await readRequests(), [])
  events.push({ type: 'approval/asked', time: 60, data: { id: 'abandoned', callId: 'two', toolName: 'bash' } },
    { type: 'turn/end', data: { turn: 2 } })
  assert.deepEqual(await readRequests(), [])
  agents.delete(sessionId)
  assert.deepEqual(await readRequests(), [])
})

test('run/list reports unreadable or invalid runtime data instead of an empty list', async t => {
  const root = await makeRoot(t)
  const { ctx } = stubCtx()
  const links = installLinks(ctx)
  const local = join(root, '.project', '.local')
  await mkdir(join(local, 'links'), { recursive: true })
  await writeFile(join(local, 'runs'), 'not a directory')
  await assert.rejects(links.routes['run/list']({ root }))
  await fs.rm(join(local, 'runs'))
  await writeFile(join(local, 'links', 'broken.json'), '{')
  await assert.rejects(links.routes['run/list']({ root }))
  await fs.rm(join(local, 'links', 'broken.json'))
  await writeFile(join(local, 'links', '._metadata.json'), 'not JSON')
  assert.deepEqual(await links.routes['run/list']({ root }), { runs: [] })
  const linkPath = join(local, 'links', 'session.json')
  const oldLink = { sessionId: 'session', issueId: 'issue', reqId: 'requirement', linkedAt: '2026-01-01T00:00:00.000Z', startSeq: 0 }
  for (const value of [null, [], {}, { ...oldLink, reqId: undefined }, { ...oldLink, sessionId: '' }]) {
    await writeFile(linkPath, JSON.stringify(value))
    await assert.rejects(links.routes['run/list']({ root }), { code: 'READ_FAILED' })
  }
  await writeFile(linkPath, JSON.stringify(oldLink))
  const runsDir = join(local, 'runs')
  await mkdir(runsDir)
  const runPath = join(runsDir, 'issue.json')
  const oldRun = { runId: 'run', sessionId: 'session', state: 'running', since: 123 }
  for (const value of [null, [], {}, { ...oldRun, state: undefined }, { ...oldRun, runId: '' }]) {
    await writeFile(runPath, JSON.stringify(value))
    await assert.rejects(links.routes['run/list']({ root }), { code: 'READ_FAILED' })
  }
  await writeFile(runPath, JSON.stringify(oldRun))
  const { runs } = await links.routes['run/list']({ root })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].reqId, 'requirement')
  assert.equal(runs[0].runState, 'running')
})
