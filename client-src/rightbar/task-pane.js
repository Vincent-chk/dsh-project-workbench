import React from 'react'
import { startBlockers, taskOverview } from '../../core/state.js'
import { rpc } from '../api.js'
import { createCardActions, issueDraftFrom, issueDraftKey, newTaskInput, projectIdOf, taskFormError } from '../project-state.js'
import { isRequirementSplit, taskResult, workbenchError } from '../workbench-content.js'
import { Disclosure, ErrorDetails, LeaveModal, Modal } from '../shared/ui.js'
import { DraftSuggestions, TaskReading, TaskResult, UpdateLog } from '../detail/task-content.js'
import { AcceptanceAssist } from '../detail/acceptance-assist.js'
import { DeliveryResult, ManualDelivery } from '../detail/requirement-content.js'
import { TaskFields, TaskForm, TaskResultForm, useTaskDraft } from '../forms/task-form.js'
import { stampNeedsRead, taskChoices, taskRunView, terminalTask } from './task-state.js'
import { normalizeViewState, openDetail, statusPage } from '../shell/nav-state.js'

const h = React.createElement
const { useCallback, useEffect, useRef, useState } = React
const EMPTY_WORKSPACES = []
const useNoWorkspaces = selector => selector({ items: EMPTY_WORKSPACES })
const useNoSessionStatus = () => undefined
const useVisibleTab = () => ({ tab: { visible: true } })

export const rightbarLocale = {
  en: {
    backMain: 'Workbench', viewConversation: 'View conversation', goAuthorize: 'Review permission',
    swapTask: 'Switch task', linkedTask: 'Current task', pickNewTask: 'Switch to this task',
    retryLink: 'Retry linking', completeTaskInfo: 'Fill in task info', parentRequirement: 'Requirement',
    requirementDelivery: 'Requirement delivery', selectDevRequirement: 'Select a requirement in development',
    runInteraction: 'The conversation needs your attention.',
    switchInteraction: 'Handle the pending item in the conversation before switching tasks.',
    switchRunning: 'Wait for AI to finish, or stop it in the conversation and let its records save before switching.',
    switchPending: 'A processing request or its records are still being checked. Wait before switching tasks or requesting changes.',
    switchSyncing: 'Task records are still being saved. Try switching when this finishes.',
    searchTasks: 'Search title or overview', allRequirements: 'All requirements', createAndLink: 'Create and link',
    noTaskChoices: 'No tasks match. Clear the filters or create a task in a requirement in development.',
    taskLinked: 'Task linked. No processing request was sent.', taskCreated: 'Task created and linked as To do.',
    moreActions: 'More actions', returnTodo: 'Return to To do', restoreTask: 'Restore', reopenTaskAction: 'Reopen',
    cancelTask: 'Cancel task', cancelReason: 'Why is this task being cancelled?', returnReason: 'Why is this task returning to To do?',
    reopenReason: 'Why are you reopening this task?', supplement: 'Add information', supplementPlaceholder: 'What is now available, and what should happen next?',
    saveSupplement: 'Save information', supplementSaved: 'Information saved. No processing request was sent.',
    deferDecision: 'Not now', deferred: 'Still awaiting your confirmation.', submitAndContinue: 'Save changes and continue',
    continueSaved: 'Your requested changes were saved, but a new request has not been confirmed. Wait for any existing work to finish, then use Continue; do not save the same request again.',
    manualConfirm: 'Confirm completion manually',
    aiTaskDraft: 'Draft with AI', drafting: 'Drafting…', aiUpdated: 'Task details were updated',
    newAiUpdate: 'The saved task has changed', keepMyDraft: 'Keep my draft', loadNewContent: 'Load new content',
    createLinkFailed: 'The task was saved. Retry linking it to this conversation.',
    runSubmitted: 'One processing request was submitted.', runAlready: 'A processing request already exists; no duplicate was sent.',
    runUncertain: 'The submission result is unclear. The existing request is being checked; no new request was sent.',
    noTaskCreateHint: 'Open the workbench, or create a task under a requirement in development.',
    unsavedForm: 'Save or discard your edits before continuing.', taskMissingTitle: 'The linked task is unavailable',
  },
  zh: {
    backMain: '工作台', viewConversation: '查看会话', goAuthorize: '去授权',
    swapTask: '换任务', linkedTask: '当前关联', pickNewTask: '换成此任务',
    retryLink: '重试关联', completeTaskInfo: '补齐信息', parentRequirement: '所属需求',
    requirementDelivery: '需求交付', selectDevRequirement: '选择开发中的需求',
    runInteraction: '会话中有待处理事项。',
    switchInteraction: '会话中有待处理事项，请先在会话中处理后再切换任务。',
    switchRunning: 'AI 正在处理。请等待结束，或先在会话中停止并等待记录保存，再切换任务。',
    switchPending: '处理请求或任务记录仍在核对，请等待完成后再切换任务或提出修改。',
    switchSyncing: '正在保存任务记录，请保存完成后再切换。',
    searchTasks: '搜索标题或概述', allRequirements: '全部需求', createAndLink: '创建并关联',
    noTaskChoices: '没有符合条件的任务。可以清空筛选，或在开发中需求下新建任务。',
    taskLinked: '已关联任务，没有提交处理请求。', taskCreated: '任务已创建并关联，状态为待处理。',
    moreActions: '更多操作', returnTodo: '退回待办', restoreTask: '恢复', reopenTaskAction: '重开',
    cancelTask: '取消任务', cancelReason: '为什么取消这项任务？', returnReason: '为什么退回待处理？',
    reopenReason: '为什么重新打开这项任务？', supplement: '补充说明', supplementPlaceholder: '现在补充了什么，接下来需要怎么处理？',
    saveSupplement: '保存补充说明', supplementSaved: '补充说明已保存，没有提交处理请求。',
    deferDecision: '稍后验收', deferred: '任务仍处于待验收。', submitAndContinue: '提交并继续处理',
    continueSaved: '修改要求已保存，但尚未确认提交新的处理请求。请等待已有处理结束后点击继续处理，无需重复保存修改要求。',
    manualConfirm: '人工确认完成',
    aiTaskDraft: 'AI 起草', drafting: '正在起草…', aiUpdated: '任务内容已更新',
    newAiUpdate: '已保存的任务有更新', keepMyDraft: '保留草稿', loadNewContent: '加载新内容',
    createLinkFailed: '任务已保存。可以重试关联到当前会话。',
    runSubmitted: '已提交一次处理请求。', runAlready: '已有处理请求，没有重复提交。',
    runUncertain: '提交结果不明确，正在核对原请求，没有另行发起新请求。',
    noTaskCreateHint: '可以进入主工作台，或在开发中需求下创建并关联任务。',
    unsavedForm: '请先保存或放弃当前修改。', taskMissingTitle: '原关联任务暂时无法打开',
  },
}

