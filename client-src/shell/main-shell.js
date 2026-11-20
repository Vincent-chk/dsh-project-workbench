import React from 'react'
import { changesReviewedRequirement, startBlockers } from '../../core/state.js'
import { rpc } from '../api.js'
import { projectIdOf, reqDraftKey, issueDraftKey, reqDraftFrom, issueDraftFrom, taskContentPatch, taskFormError, freshRead, classifyProject, deliveryFingerprint } from '../project-state.js'
import { workbenchError } from '../workbench-content.js'
import { ErrorDetails, LeaveModal } from '../shared/ui.js'
import { ReasonModal } from '../shared/modals.js'
import { MENU, MOVES, ISSUE_MOVES, normalizeViewState, defaultViewState, openDetail, backOf, withFilter, filterOf, statusPage, reorderPlan, continueReorder, sortedTasks, awaitingAuthDetails, snapshotAuthStatus, homeDuringAuthRefresh } from './nav-state.js'
import { reviewRecords } from '../workbench-content.js'
import { HomePage } from '../pages/home.js'
import { PoolPage, ReviewPage, ReadyPage } from '../pages/requirements.js'
import { DevPage, BlockedPage } from '../pages/development.js'
import { BoardPage } from '../pages/board.js'
import { PendingPage, RecordsPage } from '../pages/acceptance.js'
import { WikiView, ArchView } from '../pages/resources.js'
import { PrdDocuments, PrdManagement, PrdReader, notifyPrdChanged, prdCss } from '../pages/prds.js'
import { PrdEditor } from '../forms/prd-form.js'
import { SyncView } from '../pages/sync.js'
import { DetailPanel } from '../detail/requirement-detail.js'
import { IssueDetail } from '../detail/task-detail.js'
import { RecordDetail } from '../detail/acceptance-detail.js'
import { requirementFormError } from '../forms/requirement-form.js'

