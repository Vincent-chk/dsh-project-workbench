// Stage-1 DEV-ONLY live probe (PROTOTYPE — removable). Runs ONCE at plugin
// activation when /tmp/pw-stage1-probe.json exists, drives the real Host flow
// (no mocks) and writes a JSON report. Same tradition as stage-0 spawn probes.
import { readFile, writeFile, rm, mkdir, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeToolCalls, extractFacts } from './extract.js'

const FLAG = '/tmp/pw-stage1-probe.json'
export const FAIL_NOTE_FLAG = '/tmp/pw-fail-note'

export function maybeRunLiveProbe(ctx, api) {
  void (async () => {
    let plan
    try { plan = JSON.parse(await readFile(FLAG, 'utf8')) } catch { return }
    await rm(FLAG, { force: true })
    const reportFile = plan.report ?? '/tmp/pw-stage1-probe-report.json'
    const report = { startedAt: new Date().toISOString(), phases: {} }
    const save = () => writeFile(reportFile, JSON.stringify(report, null, 2))
    const phase = async (name, data) => { report.phases[name] = { at: new Date().toISOString(), ...data }; await save() }
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const readJson = async p => { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }
    try {
      const root = plan.root
      const eventsOf = sid => ctx.sessions.get(sid)?.snapshotEvents() ?? []
      const rpcPrompts = evs => evs.filter(e => e.type === 'user/message' && e.data.source?.kind === 'user' && e.data.source?.rpcId)
      const steers = evs => evs.filter(e => e.type === 'user/message' && e.data.source?.kind === 'project-workbench')
      const turnEnds = evs => evs.filter(e => e.type === 'turn/end')
      const turnStarts = evs => evs.filter(e => e.type === 'turn/start')
      const waitTurnEnd = async (sid, afterCount, timeoutMs) => {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const ends = turnEnds(eventsOf(sid))
          if (ends.length > afterCount) return ends[ends.length - 1]
          await sleep(2000)
        }
        return null
      }
      const prompt = async (sid, text) => {
        const requestId = randomUUID()
        await ctx.sessionController.prompt({ requestId, sessionId: sid, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
        return requestId
      }
      const noteCalls = evs => normalizeToolCalls(evs, 'x').filter(r => r.name === 'workbench_task_note')

      // ---- setup ----
      const demo = await api.ensureDemoData(root)
      const [taskA, taskB] = demo.issues
      await phase('setup', { root, demo })

      // ---- V-1: view (no prompt) → start (one prompt) → duplicate start ----
      const view = await api.locate(root, taskA.id)
      const promptsAfterView = rpcPrompts(eventsOf(view.sessionId)).length
      if (plan.quick) {
        await phase('v1', { view, promptsAfterView, quick: true })
      } else {
        const start1 = await api.runStart(root, taskA.id)
        const start2 = await api.runStart(root, taskA.id)
        const ev1 = eventsOf(view.sessionId)
        await phase('v1', {
          view, promptsAfterView, start1, start2,
          promptCount: rpcPrompts(ev1).length,
          requestIds: rpcPrompts(ev1).map(e => e.data.source.rpcId),
        })

        // ---- V-2: normal completion (real AI turn) ----
        const endsBefore2 = turnEnds(ev1).length
        const end2 = await waitTurnEnd(view.sessionId, endsBefore2, plan.turnTimeoutMs ?? 300000)
        await sleep(2000) // turn/end sync settles
        const ev2 = eventsOf(view.sessionId)
        const state2 = await api.routes['demo/state']({ root, sessionId: view.sessionId })
        await phase('v2-normal', {
          turnEnd: end2?.data ?? 'TIMEOUT',
          steerCount: steers(ev2).length,
          notes: noteCalls(ev2).map(r => ({ seq: r.seq, isError: r.isError, text: r.resultText?.slice(0, 60) })),
          state: state2,
        })

        // ---- V-2: stop mid-activity, records survive, no auto-resume ----
        const startB = await api.runStart(root, taskB.id)
        const sidB = startB.sessionId
        let activitySeen = false
        const deadline3 = Date.now() + 180000
        const stB = await api.routes['demo/state']({ root, issueId: taskB.id })
        while (Date.now() < deadline3 && !activitySeen) {
          const recs = normalizeToolCalls(eventsOf(sidB).filter(e => e.seq >= stB.link.startSeq), sidB)
          activitySeen = recs.some(r => ['write', 'edit', 'bash'].includes(r.name))
          if (!activitySeen) await sleep(1500)
        }
        const endsBeforeStop = turnEnds(eventsOf(sidB)).length
        const startsBeforeStop = turnStarts(eventsOf(sidB)).length
        const stopRes = await ctx.sessionController.cancel({ sessionId: sidB })
        const endB = await waitTurnEnd(sidB, endsBeforeStop, 60000)
        await sleep(5000) // watch for any auto-resume
        const evB = eventsOf(sidB)
        const stateB = await api.routes['demo/state']({ root, sessionId: sidB })
        await phase('v2-stop', {
          activitySeen, stopRes, turnEnd: endB?.data ?? 'TIMEOUT',
          newTurnStartsAfterStop: turnStarts(evB).length - startsBeforeStop,
          steerCount: steers(evB).length,
          state: stateB,
        })

        // ---- V-2: unrecorded (controlled note failure, activity guaranteed) ----
        await writeFile(FAIL_NOTE_FLAG, '1')
        const endsBefore4 = turnEnds(eventsOf(view.sessionId)).length
        await prompt(view.sessionId, '请在 demo.mjs 顶部添加一行注释 "// stage-1 probe"，然后运行 node --test demo.test.mjs，并调用 workbench_task_note 记录进展。不要提问。')
        const end4 = await waitTurnEnd(view.sessionId, endsBefore4, plan.turnTimeoutMs ?? 300000)
        await rm(FAIL_NOTE_FLAG, { force: true })
        await sleep(2000)
        const ev4 = eventsOf(view.sessionId)
        const state4 = await api.routes['demo/state']({ root, sessionId: view.sessionId })
        await phase('v2-unrecorded', {
          turnEnd: end4?.data ?? 'TIMEOUT',
          steerCountSinceStart: steers(ev4).length,
          notes: noteCalls(ev4).map(r => ({ seq: r.seq, isError: r.isError, text: r.resultText?.slice(0, 80) })),
          state: state4,
        })
      }

      // ---- V-4/V-5: real apply_patch samples on the demo session ----
      const guarded = async (name, fn) => { try { await fn() } catch (e) { await phase(name, { error: String(e?.message ?? e), stack: String(e?.stack ?? '').slice(0, 800) }) } }
      await guarded('v5-patch', async () => {
        await api.routes['demo/patch-tool']({ sessionId: view.sessionId })
        const pd = join(root, 'patch-demo')
        await mkdir(join(pd, 'ro'), { recursive: true })
        await writeFile(join(pd, 'ok.txt'), 'hello\n')
        await writeFile(join(pd, 'ro', 'src.txt'), 'move me\n')
        await chmod(join(pd, 'ro'), 0o555) // source removal will fail AFTER destination write
        const endsBefore5 = turnEnds(eventsOf(view.sessionId)).length
        const seqBefore5 = eventsOf(view.sessionId).length ? eventsOf(view.sessionId)[eventsOf(view.sessionId).length - 1].seq + 1 : 0
        await prompt(view.sessionId, '请依次调用 apply_patch 工具三次（每次一个调用，不要合并，不要使用其他工具）：\n' +
          '第1次 input: "*** Begin Patch\\n*** Add File: patch-demo/added.txt\\n+added\\n*** Update File: patch-demo/ok.txt\\n@@\\n-hello\\n+hi\\n*** End Patch"\n' +
          '第2次 input: "*** Begin Patch\\n*** Update File: patch-demo/ok.txt\\n@@\\n-hi\\n+hi2\\n*** Update File: patch-demo/no-such-file.txt\\n@@\\n-nope\\n+x\\n*** End Patch"\n' +
          '第3次 input: "*** Begin Patch\\n*** Update File: patch-demo/ro/src.txt\\n*** Move to: patch-demo/moved.txt\\n@@\\n-move me\\n+moved\\n*** End Patch"\n' +
          '每次调用后报告结果文本。')
        const end5 = await waitTurnEnd(view.sessionId, endsBefore5, plan.turnTimeoutMs ?? 300000)
        await sleep(2000)
        const ev5 = eventsOf(view.sessionId).filter(e => e.seq >= seqBefore5)
        const patchEvents = ev5.filter(e =>
          (e.type === 'tool/call' && e.data.name === 'apply_patch') ||
          (e.type === 'tool/result' && ev5.some(c => c.type === 'tool/call' && c.data.name === 'apply_patch' && c.data.callId === e.data.message?.toolCallId)))
        if (plan.fixtureDir) await writeFile(join(plan.fixtureDir, 'patch.jsonl'), patchEvents.map(e => JSON.stringify(e)).join('\n') + '\n')
        const patchRecs = normalizeToolCalls(patchEvents, view.sessionId)
        await chmod(join(pd, 'ro'), 0o755)
        const state5 = await api.routes['demo/state']({ root, sessionId: view.sessionId })
        await phase('v5-patch', {
          turnEnd: end5?.data ?? 'TIMEOUT',
          patches: patchRecs.map(r => ({ seq: r.seq, isError: r.isError, text: r.resultText?.slice(0, 300), meta: r.meta })),
          facts: extractFacts(patchRecs, { root }),
          state: state5,
        })
      })

      // ---- V-4: PTC inner dispatch through the same guard ----
      await guarded('v4-ptc', async () => {
        const ptcCreated = await ctx.sessionController.create({ cwd: root, agentPreset: 'ptc' })
        const ptcSid = ptcCreated.sessionId
        const endsBefore6 = turnEnds(eventsOf(ptcSid)).length
        await prompt(ptcSid, '请用 run_code 写一段程序：先调用 tools.write({file_path: ".project/project.md", content: "ptc probe"})，再调用 tools.bash({command: "echo ptc-ok"})。把两次调用的返回结果原样报告（包括错误文本）。不要使用其他工具。')
        const end6 = await waitTurnEnd(ptcSid, endsBefore6, plan.turnTimeoutMs ?? 300000)
        await sleep(1000)
        const ev6 = eventsOf(ptcSid)
        const ptcEvents = ev6.filter(e => ['tool/call', 'tool/result', 'tool/ptc-dispatch-start', 'tool/ptc-dispatch', 'turn/start', 'turn/end'].includes(e.type))
        if (plan.fixtureDir) await writeFile(join(plan.fixtureDir, 'ptc-guard.jsonl'), ptcEvents.map(e => JSON.stringify(e)).join('\n') + '\n')
        const ptcRecs = normalizeToolCalls(ptcEvents, ptcSid)
        await phase('v4-ptc', {
          sessionId: ptcSid, preset: 'ptc', turnEnd: end6?.data ?? 'TIMEOUT',
          inner: ptcRecs.filter(r => r.mode === 'ptc').map(r => ({ name: r.name, seq: r.seq, isError: r.isError, text: r.resultText?.slice(0, 200) })),
        })
      })

      // ---- V-1: second workspace ownership ----
      await guarded('v1-workspace-b', async () => {
        if (!plan.rootB) return
        await mkdir(plan.rootB, { recursive: true })
        let wsB = ctx.workspaceRegistry.list().find(w => w.path === plan.rootB)
        if (!wsB) wsB = await ctx.workspaceRegistry.create(plan.rootB, '工作台验收-B')
        const demoB = await api.ensureDemoData(plan.rootB)
        const locB = await api.locate(plan.rootB, demoB.issues[0].id)
        await phase('v1-workspace-b', { workspaceId: wsB?.id, demoB, locB, distinctSession: locB.sessionId !== view.sessionId })
      })

      // ---- 返工复验: live concurrent start (exactly one prompt) ----
      await guarded('rework-concurrent', async () => {
        if (!plan.concurrent) return
        const issueId = plan.concurrentIssueId ?? taskB.id
        const [a, b] = await Promise.all([api.runStart(root, issueId), api.runStart(root, issueId)])
        const sid = a.sessionId ?? b.sessionId
        const ends = turnEnds(eventsOf(sid)).length
        const end = await waitTurnEnd(sid, ends, plan.turnTimeoutMs ?? 300000)
        await sleep(1500)
        const evs = eventsOf(sid)
        const st = await api.routes['demo/state']({ root, issueId })
        const rpc = evs.filter(e => e.type === 'user/message' && e.data.source?.rpcId && e.seq >= (st.link?.startSeq ?? 0))
        await phase('rework-concurrent', { a, b, turnEnd: end?.data ?? 'TIMEOUT', rpcPromptCountThisRun: rpc.filter(e => e.data.source.rpcId === (a.runId ?? b.runId)).length, rpcIdsSinceLink: rpc.map(e => e.data.source.rpcId) })
      })

      // ---- 返工复验: live error turn (activity first, then model failure) ----
      await guarded('rework-error-turn', async () => {
        if (!plan.errorTurn) return
        const view2 = await api.locate(root, taskA.id)
        const sid = view2.sessionId
        const agent = ctx.agents.get(sid)
        if (!agent) throw new Error('demo agent not live')
        const originalModel = agent.model.current()
        const endsBefore = turnEnds(eventsOf(sid)).length
        const requestId = randomUUID()
        await ctx.sessionController.prompt({ requestId, sessionId: sid, mode: 'queue', content: [{ type: 'text', text: '请用 bash 工具运行命令 echo error-turn-probe，然后调用 workbench_task_note 记录一句话。不要提问。' }] }, new AbortController().signal)
        // Wait for real activity, then break the model route so the NEXT step fails.
        const deadline = Date.now() + 120000
        let sawActivity = false
        while (Date.now() < deadline && !sawActivity) {
          const link = await readJson(join(root, '.project', '.local', 'links', `${sid}.json`))
          const recs = normalizeToolCalls(eventsOf(sid).filter(e => e.seq >= (link?.startSeq ?? 0)), sid)
          sawActivity = recs.some(r => r.name === 'bash' && r.settled)
          if (!sawActivity) await sleep(1000)
        }
        agent.model.select({ provider: originalModel?.provider ?? 'deepseek', model: 'pw-nonexistent-model-for-error-test' })
        const end = await waitTurnEnd(sid, endsBefore, plan.turnTimeoutMs ?? 300000)
        // Restore the recorded model choice.
        if (originalModel) agent.model.select(originalModel)
        await sleep(5000) // watch for auto-resume
        const evs = eventsOf(sid)
        const after = evs.filter(e => e.seq > (end?.seq ?? Number.MAX_SAFE_INTEGER))
        const state = await api.routes['demo/state']({ root, sessionId: sid })
        await phase('rework-error-turn', {
          sawActivity, turnEnd: end?.data ?? 'TIMEOUT',
          newTurnStartsAfterError: after.filter(e => e.type === 'turn/start').length,
          steersAfterError: after.filter(e => e.type === 'user/message' && e.data.source?.kind === 'project-workbench').length,
          state,
        })
      })

      report.finishedAt = new Date().toISOString()
      await save()
    } catch (e) {
      report.error = { message: e?.message ?? String(e), stack: String(e?.stack ?? '').slice(0, 2000) }
      await save().catch(() => {})
    }
  })()
}

// Focused patch-sample probe: partial commit (hunk mismatch) on the demo session,
// plus a failed move on an APFS temp root (exFAT ignores chmod, so the source
// removal cannot fail on the demo volume). Flag: /tmp/pw-stage1-patch-probe.json.
export function maybeRunPatchProbe(ctx, api) {
  void (async () => {
    let plan
    try { plan = JSON.parse(await readFile('/tmp/pw-stage1-patch-probe.json', 'utf8')) } catch { return }
    await rm('/tmp/pw-stage1-patch-probe.json', { force: true })
    const report = { startedAt: new Date().toISOString(), phases: {} }
    const save = () => writeFile(plan.report, JSON.stringify(report, null, 2))
    const phase = async (name, data) => { report.phases[name] = { at: new Date().toISOString(), ...data }; await save() }
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const eventsOf = sid => ctx.sessions.get(sid)?.snapshotEvents() ?? []
    const turnEnds = evs => evs.filter(e => e.type === 'turn/end')
    const waitTurnEnd = async (sid, afterCount, timeoutMs) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const ends = turnEnds(eventsOf(sid))
        if (ends.length > afterCount) return ends[ends.length - 1]
        await sleep(2000)
      }
      return null
    }
    const prompt = async (sid, text) => {
      const requestId = randomUUID()
      await ctx.sessionController.prompt({ requestId, sessionId: sid, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
    }
    const patchEventsOf = sid => {
      const evs = eventsOf(sid)
      return evs.filter(e =>
        (e.type === 'tool/call' && e.data.name === 'apply_patch') ||
        (e.type === 'tool/result' && evs.some(c => c.type === 'tool/call' && c.data.name === 'apply_patch' && c.data.callId === e.data.message?.toolCallId)))
    }
    const collected = []
    try {
      // Both samples run on an APFS temp root: exFAT (the demo volume) ignores
      // chmod, so permission-based commit failures cannot be produced there.
      const apfsRoot = plan.apfsRoot ?? '/tmp/pw-patch-apfs'
      await rm(join(apfsRoot, 'moved.txt'), { force: true }) // re-runnable samples
      await mkdir(join(apfsRoot, 'ro'), { recursive: true })
      await writeFile(join(apfsRoot, 'ok.txt'), 'hello\n')
      await writeFile(join(apfsRoot, 'ro', 'locked.txt'), 'locked\n')
      await writeFile(join(apfsRoot, 'ro', 'src.txt'), 'move me\n')
      await chmod(join(apfsRoot, 'ro'), 0o555)
      const created = await ctx.sessionController.create({ cwd: apfsRoot })
      const sid = created.sessionId
      await api.routes['demo/patch-tool']({ sessionId: sid })

      // 1) Partial commit: op1 writes ok.txt; op2 targets the read-only dir and
      // fails at commit (preflight only reads, so it passes).
      const ends1 = turnEnds(eventsOf(sid)).length
      await prompt(sid, '请调用 apply_patch 一次（不要使用其他工具），input 为：\n"*** Begin Patch\\n*** Update File: ok.txt\\n@@\\n-hello\\n+hi\\n*** Update File: ro/locked.txt\\n@@\\n-locked\\n+changed\\n*** End Patch"\n报告结果文本。')
      const end1 = await waitTurnEnd(sid, ends1, plan.turnTimeoutMs ?? 240000)
      await sleep(1500)
      const evAfter1 = patchEventsOf(sid)
      collected.push(...evAfter1)
      const partialRecs = normalizeToolCalls(evAfter1, sid)
      await phase('partial', { turnEnd: end1?.data ?? 'TIMEOUT', patches: partialRecs.map(r => ({ seq: r.seq, isError: r.isError, text: r.resultText, meta: r.meta })), facts: extractFacts(partialRecs, { root: apfsRoot }) })

      // 2) Failed move: destination written, source removal denied (EACCES).
      const ends2 = turnEnds(eventsOf(sid)).length
      await prompt(sid, '请调用 apply_patch 一次（不要使用其他工具），input 为：\n"*** Begin Patch\\n*** Update File: ro/src.txt\\n*** Move to: moved.txt\\n@@\\n-move me\\n+moved\\n*** End Patch"\n报告结果文本。')
      const end2 = await waitTurnEnd(sid, ends2, plan.turnTimeoutMs ?? 240000)
      await sleep(1500)
      const moveEvents = patchEventsOf(sid).filter(e => !evAfter1.some(p => p.seq === e.seq))
      collected.push(...moveEvents)
      await chmod(join(apfsRoot, 'ro'), 0o755)
      const recs = normalizeToolCalls(moveEvents, sid)
      await phase('failed-move', {
        sessionId: sid, turnEnd: end2?.data ?? 'TIMEOUT',
        patches: recs.map(r => ({ seq: r.seq, isError: r.isError, text: r.resultText, meta: r.meta })),
        facts: extractFacts(recs, { root: apfsRoot }),
      })
      if (plan.fixtureDir) await writeFile(join(plan.fixtureDir, 'patch-extra.jsonl'), collected.map(e => JSON.stringify(e)).join('\n') + '\n')
      report.finishedAt = new Date().toISOString()
      await save()
    } catch (e) {
      report.error = { message: e?.message ?? String(e), stack: String(e?.stack ?? '').slice(0, 2000) }
      await save().catch(() => {})
    }
  })()
}
