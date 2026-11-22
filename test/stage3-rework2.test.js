// Stage-3 second-round verification regressions (验收返工.md 第二轮 §1–§6).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { installLinks } from '../core/link.js'
import { installTools } from '../core/tools.js'
import { installDelivery } from '../core/delivery.js'
import { taskTurns } from '../core/sync.js'
import { evidenceFacts, extractFacts, normalizeToolCalls } from '../core/extract.js'
import * as store from '../core/store.js'
import { adoptProposal, listProposals, submitProposals } from '../core/proposals.js'
import { makeRoot, seedAIReview, issueFileHash, stubSpawnHost, childReply, waitFor } from './util.js'

function stubCtx(root) {
  const listeners = {}, agents = new Map(), tools = new Map(), contexts = new Map()
  let created = 0
  const ctx = {
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    on(n, fn) { (listeners[n] ??= []).push(fn); return () => {} },
    tools: { guard: () => () => {}, register: def => { tools.set(def.name, def); return () => {} } },
    systemPrompt: { context: def => { contexts.set(def.name, def); return () => {} } },
    agents: { get: s => agents.get(s), list: () => [...agents.values()] },
    sessions: { get: s => agents.get(s)?.session },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      create: async ({ cwd } = {}) => { const sid = `s-${++created}`; agents.set(sid, { session: { id: sid, header: { cwd: cwd ?? root }, seq: 0, snapshotEvents: () => [] }, status: 'idle' }); return { sessionId: sid } },
      prompt: async () => ({ accepted: true }), cancel: async () => ({ accepted: true }),
    },
    logger: { warn: () => {} },
  }
  return { ctx, listeners, agents, tools, contexts }
}
async function devReq(root, title = '需求') {
  await store.initProject(root)
  const { data } = await store.createRequirement(root, title)
  await store.updateRequirement(root, data.id, { goal: 'g', scope: 's', acceptance: 'a' })
  await seedAIReview(root, data.id, { submit: true })
  for (const s of ['ready', 'in_progress']) await store.moveRequirement(root, data.id, s)
  return data.id
}
async function fullIssue(root, reqId, title = '任务') {
  const { data } = await store.createIssue(root, reqId, title)
  await store.updateIssue(root, reqId, data.id, { problemOverview: 'p', triggerPath: 't', acceptance: 'a' })
  return data.id
}
const issFile = (root, reqId, id) => join(root, '.project', 'requirements', reqId, 'issues', `${id}.md`)
const call = (seq, id, name, args, turn = 1) => ({ seq, time: seq, type: 'tool/call', data: { turn, step: 1, callId: id, name, arguments: JSON.stringify(args) } })
const result = (seq, id, text, turn = 1) => ({ seq, time: seq, type: 'tool/result', data: { turn, step: 1, message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text }] } } })
const ts = (seq, turn) => ({ seq, time: seq, type: 'turn/start', data: { turn } })
const te = (seq, turn, kind = 'completed') => ({ seq, time: seq, type: 'turn/end', data: { turn, reason: { kind } } })
const chat = (seq, rpcId) => ({ seq, time: seq, type: 'user/message', data: { source: { kind: 'user', ...(rpcId ? { rpcId } : {}) }, content: [{ type: 'text', text: 'chat' }] } })

// §1 — rc.3 ordinary chat carries an rpcId; it is still unrelated unless it is a
// registered workbench run request.
test('ordinary chat with an rpcId is not attributed to the task', () => {
  const events = [ts(4, 1), chat(5, 'chat-rpc-999'), call(6, 'u1', 'bash', { command: 'echo unrelated' }, 1), result(7, 'u1', 'ok', 1), te(8, 1)]
  const attributed = taskTurns(events, new Set(['workbench-run-1']))
  assert.equal(attributed.has(1), false)
  // A registered run request rpcId IS task work.
  const events2 = [ts(4, 1), chat(5, 'workbench-run-1'), call(6, 't1', 'bash', { command: 'echo task' }, 1), result(7, 't1', 'ok', 1), te(8, 1)]
  assert.equal(taskTurns(events2, new Set(['workbench-run-1'])).has(1), true)
})

