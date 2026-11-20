// Stage-2 session↔task linking, locate and execution lock (tech §4). Promotes the
// stage-1 verified prototype machinery to formal interfaces. Record sync lives in
// sync.js and the turn fallbacks in events.js (stage 3); this module wires them.
// Runtime data lives in .project/.local/ (links/cursors/runs), never in Git.
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as store from './store.js'
import { atomicWrite, WorkbenchError } from './files.js'
import { REVIEW_TASK_PURPOSE, startBlockers } from './state.js'
import { installSync } from './sync.js'
import { installEvents } from './events.js'

const localDir = root => join(root, '.project', '.local')
const linkFile = (root, sid) => join(localDir(root), 'links', `${sid}.json`)
const cursorFile = (root, sid) => join(localDir(root), 'cursors', `${sid}.json`)
const runFile = (root, issueId) => join(localDir(root), 'runs', `${issueId}.json`)

async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }
async function writeJson(p, value) { await mkdir(dirname(p), { recursive: true }); await atomicWrite(p, JSON.stringify(value, null, 2)) }

async function findLinksByIssue(root, issueId) {
  let names = []
  try { names = await readdir(join(localDir(root), 'links')) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const link = await readJson(join(localDir(root), 'links', name))
    if (link?.issueId === issueId) out.push(link)
  }
  return out.sort((a, b) => (a.linkedAt < b.linkedAt ? 1 : -1))
}
async function findLinkByIssue(root, issueId) {
  return (await findLinksByIssue(root, issueId))[0] ?? null
}

async function issueOf(root, issueId) {
  const idx = await store.scanProject(root)
  for (const req of idx.requirements) {
    const issue = (req.issues ?? []).find(i => i.id === issueId)
    if (issue) return { req, issue }
  }
  throw new WorkbenchError('NOT_FOUND', `issue ${issueId} not found`)
}

