// Stage-3 turn fallbacks (tech §6.3): turn-stopping steers at most once per
// session+turn; turn/end owns final records and the unrecorded hint, and never
// steers. Moved unchanged from the stage-1/2 link machinery.
import { readFile } from 'node:fs/promises'
import * as store from './store.js'
import { normalizeToolCalls, extractFacts, successfulRecords } from './extract.js'
import { taskTurns } from './sync.js'
import { REVIEW_TASK_PURPOSE } from './state.js'

async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }

export function installEvents(ctx, { linkFile, runFile, issueOf, sessionOf, cwdOf, serialized, syncSession }) {
  const reminded = new Set() // sessionId:turn — at most one steer per turn

  ctx.effect(() => ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    try {
      const root = cwdOf(agent)
      const link = root ? await readJson(linkFile(root, agent.session.id)) : null
      if (!link || link.purpose === REVIEW_TASK_PURPOSE) return
      const events = agent.session.snapshotEvents(link.startSeq)
      const turnStart = events.find(e => e.type === 'turn/start' && e.data.turn === turn)
      const since = events.filter(e => e.seq >= (turnStart?.seq ?? link.startSeq))
      // Only remind for activity attributed to this task — an unrelated chat turn
      // is not the task's unrecorded progress (§3.4).
      const run = await readJson(runFile(root, link.issueId))
      const attributed = taskTurns(events, new Set([...(link.runIds ?? []), ...(run?.runId ? [run.runId] : [])]))
      if (attributed !== null && !attributed.has(turn)) return
      const records = normalizeToolCalls(since, agent.session.id).filter(r => attributed === null || attributed.has(r.turn))
      const facts = extractFacts(records, { root })
      if (!facts.hasActivity) return
      const ok = successfulRecords(facts)
      const lastOk = ok.length ? Math.max(...ok.map(w => w.seq)) : -1
      const newActivity = [...facts.files.filter(f => f.status === 'confirmed'), ...facts.commands].some(x => x.seq > lastOk)
      if (!newActivity) return
      const key = `${agent.session.id}:${turn}`
      if (signal?.aborted || reminded.has(key)) return
      reminded.add(key)
      agent.steer({
        content: [{ type: 'text', text: '本回合有实际活动尚未记到任务。请调用 workbench_task_note 记录进展。首行写一句摘要，后续行可补充实际处理、验证和缺口。' }],
        source: { kind: 'project-workbench' },
      })
    } catch { /* a reminder must never break the turn */ }
  }), 'project-workbench: turn-stopping reminder')

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (!['turn/end', 'user/message', 'agent/inbox/spliced'].includes(event.type)) return
    const root = session.header?.cwd
    if (!root) return
    void serialized(session.id, async () => {
      const link = await readJson(linkFile(root, session.id))
      if (!link || link.purpose === REVIEW_TASK_PURPOSE) return
      const run = await readJson(runFile(root, link.issueId))
      if (run?.sessionId === session.id && (event.type === 'user/message' || (await issueOf(root, link.issueId)).issue.status === 'todo') && session.snapshotEvents(0).some(e => e.type === 'user/message' && e.data?.source?.rpcId === run.runId)) {
        await store.recordRunStart(root, link.reqId, link.issueId)
      }
      if (event.type === 'turn/end' || event.type === 'agent/inbox/spliced') {
        await syncSession(root, session, link)
      }
    }).catch(e => ctx.logger?.warn?.(`project-workbench sync failed: ${e?.message ?? e}`))
  }), 'project-workbench: turn/end records')

  return { reminded }
}