// §1 — a read-only task view does not pull an unrelated turn into the task.
test('read-only workbench_task_get does not attribute an unrelated chat turn', () => {
  const events = [ts(4, 1), chat(5, 'chat-rpc'), call(6, 'g', 'workbench_task_get', {}, 1), result(7, 'g', '{}', 1), call(8, 'u', 'bash', { command: 'echo unrelated' }, 1), result(9, 'u', 'ok', 1), te(10, 1)]
  assert.equal(taskTurns(events, new Set()).has(1), false)
  // A recording tool (note) does attribute the turn.
  const events2 = [ts(4, 1), chat(5, 'chat-rpc'), call(6, 'n', 'workbench_task_note', { text: 'x' }, 1), result(7, 'n', '已记录', 1), te(8, 1)]
  assert.equal(taskTurns(events2, new Set()).has(1), true)
})

// §1 — old activity predating a block must not resolve a fresh block.
test('start recovery requires activity after the block', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, tools } = stubCtx(root)
  const links = installLinks(ctx); installTools(ctx, links)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const located = await links.locate(root, id)
  const agent = agents.get(located.sessionId)
  const exec = { agent }
  const oldTime = Date.now() - 100000
  // Old activity, then block, then a start attempt with only that old activity.
  agent.session.snapshotEvents = () => [call(5, 'old', 'bash', { command: 'echo old' }), { ...result(6, 'old', 'ok'), time: oldTime }]
  await store.recordRunStart(root, reqId, id)
  await tools.get('workbench_task_block').execute({ reason: '缺资料' }, exec)
  const blockedAt = (await store.scanProject(root)).requirements[0].issues[0].blockedAt
  assert.ok(blockedAt > 0)
  agent.session.snapshotEvents = () => [{ ...call(5, 'old', 'bash', { command: 'echo old' }), time: oldTime }, { ...result(6, 'old', 'ok'), time: oldTime }]
  await assert.rejects(tools.get('workbench_task_start').execute({}, exec), e => e.code === 'NO_ACTIVITY')
  // New activity after the block resolves it.
  const newTime = blockedAt + 1000
  agent.session.snapshotEvents = () => [{ ...call(7, 'new', 'bash', { command: 'echo new' }), time: newTime }, { ...result(8, 'new', 'ok'), time: newTime }]
  assert.equal(await tools.get('workbench_task_start').execute({}, exec), '已记录开始处理')
})

// §1 — an explicit supplement (forTurn) closes an old turn's unrecorded hint.
test('a forTurn supplement closes the targeted old turn hint', async t => {
  const root = await makeRoot(t)
  const { ctx, listeners, agents, tools } = stubCtx(root)
  const links = installLinks(ctx); installTools(ctx, links)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const located = await links.locate(root, id)
  const session = agents.get(located.sessionId).session
  // Turn 1: task activity (run request) with no record → unrecorded.
  const events = [ts(4, 1), chat(5, 'run-1'), call(6, 'c1', 'bash', { command: 'echo work' }, 1), result(7, 'c1', 'ok', 1), te(8, 1)]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 9
  const linkPath = join(root, '.project', '.local', 'links', `${located.sessionId}.json`)
  const setRunIds = async () => { const l = JSON.parse(await readFile(linkPath, 'utf8')); await writeFile(linkPath, JSON.stringify({ ...l, runIds: ['run-1'] })) }
  await setRunIds()
  await links.syncSession(root, session, JSON.parse(await readFile(linkPath, 'utf8')))
  assert.deepEqual(JSON.parse(await readFile(linkPath, 'utf8')).unrecordedTurns, [1])
  // A later turn supplements turn 1 explicitly.
  const exec = { agent: agents.get(located.sessionId) }
  await tools.get('workbench_task_note').execute({ text: '补记第一回合', forTurn: 1 }, exec)
  await links.syncSession(root, session, JSON.parse(await readFile(linkPath, 'utf8')))
  assert.deepEqual(JSON.parse(await readFile(linkPath, 'utf8')).unrecordedTurns, [])
})

