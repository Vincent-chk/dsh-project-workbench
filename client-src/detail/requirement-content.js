import React from 'react'
import { requirementOverview } from '../../core/state.js'
import { activityEntry, cancellationReason, requirementResult, reviewRecords, taskResult, workbenchError } from '../workbench-content.js'
import { deliveryFingerprint } from '../project-state.js'
import { rpc } from '../api.js'
import { Disclosure, ReadText } from '../shared/ui.js'
import { ReadingText, TaskResult, UpdateLog, Verification } from './task-content.js'

const h = React.createElement
const { useState } = React

export function RequirementOverview({ req, t }) {
  const overview = requirementOverview(req)
  const goal = req.goal?.trim()
  const scope = req.scope?.trim()
  const exclusions = req.q_out?.trim()
  const acceptance = req.acceptance?.trim()
  const legacyCriteria = req.q_success?.trim()
  const criteria = [...new Set([acceptance, legacyCriteria].filter(Boolean))].join('\n\n')
  const missing = [
    !req.title?.trim() && 'issueTitle',
    !overview && 'requirementOverview',
  ].filter(Boolean)
  const tasks = req.issues ?? []
  const done = tasks.filter(task => task.status === 'done').length
  const cancelled = tasks.filter(task => task.status === 'cancelled').length
  return h('div', { className: 'pw-reading' },
    h(ReadingText, { label: t('requirementOverview'), value: overview, className: 'pw-reading-lead' }),
    goal !== overview && h(ReadingText, { label: t('goal'), value: goal, className: 'pw-reading-divider' }),
    (scope || exclusions) && h('section', { className: 'pw-reading-block pw-reading-divider' },
      h('h3', { className: 'pw-reading-label' }, t('requirementScope')),
      h(ReadingText, { value: scope }),
      h(ReadText, { label: t('q_out'), value: exclusions })),
    req.status === 'backlog' && missing.length > 0 && h('p', { className: 'pw-note' }, t('requirementMissing')
      .replace('{fields}', missing.map(t).join(t('fieldSeparator')))),
    ['pending', 'completed'].includes(req.status) && h(DeliveryResult, { req, t, userFacing: true, showAcceptance: false }),
    (req.q_who?.trim() || criteria || req.background?.trim() || req.decisionNotes?.trim()) && h(Disclosure, { label: t('requirementExtra') },
      h(ReadingText, { label: t('q_who'), value: req.q_who }),
      h(ReadingText, { label: t('requirementCriteria'), value: criteria, className: 'pw-reading-criteria' }),
      h(ReadingText, { label: t('requirementBackground'), value: req.background }),
      h(ReadingText, { label: t('decisionNotes'), value: req.decisionNotes })),
    tasks.length > 0 && h('footer', { className: 'pw-reading-footer' },
      t('taskCount').replace('{total}', String(tasks.length)).replace('{done}', String(done)),
      cancelled > 0 && ' · ' + t('cancelledCount').replace('{n}', String(cancelled))))
}

export function RequirementHistory({ req, t, onAdd }) {
  const reviews = reviewRecords(req.reviews)
  return h(React.Fragment, null,
    reviews.length > 0 && h(Disclosure, { label: t('reviewRecords') },
      reviews.map((review, index) => h('div', { className: 'pw-reading-block', key: review.marker || review.round || index },
        h('strong', null, t(review.kind === 'review'
          ? (review.decision === 'approved' ? 'reviewApproved' : 'reviewReturned')
          : (review.decision === 'approved' ? 'deliveryAccepted' : 'deliveryReturned'))),
        review.at && h('span', { className: 'pw-count' }, ' · ' + String(review.at).replace('T', ' ').slice(0, 16)),
        h(ReadingText, { label: t('reviewOpinion'), value: review.opinion }),
        h(ReadingText, { label: t('demoDeliverySummary'), value: review.summary })))),
    h(UpdateLog, { activity: req.activity, onAdd: !['pending', 'completed'].includes(req.status) ? onAdd : null, t, kind: 'requirement', userFacing: true, reviews }))
}

