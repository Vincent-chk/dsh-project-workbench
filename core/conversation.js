import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { taskResult } from '../client-src/workbench-content.js'
import { commands, helpText, readInvocation, simpleAction } from './conversation-commands.js'
import { textOf } from './extract.js'
import { WorkbenchError } from './files.js'
import { listPrds, readPrd, savePrd, validatePrdDraft } from './prd.js'
import { dispatch } from './rpc.js'
import { effectiveEvidence, requirementOverview, startBlockers, taskOverview } from './state.js'
import * as store from './store.js'

const stop = /^(?:取消(?:这次操作)?|算了|到此为止|先聊别的|换个话题|不用了)[。！.!]?$/u
const noWrite = /(?:先(?:别|不要|不用)(?:记录|记|保存|写入|修改|同步)|只读|先讨论|先聊聊|别保存|别记|不要保存|不写入|不要修改|\bread.only\b|\b(?:don't|do not)\s+(?:save|write|record)\b)|^(?:为什么|为何|如何|怎么|怎样|why\b|how\b)/iu
const followOnly = new Set(['read', 'addRequirement', 'editRequirement', 'addTask', 'taskRecord', 'recordUpdate', 'prdCreate', 'prdPreview', 'remember', 'finish'])
const groups = {
  help: ['read', 'status', 'resourceStatus'],
  status: ['read', 'status', 'resourceStatus'],
  requirement: ['read', 'addRequirement', 'editRequirement', 'removeRequirement', 'restoreRequirement', 'remember', 'finish'],
  task: ['read', 'split', 'addTask', 'taskStart', 'taskRecord', 'taskSubmit', 'taskReview', 'taskConfirm', 'remember', 'finish'],
  update: ['read', 'recordUpdate', 'remember', 'finish'],
  prd: ['read', 'prdCreate', 'prdPreview', 'remember', 'finish'],
  'wiki-update': ['generate', 'resourceStatus'],
  'architecture-update': ['generate', 'resourceStatus'],
}
const actions = [...new Set(Object.values(groups).flat())]
const mentionActions = actions.filter(action => action !== 'recordUpdate')
const generating = new Set(['starting', 'running', 'stopping'])
const writes = new Set(['addRequirement', 'editRequirement', 'removeRequirement', 'restoreRequirement', 'split', 'addTask', 'taskStart', 'taskRecord', 'taskSubmit', 'recordUpdate', 'prdCreate', 'generate'])
const reqFields = ['title', 'overview', 'goal', 'scope', 'acceptance', 'audience']
const reqFieldKeys = { title: 'title', overview: 'q_pain', goal: 'goal', scope: 'scope', acceptance: 'acceptance', audience: 'q_who' }
const taskFields = ['title', 'overview', 'acceptance', 'steps']
const taskFieldKeys = { title: 'title', overview: 'problemOverview', acceptance: 'acceptance', steps: 'triggerPath' }
const limits = { title: 180, overview: 8000, goal: 8000, scope: 8000, acceptance: 8000, audience: 8000, steps: 8000 }
const states = {
  backlog: '需求池', reviewing: '评审中', ready: '待开发', in_progress: '开发中', pending: '待验收', completed: '已完成',
  todo: '待处理', doing: '处理中', blocked: '阻塞', in_review: '待验收', done: '已完成', cancelled: '已取消',
  starting: '正在启动', running: '正在生成', stopping: '正在停止', failed: '生成失败', idle: '尚未运行',
}
const labels = { title: '标题', overview: '概述', goal: '目标', scope: '范围', acceptance: '完成标准', audience: '用户' }
const normalized = text => text.normalize('NFKC').trim().toLowerCase()
const isMain = agent => !!agent?.session && agent.session.header?.origin !== 'subagent'
const signalOf = signal => signal ?? new AbortController().signal
const errorOf = error => ({ code: error?.code ?? 'WORKBENCH_ERROR', message: error?.message ?? String(error) })
const titleOf = root => basename(root) || root

function publicReq(req) {
  return { id: req.id, title: req.title, status: states[req.status] ?? req.status, overview: requirementOverview(req),
    audience: req.q_who, goal: req.goal, scope: req.scope, acceptance: req.acceptance || req.q_success,
    outOfScope: req.q_out, recentActivity: req.activity.slice(0, 5),
    tasks: req.issues.map(({ id, title, status }) => ({ id, title, status: states[status] ?? status })) }
}

function publicTask(req, issue) {
  const since = Math.max(Number(req.deliveryStartedAt) || 0, Number(issue.deliveryStartedAt) || 0)
  const result = taskResult(issue, since)
  const fresh = result.recordedSummary && Number(issue.resultAt) >= since
  return {
    id: issue.id, reqId: req.id, title: issue.title, status: states[issue.status] ?? issue.status,
    overview: taskOverview(issue), acceptance: issue.acceptance, startBlockers: startBlockers(issue),
    blockedReason: issue.blocked_reason, currentResult: result.summary,
    recordedResult: fresh ? result.recordedSummary : '',
    currentEvidence: Number(issue.evidenceAt) >= since && Number(issue.evidenceAt) > 0 ? effectiveEvidence(issue) : '',
    currentLimits: Number(issue.knownLimitsAt) >= since && Number(issue.knownLimitsAt) > 0 ? issue.knownLimits : '',
    recentActivity: issue.activity.slice(0, 5),
    verification: result.verification,
    checks: store.taskVerificationChecks(issue, since).slice(-12),
  }
}

function fieldsFrom(input, keys, names) {
  const fields = {}
  for (const key of keys) {
    if (!Object.hasOwn(input ?? {}, key)) continue
    const value = input[key]
    if (typeof value !== 'string' || value.length > limits[key]) throw new WorkbenchError('INVALID_FIELD', '请缩短输入后重试。')
    fields[names[key]] = value.trim()
  }
  return fields
}

async function safePath(root, segments, allowMissing = false) {
  let path = root
  for (const part of segments) {
    path = join(path, part)
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new WorkbenchError('INVALID_PATH', '项目管理路径包含符号链接。')
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return
      throw error
    }
  }
}

function findNamed(rows, query) {
  const q = normalized(query)
  const exact = rows.filter(item => item.id === query || normalized(item.title) === q)
  return exact.length ? exact : rows.filter(item => normalized(item.title).includes(q))
}

function cardsOf(state) {
  return [state.prd, state.card, ...state.resources.values()].filter(card => card && !card.dismissed)
}

function assertProjectWritable(project) {
  if (project.project.schema > store.SUPPORTED_SCHEMA) throw new WorkbenchError('SCHEMA_TOO_NEW', '请升级工作台后再编辑该项目。')
}

export function installConversation(ctx, { links, discovery, routes, resources }) {
  const sessions = new WeakMap()
  function stateOf(session) {
    if (!sessions.has(session)) sessions.set(session, { active: null, waiting: null, target: null, card: null, prd: null, resources: new Map() })
    return sessions.get(session)
  }

  // The host, rather than model arguments or the selected workbench panel,
  // chooses and checks the workspace for every operation.
  function rootOf(agent) {
    const root = agent.session.header?.cwd
    if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0')) throw new WorkbenchError('ROOT_REQUIRED', '请先在 DSH 打开一个项目会话。')
    return root
  }
  async function projectOf(agent) {
    const root = rootOf(agent)
    try { await safePath(root, ['.project', 'project.md']) } catch (error) {
      if (error.code === 'ENOENT') throw new WorkbenchError('NOT_INITIALIZED', '请在左侧项目工作台启用当前项目，再试一次。')
      throw error
    }
    await safePath(root, ['.project', 'requirements'], true)
    const index = await store.scanProject(root)
    if (!index.project) throw new WorkbenchError('READ_FAILED', '项目设置无法读取。请在项目工作台查看诊断。')
    return { root, ...index }
  }

  function writeAllowed(agent, turn) {
    if (turn?.readOnly) throw new WorkbenchError('READ_ONLY', '本次只讨论。明确要求保存后再修改项目。')
    const session = agent.session
    const events = session.snapshotEvents?.() ?? []
    const plan = agent.ctx?.get?.('planMode')?.get?.(agent)
    const activePlan = plan ? (plan.pending ?? plan.active) : events.findLast(e => e.type === 'plan/mode')?.data?.active
    if (activePlan) throw new WorkbenchError('PLAN_ACTIVE', '当前处于计划模式。退出计划模式后再修改或生成。')
    if (ctx.sandboxPolicy.resolve({ session }).mode === 'read-only') {
      throw new WorkbenchError('READ_ONLY', '当前会话是只读模式。请在 DSH 调整权限后再试。')
    }
    const lastStart = events.findLastIndex(e => e.type === 'turn/start')
    if (lastStart !== -1 && !events.slice(lastStart + 1).some(e => e.type === 'turn/end')) {
      const pending = new Set()
      for (const e of events.slice(lastStart + 1)) {
        if (e.type === 'approval/asked') pending.add(e.data.id)
        if (e.type === 'approval/decided') pending.delete(e.data.id)
      }
      if (pending.size) throw new WorkbenchError('APPROVAL_PENDING', '请先处理当前会话中的权限请求。')
    }
  }

  async function call(method, input, signal) {
    const res = await dispatch(method, input, signalOf(signal), routes)
    if (!res.ok) throw new WorkbenchError(res.code, res.message)
    return res.data
  }

  function show(state, card) {
    const slot = card.kind === 'prd' ? 'prd' : 'card'
    state[slot] = { id: randomUUID(), ...card }
    return state[slot]
  }
  function showTarget(state, project, req, issue, kind = 'open', message = '') {
    const target = { reqId: req.id, ...(issue && { issueId: issue.id }) }
    state.target = target
    show(state, { kind, root: project.root, status: req.status, title: issue?.title ?? req.title, ...target, message })
  }

  async function selected(agent, state, args, project, needIssue = false) {
    const { link } = await links.getLink(project.root, agent.session.id)
    const reqId = args.reqId || (args.issueId ? project.requirements.find(req => req.issues.some(issue => issue.id === args.issueId))?.id : (state.target?.reqId ?? link?.reqId))
    const req = project.requirements.find(item => item.id === reqId)
    if (!req) throw new WorkbenchError('REQ_REQUIRED', '请先从当前项目选择一条需求。')
    const issueId = args.issueId || (state.target?.reqId === reqId ? state.target.issueId : undefined) || (link?.reqId === reqId ? link.issueId : undefined)
    const issue = req.issues.find(item => item.id === issueId)
    if (needIssue && !issue) throw new WorkbenchError('TASK_REQUIRED', '请选择该需求中的一项任务。')
    return { req, issue, issueId }
  }

  async function summary(args, project, signal) {
    const data = await call('home/summary', { root: project.root }, signal)
    const matches = args.reqId
      ? project.requirements.filter(req => req.id === args.reqId)
      : args.query ? findNamed(project.requirements, args.query) : null
    if (matches && matches.length !== 1) {
      return { matches: matches.map(({ id, title }) => ({ id, title })), message: matches.length ? '请指定一条需求。' : '未找到匹配的需求。' }
    }
    const req = matches?.[0]
    const reminders = data.reminders.filter(item => !req || item.reqId === req.id).slice(0, 12)
    return {
      project: data.project?.name || titleOf(project.root),
      current: req ? req.issues.filter(issue => ['doing', 'blocked', 'in_review'].includes(issue.status)).map(issue => publicTask(req, issue))
        : project.requirements.filter(item => item.status === 'in_progress').map(({ id, title }) => ({ id, title })),
      reminders,
      diagnostics: data.diagnostics.filter(item => item.code !== 'NOT_INITIALIZED').slice(0, 8).map(({ path, code }) => ({ path, code })),
      ...(req && { requirement: publicReq(req) }),
    }
  }

  async function resourceCard(agent, state, type, start, signal, commandId) {
    if (!Object.hasOwn(resources, type)) throw new WorkbenchError('INVALID_KIND', '请选择 Wiki 或架构图。')
    const project = await projectOf(agent)
    const root = project.root
    const label = type === 'wiki' ? 'Wiki' : '架构图'
    const existing = state.resources.get(type)
    const card = { kind: 'resource', id: randomUUID(), root, type, title: label, watch: true }
    const requestKey = commandId ?? state.active?.key
    if (start) {
      assertProjectWritable(project)
      writeAllowed(agent, state.active)
      await safePath(root, ['.project', '.local', ...(type === 'arch' ? ['archify'] : [])], true)
      signal?.throwIfAborted()
      if (requestKey && existing?.requestKey === requestKey) return resourceStatus(state, existing)
      const res = await resources[type].start({ root, sessionId: agent.session.id })
      if (!res.ok) {
        // The host already puts synchronous slash failures in the transcript.
        if (commandId === undefined && state.resources.get(type) === existing) {
          state.resources.set(type, { ...card, state: 'failed', code: res.code, message: res.message, watch: false })
        }
        throw new WorkbenchError(res.code, res.message)
      }
      const current = state.resources.get(type)
      if (res.data?.alreadyRunning && current?.watch) return resourceStatus(state, current)
      card.requestKey = requestKey
      state.resources.set(type, card)
      return resourceStatus(state, card)
    }
    if (existing?.watch) return resourceStatus(state, existing)
    const result = await resourceStatus(state, card)
    if ((commandId === undefined || result.watch) && state.resources.get(type) === existing) {
      state.resources.set(type, { ...result, requestKey: existing?.requestKey })
    }
    return result
  }

  async function resourceStatus(state, card) {
    if (!card.watch) return card
    const res = await resources[card.type].status({ root: card.root })
    const status = res.data?.status === 'idle' ? (res.data.last ?? res.data) : res.data
    const text = states[status?.status] ?? (status?.status === 'done' ? '已生成' : '状态不可用')
    const result = { ...card, watch: generating.has(status?.status), state: status?.status ?? 'failed', code: status?.code ?? res.code,
      message: status?.message || status?.error || res.message || text }
    // A terminal receipt describes this run even if another job starts before it is viewed.
    if (!result.watch && state.resources.get(card.type) === card) state.resources.set(card.type, result)
    return result
  }

  async function read(agent, state, args, project) {
    const { root, requirements } = project
    if (args.prdId) return readPrd(root, args.prdId)
    if (args.reqIds?.length) {
      const reqs = args.reqIds.map(id => requirements.find(req => req.id === id))
      if (reqs.some(req => !req)) throw new WorkbenchError('REQ_REQUIRED', '部分需求不在当前项目。请重新选择。')
      return { requirements: reqs.map(publicReq), prds: (await listPrds(root)).filter(prd => prd.reqIds.some(id => args.reqIds.includes(id))) }
    }
    if (args.query && args.query !== '*') return { matches: findNamed(requirements, args.query).map(publicReq) }
    if (args.reqId || args.issueId || (state.target && args.query !== '*')) {
      const { req, issue } = await selected(agent, state, args, project)
      return { requirement: publicReq(req), task: issue && publicTask(req, issue), prds: await listPrds(root, req.id) }
    }
    const { link } = await links.getLink(root, agent.session.id)
    const bound = !link && await discovery.forSession(root, agent.session.id)
    const req = requirements.find(item => item.id === (link?.reqId ?? bound?.id))
    const issue = req?.issues.find(item => item.id === link?.issueId)
    return { currentRequirement: req && publicReq(req), currentTask: issue && publicTask(req, issue),
      requirements: requirements.slice(0, 100).map(({ id, title, status }) => ({ id, title, status: states[status] ?? status })),
      ...(args.query === '*' && { prds: (await listPrds(root)).slice(0, 100) }),
      moreRequirements: requirements.length > 100, diagnostics: project.diagnostics.slice(0, 8) }
  }

  async function useTool(args, exec) {
    const agent = exec.agent
    if (!isMain(agent)) throw new WorkbenchError('SESSION_REQUIRED', '请在项目的主会话中使用工作台。')
    const state = stateOf(agent.session)
    const turn = state.active
    if (!turn) throw new WorkbenchError('COMMAND_REQUIRED', '请先发送 /pwb 命令或 @workbench 请求。')
    const action = args.action
    const available = turn.kind === 'mention' ? mentionActions : groups[turn.kind]
    if (!available?.includes(action) || (turn.followUp && !followOnly.has(action))) {
      throw new WorkbenchError('ACTION_NOT_AVAILABLE', '这个动作需要单独发起。请使用对应的 /pwb 命令。')
    }
    const signal = exec.signal
    signal?.throwIfAborted()
    // A fresh sync starts with the session link, independent of a target left
    // behind by an earlier workbench operation.
    const targetState = turn.kind === 'update' ? { target: turn.followUp ? turn.target : null } : state
    if (action === 'finish') {
      state.waiting = null
      state.active = null
      state.target = null
      return { message: '已结束本次跟进。' }
    }
    if (action === 'remember') {
      if (args.reqId || args.issueId) {
        const { req, issue } = await selected(agent, targetState, args, await projectOf(agent), !!args.issueId)
        if (turn.followUp && turn.target && req.id !== turn.target.reqId) {
          throw new WorkbenchError('TARGET_CHANGED', '本轮只跟进刚才的对象。')
        }
        state.target = { reqId: req.id, ...(issue && (turn.kind !== 'update' || args.issueId) && { issueId: issue.id }) }
      }
      const target = turn.kind === 'update' && !args.reqId && !args.issueId ? targetState.target : state.target
      state.waiting = { kind: turn.kind, target, readOnly: turn.readOnly, time: Date.now() }
      return { message: '可在回复里提问。用户可直接回答。', target }
    }
    if (writes.has(action)) writeAllowed(agent, turn)
    if (action === 'generate' || action === 'resourceStatus') {
      const limited = turn.kind === 'wiki-update' ? 'wiki' : turn.kind === 'architecture-update' ? 'arch' : args.type
      return resourceCard(agent, state, limited, action === 'generate', signal)
    }
    const project = await projectOf(agent)
    const { root } = project
    const sessionId = agent.session.id
    if (writes.has(action)) assertProjectWritable(project)
    if (action === 'read') return read(agent, targetState, args, project)
    if (action === 'status') return summary(args, project, signal)
    if (turn.followUp && turn.target && (args.reqId && args.reqId !== turn.target.reqId || args.issueId && args.issueId !== turn.target.issueId)) {
      throw new WorkbenchError('TARGET_CHANGED', '本轮只跟进刚才的对象。请用新命令选择其他对象。')
    }
    if (action === 'addRequirement') {
      if (turn.followUp && turn.target?.reqId) throw new WorkbenchError('TARGET_CHANGED', '请补充刚才的需求。')
      const { title, ...fields } = fieldsFrom(args.fields, reqFields, reqFieldKeys)
      await safePath(root, ['.project', 'requirements'], true)
      signal?.throwIfAborted()
      const { data } = await store.createRequirement(root, title, fields, { creation: creationOf(agent, turn, action) })
      const req = data.reused ? (await store.scanProject(root)).requirements.find(item => item.id === data.id)
        : { id: data.id, title, status: 'backlog' }
      showTarget(state, project, req, null, 'open', data.reused ? '这次请求已记录。' : '已记入需求池。')
      state.waiting = { kind: turn.kind, target: state.target, readOnly: turn.readOnly, time: Date.now() }
      return { ...data, title: req.title, message: state.card.message }
    }
    if (action === 'prdCreate') {
      const bound = !args.reqIds?.length && !args.reqId && await discovery.forSession(root, sessionId)
      const reqIds = args.reqIds?.length ? [...new Set(args.reqIds)] : [bound?.id ?? (await selected(agent, state, args, project)).req.id]
      if (turn.followUp && turn.target && !reqIds.includes(turn.target.reqId)) {
        throw new WorkbenchError('TARGET_CHANGED', '本轮只跟进刚才的需求。')
      }
      const target = project.requirements.find(req => req.id === reqIds[0])
      if (target?.status === 'backlog') {
        await discovery.validatePrdPreparation(root, target.id, { reqIds })
        state.target = { reqId: target.id }
        show(state, { kind: 'openPreparation', root, title: target.title, reqId: target.id, reqIds, request: args.text })
        return { message: '请点击「进入 PRD 撰写」开始这条需求的专用会话。', reqIds }
      }
      const draft = await discovery.preparePrd({ root, reqIds, sessionId, request: args.text })
      signal?.throwIfAborted()
      state.target = { reqId: reqIds[0] }
      show(state, { kind: 'prd', root, title: draft.markdown.split(/\r?\n/)[0].replace(/^#\s+/, ''),
        markdown: draft.markdown, prdId: draft.id, reqIds, requirements: draft.requirements, sources: draft.sources })
      return { message: '已准备可编辑的 PRD 草稿，请用户在会话中预览及保存。', reqIds, prdId: draft.id }
    }
    if (action === 'prdPreview') {
      if (!args.prdId) throw new WorkbenchError('DISCOVERY_REQUIRED', '新建 PRD 请使用 prdCreate。每条需求须先保存一轮 Grill Me 深挖记录。')
      const current = await readPrd(root, args.prdId)
      if (current.version !== args.version) throw new WorkbenchError('PRD_CONFLICT', '请先读取现有 PRD，再基于该版本生成预览。')
      const { reqIds } = current
      const target = project.requirements.find(req => req.id === (args.reqId ?? reqIds[0]))
      if (target?.status === 'backlog' && reqIds.includes(target.id)) {
        await discovery.validatePrdPreparation(root, target.id, { prdId: current.id })
        state.target = { reqId: target.id }
        show(state, { kind: 'openPreparation', root, title: current.title, reqId: target.id, prdId: current.id, request: args.text })
        return { message: '请点击「进入 PRD 撰写」继续修改已选 PRD。', reqIds }
      }
      validatePrdDraft(reqIds, args.markdown)
      if (reqIds.length) state.target = { reqId: reqIds[0] }
      show(state, { kind: 'prd', root, title: args.markdown.trim().split(/\r?\n/)[0].replace(/^#\s+/, ''),
        markdown: args.markdown, updating: true, version: current.version, prdId: current.id, reqIds,
        requirements: project.requirements.filter(req => reqIds.includes(req.id)).map(req => req.title) })
      return { message: '已准备可编辑的 PRD 草稿，请用户在会话中预览及保存。', reqIds, prdId: current.id }
    }
    if (action === 'restoreRequirement') {
      await safePath(root, ['.project', '.local', 'trash'], true)
      const trash = await store.listTrashedRequirements(root)
      const matches = args.query ? findNamed(trash, args.query) : trash
      if (matches.length !== 1 || !args.query) return { matches: matches.map(({ id, title }) => ({ id, title })) }
      show(state, { kind: 'restore', root, title: matches[0].title, location: matches[0].location })
      return { message: '已展示要恢复的草稿，等待用户确认。' }
    }
    const syncing = action === 'recordUpdate'
    const needIssue = ['taskStart', 'taskRecord', 'taskSubmit', 'taskReview', 'taskConfirm'].includes(action) || (syncing && !!args.issueId)
    const { req, issue: selectedIssue, issueId } = await selected(agent, targetState, args, project, needIssue)
    const toRequirement = syncing && !args.issueId && (args.reqId || (targetState.target && !targetState.target.issueId))
    const issue = toRequirement ? undefined : selectedIssue
    if (syncing && !toRequirement && issueId && !issue) {
      throw new WorkbenchError('TASK_REQUIRED', '原来关联的任务已不可用。请重新指定需求或任务。')
    }
    if (writes.has(action)) {
      await safePath(root, ['.project', 'requirements', req.id, 'requirement.md'])
      if (needIssue || (syncing && issue)) await safePath(root, ['.project', 'requirements', req.id, 'issues', issue.id + '.md'])
      signal?.throwIfAborted()
    }
    if (syncing) {
      if (turn.followUp && turn.target && (req.id !== turn.target.reqId || issue?.id !== turn.target.issueId)) {
        throw new WorkbenchError('TARGET_CHANGED', '本轮只同步刚才选定的需求或任务。')
      }
      const text = typeof args.text === 'string' ? args.text.replace(/\r\n?/g, '\n').trim() : ''
      if (!text || text.length > 4000) throw new WorkbenchError('INVALID_FIELD', '请用 4000 字符以内记录本会话中已有依据的进展、决定或待验证事项。')
      const note = '[会话同步] ' + text
      const options = { syncKey: creationOf(agent, turn, action).key }
      const { data } = issue ? await store.addIssueUpdate(root, req.id, issue.id, note, options)
        : await store.addRequirementUpdate(root, req.id, note, options)
      const message = data.reused ? '这次同步已记录。' : '已同步到进展记录。'
      showTarget(state, project, req, issue, 'open', message)
      return { ...data, reqId: req.id, title: issue?.title ?? req.title, message }
    }
    if (action === 'editRequirement') {
      const patch = fieldsFrom(args.fields, reqFields, reqFieldKeys)
      if (!Object.keys(patch).length) throw new WorkbenchError('INVALID_FIELD', '请至少提供一项要补充的内容。')
      try { await store.updateRequirement(root, req.id, patch, { fileHash: req.hash }) } catch (error) {
        if (error.code !== 'REVIEW_INVALIDATION_REQUIRED') throw error
        showTarget(state, project, req, null, 'reviewEdit')
        Object.assign(state.card, { patch, fileHash: req.hash, changes: Object.entries(args.fields).map(([key, value]) => ({ label: labels[key], value })) })
        return { message: '这项改动需要重审。已展示变更，请用户确认。' }
      }
      showTarget(state, project, req, null, 'open', '已更新需求。')
      state.waiting = { kind: turn.kind, target: state.target, readOnly: turn.readOnly, time: Date.now() }
      return { id: req.id, title: patch.title ?? req.title, message: '已更新需求。' }
    }
    if (action === 'removeRequirement') {
      if (req.status !== 'backlog' || req.issues.length || req.devHistory) throw new WorkbenchError('NOT_A_DRAFT', '只有没有任务或开发历史的需求池草稿可以移除。')
      showTarget(state, project, req, null, 'remove')
      state.card.fileHash = req.hash
      return { message: '已展示要移除的草稿，等待用户确认。' }
    }
    if (action === 'split') {
      const result = await call('requirement/split', { root, id: req.id, sessionId, feedback: args.text }, signal)
      showTarget(state, project, req, null, 'open', '已核对现有任务，建议可在需求详情中查看。')
      return result
    }
    if (action === 'addTask') {
      const { title, ...fields } = fieldsFrom(args.fields, taskFields, taskFieldKeys)
      await safePath(root, ['.project', 'requirements', req.id, 'issues'], true)
      const { data } = await store.createIssue(root, req.id, title, fields, null, { creation: creationOf(agent, turn, action + '/' + req.id) })
      showTarget(state, project, req, { id: data.id, title }, 'open', data.reused ? '这次请求的任务已存在。' : '已新建待处理任务。')
      return { ...data, title, message: state.card.message }
    }
    if (action === 'taskStart') {
      const missing = startBlockers(issue)
      if (req.status !== 'in_progress' || !['todo', 'doing', 'blocked'].includes(issue.status) || missing.length) {
        showTarget(state, project, req, issue, 'open')
        return { message: '任务目前无法开始。请核对所在阶段及必填信息。', ...publicTask(req, issue) }
      }
      showTarget(state, project, req, issue, 'start')
      return { message: '已定位任务，可在会话中点击开始处理。', title: issue.title }
    }
    if (action === 'taskReview' || action === 'taskConfirm') {
      const details = publicTask(req, issue)
      showTarget(state, project, req, issue, 'openTask', '请核对现有完成标准和验证记录。')
      if (action === 'taskReview') state.card.evidence = details
      return details
    }
    if (action === 'taskRecord' || action === 'taskSubmit') {
      const text = args.text?.trim()
      if (!text) throw new WorkbenchError('RESULT_EVIDENCE_REQUIRED', '请提供本轮实际发生的结果。')
      if (issue.status !== 'doing') {
        if (action === 'taskSubmit' && issue.status === 'in_review') return { message: '任务已处于待验收。' }
        throw new WorkbenchError('INVALID_STATE', '请在任务处于处理中时记录或提交结果。')
      }
      const { recordedResult } = publicTask(req, issue)
      const combined = !recordedResult || recordedResult.includes(text) ? (recordedResult || text) : recordedResult + '\n\n[AI 补充] ' + text
      if (action === 'taskRecord') {
        await store.updateIssue(root, req.id, issue.id, { resultSummary: combined }, { actor: 'ai', fileHash: issue.hash })
        showTarget(state, project, req, issue, 'open', '已记录结果。')
      } else {
        await store.submitIssueResult(root, req.id, issue.id, { summary: combined, actor: 'ai', fileHash: issue.hash })
        showTarget(state, project, req, issue, 'openTask', '已提交验收，请核对证据。')
      }
      return { message: state.card.message }
    }
    throw new WorkbenchError('ACTION_NOT_AVAILABLE', '工作台不支持该动作。')
  }

  function creationOf(agent, turn, action) {
    return { key: createHash('sha256').update(JSON.stringify([agent.session.id, turn.key, action])).digest('hex'), time: turn.time }
  }

  async function simple(agent, state, directive, signal, requestKey) {
    switch (directive.action) {
      case 'help': return helpText
      case 'requirement': return '可新建、查找、补充、移除或恢复。示例 /pwb-requirement 给聊天网页需求补上两种可切换风格。'
      case 'task': {
        const project = await projectOf(agent)
        const data = await read(agent, { target: null }, {}, project)
        if (!data.currentTask) {
          const options = project.requirements.filter(req => req.status === 'in_progress').slice(0, 10)
          return ['请指定一条开发中的需求或其中的任务。',
            ...options.map(req => '• ' + req.title + (req.issues.length ? ' · ' + req.issues.slice(0, 5).map(issue => issue.title).join('、') : '')),
            '示例 /pwb-task 验收风格切换任务。'].join('\n')
        }
        return data.currentTask.title + ' · ' + data.currentTask.status + '\n可拆分、新建、开始、继续、记录结果或核对验收。'
      }
      case 'status': {
        const data = await summary({}, await projectOf(agent), signal)
        const pending = data.reminders.map(item => '• ' + (item.title ?? item.issueTitle ?? item.reqTitle) + ' · ' + (states[item.kind] ?? reminderLabel[item.kind] ?? item.kind))
        return [data.project, ...data.current.map(item => '进行中 · ' + item.title), ...pending,
          ...(data.diagnostics.length ? ['部分项目数据无法核对。请在工作台查看诊断。']
            : !pending.length && !data.current.length ? ['暂无进行中事项或待处理项目。'] : [])].join('\n')
      }
      case 'generate':
      case 'resourceStatus': {
        const card = await resourceCard(agent, state, directive.type, directive.action === 'generate', signal, requestKey)
        if (directive.action === 'generate' && requestKey && generating.has(card.state)) {
          return card.title + ' · 生成请求已受理，可在会话中查看进度。'
        }
        return card.title + ' · ' + card.message
      }
      case 'startLinked': {
        writeAllowed(agent)
        const project = await projectOf(agent)
        assertProjectWritable(project)
        const { link } = await links.getLink(project.root, agent.session.id)
        if (!link) return '当前会话尚未关联任务。可发送 /pwb-task 开始处理某项任务，指定任务名称。'
        return startText(await links.runStart(project.root, link.issueId, agent.session.id))
      }
      default: return helpText
    }
  }

  ctx.inject?.(['commands'], commandCtx => {
    commandCtx.effect(() => {
      const dispose = Object.entries(commands).map(([kind, { title, hint }]) => commandCtx.commands.register({
        name: 'pwb-' + kind, description: title, input: { hint },
        handler: async ({ agent, commandId, rawInput, signal }) => {
          try {
            if (!isMain(agent)) throw new WorkbenchError('SESSION_REQUIRED', '请在项目的主会话中使用工作台。')
            const text = String(rawInput ?? '').trim()
            const directive = simpleAction({ kind, text })
            const state = stateOf(agent.session)
            if (directive) {
              state.waiting = null
              const result = await simple(agent, state, directive, signal, commandId)
              return { kind: 'success', text: result }
            }
            if (kind === 'update') {
              writeAllowed(agent, { readOnly: noWrite.test(text) })
              assertProjectWritable(await projectOf(agent))
              signal?.throwIfAborted()
            }
            const content = [{ type: 'text', text: '/pwb-' + kind + (text ? ' ' + text : '') }]
            await ctx.sessionController.prompt({ sessionId: agent.session.id, requestId: commandId, mode: 'queue', content }, signalOf(signal))
            return { kind: 'success' }
          } catch (error) { return { kind: 'error', text: errorOf(error).message } }
        },
      }))
      return () => dispose.forEach(fn => fn?.())
    }, 'project-workbench: native conversation commands')
  })

  ctx.effect(() => ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    if (!isMain(agent) || (message.source?.kind !== 'user' && message.source?.kind !== 'retry')) return
    const state = stateOf(agent.session)
    const input = textOf(message.content).trim()
    let invocation = readInvocation(input)
    if (invocation?.kind === 'mention' && !invocation.picked && agent.session.header?.cwd &&
      existsSync(join(agent.session.header.cwd, 'workbench'))) invocation = null
    const waiting = state.waiting
    state.waiting = null
    const stopped = stop.test(invocation?.text ?? input) || (!!waiting && noWrite.test(input) && !invocation)
    if (stopped) {
      state.active = null
      state.target = null
      if (state.card?.kind !== 'open') state.card = null
      return
    }
    const followUp = !invocation && message.source?.kind === 'user' && waiting && Date.now() - waiting.time < 30 * 60 * 1000
    if (!invocation && !followUp) { state.active = null; return }
    const kind = invocation?.kind ?? waiting.kind
    if (invocation && !['help', 'status'].includes(kind) && state.card?.kind !== 'open') state.card = null
    const time = agent.session.snapshotEvents?.().findLast(event => event.type === 'turn/start' && event.data?.turn === turn)?.time ?? Date.now()
    state.active = {
      kind, turn, time, key: message.source?.rpcId ?? message.id ?? String(turn),
      target: followUp ? waiting.target : state.target,
      followUp: !!followUp, readOnly: noWrite.test(invocation?.text ?? input) || !!(followUp && waiting.readOnly),
      direct: invocation?.kind === 'mention' && message.content?.every(block => block.type === 'text') ? simpleAction(invocation) : null,
    }
  }), 'project-workbench: conversation request')

  ctx.effect(() => ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const active = isMain(agent) && stateOf(agent.session).active
    if (!active?.direct || messages.filter(msg => msg.source?.kind === 'user').length !== 1) return next()
    const decision = await next()
    if (decision.kind === 'reject') return decision
    signal?.throwIfAborted()
    const state = stateOf(agent.session)
    const previous = state.resources.get(active.direct.type)
    try {
      const text = await simple(agent, state, active.direct, signal)
      if (!active.direct.type) show(state, { kind: 'note', title: commands[active.direct.action]?.title ?? commands.help.title, message: text })
    } catch (error) {
      if (!active.direct.type || state.resources.get(active.direct.type) === previous) {
        show(state, { kind: 'note', title: '项目工作台', ...errorOf(error), failed: true })
      }
    } finally { state.active = null }
    return { kind: 'enter', messages: [] }
  }), 'project-workbench: direct conversation operations')

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const state = sessions.get(session)
    if (!state || state.active?.turn !== event.data?.turn) return
    state.active = null
    if (['aborted', 'interrupted', 'error', 'blocked'].includes(event.data?.reason?.kind)) state.waiting = null
  }), 'project-workbench: conversation turn cleanup')

  ctx.effect(() => ctx.systemPrompt.context({
    name: 'project-workbench:conversation', order: 151, interpolate: false,
    text: ({ agent }) => {
      const active = isMain(agent) && sessions.get(agent.session)?.active
      if (!active) return ''
      if (active.kind === 'update') return [
        '用户发起 /pwb-update，要把这次会话中已发生的工作和已确认的决策同步到项目工作台的进展记录。',
        '先调用 workbench_conversation 的 read，核对当前关联任务、已有进展和用户指定的需求或任务。用户未指定时默认用关联任务。没有关联时只选择本会话中能唯一核对的对象，多项匹配或归属不明时调用 remember 后请用户选。不要新建需求或任务。',
        '根据本会话里的用户确认和实际处理证据，只同步该对象尚未记录的新进展。若决定发生变化，简明写出原决定、新决定和影响。明确区分已确认决定、尚未核对的验证结果和待决定事项；不要将建议写成决定，或将计划写成已完成。没有新内容时告诉用户，无需调用写入工具。',
        '用 recordUpdate 一次写入同一对象的全部摘要。传 issueId 同步到任务，或只传 reqId 同步到需求。只记录可给项目成员看的内容。这个操作只追加进展记录，正式字段修改和评审、验收仍通过各自入口。只有工具返回成功后才说明已同步，并告诉用户同步到了哪个对象。',
        active.followUp ? '用户在回答上次追问。沿用已选定的对象，尚未选择时根据答复核对对象。' : '',
        active.readOnly ? '用户要求先讨论，本轮只读。' : '',
      ].filter(Boolean).join('\n')
      const available = active.kind === 'mention' ? mentionActions : groups[active.kind]
      return [
        '当前用户发起项目工作台操作。先调用 workbench_conversation 读取必要的项目数据，再处理用户明确要求的动作。当前主会话目录决定项目。',
        '可用操作 ' + available.join(', ') + '。' + (active.target ? '上次对象 ' + JSON.stringify(active.target) + '。' : ''),
        active.kind === 'help' ? helpText + '\n请使用帮助说明回答通用问题。项目未启用时也可回答通用问题。' : '',
        '用 read 查需求与任务。query 按需求标题搜索，reqId 或 issueId 可读取具体对象。匹配多个时请用户选。先看真实状态，再解释哪些操作可用。',
        '新建需求须有用户已表达的标题和概述。用 addRequirement 的 fields.title 与 fields.overview。补充用 editRequirement，并在字段中保留原文已有信息。只保存明确表达的决定。',
        '验收用 taskReview 核对真实标准和证据。允许 taskConfirm 打开人工确认入口。任务结果只记录真实已完成及已核实的事实。改代码、测试或执行任务使用工作台现有开始入口。',
        '新建 PRD 先用 read 核对需求，归属不明确时请用户选择，然后调用 prdCreate 提供 reqIds。可在 text 提供用户的附加说明。按工具结果提示用户进入 PRD 撰写任务或查看草稿。遇到缺少一轮已保存的深挖或还未整理时，向用户转述提示，不得另行生成 PRD。更新已有 PRD 时先确认具体文档，可用 read 且 query 为 * 查找列表，再用 prdId 读取当前正文及 version。用同一 prdId 和 version 调用 prdPreview，并在 text 提供用户明确说过的修改要求。更新时，只有需求或用户明确表达的决定才能写成已定范围。依据不足的完成标准和无法证实的问题要标注待确认，不虚构现有工具的问题。保存须由用户在界面确认。',
        '只讨论、询问可行性或只读时使用读取操作。generate 必须是用户明确要求生成 Wiki 或架构图。type 用 wiki 或 arch。查询进度用 resourceStatus。',
        '若要追问用户并继续本次工作，请在回复前调用 remember。知道对象时传入 reqId 或 issueId。用户答复时沿用原对象。换题时调用 finish。只向用户报告已成功的写入，失败时解释原因。',
        active.followUp ? '本轮是对上次追问的回答。只处理与上次同一件事的内容，无法确定时先问清。' : '',
        active.readOnly ? '用户要求先讨论，本轮只读。' : '',
      ].filter(Boolean).join('\n')
    },
  }), 'project-workbench: conversation instructions')

  ctx.effect(() => ctx.tools.register({
    name: 'workbench_conversation',
    description: '在用户发起工作台会话操作后，查询项目、保存需求草稿、协助处理任务、准备 PRD 或生成资料。',
    parameters: { type: 'object', required: ['action'], additionalProperties: false, properties: {
      action: { type: 'string', enum: actions },
      query: { type: 'string', description: '搜索需求或回收站草稿的标题' },
      reqId: { type: 'string' }, issueId: { type: 'string' }, prdId: { type: 'string' }, version: { type: 'string' },
      reqIds: { type: 'array', items: { type: 'string' } },
      type: { type: 'string', enum: ['wiki', 'arch'] },
      text: { type: 'string', description: '任务的实际结果、拆分要求或本会话需要同步的进展摘要' },
      fields: { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.keys(limits).map(key => [key, { type: 'string' }])) },
      markdown: { type: 'string', description: 'PRD 草稿全文' },
    } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args, exec) => JSON.stringify(await useTool(args, exec)),
  }, { when: ({ agent }) => isMain(agent) && !!sessions.get(agent.session)?.active }), 'project-workbench: conversation tool')

  const visibleCard = ({ patch, fileHash, location, version, watch, requestKey, dismissed, ...card }) => card
  function sessionFor(sessionId) {
    const agent = ctx.agents.get(sessionId)
    return isMain(agent) ? agent : null
  }
  return {
    'conversation/view': async ({ sessionId }) => {
      const session = sessionFor(sessionId)?.session
      const state = session && sessions.get(session)
      if (!state) return { cards: [] }
      const cards = await Promise.all(cardsOf(state).map(card => card.kind === 'resource' ? resourceStatus(state, card) : card))
      return { cards: cards.map(visibleCard) }
    },
    'conversation/act': async ({ sessionId, cardId, action, markdown, reason }) => {
      const agent = sessionFor(sessionId)
      const state = agent && sessions.get(agent.session)
      const card = state && cardsOf(state).find(item => item.id === cardId)
      if (!card || card.acting) throw new WorkbenchError('CARD_EXPIRED', '当前操作已更新，请刷新后重试。')
      if (action === 'dismiss') {
        // Hiding a receipt must not lose the key that prevents the same request starting again.
        if (card.kind === 'resource') state.resources.set(card.type, { ...card, dismissed: true })
        else if (card.kind === 'prd') state.prd = null
        else state.card = null
        return {}
      }
      if (['remove', 'restore', 'start', 'reviewEdit', 'prd'].includes(card.kind) && ['confirm', 'reloadPrd'].includes(action)) {
        if (rootOf(agent) !== card.root) throw new WorkbenchError('WORKSPACE_MISMATCH', '当前会话的项目已变化。')
        if (agent.status !== 'idle') throw new WorkbenchError('SESSION_BUSY', '请等当前会话结束后再确认。')
        writeAllowed(agent)
        card.acting = true
        try {
          assertProjectWritable(await projectOf(agent))
          if (card.kind === 'prd' && action === 'reloadPrd' && card.version != null) {
            const doc = await readPrd(card.root, card.prdId)
            card.version = doc.version
            card.latest = doc.markdown
            card.reqIds = doc.reqIds
            card.requirements = (await projectOf(agent)).requirements.filter(req => doc.reqIds.includes(req.id)).map(req => req.title)
            return { card: visibleCard(card) }
          }
          if (action !== 'confirm') throw new WorkbenchError('ACTION_NOT_AVAILABLE', '该操作已不可用。')
          let result
          if (card.kind === 'prd') {
            const doc = card.updating
              ? await savePrd(card.root, { id: card.prdId, markdown, version: card.version })
              : await discovery.confirmPrd({ root: card.root, id: card.prdId, markdown })
            result = { message: '已保存 PRD。', prdId: doc.id }
            if (state.prd === card) state.prd = null
            show(state, { kind: 'open', root: card.root, title: doc.title, reqId: doc.reqIds[0], prdId: doc.id, message: result.message })
          } else if (card.kind === 'remove' || card.kind === 'reviewEdit') {
            await safePath(card.root, ['.project', 'requirements', card.reqId, 'requirement.md'])
            if (card.kind === 'remove') {
              await safePath(card.root, ['.project', '.local', 'trash'], true)
              await store.trash(card.root, 'requirement', card.reqId, { fileHash: card.fileHash })
              result = { message: '已移到回收站。可用 /pwb-requirement 恢复。' }
              if (state.target?.reqId === card.reqId) state.target = null
            } else {
              if (typeof reason !== 'string' || !reason.trim()) throw new WorkbenchError('REASON_REQUIRED', '请填写需要重审的原因。')
              await store.updateRequirement(card.root, card.reqId, card.patch, { fileHash: card.fileHash, confirmReviewInvalid: true, reason })
              result = { message: '已保存变更并退回需求池。' }
            }
          } else if (card.kind === 'restore') {
            await safePath(card.root, ['.project', ...card.location.split('/')])
            await safePath(card.root, ['.project', 'requirements'], true)
            await store.restore(card.root, { location: card.location })
            result = { message: '已恢复到需求池。' }
          } else {
            const { link } = await links.getLink(card.root, sessionId)
            const located = await links.locate(card.root, card.issueId, link?.issueId === card.issueId ? sessionId : null)
            if (located.sessionId !== sessionId) {
              const target = ctx.agents.get(located.sessionId)
              if (target) writeAllowed(target)
            }
            const run = await links.runStart(card.root, card.issueId, located.sessionId)
            result = { ...run, message: startText(run) }
          }
          if (state.card === card) show(state, {
            kind: 'receipt', title: card.title, message: result.message, failed: result.busy,
            pending: result.uncertain || result.alreadyStarting,
          })
          return result
        } finally { card.acting = false }
      }
      if (action === 'openPreparation' && card.kind === 'openPreparation') {
        if (rootOf(agent) !== card.root) throw new WorkbenchError('WORKSPACE_MISMATCH', '当前会话的项目已变化。')
        card.acting = true
        try {
          assertProjectWritable(await projectOf(agent))
          return await discovery.openPreparation({ root: card.root, reqId: card.reqId, kind: 'prd',
            reqIds: card.reqIds, prdId: card.prdId, request: card.request })
        } finally { card.acting = false }
      }
      if (action === 'openTask' && card.kind === 'openTask') {
        return links.locate(card.root, card.issueId)
      }
      throw new WorkbenchError('ACTION_NOT_AVAILABLE', '该操作已不可用。')
    },
  }
}

const reminderLabel = { awaitingAuth: '待授权', inReview: '待任务验收', pending: '待需求验收', reviewing: '待评审', ready: '待开发' }

function startText(run) {
  if (run.busy) return '任务会话正忙。请等当前操作结束后再试。'
  if (run.uncertain || run.alreadyStarting) return '任务启动正在确认。可稍后查看会话状态。'
  return run.alreadyRunning ? '任务已在处理。' : '已提交一次处理请求。'
}
