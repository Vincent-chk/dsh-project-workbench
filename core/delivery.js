import { taskResult } from '../client-src/workbench-content.js'
// Stage-3 §3.6: after a task passes acceptance, re-check the requirement's
// submission conditions; when they hold, a read-only child drafts the delivery
// summary and the Host re-checks and submits through the shared store entry.
// No new delivery entity or run queue: one in-flight job per requirement, the
// last outcome persisted under .local/delivery/ for the UI and manual fallback.
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as store from './store.js'
import { canDeliverTasks, freshDelivery, requirementOverview } from './state.js'
import { projectSession, startReadOnlyChild, parseJsonOutput } from './spawn.js'
import { WorkbenchError } from './files.js'

const blank = v => v === undefined || v === null || String(v).trim() === ''
const textOf = result => result.output.filter(b => b.type === 'text').map(b => b.text).join('\n')

// PRD §9.5: all tasks accepted and at least one task with a result AND
// evidence belonging to THIS requirement delivery round.
export function taskConditions(req) {
  const issues = req.issues ?? []
  if (req.status !== 'in_progress' || req.pendingReopen) return false
  return canDeliverTasks(issues, req.deliveryStartedAt).ok
}

function summaryPrompt(req) {
  const payload = {
    requirement: { title: req.title, overview: requirementOverview(req), goal: req.goal, scope: req.scope, acceptance: req.acceptance || req.q_success },
    // Include each task's completion criteria and concrete verification evidence
    // so the summary is grounded in facts, not just titles (§3.6).
    tasks: (req.issues ?? []).map(i => {
      const since = Math.max(Number(req.deliveryStartedAt) || 0, Number(i.deliveryStartedAt) || 0)
      const records = String(i.objective ?? '').split(/\r?\n(?=- (?:改动文件|执行命令|待核实)：)/)
      // Match the store's objective-record timestamp format and round boundary.
      // Undated legacy records are usable only when the store retained their
      // valid timestamp and there are no dated records to distinguish rounds.
      const dated = records.map(record => {
        const stamp = record.match(/，(\d{4}-\d{2}-\d{2}T[^）]+)）/)?.[1]
        return { record, time: stamp ? Date.parse(stamp) || 0 : 0 }
      })
      const objective = !since || (!dated.some(item => item.time) && i.hasObjective && i.objectiveAt >= since)
        ? String(i.objective ?? '') : dated.filter(item => item.time > since).map(item => item.record).join('\n')
      const currentResult = i.status === 'done' && freshDelivery(i, since)
      const result = taskResult(i, since)
      const currentLimits = Number(i.knownLimitsAt) > 0 && Number(i.knownLimitsAt) >= since
      return {
        title: i.title, status: i.status, acceptance: i.acceptance,
        currentResult,
        deliveryStartedAt: i.deliveryStartedAt,
        resultSummary: currentResult ? result.summary : '', unverifiedResultContext: result.unverifiedResultContext, evidence: !since || Number(i.evidenceAt) >= since ? i.evidence : '', objective,
        // scanProject scopes checks to the later requirement/task round.
        verification: i.verification,
        limitsRecorded: currentLimits,
        knownLimits: currentLimits ? i.knownLimits : '',
        unverifiedKnownLimits: !currentLimits ? i.knownLimits : '', activity: i.activity,
      }
    }),
  }
  return '整理项目工作台本轮交付。只读，不写文件和执行命令。按下方的需求与任务事实写简体中文，让不懂技术的人能判断是否可以验收。' +
    'summary 首段用一到两句话说清本轮有什么变化和重要限制。空一行后逐条对照完成标准，写清结果、验证到什么程度、失败或未验证的部分及其影响，保留全部必要条件和例外。' +
    '用日常语言描述用户能看到的行为和结果。需保留的专业名称用一句话说明用途。命令、变量名、文件路径和会话编号留在原始验证记录中，摘要里写这些记录实际验证了什么。' +
    'currentResult 为 false 时没有本轮结果摘要；objective 和 verification 已按本轮筛选，其中的失败或未完成检查仍是本轮事实，必须如实保留。objective 中“输出：”是真实命令输出的有界摘录；只有实际输入和对应输出都在记录中时，才能声称该场景已实测，不能由 trim 等实现方式推断输出也被 trim。摘录未覆盖的场景写未核对，不得补造。activity 和 unverifiedResultContext 是历史或轮次未知内容，不能作为本轮验证依据；unverifiedKnownLimits 是未核实的历史限制，不能断言它仍存在或已消除。limitsRecorded 为 false 时只能写“本轮未记录限制”，不得声称没有遗留限制或所有事项均已核实；按验证记录说明未覆盖范围，无法确定时写未核实。以本轮验证事实为准，失败、未完成或没有依据的检查如实写出，查看目录和改动文件本身不能证明验证通过。缺少答案时说明还没核对，不猜测。' +
    '仅输出一个标为 json 的代码块，格式为 {"summary":"交付摘要"}。\n' +
    '```json\n' + JSON.stringify(payload) + '\n```'
}