// §2 — a failed test plus an unrelated successful pwd is not verification evidence.
test('failed test plus successful pwd cannot carry a submit', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, tools } = stubCtx(root)
  const links = installLinks(ctx); installTools(ctx, links)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const located = await links.locate(root, id)
  const agent = agents.get(located.sessionId)
  await store.recordRunStart(root, reqId, id)
  const now = Date.now()
  const events = [ts(4, 1), chat(5, 'run-1'),
    call(6, 'f', 'bash', { command: 'node --test demo.test.mjs' }, 1), result(7, 'f', 'fail\n[exit code: 1]', 1),
    call(8, 'p', 'bash', { command: 'pwd' }, 1), result(9, 'p', '/tmp\n[exit code: 0]', 1), te(10, 1)]
  agent.session.snapshotEvents = from => events.filter(e => e.seq >= from)
  agent.session.seq = 11
  const l = JSON.parse(await readFile(join(root, '.project', '.local', 'links', `${located.sessionId}.json`), 'utf8'))
  await writeFile(join(root, '.project', '.local', 'links', `${located.sessionId}.json`), JSON.stringify({ ...l, runIds: ['run-1'] }))
  await assert.rejects(tools.get('workbench_task_submit').execute({ summary: '修好了' }, { agent }), e => ['RESULT_EVIDENCE_REQUIRED', 'RESULT_STALE'].includes(e.code))
  // A successful verification command does count.
  const facts = extractFacts(normalizeToolCalls([call(6, 'f', 'bash', { command: 'node --test demo.test.mjs' }), result(7, 'f', '# tests 1\n# pass 1\n# fail 0\n[exit code: 0]')], 's'), { root })
  assert.equal(evidenceFacts(facts).commands.length, 1)
})

test('test conclusions survive sync; failed, ambiguous and legacy output do not become passes', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, tools } = stubCtx(root)
  const links = installLinks(ctx)
  installTools(ctx, links)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const { sessionId } = await links.locate(root, id)
  const agent = agents.get(sessionId)
  await store.recordRunStart(root, reqId, id)
  const issue = async () => (await links.issueOf(root, id)).issue
  const since = (await issue()).deliveryStartedAt
  await store.appendObjectiveSync(root, reqId, id, { sid: 'old', entries: [{ seq: 1,
    line: `- 执行命令：node --test old.test.mjs（结果 ok，会话 old 第 1 条，${new Date(since + 1).toISOString()}）` }] })
  assert.equal((await issue()).verification.passed, 0)
  assert.equal((await issue()).verification.incomplete, 1)
  const events = []
  agent.session.snapshotEvents = (from = 0) => events.filter(e => e.seq >= from)
  const sync = async (seq, output, command = 'npm test || true') => {
    events.push(ts(seq, seq), { ...call(seq + 1, `test-${seq}`, 'bash', { command }, seq), time: since + seq + 2 }, result(seq + 2, `test-${seq}`, output, seq), te(seq + 3, seq))
    agent.session.seq = seq + 4
    await links.syncSession(root, agent.session, (await links.getLink(root, sessionId)).link)
  }
  await sync(4, 'Tests: 1 failed, 1 total\n[exit code: 0]')
  let value = await issue()
  assert.equal(value.verification.failed, 1)
  assert.equal(value.verification.passed, 0)
  assert.match(value.objective, /结果 exit:0，测试结论 failed，测试摘要 Tests: 1 failed, 1 total/)
  await assert.rejects(tools.get('workbench_task_submit').execute({ summary: '结果' }, { agent }), e => ['RESULT_EVIDENCE_REQUIRED', 'RESULT_STALE'].includes(e.code))
  await sync(8, 'pass\n[exit code: 0]')
  value = await issue()
  assert.equal(value.verification.failed, 0, value.objective)
  assert.equal(value.verification.passed, 0)
  assert.equal(value.verification.incomplete, 2)
  await sync(12, '# tests 2\n# pass 2\n# fail 0\n[exit code: 0]')
  value = await issue()
  assert.equal(value.verification.passed, 1)
  assert.equal(value.verification.incomplete, 1) // legacy command remains unverified
  assert.match(value.objective, /测试结论 passed/)
  await sync(16, 'Tests: 1 failed, 1 total\n[exit code: 0]', 'echo ' + 'x'.repeat(130) + ' && npm run test:unit || true')
  value = await issue()
  assert.equal(value.verification.failed, 1)
  assert.equal(value.verification.passed, 1)
})

