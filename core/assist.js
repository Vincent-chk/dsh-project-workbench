// Stage-3 §3.5: requirement organize and task split. A read-only child of the
// project's own session drafts; the Host persists preview proposals only.
// Nothing formal changes until the user adopts via proposal/adopt.
import * as store from './store.js'
import { listProposals, saveSplitProposals, submitProposals } from './proposals.js'
import { projectSession, startReadOnlyChild, parseJsonOutput } from './spawn.js'
import { WorkbenchError } from './files.js'
import { readSplitEvidence } from './split-evidence.js'
import { freshDelivery, requirementOverview, startBlockers, taskOverview } from './state.js'

const textOf = result => result.output.filter(b => b.type === 'text').map(b => b.text).join('\n')
const assertRoot = root => {
  if (typeof root !== 'string' || !root.startsWith('/') || root.includes('\0')) throw new WorkbenchError('INVALID_ROOT', 'root must be an absolute path')
}
// Fingerprint covers the requirement AND its tasks: creating/editing a task does
// not change requirement.md's hash, so a split must still detect it (§3.5).
const stateFingerprint = req => JSON.stringify([
  req.hash,
  (req.issues ?? []).map(i => [i.id, i.title, i.hash]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
])

const REQUIREMENT_FIELDS = ['q_pain', 'goal', 'scope', 'acceptance']
const TASK_FIELD_LABELS = { title: '标题', problemOverview: '任务概述', triggerPath: '操作步骤', acceptance: '完成标准' }
const draftWriting = '面向不懂技术的人，用简体中文写可看到的行为、结果和影响。必要的专业名称用一句话说明用途，变量、文件路径和命令只在理解操作或核对结果确实需要时放进详细说明。保留所有已知的完成条件和例外。现有内容无法支持的字段留空，不猜测，不用占位词填上。'

const organizePrompt = req =>
  '整理项目工作台的需求。只读，不写文件和执行命令。根据已有内容优先写需求概述。可以阅读项目 README 帮助理解，边界以用户提出的内容为准。' +
  draftWriting +
  '需求概述简要说清发生了什么或需要什么。目标、边界和完成标准可选，有依据再写。目标说明希望的变化，边界说明这次包含和排除的内容，完成标准逐条写可核对的结果。\n' +
  '需求当前内容：\n```json\n' + JSON.stringify({ title: req.title, q_who: req.q_who, q_pain: req.q_pain, q_success: req.q_success, q_out: req.q_out, goal: req.goal, scope: req.scope, acceptance: req.acceptance, background: req.background, activity: req.activity }) + '\n```\n' +
  '仅输出一个标为 json 的代码块，结构为 {"q_pain":"需求概述","goal":"目标","scope":"边界","acceptance":"完成标准"}。'

const splitLines = value => String(value ?? '').split(/[\r\n；;。]+/)
  .map(line => line.trim().replace(/^\s*(?:[-*+]\s+|\d+[.)、．）]\s*)/, '')).filter(Boolean)

function splitChecks(req) {
  const criteria = splitLines(req.acceptance || req.q_success)
  const lines = criteria.length ? criteria : splitLines(req.goal || requirementOverview(req))
  return [...new Set(lines)].map((text, index) => ({ id: `r${index + 1}`, text, criterion: criteria.length > 0 }))
}

function splitTaskFacts(req, issue) {
  const since = Math.max(Number(req.deliveryStartedAt) || 0, Number(issue.deliveryStartedAt) || 0)
  const fresh = issue.resultFresh !== false && freshDelivery(issue, since)
  // Every issue here comes from scanProject, which scopes verification to the
  // later of the requirement and task rounds.
  const verification = issue.verification
  const evidence = verification.hasManualEvidence ? issue.evidence : ''
  const verified = issue.status === 'done' && fresh && !!issue.resultSummary &&
    !verification.failed && !verification.incomplete && !verification.unconfirmedChanges &&
    (!!evidence || verification.passed > 0)
  const limitsCurrent = Number(issue.knownLimitsAt) > 0 && Number(issue.knownLimitsAt) >= since
  const activity = issue.activity ?? []
  const progress = activity.filter(line => !/客观记录同步：会话 |建议已采用：prop-|\b[a-z_]+ → [a-z_]+/.test(line)).slice(0, 3)
  return { id: issue.id, title: issue.title, overview: taskOverview(issue), acceptance: issue.acceptance,
    status: issue.status, progress, blockedReason: issue.blocked_reason,
    cancellation: issue.status === 'cancelled' ? activity.find(line => / → cancelled/.test(line)) : undefined,
    result: fresh ? issue.resultSummary : '', evidence, verification, verified,
    limits: limitsCurrent ? issue.knownLimits : '', unverifiedKnownLimits: limitsCurrent ? '' : issue.knownLimits }
}

