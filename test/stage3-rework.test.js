// Stage-3 independent-verification rework regressions (验收返工.md §1–§4).
// Each test maps to a reproduced defect and its pass condition.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { installLinks } from '../core/link.js'
import { installTools } from '../core/tools.js'
import { installDelivery } from '../core/delivery.js'
import { installAssist } from '../core/assist.js'
import { dispatch } from '../core/rpc.js'
import * as store from '../core/store.js'
import { adoptProposal, listProposals, submitProposals } from '../core/proposals.js'
import { makeRoot, seedAIReview, issueFileHash, stubSpawnHost, childReply, waitFor, startTestDevelopment } from './util.js'

function stubCtx(root) {
  const listeners = {}
  const agents = new Map()
  const tools = new Map()
  const contexts = new Map()
  let created = 0
  const ctx = {
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    on(name, fn) { (listeners[name] ??= []).push(fn); return () => {} },
    tools: { guard: () => () => {}, register: def => { tools.set(def.name, def); return () => {} } },
    systemPrompt: { context: def => { contexts.set(def.name, def); return () => {} } },
    agents: { get: sid => agents.get(sid), list: () => [...agents.values()] },
    sessions: { get: sid => agents.get(sid)?.session },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      create: async ({ cwd } = {}) => {
        const sessionId = `session-stub-${++created}`
        agents.set(sessionId, { session: { id: sessionId, header: { cwd: cwd ?? root }, seq: 0, snapshotEvents: () => [] }, status: 'idle' })
        return { sessionId }
      },
      prompt: async () => ({ accepted: true }),
      cancel: async () => ({ accepted: true }),
    },
    logger: { warn: () => {} },
  }
  return { ctx, listeners, agents, tools, contexts }
}
const emit = (listeners, name, ...args) => Promise.all((listeners[name] ?? []).map(fn => fn(...args)))

async function devReq(root, title = '需求') {
  await store.initProject(root)
  const { data } = await store.createRequirement(root, title)
  await store.updateRequirement(root, data.id, { goal: 'g', scope: 's', acceptance: 'a' })
  await seedAIReview(root, data.id, { submit: true })
  await store.moveRequirement(root, data.id, 'ready')
  await startTestDevelopment(root, data.id)
  return data.id
}
async function fullIssue(root, reqId, title = '任务') {
  const { data } = await store.createIssue(root, reqId, title)
  await store.updateIssue(root, reqId, data.id, { problemOverview: 'p', triggerPath: 't', acceptance: 'a' })
  return data.id
}
const issFile = (root, reqId, id) => join(root, '.project', 'requirements', reqId, 'issues', `${id}.md`)
const readCursor = async (root, sid) => { try { return JSON.parse(await readFile(join(root, '.project', '.local', 'cursors', `${sid}.json`), 'utf8')) } catch { return null } }
const call = (seq, callId, name, args, turn = 1) => ({ seq, time: seq, type: 'tool/call', data: { turn, step: 1, callId, name, arguments: JSON.stringify(args) } })
const result = (seq, callId, text, turn = 1) => ({ seq, time: seq, type: 'tool/result', data: { turn, step: 1, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }] } } })
const turnStart = (seq, turn) => ({ seq, time: seq, type: 'turn/start', data: { turn } })
const turnEnd = (seq, turn, kind = 'completed') => ({ seq, time: seq, type: 'turn/end', data: { turn, reason: { kind } } })
const chat = (seq, turn, text) => ({ seq, time: seq, type: 'user/message', data: { turn, source: { kind: 'user' }, content: [{ type: 'text', text }] } })

// §1 — unrelated chat activity must not enter the task; task turns must.
test('sync excludes unrelated chat-turn activity but keeps task-turn activity', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const located = await links.locate(root, id)
  const session = agents.get(located.sessionId).session
  const events = [
    turnStart(4, 1), chat(5, 1, '聊点别的'), call(6, 'u1', 'bash', { command: 'echo unrelated' }, 1), result(7, 'u1', 'ok\n', 1), turnEnd(8, 1),
    turnStart(9, 2), call(10, 't1', 'bash', { command: 'echo task-work' }, 2), result(11, 't1', 'ok\n', 2),
    call(12, 'wb', 'workbench_task_note', { text: '记录' }, 2), result(13, 'wb', '已记录', 2), turnEnd(14, 2),
  ]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 15
  await emit(listeners, 'session/event', session, events.at(-1))
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 14)
  const doc = await readFile(issFile(root, reqId, id), 'utf8')
  assert.ok(!doc.includes('echo unrelated')) // chat turn excluded
  assert.ok(doc.includes('echo task-work')) // task turn kept
})

