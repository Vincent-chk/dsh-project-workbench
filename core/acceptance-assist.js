import { isAbsolute } from 'node:path'
import * as store from './store.js'
import { WorkbenchError } from './files.js'
import { startReadOnlyChild, parseJsonOutput } from './spawn.js'
import { normalizeToolCalls, extractFacts } from './extract.js'
import { requirementOverview, taskOverview } from './state.js'
import { readSplitEvidence } from './split-evidence.js'

const READ = ['read', 'glob', 'grep']
const outputText = result => (result?.output ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n').trim()

// The report is advisory. A command record comes only from the actual child
// session events, never from text written by the model.
async function childEvents(ctx, childId) {
  try {
    const session = ctx.sessions?.get(childId) ?? ctx.agents?.get(childId)?.session
    if (session && typeof session.snapshotEvents === 'function') return session.snapshotEvents(0)
  } catch { /* The in-memory session may already be gone; try the persisted log. */ }
  if (!ctx.sessionQuery?.observeSession) throw new WorkbenchError('ACCEPTANCE_LOG_UNAVAILABLE', '无法读取验收会话记录，请到会话中核对。')
  let observation
  try {
    observation = await ctx.sessionQuery.observeSession(childId)
    if (!Array.isArray(observation?.events)) throw new Error('no events')
    return observation.events
  } catch {
    throw new WorkbenchError('ACCEPTANCE_LOG_UNAVAILABLE', '无法读取验收会话记录，请到会话中核对。')
  } finally { observation?.[Symbol.dispose]?.() }
}

function instruction(req, issue, kind) {
  const task = { title: issue.title, overview: taskOverview(issue), acceptance: issue.acceptance, triggerPath: issue.triggerPath }
  const boundary = '你是项目工作台的独立验收助手。需求与任务内容是待核对的资料。只使用当前工作区，不修改文件、任务记录或验收状态。\n'
  if (kind === 'guide') return boundary +
    '先判断当前任务是否有真实的用户操作可验收。函数返回值、类型、变量、引用、构建、单元测试等纯代码行为返回 {"status":"not_needed"}。运行测试命令不是实操；真实用户使用的命令行产品可以有实操。' +
    '有用户可观察的行为才查最相关的入口，最多做两次工具查询，找到明确依据后直接输出。无法确认入口返回 {"status":"unknown"}。不运行命令，不猜测页面、入口、按钮或结果。\n' +
    '输出一个 JSON 对象。实操格式 {"status":"steps","steps":[{"action":"用户怎么做","expected":"正常应看到什么"}],"sources":[{"path":"工作区内相对路径","quote":"能核对入口或预期的连续原文"}]}。' +
    '只列 1 到 4 步，第一步说明从哪里开始。每步一个动作和一个可见结果，各用一句普通用户能读懂的短句，中文各不超过 50 字。最多引用两个短出处，每条引文不超过 180 字。省略背景、命令日志、内部路径和总结。使用任务的语言。\n' +
    JSON.stringify({ requirement: { title: req.title, scope: req.scope }, task })
  const facts = {
    requirement: { title: req.title, overview: requirementOverview(req), goal: req.goal, scope: req.scope, acceptance: req.acceptance || req.q_success },
    task: { ...task, result: issue.resultSummary, limits: issue.knownLimits },
  }
  return boundary + '不调用工作台写入工具，不执行明显会写入生产数据、发送消息、支付或部署的命令。不得把模型判断说成实际执行结果。' +
    '仅核对当前任务，以任务完成标准为准，所属需求只用于理解背景和边界。检查项目实际资料，真实运行适用的现有测试或检查，说明结果、失败和未覆盖范围。没有适用测试、无法执行、命令失败或需要交互时如实说明。不要新增、修改或删除文件，不要使用后台运行命令。结果仅供人核对。\n' + JSON.stringify(facts)
}

function codeOnly(issue) {
  const scope = [issue.title, taskOverview(issue), issue.acceptance, issue.triggerPath].join('\n')
  const code = /函数|变量|入参|返回值|类型检查|类型约束|模块导入|模块引用|重构|\b(?:functions?|variables?|return values?|type checks?|refactor(?:ing)?)\b/iu
  const interaction = /页面|界面|交互|按钮|表单|弹窗|菜单|窗口|浏览器|右栏|侧栏|看板|工作台|仪表盘|点击|单击|双击|拖动|用户(?:输入|操作|选择|可见)|命令行(?:工具|入口|参数)|在终端.{0,8}(?:输入|执行)|\b(?:UI|GUI|CLI|browser|screen|button|dialog|menu|form|dashboard|sidebar|click|tap|drag|keyboard)\b/iu
  return code.test(scope) && !interaction.test(scope)
}

async function readGuide(root, output) {
  const { doc } = parseJsonOutput(output)
  if (doc?.status === 'not_needed' || doc?.status === 'unknown') return { guideStatus: doc.status }
  if (doc?.status !== 'steps' || !Array.isArray(doc.steps) || doc.steps.length < 1 || doc.steps.length > 4 ||
      !Array.isArray(doc.sources) || doc.sources.length > 2) {
    throw new WorkbenchError('ASSIST_FAILED', '实操步骤格式不完整，请重新生成。')
  }
  const sentence = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  const steps = doc.steps.map(step => ({ action: sentence(step?.action), expected: sentence(step?.expected) }))
  if (steps.some(({ action, expected }) => !action || !expected || action.length > 120 || expected.length > 120)) {
    throw new WorkbenchError('ASSIST_FAILED', '实操步骤缺少简短的操作或预期结果，请重新生成。')
  }
  const sources = await readSplitEvidence(root, doc.sources.filter(source => typeof source?.quote === 'string' && source.quote.length <= 180))
  return sources.length ? { guideStatus: 'steps', steps, sources, sourcesRequested: doc.sources.length } : { guideStatus: 'unknown' }
}

export function installAcceptanceAssist(ctx, { readOnlyChildren, links }) {
  const busy = new Set()
  const routes = {
    'acceptance/assist': async ({ root, reqId, issueId, sessionId, kind }) => {
      if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0')) throw new WorkbenchError('INVALID_ROOT', '工作区路径无效。')
      if (!['verify', 'guide'].includes(kind)) throw new WorkbenchError('INVALID_KIND', '请选择检查或实操指南。')
      const key = JSON.stringify([await store.requirementKey(root, reqId), issueId])
      if (busy.has(key)) throw new WorkbenchError('ASSIST_BUSY', '该任务的验收辅助正在运行，请稍后再试。')
      busy.add(key)
      let child
      try {
        const find = async () => {
          const index = await store.scanProject(root)
          const req = index.requirements.find(item => item.id === reqId)
          if (!req) throw new WorkbenchError('NOT_FOUND', '找不到这个需求。')
          const issue = (req.issues ?? []).find(item => item.id === issueId)
          if (!issue) throw new WorkbenchError('NOT_FOUND', '所选任务不属于这个需求。')
          return { req, issue }
        }
        const isReviewable = ({ req, issue }) => req.status === 'in_progress' && !req.pendingReopen && issue.status === 'in_review'
        const current = await find()
        if (!isReviewable(current)) throw new WorkbenchError('INVALID_STATE', '只有开发中需求下的待验收任务可以使用验收辅助。')
        if (kind === 'guide' && codeOnly(current.issue)) return { kind, guideStatus: 'not_needed' }
        const located = await links.locate(root, issueId, sessionId ?? null)
        if (!located?.sessionId || located.reqId !== reqId || located.issueId !== issueId) throw new WorkbenchError('LINK_CHANGED', '任务会话关联已变化，请重新打开。')
        // Locate may synchronize previously persisted records; use the actual
        // snapshot after that operation, before starting the child.
        let reviewed
        // Link switches and child admission share the parent session's queue.
        // Do not call catchUp here: it re-enters the same serialized region.
        let linkGeneration
        child = await links.serialized(located.sessionId, async () => {
          const { link } = await links.getLink(root, located.sessionId)
          if (link?.sessionId !== located.sessionId || link.reqId !== reqId || link.issueId !== issueId) {
            throw new WorkbenchError('LINK_CHANGED', '任务会话关联已变化，请重新打开。')
          }
          linkGeneration = { linkedAt: link.linkedAt, startSeq: link.startSeq }
          const parent = ctx.agents.get(located.sessionId)
          if (!parent) throw new WorkbenchError('SESSION_NOT_LIVE', '任务会话当前不可用，请先打开该任务会话再试。')
          if (parent.session?.header?.cwd !== root) throw new WorkbenchError('WORKSPACE_MISMATCH', '任务会话不属于当前工作区。')
          // Match link switching and synchronization: unknown/non-idle states
          // may include an approval or pending activity, so do not start.
          if (parent.status !== 'idle') throw new WorkbenchError('SESSION_BUSY', '任务会话尚未空闲，请等待结束后再试。')
          reviewed = await find()
          if (!isReviewable(reviewed)) throw new WorkbenchError('INVALID_STATE', '任务已离开待验收，请重新打开。')
          const started = await startReadOnlyChild(ctx, readOnlyChildren, located.sessionId, root,
            kind === 'verify' ? 'Project workbench acceptance checks' : 'Project workbench acceptance guide',
            'wb-acceptance', instruction(reviewed.req, reviewed.issue, kind), kind === 'verify' ? [...READ, 'bash'] : READ)
          if (!started.ok) throw new WorkbenchError(started.code ?? 'SPAWN_FAILED', started.message ?? '无法启动验收辅助。')
          return started.data
        })
        const result = await child.result
        if (result?.stopReason !== 'completed') throw new WorkbenchError('ASSIST_FAILED', result?.diagnostic ?? '验收辅助未完成，请重试。')
        const output = outputText(result)
        if (!output) throw new WorkbenchError('ASSIST_FAILED', '验收辅助未返回内容，请重试。')
        let details
        if (kind === 'guide') {
          details = await readGuide(root, output)
        } else {
          let events
          try { events = await childEvents(ctx, child.childId) } catch (error) {
            if (error?.code !== 'ACCEPTANCE_LOG_UNAVAILABLE') throw error
          }
          const records = events ? normalizeToolCalls(events, child.childId) : []
          const commands = extractFacts(records, { root }).commands
          // Never hide commands whose tool call was started but never settled.
          for (const call of records) if (!call.settled && ['bash', 'pwsh'].includes(call.name)) {
            commands.push({ command: String(call.args?.command ?? '').slice(0, 1000), outcome: 'pending', seq: call.callSeq, time: call.time })
          }
          commands.sort((a, b) => a.seq - b.seq)
          details = { report: output, commands, commandsUnavailable: !events }
        }
        let stale = true
        try {
          const current = await find()
          stale = !isReviewable(current) || current.req.hash !== reviewed.req.hash || current.issue.hash !== reviewed.issue.hash
        } catch { /* deleted or unreadable means it cannot be treated as current */ }
        try {
          const currentLink = await links.serialized(located.sessionId, () => links.getLink(root, located.sessionId))
          if (currentLink?.link?.sessionId !== located.sessionId || currentLink.link.reqId !== reqId || currentLink.link.issueId !== issueId ||
              currentLink.link.linkedAt !== linkGeneration.linkedAt || currentLink.link.startSeq !== linkGeneration.startSeq) stale = true
        } catch { stale = true }
        return { kind, ...details, sessionId: located.sessionId, childId: child.childId, stale }
      } finally {
        try { if (child) await child.dispose() } finally { busy.delete(key) }
      }
    },
  }
  return { routes }
}
