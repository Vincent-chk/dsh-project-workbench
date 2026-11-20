// Stage-3 record sync (tech §6.2/§6.4): objective extraction, merge/dedup by
// session+seq, cursor advances only after a successful write. Only activity from
// turns that belong to the task's processing enters the task (PRD §11.2); the
// objective lines and their progress entry land in one atomic store write so a
// failed write retries both together. Unrecorded hints are tracked per turn.
import { readFile, rm } from 'node:fs/promises'
import * as store from './store.js'
import { REVIEW_TASK_PURPOSE } from './state.js'
import { normalizeToolCalls, extractFacts, successfulRecords } from './extract.js'
import { TERMINAL_ISSUE } from './state.js'

async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }

// Turns that belong to task processing. A turn is task work when it carries a
// workbench processing request (a run rpcId) or a successful progress write.
// A turn driven by an ordinary user message that is NOT a workbench run request
// is unrelated unless it recorded task work. A start call cannot provide its
// own evidence, and reads, drafts, failed calls and no-op calls do not count.
export function taskTurns(events, runIds) {
  const ranges = []
  const runRequest = new Set()
  const plainChat = new Set()
  let cur = null
  const turnOfSeq = seq => ranges.find(x => seq >= x.startSeq && seq <= x.endSeq)?.turn
  for (const e of events) {
    const d = e.data ?? {}
    if (e.type === 'turn/start') { cur = { turn: d.turn, startSeq: e.seq, endSeq: Infinity }; ranges.push(cur) }
    else if (e.type === 'turn/end' && cur && d.turn === cur.turn) cur.endSeq = e.seq
    if (e.type === 'user/message') {
      const t = turnOfSeq(e.seq)
      if (t === undefined) continue
      if (runIds.has(d.source?.rpcId)) runRequest.add(t)
      else if (d.source?.kind === 'user') plainChat.add(t) // ordinary chat, rpcId or not
    }
  }
  // No turn structure at all (legacy/synthetic log): cannot attribute, keep all.
  if (!ranges.length) return null
  const workbench = new Set(successfulRecords({ workbench: normalizeToolCalls(events).filter(r => r.settled) }).map(r => r.turn))
  const attributed = new Set()
  for (const r of ranges) {
    if (workbench.has(r.turn) || runRequest.has(r.turn) || !plainChat.has(r.turn)) attributed.add(r.turn)
  }
  return attributed
}

// Per-turn unrecorded hints, recomputed from history (idempotent). A turn with
// task activity but no successful record after its last activity stays flagged;
// a record in a DIFFERENT turn never clears it (tech §6.3).
function unrecordedTurnsOf(history, attributed, root, sid, existing = [], supplemented = []) {
  const records = normalizeToolCalls(history, sid)
  const ranges = new Map()
  let cur = null
  for (const e of history) {
    const d = e.data ?? {}
    if (e.type === 'turn/start') { cur = { turn: d.turn, startSeq: e.seq, endSeq: Infinity }; ranges.set(d.turn, cur) }
    else if (e.type === 'turn/end' && cur && d.turn === cur.turn) cur.endSeq = e.seq
  }
  const supp = new Set(supplemented)
  const out = []
  for (const [turn, range] of ranges) {
    if (!attributed.has(turn) || supp.has(turn)) continue // an explicit supplement closes the turn
    const turnRecords = records.filter(r => r.turn === turn && r.callSeq >= range.startSeq && r.callSeq <= range.endSeq)
    const facts = extractFacts(turnRecords, { root })
    if (!facts.hasActivity) continue
    const ok = successfulRecords(facts)
    const lastOk = ok.length ? Math.max(...ok.map(w => w.seq)) : -1
    const activityAfter = [...facts.files.filter(f => f.status === 'confirmed'), ...facts.commands].some(x => x.seq > lastOk)
    if (!ok.length || activityAfter) out.push(turn)
  }
  // A flagged turn no longer present in this history cannot be re-evaluated; keep
  // its hint until a record in that turn (or an explicit supplement) clears it.
  const kept = existing.filter(t => !ranges.has(t) && !supp.has(t))
  return [...new Set([...kept, ...out])].sort((a, b) => a - b)
}