const splitPrompt = (req, feedback, previous) =>
  '核对该项目的现状，再建议必要的任务。只读。用 read/glob/grep 查看当前工作区相关代码、测试、说明或已保存的验证，尤其在区分缺实现和缺验证、或需要新建时。不要执行命令，不要猜测当前行为、操作入口和验证结果。' +
  '按检查项逐条返回。verified 仅用于有匹配的本轮验证且人工已确认的已有任务；读到实现或测试源码不能说明验证已经通过。progress 是历史进展，不能当作本轮验证；unverifiedKnownLimits 是未核实的历史限制，不能断言它仍存在或已消除。assigned 表示已有任务负责或可以补进已有任务，包括待办、处理中、待确认、阻塞时，附原任务 ID 和具体缺口或阻塞。原任务已结束且可重开补齐时也优先链接它。已取消时核对取消原因。' +
  'gap 只用于已确认的独立缺口，必须引用至少一段本项目的实际原文，且没有可接续的任务。unknown 用于信息不足或边界冲突。另用 question 只问一句影响方向的关键问题，没有就留空。检查复合标准里的正常和异常场景，不能把一部分验证当成全部覆盖。' +
  '相同工作即使换标题也要回原任务。可以合并同一个交付，允许零个新任务。每条新任务必须用 requirementIds 指向独立缺口，whySeparate 说明为何原任务接不住。超出边界、试探性工作和额外功能不写成任务。用户反馈可调整粒度和措辞，涉及改范围时请其走需求编辑。' +
  'detail 用一句话解释核对事实、还差什么或下一步。面向用户的 detail 和 whySeparate 引用任务标题，任务编号只放在 taskIds。若依据项目文件，sources 最多三条，使用相对路径和实际读到的短原文，程序会核对引用。不要在 sources 引用 .project 文件，已有任务和进展通过 taskIds 与上方数据核对。verified 必填 taskIds。' +
  '数据：\n```json\n' + JSON.stringify({ title: req.title, overview: requirementOverview(req), goal: req.goal, scope: req.scope,
    exclusions: req.q_out, checks: splitChecks(req), tasks: (req.issues ?? []).map(issue => splitTaskFacts(req, issue)), feedback, previous }) + '\n```\n' +
  '只返回一个 JSON 对象：{"items":[{"id":"r1","status":"verified|assigned|gap|unknown","detail":"核对结果","taskIds":[],"sources":[{"path":"项目相对路径","quote":"文件中的连续原文"}]}],"question":"","tasks":[{"requirementIds":["r1"],"title":"一句话任务标题","whySeparate":"为何需要独立处理"}]}。'

const normalized = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function exclusionsOf(req) {
  const marker = /^(?:(?:本轮|本次|范围外[：:]?)\s*)?(?:明确)?(?:不做|不新增|不增加|不支持|不包含|不处理|不涉及|不改|排除|无需)\s*[：:]?\s*/
  const explicit = splitLines(req.q_out)
  const withinScope = splitLines(req.scope).flatMap(line => line.split(/[，,]/)).filter(line => marker.test(line.trim()))
  return [...explicit, ...withinScope].flatMap(line => line.split(/(?:[、，,]|或者|或)/))
    .map(line => normalized(line.trim().replace(marker, ''))).filter(term => term.length > 1)
}

