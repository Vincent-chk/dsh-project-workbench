// Stage-3 formal AI tools (tech §5.2) and the current-task dynamic context
// (§5.3). Tools resolve the task from exec.agent's session link — the model
// never names another task. Human-only actions (confirm/cancel/reopen/review/
// accept) are intentionally absent; writes share the stage-2 store guards.
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as store from './store.js'
import { taskReworkReason, taskResult } from '../client-src/workbench-content.js'
import { parseFrontmatter } from './frontmatter.js'
import { WorkbenchError, atomicWrite } from './files.js'
import { normalizeToolCalls, extractFacts, isEvidenceCommand } from './extract.js'
import { taskTurns } from './sync.js'
import { submitProposals } from './proposals.js'
import { TERMINAL_ISSUE, requirementOverview, startBlockers, taskOverview } from './state.js'

// Retained for the stage-1 prototype test fixture; formal tools do not use it.
export const ACCEPTANCE_FLAG = '/tmp/pw-acceptance-mode'
export const acceptanceMode = root => {
  let content
  try { content = readFileSync(ACCEPTANCE_FLAG, 'utf8') } catch { return false }
  const lines = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  if (lines.includes('*')) return true
  return root != null && lines.includes(root)
}

const STATUS_TEXT = { todo: '待处理', doing: '处理中', blocked: '阻塞', in_review: '待验收', done: '已完成', cancelled: '已取消' }
const REQ_STATUS_TEXT = { backlog: '需求池', reviewing: '评审中', ready: '待开发', in_progress: '开发中', pending: '待验收', completed: '已完成' }
const UPDATE_FIELDS = { rootCause: '根因', resultSummary: '处理结果摘要', knownLimits: '已知限制' }
const DRAFT_FIELDS = { problemOverview: '任务概述', triggerPath: '操作步骤或使用场景', acceptance: '完成标准' }
const REQ_ID_RE = /^req-\d{8}-[0-9a-f]{6}$/
const ISS_ID_RE = /^iss-\d{8}-[0-9a-f]{6}$/

async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }

// AI fact updates never delete human content: append after it (the root-cause
// placeholder "待分析" may be replaced). Conflicts are surfaced, not merged away.
function preservedUpdate(field, current, text) {
  const cur = String(current ?? '').trim()
  const placeholder = field === 'rootCause' && cur === '待分析'
  if (!cur || placeholder) return { value: String(text), kept: false }
  return { value: `${current}\n\n[AI 补充] ${text}`, kept: true }
}