export function installDelivery(ctx, { readOnlyChildren }) {
  const jobs = new Map() // same requirement identity as the store's write lock
  const jobFile = (root, reqId) => join(root, '.project', '.local', 'delivery', `${reqId}.json`)
  const record = async (root, reqId, job) => {
    try {
      await mkdir(join(root, '.project', '.local', 'delivery'), { recursive: true })
      await writeFile(jobFile(root, reqId), JSON.stringify(job, null, 2))
    } catch { /* best effort: runtime metadata only */ }
  }
  const settle = (root, reqId, job, status, error) => {
    job.status = status
    if (error) job.error = error
    job.endedAt = new Date().toISOString()
    void record(root, reqId, job)
    // A terminal event that arrived while this summary was in flight must not be
    // lost: re-run the check so the NEW delivery gets its own summary (§3.6).
    if (job.retrigger) { job.retrigger = false; void maybeSubmit(root, reqId) }
  }

  async function maybeSubmit(root, reqId) {
    const key = await store.requirementKey(root, reqId)
    // Claim the job before scanning or starting a child, including across path aliases.
    const existing = jobs.get(key)
    if (existing?.status === 'running') { existing.retrigger = true; return }
    const job = { status: 'running', at: new Date().toISOString() }
    jobs.set(key, job)
    try {
      const idx = await store.scanProject(root)
      const req = idx.requirements.find(r => r.id === reqId)
      if (!req || !taskConditions(req)) {
        jobs.delete(key)
        // A terminal event may have arrived during the scan of the previous state.
        if (job.retrigger) void maybeSubmit(root, reqId)
        return
      }
      // The summary corresponds to THIS delivery (round start + task results); a
      // task reopen/re-complete mid-flight changes the fingerprint (§3.6).
      const expectFingerprint = store.deliveryFingerprint(req)
      const session = await projectSession(ctx, root)
      if (!session.ok) { settle(root, reqId, job, 'failed', session.message); return }
      const started = await startReadOnlyChild(ctx, readOnlyChildren, session.sessionId, root, 'Project workbench delivery summary', 'workbench-delivery', summaryPrompt(req))
      if (!started.ok) { settle(root, reqId, job, 'failed', started.message); return }
      job.childId = started.data.childId
      started.data.result.then(async result => {
        if (result.stopReason !== 'completed') { settle(root, reqId, job, 'failed', result.diagnostic ?? `child ended: ${result.stopReason}`); return }
        const { doc, parseError } = parseJsonOutput(textOf(result))
        if (typeof doc?.summary !== 'string' || !doc.summary.trim()) { settle(root, reqId, job, 'failed', parseError ?? '交付摘要为空或格式不正确'); return }
        // Re-check AFTER the model returns: a reopen/cancel during drafting wins.
        const fresh = await store.scanProject(root)
        const nowReq = fresh.requirements.find(r => r.id === reqId)
        if (!nowReq || !taskConditions(nowReq) || store.deliveryFingerprint(nowReq) !== expectFingerprint) {
          settle(root, reqId, job, 'skipped', '任务状态或交付内容已变化，未提交验收'); return
        }
        try {
          // The fingerprint is re-checked inside the shared requirement lock.
          await store.submitRequirement(root, reqId, { summary: doc.summary.trim(), actor: 'system', expectFingerprint })
          settle(root, reqId, job, 'done')
        } catch (e) {
          if (e instanceof WorkbenchError && e.code === 'ROUND_CHANGED') settle(root, reqId, job, 'skipped', '交付内容已变化，未提交验收')
          else settle(root, reqId, job, 'failed', e instanceof Error ? e.message : String(e))
        }
      }).catch(e => settle(root, reqId, job, 'failed', e instanceof Error ? e.message : String(e)))
    } catch (e) { settle(root, reqId, job, 'failed', e instanceof Error ? e.message : String(e)) }
  }

  const routes = {
    'delivery/status': async i => {
      if (typeof i.root !== 'string' || !i.root.startsWith('/') || i.root.includes('\0')) throw new WorkbenchError('INVALID_ROOT', 'root must be an absolute path')
      const key = await store.requirementKey(i.root, i.reqId)
      let last = null
      try { last = JSON.parse(await readFile(jobFile(i.root, i.reqId), 'utf8')) } catch { /* no previous job */ }
      return { job: jobs.get(key) ?? last }
    },
  }
  return { maybeSubmit, routes }
}