export function DeliveryResult({ req, t, compact = false, userFacing = false, showAcceptance = true }) {
  const result = requirementResult(req)
  const tasks = req.issues ?? []
  const relevant = req.status === 'pending' || req.status === 'completed'
  const hasCancelled = tasks.some(issue => issue.status === 'cancelled') || !!req.hasCancelled
  const currentImpact = hasCancelled ? result.cancelImpact : ''
  if (userFacing && relevant) {
    return h('section', { className: 'pw-reading pw-reading-delivery', 'aria-label': t('demoDeliverySummary') },
      h(ReadingText, { label: t('demoDeliverySummary'), value: result.summary || t('missingDeliverySummary') }),
      showAcceptance && h(ReadingText, { label: t('requirementCriteria'), value: req.acceptance?.trim() || req.q_success?.trim() || t('missingCriteria') }),
      hasCancelled && h(ReadingText, { label: t('demoCancelImpact'), value: currentImpact || t('missingCancelImpact') }),
      tasks.length > 0 && h('section', { className: 'pw-reading-block' },
        h('h3', { className: 'pw-reading-label' }, t('deliveredTaskResults')),
        tasks.map(task => h('div', { key: task.id, className: 'pw-result' },
          h('strong', null, task.title), ' · ', t('st_' + task.status),
          task.status === 'cancelled'
            ? h(ReadingText, { label: t('taskCancelReason'), value: cancellationReason(task) || t('taskNoReason') })
            : h(TaskResult, { task, t, since: req.deliveryStartedAt, userFacing: true, showAcceptance: false })))),
      (result.previousSummary || result.previousCancelImpact) && h(Disclosure, { label: t('previousResult') },
        h(ReadingText, { value: result.previousSummary }),
        h(ReadingText, { label: t('demoCancelImpact'), value: result.previousCancelImpact })))
  }
  if (!result.summary && !result.previousSummary && !result.cancelImpact && !result.previousCancelImpact && req.status !== 'pending') return null
  if (compact) return h('section', { className: 'pw-result', 'aria-label': t('demoPendingAcceptance') },
    h('strong', null, t('demoPendingAcceptance')),
    h(ReadText, { value: result.summary.split(/\r?\n/)[0] }),
    h(ReadText, { label: t('demoCancelImpact'), value: currentImpact }))
  return h('section', { className: 'pw-result', 'aria-label': t('demoDeliverySummary') },
    h(ReadText, { label: t('demoDeliverySummary'), value: result.summary }),
    relevant && h(ReadText, { label: t('acceptanceField'), value: req.acceptance || req.q_success }),
    relevant && h(ReadText, { label: t('demoCancelImpact'), value: currentImpact }),
    relevant && tasks.map(task => {
      const item = taskResult(task, Math.max(req.deliveryStartedAt || 0, task.deliveryStartedAt || 0))
      const cancelled = task.status === 'cancelled'
      return h('div', { key: task.id, className: 'pw-result' },
        h('strong', null, task.title), ' · ', t('st_' + task.status),
        cancelled ? null : h(React.Fragment, null,
          h(ReadText, { value: item.summary }),
          h(Verification, { verification: item.verification, t }),
          h(ReadText, { label: t('demoLimits'), value: item.limits })),
        (item.fullSummary !== item.summary || item.fullLimits !== item.limits || task.evidence || task.objective || cancelled) &&
          h(Disclosure, { label: t(cancelled ? 'history' : 'verifyRecords') },
            cancelled ? h(ReadText, { value: (task.activity ?? []).map(line => activityEntry(line, t, 'issue').text).join('\n') })
              : h(React.Fragment, null, h(ReadText, { label: t(item.previousSummary ? 'previousResult' : 'demoResult'), value: item.fullSummary }),
                h(ReadText, { value: task.evidence }), h(ReadText, { value: task.objective }))))
    }),
    (result.previousSummary || result.previousCancelImpact) && h(Disclosure, { label: t('previousResult') },
      h(ReadText, { value: result.previousSummary }), h(ReadText, { label: t('demoCancelImpact'), value: result.previousCancelImpact })))
}