const h = React.createElement
const { useCallback, useEffect, useRef, useState } = React
const EMPTY_WORKSPACES = []
const useNoWorkspaces = selector => selector({ items: EMPTY_WORKSPACES })
const useNoSessionStatus = () => undefined
const baseName = p => String(p ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
// Fallback when the workspace registry is unavailable: one entry per project folder seen in sessions.
const foldersFromSessions = byId => {
  const seen = new Set()
  const out = []
  for (const row of Object.values(byId ?? {})) {
    if (!row?.cwd || row.origin === 'subagent' || seen.has(row.cwd)) continue
    seen.add(row.cwd)
    out.push({ workspaceId: 'folder:' + row.cwd, path: row.cwd, title: baseName(row.cwd), sessionIds: [row.id] })
  }
  return out
}
const emptyRequirementDraft = reqDraftFrom({})
const diagnosticLabels = new Map([
  ['WORKSPACE_MISSING', 'diagWorkspace'], ['READ_FAILED', 'diagUnreadable'], ['SCHEMA_TOO_NEW', 'diagVersion'],
  ['ABSOLUTE_REF', 'diagReference'], ['BLOCKED_REASON_REQUIRED', 'diagBlocked'], ['TOO_MANY_ISSUES', 'diagLarge'],
])
const diagListView = (diags, t) => {
  const labels = new Set(diags.map(d => diagnosticLabels.get(d.code) ?? 'diagInconsistent'))
  return h('ul', { className: 'pw-diaglist' }, Array.from(labels, label => h('li', { key: label }, t(label))))
}
const PAGE_COMPONENTS = { home: HomePage, pool: PoolPage, review: ReviewPage, ready: ReadyPage, dev: DevPage, blocked: BlockedPage, board: BoardPage, pending: PendingPage, records: RecordsPage }
const pageLabel = page => ({ home: 'navHome', pool: 'navPool', review: 'navReview', ready: 'navReady', dev: 'navDev', blocked: 'navBlocked', board: 'navBoard', pending: 'navPending', records: 'navRecords', wiki: 'navWiki', arch: 'navArch', prds: 'navPrds', sync: 'viewSync' }[page] ?? 'navHome')

// 主工作台：全局入口 + 项目选择 + 内部菜单 + 内容区。入口不检查当前会话、
// root 或项目初始化；浏览状态保存在插件实例内存，按项目隔离（技术方案 §8）。
export function MainShell(props) {
  const { t, useCurrentSession, useSessions, useWorkspaces, useSessionStatus, uiMemory, css, showConversation, enterSession, renderFactorySlot } = props
  const sessionId = useCurrentSession(v => v)
  const session = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId])
  const sessionRoot = session?.cwd
  const sessionIndex = useSessions(s => s?.byId ?? {})
  const sessionStatus = (useSessionStatus ?? useNoSessionStatus)(s => s)
  const sessionStatusRef = useRef(sessionStatus)
  sessionStatusRef.current = sessionStatus
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const useWorkspaceList = useWorkspaces ?? useNoWorkspaces
  const workspaces = useWorkspaceList(s => s?.items ?? EMPTY_WORKSPACES) ?? EMPTY_WORKSPACES
  const workspaceOptions = useWorkspaces ? workspaces : foldersFromSessions(sessionIndex)

  // Project identity is the DSH workspace id; its directory resolves from the live registry.
  const [picked, setPicked] = useState(() => uiMemory.picked ?? null)
  const pickedWorkspace = picked?.id ? workspaces.find(w => w.workspaceId === picked.id) : undefined
  const removedWorkspace = !!picked?.id && !pickedWorkspace
  const root = picked?.id ? pickedWorkspace?.path : picked?.path
  const currentWorkspace = pickedWorkspace
  const wsTitle = currentWorkspace?.title || baseName(root) || t('title')
  const projectKey = picked?.id ? 'id:' + picked.id : (root ? 'path:' + root : '')
  const prevKey = useRef(projectKey)
  const keyChanged = prevKey.current !== projectKey
  prevKey.current = projectKey
  const rootRef = useRef(root)
  const rootChanged = rootRef.current !== root
  rootRef.current = root

  const [nav, setNav] = useState(() => normalizeViewState(uiMemory.views[projectKey]))
  const navRef = useRef(nav)
  navRef.current = nav
  const lastWritten = useRef(uiMemory.views[projectKey])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [home, setHome] = useState(null)
  const [homeError, setHomeError] = useState(null)
  const [runFacts, setRunFacts] = useState(null)
  const [runError, setRunError] = useState(null)
  const runAuthSnapshot = useRef(null)
  const [blocked, setBlocked] = useState({ proposals: null, deliveryFailed: [] })
  const [modal, setModal] = useState(null)
  const modalRef = useRef(modal)
  modalRef.current = modal
  const [saving, setSaving] = useState(false)
  const reorderMemory = uiMemory.reorders ??= {}
  const [, setReorderRevision] = useState(0)
  const pendingReorder = reorderMemory[projectKey]
  const [focusTarget, setFocusTarget] = useState('')
  const contentRef = useRef(null)
  const [editFocus, setEditFocus] = useState(null)
  const [undo, setUndo] = useState(null)
  const [git, setGit] = useState(null)
  const [wsMenu, setWsMenu] = useState(false)
  const wsAnchor = useRef(null)
  const [newDraft, setNewDraft] = useState(() => uiMemory.newRequirements[projectKey] ?? emptyRequirementDraft)
  const [detailDirty, setDetailDirty] = useState(false)
  const listSeq = useRef(0)
  const gitSeq = useRef(0)
  const homeSeq = useRef(0)
  const blockedSeq = useRef(0)
  const runSeq = useRef(0)
  const runFactsRef = useRef(null)
  if (keyChanged || rootChanged) runFactsRef.current = null
  const homeStamp = useRef(null)
  const homeAuthSnapshot = useRef(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const initialized = !!(data && data.project)

  // ---- reads: a response may paint only its own project, newest request wins ----
  const refresh = useCallback(async () => {
    const requested = root
    if (!requested) return
    const seq = ++listSeq.current
    const res = await rpc('requirement/list', { root: requested })
    if (!freshRead(rootRef.current, requested, listSeq.current, seq)) return
    if (res.ok) { setData(res.data); setError('') }
    else if (res.code === 'NOT_INITIALIZED') {
      setData({ project: null, requirements: [], diagnostics: [{ path: '.project/project.md', code: 'NOT_INITIALIZED', message: res.message ?? 'not initialized' }] })
      setError('')
    } else setError(res) // keep available content; the banner offers retry
  }, [root])

  const refreshGit = useCallback(async () => {
    const requested = root
    if (!requested) return
    const seq = ++gitSeq.current
    const res = await rpc('project/gitStatus', { root: requested })
    if (!freshRead(rootRef.current, requested, gitSeq.current, seq)) return
    setGit(res.ok ? res.data : { available: false })
  }, [root])

  const authIdentityOf = (facts, statuses) => JSON.stringify([...awaitingAuthDetails(facts, statuses)]
    .map(([issueId, detail]) => [issueId, detail.identity]))
  const authDetailsOf = facts => {
    const snapshot = runAuthSnapshot.current
    const safe = !runError && snapshot?.facts === facts && snapshot.identity === authIdentityOf(facts, sessionStatus)
    return awaitingAuthDetails(safe ? facts : (facts ?? []).map(fact => ({ ...fact, approvalRequests: [] })), sessionStatus)
  }
  const awaitingAuthOf = facts => new Map([...authDetailsOf(facts)].map(([issueId, detail]) => [issueId, detail.sessionId]))
  const authStatusRevision = authIdentityOf(runFacts, sessionStatus)

  // Home summary stamp polling (10s, visible only). Runtime facts come from the
  // Host run list plus DSH session status; nothing is persisted (tech §9/§11).
  const refreshHome = useCallback(async ({ skipDataRefresh = false, authRetry = 0 } = {}) => {
    const requested = root
    if (!requested) return
    const seq = ++homeSeq.current
    const runRequest = ++runSeq.current
    const statusAtStart = snapshotAuthStatus(sessionStatusRef.current)
    const runsRes = await rpc('run/list', { root: requested })
    if (!freshRead(rootRef.current, requested, homeSeq.current, seq) || runRequest !== runSeq.current) return
    const facts = runsRes.ok ? runsRes.data.runs : (runFactsRef.current ?? [])
    // Cached run facts may preserve the reminder on a read failure, but cannot
    // prove the currently displayed request's start time.
    const authFacts = runsRes.ok ? facts : facts.map(fact => ({ ...fact, approvalRequests: [] }))
    const currentAuth = () => awaitingAuthDetails(authFacts, sessionStatusRef.current)
    const auth = awaitingAuthDetails(authFacts, statusAtStart)
    const identity = value => JSON.stringify([...value].map(([issueId, detail]) => [issueId, detail.identity]))
    const authIdentity = identity(auth)
    if (identity(currentAuth()) !== authIdentity) {
      if (mountedRef.current && rootRef.current === requested && navRef.current.page === 'home') {
        if (authRetry < 1) return refreshHome({ skipDataRefresh, authRetry: authRetry + 1 })
        setHomeError({ code: 'READ_FAILED', message: '授权状态持续变化，请重试读取' })
      }
      return
    }
    if (runsRes.ok) {
      runAuthSnapshot.current = { facts, identity: authIdentity }
      runFactsRef.current = facts; setRunFacts(facts); setRunError(null)
    } else { runAuthSnapshot.current = null; setRunError(runsRes) }
    const running = [...auth].map(([issueId, detail]) => ({ issueId, awaitingAuth: true,
      authAskedAt: detail.askedAt, authIdentity: detail.identity }))
    const res = await rpc('home/summary', { root: requested, running })
    if (!freshRead(rootRef.current, requested, homeSeq.current, seq) || runRequest !== runSeq.current) return
    if (identity(currentAuth()) !== authIdentity) {
      if (mountedRef.current && rootRef.current === requested && navRef.current.page === 'home') {
        if (authRetry < 1) return refreshHome({ skipDataRefresh, authRetry: authRetry + 1 })
        setHomeError({ code: 'READ_FAILED', message: '授权状态持续变化，请重试读取' })
      }
      return
    }
    if (!res.ok) { setHomeError(res); return }
    setHomeError(runsRes.ok ? null : runsRes)
    homeAuthSnapshot.current = { facts: authFacts, identity: authIdentity }
    setHome(res.data)
    const changed = homeStamp.current !== res.data.stamp
    homeStamp.current = res.data.stamp
    if (changed && !skipDataRefresh) await refresh()
  }, [root, refresh])

  const refreshBlocked = useCallback(async ({ authRetry = 0 } = {}) => {
    const requested = root
    if (!requested) return
    const seq = ++blockedSeq.current
    const runRequest = ++runSeq.current
    const statusAtStart = snapshotAuthStatus(sessionStatusRef.current)
    const [runsRes, propRes] = await Promise.all([rpc('run/list', { root: requested }), rpc('proposal/list', { root: requested })])
    if (!freshRead(rootRef.current, requested, blockedSeq.current, seq) || runRequest !== runSeq.current) return
    if (runsRes.ok) {
      const facts = runsRes.data.runs
      const identity = authIdentityOf(facts, statusAtStart)
      if (identity !== authIdentityOf(facts, sessionStatusRef.current)) {
        if (mountedRef.current && rootRef.current === requested && navRef.current.page === 'blocked') {
          if (authRetry < 1) return refreshBlocked({ authRetry: authRetry + 1 })
          runAuthSnapshot.current = null
          setRunError({ code: 'READ_FAILED', message: '授权状态持续变化，请重试读取' })
        }
        return
      }
      runAuthSnapshot.current = { facts, identity }
      runFactsRef.current = facts; setRunFacts(facts); setRunError(null)
    } else { runAuthSnapshot.current = null; setRunError(runsRes) }
    if (propRes.ok) setBlocked(prev => ({ ...prev, proposals: propRes.data.proposals }))
    // Delivery-summary failures: only requirements whose tasks all passed
    // could have an automatic submission in flight.
    const candidates = (dataRef.current?.requirements ?? []).filter(r => r.status === 'in_progress' && !r.pendingReopen &&
      (r.issues ?? []).length > 0 && r.issues.every(i => i.status === 'done'))
    const failed = []
    for (const req of candidates) {
      const res = await rpc('delivery/status', { root: requested, reqId: req.id })
      if (!freshRead(rootRef.current, requested, blockedSeq.current, seq)) return
      if (res.ok && res.data.job?.status === 'failed') failed.push({ reqId: req.id, title: req.title, at: Date.parse(res.data.job.endedAt ?? '') || 0 })
    }
    setBlocked(prev => ({ ...prev, deliveryFailed: failed }))
  }, [root])

  // Project switch restores that project's remembered page/detail/filters, then reads it.
  useEffect(() => {
    if (keyChanged || rootChanged) {
      setData(null); setError(''); setNotice(''); setHome(null); setHomeError(null); setRunFacts(null); setRunError(null)
      setBlocked({ proposals: null, deliveryFailed: [] }); setGit(null); setUndo(null); setModal(null)
      setSaving(false); setFocusTarget(''); setEditFocus(null); setDetailDirty(false)
      homeStamp.current = null
      const remembered = normalizeViewState(uiMemory.views[projectKey])
      lastWritten.current = uiMemory.views[projectKey]
      setNav(remembered)
      setNewDraft(uiMemory.newRequirements[projectKey] ?? emptyRequirementDraft)
    }
    refresh()
    refreshGit()
  }, [projectKey, refresh, refreshGit])

  // Re-entry refresh + page-specific loads. Uninitialized/failed projects do not
  // keep polling business data; the home interval below only runs when initialized.
  const page = nav.page
  useEffect(() => {
    if (!root) return
    if (page === 'home') refreshHome()
    else if (page === 'blocked') { refresh(); refreshBlocked() }
    else refresh()
  }, [page, projectKey, root, initialized])

  // A pending request may be replaced while the panel remains open. Refresh
  // immediately and discard an in-flight response for the previous request.
  useEffect(() => {
    if (!root || !initialized) return
    if (page === 'home') refreshHome()
    else if (page === 'blocked') refreshBlocked()
  }, [authStatusRevision])

  useEffect(() => {
    if (!root || !initialized || page !== 'home') return
    const timer = setInterval(() => { if (!document.hidden) refreshHome() }, 10000)
    return () => clearInterval(timer)
  }, [root, initialized, page, refreshHome])

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden || !rootRef.current) return
      refresh()
      if (navRef.current.page === 'home') refreshHome()
      if (navRef.current.page === 'blocked') refreshBlocked()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [refresh, refreshHome, refreshBlocked])

  // A sort can finish while the main panel is unmounted or another project is
  // selected. Notify whichever panel is now mounted to reread its own project.
  useEffect(() => {
    const changed = () => { setReorderRevision(n => n + 1); refresh() }
    window.addEventListener('pw-reorder-changed', changed)
    return () => window.removeEventListener('pw-reorder-changed', changed)
  }, [refresh])

  // Persist browsing state and drafts on the plugin instance (survives unmount).
  useEffect(() => {
    if (!projectKey || keyChanged || rootChanged) return
    uiMemory.views[projectKey] = nav
    lastWritten.current = nav
    uiMemory.newRequirements[projectKey] = newDraft
    uiMemory.picked = picked ? { id: picked.id, path: root } : null
  }, [projectKey, nav, newDraft, picked, root, keyChanged, rootChanged])

  // Explicit object entries from the right bar write uiMemory while this panel
  // may stay mounted; adopt external writes (normal return keeps our own state).
  useEffect(() => {
    const external = uiMemory.views[projectKey]
    if (external && external !== navRef.current && external !== lastWritten.current) {
      lastWritten.current = external
      setNav(normalizeViewState(external))
    }
  }, [uiMemory.views[projectKey], projectKey])
  useEffect(() => {
    const ext = uiMemory.picked
    if (ext && (ext.id !== picked?.id || ext.path !== picked?.path)) setPicked(ext)
  }, [uiMemory.picked])

  useEffect(() => {
    if (!wsMenu) return
    const close = () => setWsMenu(false)
    const onKey = e => { if (e.key === 'Escape') setWsMenu(false) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKey) }
  }, [wsMenu])

  useEffect(() => {
    if (!focusTarget || focusTarget.startsWith('pw-list-item-') || keyChanged || rootChanged) return
    document.getElementById(focusTarget)?.focus()
    setFocusTarget('')
  }, [focusTarget, keyChanged, rootChanged])

  // ---- writes ----
  const mutate = useCallback(async (method, input, { inlineError = false } = {}) => {
    const requested = root
    setSaving(true); setError('')
    const res = await rpc(method, input)
    if (rootRef.current !== requested) return res
    // A conflict must keep the stale base: refreshing would silently accept the external edit.
    if (res.code === 'CONFLICT') { setError(res); setSaving(false); return res }
    await refresh()
    if (rootRef.current !== requested) return res
    if (res.ok) {
      if (navRef.current.page === 'home') await refreshHome({ skipDataRefresh: true })
      if (navRef.current.page === 'blocked') await refreshBlocked()
    } else if (!inlineError) {
      if (method === 'requirement/move' || method === 'issue/move') {
        setModal({ kind: 'moveError', error: res, ...(res.code === 'REVIEW_PRD_REQUIRED' && { reqId: input.id }) })
      } else setError(res)
    }
    setSaving(false)
    return res
  }, [refresh, refreshHome, refreshBlocked, root])

  const requirements = data?.requirements ?? []
  const params = nav.params
  const selected = params?.reqId ? requirements.find(r => r.id === params.reqId) ?? null : null
  const selectedIssue = params?.issueId ? selected?.issues?.find(i => i.id === params.issueId) ?? null : null
  const selectedRecord = params?.record ? (() => {
    const req = requirements.find(r => r.id === params.record.reqId)
    if (!req) return null
    return reviewRecords(req.reviews).find(r => r.kind === 'acceptance' &&
      (params.record.marker ? r.marker === params.record.marker : String(r.round) === String(params.record.round))) ?? null
  })() : null
  const missingReturn = backOf(nav)
  const missingReturnLabel = !missingReturn.params
    ? t('backToPage').replace('{page}', t(pageLabel(missingReturn.page)))
    : (selected && missingReturn.params.reqId === selected.id && !missingReturn.params.issueId && !missingReturn.params.record)
        ? t('backToTasks') : t('backToPrevious')

  // ---- navigation (workbench-owned moves offer the unsaved prompt first) ----
  const writeNav = next => { lastWritten.current = next; if (projectKey) uiMemory.views[projectKey] = next; setNav(next) }
  const minorDirty = Object.values(newDraft).some(value => value.trim())
  const hasUnsaved = minorDirty || detailDirty
  const clearNewDraft = () => { if (projectKey) delete uiMemory.newRequirements[projectKey]; setNewDraft(emptyRequirementDraft) }
  const clearDrafts = () => {
    if (!projectKey) return
    clearNewDraft()
    if (selected) delete uiMemory.drafts[reqDraftKey(projectKey, selected.id)]
    if (selected && selectedIssue) delete uiMemory.drafts[issueDraftKey(projectKey, selected.id, selectedIssue.id)]
    setDetailDirty(false)
  }
  const guardLeave = action => { if (hasUnsaved) setModal({ kind: 'leave', action }); else action() }
  const navigate = page => guardLeave(() => { setEditFocus(null); setFocusTarget(''); writeNav({ ...navRef.current, page, params: null, history: [] }) })
  const openDetailAt = (params, page) => guardLeave(() => writeNav(openDetail(navRef.current, params, page ?? navRef.current.page)))
  const openPrd = prdId => openDetailAt({ prdId }, 'prds')
  const editPrd = (id, reqId) => setModal({ kind: 'prdEditor', id, reqId })
  const locatePrdLink = reqId => guardLeave(() => {
    writeNav(openDetail(navRef.current, { reqId, issueId: null }, 'pool'))
    setFocusTarget('pw-prd-associations-' + reqId)
  })
  const back = () => guardLeave(() => {
    const cur = navRef.current
    const previous = backOf(cur)
    if (cur.params?.issueId && previous.params?.reqId === cur.params.reqId) {
      setFocusTarget('pw-task-' + cur.params.issueId)
    } else if (!previous.params) {
      const record = cur.params?.record
      const id = record ? record.reqId + '|' + (record.marker || record.round)
        : cur.params?.prdId || cur.params?.reqId
      setFocusTarget(id ? 'pw-list-item-' + id : '')
    }
    setEditFocus(null)
    writeNav(previous)
  })
  const backRef = useRef(back)
  backRef.current = back
  useEffect(() => {
    if (nav.params || !focusTarget?.startsWith('pw-list-item-') || !contentRef.current) return
    const restore = () => {
      const item = document.getElementById(focusTarget)
      if (!contentRef.current?.contains(item)) return false
      item.focus({ preventScroll: true })
      item.scrollIntoView({ block: 'nearest' })
      setFocusTarget('')
      return true
    }
    if (restore()) return
    const observer = new MutationObserver(() => { if (restore()) observer.disconnect() })
    observer.observe(contentRef.current, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [focusTarget, nav.params, nav.page, projectKey])
  const setFilter = (page, patch) => writeNav(withFilter(navRef.current, page, patch))

  const createReq = async (openAfter = false) => {
    const invalid = requirementFormError(newDraft)
    if (invalid) return invalid
    const { title, ...fields } = newDraft
    const res = await mutate('requirement/create', { root, title, fields }, { inlineError: true })
    if (res.ok && rootRef.current === root) {
      clearNewDraft()
      if (openAfter) writeNav(openDetail(navRef.current, { reqId: res.data.id, issueId: null }, 'pool'))
    }
    return res
  }
  // 需求草稿保存：reason 非空时携带重审确认（“保存后离开”与普通保存同一路径）。
  const saveRequirementDraft = async ({ reason } = {}) => {
    const key = reqDraftKey(projectKey, selected.id)
    const draft = uiMemory.drafts[key]
    if (!draft) return null
    const invalid = requirementFormError(draft.fields)
    if (invalid) return invalid
    const res = await mutate('requirement/update', {
      root, id: selected.id, patch: draft.fields, fileHash: draft.fileHash,
      ...(reason != null ? { confirmReviewInvalid: true, reason } : {}),
    }, { inlineError: true })
    if (res.ok) { delete uiMemory.drafts[key]; setDetailDirty(false) }
    return res
  }
  const leaveNeedsReview = () => {
    if (!detailDirty || !selected || selectedIssue) return null
    const draft = uiMemory.drafts[reqDraftKey(projectKey, selected.id)]
    if (!draft) return null
    return ['ready', 'in_progress'].includes(selected.status) && changesReviewedRequirement(selected, draft.fields) ? draft : null
  }
  const saveUnsaved = async () => {
    if (minorDirty) {
      const res = await createReq()
      if (!res.ok) return res
    }
    if (detailDirty && selected && selectedIssue) {
      const key = issueDraftKey(projectKey, selected.id, selectedIssue.id)
      const draft = uiMemory.drafts[key]
      if (!draft) return null
      const invalid = taskFormError(draft.fields)
      if (invalid) return invalid
      const patch = taskContentPatch(draft.fields, selectedIssue)
      if (Object.keys(patch).length || draft.fileHash !== selectedIssue.hash) {
        const res = await mutate('issue/update', { root, reqId: selected.id, id: selectedIssue.id, patch, fileHash: draft.fileHash })
        if (!res.ok) return res
      }
      delete uiMemory.drafts[key]; setDetailDirty(false)
    } else if (detailDirty && selected) {
      const res = await saveRequirementDraft()
      if (res && !res.ok) return res
    }
    return null
  }

  const pickProject = w => {
    const next = { id: projectIdOf(w), path: w.path }
    guardLeave(() => { uiMemory.picked = next; setPicked(next) })
  }
  const locateBoard = req => guardLeave(() => {
    let next = { ...navRef.current, page: 'board', params: null, history: [] }
    if (!req) { writeNav(withFilter(next, 'board', { cursor: null })); return }
    next = withFilter(next, 'board', { cursor: req.id, ...(req.status === 'completed' ? { showCompleted: true } : {}) })
    const query = filterOf(next, 'board').query ?? ''
    if (query && !req.title.toLowerCase().includes(query.toLowerCase())) next = withFilter(next, 'board', { query: '' })
    setFocusTarget('pw-board-' + req.id)
    writeNav(next)
  })
  const locateTask = (reqId, issueId) => guardLeave(() => {
    const req = requirements.find(r => r.id === reqId)
    if (!req || !req.issues?.some(i => i.id === issueId)) { setError({ code: 'NOT_FOUND' }); return }
    setFocusTarget('pw-task-' + issueId)
    writeNav(openDetail(navRef.current, { reqId, issueId: null }, statusPage(req.status)))
  })
  const locateProposal = ({ reqId, issueId, split }) => {
    const req = requirements.find(r => r.id === reqId)
    if (!req || (issueId && !req.issues?.some(i => i.id === issueId))) { setError({ code: 'NOT_FOUND' }); return }
    if (split) guardLeave(() => {
      setFocusTarget('pw-suggest-' + reqId)
      writeNav(openDetail(navRef.current, { reqId, issueId: null }, req.status === 'in_progress' ? 'dev' : 'board'))
    })
    else if (issueId) locateTask(reqId, issueId)
    else locateBoard(req)
  }

  // 查看/去确认/去处理：只定位并打开会话与右栏，不提交处理请求（PRD §9.2）。
  const openTaskSession = (issueId, sessionId = null) => guardLeave(async () => {
    const requested = root
    const res = await rpc('task/locate', { root: requested, issueId, ...(sessionId ? { sessionId } : {}) })
    if (rootRef.current !== requested) return
    if (res.ok) await enterSession(res.data.sessionId)
    else setError(res)
  })
  // 开始/继续处理：补齐检查 → 定位 → run/start（一次请求）→ 进入会话与右栏。
  const startTask = (reqId, issueId) => guardLeave(async () => {
    const requested = root
    const req = dataRef.current?.requirements.find(r => r.id === reqId)
    const issue = req?.issues?.find(i => i.id === issueId)
    if (!issue) { setError({ code: 'NOT_FOUND' }); return }
    const missing = startBlockers(issue)
    if (missing.length) {
      setEditFocus(missing[0])
      writeNav(openDetail(navRef.current, { reqId, issueId }, 'dev'))
      return
    }
    const located = await rpc('task/locate', { root: requested, issueId })
    if (rootRef.current !== requested) return
    if (!located.ok) { setError(located); return }
    const res = await rpc('run/start', { root: requested, issueId, sessionId: located.data.sessionId })
    if (rootRef.current !== requested) return
    if (!res.ok) { setError(res); return }
    const d = res.data
    if (d.busy) setError({ code: 'SESSION_BUSY' })
    else if (d.uncertain || d.alreadyStarting) setNotice(t('runUncertain'))
    else if (d.alreadyRunning) setNotice(t('runAlready'))
    else if (d.started) setNotice(t('runSubmitted'))
    await enterSession(located.data.sessionId)
    refresh()
  })

  const doMove = useCallback((req, to) => {
    if (saving || modal || to === req.status) return
    if (req.pendingReopen) { setModal({ kind: 'reopenRequirement', req }); return }
    const kind = MOVES[req.status]?.[to]
    if (!kind) { setModal({ kind: 'moveError', error: { code: 'ILLEGAL_TRANSITION' } }); return }
    const submit = (reason, inlineError, extra) => mutate('requirement/move', { root, id: req.id, to, reason, fileHash: req.hash, ...extra }, { inlineError })
    if (kind === 'move') return submit()
    if (kind === 'reason') { setModal({ kind, title: t('returnReview'), onOk: reason => submit(reason, true) }); return }
    if (kind === 'confirmComplete') {
      // 验收通过绑定用户核对时的需求与任务内容；期间任何变化都会以
      // ROUND_CHANGED 拒绝，刷新后必须在新内容上重新确认。
      setModal({ kind, req, onOk: async reviewed => {
        return submit(undefined, true, { fileHash: reviewed.hash, expectFingerprint: await deliveryFingerprint(reviewed) })
      } })
      return
    }
    setModal({ kind, req, onOk: () => submit(undefined, true) })
  }, [mutate, root, t, saving, modal])

  const moveIssue = (req, issue, to, triggerId) => {
    const label = ISSUE_MOVES[issue.status]?.[to]
    const rejecting = issue.status === 'in_review' && to === 'doing'
    if ((!label && !rejecting) || req.status !== 'in_progress' || req.pendingReopen || saving || modal) return
    const item = { root, reqId: req.id, id: issue.id, fileHash: issue.hash }
    if (to === 'done' || rejecting) {
      const restoreFocus = triggerId && (saved => {
        if (rootRef.current === root && navRef.current.params?.issueId === issue.id) {
          setFocusTarget(saved ? (rejecting ? 'pw-task-rework' : 'pw-task-title') : triggerId)
        }
      })
      setModal({ kind: rejecting ? 'rejectTaskAcceptance' : 'confirmIssue', issue, req, reqId: req.id, restoreFocus })
      return
    }
    setModal({ kind: 'reason', title: t(label), body: issue.title, onOk: value => mutate('issue/move', {
      ...item, to, ...(to === 'blocked' ? { blockedReason: value } : { reason: value }),
    }, { inlineError: true }) })
  }

  // A normalisation may need several writes. Retain its exact remaining plan
  // in the plugin instance so a failure or panel switch cannot silently leave
  // a half-finished sort or accidentally start a different one.
  const resumeReorder = async operation => {
    if (!operation || operation.running) return
    operation.running = true
    setReorderRevision(n => n + 1)
    if (rootRef.current === operation.root) setSaving(true)
    try {
      await continueReorder(operation, {
        read: async () => {
          const result = await rpc('requirement/list', { root: operation.root })
          if (!result.ok) return result
          const requirements = result.data.requirements ?? []
          const items = operation.kind === 'requirement' ? requirements
            : requirements.find(req => req.id === operation.reqId)?.issues ?? []
          return { ok: true, items }
        },
        write: step => rpc(operation.kind === 'requirement' ? 'requirement/update' : 'issue/update', operation.kind === 'requirement'
          ? { root: operation.root, id: step.id, patch: { order: step.order }, fileHash: step.hash }
          : { root: operation.root, reqId: operation.reqId, id: step.id, patch: { order: step.order }, fileHash: step.hash }),
        progress: () => setReorderRevision(n => n + 1),
      })
    } catch {
      operation.error = { code: 'TRANSPORT_ERROR' }
    }
    operation.running = false
    if (!operation.error) delete reorderMemory[operation.projectKey]
    if (rootRef.current === operation.root) setSaving(false)
    window.dispatchEvent(new Event('pw-reorder-changed'))
  }
  const reorder = (kind, reqId, list, id, direction) => {
    const plan = reorderPlan(list, id, direction)
    if (!plan.length || saving || reorderMemory[projectKey]) return
    const operation = { root, projectKey, kind, reqId, next: 0, error: null, running: false,
      before: list.map(item => ({ id: item.id, order: item.order })),
      steps: plan.map(step => ({ ...step, hash: list.find(item => item.id === step.id)?.hash })) }
    reorderMemory[projectKey] = operation
    void resumeReorder(operation)
  }

  const trashWithUndo = useCallback(async (kind, id, reqId, label) => {
    const requested = root
    const res = await rpc('project/trash', { root, kind, id, reqId })
    if (rootRef.current !== requested) return
    if (res.ok) { setUndo({ location: res.data.location, label }); if (kind === 'requirement') writeNav({ ...navRef.current, params: null, history: [] }); await refresh() }
    else setError(res)
  }, [root, refresh])
  const doUndo = useCallback(async () => {
    if (!undo) return
    const requested = root
    const res = await rpc('project/restore', { root, location: undo.location })
    if (rootRef.current !== requested) return
    setUndo(null)
    if (!res.ok) setError(res)
    await refresh()
  }, [undo, root, refresh])
  const doCommit = useCallback(async () => {
    const requested = root
    const res = await rpc('project/gitCommit', { root: requested })
    if (rootRef.current !== requested) return
    if (!res.ok) setError(res)
    await refreshGit()
  }, [root, refreshGit])
  const enableProject = async () => {
    const requested = root
    const res = await rpc('project/init', { root: requested, name: wsTitle })
    if (rootRef.current !== requested) return
    if (!res.ok) { setError(res); return }
    await refresh()
    if (rootRef.current !== requested) return
    writeNav(defaultViewState()) // 成功后进入该项目首页
    setNotice(t('workbenchHint'))
  }

  // Esc backs out of a detail; the board keeps its own N/J/K/H/L handling.
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || e.defaultPrevented || modalRef.current || wsMenu) return
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
      if (navRef.current.params) {
        e.preventDefault()
        backRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wsMenu])

  const homeSnapshot = homeAuthSnapshot.current
  const staleHomeAuth = !!home && !!homeSnapshot && homeSnapshot.identity !== authIdentityOf(homeSnapshot.facts, sessionStatus)
  const visibleHome = homeDuringAuthRefresh(home, staleHomeAuth)
  const wb = {
    t, root, projectKey, uiMemory, requirements, data, error, saving: saving || !!pendingReorder, nav,
    setFilter, navigate, openDetail: openDetailAt, back, locateBoard, locateTask,
    mutate, refresh, doMove, moveIssue, setModal, modal, reorder,
    openTaskSession, startTask, runFacts, runError, awaitingAuthSessions: awaitingAuthOf(runFacts), authDetails: authDetailsOf(runFacts),
    home: visibleHome, homeError, refreshHome, refreshBlocked, blocked, setFocusTarget,
  }

  // ---- chrome: project switch stays available in every content state ----
  const titles = workspaceOptions.map(w => w.title)
  const dupTitles = new Set(titles.filter((x, i) => titles.indexOf(x) !== i))
  const isCurrentProject = w => (picked?.id ? w.workspaceId === picked.id : w.path === root)
  const wsDropdown = wsMenu && h('div', { className: 'pw-ws-menu', role: 'menu', 'aria-label': t('switchWorkspace'), onClick: e => e.stopPropagation() },
    workspaceOptions.map(w => h('button', {
      key: w.workspaceId, role: 'menuitem',
      className: 'pw-ws-item' + (isCurrentProject(w) ? ' active' : ''),
      onClick: () => { setWsMenu(false); pickProject(w) },
    }, h('span', { className: 'pw-ws-check', 'aria-hidden': true }, isCurrentProject(w) ? '✓' : ''), w.title,
      dupTitles.has(w.title) && h('span', { className: 'pw-count' }, w.path))))
  // Prefer the DSH workspace.picker factory; fall back to the registry dropdown
  // when it is absent or the registry itself is unavailable (tech §8.6).
  const wsSwitch = workspaceOptions.length > 0 || picked || (renderFactorySlot && useWorkspaces)
    ? h('div', { className: 'pw-ws-switch', 'data-window-drag-exclude': true },
      h('button', {
        ref: wsAnchor, className: 'pw-ws-button', title: t('switchWorkspace'),
        'aria-haspopup': 'menu', 'aria-expanded': wsMenu,
        onClick: e => { e.stopPropagation(); setWsMenu(v => !v) },
      }, h('span', { className: 'pw-ws-name' }, wsTitle), h('span', { className: 'pw-ws-caret', 'aria-hidden': true }, '▾')),
      renderFactorySlot && useWorkspaces
        ? renderFactorySlot('workspace.picker', {
          open: wsMenu, anchorRef: wsAnchor, selectedId: picked?.id ?? undefined,
          onPick: id => { setWsMenu(false); pickProject(workspaces.find(x => x.workspaceId === id) ?? { workspaceId: id }) },
          onClose: () => setWsMenu(false),
        }, { fallback: wsDropdown })
        : wsDropdown)
    : h('h1', { className: 'pw-title' }, t('title'))

  const menuButton = item => h('button', {
    key: item.page, type: 'button', className: 'pw-menu-item',
    'aria-current': page === item.page ? 'page' : undefined,
    onClick: () => navigate(item.page),
  }, t(item.label))
  const menu = h('nav', { className: 'pw-menu', 'aria-label': t('title') },
    h('div', { className: 'pw-menu-primary' }, MENU.filter(entry => !entry.group).map(menuButton)),
    MENU.filter(entry => entry.group).map(entry =>
      h('div', { key: entry.group, className: 'pw-menu-group', role: 'group', 'aria-label': t(entry.group) },
        h('span', { className: 'pw-menu-grouptitle', 'aria-hidden': true }, t(entry.group)),
        entry.items.map(menuButton))))

  const topBar = h('div', { className: 'pw-top', 'data-window-drag': true },
    wsSwitch,
    h('div', { className: 'pw-spacer' }),
    initialized && h('button', { className: 'pw-button' + (page === 'sync' ? ' primary' : ''), onClick: () => navigate('sync') }, t('viewSync')),
    saving && h('span', { className: 'pw-count' }, t('saving')),
    initialized && git && (git.available
      ? h('button', { className: 'pw-button', onClick: doCommit, title: t('commit') },
        git.uncommitted > 0 ? `${t('commit')} · ${t('uncommitted').replace('{n}', String(git.uncommitted))}` : t('commit'))
      : h('span', { className: 'pw-count', title: t('gitUnavailable') }, t('gitUnavailable'))),
    h('button', { className: 'pw-button', onClick: () => guardLeave(showConversation) }, t('back')))

  const errorBanner = error && h('div', { className: 'pw-banner pw-error', role: 'alert' },
    h(ErrorDetails, { error, t, showRaw: false }),
    h('button', { className: 'pw-button', style: { marginLeft: 'auto' }, onClick: refresh }, t('retryRead')))

  const frame = content => h('main', { className: 'pw-page', 'aria-label': t('title') },
    h('style', null, css + prdCss), topBar,
    h('div', { className: 'pw-shell-body' }, menu, h('div', { className: 'pw-content', ref: contentRef }, content)))

  // No selection record yet: offer the registry; never auto-follow the session.
  if (!root) {
    return frame(h('div', { className: 'pw-init' },
      h('h2', null, t('chooseWorkspace')),
      h('p', { className: 'pw-note' }, removedWorkspace ? t('workspaceRemoved') : (workspaceOptions.length ? t('chooseWorkspaceHint') : t('noWorkspacesHint'))),
      !!workspaceOptions.length && h('div', { className: 'pw-workspace-list' }, workspaceOptions.map(w => h('button', {
        key: w.workspaceId, className: 'pw-workspace-card', onClick: () => pickProject(w),
      }, h('strong', null, w.title), h('span', { className: 'pw-count' }, w.path))))))
  }
  if (!data || keyChanged || rootChanged) {
    return frame(error
      ? h('div', { className: 'pw-init' }, h('h2', null, t('readFailedTitle')), h(ErrorDetails, { error, t, showRaw: false }),
        h('button', { className: 'pw-button primary', onClick: refresh }, t('retryRead')))
      : h('div', { className: 'pw-init' }, h('p', null, t('loading'))))
  }
  const { diags, readFailed } = classifyProject(data)
  if (readFailed) {
    return frame(h('div', { className: 'pw-init' },
      h('h2', null, t('readFailedTitle')), h('p', { className: 'pw-note' }, t('readFailedHint')),
      errorBanner, diagListView(diags, t),
      h('button', { className: 'pw-button primary', onClick: refresh }, t('retryRead'))))
  }
  if (!initialized) {
    return frame(h('div', { className: 'pw-init' },
      h('h2', null, t('initTitle')), h('p', { className: 'pw-note' }, t('initBody')),
      h('strong', null, wsTitle),
      h('p', { className: 'pw-note', style: { overflowWrap: 'anywhere' } }, root),
      errorBanner,
      h('button', { className: 'pw-button primary', onClick: enableProject }, t('initTitle'))))
  }

  // ---- content: detail overlay or the selected page ----
  const breadcrumbs = h('nav', { className: 'pw-breadcrumb', 'aria-label': 'Breadcrumb' },
    h('button', { className: 'pw-crumb', onClick: () => guardLeave(() => writeNav({ ...navRef.current, params: null, history: [] })) }, t(pageLabel(page))),
    selected && h(React.Fragment, null,
      h('span', { className: 'pw-crumb-sep' }, '/'),
      selectedIssue || (page === 'pending' && params?.reqId && !selectedRecord)
        ? h('button', { className: 'pw-crumb', onClick: back, title: selected.title }, t(page === 'pending' ? 'navPending' : 'backToTasks'))
        : h('span', { className: 'pw-crumb-current' }, selected.title)),
    selectedIssue && h(React.Fragment, null,
      h('span', { className: 'pw-crumb-sep' }, '/'),
      h('span', { className: 'pw-crumb-current' }, selectedIssue.title)),
    selectedRecord && h(React.Fragment, null,
      h('span', { className: 'pw-crumb-sep' }, '/'),
      h('span', { className: 'pw-crumb-current' }, t('recordDetail'))))

  const selectAssociatedPrd = prdId => {
    const view = navRef.current
    if (view.params?.reqId !== selected?.id) return
    writeNav({ ...view, params: { ...view.params, prdId, restorePrds: true } })
  }
  const closeAssociatedPrds = () => {
    const view = navRef.current
    if (view.params?.reqId !== selected?.id || !view.params?.prdId && !view.params?.restorePrds) return
    const { prdId, restorePrds, ...remaining } = view.params
    writeNav({ ...view, params: remaining })
  }
  const openAssociatedFull = prdId => {
    setFocusTarget(null)
    openDetailAt({ prdId, fromReading: true }, 'prds')
  }
  const prdReadingMemory = uiMemory.prdReading ??= {}
  const renderPrds = (onSummary, { readOnly, summaryOnly, manage } = {}) => h(PrdDocuments, {
    key: projectKey + ':' + selected.id, root, reqId: selected.id, requirements, t, onSummary, readOnly, summaryOnly,
    activeId: manage ? null : params?.prdId, onRead: selectAssociatedPrd, onOpenFull: openAssociatedFull,
    onEdit: editPrd, onNew: reqId => editPrd(undefined, reqId), readingMemory: prdReadingMemory,
  })
  let content
  if (page === 'prds' && params?.prdId) {
    content = h(PrdReader, { key: projectKey + ':' + params.prdId, root, id: params.prdId, requirements, t,
      onEdit: editPrd, onBack: back, backLabel: params.fromReading ? t('backToReading') : undefined, readingMemory: prdReadingMemory })
  } else if (params?.record) {
    content = selectedRecord
      ? h('div', { className: 'pw-subpage-stack' }, h(RecordDetail, {
        record: { ...selectedRecord, reqTitle: requirements.find(r => r.id === params.record.reqId)?.title ?? selectedRecord.reqTitle },
        req: requirements.find(r => r.id === params.record.reqId) ?? null, t,
        onOpenRequirement: req => openDetailAt({ reqId: req.id, issueId: null }, statusPage(req.status)),
      }))
      : h('div', { className: 'pw-init' }, h('p', null, t('errMissing')), h('button', { className: 'pw-button', onClick: back }, missingReturnLabel))
  } else if (params?.reqId && !selected) {
    content = h('div', { className: 'pw-init' }, h('p', null, t('errMissing')), h('button', { className: 'pw-button', onClick: back }, missingReturnLabel))
  } else if (params?.issueId && !selectedIssue) {
    content = h('div', { className: 'pw-init' }, h('p', null, t('errMissing')), h('button', { className: 'pw-button', onClick: back }, missingReturnLabel))
  } else if (selectedIssue) {
    content = h(IssueDetail, {
      key: projectKey + ':' + selectedIssue.id, issue: selectedIssue, req: selected, t, root, mutate,
      projectKey, rootRef, onDirty: setDetailDirty, busy: saving, uiMemory, editFocus,
      renderPrds, initialPrdId: params?.prdId, restorePrds: params?.restorePrds, onClosePrds: closeAssociatedPrds, modalActive: !!modal,
      runFact: (runFacts ?? []).find(f => f.issueId === selectedIssue.id) ?? null,
      openTask: openTaskSession, onStartTask: issueId => startTask(selected.id, issueId),
      onMoveIssue: (to, triggerId) => moveIssue(selected, selectedIssue, to, triggerId),
      openWikiPage: p => guardLeave(() => writeNav(openDetail(navRef.current, { wikiTarget: p }, 'wiki'))),
    })
  } else if (selected) {
    content = h(DetailPanel, {
      key: projectKey + ':' + selected.id, req: selected, t, root, mutate, moveIssue, projectKey, rootRef,
      initialPrdId: params?.prdId, restorePrds: params?.restorePrds, onClosePrds: closeAssociatedPrds, modalActive: !!modal,
      initialDelivery: page === 'pending' && selected.status === 'pending', focusTarget, renderPrds, onMove: doMove,
      onApprove: () => doMove(selected, 'ready'),
      onReject: () => doMove(selected, 'backlog'),
      onDirty: setDetailDirty, busy: saving || !!pendingReorder || !!modal, sessionId: sessionRoot === root ? sessionId : undefined, setModal, uiMemory,
      onDelete: () => setModal({ kind: 'delete', req: selected }),
      onOpenIssue: (id, focusAcceptance) => guardLeave(() => {
        if (focusAcceptance) setFocusTarget('pw-task-acceptance')
        writeNav(openDetail(navRef.current, { reqId: selected.id, issueId: id }))
      }),
      onReorderTask: (id, direction) => reorder('issue', selected.id, sortedTasks(selected.issues), id, direction),
      onStartTask: issueId => startTask(selected.id, issueId),
      onCreateTask: () => setModal({ kind: 'createTask', req: selected, onCreated: id => { if (rootRef.current === root) setFocusTarget('pw-task-' + id) } }),
    })
  } else if (page === 'prds') {
    content = h(PrdManagement, { key: projectKey, wb, onRead: openPrd, onEdit: editPrd })
  } else if (page === 'wiki') {
    content = h(WikiView, { key: root, root, sessionId: sessionRoot === root ? sessionId : undefined, t, uiMemory, target: params?.wikiTarget ?? null,
      onPageChange: path => writeNav({ ...navRef.current, params: path ? { wikiTarget: path } : null }) })
  } else if (page === 'arch') {
    content = h(ArchView, { key: root, root, sessionId: sessionRoot === root ? sessionId : undefined, t })
  } else if (page === 'sync') {
    content = h(SyncView, { key: projectKey, root, sessionId: sessionRoot === root ? sessionId : undefined, t, refresh, requirements, onLocateProposal: locateProposal })
  } else {
    const Page = PAGE_COMPONENTS[page] ?? HomePage
    content = h(Page, { wb })
  }

  return frame(h(React.Fragment, null,
    breadcrumbs,
    errorBanner,
    pendingReorder && h('div', { className: 'pw-banner pw-warn', role: 'status' },
      h('div', null,
        h('span', null, t('reorderProgress').replace('{done}', String(pendingReorder.next)).replace('{total}', String(pendingReorder.steps.length))),
        pendingReorder.error && h('p', null, t('reorderFailed')),
        pendingReorder.error && h(ErrorDetails, { error: pendingReorder.error, t, showRaw: false })),
      pendingReorder.error && h('button', { className: 'pw-button', disabled: pendingReorder.running, onClick: () => resumeReorder(pendingReorder) }, t('reorderRetry')),
      pendingReorder.error && h('button', { className: 'pw-button', disabled: pendingReorder.running, onClick: () => {
        delete reorderMemory[projectKey]; setReorderRevision(n => n + 1); refresh()
      } }, t('reorderDiscard'))),
    notice && h('div', { className: 'pw-banner', role: 'status' }, notice,
      h('button', { className: 'pw-button', style: { marginLeft: 'auto' }, onClick: () => setNotice(''), 'aria-label': t('dismiss') }, '✕')),
    diags.length > 0 && h('div', { className: 'pw-banner pw-warn', role: 'status' },
      h('div', { className: 'pw-diagwrap' },
        h('strong', null, t('dataProblems').replace('{n}', String(diags.length))),
        h('details', null, h('summary', null, t('details')), diagListView(diags, t))),
      h('button', { className: 'pw-button', style: { marginLeft: 'auto' }, onClick: refresh }, t('retryRead'))),
    undo && h('div', { className: 'pw-banner', role: 'status' }, t('trashed'),
      h('button', { className: 'pw-button', style: { marginLeft: 'auto' }, onClick: doUndo }, t('undo')),
      h('button', { className: 'pw-button', onClick: () => setUndo(null), 'aria-label': t('dismiss') }, '✕')),
    content,
    modal?.kind === 'prdEditor' && h(PrdEditor, {
      key: [root, modal.id, modal.reqId].join(':'), root, id: modal.id, reqId: modal.reqId, t, uiMemory,
      onClose: () => setModal(current => current === modal ? null : current),
      onSaved: () => {
        notifyPrdChanged(root)
        setModal(current => current === modal ? null : current)
      },
    }),
    modal && !['leave', 'prdEditor'].includes(modal.kind) && h(ReasonModal, {
      key: modal.kind, modal, t, setModal, mutate, root, trashWithUndo, requirements, locatePrdLink,
      newDraft, clearNewDraft,
      changeNewDraft: (name, value) => setNewDraft(draft => ({ ...draft, [name]: value })),
      createReq: () => createReq(true),
      reopenState: modal.kind === 'reopenRequirement' && requirements.find(req => req.id === modal.req.id)?.pendingReopen,
    }),
    modal?.kind === 'leave' && h(LeaveModal, {
      modal, t, busy: saving,
      onStay: () => setModal(null),
      onDiscard: () => { const action = modal.action; clearDrafts(); setModal(null); action() },
      onSave: async () => {
        // 已评审需求的实质修改：与表单普通保存一致，先明确确认重审并填写原因，
        // 保存成功后继续离开；输入在此之前始终保留。
        if (!minorDirty && leaveNeedsReview()) {
          const action = modal.action
          setModal({ kind: 'reason', title: t('confirmReviewEdit'), body: t('confirmReviewEditBody'),
            onOk: async reason => {
              const res = await saveRequirementDraft({ reason })
              if (res?.ok) action()
              return res
            } })
          return
        }
        const failed = await saveUnsaved()
        if (rootRef.current !== root) return
        if (failed) { setModal(m => (m && m.kind === 'leave' ? { ...m, error: workbenchError(failed, t).text } : m)); return }
        const action = modal.action; setModal(null); action()
      },
    })))
}