async function assessSplit(root, req, doc) {
  if (!Array.isArray(doc.items) || !Array.isArray(doc.tasks)) throw new WorkbenchError('ASSIST_FAILED', 'AI 没有返回可核对的任务建议')
  const checks = splitChecks(req)
  const tasks = (req.issues ?? []).map(issue => splitTaskFacts(req, issue))
  const exclusions = exclusionsOf(req)
  const outsideScope = value => exclusions.some(term => normalized(value).includes(term))
  const review = { items: [], question: typeof doc.question === 'string' ? doc.question.trim() : '' }
  const existingTitles = new Set(tasks.map(task => normalized(task.title)))
  // A model may cite a partially covering task AND propose a genuinely separate
  // gap. Keep that gap instead of relabelling the whole requirement as assigned.
  const independentGapIds = new Set(doc.tasks.filter(task => {
    const title = typeof task?.title === 'string' ? task.title.trim() : ''
    const reason = typeof task?.whySeparate === 'string' ? task.whySeparate.trim() : ''
    return title && reason && !existingTitles.has(normalized(title)) && !outsideScope(title) && !outsideScope(reason)
  }).flatMap(task => Array.isArray(task.requirementIds) ? task.requirementIds : []))
  for (const { id, text } of checks) {
    const row = doc.items.find(entry => entry?.id === id)
    const actualTaskIds = new Set(Array.isArray(row?.taskIds) ? row.taskIds : [])
    const match = normalized(text)
    const owners = tasks.filter(task => actualTaskIds.has(task.id) || (match &&
      (normalized(task.overview) === match || splitLines(task.acceptance).some(line => normalized(line) === match))))
    const sources = await readSplitEvidence(root, Array.isArray(row?.sources) ? row.sources.slice(0, 8) : [])
    const badTasks = [...actualTaskIds].some(id => !owners.some(task => task.id === id))
    const detail = typeof row?.detail === 'string' ? row.detail.trim() : ''
    const reliable = !!detail && !badTasks
    const item = { id, requirement: text, status: 'unknown', detail: reliable ? detail : '缺少可核对的依据，请补充说明后重新核对。', taskIds: owners.map(task => task.id), sources }
    if (row?.status === 'verified' && reliable && owners.some(task => actualTaskIds.has(task.id) && task.verified)) {
      item.status = 'verified'
    } else if (row?.status === 'gap' && reliable && sources.length > 0 && !outsideScope(text) && independentGapIds.has(id)) {
      item.status = 'gap'
    } else if (owners.some(task => task.status !== 'cancelled')) {
      item.status = 'assigned'
      if (reliable && row.status === 'gap') {
        item.needsWork = true
        item.detail = `${detail}\n可在原任务补齐。`
      } else if (!reliable || row.status !== 'assigned') item.detail = '已有任务可以核对或补齐这一项。'
    } else if (owners.length > 0) {
      item.detail = '相关任务已取消，请结合原取消原因核对这项是否仍需处理。'
    } else if (row?.status === 'gap' && reliable && sources.length > 0 && !outsideScope(text)) {
      item.status = 'gap'
    } else if (row?.status === 'gap') {
      item.detail = '缺少能确认这是独立缺口的项目依据，请补充说明后重新核对。'
    } else if (row?.status === 'verified') {
      item.detail = '没有足以确认这一项已通过的本轮任务验证。'
    }
    review.items.push(item)
  }
  const proposals = []
  const claimed = new Set()
  const titles = new Set(tasks.map(task => normalized(task.title)))
  const version = { requirement: req.hash, tasks: Object.fromEntries((req.issues ?? []).map(issue => [issue.id, issue.hash])) }
  for (const task of doc.tasks) {
    const title = typeof task?.title === 'string' ? task.title.trim() : ''
    const reason = typeof task?.whySeparate === 'string' ? task.whySeparate.trim() : ''
    const ids = Array.isArray(task?.requirementIds) ? [...new Set(task.requirementIds)] : []
    if (!title || !reason || !ids.length || titles.has(normalized(title)) || outsideScope(title) || outsideScope(reason)) continue
    const rows = ids.map(id => review.items.find(item => item.id === id && item.status === 'gap'))
    if (rows.some(row => !row || claimed.has(row.id))) continue
    const requirements = rows.map(row => ({ id: row.id, text: row.requirement }))
    const criteria = requirements.filter(({ id }) => checks.find(check => check.id === id).criterion)
    const suggested_patch = { title, problemOverview: requirements.map(({ text }) => text).join('\n') }
    if (criteria.length) suggested_patch.acceptance = criteria.map(({ text }) => text).join('\n')
    const sources = [...new Map(rows.flatMap(row => row.sources).map(source => [JSON.stringify(source), source])).values()]
    proposals.push({ kind: 'new_task', target: { reqId: req.id }, evidence: [`draft://requirement/${req.id}`],
      suggested_patch, reason, split: { version, requirements, sources } })
    for (const id of ids) claimed.add(id)
    titles.add(normalized(title))
  }
  return { review, proposals }
}

