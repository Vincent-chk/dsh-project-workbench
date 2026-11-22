import { PreparationActions } from '../preparation.js'
import React from 'react'
import { aiReviewReports, changesReviewedRequirement, requirementOverview } from '../../core/state.js'
import { rpc } from '../api.js'
import { DiscoveryRecords, useDiscoveryRecords } from '../discovery.js'
import { reqDraftKey, reqDraftFrom, issueDraftFrom, issueDraftKey, draftOf, sameDraft } from '../project-state.js'
import { isRequirementSplit, progressRecords, requirementLogEntries, requirementResult, reviewRecords } from '../workbench-content.js'
import { ISSUE_MOVES, sortedTasks } from '../shell/nav-state.js'
import { Disclosure, ErrorDetails, ReadText } from '../shared/ui.js'
import { DraftSuggestions } from './task-content.js'
import { RequirementDevelopment, RequirementOverview, RequirementReviewDecisions, RequirementDecisionRecords } from './requirement-content.js'
import { RequirementReview, RequirementReviewHistory } from './requirement-review.js'
import { RequirementDelivery } from './acceptance-detail.js'
import { RequirementLayout, savedRequirementOrder } from './requirement-layout.js'
import { RequirementLog } from './requirement-log.js'
import { RequirementFields, requirementFormError } from '../forms/requirement-form.js'
import { dateText } from '../shared/list.js'
import { ReadingLayout, ReadingLink } from '../shared/reading-drawer.js'

const h = React.createElement
const { useCallback, useEffect, useRef, useState } = React

// Drafts live in the plugin instance memory keyed by project + object, so an
// unmount (DSH sidebar switch) keeps the input and its original fingerprint.
export function useWorkItemDraft(draftKey, item, fieldsOf, onDirty, memory) {
  const [editing, setEditing] = useState(() => !!memory.drafts[draftKey])
  const [draft, setDraft] = useState(() => draftOf(memory.drafts, draftKey, fieldsOf(item)))
  const base = useRef({ fields: fieldsOf(item), fileHash: item.hash })
  useEffect(() => { onDirty?.(!!memory.drafts[draftKey]) }, [draftKey, onDirty])
  const begin = () => {
    base.current = { fields: fieldsOf(item), fileHash: item.hash }
    setDraft(base.current.fields)
    setEditing(true)
  }
  const change = (key, value) => {
    const next = { ...draft, [key]: value }
    const dirty = !sameDraft(next, base.current.fields)
    setDraft(next)
    if (dirty) memory.drafts[draftKey] = { fields: next, fileHash: memory.drafts[draftKey]?.fileHash ?? base.current.fileHash }
    else delete memory.drafts[draftKey]
    onDirty?.(dirty)
  }
  const finish = () => {
    delete memory.drafts[draftKey]
    setEditing(false)
    onDirty?.(false)
  }
  const params = () => ({ patch: draft, fileHash: memory.drafts[draftKey]?.fileHash ?? base.current.fileHash })
  return { editing, begin, finish, params, draft, change }
}

export function IssueStatusSelect({ req, issue, t, moveIssue, busy }) {
  const statusText = t('st_' + issue.status)
  const moves = Object.entries(ISSUE_MOVES[issue.status] ?? {})
  if (req.status !== 'in_progress' || req.pendingReopen || !moves.length) {
    return h('span', { className: 'pw-istatus st-' + issue.status }, statusText)
  }
  return h('select', {
    className: 'pw-select', value: issue.status, disabled: busy,
    'aria-label': `${issue.title} · ${statusText}`,
    onChange: e => moveIssue(req, issue, e.target.value),
  }, h('option', { value: issue.status, disabled: true }, statusText),
  moves.map(([status, label]) => h('option', { key: status, value: status }, t(label))))
}

const splitLabels = { verified: 'splitVerified', assigned: 'splitAssigned', gap: 'splitGap', unknown: 'splitUnknown' }