// §2 — a failed progress write retries objective AND progress together.
test('sync write failure retries objective and progress atomically', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents } = stubCtx(root)
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const located = await links.locate(root, id)
  const session = agents.get(located.sessionId).session
  const events = [turnStart(4, 1), call(5, 'c1', 'bash', { command: 'echo atomic' }), result(6, 'c1', 'ok\n'), turnEnd(7, 1)]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 8
  const dir = join(root, '.project', 'requirements', reqId, 'issues')
  await chmod(dir, 0o500) // objective+progress write fails
  await emit(listeners, 'session/event', session, events.at(-1))
  await new Promise(r => setTimeout(r, 30))
  await chmod(dir, 0o700)
  assert.equal(await readCursor(root, located.sessionId), null) // cursor not advanced
  await emit(listeners, 'session/event', session, events.at(-1)) // retry
  await waitFor(async () => (await readCursor(root, located.sessionId))?.lastSeq === 7)
  const doc = await readFile(issFile(root, reqId, id), 'utf8')
  assert.ok(doc.includes('执行命令：echo atomic')) // objective present
  assert.ok(doc.includes('客观记录同步：')) // progress present (not permanently missing)
})

// §2 — a failed test run is activity but not verification evidence.
test('a failed test run cannot carry a submit for confirmation', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, tools } = stubCtx(root)
  const links = installLinks(ctx)
  installTools(ctx, links)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const located = await links.locate(root, id)
  const agent = agents.get(located.sessionId)
  await store.recordRunStart(root, reqId, id)
  const events = [turnStart(4, 1), call(5, 'f1', 'bash', { command: 'node --test demo.test.mjs' }), result(6, 'f1', 'fail\n[exit code: 1]'), turnEnd(7, 1)]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 8
  const exec = { agent }
  await assert.rejects(tools.get('workbench_task_submit').execute({ summary: '修好了' }, exec), e => e.code === 'RESULT_EVIDENCE_REQUIRED')
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].status, 'doing') // untouched
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].resultSummary, '') // summary not saved first
})

test('the sync store rejects late task records after the requirement returns to the pool', async t => {
  const root = await makeRoot(t)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  await store.updateRequirement(root, reqId, { goal: '新目标' }, { confirmReviewInvalid: true, reason: '目标已改变' })
  const before = await readFile(issFile(root, reqId, id), 'utf8')
  const result = await store.appendObjectiveSync(root, reqId, id, {
    sid: 'sync-session', entries: [{ seq: 13, line: '迟到的记录' }], activityPrefix: '同步迟到结果',
  })
  assert.equal(result.added, 0)
  assert.equal(await readFile(issFile(root, reqId, id), 'utf8'), before)
})

test('a PTC result keeps its parent turn after the cursor passes the parent call', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx(root)
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const { sessionId } = await links.locate(root, id)
  const session = agents.get(sessionId).session
  const { link } = await links.getLink(root, sessionId)
  const events = [
    turnStart(4, 1), call(5, 'parent', 'run_code', {}),
    { seq: 6, time: 6, type: 'tool/ptc-dispatch-start', data: { parentCallId: 'parent', subCallId: 'child', name: 'edit', arguments: '{"file_path":"actual.txt"}' } },
    result(7, 'parent', 'ok'), turnEnd(8, 1),
  ]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 9
  assert.equal((await links.syncSession(root, session, link)).complete, false)
  assert.equal((await readCursor(root, sessionId)).lastSeq, 5)
  events.push({ seq: 9, time: 9, type: 'tool/ptc-dispatch', data: { parentCallId: 'parent', subCallId: 'child', content: [{ type: 'text', text: 'updated' }] } })
  session.seq = 10
  const { link: current } = await links.getLink(root, sessionId)
  assert.equal((await links.syncSession(root, session, current)).synced, 1)
  assert.match(await readFile(issFile(root, reqId, id), 'utf8'), /改动文件：.*actual\.txt/)
  assert.equal((await readCursor(root, sessionId)).lastSeq, 9)
})