test('earlier delivery verification stays historical across later sync batches', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, tools } = stubCtx(root)
  const links = installLinks(ctx)
  installTools(ctx, links)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const { sessionId } = await links.locate(root, id)
  const agent = agents.get(sessionId)
  const issue = async () => (await links.issueOf(root, id)).issue
  const submit = summary => tools.get('workbench_task_submit').execute({ summary }, { agent })
  const events = []
  agent.session.snapshotEvents = (from = 0) => events.filter(e => e.seq >= from)
  const addCommand = (seq, turn, command, output, time) => {
    const callId = `command-${seq}`
    events.push(ts(seq, turn), { ...call(seq + 1, callId, 'bash', { command }, turn), time },
      result(seq + 2, callId, output, turn), te(seq + 3, turn))
    agent.session.seq = seq + 4
  }
  await store.recordRunStart(root, reqId, id)
  addCommand(1, 1, 'node --test demo.test.mjs', '# tests 1\n# pass 1\n# fail 0\n[exit code: 0]', (await issue()).deliveryStartedAt + 1)
  await submit('上一轮通过')
  await store.continueIssue(root, reqId, id, { text: '再跑一次测试' })
  const since = (await issue()).deliveryStartedAt

  addCommand(5, 2, 'node --test demo.test.mjs', 'fail\n[exit code: 1]', since + 1)
  await links.syncSession(root, agent.session, (await links.getLink(root, sessionId)).link)
  addCommand(9, 3, 'pwd', '/tmp\n[exit code: 0]', since + 2)
  await assert.rejects(submit('误把目录查询当成验证'), { code: 'RESULT_STALE' })
  const rejected = await issue()
  assert.equal(rejected.status, 'doing')
  assert.equal(rejected.resultSummary, '上一轮通过')
  assert.equal(rejected.objectiveAt, 0)
  assert.match(rejected.objective, /第 3 条/)
  assert.match(rejected.objective, /执行命令：node --test demo.test.mjs（结果 exit:1/)
  assert.match(rejected.objective, /执行命令：pwd（结果 exit:0/)

  addCommand(13, 4, 'node --test demo.test.mjs', '# tests 1\n# pass 1\n# fail 0\n[exit code: 0]', since + 3)
  await submit('本轮测试通过')
  assert.equal((await issue()).status, 'in_review')
  assert.equal((await issue()).objectiveAt, since + 3)
})

test('reopened task accepts newly synced system evidence with a new result', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx(root)
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  await store.updateIssue(root, reqId, id, { resultSummary: '旧结果', evidence: '旧人工依据' })
  await store.confirmIssue(root, reqId, id, { fileHash: await issueFileHash(root, reqId, id) })
  await store.submitRequirement(root, reqId, { summary: '上一轮交付' })
  await store.reopenRequirement(root, reqId, { reason: '重新验证', reopen: [id] })

  const confirm = async () => store.confirmIssue(root, reqId, id, { fileHash: await issueFileHash(root, reqId, id) })
  await assert.rejects(confirm(), { code: 'RESULT_STALE' })
  const { sessionId } = await links.locate(root, id)
  const session = agents.get(sessionId).session
  const issue = async () => (await links.issueOf(root, id)).issue
  const since = (await issue()).deliveryStartedAt
  // Simulated DSH event shapes exercise the real sync and store, not a live DSH session.
  const events = [ts(1, 1), { ...call(2, 'verify', 'bash', { command: 'node --test demo.test.mjs' }), time: since + 1 },
    result(3, 'verify', '# tests 3\n# pass 3\n# fail 0\n[exit code: 0]'), te(4, 1)]
  session.snapshotEvents = (from = 0) => events.filter(event => event.seq >= from)
  session.seq = 5
  const synced = await links.syncSession(root, session, (await links.getLink(root, sessionId)).link)
  assert.equal(synced.synced, 1)
  assert.equal((await issue()).objectiveAt, since + 1)
  await assert.rejects(confirm(), { code: 'RESULT_STALE' })

  await store.updateIssue(root, reqId, id, { resultSummary: '本轮测试通过', evidence: '' },
    { fileHash: await issueFileHash(root, reqId, id), recordResult: true })
  const recorded = await issue()
  assert.equal(recorded.evidence, '')
  assert.equal(recorded.evidenceAt, 0)
  assert.equal(recorded.resultFresh, true)
  await confirm()
  assert.equal((await issue()).status, 'done')
})