export function ManualDelivery({ req, t, act, root, busy, userFacing = false, onSuccess, onDraftChange, draftMemory, draftKey }) {
  // Keep the reviewed content stable while the user writes; a background refresh
  // must not silently make an old summary valid for a new delivery.
  const [reviewReq, setReviewReq] = useState(() => draftMemory?.[draftKey]?.reviewReq ?? req)
  const [summary, setSummary] = useState(() => draftMemory?.[draftKey]?.summary ?? '')
  const [impact, setImpact] = useState(() => draftMemory?.[draftKey]?.impact ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const waiting = busy || submitting
  // A parent can refresh while the form is open. A terminal state must block
  // another submit immediately, without replacing the user's unsaved text.
  const currentReq = req.status !== 'in_progress' ? req : reviewReq
  const statusChanged = currentReq.status !== 'in_progress'
  const tasks = reviewReq.issues ?? []
  const remember = (nextSummary, nextImpact, reviewed = reviewReq) => {
    if (!draftMemory || !draftKey) return
    if (nextSummary || nextImpact) draftMemory[draftKey] = { summary: nextSummary, impact: nextImpact, reviewReq: reviewed }
    else delete draftMemory[draftKey]
  }
  return h('form', { className: 'pw-result', onSubmit: async event => {
    event.preventDefault()
    if (waiting || statusChanged || !summary.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      // 提交绑定用户当前看到的需求与任务内容；期间任何变化由宿主按指纹拒绝，
      // 输入保留，刷新核对新内容后重新提交（PRD §5.4）。
      const res = await act('requirement/submit', { root, id: reviewReq.id, summary: summary.trim(), cancelImpact: impact.trim(), expectFingerprint: await deliveryFingerprint(reviewReq) })
      if (res?.ok) {
        setSummary('')
        setImpact('')
        remember('', '')
        onDraftChange?.(false)
        onSuccess?.()
      } else {
        let displayError = res
        if (res?.code === 'ROUND_CHANGED' || res?.code === 'CONFLICT') {
          const latest = await rpc('requirement/get', { root, id: reviewReq.id })
          if (latest.ok) {
            setReviewReq(latest.data)
            remember(summary, impact, latest.data)
            displayError = { ...res, code: latest.data.status === 'in_progress' ? 'REVIEW_CONTENT_UPDATED' : 'DELIVERY_STATUS_CHANGED' }
          }
        }
        if (userFacing) setError(workbenchError(displayError, t).text)
      }
    } finally {
      setSubmitting(false)
    }
  } },
  statusChanged && h(DeliveryResult, { req: currentReq, t, userFacing: true }),
  statusChanged && !error && h('p', { className: 'pw-error', role: 'alert' }, t('errDeliveryStatusChanged')),
  !statusChanged && !error && (tasks.length === 0 || tasks.some(task => task.status !== 'done')) &&
    h('p', { className: 'pw-error', role: 'alert' }, t(tasks.length === 0 ? 'errNoTasks' : 'errTasksNotAccepted')),
  h(ReadingText, { label: t('requirementCriteria'), value: reviewReq.acceptance?.trim() || reviewReq.q_success?.trim() || t('missingCriteria') }),
  tasks.map(task => h('div', { key: task.id, className: 'pw-result' },
    h('strong', null, task.title), ' · ', t('st_' + task.status),
    task.status === 'cancelled'
      ? h(ReadingText, { label: t('taskCancelReason'), value: cancellationReason(task) || t('taskNoReason') })
      : h(TaskResult, { task, t, since: reviewReq.deliveryStartedAt, userFacing: true, showAcceptance: false }))),
  h('label', { className: 'pw-field' }, t('demoDeliverySummary'),
    h('textarea', { className: 'pw-textarea', rows: 3, readOnly: waiting, value: summary, onChange: event => {
      const value = event.target.value; setSummary(value); remember(value, impact); onDraftChange?.(!!value || !!impact)
    } })),
  impact && h('label', { className: 'pw-field' }, t('demoCancelImpact'),
    h('textarea', { className: 'pw-textarea', rows: 2, readOnly: waiting, value: impact, onChange: event => {
      const value = event.target.value; setImpact(value); remember(summary, value); onDraftChange?.(!!summary || !!value)
    } })),
  error && h('p', { className: 'pw-error', role: 'alert' }, error),
  h('button', { type: 'submit', className: 'pw-button primary', disabled: waiting || statusChanged || !summary.trim() }, t('demoSubmitAcceptance')))
}
