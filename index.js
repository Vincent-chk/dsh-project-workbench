import { handleRequest } from './core/rpc.js'
import { installConversation } from './core/conversation.js'
import { archRenderErrorKeys, workbenchContentLocale } from './client-src/workbench-content.js'
import { loadDiscoverySkill, loadOpenWikiSkill } from './core/skill.js'
import { spawnProbe, spawnWikiProbe, startWikiGeneration, startSyncRun, parseSyncOutput, startArchitectureRun, parseArchOutput, startArchitectureRepair, consumeChildToolAllow } from './core/spawn.js'
import * as store from './core/store.js'
import { wikiJobCompleted, wikiStatus } from './core/wiki.js'
import { submitProposals, writeBaseline, readBaseline } from './core/proposals.js'
import { renderArchitecture, readArchitecture } from './core/architecture.js'
import { wikiGuardDenial } from './core/wiki-guard.js'
import { prepareWikiStaging } from './core/wiki-staging.js'
import { captureWikiBaseline, publishWikiCandidate } from './core/wiki-publish.js'
import { wikiGitRoot } from './core/git.js'
import { installLinks } from './core/link.js'
import { projectWriteDenial, taskReadDenial, reviewToolDenial } from './core/write-guard.js'
import { installTools } from './core/tools.js'
import { installDelivery } from './core/delivery.js'
import { installAssist } from './core/assist.js'
import { installAcceptanceAssist } from './core/acceptance-assist.js'
import { installDiscovery } from './core/discovery.js'
import { installRequirementReview } from './core/requirement-review.js'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { atomicWrite, WorkbenchError } from './core/files.js'

export const inject = ['connection', 'skills', 'mcpManager', 'agents', 'subagents', 'sandboxPolicy', 'tools', 'sessions', 'sessionController', 'sessionQuery', 'workspaceRegistry', 'systemPrompt']

function jsonBody(handler) {
  return async request => {
    let body
    try { body = await request.json() } catch {
      return Response.json({ ok: false, code: 'INVALID_JSON', message: 'request body must be JSON' }, { status: 400 })
    }
    return handler(body)
  }
}