// §2 — a blank new summary after continue-modify must not reuse the old result.
test('blank new summary after continue-modify is rejected', async t => {
  const root = await makeRoot(t)
  const { ctx, agents, tools } = stubCtx(root)
  const links = installLinks(ctx); installTools(ctx, links)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const located = await links.locate(root, id)
  const agent = agents.get(located.sessionId)
  await store.recordRunStart(root, reqId, id)
  await store.updateIssue(root, reqId, id, { resultSummary: '旧结果', evidence: 'e' })
  await store.moveIssue(root, reqId, id, 'in_review', { actor: 'ai' })
  await store.continueIssue(root, reqId, id, { text: '再改改' })
  await assert.rejects(tools.get('workbench_task_submit').execute({ summary: '   ' }, { agent }), e => e.code === 'RESULT_EVIDENCE_REQUIRED')
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].status, 'doing')
})

// §2 — sync takes no task writes once the requirement left development.
test('sync does not write tasks after the requirement returns to the pool', async t => {
  const root = await makeRoot(t)
  const { ctx, agents } = stubCtx(root)
  const links = installLinks(ctx)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const located = await links.locate(root, id)
  const session = agents.get(located.sessionId).session
  await store.updateRequirement(root, reqId, { goal: '改目标' }, { confirmReviewInvalid: true, reason: '回池' })
  assert.equal((await store.scanProject(root)).requirements[0].status, 'backlog')
  const events = [ts(4, 1), call(5, 'c', 'bash', { command: 'echo after-pool' }), result(6, 'c', 'ok'), te(7, 1)]
  session.snapshotEvents = from => events.filter(e => e.seq >= from)
  session.seq = 8
  await links.syncSession(root, session, JSON.parse(await readFile(join(root, '.project', '.local', 'links', `${located.sessionId}.json`), 'utf8')))
  assert.ok(!(await readFile(issFile(root, reqId, id), 'utf8')).includes('echo after-pool'))
})

// §3 — a legacy draft cannot overwrite human content or block a fresh version.
test('old field draft without fingerprint is refused and can be re-drafted with the same text', async t => {
  const root = await makeRoot(t)
  const reqId = await devReq(root)
  const id = await fullIssue(root, reqId)
  const proposal = { kind: 'field_draft', target: { reqId, issueId: id }, evidence: ['draft://x'], suggested_patch: { problemOverview: 'AI 草稿' }, reason: 'x' }
  const { data: { saved: [oldId] } } = await submitProposals(root, [proposal])
  // Strip the fingerprint to simulate an old-format persisted draft.
  const file = join(root, '.project', '.local', 'tmp', 'sync', `${oldId}.json`)
  const doc = JSON.parse(await readFile(file, 'utf8'))
  delete doc.baseHash
  await writeFile(file, JSON.stringify(doc))
  await store.updateIssue(root, reqId, id, { problemOverview: '人工内容' })
  await assert.rejects(adoptProposal(root, oldId), e => e.code === 'DRAFT_STALE')
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].problemOverview, '人工内容')

  const { data: { saved: [freshId] } } = await submitProposals(root, [proposal])
  assert.ok(freshId)
  assert.notEqual(freshId, oldId)
  const fresh = (await listProposals(root)).find(p => p.id === freshId)
  assert.equal(fresh.baseHash, await issueFileHash(root, reqId, id))
  assert.deepEqual((await submitProposals(root, [proposal])).data, { saved: [], skipped: 1 })
  await adoptProposal(root, freshId)
  assert.equal((await store.scanProject(root)).requirements[0].issues[0].problemOverview, 'AI 草稿')
})