export function installTools(ctx, links) {
  const { linkFile, issueOf, syncSession, serialized } = links
  const cwdOf = agent => agent?.session?.header?.cwd

  async function linked(exec) {
    const root = cwdOf(exec.agent)
    const link = root ? await readJson(linkFile(root, exec.agent.session.id)) : null
    return { root, link }
  }
  // Shared write gate: linked + requirement in development + task not terminal.
  async function writable(exec) {
    const { root, link } = await linked(exec)
    if (!link) throw new WorkbenchError('NO_LINK', '当前会话未关联任务')
    const { req, issue } = await issueOf(root, link.issueId)
    if (req.status !== 'in_progress') throw new WorkbenchError('REQ_NOT_ACTIVE', '所属需求不是开发中，拒绝写入')
    if (req.pendingReopen) throw new WorkbenchError('REOPEN_PENDING', '请先完成需求的返工操作。')
    if (TERMINAL_ISSUE.has(issue.status)) throw new WorkbenchError('TERMINAL_READ_ONLY', '任务已结束，只读；重新打开需用户在界面操作')
    return { root, link, req, issue }
  }
  const draftEvidence = exec => [`draft://session/${exec.agent.session.id}`] // source marker, never fabricated execution evidence
  const propose = async (exec, { issue = true, ...proposal }) => {
    const { root, link, issue: iss } = await writable(exec)
    const target = { reqId: link.reqId, ...(issue ? { issueId: link.issueId } : {}) }
    // A field draft records the task fingerprint at draft time so adopting it
    // after a human edit conflicts instead of overwriting human content (§3.5).
    const baseHash = proposal.kind === 'field_draft' ? iss.hash : undefined
    const res = await submitProposals(root, [{ evidence: draftEvidence(exec), reason: 'AI 建议，待用户采用', ...proposal, target, ...(baseHash ? { baseHash } : {}) }])
    return res.data.saved.length ? '已写入待采用建议，用户在界面采用后才生效' : '相同建议已在待采用列表'
  }

  const notSubagent = ({ agent }) => agent?.session?.header?.origin !== 'subagent' && !links.reviewLink?.(agent)
  const tool = (name, description, properties, required, execute) => ctx.tools.register({
    name, description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    // No linked task is a plain explanation, not an error (tech §5.2).
    execute: async (args, exec) => {
      try { return await execute(args, exec) } catch (e) {
        if (e instanceof WorkbenchError && e.code === 'NO_LINK') return '当前会话未关联任务'
        throw e
      }
    },
  }, { when: notSubagent })

  ctx.effect(() => {
    const disposers = [
      tool('workbench_task_get', '读取关联任务的概述、完成标准、本轮修改意见、状态、结果与最近进展。未核实的历史限制不能作为本轮事实。', {}, [], async (_args, exec) => {
        const { root, link } = await linked(exec)
        if (!link) return '当前会话未关联任务'
        const { req, issue } = await issueOf(root, link.issueId)
        const since = Math.max(Number(req.deliveryStartedAt) || 0, Number(issue.deliveryStartedAt) || 0)
        const currentLimits = issue.knownLimitsAt > 0 && issue.knownLimitsAt >= since
        const result = taskResult(issue, since)
        const reworkReason = taskReworkReason(issue)
        return JSON.stringify({
          title: issue.title, status: STATUS_TEXT[issue.status] ?? issue.status,
          requirement: req.title, reqStatus: REQ_STATUS_TEXT[req.status] ?? req.status,
          problemOverview: taskOverview(issue), triggerPath: issue.triggerPath, rootCause: issue.rootCause, acceptance: issue.acceptance,
          ...(issue.description?.trim() && issue.description.trim() !== taskOverview(issue) ? { description: issue.description } : {}),
          ...(reworkReason ? { reworkReason } : {}),
          resultSummary: result.recordedSummary,
          unverifiedResultContext: result.unverifiedResultContext,
          ...(result.unverifiedResultContext ? { unverifiedResultContextNote: '此前结果或轮次未知的文字，不能作为本轮结果。' } : {}),
          knownLimits: currentLimits ? issue.knownLimits : '',
          unverifiedKnownLimits: !currentLimits ? issue.knownLimits : '',
          ...(!currentLimits && issue.knownLimits ? { unverifiedKnownLimitsNote: '旧轮或时间未知的限制，本轮尚未核实，不能断言仍存在或已解除。' } : {}),
          recent: issue.activity.slice(0, 3),
          unrecordedTurns: link.unrecordedTurns ?? [],
        })
      }),
      tool('workbench_task_update', '补充当前任务的根因、处理结果摘要或已知限制；保留人工已写内容，不修改问题概述/触发路径/完成标准。', {
        field: { type: 'string', enum: Object.keys(UPDATE_FIELDS), description: 'rootCause=根因 resultSummary=处理结果摘要 knownLimits=已知限制' },
        text: { type: 'string', description: '写有依据的新信息，用日常中文说清用户能看到的变化与影响。结果摘要以三句内为目标。限制说明哪里还做不了及下一步。必要的专业名称说明用途。保留未验证事项及例外。' },
      }, ['field', 'text'], async (args, exec) => {
        if (!UPDATE_FIELDS[args.field]) throw new WorkbenchError('INVALID_FIELD', 'field 只能是 rootCause/resultSummary/knownLimits')
        const { root, link, req, issue } = await writable(exec)
        const since = Math.max(Number(req.deliveryStartedAt) || 0, Number(issue.deliveryStartedAt) || 0)
        const current = args.field === 'resultSummary' ? taskResult(issue, since).recordedSummary :
          args.field === 'knownLimits' && !(issue.knownLimitsAt > 0 && issue.knownLimitsAt >= since) ? '' : issue[args.field]
        const { value, kept } = preservedUpdate(args.field, current, args.text)
        await store.updateIssue(root, link.reqId, link.issueId, { [args.field]: value }, { actor: 'ai', fileHash: issue.hash })
        return kept ? '已追加并保留原有内容；如与人工结论冲突，请人工核对' : '已记录'
      }),
      tool('workbench_task_draft', '为问题概述/触发路径/完成标准起草建议，写入待采用列表；用户采用后才保存，不直接修改任务。', {
        field: { type: 'string', enum: Object.keys(DRAFT_FIELDS) },
        text: { type: 'string', description: '用日常中文。问题概述用一到两句话写现象和影响。触发路径按顺序写实际操作，新功能写使用入口与场景。完成标准每条写一个可核对的结果，保留原条件和例外。缺少依据时保留该项，告诉用户需补充什么。' },
      }, ['field', 'text'], async (args, exec) => {
        if (!DRAFT_FIELDS[args.field]) throw new WorkbenchError('INVALID_FIELD', 'field 只能是 problemOverview/triggerPath/acceptance')
        return propose(exec, { kind: 'field_draft', suggested_patch: { [args.field]: args.text } })
      }),
      tool('workbench_task_note', '记录当前任务有事实依据的进展。可用 forTurn 补记旧回合。', {
        text: { type: 'string', description: '首行用一句日常中文概括进展。后续行按需补充处理的问题、结果、验证和缺口。补记只在明确知道时写实际处理时间。有已核对的 Wiki 资料时可另写一行“资料来源：wiki:页面路径”。命令输出留在验证记录。' },
        forTurn: { type: 'integer', description: '可选：补记的目标回合号（清除该回合漏记提示）' },
      }, ['text'], async (args, exec) => {
        const { root, link } = await writable(exec)
        const text = String(args.text ?? '').trim()
        if (!text) throw new WorkbenchError('EMPTY_UPDATE', 'progress summary is required')
        await store.addIssueUpdate(root, link.reqId, link.issueId, `[AI] ${text}`)
        // An explicit supplement closes the targeted turn's unrecorded hint (§3.4).
        if (Number.isInteger(args.forTurn)) {
          const sid = exec.agent.session.id
          await serialized(sid, async () => {
            const cur = await readJson(linkFile(root, sid))
            if (cur) await atomicWrite(linkFile(root, sid), JSON.stringify({ ...cur, supplementedTurns: [...new Set([...(cur.supplementedTurns ?? []), args.forTurn])] }, null, 2))
          })
        }
        return '已记录'
      }),
      tool('workbench_task_start', '记录任务实际开始或阻塞解除后的恢复；需本会话已有属于该任务的实际执行事实，不发起新的处理请求。', {}, [], async (_args, exec) => {
        const { root, link, issue } = await writable(exec)
        if (issue.status === 'doing') return '任务已在处理中'
        if (!['todo', 'blocked'].includes(issue.status)) throw new WorkbenchError('INVALID_STATE', `任务当前为${STATUS_TEXT[issue.status] ?? issue.status}，不能记录开始`)
        const session = ctx.sessions.get(exec.agent.session.id)
        const events = session ? session.snapshotEvents(link.startSeq) : []
        // Only activity attributed to this task counts — ordinary chat (even with
        // an incidental file edit) is not a start fact (PRD §11.2/§11.3).
        const run = await readJson(links.runFile(root, link.issueId))
        const attributed = taskTurns(events, new Set([...(link.runIds ?? []), ...(run?.runId ? [run.runId] : [])]))
        const records = normalizeToolCalls(events, exec.agent.session.id).filter(r => attributed === null || attributed.has(r.turn))
        const facts = extractFacts(records, { root })
        // A failed or background command is activity, but cannot resolve a block.
        const hasActivity = issue.status === 'blocked'
          ? facts.files.some(f => f.status === 'confirmed' && f.time > issue.blockedAt) ||
            facts.commands.some(c => isEvidenceCommand(c) && c.time > issue.blockedAt)
          : facts.hasActivity
        if (!hasActivity) throw new WorkbenchError('NO_ACTIVITY', '本会话没有属于该任务的实际执行依据，不能记录开始或恢复')
        const missing = startBlockers(issue)
        if (missing.length) throw new WorkbenchError('MISSING_START_FIELDS', `fill before starting: ${missing.join(', ')}`)
        await store.recordRunStart(root, link.reqId, link.issueId, { fileHash: issue.hash })
        return '已记录开始处理'
      }),
      tool('workbench_task_block', '记录任务阻塞，必填具体原因；临时等待授权不属于业务阻塞。', {
        reason: { type: 'string', description: '用日常中文说清卡在哪里、什么做不了、接下来需要谁做什么。若下一步还不确定，如实说明。' },
      }, ['reason'], async (args, exec) => {
        const { root, link } = await writable(exec)
        await store.moveIssue(root, link.reqId, link.issueId, 'blocked', { blockedReason: args.reason, reason: args.reason, actor: 'ai' })
        return '已记录阻塞'
      }),
      tool('workbench_task_submit', '整理本次结果并提交任务验收。先同步执行记录，再校验完成标准与本次交付依据。验收决定由用户在界面操作。', {
        summary: { type: 'string', description: '用三句以内的日常中文概括这次能做到什么及已验证的结果。必要的专业名称说明用途。保留重要的条件和例外。变量、命令和文件路径留在验证记录。' },
        limits: { type: 'string', description: '可选。说明实际失败、尚未验证或做不了的部分、对用户的影响及下一步。' },
      }, ['summary'], async (args, exec) => {
        const { root, link } = await writable(exec)
        const sid = exec.agent.session.id
        return serialized(sid, async () => {
          const { issue } = await issueOf(root, link.issueId)
          if (issue.status === 'in_review') return '任务已处于待验收。如需修改，请用户选择继续修改'
          if (issue.status !== 'doing') throw new WorkbenchError('INVALID_STATE', '只有处理中的任务可以提交结果；请先记录开始处理')
          // Sync first: objective evidence must be current before validation.
          const session = ctx.sessions.get(sid)
          if (session) {
            let prevSeq = -1
            for (let i = 0; i < 5 && session.seq !== prevSeq; i++) {
              prevSeq = session.seq
              if ((await syncSession(root, session, link)).complete) break
            }
          }
          // A submit must carry a NEW result; a blank summary must not reuse the
          // previous result after a continue-modify reset (§3.2).
          if (!String(args.summary ?? '').trim()) throw new WorkbenchError('RESULT_EVIDENCE_REQUIRED', '提交需要本次新的结果摘要，不能沿用旧结果')
          const { issue: fresh, req: freshReq } = await issueOf(root, link.issueId)
          const since = Math.max(Number(freshReq.deliveryStartedAt) || 0, Number(fresh.deliveryStartedAt) || 0)
          const summary = preservedUpdate('resultSummary', taskResult(fresh, since).recordedSummary, args.summary).value
          const currentLimits = fresh.knownLimitsAt > 0 && fresh.knownLimitsAt >= since ? fresh.knownLimits : ''
          const limits = (args.limits != null && String(args.limits).trim()) ? preservedUpdate('knownLimits', currentLimits, args.limits).value : undefined
          // Validate acceptance + this delivery's evidence BEFORE writing the
          // summary; a failed check leaves the task untouched (tech §6.4).
          const res = await store.submitIssueResult(root, link.reqId, link.issueId, { summary, limits, actor: 'ai', fileHash: fresh.hash })
          if (res.data.alreadyPending) return '任务已处于待验收。如需修改，请用户选择继续修改'
          return '已提交结果，任务进入待验收。请提示用户在界面验收'
        })
      }),
      tool('workbench_task_propose', '提出完成标准/范围/新任务/取消建议，写入待采用列表；不直接执行关键变更。', {
        kind: { type: 'string', enum: ['acceptance', 'scope', 'new_task', 'cancel'], description: 'acceptance=完成标准 scope=范围 new_task=新任务 cancel=取消' },
        text: { type: 'string', description: '用日常中文写建议。新任务标题一句话写要解决的事，建议 24 字以内。完成标准每条写一个可核对的结果，保留原条件。写清范围或取消对用户的影响。缺少依据时告诉用户需补充什么。' },
        overview: { type: 'string', description: '新任务的概述。说明实际问题或具体工作。有依据时填写。' },
      }, ['kind', 'text'], async (args, exec) => {
        if (!['acceptance', 'scope', 'new_task', 'cancel'].includes(args.kind)) throw new WorkbenchError('INVALID_FIELD', 'kind 只能是 acceptance/scope/new_task/cancel')
        if (args.kind === 'acceptance') return propose(exec, { kind: 'field_draft', suggested_patch: { acceptance: args.text } })
        if (args.kind === 'new_task') {
          const overview = String(args.overview ?? '').trim()
          return propose(exec, { kind: 'new_task', issue: false, suggested_patch: { title: args.text, ...(overview ? { problemOverview: overview } : {}) } })
        }
        return propose(exec, { kind: 'task_suggestion', suggested_patch: { action: args.kind, text: args.text } })
      }),
      tool('workbench_req_get', '读取当前任务所属需求的概述、目标、边界与完成标准。', {}, [], async (_args, exec) => {
        const { root, link } = await linked(exec)
        if (!link) return '当前会话未关联任务'
        const { req } = await issueOf(root, link.issueId)
        return JSON.stringify({ title: req.title, status: REQ_STATUS_TEXT[req.status] ?? req.status, overview: requirementOverview(req), goal: req.goal, scope: req.scope, acceptance: req.acceptance || req.q_success })
      }),
    ]
    return () => { for (const d of disposers) d?.() }
  }, 'project-workbench: stage-3 task tools')

  // ---- current-task dynamic context (§5.3): assembled before each model step ----
  // The provider is synchronous by contract; it reads the small link/task files
  // directly and returns '' when unlinked, adding no tokens.
  const clip = (v, n) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim()
    return s ? (s.length > n ? `${s.slice(0, n)}…` : s) : '（未填写）'
  }
  ctx.effect(() => ctx.systemPrompt.context({
    name: 'project-workbench:task',
    order: 150,
    interpolate: false,
    text: assembly => {
      const agent = assembly?.agent
      const root = cwdOf(agent)
      if (!root) return ''
      let link
      try { link = JSON.parse(readFileSync(linkFile(root, agent.session.id), 'utf8')) } catch { return '' }
      if (!REQ_ID_RE.test(link?.reqId ?? '') || !ISS_ID_RE.test(link?.issueId ?? '')) return ''
      try {
        const reqDir = join(root, '.project', 'requirements', link.reqId)
        const req = parseFrontmatter(readFileSync(join(reqDir, 'requirement.md'), 'utf8'))
        const doc = parseFrontmatter(readFileSync(join(reqDir, 'issues', `${link.issueId}.md`), 'utf8'))
        const status = STATUS_TEXT[doc.get('status')] ?? doc.get('status')
        const overview = taskOverview({ problemOverview: store.getSection(doc.body, '问题概述'), description: store.getSection(doc.body, '说明') })
        return `当前工作台任务：${clip(doc.get('title'), 36)}（${status}）\n关联需求：${clip(req.get('title'), 30)}\n` +
          `任务概述：${clip(overview, 28)}\n步骤或场景：${clip(store.getSection(doc.body, '触发路径'), 28)}\n` +
          `根因：${clip(store.getSection(doc.body, '根因'), 28)}\n完成标准：${clip(doc.get('acceptance'), 28)}\n` +
          '规则：有实质进展、结论或阻塞时调用 workbench_task_* 记录；达到完成标准调用 workbench_task_submit；无关内容不记录；完成与验收由用户在界面确认。'
      } catch { return '' }
    },
  }), 'project-workbench: current task context')
}