export async function apply(ctx) {
  // Install the shared session/task machinery and its normal write boundary.
  const links = installLinks(ctx)
  ctx.effect(() => ctx.tools.guard(exec => {
    const root = exec.agent?.session?.header?.cwd
    if (links.reviewLink(exec.agent)) return reviewToolDenial(exec.name, exec.arguments, root)
    const writeDenial = projectWriteDenial(exec.name, exec.arguments, root)
    if (writeDenial) return writeDenial
    const readDenial = taskReadDenial(exec.name, exec.arguments, root)
    if (!readDenial || !root) return undefined
    // Only linked task sessions are restricted to their own project. Unlinked
    // conversations, UI calls and background jobs keep their existing behavior.
    const sessionId = exec.agent?.session?.id
    return sessionId && existsSync(join(root, '.project', '.local', 'links', `${sessionId}.json`)) ? readDenial : undefined
  }), 'project-workbench: project write and linked-task read guard')
  const openWikiSkill = await loadOpenWikiSkill()
  ctx.effect(() => ctx.skills.register(openWikiSkill), 'project-workbench: OpenWiki skill')
  const discoverySkill = await loadDiscoverySkill()
  ctx.effect(() => ctx.skills.register(discoverySkill), 'project-workbench: Grill Me skill')
  ctx.effect(() => ctx.mcpManager.register('openwiki', {
    transport: 'stdio',
    command: 'npx',
    args: ['--yes', 'openwiki@0.9.0', 'mcp', '--host', 'dsh'],
    env: { DO_NOT_TRACK: '1', OPENWIKI_TELEMETRY_DISABLED: '1' },
    startupTimeoutMs: 180000,
  }), 'project-workbench: OpenWiki MCP')
  const readOnlyChildren = new Set()
  // Stage-3 AI toolchain: formal task tools + current-task context, requirement
  // organize/split previews, and the automatic delivery summary after the last
  // task is confirmed/cancelled. Background children stay read-only (§3.7).
  const delivery = installDelivery(ctx, { readOnlyChildren })
  const assist = installAssist(ctx, { readOnlyChildren })
  const acceptanceAssist = installAcceptanceAssist(ctx, { readOnlyChildren, links })
  const requirementReview = installRequirementReview(ctx, { readOnlyChildren })
  installTools(ctx, links)
  const discovery = installDiscovery(ctx, { readOnlyChildren })
  const workbenchRoutes = {
    ...links.routes, ...assist.routes, ...delivery.routes, ...acceptanceAssist.routes, ...requirementReview.routes, ...discovery.routes,
  }
  // Every terminal-task entry (RPC confirm/move AND proposal adoption) fires the
  // same store trigger, so the automatic delivery summary cannot be bypassed.
  ctx.effect(() => store.onTaskTerminal((root, reqId) => void delivery.maybeSubmit(root, reqId)), 'project-workbench: delivery trigger')
  const wikiChildren = new Map() // childId -> root: wiki generator may only write openwiki/ (§7.3)
  const wikiJobs = new Map() // root -> {status, childId, summary, error, startedAt}
  const wikiControllers = new Map() // childId -> controller, including an activation still starting
  const wikiStarts = new Set() // requests admitted before an asynchronous preflight
  const wikiStops = new Set() // stop requests, including body and orphan reads
  let wikiClosing = false
  // The OpenWiki MCP server keeps ONE process-local active run, so generations are serialized across projects.
  let wikiStarting = false
  const wikiBusy = () => wikiChildren.size > 0 || [...wikiJobs.values()].some(job => job.status === 'running' || job.status === 'stopping' || job.persisting)
  const disposeWikiJob = job => {
    if (!job.disposePromise) {
      job.disposePromise = Promise.resolve().then(() => {
        if (typeof job.dispose !== 'function') throw new Error('Wiki child has no disposal handle')
        return job.dispose()
      })
    }
    return job.disposePromise
  }
  // Last wiki job outcome survives UI navigation and plugin reload, so a stopped/interrupted run stays visible and resumable.
  const wikiJobFile = root => join(root, '.project', '.local', 'wiki-job.json')
  const recordWikiJob = (root, job, status = job.status) => {
    const record = { status, error: job.error || '', childId: job.childId, startedAt: job.startedAt,
      ...(job.strategy ? { strategy: job.strategy } : {}),
      ...(job.baseView ? { baseView: job.baseView } : {}),
      ...(job.viewEpoch ? { viewEpoch: job.viewEpoch, viewSnapshotId: job.viewSnapshotId ?? null } : {}),
      ...(status === 'done' && job.viewCompletionHash ? { viewCompletionHash: job.viewCompletionHash } : {}),
      ...(status === 'failed' && Object.hasOwn(job, 'failureUpdateHash') ? { failureUpdateHash: job.failureUpdateHash, failureUpdateAt: job.failureUpdateAt } : {}),
      ...(status === 'running' ? {} : { endedAt: Date.now() }) }
    // A stop and a fast child completion can write concurrently: preserve order.
    const pending = (job.recordPromise ?? Promise.resolve()).catch(() => {}).then(async () => {
      await atomicWrite(wikiJobFile(root), JSON.stringify(record, null, 2))
    })
    job.recordPromise = pending
    return pending
  }
  const syncJobs = new Map() // root -> {status, childId, saved, error, startedAt}
  const archJobs = new Map() // root -> {status, childId, error, phase}
  ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
    if (!readOnlyChildren.delete(agent.session.id)) return
    agent.session.append('sandbox/mode', { mode: 'read-only', source: 'delegation' })
    const desired = consumeChildToolAllow(agent.session.id)
    if (!desired) return
    const tools = agent.ctx.tools
    // DSH's schema query needs the Agent explicitly. An empty allowlist hides
    // every inherited tool when the preset has none of the required tools.
    const available = new Set(tools.schemas(agent).map(tool => tool.name))
    const allow = desired.filter(name => available.has(name))
    tools.restrict({ allow })
    // DSH does not mask tools registered on the child itself. An error in this
    // serial creation hook aborts startup before the child receives its prompt.
    if (tools.schemas(agent).some(tool => !allow.includes(tool.name))) {
      throw new Error('后台分身工具限制未生效，无法启动')
    }
  }), 'project-workbench: child read-only policy')
  // Cordis disposes separate effects concurrently. Keep the guard and the
  // awaited child teardown in this one effect so the guard is removed last.
  ctx.effect(function* () {
    yield ctx.tools.guard(exec => {
      const sessionId = exec.agent?.session?.id
      if (!sessionId) return undefined
      const target = wikiChildren.get(sessionId)
      if (!target) return undefined
      return wikiGuardDenial(exec.name, exec.arguments, target /* { root, mode } */)
    })
    yield async () => {
      wikiClosing = true
      for (const controller of wikiControllers.values()) controller.abort()
      // A request can still be in Git/snapshot preflight or awaiting a late
      // activation receipt. Keep the guard until all admitted requests settle.
      await Promise.all([...wikiStarts, ...wikiStops])
      const failures = []
      const uncertain = new Set()
      for (const job of wikiJobs.values()) {
        if (!wikiChildren.has(job.childId)) continue
        job.abort?.()
        try { ctx.subagents.interrupt(job.childId, { kind: 'user' }) } catch { /* disposal remains authoritative */ }
        let failed = false
        for (const operation of [() => disposeWikiJob(job), () => job.settlement, () => job.stopRecord, () => job.recordPromise]) {
          try { await operation() } catch (error) { failures.push(error); failed = true }
        }
        if (!failed) {
          wikiChildren.delete(job.childId)
          wikiControllers.delete(job.childId)
        } else uncertain.add(job.childId)
      }
      // A failed startup can leave no receipt. Do not release the guard if a
      // child with that identity is still live and cannot be strictly joined.
      for (const childId of wikiChildren.keys()) {
        if (uncertain.has(childId)) continue
        if (ctx.agents.get(childId)) failures.push(new Error('Wiki child remained active after startup failed'))
        else { wikiChildren.delete(childId); wikiControllers.delete(childId) }
      }
      if (failures.length) throw new AggregateError(failures, 'Wiki child teardown did not complete safely')
    }
  }, 'project-workbench: wiki child write scope')
  let turnEnds = 0
  ctx.effect(function* () {
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => handleRequest(request, workbenchRoutes),
    })
    yield ctx.on('session/event', (_session, event) => {
      if (event.type === 'turn/end') turnEnds++
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/events',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => Response.json({ ok: true, data: { turnEnds } }),
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/mcp',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => Response.json({ ok: true, data: ctx.mcpManager.list() }),
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/spawn',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        let body
        try { body = await request.json() } catch {
          return Response.json({ ok: false, code: 'INVALID_JSON', message: 'request body must be JSON' }, { status: 400 })
        }
        return Response.json(await spawnProbe(ctx, readOnlyChildren, body?.sessionId, request.signal))
      },
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/wiki-probe',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        let body
        try { body = await request.json() } catch {
          return Response.json({ ok: false, code: 'INVALID_JSON', message: 'request body must be JSON' }, { status: 400 })
        }
        return Response.json(await spawnWikiProbe(ctx, readOnlyChildren, body?.sessionId, request.signal, body?.root))
      },
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/wiki-generate',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: jsonBody(startWiki),
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/wiki-generate-status',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: jsonBody(statusWiki),
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/wiki-generate-stop',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        if (wikiClosing) return Response.json({ ok: false, code: 'WIKI_CLOSING', message: 'Wiki generation is shutting down' })
        let finishStop
        const stopDone = new Promise(resolve => { finishStop = resolve })
        wikiStops.add(stopDone)
        try {
        let body
        try { body = await request.json() } catch {
          return Response.json({ ok: false, code: 'INVALID_JSON', message: 'request body must be JSON' }, { status: 400 })
        }
        if (wikiClosing) return Response.json({ ok: false, code: 'WIKI_CLOSING', message: 'Wiki generation is shutting down' })
        const job = wikiJobs.get(body?.root)
        if (job && (job.status === 'running' || job.status === 'stopping')) {
          if (job.persisting) return Response.json({ ok: true, data: { stopped: false, reason: 'finishing' } })
          if (job.preparing) {
            job.status = 'stopping'
            if (job.childId) {
              wikiControllers.get(job.childId)?.abort()
              try { ctx.subagents.interrupt(job.childId, { kind: 'user' }) } catch { /* startup may not have registered it yet */ }
            }
            return Response.json({ ok: true, data: { stopped: true } })
          }
          // The caller signal only governs startup; disposing the activation is what stops a running child.
          job.abort?.()
          void disposeWikiJob(job).catch(() => {
            // A rejected dispose is not a confirmed stop, even if no result
            // ever arrives. Keep the guard and report a failed cleanup.
            job.error = 'Wiki child teardown did not complete safely'
            job.status = 'failed'
            job.stopRecord = recordWikiJob(body?.root, job, 'failed')
            void job.stopRecord.catch(() => {})
          })
          try { ctx.subagents.interrupt(job.childId, { kind: 'user' }) } catch { /* already gone */ }
          if (job.status === 'running') job.status = 'stopping' // settle handler flips it to failed/stopped
          job.stopRecord = recordWikiJob(body?.root, job)
          void job.stopRecord.catch(() => { /* terminal write reports persistence failure */ })
          return Response.json({ ok: true, data: { stopped: true } })
        }
        // A job from a previous plugin instance is not in memory; the persisted child id still identifies it.
        let orphan = null
        try { orphan = JSON.parse(await readFile(wikiJobFile(body?.root), 'utf8')) } catch { /* none */ }
        if (wikiClosing) return Response.json({ ok: false, code: 'WIKI_CLOSING', message: 'Wiki generation is shutting down' })
        if (orphan?.childId && (orphan.status === 'running' || orphan.status === 'stopping')) {
          try { ctx.subagents.interrupt(orphan.childId, { kind: 'user' }) } catch { /* already gone */ }
          const stopped = { ...orphan, status: 'failed', error: 'stopped by user', endedAt: Date.now() }
          try { await atomicWrite(wikiJobFile(body?.root), JSON.stringify(stopped, null, 2)) } catch { /* best effort */ }
          return Response.json({ ok: true, data: { stopped: true, orphan: true } })
        }
        return Response.json({ ok: true, data: { stopped: false, reason: 'no running job' } })
        } finally {
          wikiStops.delete(stopDone)
          finishStop()
        }
      },
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/sync-run',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        let body
        try { body = await request.json() } catch {
          return Response.json({ ok: false, code: 'INVALID_JSON', message: 'request body must be JSON' }, { status: 400 })
        }
        const root = body?.root
        if (!root) return Response.json({ ok: false, code: 'ROOT_REQUIRED', message: 'root is required' }, { status: 400 })
        const existing = syncJobs.get(root)
        if (existing && existing.status === 'running') return Response.json({ ok: true, data: { alreadyRunning: true } })
        const started = await startSyncRun(ctx, readOnlyChildren, body?.sessionId, root)
        if (!started.ok) return Response.json(started)
        const job = { status: 'running', childId: started.data.childId, saved: 0, error: '', raw: '', startedAt: Date.now(), abort: started.data.abort }
        syncJobs.set(root, job)
        started.data.result.then(async result => {
          const output = result.output.filter(b => b.type === 'text').map(b => b.text).join('\n')
          job.raw = output.slice(-4000)
          if (result.stopReason !== 'completed') { job.status = 'failed'; job.error = result.diagnostic ?? `child ended: ${result.stopReason}`; return }
          // Host single-writer: parse the read-only child's proposals, validate, persist.
          const { proposals, parseError } = parseSyncOutput(output)
          if (parseError) { job.status = 'failed'; job.error = parseError; return }
          try {
            const res = await submitProposals(root, proposals)
            job.saved = res.data.saved.length
            job.produced = proposals.length
            const base = await readBaseline(root)
            await writeBaseline(root, { lastSyncAt: new Date().toISOString(), produced: (base.produced ?? 0) + proposals.length })
            job.status = 'done'
          } catch (e) { job.status = 'failed'; job.error = e instanceof Error ? e.message : String(e) }
        }).catch(e => { job.status = 'failed'; job.error = e instanceof Error ? e.message : String(e) })
        return Response.json({ ok: true, data: { started: true, childId: job.childId } })
      },
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/sync-status',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        let body
        try { body = await request.json() } catch {
          return Response.json({ ok: false, code: 'INVALID_JSON', message: 'request body must be JSON' }, { status: 400 })
        }
        const job = syncJobs.get(body?.root)
        if (!job) return Response.json({ ok: true, data: { status: 'idle' } })
        return Response.json({ ok: true, data: { status: job.status, saved: job.saved, produced: job.produced ?? 0, error: job.error, raw: job.raw, childId: job.childId } })
      },
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/sync-stop',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        let body
        try { body = await request.json() } catch {
          return Response.json({ ok: false, code: 'INVALID_JSON', message: 'request body must be JSON' }, { status: 400 })
        }
        const job = syncJobs.get(body?.root)
        if (!job || job.status !== 'running') return Response.json({ ok: true, data: { stopped: false } })
        job.abort?.()
        job.status = 'failed'; job.error = 'stopped by user'
        return Response.json({ ok: true, data: { stopped: true } })
      },
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/arch-generate',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: jsonBody(startArchitecture),
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/arch-status',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: jsonBody(statusArchitecture),
    })
    yield ctx.connection.fetch.register({
      path: '/api/project-workbench/arch-stop',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        let body
        try { body = await request.json() } catch {
          return Response.json({ ok: false, code: 'INVALID_JSON', message: 'request body must be JSON' }, { status: 400 })
        }
        const job = archJobs.get(body?.root)
        if (!job || job.status !== 'running') return Response.json({ ok: true, data: { stopped: false } })
        job.status = 'stopping'; job.error = 'stopped by user'
        job.controller.abort()
        job.abort?.()
        return Response.json({ ok: true, data: { stopped: false, stopping: true } })
      },
    })
  }, 'project-workbench: S0 probes')

  const resource = (start, status) => ({
    start: async input => (await start(input)).json(),
    status: async input => (await status(input)).json(),
  })
  Object.assign(workbenchRoutes, installConversation(ctx, {
    links, discovery, routes: workbenchRoutes,
    resources: { wiki: resource(startWiki, statusWiki), arch: resource(startArchitecture, statusArchitecture) },
  }))

  async function startWiki(body) {
    if (wikiClosing) return Response.json({ ok: false, code: 'WIKI_CLOSING', message: 'Wiki generation is shutting down' })
    const root = body?.root
    if (!root) return Response.json({ ok: false, code: 'ROOT_REQUIRED', message: 'root is required' }, { status: 400 })
    const existing = wikiJobs.get(root)
    if (existing?.persisting) return Response.json({ ok: false, code: 'WIKI_BUSY', message: 'the previous Wiki result is still being saved' })
    if (existing && existing.status === 'running') {
      return Response.json({ ok: true, data: { alreadyRunning: true, childId: existing.childId } })
    }
    if (wikiStarting || wikiBusy()) return Response.json({ ok: false, code: 'WIKI_BUSY', message: 'another project is generating its wiki; wait for it or stop it first' })
    // Each start generates from scratch in an isolated Git working copy.
    // Only this run's durable completion permits publication; stop/failure
    // leaves the live Wiki in place. In-memory guards prevent double-starts.
    wikiStarting = true
    let finishStart
    const startDone = new Promise(resolve => { finishStart = resolve })
    wikiStarts.add(startDone)
    try {
    const startedAt = Date.now()
    let staged, started, childId, safeLocal = false
    const job = { status: 'running', childId: null, summary: '', error: '', startedAt, strategy: 'staged', preparing: true }
    wikiJobs.set(root, job)
    const closingResult = async () => {
      if (staged) await staged.cleanup().catch(() => {})
      job.preparing = false
      job.status = 'failed'
      job.error = wikiClosing ? 'Wiki generation was interrupted before startup' : 'stopped by user'
      if (safeLocal) try { await recordWikiJob(root, job, 'failed') } catch { /* old Wiki remains untouched */ }
      return Response.json({ ok: false, code: wikiClosing ? 'WIKI_CLOSING' : 'WIKI_STOPPED', message: job.error })
    }
    try {
      const rootCheck = await wikiGitRoot(root)
      if (wikiClosing || job.status === 'stopping') return await closingResult()
      if (!rootCheck.ok) { wikiJobs.delete(root); return Response.json(rootCheck) }
      // Do not let a redirected project-local directory move job state or
      // the publication backup outside the selected workspace.
      const projectDirectory = join(root, '.project')
      const projectInfo = await lstat(projectDirectory)
      if (!projectInfo.isDirectory() || projectInfo.isSymbolicLink()) throw new Error('project data directory is unsafe')
      const localDirectory = join(projectDirectory, '.local')
      try { await mkdir(localDirectory) } catch (error) { if (error.code !== 'EEXIST') throw error }
      const localInfo = await lstat(localDirectory)
      if (!localInfo.isDirectory() || localInfo.isSymbolicLink()) throw new Error('project local directory is unsafe')
      safeLocal = true
      const previousView = await wikiStatus(root)
      job.baseView = !previousView.viewIsSnapshot && !previousView.viewUnavailable && !previousView.viewUnprotected ? 'live' : 'legacy'
      if (wikiClosing || job.status === 'stopping') return await closingResult()
      const baseline = await captureWikiBaseline(root)
      if (wikiClosing || job.status === 'stopping') return await closingResult()
      staged = await prepareWikiStaging(root)
      if (wikiClosing || job.status === 'stopping') return await closingResult()
      // Start a fresh run in the private copy. The original Wiki, including
      // any interrupted legacy run, is never touched by the generator.
      await rm(join(staged.root, 'openwiki'), { recursive: true, force: true })
      if (wikiClosing || job.status === 'stopping') return await closingResult()
      childId = `session-${randomUUID()}`
      job.childId = childId
      job.baseline = baseline
      try { await recordWikiJob(root, job) } catch { throw new Error('cannot persist Wiki generation state') }
      if (wikiClosing || job.status === 'stopping') return await closingResult()
      // The child may dispatch tools before startActivation resolves.
      wikiChildren.set(childId, { root: staged.root, mode: 'init', resumeRunId: null, initStarted: false })
      const controller = new AbortController()
      wikiControllers.set(childId, controller)
      started = await startWikiGeneration(ctx, body?.sessionId, staged.root, { mode: 'init', resume: false }, childId, controller)
    } catch (error) {
      if (staged && !started?.ok && (!childId || !ctx.agents.get(childId))) await staged.cleanup().catch(() => {})
      job.preparing = false; job.status = 'failed'; job.error = error instanceof Error ? error.message : String(error)
      if (safeLocal) try { await recordWikiJob(root, job, 'failed') } catch { /* original Wiki is untouched */ }
      const unsupported = /not supported|unsupported source file|unsupported Git path|unsupported file names/i.test(job.error)
      return Response.json({ ok: false, code: unsupported ? 'WIKI_SOURCE_UNSUPPORTED' : 'WIKI_STAGING_FAILED', message: job.error })
    } finally {
      if (childId && !started?.ok && !ctx.agents.get(childId)) {
        wikiChildren.delete(childId)
        wikiControllers.delete(childId)
      }
    }
    if (!started.ok) {
      if (!ctx.agents.get(childId)) await staged.cleanup().catch(() => {})
      job.preparing = false; job.status = 'failed'
      job.error = started.message || 'Wiki generation could not start'
      try { await recordWikiJob(root, job, 'failed') } catch { /* original Wiki remains untouched */ }
      return Response.json(started)
    }
    job.preparing = false
    job.abort = started.data.abort; job.dispose = started.data.dispose
    wikiJobs.set(root, job)
    if (wikiClosing || job.status === 'stopping') {
      job.status = 'stopping'
      job.abort()
      try { ctx.subagents.interrupt(job.childId, { kind: 'user' }) } catch { /* disposal remains authoritative */ }
      void disposeWikiJob(job).catch(() => {})
    }
    const settle = async (result, error) => {
      job.persisting = true
      const stopped = job.status === 'stopping'
      const endedAt = Date.now()
      let teardownError = null
      // Result delivery can precede rejection of the activation's own
      // teardown. Join its exact disposal even on normal completion.
      try { await disposeWikiJob(job) } catch (failure) { teardownError = failure }
      if (result) job.summary = result.output.filter(b => b.type === 'text').map(b => b.text).join('\n')
      const complete = result?.stopReason === 'completed' && await wikiJobCompleted(staged.root, { startedAt, endedAt, previousUpdate: null })
      let terminal = 'failed'
      if (!stopped && !wikiClosing && !teardownError && complete) {
        try {
          if (!await staged.verifySource()) { const conflict = new Error('source changed during Wiki generation'); conflict.code = 'WIKI_CONFLICT'; throw conflict }
          if (wikiClosing) throw new Error('Wiki generation was interrupted during shutdown')
          await publishWikiCandidate(root, join(staged.root, 'openwiki'), job.baseline)
          terminal = 'done'
        } catch (failure) {
          job.error = failure?.backup ? `Wiki publication needs recovery: ${failure.backup}` :
            failure?.code === 'WIKI_CONFLICT' ? 'Wiki or source changed during generation' : 'Wiki publication failed'
        }
      }
      if (terminal === 'failed') job.error = teardownError ? 'Wiki child teardown did not complete safely' : stopped ? 'stopped by user' :
        job.error || (error ? (error instanceof Error ? error.message : String(error)) :
          (result?.stopReason !== 'completed' ? (result?.diagnostic ?? `child ended: ${result?.stopReason}`) : 'wiki generation did not finish'))
      if (!teardownError) await staged.cleanup().catch(() => {})
      try { await recordWikiJob(root, job, terminal) } catch (failure) {
        job.status = 'failed'; job.error = terminal === 'done' ? 'Wiki was published but its status could not be saved' : 'could not persist Wiki generation state'; job.persisting = false
        throw failure
      }
      job.status = terminal
      job.persisting = false
      if (!wikiClosing && !teardownError) {
        wikiChildren.delete(job.childId)
        wikiControllers.delete(job.childId)
      }
    }
    job.settlement = started.data.result.then(result => settle(result, null), error => settle(null, error)).catch(error => {
      job.status = 'failed'; job.error ||= error instanceof Error ? error.message : String(error); job.persisting = false
      throw error
    })
    void job.settlement.catch(() => {})
    if (wikiClosing) return Response.json({ ok: false, code: 'WIKI_CLOSING', message: 'Wiki generation is shutting down' })
    return Response.json({ ok: true, data: { started: true, childId: job.childId } })
    } finally {
      wikiStarting = false
      wikiStarts.delete(startDone)
      finishStart()
    }
  }

  async function statusWiki(body) {
    const job = wikiJobs.get(body?.root)
    if (!job) {
      let last = null
      try { last = JSON.parse(await readFile(wikiJobFile(body?.root), 'utf8')) } catch { /* no previous job */ }
      // A persisted `running` with no in-memory job means the Host reloaded mid-run: report it as interrupted.
      if (last?.status === 'running' || last?.status === 'stopping') last = { ...last, status: 'failed', error: 'generation was interrupted (plugin reloaded)' }
      return Response.json({ ok: true, data: { status: 'idle', last } })
    }
    return Response.json({ ok: true, data: { status: job.status, summary: job.summary, error: job.error, childId: job.childId } })
  }

  async function startArchitecture(body) {
    const root = body?.root
    if (!root) return Response.json({ ok: false, code: 'ROOT_REQUIRED', message: 'root is required' }, { status: 400 })
    const existing = archJobs.get(root)
    if (existing && ['running', 'stopping'].includes(existing.status)) return Response.json({ ok: true, data: { alreadyRunning: true } })
    // Reserve before the first await so simultaneous clicks cannot start two
    // children; a stop during activation remains pending until it settles.
    const controller = new AbortController()
    const job = { status: 'running', phase: 'starting', childId: null, error: '', abort: null, controller }
    archJobs.set(root, job)
    const candDir = join(root, '.project', '.local', 'archify')
    const candidatePath = join(candDir, 'candidate.json')
    let started
    try {
      await mkdir(candDir, { recursive: true })
      if (controller.signal.aborted) { job.status = 'failed'; return Response.json({ ok: true, data: { stopped: true } }) }
      started = await startArchitectureRun(ctx, readOnlyChildren, body?.sessionId, root)
    } catch (error) {
      job.status = 'failed'; job.error = controller.signal.aborted ? 'stopped by user' : String(error.message ?? error)
      return Response.json({ ok: false, code: 'SPAWN_FAILED', message: job.error })
    }
    if (!started.ok) {
      job.status = 'failed'; job.error = controller.signal.aborted ? 'stopped by user' : started.message
      job.code = started.code
      return Response.json(started)
    }
    job.childId = started.data.childId
    job.abort = started.data.abort
    if (controller.signal.aborted) job.abort()
    else job.phase = 'authoring'
    const childText = result => result.output.filter(b => b.type === 'text').map(b => b.text).join('\n')
    const renderCandidate = async candidate => {
      await writeFile(candidatePath, JSON.stringify(candidate, null, 2), 'utf8')
      await renderArchitecture(root, candidatePath, controller.signal)
    }
    started.data.result.then(async result => {
      if (controller.signal.aborted) return
      if (result.stopReason !== 'completed') {
        job.status = 'failed'; job.error = result.diagnostic || `architecture child ended: ${result.stopReason}`; return
      }
      let { candidate, parseError } = parseArchOutput(childText(result))
      if (!candidate) {
        if (parseError === 'ARCH_SOURCE_REQUIRED') throw new WorkbenchError(parseError, 'no readable implementation source found')
        job.status = 'failed'; job.error = parseError || 'no architecture candidate produced'; return
      }
      // Bounded author -> render -> repair loop: archify layout gates need
      // iteration; feed the renderer's exact errors back to a read-only child.
      const MAX_REPAIRS = 1
      for (let attempt = 0; ; attempt++) {
        job.phase = 'rendering'
        try {
          await renderCandidate(candidate)
          if (controller.signal.aborted) return
          job.status = 'done'; return
        } catch (e) {
          if (controller.signal.aborted) return
          if (attempt >= MAX_REPAIRS) throw e
          job.phase = 'repairing'
          const fix = await startArchitectureRepair(ctx, readOnlyChildren, body?.sessionId, root, candidate, e.message)
          if (controller.signal.aborted) { fix.data?.abort(); return }
          if (!fix.ok) throw e
          job.abort = fix.data.abort
          const fixResult = await fix.data.result
          if (controller.signal.aborted) return
          if (fixResult.stopReason !== 'completed') throw e
          const parsed = parseArchOutput(childText(fixResult))
          if (!parsed.candidate) throw e
          candidate = parsed.candidate
        }
      }
    }).catch(e => {
      if (controller.signal.aborted) return
      job.status = 'failed'; job.error = e instanceof Error ? e.message : String(e)
      job.code = e?.code
    }).finally(() => {
      if (controller.signal.aborted) { job.status = 'failed'; job.error = 'stopped by user' }
    })
    return Response.json({ ok: true, data: { started: true, childId: job.childId } })
  }

  async function statusArchitecture(body) {
    const job = archJobs.get(body?.root)
    if (!job) return Response.json({ ok: true, data: { status: 'idle' } })
    const messageKey = archRenderErrorKeys.get(job.code)
    return Response.json({ ok: true, data: { status: job.status, phase: job.phase, error: job.error,
      code: job.code, childId: job.childId, ...(messageKey && { message: workbenchContentLocale.zh[messageKey] }) } })
  }
}