export function installSync(ctx, { linkFile, cursorFile, runFile, issueOf, sessionOf, requestState, serialized, writeJson, observedSession }) {
  async function syncSession(root, session, link, { idleOnly = false, abandonEnded = false } = {}) {
    const sid = session.id
    const agent = sessionOf(sid)
    if (idleOnly && agent && agent.status !== 'idle') return { skipped: 'running' }
    if (link.purpose === REVIEW_TASK_PURPOSE) return { complete: true }
    const cursor = await readJson(cursorFile(root, sid))
    const cursorBase = cursor?.lastSeq ?? link.startSeq - 1
    const from = Math.max(link.startSeq, cursorBase + 1)
    const snapshot = session.snapshotEvents(from)
    const lastScanned = snapshot.length ? snapshot[snapshot.length - 1].seq : from - 1
    const history = session.snapshotEvents(link.startSeq).filter(e => e.seq <= lastScanned)
    const run = await readJson(runFile(root, link.issueId))
    const runIds = new Set([...(link.runIds ?? []), ...(run?.runId ? [run.runId] : [])])
    const attributed = taskTurns(history, runIds)

    const settledIds = new Set()
    for (const e of snapshot) {
      if (e.type === 'tool/result') settledIds.add(e.data.message?.toolCallId)
      else if (e.type === 'tool/ptc-dispatch') settledIds.add(e.data.subCallId)
    }
    // Ended-turn reasons, to release calls that can never settle when a switch or
    // restart forces completion (abandonEnded). Normal sync HOLDS unsettled calls
    // so a parent call settling before its PTC sub-results (cross-batch) is still
    // paired and captured; only an explicit force abandons ended-turn calls.
    const endedReason = new Map()
    const callTurn = new Map()
    for (const e of history) {
      const d = e.data ?? {}
      if (e.type === 'turn/end') endedReason.set(d.turn, d.reason?.kind ?? 'completed')
      else if (e.type === 'tool/call') callTurn.set(d.callId, d.turn)
    }
    let boundary = snapshot.length ? lastScanned + 1 : from
    for (const e of snapshot) {
      const openId = e.type === 'tool/call' ? e.data.callId : e.type === 'tool/ptc-dispatch-start' ? e.data.subCallId : null
      if (openId == null || settledIds.has(openId)) continue
      const turn = e.type === 'tool/call' ? e.data.turn : callTurn.get(e.data.parentCallId)
      const ended = endedReason.has(turn)
      if (!(abandonEnded && ended)) { boundary = e.seq; break }
    }
    const cursorEvents = snapshot.filter(e => e.seq < boundary)
    const lastProcessed = cursorEvents.length ? cursorEvents[cursorEvents.length - 1].seq : from - 1

    // A PTC child result can arrive after the cursor has passed its parent call.
    // Recover the parent's turn from history and apply only results past the cursor.
    const records = normalizeToolCalls(history, sid).filter(r => r.settled && r.seq >= from && (attributed === null || attributed.has(r.turn)))
    const facts = extractFacts(records, { root })
    let synced = 0
    if (records.length) {
      const { req, issue } = await issueOf(root, link.issueId)
      // Terminal tasks are read-only, and a requirement that left development
      // (e.g. returned to the pool) takes no further task writes (§3.3).
      if (!TERMINAL_ISSUE.has(issue.status) && req.status === 'in_progress') {
        const iso = t => new Date(t).toISOString()
        const entries = []
        for (const f of facts.files) {
          if (f.status === 'confirmed') entries.push({ seq: f.seq, line: `- 改动文件：${f.path}（${f.op}，会话 ${sid} 第 ${f.seq} 条，${iso(f.time)}）` })
          else entries.push({ seq: f.seq, line: `- 待核实：${f.path}（补丁请求未确认完成，会话 ${sid} 第 ${f.seq} 条，${iso(f.time)}）` })
        }
        for (const c of facts.commands) {
          const conclusion = c.testConclusion ? `，测试结论 ${c.testConclusion}${c.testSummary ? `，测试摘要 ${c.testSummary.replace(/，/g, ',')}` : ''}` : ''
          const output = c.output ? `\n  输出：${JSON.stringify(c.output)}` : ''
          entries.push({ seq: c.seq, line: `- 执行命令：${c.command}（结果 ${c.outcome}${conclusion}，会话 ${sid} 第 ${c.seq} 条，${iso(c.time)}）${output}` })
        }
        const res = await store.appendObjectiveSync(root, req.id, issue.id, {
          sid, entries, activityPrefix: `客观记录同步：会话 ${sid} 第 ${from}–${lastScanned} 条`,
        })
        synced = res.added
      }
    }
    let unrecordedTurns = link.unrecordedTurns ?? []
    let unrecorded
    if (attributed === null) {
      // No turn structure: whole-snapshot hint. A range with no activity must not
      // clear an existing hint (tech §6.3).
      if (facts.hasActivity) {
        const ok = successfulRecords(facts)
        const lastOk = ok.length ? Math.max(...ok.map(w => w.seq)) : -1
        const activityAfter = [...facts.files.filter(f => f.status === 'confirmed'), ...facts.commands].some(x => x.seq > lastOk)
        unrecorded = !ok.length || activityAfter
      } else {
        unrecorded = link.unrecorded ?? false
      }
    } else {
      unrecordedTurns = unrecordedTurnsOf(history, attributed, root, sid, link.unrecordedTurns ?? [], link.supplementedTurns ?? [])
      unrecorded = unrecordedTurns.length > 0
    }
    if ((link.unrecorded ?? false) !== unrecorded || JSON.stringify(link.unrecordedTurns ?? []) !== JSON.stringify(unrecordedTurns)) {
      await writeJson(linkFile(root, sid), { ...link, unrecorded, unrecordedTurns })
    }
    if (run?.sessionId === sid && lastProcessed >= lastScanned && ['ended', 'cancelled'].includes(requestState(session, run))) {
      await rm(runFile(root, link.issueId), { force: true })
    }
    if (lastProcessed > cursorBase) await writeJson(cursorFile(root, sid), { lastSeq: lastProcessed })
    // Complete when the cursor reached the snapshot end (no blocking unsettled call).
    return { synced, unrecorded, complete: lastProcessed >= lastScanned }
  }

  // Catch up from the durable log when the session is idle — including a COLD
  // session reopened later (observed via sessionQuery), not only live ones.
  async function catchUpIdle(root, sid) {
    return serialized(sid, async () => {
      const agent = sessionOf(sid)
      if (agent && agent.status !== 'idle') return
      let session = ctx.sessions.get(sid)
      let dispose = () => {}
      if (!session && observedSession) {
        const observed = await observedSession(sid)
        session = observed.session
        dispose = observed.dispose
      }
      if (!session || session.header?.cwd !== root) { dispose(); return }
      const link = await readJson(linkFile(root, sid))
      try {
        if (link?.sessionId === sid) await syncSession(root, session, link, { idleOnly: true })
      } finally { dispose() }
    })
  }

  return { syncSession, catchUpIdle }
}