export function TaskPane({ t, useCurrentSession, useSessions, useSessionStatus, useWorkspaces, useTabInfo, openMain, showConversation, uiMemory, css }) {
  const sessionId = useCurrentSession(value => value)
  const session = useSessions(state => sessionId === undefined ? undefined : state?.byId?.[sessionId])
  const sessionStatus = (useSessionStatus ?? useNoSessionStatus)(state => sessionId === undefined ? undefined : state?.get(sessionId))
  const workspaces = (useWorkspaces ?? useNoWorkspaces)(state => state?.items ?? EMPTY_WORKSPACES) ?? EMPTY_WORKSPACES
  const visible = (useTabInfo ?? useVisibleTab)().tab.visible
  const root = session?.cwd
  if (!sessionId) return null
  const registered = workspaces.find(item => item.path === root || (item.sessionIds ?? []).includes(sessionId))
  const workspace = registered ? { ...registered, workspaceId: registered.workspaceId ?? registered.id } : null
  const projectKey = workspace?.workspaceId && !String(workspace.workspaceId).startsWith('folder:')
    ? 'id:' + workspace.workspaceId : 'path:' + root
  // 明确的对象入口才切到目标项目与页面；普通“工作台”返回不传参数，
  // 由 MainShell 恢复原浏览位置（PRD §7.1）。
  const openObject = (reqId, wikiPage = null, status = null) => {
    uiMemory.picked = { id: projectIdOf(workspace), path: root }
    const current = normalizeViewState(uiMemory.views[projectKey])
    uiMemory.views[projectKey] = wikiPage
      ? { ...current, page: 'wiki', params: { wikiTarget: wikiPage }, history: [] }
      : openDetail(current, { reqId, issueId: null }, statusPage(status))
    openMain()
  }
  return h('aside', { className: 'pw-page pw-task-pane', 'aria-label': t('issueDetail') },
    h('style', null, css),
    root ? h(LinkedTask, {
      key: root + '|' + sessionId, root, sessionId, sessionStatus, visible, projectKey, t, uiMemory,
      openMain, showConversation, openRequirement: (reqId, status) => openObject(reqId, null, status), openWikiPage: (reqId, path) => openObject(reqId, path),
    }) : h('p', null, t('noWorkspace')))
}