// §3 — adopting a field draft after a human edit conflicts; a revision applies.
test('field draft adoption preserves human edits and accepts a revision', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, tools } = stubCtx(root)
  const links = installLinks(ctx)
  installTools(ctx, links)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const located = await links.locate(root, id)
  const exec = { agent: agents.get(located.sessionId) }
  await tools.get('workbench_task_draft').execute({ field: 'problemOverview', text: 'AI 草稿' }, exec)
  const [draft] = await listProposals(root)
  // Human edits the same field after the draft was produced.
  await store.updateIssue(root, reqId, id, { problemOverview: '人工结论' })
  await assert.rejects(adoptProposal(root, draft.id), e => e.code === 'CONFLICT')
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].problemOverview, '人工结论') // preserved
  // A fresh draft on the current version, revised at adoption, applies.
  await tools.get('workbench_task_draft').execute({ field: 'triggerPath', text: '原始触发' }, exec)
  const drafts = await listProposals(root)
  const trigger = drafts.find(p => p.suggested_patch.triggerPath)
  await adoptProposal(root, trigger.id, { triggerPath: '修订后的触发' })
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].triggerPath, '修订后的触发')
})

// §3 — a field draft submitted without an explicit fingerprint still conflicts
// after a human edit (protection is entry-agnostic).
test('field draft via submitProposals auto-captures fingerprint and conflicts on human edit', async t => {
  const root = await makeRoot(t)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const { data } = await submitProposals(root, [{ kind: 'field_draft', target: { reqId, issueId: id }, evidence: ['draft://test'], suggested_patch: { problemOverview: 'AI 草稿' }, reason: 'x' }])
  const [p] = await listProposals(root)
  assert.ok(p.baseHash) // auto-captured at submit time
  await store.updateIssue(root, reqId, id, { problemOverview: '人工结论' })
  await assert.rejects(adoptProposal(root, data.saved[0]), e => e.code === 'CONFLICT')
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].problemOverview, '人工结论')
})

// §3 — a task created by hand during a split makes the split stale.
test('split detects a task created during drafting', async t => {
  const root = await makeRoot(t)
  const { ctx, children } = stubSpawnHost(root)
  const assist = installAssist(ctx, { readOnlyChildren: new Set() })
  const reqId = await devReq(root)
  const pending = assist.routes['requirement/split']({ root, id: reqId })
  await waitFor(() => children.length === 1)
  await store.createIssue(root, reqId, '人工新建的任务') // hand-created during drafting
  children[0].resolve(childReply({ tasks: [{ title: 'AI 任务' }] }))
  await assert.rejects(pending, e => e.code === 'ASSIST_STALE')
  assert.equal((await listProposals(root)).length, 0) // no stale proposal saved
})

// §4 — an adopted cancellation still blocks requirement submission.
test('cancel via proposal adoption cannot trigger the delivery summary', async t => {
  const root = await makeRoot(t)
  const { ctx, children } = stubSpawnHost(root)
  const delivery = installDelivery(ctx, { readOnlyChildren: new Set() })
  const off = store.onTaskTerminal((r, id) => void delivery.maybeSubmit(r, id))
  t.after(off)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  await store.updateIssue(root, reqId, a, { resultSummary: 'r', evidence: 'e' })
  await store.moveIssue(root, reqId, a, 'done', { fileHash: await issueFileHash(root, reqId, a) })
  // Propose cancelling B, then adopt it as a human decision.
  await store.updateIssue(root, reqId, b, { resultSummary: 'r', evidence: 'e' })
  const { data } = await submitProposals(root, [{ kind: 'task_suggestion', target: { reqId, issueId: b }, evidence: ['draft://test'], suggested_patch: { action: 'cancel', text: '本轮不做' }, reason: '建议' }])
  await adoptProposal(root, data.saved[0])
  await delivery.maybeSubmit(root, reqId)
  const req = (await store.scanProject(root)).requirements[0]
  assert.equal(req.issues.find(issue => issue.id === b).status, 'cancelled')
  assert.equal(req.status, 'in_progress')
  assert.equal(children.length, 0)
})