function TaskSuggestionReview({ review, req, t, onOpenIssue, hasDrafts, hasLegacy, pending, error, readError, reload, onReview, feedback, changeFeedback, refining, showFeedback }) {
  if (!review && !hasDrafts && !hasLegacy && !pending && !error && !readError && !refining) return null
  const items = review?.items ?? []
  const counts = Object.entries(splitLabels).flatMap(([status, label]) => {
    const count = items.filter(item => item.status === status).length
    return count ? [t(label) + ' ' + count] : []
  })
  const unresolved = items.find(item => item.status === 'gap') ?? items.find(item => item.status === 'unknown')
  const assigned = items.find(item => item.status === 'assigned' && item.needsWork && item.taskIds?.length) ??
    items.find(item => item.status === 'assigned' && item.taskIds?.length)
  const taskLinks = item => h('div', { className: 'pw-actions' }, item.taskIds?.map(id => {
    const task = req.issues?.find(task => task.id === id)
    if (!task) return null
    return h('button', { key: id, type: 'button', className: 'pw-button', onClick: () => onOpenIssue(id) },
      task.title, ' · ', t('st_' + task.status))
  }))
  return h('section', { className: 'pw-result', 'aria-label': t('splitReview'), 'aria-busy': pending },
    h('strong', null, t('splitReview')),
    pending && h('p', { className: 'pw-text', role: 'status' }, t('splitWorking')),
    counts.length > 0 && h('p', { className: 'pw-text' }, counts.join(' · ')),
    unresolved && h(React.Fragment, null,
      h(ReadText, { value: unresolved.detail, preview: true }),
      unresolved.taskIds?.length > 0 && taskLinks(unresolved)),
    assigned && h(React.Fragment, null,
      h(ReadText, { value: assigned.detail, preview: true }), taskLinks(assigned)),
    review?.question && h(ReadText, { value: review.question }),
    review && !hasDrafts && h('p', { className: 'pw-text' },
      t(items.length && !review.question && items.every(item => ['verified', 'assigned'].includes(item.status)) ? 'splitNoNew' : 'splitNoDrafts')),
    items.length > 0 && h(Disclosure, { label: t('splitDetails') },
      h('ul', { className: 'pw-reading-list' }, items.map(item => h('li', { key: item.id },
        h('strong', null, t(splitLabels[item.status]), ' · ', item.requirement),
        h(ReadText, { value: item.detail }),
        item.taskIds?.length > 0 && taskLinks(item),
        item.sources?.map(source => h('div', { key: source.path + source.quote, className: 'pw-note' },
          h('span', null, source.path), h(ReadText, { value: source.quote }))))))),
    hasLegacy && !review && h('p', { className: 'pw-text' }, t('splitOld')),
    h(ErrorDetails, { error: error ?? readError, t, showRaw: false }),
    readError && h('button', { type: 'button', className: 'pw-button pw-quiet', disabled: pending, onClick: reload }, t('retryRead')),
    refining ? h('form', { className: 'pw-progress-form', onSubmit: event => {
      event.preventDefault()
      if (!pending && feedback.trim()) onReview(feedback)
    } },
      h('label', { className: 'pw-field' },
        h('span', { className: 'pw-label' }, t('splitFeedback')),
        h('input', { type: 'text', className: 'pw-input', autoFocus: true, value: feedback, disabled: pending,
          placeholder: t('splitFeedbackHint'), onChange: event => changeFeedback(event.target.value) })),
      h('div', { className: 'pw-actions' },
        h('button', { type: 'submit', className: 'pw-button', disabled: pending || !feedback.trim() }, t('splitRethink')),
        h('button', { type: 'button', className: 'pw-button pw-quiet', disabled: pending, onClick: () => showFeedback(false) }, t('cancel'))))
      : h('div', { className: 'pw-actions' },
        (review || hasDrafts) && h('button', { type: 'button', className: 'pw-button pw-quiet', disabled: pending, onClick: () => showFeedback(true) }, t('splitRethink')),
        (hasLegacy || error) && h('button', { type: 'button', className: 'pw-button pw-quiet', disabled: pending, onClick: () => onReview() }, t('splitRetry'))))
}