function LinkedTask({ root, sessionId, sessionStatus, visible, projectKey, t, uiMemory, openMain, showConversation, openRequirement, openWikiPage }) {
  const [linkState, setLinkState] = useState(null)
  const [task, setTask] = useState(null)
  const [req, setReq] = useState(null)
  const [proposals, setProposals] = useState([])
  const [delivery, setDelivery] = useState(null)
  const [missing, setMissing] = useState(false)
  const [readError, setReadError] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(true)
  const [externalUpdate, setExternalUpdate] = useState(false)
  const [picking, setPicking] = useState(false)
  const [choices, setChoices] = useState(null)
  const [pickerBusy, setPickerBusy] = useState(false)
  const [createdTask, setCreatedTask] = useState(null)
  const [leave, setLeave] = useState(null)
  const active = useRef(false)
  const linkSeq = useRef(0)
  const taskSeq = useRef(0)
  const choiceSeq = useRef(0)
  const stamp = useRef({ modified: null, hash: null })
  const linkRef = useRef(null)
  const taskRef = useRef(null)
  const leaveRef = useRef(null)
  const switchButton = useRef(null)
  const focusSwitch = useRef(false)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  linkRef.current = linkState?.link ?? null
  taskRef.current = task
  const runView = taskRunView(sessionStatus, linkState?.run)

  const loadTask = useCallback(async (link, origin = 'action') => {
    if (!link) return
    const seq = ++taskSeq.current
    const [reqRes, proposalRes, deliveryRes] = await Promise.all([
      rpc('requirement/get', { root, id: link.reqId }),
      rpc('proposal/list', { root }),
      rpc('delivery/status', { root, reqId: link.reqId }),
    ])
    if (!active.current || !visibleRef.current || document.hidden || seq !== taskSeq.current) return
    if (!reqRes.ok) {
      setReadError(reqRes)
      if (reqRes.code === 'NOT_FOUND') { setTask(null); setReq(null); setMissing(true) }
      return
    }
    const requirement = { ...reqRes.data, hasCancelled: (reqRes.data.issues ?? []).some(issue => issue.status === 'cancelled') }
    const found = (requirement.issues ?? []).find(issue => issue.id === link.issueId)
    const previous = taskRef.current
    if (origin === 'poll' && found && previous?.id === found.id && previous.hash !== found.hash) setExternalUpdate(true)
    setReq(requirement)
    const currentTask = found ? { ...found, reqId: requirement.id } : null
    setTask(currentTask)
    setMissing(!found)
    setReadError(null)
    if (found) stamp.current = { modified: null, hash: found.hash }
    setProposals(proposalRes.ok ? proposalRes.data.proposals.filter(proposal => !isRequirementSplit(proposal) && proposal.status === 'pending' && proposal.target.reqId === requirement.id &&
      (proposal.target.issueId === link.issueId || proposal.kind === 'new_task')) : [])
    setDelivery(deliveryRes.ok ? deliveryRes.data.job : null)
    if (!proposalRes.ok) setError(proposalRes)
    else if (!deliveryRes.ok) setError(deliveryRes)
    return currentTask
  }, [root])

  const load = useCallback(async () => {
    if (!visibleRef.current || document.hidden) return
    const seq = ++linkSeq.current
    // Invalidate an older detail read as soon as a new association read starts.
    taskSeq.current++
    setSyncing(true)
    const res = await rpc('link/get', { root, sessionId, catchUp: true })
    if (!active.current || !visibleRef.current || document.hidden || seq !== linkSeq.current) return
    // Polling could have started another detail read while link/get was pending.
    // It must not overwrite an empty, failed, or newly changed association.
    taskSeq.current++
    if (!res.ok) {
      linkRef.current = null
      setLinkState(null)
      setReadError(res)
      setLoading(false); setSyncing(false)
      return
    }
    linkRef.current = res.data.link
    setLinkState(res.data)
    setReadError(null)
    setMissing(false)
    const link = res.data.link
    if (!link) {
      setTask(null); setReq(null); setProposals([]); setDelivery(null)
      setLoading(false); setSyncing(false)
      return
    }
    if (taskRef.current?.id !== link.issueId) { setTask(null); setReq(null); setExternalUpdate(false) }
    const currentTask = await loadTask(link)
    if (!active.current || !visibleRef.current || document.hidden || seq !== linkSeq.current) return
    setLoading(false); setSyncing(false)
    return currentTask
  }, [root, sessionId, loadTask])

  useEffect(() => {
    if (picking || !focusSwitch.current) return
    focusSwitch.current = false
    switchButton.current?.focus()
  }, [picking])

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      linkSeq.current++; taskSeq.current++; choiceSeq.current++
    }
  }, [load])

  useEffect(() => {
    if (visible) load()
    else { linkSeq.current++; taskSeq.current++ }
  }, [load, visible])

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) { linkSeq.current++; taskSeq.current++ }
      else if (visibleRef.current) load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [load])

  const wasRunning = useRef(runView.running)
  useEffect(() => {
    if (visible && wasRunning.current && !runView.running) load()
    wasRunning.current = runView.running
  }, [runView.running, load, visible])

  useEffect(() => {
    if (!visible || !task || readError) return
    const timer = setInterval(async () => {
      if (document.hidden || !visibleRef.current || !active.current || !linkRef.current) return
      const linkVersion = linkSeq.current
      const detailVersion = taskSeq.current
      const res = await rpc('task/stamp', { root, reqId: task.reqId, id: task.id })
      if (!active.current || !visibleRef.current || document.hidden || linkVersion !== linkSeq.current || detailVersion !== taskSeq.current ||
          taskRef.current?.id !== task.id || taskRef.current?.reqId !== task.reqId ||
          linkRef.current?.issueId !== task.id || linkRef.current?.reqId !== task.reqId) return
      if (!res.ok) { setReadError(res); return }
      const previous = stamp.current
      if (stampNeedsRead(previous, res.data)) {
        stamp.current = res.data
        await loadTask(linkRef.current, 'poll')
      } else if (previous.modified == null) stamp.current = res.data
    }, 3000)
    return () => clearInterval(timer)
  }, [root, task?.id, task?.hash, !!readError, loadTask, visible])

  const actionRef = useRef(null)
  if (!actionRef.current) actionRef.current = createCardActions({
    getKey: () => active.current ? sessionId : null, rpc, setBusy, setMsg: setError,
    reload: load, formatError: res => res,
  })
  const act = actionRef.current

  const guardLeave = useCallback(action => {
    if (leaveRef.current?.dirty()) setLeave({ action, error: null })
    else action()
  }, [])
  const openMainGuard = () => guardLeave(openMain)
  const choose = async () => {
    if (runView.locked) { setError({ code: 'SESSION_BUSY', message: t(runView.switchHint) }); return }
    if (syncing) { setError({ code: 'SYNC_PENDING', message: t('switchSyncing') }); return }
    const seq = ++choiceSeq.current
    setError(null); setNotice(''); setPicking(true)
    setPickerBusy(true)
    const res = await rpc('requirement/list', { root })
    if (!active.current || seq !== choiceSeq.current) return
    setPickerBusy(false)
    if (!res.ok) { setError(res); return }
    setChoices(res.data.requirements)
  }
  const closePicker = () => {
    choiceSeq.current++
    focusSwitch.current = !!task
    setPicking(false); setChoices(null); setPickerBusy(false); setCreatedTask(null); setError(null)
  }
  const linkTask = async (issueId, message) => {
    const res = await act('link/set', { root, sessionId, issueId })
    if (!active.current || !res?.ok) return false
    closePicker(); setNotice(t(message))
    return true
  }
  const attach = issueId => guardLeave(async () => {
    if (runView.locked || syncing || busy) return
    await linkTask(issueId, 'taskLinked')
  })
  const createAndLink = (reqId, input) => guardLeave(async () => {
    if (runView.locked || syncing || busy || createdTask) return
    const created = await act('issue/create', { root, reqId, ...input })
    if (!created?.ok || !active.current) return
    const saved = { id: created.data.id, title: input.title }
    setCreatedTask(saved)
    await linkTask(saved.id, 'taskCreated')
  })
  const start = async issueId => {
    const res = await act('run/start', { root, sessionId, issueId })
    if (!res?.ok || !active.current) return res
    const data = res.data
    if (data.busy) setError({ code: 'SESSION_BUSY' })
    else if (data.uncertain || data.alreadyStarting) setNotice(t('runUncertain'))
    else if (data.alreadyRunning) setNotice(t('runAlready'))
    else if (data.started) setNotice(t('runSubmitted'))
    return res
  }

  const switchHint = runView.switchHint ? t(runView.switchHint) : syncing ? t('switchSyncing') : ''
  const notices = h(React.Fragment, null,
    switchHint && !loading && h('div', { className: 'pw-sidebar-notice', role: 'status' },
      h('span', null, switchHint),
      runView.locked && !runView.running && !runView.waiting &&
        h('button', { className: 'pw-button pw-quiet', disabled: syncing, onClick: load }, t('retry'))),
    h(ErrorDetails, { error, t, showRaw: false }),
    notice && h('p', { className: 'pw-note', role: 'status' }, notice),
    readError && h('div', { className: 'pw-sidebar-notice' }, h(ErrorDetails, { error: readError, t, showRaw: false }),
      h('button', { className: 'pw-button pw-quiet', disabled: syncing, onClick: load }, t('retry'))),
    loading && !task && !readError && h('p', { className: 'pw-note', role: 'status' }, t('loading')))
  const toolbar = (children, canSwitch = false) => h('div', { className: 'pw-task-toolbar' },
    h('button', { className: 'pw-button pw-quiet', onClick: openMainGuard }, h('span', { 'aria-hidden': true }, '‹ '), t('backMain')),
    h('div', { className: 'pw-task-tools' },
      canSwitch && h('button', { className: 'pw-button pw-quiet', ref: switchButton, disabled: busy || !!switchHint, title: switchHint, onClick: choose }, t('swapTask')),
      children))

  return h(React.Fragment, null,
    task && h('div', { hidden: picking }, h(LinkedTaskDetails, {
      key: task.reqId + '|' + task.id, task, req, runView, linkState, proposals, delivery, t, root, sessionId, projectKey, uiMemory,
      busy, act, start, openRequirement: (reqId, status) => guardLeave(() => openRequirement(reqId, status)),
      openWikiPage: (reqId, path) => guardLeave(() => openWikiPage(reqId, path)), showConversation: () => guardLeave(showConversation),
      readError, syncing, externalUpdate, leaveRef, guardLeave, toolbar, notices, reload: load,
    })),
    (picking || !task) && h(React.Fragment, null, toolbar(), notices,
      !loading && h(TaskPicker, {
        requirements: choices, t, busy: busy || !!switchHint, loading: pickerBusy, picking, missing,
        currentId: task?.id, createdTask, onRetryLink: () => { if (!busy && !switchHint && createdTask) linkTask(createdTask.id, 'taskCreated') },
        onChoose: choose, onRetry: load, retryBusy: syncing, onAttach: attach, onCreate: createAndLink, onCancel: closePicker,
      })),
    leave && h(LeaveModal, {
      modal: leave, t, busy,
      onStay: () => { setLeave(null); if (picking && task) closePicker() },
      onDiscard: () => { const action = leave.action; leaveRef.current?.discard(); setLeave(null); action() },
      onSave: async () => {
        const ok = await leaveRef.current?.save()
        if (!ok?.ok) {
          setLeave(current => current ? { ...current, error: ok ? workbenchError(ok, t).text : t('saveFailed') } : current)
          return
        }
        const action = leave.action; setLeave(null); action()
      },
    }))
}