// §3 — adopting a split preview after a same-title task was created reuses it.
test('split preview adoption reuses a concurrently created same-title task', async t => {
  const root = await makeRoot(t)
  const reqId = await devReq(root)
  const { data } = await submitProposals(root, [{ kind: 'new_task', target: { reqId }, evidence: ['draft://x'], suggested_patch: { title: '补充说明', problemOverview: '补充实际用法' }, reason: 'x' }])
  const hand = await store.createIssue(root, reqId, '补充说明')
  const res = await adoptProposal(root, data.saved[0])
  assert.equal(res.data.id, hand.data.id)
  assert.equal((await store.scanProject(root)).requirements[0].issues.length, 1) // no duplicate
})

// §4 — neither a summary nor a cancellation note overrides task acceptance.
test('a cancellation note cannot override the task acceptance guard', async t => {
  const root = await makeRoot(t)
  const reqId = await devReq(root)
  const a = await fullIssue(root, reqId, 'A')
  const b = await fullIssue(root, reqId, 'B')
  await store.updateIssue(root, reqId, a, { resultSummary: 'r', evidence: 'e' })
  await store.moveIssue(root, reqId, a, 'done', { fileHash: await issueFileHash(root, reqId, a) })
  await store.moveIssue(root, reqId, b, 'cancelled', { reason: '不做' })
  await assert.rejects(store.submitRequirement(root, reqId, { summary: '本轮摘要' }), { code: 'TASKS_NOT_ACCEPTED' })
  await assert.rejects(store.submitRequirement(root, reqId, { summary: '本轮摘要', cancelImpact: '本轮取消影响' }), { code: 'TASKS_NOT_ACCEPTED' })
})

// §4 — two projects sharing a requirement id do not block each other's summaries.
test('delivery jobs are isolated per project for the same requirement id', async t => {
  const root1 = await makeRoot(t)
  const root2 = await makeRoot(t)
  const { ctx, children } = stubSpawnHost(root1)
  const delivery = installDelivery(ctx, { readOnlyChildren: new Set() })
  const off = store.onTaskTerminal((r, id) => void delivery.maybeSubmit(r, id))
  t.after(off)
  // Build the SAME requirement id in both projects by hand.
  const reqId = 'req-20261115-aaaaaa'
  for (const root of [root1, root2]) {
    await store.initProject(root)
    const dir = join(root, '.project', 'requirements', reqId)
    await mkdir(join(dir, 'issues'), { recursive: true })
    await writeFile(join(dir, 'requirement.md'), `---\nschema: 2\nid: ${reqId}\ntitle: "同ID需求"\nstatus: in_progress\ngoal: "g"\nscope: "s"\nacceptance: "a"\ndeliveryStartedAt: 1\ncreated: 2026-11-15T00:00:00+08:00\nupdated: 2026-11-15T00:00:00+08:00\n---\n\n## 活动\n`)
    const issId = 'iss-20261115-aaaaaa'
    await writeFile(join(dir, 'issues', `${issId}.md`), `---\nschema: 2\nid: ${issId}\ntitle: "任务"\nstatus: done\nacceptance: "a"\nevidence: "e"\ndeliveryStartedAt: 1\nresultAt: 2\nevidenceAt: 2\ncreated: 2026-11-15T00:00:00+08:00\nupdated: 2026-11-15T00:00:00+08:00\n---\n\n## 处理结果\n\n### 摘要\n\n完成\n`)
  }
  await delivery.maybeSubmit(root1, reqId)
  await waitFor(() => children.length === 1) // root1 summary in flight
  await delivery.maybeSubmit(root2, reqId) // same reqId, different project → not blocked
  await waitFor(() => children.length === 2)
  assert.equal(children.length, 2)
})