export function DetailPanel({ req, t, root, mutate, moveIssue, onDelete, onOpenIssue, onCreateTask, projectKey, rootRef, onDirty, busy, sessionId, setModal, uiMemory, onReorderTask, onStartTask, onApprove, onReject, onMove, initialPrdId, initialDelivery, focusTarget, renderPrds, restorePrds, onClosePrds, modalActive, openDiscovery, openPreparation }) {
  const discovery = useDiscoveryRecords(root, req.id)
  const layoutKey = reqDraftKey(projectKey, req.id)
  const form = useWorkItemDraft(layoutKey, req, reqDraftFrom, onDirty, uiMemory)
  const [arranging, setArranging] = useState(false)
  const [linear, setLinear] = useState(false)
  const [managePrds, setManagePrds] = useState(false)
  const [addProgress, setAddProgress] = useState(false)
  const [order, setOrder] = useState(() => savedRequirementOrder(layoutKey, uiMemory.requirementOrders))
  const [drawer, setDrawer] = useState(() => initialPrdId || restorePrds ? { id: 'prds', trigger: 'pw-req-read-prds',
    focusId: initialPrdId ? 'pw-prd-open-full' : undefined } : null)
  const taskFilters = uiMemory.requirementTaskFilters ??= {}
  const [taskFilter, setTaskFilter] = useState(() => taskFilters[layoutKey] ?? '')
  const changeFilter = next => {
    taskFilters[layoutKey] = next
    setTaskFilter(next)
  }
  const showDrawer = (id, trigger) => {
    if (drawer?.id === 'prds' && id !== 'prds') onClosePrds?.()
    setDrawer({ id, trigger })
  }
  const closeDrawer = () => {
    if (drawer?.id === 'prds') onClosePrds?.()
    setDrawer(null)
  }
  const generatePrd = version => {
    if (drawer?.id === 'discovery') closeDrawer()
    openPreparation?.(req.id, 'prd', { discoveryVersion: version })
  }
  const openPrdManagement = () => {
    closeDrawer()
    setManagePrds(true)
    setFocus({ block: 'prds', elementId: 'pw-prd-associations-' + req.id })
  }
  const [focus, setFocus] = useState(null)
  const [prdSummary, setPrdSummary] = useState(null)
  const [reportSnapshot, setReportSnapshot] = useState({ state: 'loading' })
  const [attempted, setAttempted] = useState(false)
  const [proposals, setProposals] = useState([])
  const remembered = uiMemory.taskReviews[reqDraftKey(projectKey, req.id)] ??= { edits: {} }
  const [split, setSplit] = useState(() => remembered.result ?? null)
  const [feedback, setFeedback] = useState(() => remembered.feedback ?? '')
  const [refining, setRefining] = useState(() => !!remembered.refining)
  const [splitBusy, setSplitBusy] = useState(false)
  const [splitError, setSplitError] = useState(null)
  const [readError, setReadError] = useState(null)
  const live = useRef(false)
  const proposalSeq = useRef(0)
  const mode = req.status === 'backlog' ? 'organize' : req.status === 'in_progress' ? 'split' : null
  useEffect(() => {
    if (initialPrdId || restorePrds) {
      setManagePrds(false)
      setLinear(false)
      setDrawer(current => current?.id === 'prds' ? current : { id: 'prds', trigger: 'pw-req-read-prds' })
    } else if (initialDelivery) {
      setFocus({ block: 'delivery' })
    }
  }, [initialPrdId, initialDelivery, restorePrds])
  useEffect(() => {
    if (focusTarget?.startsWith('pw-task-') || focusTarget === 'pw-suggest-' + req.id) {
      setFocus({ block: 'tasks', elementId: focusTarget })
    } else if (focusTarget === 'pw-prd-associations-' + req.id) {
      setManagePrds(true)
      setFocus({ block: 'prds', elementId: focusTarget })
    }
  }, [focusTarget, req.id])
  const loadProposals = useCallback(async () => {
    const seq = ++proposalSeq.current
    if (!mode) return
    const res = await rpc('proposal/list', { root })
    if (!live.current || seq !== proposalSeq.current) return
    setReadError(res.ok ? null : res)
    if (res.ok) setProposals(res.data.proposals.filter(p => p.status === 'pending' &&
      p.target.reqId === req.id && p.kind === (mode === 'organize' ? 'req_draft' : 'new_task')))
  }, [root, req.id, mode])
  useEffect(() => {
    live.current = true
    loadProposals()
    return () => { live.current = false }
  }, [loadProposals])
  const actProposal = async (method, input) => {
    const res = await mutate(method, input)
    if (res.ok) await loadProposals()
    return res
  }
  const splitProposals = mode === 'split' ? proposals.filter(isRequirementSplit) : []
  const splitDrafts = splitProposals.filter(proposal => proposal.split && (!split || split.proposalIds.includes(proposal.id)))
  const changeFeedback = text => { remembered.feedback = text; setFeedback(text) }
  const showFeedback = open => { remembered.refining = open; setRefining(open) }
  const suggestSplit = async note => {
    if (busy || splitBusy) return
    setSplitBusy(true)
    setSplitError(null)
    const res = await mutate('requirement/split', {
      root, id: req.id, sessionId, feedback: note?.trim(),
      priorProposalIds: splitProposals.map(proposal => proposal.id),
    }, { inlineError: true })
    if (res?.ok) {
      remembered.result = res.data
      remembered.feedback = ''
      remembered.refining = false
      remembered.edits = {}
    }
    if (!live.current) return
    if (res?.ok) {
      setSplit(res.data)
      changeFeedback('')
      showFeedback(false)
      await loadProposals()
    } else setSplitError(res)
    setSplitBusy(false)
  }
  const actSplit = async (method, input) => {
    const res = await mutate(method, { ...input, reqId: req.id }, { inlineError: true })
    if (res?.ok) {
      delete remembered.edits[input.proposalId]
      const result = remembered.result
      const proposal = splitDrafts.find(proposal => proposal.id === input.proposalId)
      if (method === 'proposal/adopt' && res.data?.id && proposal && result?.proposalIds.includes(proposal.id)) {
        const covered = new Set(proposal.split.requirements.map(requirement => requirement.id))
        const { id, reused } = res.data
        const items = result.review.items.map(item => covered.has(item.id) && item.status === 'gap' ? {
          ...item,
          status: reused ? 'unknown' : 'assigned',
          detail: t(reused ? 'splitCheckSameTitle' : 'splitNowAssigned'),
          taskIds: [id],
        } : item)
        const question = items.some(item => item.status === 'gap' || item.status === 'unknown') ? result.review.question : ''
        remembered.result = { ...result, review: { items, question } }
      }
    }
    if (!live.current) return res
    if (res?.ok) {
      if (remembered.result) setSplit(remembered.result)
      setProposals(previous => previous.filter(proposal => proposal.id !== input.proposalId))
      setSplitError(null)
      await loadProposals()
    } else setSplitError(res)
    return res
  }
  const save = async (extra = {}, inlineError = false) => {
    const res = await mutate('requirement/update', { root, id: req.id, ...form.params(), ...extra }, { inlineError })
    if (res.ok && rootRef.current === root && live.current) form.finish()
    return res
  }
  const saveForm = () => {
    setAttempted(true)
    if (busy || requirementFormError(form.draft)) return
    const changedReviewed = ['ready', 'in_progress'].includes(req.status) &&
      changesReviewedRequirement(req, form.draft)
    if (!changedReviewed) return save()
    setModal({ kind: 'reason', title: t('confirmReviewEdit'), body: t('confirmReviewEditBody'),
      onOk: reason => save({ confirmReviewInvalid: true, reason }, true) })
  }
  const canEdit = !req.pendingReopen && !['pending', 'completed'].includes(req.status)
  const editing = form.editing && canEdit
  const tasks = req.issues ?? []
  const mainBlock = req.pendingReopen || ['pending', 'completed'].includes(req.status) ? 'delivery'
    : ({ reviewing: 'review', in_progress: 'tasks' }[req.status] ?? 'basic')
  const useOrderedLayout = linear || arranging
  useEffect(() => {
    if (!focus || useOrderedLayout) return
    if (focus.block === 'tasks' && mainBlock !== 'tasks') {
      setDrawer({ id: 'tasks', trigger: 'pw-req-read-tasks', focusId: focus.elementId })
      setFocus(null)
      return
    }
    if (!focus.elementId) return
    const targetTask = tasks.find(task => 'pw-task-' + task.id === focus.elementId)
    const targetId = targetTask && taskFilter && targetTask.status !== taskFilter ? 'pw-req-task-heading' : focus.elementId
    const element = document.getElementById(targetId)
    if (!element) return
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: 'nearest' })
    setFocus(null)
  }, [focus, mainBlock, useOrderedLayout, taskFilter, managePrds, req.issues])
  const canDelete = req.status === 'backlog' && !tasks.length && !req.devHistory
  const organize = () => actProposal('requirement/organize', { root, id: req.id, sessionId })
  const drafts = mode && h(DraftSuggestions, { proposals: proposals.filter(proposal => !isRequirementSplit(proposal)), act: actProposal, root, t, busy })
  const reports = reportSnapshot.reports ?? aiReviewReports(req.reviews)
  const decisions = reviewRecords(req.reviews)
  const reviewCount = reports.length + decisions.filter(record => record.kind === 'review').length
  const reviewSummary = reportSnapshot.state === 'unavailable' ? t('errUnreadable') : reviewCount
    ? t('reqReviewCount').replace('{n}', String(reviewCount))
    : t(reportSnapshot.state === 'loading' ? 'reqLoadingReviews' : 'reqNoReviews')
  const developmentSummary = progressRecords(req.activity, t, 'requirement').find(entry => !entry.event)?.text.split('\n')[0]
  const lastAcceptance = decisions.find(record => record.kind === 'acceptance')
  const delivery = requirementResult(req)
  const deliverySummary = delivery.summary.split(/\r?\n/)[0] || (lastAcceptance
    ? t(lastAcceptance.decision === 'approved' ? 'deliveryAccepted' : 'deliveryReturned')
    : t(delivery.previousSummary || delivery.previousCancelImpact ? 'previousResult' : 'reqNoDelivery'))
  const entries = requirementLogEntries(req, t, reports)
  const openRecord = (block, group, marker) => {
    const id = 'pw-requirement-record-' + group + '-' + marker
    if (useOrderedLayout) setFocus({ block, elementId: id })
    else setDrawer({ id: block, trigger: 'pw-req-read-log', focusId: id })
  }
  const reviewProps = { req, root, t, busy, sessionId, onApprove, onReject, onReportSnapshot: setReportSnapshot }
  const addDevelopmentNote = canEdit ? text => mutate('requirement/addUpdate', { root, id: req.id, text }) : undefined
  const blocks = {
    basic: {
      label: t('reqBasic'), summary: requirementOverview(req).split(/\r?\n/)[0],
      body: editing ? h('form', { noValidate: true, onSubmit: e => { e.preventDefault(); saveForm() } },
        h(RequirementFields, { form, t, busy, req }),
        attempted && h(ErrorDetails, { error: requirementFormError(form.draft), t, showRaw: false }),
        h('div', { className: 'pw-actions' },
          h('button', { type: 'submit', className: 'pw-button primary', disabled: busy }, t('save')),
          h('button', { type: 'button', className: 'pw-button', disabled: busy, onClick: form.finish }, t('cancel'))))
        : h(React.Fragment, null, h(RequirementOverview, { req, t }), mode === 'organize' && drafts),
    },
    discovery: {
      label: t('discoveryRecords'),
      summary: discovery.result?.data?.records?.length ? t('reqReviewCount').replace('{n}', String(discovery.result.data.records.length)) : undefined,
      body: h(DiscoveryRecords, { ...discovery, t, busy, openSource: version => openDiscovery(req.id, version), generatePrd }),
    },
    prds: {
      label: t('reqRelatedPrds'), summary: prdSummary ?? t('reqLoadingPrds'),
      body: renderPrds(setPrdSummary, { manage: true }),
    },
    review: {
      label: t('reqReviews'), summary: reviewSummary,
      body: h(React.Fragment, null,
        h(RequirementReview, reviewProps),
        h(RequirementReviewDecisions, { req, t }),
        !reviewCount && reportSnapshot.state !== 'unavailable' && h('p', { className: 'pw-note' }, reviewSummary)),
    },
    tasks: {
      label: t('reqTasks'), summary: tasks.length ? t('reqTasksCount').replace('{n}', String(tasks.length)) : t('reqNoTasks'),
      body: h(IssueSidebar, { req, t, moveIssue, onOpenIssue, onCreateTask, busy, onReorderTask, onStartTask,
        filter: useOrderedLayout || mainBlock !== 'tasks' ? '' : taskFilter, onFilter: changeFilter,
        onSuggest: mode === 'split' && !editing ? () => suggestSplit() : undefined,
        suggestionReview: mode === 'split' && !req.pendingReopen && !editing && h(TaskSuggestionReview, {
          review: split?.review, req, t, onOpenIssue, hasDrafts: !!splitDrafts.length,
          hasLegacy: splitProposals.some(proposal => !proposal.split), pending: splitBusy,
          error: splitError, readError, reload: loadProposals, onReview: suggestSplit, feedback, changeFeedback, refining, showFeedback,
        }) },
        mode === 'split' && !req.pendingReopen && !editing && h(React.Fragment, null,
          h(DraftSuggestions, { key: split?.proposalIds?.join(',') ?? '', proposals: splitDrafts, act: actSplit, root, t,
            busy: busy || splitBusy, adoptDisabled: ['ASSIST_STALE', 'DRAFT_STALE'].includes(splitError?.code), rememberEdits: remembered.edits }),
          drafts)),
    },
    development: {
      label: t('reqDevelopment'), summary: developmentSummary ?? t('reqNoDevelopment'),
      body: h(RequirementDevelopment, { req, t, onAdd: addDevelopmentNote }),
    },
    delivery: {
      label: t('reqDelivery'), summary: deliverySummary,
      body: h(RequirementDelivery, { req, t, onMove, busy }),
    },
    log: {
      label: t('reqLog'), summary: entries[0]?.summary ?? t('requirementLogEmpty'),
      body: h(RequirementLog, { entries, t, onOpenIssue,
        onOpenReport: marker => openRecord('review', 'report', marker),
        onOpenReview: marker => openRecord('review', 'review', marker),
        onOpenAcceptance: marker => openRecord('delivery', 'delivery', marker) }),
    },
  }
  const readOnlyBodies = {
    basic: h(RequirementOverview, { req, t }),
    discovery: blocks.discovery.body,
    prds: h(React.Fragment, null,
      h('div', { className: 'pw-req-drawer-actions' },
        h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: openPrdManagement }, t('reqManagePrds'))),
      renderPrds(setPrdSummary, { readOnly: true })),
    review: h(React.Fragment, null,
      reportSnapshot.state === 'unavailable' && h('div', { className: 'pw-actions', role: 'status' },
        h('span', { className: 'pw-note' }, t('errUnreadable')),
        h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: reportSnapshot.retry }, t('retryRead'))),
      h(RequirementReviewHistory, { reports, t }), h(RequirementReviewDecisions, { req, t }),
      !reviewCount && reportSnapshot.state !== 'unavailable' && h('p', { className: 'pw-note' }, reviewSummary)),
    development: h(RequirementDevelopment, { req, t }),
    delivery: mainBlock === 'delivery' ? h(React.Fragment, null,
      !lastAcceptance && h('p', { className: 'pw-note' }, t('reqNoDelivery')),
      h(RequirementDecisionRecords, { records: decisions.filter(item => item.kind === 'acceptance'), group: 'delivery', t }))
      : h(RequirementDelivery, { req, t }),
    tasks: h(IssueSidebar, { req, t, onOpenIssue, busy, readOnly: true }),
    log: blocks.log.body,
  }
  const rail = order.flatMap(id => id === 'prds' ? ['discovery', id] : [id])
    .filter(id => id !== mainBlock || ['review', 'delivery'].includes(id)).map(id => {
    const block = blocks[id]
    const summary = ['discovery', 'prds', 'review', 'tasks'].includes(id) ? block.summary : undefined
    return h(ReadingLink, {
      key: id, id: 'pw-req-read-' + id, label: block.label, summary,
      onClick: event => showDrawer(id, event.currentTarget),
    })
  })
  const transition = !req.pendingReopen && ({
    backlog: ['reviewing', 'submitReview'],
    ready: ['in_progress', 'startDev'],
    in_progress: ['pending', 'submit'],
  }[req.status])
  const transitionButton = transition && h('button', {
    type: 'button', className: 'pw-button' + (mainBlock === 'basic' ? ' primary' : ''),
    disabled: busy, onClick: () => onMove(req, transition[0]),
  }, t(transition[1]))
  const activeDrawer = !editing && !managePrds && !useOrderedLayout && drawer && {
    title: blocks[drawer.id].label, key: drawer.id,
    scrollKey: drawer.id === 'prds' ? 'prds:' + (initialPrdId ?? '') : drawer.id,
    body: readOnlyBodies[drawer.id], trigger: drawer.trigger, focusId: drawer.focusId,
  }
  const regular = !editing && !managePrds && !useOrderedLayout
  const detailContent = editing ? blocks.basic.body
    : managePrds ? h(React.Fragment, null,
      h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: () => setManagePrds(false) }, t('reqReturnToDetail')),
      blocks.prds.body)
    : useOrderedLayout ? h(RequirementLayout, { blocks, layoutKey, status: req.status, uiMemory, t, focus, arranging,
      onFinish: () => setArranging(false), onOrderChange: setOrder })
    : h(React.Fragment, null,
      mainBlock !== 'basic' && blocks.basic.summary && h('p', { className: 'pw-text pw-req-lead' }, blocks.basic.summary),
      renderPrds(setPrdSummary, { summaryOnly: true }),
      h(RequirementReview, { ...reviewProps, recentOnly: true, snapshotOnly: mainBlock !== 'review' }),
      mainBlock === 'delivery' ? h('section', null,
        h('h3', { className: 'pw-requirement-section-title' }, t('reqDeliveryCurrent')),
        h(RequirementDelivery, { req, t, onMove, busy, showHistory: false }))
        : mainBlock !== 'review' && blocks[mainBlock].body,
      mainBlock === 'tasks' && addProgress && h(RequirementDevelopment, { req, t, writeOnly: true,
        onAdd: addDevelopmentNote && (async text => {
          const result = await addDevelopmentNote(text)
          if (result.ok && live.current) setAddProgress(false)
          return result
        }) }))
  const content = h('section', { className: 'pw-subpage pw-read-card pw-requirement-page', 'aria-label': t('detail') },
    h('header', { className: 'pw-subpage-head' },
      h('div', { className: 'pw-read-title' }, h('h2', null, req.title),
        h('span', { className: 'pw-count pw-read-status', 'data-status': req.status }, t('col_' + req.status)),
        req.updated && h('span', { className: 'pw-note' }, t('updated'), ' ', dateText(req.updated))),
      !arranging && !managePrds && h('div', { className: 'pw-actions pw-req-head-actions' },
        regular && transitionButton,
        canEdit && !form.editing && h('button', { type: 'button', className: 'pw-button', onClick: () => {
          closeDrawer()
          setAttempted(false)
          form.begin()
        } }, t('edit')),
        h('details', { className: 'pw-disclosure pw-detail-more' },
          h('summary', null, t('requirementActions')),
          h('div', { className: 'pw-actions' },
            !editing && h('button', { type: 'button', className: 'pw-button', onClick: () => { closeDrawer(); setArranging(true) } }, t('reqBlockOrder')),
            !editing && h('button', { type: 'button', className: 'pw-button', onClick: () => { closeDrawer(); setLinear(!linear) } },
              t(linear ? 'reqReturnToDetail' : 'reqReadInOrder')),
            regular && h('button', { type: 'button', className: 'pw-button', onClick: openPrdManagement }, t('reqManagePrds')),
            regular && mainBlock === 'tasks' && addDevelopmentNote && h('button', { type: 'button', className: 'pw-button',
              onClick: () => setAddProgress(!addProgress), 'aria-expanded': addProgress }, t('recordProgress')),
            req.status === 'backlog' && !editing && h('button', { className: 'pw-button', disabled: busy, onClick: organize }, t('aiOrganize')),
            canDelete && !editing && h('button', { className: 'pw-button danger', disabled: busy, onClick: onDelete }, t('delete')))))),
    !editing && !arranging && !managePrds && openPreparation && h(PreparationActions, {
      req, root, t, busy, hasDiscoverySession: !!discovery.result?.data?.sessionId,
      open: (kind, input) => openPreparation(req.id, kind, input),
    }),
    detailContent)
  return h(ReadingLayout, { t, rail: regular && rail, drawer: activeDrawer, onClose: closeDrawer, modalActive,
    scrollMemory: uiMemory.detailScroll ??= {}, scrollKey: layoutKey }, content)
}