function TaskPicker({ requirements, t, busy, loading, picking, missing, currentId, createdTask,
  onChoose, onRetry, retryBusy, onAttach, onCreate, onCancel, onRetryLink }) {
  const [query, setQuery] = useState('')
  const [reqId, setReqId] = useState('')
  const [choice, setChoice] = useState('')
  const [draft, setDraft] = useState(issueDraftFrom)
  const [createReqId, setCreateReqId] = useState('')
  const [error, setError] = useState(null)
  if (!requirements) return h('section', { className: 'pw-subpage pw-task-picker', 'aria-label': t('pickTask') },
    h('h2', null, t(missing ? 'taskMissingTitle' : 'pickTask')),
    h('p', { className: 'pw-note' }, t(loading ? 'loading' : missing ? 'linkMissing' : picking ? 'errUnreadable' : 'noLinkedTask')),
    h('div', { className: 'pw-actions' },
      missing && !picking && h('button', { className: 'pw-button pw-quiet', disabled: retryBusy, onClick: onRetry }, t('retry')),
      !loading && h('button', { className: 'pw-button primary', disabled: busy, onClick: onChoose }, t(picking ? 'retry' : 'pickTask')),
      picking && h('button', { className: 'pw-button pw-quiet', onClick: onCancel }, t('cancel'))))
  const items = taskChoices(requirements, { query, reqId })
  const development = requirements.filter(req => req.status === 'in_progress' && !req.pendingReopen)
  const createFor = createReqId || (development.length === 1 ? development[0].id : '')
  const create = event => {
    event.preventDefault()
    if (busy || createdTask) return
    const invalid = taskFormError(draft)
    setError(invalid ?? (createFor ? null : { code: 'REQ_NOT_ACTIVE' }))
    if (invalid || !createFor) return
    onCreate(createFor, newTaskInput(draft))
  }
  return h('section', { className: 'pw-subpage pw-task-picker', 'aria-label': t('pickTask') },
    h('div', { className: 'pw-task-picker-head' },
      h('h2', null, t(currentId ? 'swapTask' : 'pickTask')),
      h('button', { className: 'pw-button pw-quiet', disabled: busy, onClick: onCancel }, t('cancel'))),
    createdTask ? h('div', { className: 'pw-sidebar-notice', role: 'status' },
      h('p', { className: 'pw-text' }, t('createLinkFailed')),
      h('strong', null, createdTask.title),
      h('button', { className: 'pw-button primary', disabled: busy, onClick: onRetryLink }, t('retryLink'))) : h(React.Fragment, null,
      h('label', { className: 'pw-field' }, h('span', { className: 'pw-label' }, t('searchTasks')),
        h('input', { className: 'pw-input', autoFocus: true, value: query, onChange: event => { setQuery(event.target.value); setChoice('') } })),
      h('label', { className: 'pw-field' }, h('span', { className: 'pw-label' }, t('parentRequirement')),
        h('select', { className: 'pw-select', value: reqId, onChange: event => { setReqId(event.target.value); setChoice('') } },
          h('option', { value: '' }, t('allRequirements')),
          requirements.map(req => h('option', { key: req.id, value: req.id }, req.title)))),
      items.length ? h('div', { className: 'pw-choice-list', role: 'radiogroup', 'aria-label': t('pickTask') }, items.map(issue => {
        const current = currentId === issue.id
        return h('label', { key: issue.id, className: 'pw-choice', 'data-selected': choice === issue.id },
          h('input', { type: 'radio', name: 'pw-task-choice', value: issue.id, checked: choice === issue.id, disabled: current || busy,
            onChange: () => setChoice(issue.id) }),
          h('span', { className: 'pw-choice-copy' },
            h('strong', null, issue.title),
            h('span', { className: 'pw-note' }, issue.requirementTitle, ' · ', t('st_' + issue.status), current && ' · ' + t('linkedTask')),
            taskOverview(issue) && h('span', { className: 'pw-preview' }, taskOverview(issue))))
      })) : h('p', { className: 'pw-note' }, t('noTaskChoices')),
      items.length > 0 && h('button', { className: 'pw-button primary', disabled: busy || !choice, onClick: () => onAttach(choice) },
        t(currentId ? 'pickNewTask' : 'linkTask')),
      development.length > 0 && h(Disclosure, { label: t('createAndLink') },
        h('form', { noValidate: true, onSubmit: create },
          h('label', { className: 'pw-field' }, h('span', { className: 'pw-label' }, t('parentRequirement')),
            h('select', { className: 'pw-select', value: createFor, disabled: busy, onChange: event => { setCreateReqId(event.target.value); setError(null) } },
              h('option', { value: '' }, t('selectDevRequirement')),
              development.map(req => h('option', { key: req.id, value: req.id }, req.title)))),
          h(TaskFields, { form: { draft, change: (name, value) => {
            setError(null)
            setDraft(previous => ({ ...previous, [name]: value }))
          } }, t, busy, focus: null }),
          h(ErrorDetails, { error, t, showRaw: false }),
          h('button', { className: 'pw-button', type: 'submit', disabled: busy }, t('createAndLink'))))))
}