export function installLinks(ctx) {
  const syncChains = new Map() // sessionId — serialize syncs, link changes and starts
  const runChains = new Map() // issueId — serialize start attempts (task exclusivity)
  const locateChains = new Map() // workspace + issueId — serialize first session creation
  const submitting = new Set() // runIds this instance is submitting right now (§4.5)

  const sessionOf = sid => ctx.agents.get(sid)
  const cwdOf = agent => agent?.session?.header?.cwd
  function reviewLink(agent) {
    const root = cwdOf(agent)
    const id = agent?.session?.id
    if (!root || !id) return null
    try {
      const link = JSON.parse(readFileSync(linkFile(root, id), 'utf8'))
      return link.sessionId === id && link.purpose === REVIEW_TASK_PURPOSE ? link : null
    } catch { return null }
  }


  // PRD §9.2: prefer the task's most recent AVAILABLE session; fall back to the
  // most recent link (a cold session can still be resumed).
  async function bestLink(root, issueId) {
    const candidates = await findLinksByIssue(root, issueId)
    return candidates.find(l => sessionOf(l.sessionId)) ?? candidates[0] ?? null
  }

  // Fold the host's durable inbox splices. A removed message is either explicitly
  // cancelled or claimed by a turn; historical insertion alone is not pending.
  function requestState(session, run) {
    if (!session) return 'unknown'
    const events = session.snapshotEvents(0).slice().sort((a, b) => a.seq - b.seq)
    const inbox = { 'next-turn': [], 'next-step': [] }
    let accepted = false
    let claimedTurn = null
    let cancelled = false
    let turn = null
    for (const event of events) {
      if (event.type === 'turn/start') turn = event.data?.turn
      if (event.type === 'agent/inbox/spliced') {
        const data = event.data
        const queue = inbox[data.target]
        if (!queue || !Number.isInteger(data.start) || data.start < 0 || data.start > queue.length || data.start + (data.removedCount ?? 0) > queue.length) return 'unknown'
        const removed = queue.splice(data.start, data.removedCount ?? 0, ...(data.inserted ?? []))
        if ((data.inserted ?? []).some(m => m?.source?.rpcId === run.runId)) accepted = true
        if (removed.some(m => m?.source?.rpcId === run.runId)) {
          if (data.outcome === 'canceled') cancelled = true
          else claimedTurn = turn
        }
      }
      if (event.type === 'user/message' && event.data?.source?.rpcId === run.runId) {
        accepted = true
        claimedTurn = turn
      }
      if (event.type === 'turn/end' && claimedTurn != null && event.data?.turn === claimedTurn) return 'ended'
    }
    if (cancelled) return 'cancelled'
    if (claimedTurn != null) return 'running'
    if (Object.values(inbox).some(q => q.some(m => m?.source?.rpcId === run.runId))) return 'queued'
    return accepted ? 'unknown' : 'unseen'
  }

  async function observedSession(sid) {
    const live = ctx.sessions.get(sid)
    if (live) return { session: live, dispose: () => {} }
    if (!ctx.sessionQuery?.observeSession) return { session: null, dispose: () => {} }
    try {
      const observation = await ctx.sessionQuery.observeSession(sid)
      const session = { id: sid, header: observation.header, seq: (observation.events.at(-1)?.seq ?? -1) + 1,
        snapshotEvents: (from = 0) => observation.events.filter(e => e.seq >= from) }
      return { session, dispose: () => observation[Symbol.dispose]?.() }
    } catch { return { session: null, dispose: () => {} } }
  }

  const serialized = (sid, fn) => {
    const prev = syncChains.get(sid) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    syncChains.set(sid, next.catch(() => {}))
    return next
  }

  // Record sync (sync.js) and turn fallbacks (events.js) share this module's
  // session helpers and serial region so starts, switches and syncs never race.
  const { syncSession, catchUpIdle } = installSync(ctx, { linkFile, cursorFile, runFile, issueOf, sessionOf, requestState, serialized, writeJson, observedSession })
  installEvents(ctx, { linkFile, runFile, issueOf, sessionOf, cwdOf, serialized, syncSession })

  // ---- locate (view): no pre-start checks; completed/incomplete tasks still open ----
  function locate(root, issueId, requestedSessionId = null) {
    const key = JSON.stringify([root, issueId])
    const previous = locateChains.get(key) ?? Promise.resolve()
    const next = previous.then(() => locateInner(root, issueId, requestedSessionId), () => locateInner(root, issueId, requestedSessionId))
    const settled = next.then(() => {}, () => {})
    locateChains.set(key, settled)
    void settled.then(() => { if (locateChains.get(key) === settled) locateChains.delete(key) })
    return next
  }

  async function locateInner(root, issueId, requestedSessionId) {
    const { req } = await issueOf(root, issueId)
    // A pending execution belongs to one particular session. Prefer that
    // association so a reminder opens the session that is actually waiting.
    const run = await readJson(runFile(root, issueId))
    const runLink = run?.sessionId ? await readJson(linkFile(root, run.sessionId)) : null
    let existing
    if (requestedSessionId !== null) {
      if (typeof requestedSessionId !== 'string' || !requestedSessionId || /[\/\\\0]/.test(requestedSessionId) || requestedSessionId === '..') throw new WorkbenchError('LINK_CHANGED', 'session association changed; refresh and retry')
      existing = await readJson(linkFile(root, requestedSessionId))
      if (existing?.sessionId !== requestedSessionId || existing.issueId !== issueId || existing.reqId !== req.id) {
        throw new WorkbenchError('LINK_CHANGED', 'session association changed; refresh and retry')
      }
    } else existing = runLink?.issueId === issueId ? runLink : await bestLink(root, issueId)
    if (existing) {
      const agent = sessionOf(existing.sessionId)
      if (agent && cwdOf(agent) !== root) throw new WorkbenchError('WORKSPACE_MISMATCH', 'linked session belongs to another workspace')
      await catchUpIdle(root, existing.sessionId)
      if (requestedSessionId !== null) {
        const current = await readJson(linkFile(root, requestedSessionId))
        if (current?.sessionId !== requestedSessionId || current.issueId !== issueId || current.reqId !== req.id) {
          throw new WorkbenchError('LINK_CHANGED', 'session association changed; refresh and retry')
        }
      }
      return { sessionId: existing.sessionId, reqId: req.id, issueId, reused: true }
    }
    const workspace = ctx.workspaceRegistry.list().find(w => w.path === root)
    const created = await ctx.sessionController.create(workspace ? { workspaceId: workspace.id } : { cwd: root })
    const sessionId = created.sessionId
    const session = ctx.sessions.get(sessionId)
    const link = { sessionId, issueId, reqId: req.id, linkedAt: new Date().toISOString(), startSeq: session.seq, runIds: [] }
    await writeJson(linkFile(root, sessionId), link)
    return { sessionId, reqId: req.id, issueId, created: true }
  }

  // ---- run/start: checks → record start → preempt lock → submit once ----
  function runStart(root, issueId, sessionId) {
    const prev = runChains.get(issueId) ?? Promise.resolve()
    const next = prev.then(() => runStartInner(root, issueId, sessionId), () => runStartInner(root, issueId, sessionId))
    runChains.set(issueId, next.catch(() => {}))
    return next
  }

  async function runStartInner(root, issueId, sessionId) {
    let link = sessionId == null ? await bestLink(root, issueId) : await readJson(linkFile(root, sessionId))
    if (sessionId != null && link?.issueId !== issueId) {
      throw new WorkbenchError('LINK_CHANGED', 'current session is not linked to this task; locate or link it again')
    }
    if (!link) { await locate(root, issueId); link = await bestLink(root, issueId) }
    // Serialize with link changes and record syncs on the same session (§4.1.1).
    return serialized(link.sessionId, () => runCritical(root, issueId, link))
  }

  async function runCritical(root, issueId, link) {
    // Re-verify the link INSIDE the serial region: a concurrent switch may have
    // re-bound this session to another task. Never prompt into a switched session.
    const currentLink = await readJson(linkFile(root, link.sessionId))
    if (currentLink?.issueId !== issueId) {
      throw new WorkbenchError('LINK_CHANGED', 'session is now linked to another task; locate the task again')
    }
    if (currentLink.purpose === REVIEW_TASK_PURPOSE) {
      throw new WorkbenchError('REVIEW_TASK_ONLY', 'legacy review tasks are read-only')
    }
    const run = await readJson(runFile(root, issueId))
    let reuse = null
    if (run) {
      const observed = await observedSession(run.sessionId)
      try {
        const state = requestState(observed.session, run)
        const oldAgent = sessionOf(run.sessionId)
        if (submitting.has(run.runId)) return { alreadyStarting: true, sessionId: run.sessionId, runId: run.runId }
        if (state === 'ended' || state === 'cancelled') {
          // Catch up the original association before clearing its lock.
          const oldLink = await readJson(linkFile(root, run.sessionId))
          if (oldLink?.issueId === issueId && observed.session) {
            if ((await issueOf(root, issueId)).issue.status === 'todo' && observed.session.snapshotEvents(0).some(e => e.type === 'user/message' && e.data?.source?.rpcId === run.runId)) {
              await store.recordRunStart(root, oldLink.reqId, issueId)
            }
            // The run has ended: release abandoned calls (e.g. a stopped PTC
            // sub-call with no final result) so the lock clears and a retry can
            // start instead of returning alreadyRunning forever (§3.2).
            const result = await syncSession(root, observed.session, oldLink, { abandonEnded: true })
            if (!result.complete) return { alreadyRunning: true, sessionId: run.sessionId, runId: run.runId }
          }
          await rm(runFile(root, issueId), { force: true })
        } else if (state === 'running' || oldAgent?.status === 'running') {
          if (observed.session?.snapshotEvents().some(e => e.type === 'user/message' && e.data?.source?.rpcId === run.runId)) {
            await store.recordRunStart(root, link.reqId, issueId)
          }
          return { alreadyRunning: true, sessionId: run.sessionId, runId: run.runId }
        } else if (state === 'queued' || state === 'unknown' || run.sessionId !== link.sessionId || run.state === 'running') {
          return { [run.state === 'running' ? 'alreadyRunning' : 'alreadyStarting']: true, sessionId: run.sessionId, runId: run.runId }
        } else {
          reuse = run
        }
      } finally { observed.dispose() }
    }
    const agent = sessionOf(link.sessionId)
    if (agent?.status === 'running') return { busy: true, sessionId: link.sessionId }
    const runId = reuse ? reuse.runId : randomUUID()
    const sinceSeq = reuse ? (reuse.sinceSeq ?? 0) : (ctx.sessions.get(link.sessionId)?.seq ?? 0)
    // Lock acquisition and the state check share the same queue as cancellation
    // and requirement changes, so neither can commit between the check and claim.
    let req
    await store.withRequirementLock(root, link.reqId, async () => {
      if (!reuse) {
        const lock = { runId, sessionId: link.sessionId, state: 'starting', since: Date.now(), sinceSeq }
        await mkdir(dirname(runFile(root, issueId)), { recursive: true })
        try {
          await writeFile(runFile(root, issueId), JSON.stringify(lock, null, 2), { flag: 'wx' })
        } catch (e) {
          if (e?.code === 'EEXIST') throw new WorkbenchError('RUNNING', 'task already has a pending run')
          throw e
        }
      }
      try {
        const found = await issueOf(root, issueId)
        req = found.req
        if (req.status !== 'in_progress') throw new WorkbenchError('REQ_NOT_ACTIVE', 'the requirement must be in development to start a task')
        if (!['todo', 'doing', 'blocked'].includes(found.issue.status)) {
          throw new WorkbenchError('INVALID_STATE', `task is ${found.issue.status}; use confirm/continue/reopen instead of start`)
        }
        const missing = startBlockers(found.issue)
        if (missing.length) throw new WorkbenchError('MISSING_START_FIELDS', `fill before starting: ${missing.join(', ')}`)
      } catch (e) {
        if (!reuse) await rm(runFile(root, issueId), { force: true })
        throw e
      }
    })
    const text = '先调用 workbench_task_get 读取当前任务，按完成标准处理并验证。出现实质进展时，调用 workbench_task_note，首行写一句摘要，有实际处理细节、验证或缺口时换行补充。确认达到完成标准后，调用 workbench_task_submit 提交本次结果。用简短的日常中文说明结果和已知限制。任务会进入待验收，由用户在界面验收。'
    submitting.add(runId)
    try {
      // runId doubles as DSH requestId: a retry with the same id is deduplicated by the Host.
      await ctx.sessionController.prompt(
        { requestId: runId, sessionId: link.sessionId, mode: 'queue', content: [{ type: 'text', text }] },
        new AbortController().signal,
      )
    } catch (e) {
      const code = typeof e?.code === 'string' ? e.code : ''
      if (code.includes('/')) { // explicit Remote refusal → release the lock; task NOT started
        await rm(runFile(root, issueId), { force: true })
        throw new WorkbenchError('PROMPT_REJECTED', `${code}: ${e.message}`)
      }
      // Unclear outcome: keep the lock; the same runId verifies/retries without a new request.
      return { uncertain: true, sessionId: link.sessionId, runId }
    } finally {
      submitting.delete(runId)
    }
    // Admission can mean queued. Only a recorded user message establishes start.
    const session = ctx.sessions.get(link.sessionId)
    if (session?.snapshotEvents(0).some(e => e.type === 'user/message' && e.data?.source?.rpcId === runId)) {
      await store.recordRunStart(root, req.id, issueId)
    }
    await writeJson(runFile(root, issueId), { runId, sessionId: link.sessionId, state: 'running', since: Date.now(), sinceSeq })
    // Remember this run's request id so sync can attribute its turn to the task.
    const curLink = await readJson(linkFile(root, link.sessionId))
    if (curLink?.issueId === issueId) {
      await writeJson(linkFile(root, link.sessionId), { ...curLink, runIds: [...new Set([...(curLink.runIds ?? []), runId])] })
    }
    return { started: true, sessionId: link.sessionId, runId }
  }

  // ---- link management (tech §4.1.1/§4.2/§4.3) ----
  async function getLink(root, sessionId, { catchUp = false } = {}) {
    let link = await readJson(linkFile(root, sessionId))
    if (link?.purpose === REVIEW_TASK_PURPOSE) return { link: null, run: null, cursor: null }
    if (link) {
      const agent = sessionOf(sessionId)
      if (agent && cwdOf(agent) !== root) throw new WorkbenchError('WORKSPACE_MISMATCH', 'session belongs to another workspace')
      if (catchUp) {
        // Explicit pane reopen catches up an idle session; plain link/get stays read-only.
        await catchUpIdle(root, sessionId)
        link = await readJson(linkFile(root, sessionId))
      }
    }
    const run = link ? await readJson(runFile(root, link.issueId)) : null
    const cursor = link ? await readJson(cursorFile(root, sessionId)) : null
    return { link, run, cursor }
  }

  // Switch/unlink: idle + sync the ORIGINAL link to the log end first; only on
  // success update the link. A failed sync keeps the original link (§4.1.1).
  async function changeLink(root, sessionId, issueId /* null = clear */) {
    return serialized(sessionId, async () => {
      const agent = sessionOf(sessionId)
      const session = ctx.sessions.get(sessionId)
      if (!session) throw new WorkbenchError('NOT_FOUND', `session ${sessionId} not found`)
      if (cwdOf(agent) !== root) throw new WorkbenchError('WORKSPACE_MISMATCH', 'session belongs to another workspace')
      if (agent && agent.status !== 'idle') throw new WorkbenchError('SESSION_BUSY', 'stop the running session before changing its task')
      let target = null
      if (issueId != null) target = await issueOf(root, issueId) // validates project ownership
      const original = await readJson(linkFile(root, sessionId))
      if (original?.purpose === REVIEW_TASK_PURPOSE) {
        throw new WorkbenchError('REVIEW_TASK_ONLY', 'legacy review tasks are read-only')
      }
      let syncedSeq = null
      if (original?.sessionId === sessionId) {
        // Sync the original task to a STABLE, COMPLETE log end so late-settling
        // tool results are captured before the link moves (§4.1.1).
        let prevSeq = -1
        let complete = false
        for (let i = 0; i < 5 && session.seq !== prevSeq; i++) {
          prevSeq = session.seq
          complete = (await syncSession(root, session, original)).complete // throws on failure → original kept
        }
        if (session.seq !== prevSeq) throw new WorkbenchError('SYNC_UNSTABLE', 'records are still arriving; retry the switch')
        const run = await readJson(runFile(root, original.issueId))
        // A stopped run can still own its lock while it waits for an abandoned
        // tool result. Only the session that owns the ended run may drain it.
        if (run && (run.sessionId !== sessionId || !['ended', 'cancelled'].includes(requestState(session, run)))) {
          throw new WorkbenchError('SESSION_BUSY', 'the original task has a pending or running request; stop it and let its records sync first')
        }
        if (!complete) {
          // Release calls that can never settle (aborted with no result) so a
          // switch/unlink is not blocked forever; results that arrived during the
          // stability loop above were already captured.
          complete = (await syncSession(root, session, original, { abandonEnded: true })).complete
        }
        if (!complete) throw new WorkbenchError('SYNC_PENDING', 'the original task records are not fully synced; retry the switch')
        if (session.seq !== prevSeq) throw new WorkbenchError('SYNC_UNSTABLE', 'records are still arriving; retry the switch')
        syncedSeq = prevSeq
      }
      if (issueId == null) {
        await rm(linkFile(root, sessionId), { force: true })
        if (syncedSeq !== null && session.seq !== syncedSeq) {
          await writeJson(linkFile(root, sessionId), original)
          throw new WorkbenchError('SYNC_UNSTABLE', 'records arrived during unlink; retry after synchronization')
        }
        return { link: null, cleared: true }
      }
      const link = { sessionId, issueId, reqId: target.req.id, linkedAt: new Date().toISOString(), startSeq: syncedSeq ?? session.seq, runIds: [] }
      await writeJson(linkFile(root, sessionId), link)
      if (syncedSeq !== null && session.seq !== syncedSeq) {
        await writeJson(linkFile(root, sessionId), original)
        throw new WorkbenchError('SYNC_UNSTABLE', 'records arrived during switch; retry after synchronization')
      }
      return { link, switched: true }
    })
  }

  // Read-only runtime facts for the whole project (home reminders, blocked page).
  // The client combines these with DSH session status (pending interactions);
  // nothing is persisted and no sync or start is triggered here (tech §11).
  async function listRuns(root) {
    const local = localDir(root)
    const readDir = async name => {
      try { return (await readdir(join(local, name))).filter(f => !f.startsWith('.') && f.endsWith('.json')) } catch (e) {
        if (e?.code === 'ENOENT') return []
        throw e
      }
    }
    const nonempty = value => typeof value === 'string' && value.trim().length > 0
    const links = []
    for (const name of await readDir('links')) {
      const link = JSON.parse(await readFile(join(local, 'links', name), 'utf8'))
      if (!link || Array.isArray(link) || typeof link !== 'object' ||
          !nonempty(link.sessionId) || !nonempty(link.issueId) || !nonempty(link.reqId)) {
        throw new WorkbenchError('READ_FAILED', 'invalid session link record')
      }
      if (link.purpose !== REVIEW_TASK_PURPOSE) links.push(link)
    }
    const runs = new Map()
    for (const name of await readDir('runs')) {
      const run = JSON.parse(await readFile(join(local, 'runs', name), 'utf8'))
      if (run?.review) continue
      if (!run || Array.isArray(run) || typeof run !== 'object' ||
          !nonempty(run.runId) || !nonempty(run.sessionId) || !['starting', 'running'].includes(run.state)) {
        throw new WorkbenchError('READ_FAILED', 'invalid run record')
      }
      runs.set(name.slice(0, -5), run)
    }
    const byIssue = new Map()
    const sessionsByIssue = new Map()
    for (const link of links.sort((a, b) => (a.linkedAt < b.linkedAt ? -1 : 1))) {
      byIssue.set(link.issueId, link)
      const sessions = sessionsByIssue.get(link.issueId) ?? []
      sessions.push(link.sessionId)
      sessionsByIssue.set(link.issueId, sessions)
    }
    const out = []
    for (const issueId of new Set([...byIssue.keys(), ...runs.keys()])) {
      const run = runs.get(issueId) ?? null
      const latestLink = byIssue.get(issueId) ?? null
      const link = run ? links.find(item => item.issueId === issueId && item.sessionId === run.sessionId) ?? null : latestLink
      const sessionId = run?.sessionId ?? link?.sessionId ?? null
      const agent = sessionId ? sessionOf(sessionId) : null
      // Audit records provide the request start, not when its approval card
      // became visible. Return only unresolved requests in the current turn of
      // live, linked sessions belonging to this exact project. The client must
      // still match a live pending interaction before using any of these times.
      const approvalRequests = []
      for (const sid of new Set(sessionsByIssue.get(issueId) ?? [])) {
        const linkedAgent = sessionOf(sid)
        const session = linkedAgent?.session
        if (!session || session.id !== sid || session.header?.cwd !== root) continue
        try {
          const events = session.snapshotEvents(0)
          let start = -1
          for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].type === 'turn/end') break
            if (events[i].type === 'turn/start') { start = i; break }
          }
          if (start < 0) continue
          const current = new Map()
          for (let i = start + 1; i < events.length; i++) {
            const event = events[i]
            if (event.type === 'approval/asked') {
              const { id, callId, toolName } = event.data ?? {}
              if (typeof id !== 'string' || !id || typeof callId !== 'string' || !callId || typeof toolName !== 'string' || !toolName || !Number.isFinite(event.time) || event.time <= 0) continue
              // A duplicate audit id is ambiguous, even if both values match.
              if (current.has(id)) current.set(id, null)
              else current.set(id, { sessionId: sid, approvalId: id, callId, toolName, askedAt: event.time })
            } else if (event.type === 'approval/decided' && typeof event.data?.id === 'string') {
              current.delete(event.data.id)
            }
          }
          approvalRequests.push(...[...current.values()].filter(Boolean))
        } catch { /* unavailable log means the approval start stays unknown */ }
      }
      out.push({
        issueId, reqId: link?.reqId ?? latestLink?.reqId ?? null, sessionId,
        sessionIds: [...new Set((sessionsByIssue.get(issueId) ?? []).slice().reverse())],
        runState: run?.state ?? null, runSince: Number(run?.since) || 0,
        sessionLive: !!agent, sessionRunning: agent?.status === 'running',
        unrecorded: link?.unrecorded ?? false,
        approvalRequests,
      })
    }
    return { runs: out }
  }

  async function listSessions(root, issueId) {
    let names = []
    try { names = await readdir(join(localDir(root), 'links')) } catch { return { sessions: [] } }
    const out = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const link = await readJson(join(localDir(root), 'links', name))
      if (link?.issueId === issueId) out.push(link)
    }
    out.sort((a, b) => (a.linkedAt < b.linkedAt ? 1 : -1))
    return { sessions: out }
  }

  function assertRoot(root) {
    if (typeof root !== 'string' || !root.startsWith('/') || root.includes('\0')) throw new WorkbenchError('INVALID_ROOT', 'root must be an absolute path')
  }
  const routes = {
    'link/get': async i => { assertRoot(i.root); return getLink(i.root, i.sessionId, { catchUp: i.catchUp === true }) },
    'link/set': async i => { assertRoot(i.root); return changeLink(i.root, i.sessionId, i.issueId) },
    'link/clear': async i => { assertRoot(i.root); return changeLink(i.root, i.sessionId, null) },
    'link/listSessions': async i => { assertRoot(i.root); return listSessions(i.root, i.issueId) },
    'run/list': async i => { assertRoot(i.root); return listRuns(i.root) },
    'task/locate': async i => { assertRoot(i.root); return locate(i.root, i.issueId, i.sessionId ?? null) },
    'run/start': async i => { assertRoot(i.root); return runStart(i.root, i.issueId, i.sessionId) },
  }

  return { routes, locate, runStart, getLink, changeLink, listSessions, syncSession, catchUpIdle, findLinkByIssue, issueOf, linkFile, runFile, cursorFile, serialized, reviewLink }
}