// 任务栏：标题是独立详情入口（≥44px），每行一个状态控件；开发中可排序、
// 新建、AI 拆分，并进入处理或验收（PRD §7.5）。其他阶段任务状态只读。
export function IssueSidebar({ req, t, moveIssue, onOpenIssue, onCreateTask, busy, onSuggest, onReorderTask, onStartTask,
  suggestionReview, filter = '', onFilter, readOnly, children }) {
  const [sorting, setSorting] = useState(false)
  const locked = readOnly || req.status !== 'in_progress' || !!req.pendingReopen
  const tasks = sortedTasks(req.issues)
  const visible = sorting || !filter ? tasks : tasks.filter(task => task.status === filter)
  const done = tasks.filter(task => task.status === 'done').length
  const cancelled = tasks.filter(task => task.status === 'cancelled').length
  const effective = tasks.length - cancelled
  const flags = [['blocked', 'devBlocked'], ['in_review', 'devInReview']]
    .map(([status, label]) => [status, label, tasks.filter(task => task.status === status).length])
  return h('section', { className: 'pw-req-tasks', 'aria-label': t('reqTasks') },
    !locked && !!tasks.length && h('div', { className: 'pw-req-progress' },
      h('div', { className: 'pw-req-progress-heading' },
        h('strong', null, t('reqProgress')),
        h('span', null, t('reqActiveTasks').replace('{done}', String(done)).replace('{total}', String(effective)))),
      effective > 0 && h('progress', { value: done, max: effective, 'aria-label': t('reqProgress') }),
      h('div', { className: 'pw-actions' },
        flags.filter(([status, , count]) => count || filter === status).map(([status, label, count]) => h('button', {
          type: 'button', key: status, className: 'pw-button pw-quiet pw-task-filter',
          onClick: () => onFilter?.(status === filter ? '' : status), 'aria-pressed': status === filter, disabled: sorting,
        }, t(label).replace('{n}', String(count)))),
        cancelled > 0 && h('span', { className: 'pw-note' }, t('cancelledCount').replace('{n}', String(cancelled))))),
    h('div', { className: 'pw-req-task-head' },
      h('h3', { id: 'pw-req-task-heading', tabIndex: -1 }, t('reqTasks'), ' ', h('span', { className: 'pw-count' }, String(tasks.length))),
      !locked && h('div', { className: 'pw-actions' },
        h('button', { type: 'button', className: 'pw-button', disabled: busy, onClick: onCreateTask }, t('newTask')),
        onSuggest && h('button', { type: 'button', id: 'pw-suggest-' + req.id, className: 'pw-button pw-quiet', disabled: busy, onClick: onSuggest }, t('aiSplit')),
        tasks.length > 1 && onReorderTask && h('button', {
          type: 'button', className: 'pw-button pw-quiet', disabled: busy, onClick: () => setSorting(!sorting), 'aria-pressed': sorting,
        }, t(sorting ? 'reqFinishOrder' : 'reqTaskOrder')))),
    suggestionReview,
    !visible.length && h('p', { className: 'pw-note', role: 'status' }, t(filter ? 'noResults' : 'reqNoTasks')),
    filter && !sorting && h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: () => onFilter?.('') }, t('reqClearTaskFilter')),
    !!visible.length && h('table', { className: 'pw-req-task-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, t('issueTitle')),
        h('th', { scope: 'col' }, t('reqTaskStatus')),
        !locked && h('th', { scope: 'col' }, t('reqTaskOperations')))),
      h('tbody', null, visible.map((task, index) => h('tr', { key: task.id },
        h('td', null,
          h('button', { type: 'button', id: 'pw-task-' + task.id, className: 'pw-issue-title', onClick: () => onOpenIssue(task.id) }, task.title)),
        h('td', null, readOnly
          ? h('span', { className: 'pw-istatus st-' + task.status }, t('st_' + task.status))
          : h(IssueStatusSelect, { req, issue: task, t, moveIssue, busy })),
        !locked && h('td', null, sorting
          ? h('span', { className: 'pw-actions' },
            h('button', { type: 'button', className: 'pw-orderbtn', disabled: busy || index === 0,
              'aria-label': t('moveUp') + ' · ' + task.title, onClick: () => onReorderTask(task.id, 'up') }, '↑'),
            h('button', { type: 'button', className: 'pw-orderbtn', disabled: busy || index === tasks.length - 1,
              'aria-label': t('moveDown') + ' · ' + task.title, onClick: () => onReorderTask(task.id, 'down') }, '↓'))
          : task.status === 'in_review'
            ? h('button', { type: 'button', className: 'pw-button pw-quiet pw-startbtn', disabled: busy,
              'aria-label': `${t('taskGoToAcceptance')} · ${task.title}`, onClick: () => onOpenIssue(task.id, true) }, t('taskGoToAcceptance'))
            : onStartTask && ['todo', 'doing', 'blocked'].includes(task.status) &&
              h('button', { type: 'button', className: 'pw-button pw-quiet pw-startbtn', disabled: busy, onClick: () => onStartTask(task.id) },
                t(task.status === 'todo' ? 'startTask' : 'demoContinue'))))))),
    children)
}