function LinkedTaskDetails({ task, req, runView, linkState, proposals, delivery, t, root, sessionId, projectKey, uiMemory, busy,
  act, start, openRequirement, openWikiPage, showConversation, readError, syncing, externalUpdate, leaveRef, guardLeave,
  toolbar, notices, reload }) {
  const form = useTaskDraft(issueDraftKey(projectKey, task.reqId, task.id), task, uiMemory)
  const [formFocus, setFormFocus] = useState('title')
  const [formError, setFormError] = useState(null)
  const [continueEditing, setContinueEditing] = useState(false)
  const [continueText, setContinueText] = useState('')
  const [continueSaved, setContinueSaved] = useState(false)
  const [supplementing, setSupplementing] = useState(false)
  const [supplement, setSupplement] = useState('')
  const [reasonMove, setReasonMove] = useState(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [notice, setNotice] = useState('')
  const [recording, setRecording] = useState(false)
  const [manualReview, setManualReview] = useState(null)
  const [reviewError, setReviewError] = useState(null)
  const [assistRunning, setAssistRunning] = useState(false)
  const deliveryDraftKey = 'delivery:' + projectKey + '|' + task.reqId
  const [deliveryDraftDirty, setDeliveryDraftDirty] = useState(() => !!uiMemory.drafts[deliveryDraftKey])
  const lastDeliveryReq = useRef(null)
  if (lastDeliveryReq.current?.id !== task.reqId) lastDeliveryReq.current = null
  if (req?.id === task.reqId) lastDeliveryReq.current = req
  const deliveryReq = req?.id === task.reqId ? req : lastDeliveryReq.current
  const menu = useRef(null)
  const terminal = terminalTask(task)
  const item = { root, reqId: task.reqId, id: task.id }
  const inactive = req?.status !== 'in_progress' || !!req.pendingReopen
  const available = !inactive && !runView.locked && !readError && !syncing
  const missing = startBlockers(task)
  const missingText = missing.length ? t('errRequiredFields').replace('{fields}', missing.map(name =>
    t(name === 'problemOverview' ? 'taskOverviewField' : name === 'acceptance' ? 'requirementCriteria' : 'issueTitle')).join(t('fieldSeparator'))) : ''
  const taskSince = req?.id === task.reqId ? req.deliveryStartedAt : deliveryReq?.deliveryStartedAt
  const hasResult = !!taskResult(task, taskSince).summary
  const reviewable = available && !busy && !assistRunning && !form.dirty && hasResult

  const begin = (focus = 'title') => { setFormFocus(focus); setFormError(null); form.begin() }
  const save = async () => {
    const invalid = taskFormError(form.draft)
    if (invalid) { setFormError(invalid); return invalid }
    const params = form.params()
    if (!Object.keys(params.patch).length && params.fileHash === task.hash) { form.finish(); return { ok: true } }
    const res = await act('issue/update', { ...item, ...params })
    if (res?.ok) form.finish()
    else setFormError(res)
    return res
  }
  useEffect(() => {
    leaveRef.current = { dirty: () => form.dirty, save, discard: form.finish }
    return () => { leaveRef.current = null }
  })
  useEffect(() => {
    const clickOutside = event => { if (menu.current?.open && !menu.current.contains(event.target)) menu.current.open = false }
    document.addEventListener('click', clickOutside)
    return () => document.removeEventListener('click', clickOutside)
  }, [])

  const move = async () => {
    if (busy || !reason.trim()) return
    const res = await act('issue/move', { ...item, to: reasonMove, reason: reason.trim(), fileHash: task.hash })
    if (res?.ok) { setReasonMove(null); setReason(''); setReasonError(null) }
    else setReasonError(res)
  }
  const reasonTitle = reasonMove === 'cancelled' ? t('cancelReason') : terminal ? t('reopenReason') : t('returnReason')
  const confirm = async snapshot => {
    setReviewError(null)
    const res = await act('issue/confirm', { ...item, fileHash: snapshot.hash })
    if (res?.ok) setManualReview(null)
    else if (manualReview) setReviewError(res)
    if (res?.code === 'CONFLICT') {
      const refreshed = await reload()
      if (refreshed?.id === task.id) setManualReview(previous => previous && refreshed)
    }
  }
  const startWork = async () => {
    if (missing.length) { begin(missing[0]); return }
    const res = await start(task.id)
    if (res?.ok && res.data.started) setContinueSaved(false)
    if (res?.code === 'MISSING_START_FIELDS') await reload()
  }
  const continueWork = async event => {
    event.preventDefault()
    if (!continueText.trim() || !available || busy || assistRunning) return
    if (missing.length) { begin(missing[0]); return }
    const saved = await act('issue/continue', { ...item, text: continueText.trim(), fileHash: task.hash })
    if (!saved?.ok) return
    setContinueEditing(false); setContinueText(''); setContinueSaved(true)
    await startWork()
  }
  const saveSupplement = async event => {
    event.preventDefault()
    const value = supplement.trim()
    if (!value || busy) return
    const res = await act('issue/addUpdate', { ...item, text: '阻塞补充：' + value })
    if (res?.ok) { setSupplement(''); setSupplementing(false); setNotice(t('supplementSaved')) }
  }
  const beginMove = to => { setReason(''); setReasonError(null); setReasonMove(to) }
  const mayRecord = available && ['todo', 'doing', 'blocked'].includes(task.status)
  const menuAction = (label, onClick, danger = false) => h('button', {
    key: label, className: 'pw-button pw-quiet' + (danger ? ' danger' : ''), disabled: busy, onClick: () => {
      if (menu.current) {
        menu.current.open = false
        menu.current.querySelector('summary')?.focus()
      }
      onClick()
    },
  }, t(label))
  const menuItems = available && !form.editing ? [
    mayRecord && menuAction('recordTaskResult', () => setRecording(true)),
    mayRecord && hasResult && menuAction('submitTaskAcceptance', () => act('issue/move', { ...item, to: 'in_review', fileHash: task.hash })),
    mayRecord && hasResult && menuAction('manualConfirm', () => { setReviewError(null); setManualReview(task) }),
    ['doing', 'blocked', 'in_review'].includes(task.status) && menuAction('returnTodo', () => beginMove('todo')),
    !terminal && menuAction('cancelTask', () => beginMove('cancelled'), true),
    terminal && menuAction(task.status === 'done' ? 'reopenTaskAction' : 'restoreTask', () => beginMove('todo')),
  ].filter(Boolean) : []
  const more = menuItems.length > 0 && h('details', { className: 'pw-task-menu', ref: menu,
    onKeyDown: event => {
      if (event.key !== 'Escape' || !menu.current?.open) return
      event.stopPropagation()
      menu.current.open = false
      menu.current.querySelector('summary')?.focus()
    } },
  h('summary', { 'aria-label': t('moreActions'), title: t('moreActions') }, h('span', { 'aria-hidden': true }, '⋯')),
  h('div', { className: 'pw-task-menu-items' }, menuItems))
  const primary = (label, onClick, disabled = busy) =>
    h('button', { className: 'pw-button primary', disabled, onClick }, t(label))
  const quiet = (label, onClick, disabled = busy) =>
    h('button', { className: 'pw-button pw-quiet', disabled, onClick }, t(label))
  const row = (...actions) => h('div', { className: 'pw-task-action-row' }, actions)

  let action
  if (!terminal && (runView.waiting || runView.running)) {
    action = row(primary(runView.action, showConversation))
  } else if (available && task.status === 'in_review') {
    action = h('div', { className: 'pw-review-actions' },
      row(primary('demoConfirm', () => confirm(task), !reviewable),
        h('div', { className: 'pw-review-options' },
          quiet('reviseTask', () => setContinueEditing(value => !value), busy || assistRunning),
          quiet('deferDecision', () => { setContinueEditing(false); setNotice(t('deferred')) }))),
      continueEditing && h('form', { className: 'pw-progress-form', onSubmit: continueWork },
        h('textarea', { className: 'pw-textarea', rows: 3, autoFocus: true, 'aria-label': t('askFix'), placeholder: t('askFix'), value: continueText, onChange: event => setContinueText(event.target.value) }),
        h('button', { type: 'submit', className: 'pw-button', disabled: busy || assistRunning || !continueText.trim() }, t('submitAndContinue'))))
  } else if (available && task.status === 'blocked') {
    action = h(React.Fragment, null,
      row(primary('supplement', () => setSupplementing(value => !value)),
        quiet(missing.length ? 'completeTaskInfo' : 'demoContinue', startWork)),
      supplementing && h('form', { className: 'pw-progress-form', onSubmit: saveSupplement },
        h('textarea', { className: 'pw-textarea', autoFocus: true, rows: 3, 'aria-label': t('supplement'), placeholder: t('supplementPlaceholder'), value: supplement, onChange: event => setSupplement(event.target.value) }),
        h('button', { type: 'submit', className: 'pw-button', disabled: busy || !supplement.trim() }, t('saveSupplement'))))
  } else if (available && ['todo', 'doing'].includes(task.status)) {
    action = row(primary(missing.length ? 'completeTaskInfo' : task.status === 'todo' ? 'startTask' : 'demoContinue', startWork))
  }

  // Keep an open manual delivery draft mounted across a background status
  // refresh; replacing it with the delivery view would discard the input.
  const activeDelivery = !!deliveryReq && (deliveryReq.status === 'pending' || (deliveryReq.status === 'in_progress' && delivery?.status === 'failed') || deliveryDraftDirty)
  return h(React.Fragment, null,
    toolbar(more, true), notices,
    h('section', { className: 'pw-subpage pw-read-card pw-sidebar-detail', 'aria-label': t('issueDetail') },
      h('header', { className: 'pw-sidebar-heading' },
        h('div', { className: 'pw-sidebar-title' },
          h('h2', null, task.title),
          !terminal && !form.editing && quiet('edit', () => begin())),
        h('div', { className: 'pw-sidebar-meta' },
          h('span', { className: 'pw-count pw-read-status', 'data-status': task.status }, t('st_' + task.status)),
          req && h('button', { className: 'pw-button pw-quiet pw-parent-link', onClick: () => openRequirement(req.id, req.status) },
            t('parentRequirement'), ' · ', req.title)),
        runView.locked && h('p', { className: 'pw-note', role: 'status' }, t(runView.description))),
      form.updateAvailable && h('div', { className: 'pw-banner pw-warn', role: 'alert' },
        h('span', null, t('newAiUpdate')),
        quiet('keepMyDraft', form.keepUpdate), quiet('loadNewContent', () => { setFormError(null); form.loadUpdate() })),
      notice && h('p', { className: 'pw-note', role: 'status' }, notice),
      continueSaved && h('p', { className: 'pw-text pw-error', role: 'alert' }, t('continueSaved')),
      form.editing && !terminal ? h(React.Fragment, null,
        h(TaskForm, { form: { ...form, change: (...args) => { setFormError(null); form.change(...args) } }, t, busy, focus: formFocus, error: formError,
          onSave: save, onCancel: () => form.dirty ? guardLeave(() => {}) : form.finish() }),
        available && missing.length > 0 && quiet(busy ? 'drafting' : 'aiTaskDraft', () => act('issue/draft', { ...item, sessionId })))
        : h(React.Fragment, null,
          inactive && h('p', { className: 'pw-note' }, t(req?.pendingReopen ? 'errReopenPending' : 'errNotActive')),
          h(TaskReading, { task, requirement: deliveryReq, since: taskSince, t, sidebar: true, openWikiPage: path => openWikiPage(task.reqId, path),
            resultActions: task.status === 'in_review' ? h(React.Fragment, null,
              !inactive && h(AcceptanceAssist, { req, issue: task, root, sessionId, t, busy: busy || !available,
                memory: uiMemory, onRunningChange: setAssistRunning, compact: true }),
              action) : null },
          !terminal && task.status !== 'in_review' && missingText && !runView.locked && h('p', { className: 'pw-note' }, missingText),
          task.status !== 'in_review' && action,
          linkState?.link?.unrecorded && h('p', { className: 'pw-note' }, t('demoUnrecorded'))),
          externalUpdate && h('p', { className: 'pw-note', role: 'status' }, t('aiUpdated')),
          activeDelivery && h(Disclosure, { label: t('requirementDelivery') },
            deliveryReq.status === 'pending' && !deliveryDraftDirty ? h(DeliveryResult, { req: deliveryReq, t, compact: true, userFacing: true })
              : h(React.Fragment, null, deliveryReq.status === 'in_progress' && delivery?.status === 'failed' && h('p', { className: 'pw-error' }, t('demoDeliveryFailed')),
                h(ManualDelivery, { key: root + '|' + deliveryReq.id, req: deliveryReq, t, act, root, busy, userFacing: true,
                  onDraftChange: setDeliveryDraftDirty, draftMemory: uiMemory.drafts, draftKey: deliveryDraftKey })))),
      !terminal && proposals.length > 0 && h(Disclosure, { label: t('demoDrafts') },
        h(DraftSuggestions, { proposals, act, root, t, busy: busy || form.dirty, dismissMethod: 'proposal/dismiss', showHeading: false })),
      h('div', { hidden: form.editing && !terminal },
        h(UpdateLog, { activity: task.activity, t, onAdd: !terminal && !inactive ? text => act('issue/addUpdate', { ...item, text: '人工操作：' + text }) : undefined,
          userFacing: true, timeline: true, openWikiPage: path => openWikiPage(task.reqId, path) }))),
    recording && h(TaskResultForm, { task, since: taskSince, t, busy, onClose: () => setRecording(false),
      onSave: params => available ? act('issue/update', { ...item, ...params }) : { ok: false, code: 'RUNNING' } }),
    manualReview && h(Modal, { title: t('confirmIssueTitle'), wide: true, onClose: () => { if (!busy) setManualReview(null) }, actions: [
      quiet('cancel', () => setManualReview(null)),
      primary('demoConfirm', () => confirm(manualReview), !reviewable || !taskResult(manualReview, taskSince).summary),
    ] }, h(TaskResult, { task: manualReview, since: taskSince, t, userFacing: true }), h(ErrorDetails, { error: reviewError, t, showRaw: false })),
    reasonMove && h(Modal, { title: reasonTitle, onClose: () => { if (!busy) setReasonMove(null) }, actions: [
      quiet('cancel', () => setReasonMove(null)),
      primary('ok', move, busy || !reason.trim()),
    ] }, h('textarea', { className: 'pw-textarea', autoFocus: true, rows: 3, value: reason,
      'aria-label': reasonTitle, onChange: event => { setReason(event.target.value); setReasonError(null) } }),
    h(ErrorDetails, { error: reasonError, t, showRaw: false })))
}