const issuePrompt = (req, issue) =>
  '为项目工作台的当前任务起草开始前缺少的信息。只读，不写文件、不执行命令，也不开始处理任务。只起草当前为空的字段，已有内容保持不变。' +
  draftWriting +
  '任务概述用一到两句话写用户能观察到的现象和影响，或具体要做什么。完成标准每条写一个可核对的结果。已知的操作步骤可以附上，步骤选填。缺少依据时保留缺项并说明需要补充什么。\n' +
  '所属需求：\n```json\n' + JSON.stringify({ title: req.title, overview: requirementOverview(req), goal: req.goal, scope: req.scope, acceptance: req.acceptance || req.q_success }) + '\n```\n' +
  '当前任务：\n```json\n' + JSON.stringify({ title: issue.title, description: issue.description, problemOverview: taskOverview(issue), triggerPath: issue.triggerPath, acceptance: issue.acceptance }) + '\n```\n' +
  '仅输出一个标为 json 的代码块，结构为 {"title":"标题","problemOverview":"任务概述","triggerPath":"操作步骤","acceptance":"完成标准"}。'

export function installAssist(ctx, { readOnlyChildren }) {
  const busy = new Set() // root:reqId:kind — one model call per requirement at a time

  async function draft(root, reqId, kind, promptOf, sessionId, issueId, finish) {
    const key = `${root}:${reqId}:${kind}:${issueId ?? ''}`
    if (busy.has(key)) throw new WorkbenchError('ASSIST_BUSY', '该需求正在整理中，请稍候再试')
    busy.add(key)
    try {
      const idx = await store.scanProject(root)
      const req = idx.requirements.find(r => r.id === reqId)
      if (!req) throw new WorkbenchError('NOT_FOUND', `requirement ${reqId} not found`)
      if (kind === 'organize' && req.status !== 'backlog') throw new WorkbenchError('INVALID_STATE', '需求整理仅用于需求池中的需求')
      if (kind === 'split' && (req.status !== 'in_progress' || req.pendingReopen)) throw new WorkbenchError('REQ_NOT_ACTIVE', '只有开发中的需求可以拆分任务')
      if (kind === 'split' && idx.diagnostics.some(item => item.path?.startsWith(`requirements/${reqId}/issues`) &&
        ['MISSING_FRONTMATTER', 'READ_FAILED', 'INVALID_STATUS'].includes(item.code))) {
        throw new WorkbenchError('ASSIST_FAILED', '部分现有任务无法读取，请恢复后重新核对')
      }
      const issue = kind === 'issue' ? (req.issues ?? []).find(item => item.id === issueId) : null
      if (kind === 'issue') {
        if (!issue) throw new WorkbenchError('NOT_FOUND', `issue ${issueId} not found`)
        if (req.status !== 'in_progress') throw new WorkbenchError('REQ_NOT_ACTIVE', '只有开发中需求的任务可以起草字段')
        if (['done', 'cancelled'].includes(issue.status)) throw new WorkbenchError('TERMINAL_READ_ONLY', '终态任务请先重新打开再起草')
      }
      const session = await projectSession(ctx, root, sessionId)
      if (!session.ok) throw new WorkbenchError(session.code, session.message)
      const started = await startReadOnlyChild(ctx, readOnlyChildren, session.sessionId, root,
        kind === 'organize' ? 'Project workbench requirement organize' : kind === 'issue' ? 'Project workbench task field draft' : 'Project workbench task split',
        kind === 'organize' ? 'workbench-organize' : kind === 'issue' ? 'workbench-issue' : 'workbench-split', promptOf(req, issue))
      if (!started.ok) throw new WorkbenchError(started.code ?? 'ASSIST_FAILED', started.message)
      const result = await started.data.result
      if (result.stopReason !== 'completed') throw new WorkbenchError('ASSIST_FAILED', result.diagnostic ?? `child ended: ${result.stopReason}`)
      const { doc, parseError } = parseJsonOutput(textOf(result))
      if (!doc) throw new WorkbenchError('ASSIST_FAILED', parseError)
      // The result must not silently apply to content the user edited meanwhile
      // (including a task created by hand during a split).
      const after = await store.scanProject(root)
      const nowReq = after.requirements.find(r => r.id === reqId)
      if (!nowReq || stateFingerprint(nowReq) !== stateFingerprint(req)) throw new WorkbenchError('ASSIST_STALE', '需求或任务内容在整理期间已变化，请刷新后重新核对')
      if (finish) return await finish(doc, req)
      return { doc, req, issue }
    } finally { busy.delete(key) }
  }

  const routes = {
    'requirement/organize': async i => {
      assertRoot(i.root)
      const { doc, req } = await draft(i.root, i.id, 'organize', organizePrompt, i.sessionId)
      const patch = {}
      for (const key of REQUIREMENT_FIELDS) {
        if (typeof doc[key] === 'string' && doc[key].trim()) patch[key] = doc[key].trim()
      }
      const hint = requirementOverview({ ...req, ...patch }) ? '' : '请补充需求概述。'
      if (!Object.keys(patch).length) throw new WorkbenchError('ASSIST_FAILED', hint || '当前没有可整理的内容。')
      const res = await submitProposals(i.root, [{ kind: 'req_draft', target: { reqId: i.id }, evidence: [`draft://requirement/${i.id}`], suggested_patch: patch, reason: hint || 'AI 整理建议，待用户采用', baseHash: req.hash }])
      return { proposalIds: res.data.saved, skipped: res.data.skipped }
    },
    'issue/draft': async i => {
      assertRoot(i.root)
      const { doc, issue } = await draft(i.root, i.reqId, 'issue', issuePrompt, i.sessionId, i.id)
      const patch = {}
      for (const key of Object.keys(TASK_FIELD_LABELS)) {
        const existing = key === 'problemOverview' ? taskOverview(issue) : String(issue[key] ?? '').trim()
        if (!existing && typeof doc[key] === 'string' && doc[key].trim()) patch[key] = doc[key].trim()
      }
      const missing = startBlockers({ ...issue, ...patch }).map(key => TASK_FIELD_LABELS[key])
      if (!Object.keys(patch).length) throw new WorkbenchError('ASSIST_FAILED', missing.length ? `请补充${missing.join('、')}。` : '开始前必填项已齐全，无需起草。')
      const res = await submitProposals(i.root, [{
        kind: 'field_draft', target: { reqId: i.reqId, issueId: i.id }, evidence: [`draft://issue/${i.id}`],
        suggested_patch: patch, reason: missing.length ? `采用后仍需补充${missing.join('、')}。` : 'AI 字段草稿，待用户核对采用', baseHash: issue.hash,
      }])
      return { proposalIds: res.data.saved, skipped: res.data.skipped }
    },
    'requirement/split': async i => {
      assertRoot(i.root)
      const feedback = typeof i.feedback === 'string' ? i.feedback.trim() : ''
      const prior = new Set(Array.isArray(i.priorProposalIds) ? i.priorProposalIds : [])
      const previous = feedback && prior.size ? (await listProposals(i.root)).filter(p => prior.has(p.id) && p.split &&
        p.status === 'pending' && p.target.reqId === i.id).map(p => p.suggested_patch) : []
      return draft(i.root, i.id, 'split', req => splitPrompt(req, feedback, previous), i.sessionId, undefined, async (doc, req) => {
        const { review, proposals } = await assessSplit(i.root, req, doc)
        const res = await saveSplitProposals(i.root, i.id, proposals)
        return { proposalIds: res.data.saved, skipped: res.data.skipped, review }
      })
    },
  }
  return { routes }
}
