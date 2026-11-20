import React from 'react'
import { aiReviewReports, changesReviewedRequirement, requirementOverview } from '../../core/state.js'
import { rpc } from '../api.js'
import { reqDraftKey, reqDraftFrom, issueDraftFrom, issueDraftKey, draftOf, sameDraft } from '../project-state.js'
import { isRequirementSplit, progressRecords, requirementLogEntries, requirementResult, reviewRecords } from '../workbench-content.js'
import { ISSUE_MOVES, sortedTasks } from '../shell/nav-state.js'
import { Disclosure, ErrorDetails, ReadText } from '../shared/ui.js'
import { DraftSuggestions } from './task-content.js'
import { RequirementDevelopment, RequirementOverview, RequirementReviewDecisions } from './requirement-content.js'
import { RequirementReview } from './requirement-review.js'
import { RequirementDelivery } from './acceptance-detail.js'
import { RequirementLayout } from './requirement-layout.js'
import { RequirementLog } from './requirement-log.js'
import { RequirementFields, requirementFormError } from '../forms/requirement-form.js'
import { dateText } from '../shared/list.js'

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

export function DetailPanel({ req, t, root, mutate, moveIssue, onDelete, onOpenIssue, onCreateTask, projectKey, rootRef, onDirty, busy, sessionId, setModal, uiMemory, onReorderTask, onStartTask, onApprove, onReject, onMove, initialPrdId, initialDelivery, focusTarget, renderPrds }) {
  const layoutKey = reqDraftKey(projectKey, req.id)
  const form = useWorkItemDraft(layoutKey, req, reqDraftFrom, onDirty, uiMemory)
  const [arranging, setArranging] = useState(false)
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
    if (initialPrdId) setFocus({ block: 'prds' })
    else if (initialDelivery) setFocus({ block: 'delivery' })
  }, [initialPrdId, initialDelivery])
  useEffect(() => {
    if (focusTarget?.startsWith('pw-task-') || focusTarget === 'pw-suggest-' + req.id) {
      setFocus({ block: 'tasks', elementId: focusTarget })
    } else if (focusTarget === 'pw-prd-associations-' + req.id) {
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
  const openRecord = (block, group, marker) => setFocus({
    block, elementId: 'pw-requirement-record-' + group + '-' + marker,
  })
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
    prds: {
      label: t('reqRelatedPrds'), summary: prdSummary ?? t('reqLoadingPrds'),
      body: renderPrds(setPrdSummary),
    },
    review: {
      label: t('reqReviews'), summary: reviewSummary,
      body: h(React.Fragment, null,
        h(RequirementReview, { req, root, t, busy, sessionId, onApprove, onReject, onReportSnapshot: setReportSnapshot }),
        h(RequirementReviewDecisions, { req, t }),
        !reviewCount && reportSnapshot.state !== 'unavailable' && h('p', { className: 'pw-note' }, reviewSummary)),
    },
    tasks: {
      label: t('reqTasks'), summary: tasks.length ? t('reqTasksCount').replace('{n}', String(tasks.length)) : t('reqNoTasks'),
      body: h(IssueSidebar, { req, t, moveIssue, onOpenIssue, onCreateTask, busy, onReorderTask, onStartTask,
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
      body: h(RequirementDevelopment, { req, t,
        onAdd: canEdit ? text => mutate('requirement/addUpdate', { root, id: req.id, text }) : undefined }),
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
  return h('section', { className: 'pw-subpage pw-read-card', 'aria-label': t('detail') },
    h('header', { className: 'pw-subpage-head' },
      h('div', { className: 'pw-read-title' }, h('h2', null, req.title),
        h('span', { className: 'pw-count pw-read-status', 'data-status': req.status }, t('col_' + req.status)),
        req.updated && h('span', { className: 'pw-note' }, t('updated'), ' ', dateText(req.updated))),
      !arranging && h('div', { className: 'pw-actions' },
        canEdit && !form.editing && h('button', { className: 'pw-button', onClick: () => {
          setAttempted(false); form.begin(); setFocus({ block: 'basic' })
        } }, t('edit')),
        h('details', { className: 'pw-disclosure pw-detail-more' },
          h('summary', null, t('requirementActions')),
          h('div', { className: 'pw-actions' },
            h('button', { className: 'pw-button', onClick: () => setArranging(true) }, t('reqBlockOrder')),
            req.status === 'backlog' && !editing && h('button', { className: 'pw-button', disabled: busy, onClick: organize }, t('aiOrganize')),
            canDelete && !editing && h('button', { className: 'pw-button danger', disabled: busy, onClick: onDelete }, t('delete')))))),
    h(RequirementLayout, { blocks, layoutKey, status: req.status, uiMemory, t, focus, arranging, onFinish: () => setArranging(false) }))
}

// 任务栏：标题是独立详情入口（≥44px），每行一个状态控件；开发中可排序、
// 新建、AI 拆分，并开始/继续处理（PRD §7.5）。其他阶段任务状态只读。
export function IssueSidebar({ req, t, moveIssue, onOpenIssue, onCreateTask, busy, onSuggest, onReorderTask, onStartTask, suggestionReview, children }) {
  const locked = req.status !== 'in_progress' || !!req.pendingReopen
  const tasks = sortedTasks(req.issues)
  return h('section', { className: 'pw-issues pw-issue-list', 'aria-label': t('issues') },
    h('div', { className: 'pw-colhead' }, h('strong', null, t('issues')), h('span', { className: 'pw-count' }, String(tasks.length)),
      !locked && h('div', { className: 'pw-actions', style: { marginInlineStart: 'auto' } },
        h('button', { className: 'pw-button', disabled: busy, onClick: onCreateTask }, t('newTask')),
        onSuggest && h('button', { id: 'pw-suggest-' + req.id, className: 'pw-button', disabled: busy, onClick: onSuggest }, t('aiSplit')))),
    suggestionReview,
    !tasks.length && h('p', { className: 'pw-note' }, t('reqNoTasks')),
    tasks.map((i, index) => h('div', { key: i.id, className: 'pw-issue' },
      !locked && h('span', { className: 'pw-order' },
        h('button', { className: 'pw-orderbtn', disabled: busy || index === 0, 'aria-label': t('moveUp'), title: t('moveUp'), onClick: () => onReorderTask(i.id, 'up') }, '↑'),
        h('button', { className: 'pw-orderbtn', disabled: busy || index === tasks.length - 1, 'aria-label': t('moveDown'), title: t('moveDown'), onClick: () => onReorderTask(i.id, 'down') }, '↓')),
      h('button', { id: 'pw-task-' + i.id, className: 'pw-issue-title', onClick: () => onOpenIssue(i.id), title: i.title },
        h('span', { className: 'pw-preview' }, i.title),
        h('span', { 'aria-hidden': true }, '›')),
      h(IssueStatusSelect, { req, issue: i, t, moveIssue, busy }),
      !locked && onStartTask && ['todo', 'doing', 'blocked'].includes(i.status) &&
        h('button', { className: 'pw-button pw-quiet pw-startbtn', disabled: busy, onClick: () => onStartTask(i.id) },
          t(i.status === 'todo' ? 'startTask' : 'demoContinue')))),
    children)
}