// §4 — a reopen mid-summary invalidates the in-flight summary (same-round guard).
test('reopen while a summary drafts prevents the stale summary submitting', async t => {
  const root = await makeRoot(t)
  const { ctx, children } = stubSpawnHost(root)
  const delivery = installDelivery(ctx, { readOnlyChildren: new Set() })
  const off = store.onTaskTerminal((r, id) => void delivery.maybeSubmit(r, id))
  t.after(off)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  await store.updateIssue(root, reqId, a, { resultSummary: 'r', evidence: 'e' })
  await store.moveIssue(root, reqId, a, 'done', { fileHash: await issueFileHash(root, reqId, a) })
  await waitFor(() => children.length === 1) // round-N summary in flight (unresolved)
  const fpN = store.deliveryFingerprint((await store.scanProject(root)).requirements[0])
  // The requirement reaches pending by another path, then is reopened (round N+1)
  // and re-completed while the round-N summary is still drafting.
  await store.submitRequirement(root, reqId, { summary: '手动摘要' })
  await store.reopenRequirement(root, reqId, { reason: '打回', reopen: [a] })
  await store.updateIssue(root, reqId, a, { resultSummary: '新结果', evidence: '新依据' })
  await store.moveIssue(root, reqId, a, 'done', { fileHash: await issueFileHash(root, reqId, a) })
  // The stale round-N summary returns: the shared submit lock rejects the old
  // delivery, and the terminal event that arrived mid-flight re-triggers a NEW summary.
  children[0].resolve(childReply({ summary: '旧摘要', cancelImpact: '' }))
  await waitFor(() => children.length === 2)
  assert.equal((await store.scanProject(root)).requirements[0].status, 'in_progress') // old summary did not submit
  assert.notEqual((await store.scanProject(root)).requirements[0].deliverySummary, '旧摘要')
  // The new delivery gets its own summary and submits.
  children[1].resolve(childReply({ summary: '新摘要', cancelImpact: '' }))
  await waitFor(async () => (await store.scanProject(root)).requirements[0].status === 'pending')
  assert.equal((await store.scanProject(root)).requirements[0].deliverySummary, '新摘要')
  // The guard also rejects a mismatched delivery fingerprint directly.
  await store.reopenRequirement(root, reqId, { reason: '再打回', reopen: [a] })
  await assert.rejects(store.submitRequirement(root, reqId, { summary: 'x', expectFingerprint: fpN }), e => e.code === 'ROUND_CHANGED')
})

test('reopening and resolving a task in the same requirement starts a new summary', async t => {
  const root = await makeRoot(t)
  const { ctx, children } = stubSpawnHost(root)
  const delivery = installDelivery(ctx, { readOnlyChildren: new Set() })
  t.after(store.onTaskTerminal((r, id) => void delivery.maybeSubmit(r, id)))
  const reqId = await devReq(root)
  const task = await fullIssue(root, reqId)
  await store.updateIssue(root, reqId, task, { resultSummary: '旧结果', evidence: '旧依据' })
  await store.confirmIssue(root, reqId, task, { fileHash: await issueFileHash(root, reqId, task) })
  await waitFor(() => children.length === 1)
  const previous = (await store.scanProject(root)).requirements[0]
  await store.moveIssue(root, reqId, task, 'todo', { reason: '重开任务' })
  await store.updateIssue(root, reqId, task, { resultSummary: '新结果', evidence: '新依据' })
  await store.confirmIssue(root, reqId, task, { fileHash: await issueFileHash(root, reqId, task) })
  children[0].resolve(childReply({ summary: '旧摘要' }))
  await waitFor(() => children.length === 2)
  const current = (await store.scanProject(root)).requirements[0]
  assert.equal(current.deliveryStartedAt, previous.deliveryStartedAt)
  assert.equal(current.status, 'in_progress')
  assert.equal(current.deliverySummary, '')
  children[1].resolve(childReply({ summary: '新摘要' }))
  await waitFor(async () => (await store.scanProject(root)).requirements[0].status === 'pending')
  assert.equal((await store.scanProject(root)).requirements[0].deliverySummary, '新摘要')
})