export const requirementDetailCss = `
.pw-req-drawer-actions{margin-block-end:8px}
.pw-req-head-actions{justify-content:flex-end;max-width:100%}
.pw-req-lead{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:var(--dsw-alias-label-secondary);max-width:55em;margin:0 0 16px}
.pw-req-progress{padding:13px 14px;margin:0 0 18px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base)}
.pw-req-progress-heading{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}
.pw-req-progress-heading span{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.pw-req-progress progress{width:100%;height:6px;appearance:none;margin-block:12px 5px;display:block;accent-color:var(--dsw-alias-brand-primary)}
.pw-req-progress progress::-webkit-progress-bar{background:var(--dsw-alias-bg-layer-2);border-radius:4px}
.pw-req-progress progress::-webkit-progress-value{background:var(--dsw-alias-brand-primary);border-radius:4px}
.pw-req-progress .pw-task-filter[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active)}
.pw-req-task-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.pw-req-task-head h3,.pw-requirement-section-title{font-size:16px;margin:0}
.pw-req-task-table{border-collapse:collapse;width:100%;margin-block:5px 12px;text-align:start}
.pw-req-task-table th{font-weight:500;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:start;line-height:1.4}
.pw-req-task-table :is(th,td){border-block-end:1px solid var(--dsw-alias-border-l3);padding:5px 5px;vertical-align:middle}
.pw-req-task-table td:first-child{width:100%;padding-inline-start:0}
.pw-req-task-table .pw-issue-title{white-space:normal;display:block;min-height:44px;overflow-wrap:anywhere;width:100%}
.pw-req-task-table .pw-select{width:100%;min-width:max-content}
.pw-req-task-table .pw-startbtn{min-height:30px;white-space:nowrap}
.pw-req-task-table td:not(:first-child){min-width:74px}
.pw-req-task-table .pw-istatus{white-space:normal}
@container (max-width:540px){
  .pw-requirement-page{padding:14px}
  .pw-req-head-actions{justify-content:flex-start}
  .pw-req-task-table td:not(:first-child){min-width:62px}
}
`