test('cancelling a reopened task invalidates an in-flight summary', async t => {
  const root = await makeRoot(t)
  const { ctx, children } = stubSpawnHost(root)
  const delivery = installDelivery(ctx, { readOnlyChildren: new Set() })
  t.after(store.onTaskTerminal((r, id) => void delivery.maybeSubmit(r, id)))
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  await store.updateIssue(root, reqId, a, { resultSummary: '完成 A', evidence: '已验证 A' })
  await store.confirmIssue(root, reqId, a, { fileHash: await issueFileHash(root, reqId, a) })
  await store.updateIssue(root, reqId, b, { resultSummary: '完成 B', evidence: '已验证 B' })
  await store.confirmIssue(root, reqId, b, { fileHash: await issueFileHash(root, reqId, b) })
  await waitFor(() => children.length === 1)
  await store.moveIssue(root, reqId, b, 'todo', { reason: '重新判断范围' })
  await store.moveIssue(root, reqId, b, 'cancelled', { reason: 'B 已移出交付范围' })
  children[0].resolve(childReply({ summary: '旧摘要' }))
  const status = async () => (await delivery.routes['delivery/status']({ root, reqId })).job?.status
  await waitFor(async () => (await status()) === 'skipped')
  assert.equal(children.length, 1)
  assert.equal((await store.scanProject(root)).requirements[0].status, 'in_progress')
  await store.moveIssue(root, reqId, b, 'todo', { reason: '恢复范围' })
  await store.updateIssue(root, reqId, b, { resultSummary: '新结果', evidence: '新依据' })
  await store.confirmIssue(root, reqId, b, { fileHash: await issueFileHash(root, reqId, b) })
  await waitFor(() => children.length === 2)
  children[1].resolve(childReply({ summary: '新摘要' }))
  await waitFor(async () => (await store.scanProject(root)).requirements[0].status === 'pending')
  assert.equal((await store.scanProject(root)).requirements[0].deliverySummary, '新摘要')
})

// §4 — a manual empty summary after reopen cannot reuse the previous round's summary.
test('manual empty summary after reopen is rejected as stale', async t => {
  const root = await makeRoot(t)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  await store.updateIssue(root, reqId, a, { resultSummary: 'r', evidence: 'e' })
  await store.moveIssue(root, reqId, a, 'done', { fileHash: await issueFileHash(root, reqId, a) })
  await store.submitRequirement(root, reqId, { summary: '上一轮摘要' })
  await store.reopenRequirement(root, reqId, { reason: '打回', reopen: [a] })
  await store.updateIssue(root, reqId, a, { resultSummary: '新结果', evidence: '新依据' })
  await store.moveIssue(root, reqId, a, 'done', { fileHash: await issueFileHash(root, reqId, a) })
  // Empty summary → must NOT reuse the previous round's summary.
  await assert.rejects(store.submitRequirement(root, reqId, { summary: '' }), e => e.code === 'SUMMARY_STALE')
  assert.equal((await store.scanProject(root)).requirements[0].status, 'in_progress')
  // A fresh summary submits.
  assert.ok((await store.submitRequirement(root, reqId, { summary: '本轮新摘要' })).ok)
})

test('submission and reopen in the same millisecond cannot carry an old summary', async t => {
  const root = await makeRoot(t)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  await store.updateIssue(root, reqId, a, { resultSummary: '结果', evidence: '依据' })
  await store.confirmIssue(root, reqId, a, { fileHash: await issueFileHash(root, reqId, a) })
  const now = Date.now() + 100
  t.mock.method(Date, 'now', () => now)
  await store.submitRequirement(root, reqId, { summary: '旧摘要' })
  await store.reopenRequirement(root, reqId, { reason: '打回', reopen: [a] })
  await store.updateIssue(root, reqId, a, { resultSummary: '新结果', evidence: '新依据' })
  await store.confirmIssue(root, reqId, a, { fileHash: await issueFileHash(root, reqId, a) })
  await assert.rejects(store.submitRequirement(root, reqId), { code: 'SUMMARY_STALE' })
  assert.ok((await store.submitRequirement(root, reqId, { summary: '本轮新摘要' })).ok)
})

// §2 — an aborted call with no result does not block a later switch forever.
test('an abandoned aborted call does not block switching', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx(root)
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  const located = await links.locate(root, a)
  const session = agents.get(located.sessionId).session
  // Turn 1 aborted with a call that never settles; turn 2 has settled work.
  const events = [
    turnStart(4, 1), call(5, 'gone', 'bash', { command: 'echo never-settles' }), turnEnd(6, 1, 'aborted'),
    turnStart(7, 2), call(8, 'ok', 'bash', { command: 'echo settled' }, 2), result(9, 'ok', 'ok\n', 2), turnEnd(10, 2),
  ]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 11
  agents.get(located.sessionId).status = 'idle'
  await links.changeLink(root, located.sessionId, b) // must not hang on the abandoned call
  assert.equal((await links.getLink(root, located.sessionId)).link.issueId, b)
  const doc = await readFile(issFile(root, reqId, a), 'utf8')
  assert.ok(doc.includes('echo settled')) // settled work captured
})
