import React from 'react'
import { requirementOverview } from '../../core/state.js'
import { activityEntry, cancellationReason, progressRecords, requirementResult, reviewRecords, shortRecordedText, taskLimitPreview, taskResult, workbenchError } from '../workbench-content.js'
import { deliveryFingerprint } from '../project-state.js'
import { rpc } from '../api.js'
import { Disclosure, ReadText } from '../shared/ui.js'
import { dateText } from '../shared/list.js'
import { ReadingText, TaskResult, UpdateLog, Verification } from './task-content.js'

const h = React.createElement
const { useState } = React

export const requirementContentLocale = {
  en: {
    noRequirementDelivery: 'No delivery or acceptance records yet.',
    reqInformation: 'Requirement information', reqRecordedOverview: 'Requirement details recorded',
    reqDeliverySubmitted: 'Delivery submitted', reqDeliverySnapshot: 'View delivery snapshot',
    reqDeliveryUnfinished: '{n} tasks still need to be completed or accepted',
    reqDeliveryGaps: '{n} tasks have verification results or limitations to check',
    reqPlanFirstTask: 'Create the first task', reqPlanMissing: 'Missing: {fields}',
  },
  zh: {
    noRequirementDelivery: '暂无交付与验收记录。',
    reqInformation: '需求信息', reqRecordedOverview: '已记录需求信息',
    reqDeliverySubmitted: '交付已提交', reqDeliverySnapshot: '查看交付快照',
    reqDeliveryUnfinished: '还有 {n} 项任务待完成或验收',
    reqDeliveryGaps: '{n} 项任务有待核对的检查结果或限制',
    reqPlanFirstTask: '先建一项任务', reqPlanMissing: '待补{fields}',
  },
}

export function RequirementOverview({ req, t, compact = false }) {
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
  const refs = Array.isArray(req.refs) ? req.refs.join('\n') : ''
  const full = h('div', { className: 'pw-reading' },
    h(ReadingText, { label: t('requirementOverview'), value: overview, className: 'pw-reading-lead' }),
    goal !== overview && h(ReadingText, { label: t('goal'), value: goal, className: 'pw-reading-divider' }),
    (scope || exclusions) && h('section', { className: 'pw-reading-block pw-reading-divider' },
      h('h3', { className: 'pw-reading-label' }, t('requirementScope')),
      h(ReadingText, { value: scope }),
      h(ReadText, { label: t('q_out'), value: exclusions })),
    req.status === 'backlog' && missing.length > 0 && h('p', { className: 'pw-note' }, t('requirementMissing')
      .replace('{fields}', missing.map(t).join(t('fieldSeparator')))),
    (req.q_who?.trim() || criteria || req.background?.trim() || req.decisionNotes?.trim() || refs) && h(Disclosure, { label: t('requirementExtra') },
      h(ReadingText, { label: t('q_who'), value: req.q_who }),
      h(ReadingText, { label: t('requirementCriteria'), value: criteria, className: 'pw-reading-criteria' }),
      h(ReadingText, { label: t('requirementBackground'), value: req.background }),
      h(ReadingText, { label: t('decisionNotes'), value: req.decisionNotes }),
      h(ReadingText, { label: t('refs'), value: refs })))
  if (!compact) return full
  const purpose = shortRecordedText(goal) || shortRecordedText(overview)
  const boundary = shortRecordedText(exclusions, 85) || shortRecordedText(scope, 85)
  return h('div', { className: 'pw-reading' },
    (purpose || overview || goal) && h(ReadingText, { label: t('requirementOverview'), value: purpose || t('reqRecordedOverview') }),
    boundary && boundary !== purpose && h(ReadingText, { label: t('requirementScope'), value: boundary }),
    missing.length > 0 && h('p', { className: 'pw-note' }, t('requirementMissing').replace('{fields}', missing.map(t).join(t('fieldSeparator')))),
    h(Disclosure, { label: t('reqInformation') }, full))
}

export function RequirementDecisionRecords({ records, group, t }) {
  if (!records.length) return null
  return records.map((record, index) => {
    const identifier = record.marker || record.round
    const label = record.kind === 'review'
      ? (record.decision === 'approved' ? 'reviewApproved' : 'reviewReturned')
      : (record.decision === 'approved' ? 'deliveryAccepted' : 'deliveryReturned')
    return h('details', { className: 'pw-disclosure', key: identifier || index,
      id: identifier ? `pw-requirement-record-${group}-${identifier}` : undefined },
      h('summary', null, t(label), record.at && h('span', { className: 'pw-count' }, ' · ' + String(record.at).replace('T', ' ').slice(0, 16))),
      record.opinion && h(ReadingText, { label: t('reviewOpinion'), value: record.opinion }),
      record.summary && h(Disclosure, { label: t('reqDeliverySnapshot') },
        h(ReadingText, { label: t('demoDeliverySummary'), value: record.summary })))
  })
}

export function RequirementReviewDecisions({ req, t }) {
  const records = reviewRecords(req.reviews).filter(record => record.kind === 'review')
  return h(RequirementDecisionRecords, { records, group: 'review', t })
}

export function RequirementDevelopment({ req, t, onAdd, writeOnly = false }) {
  const notes = progressRecords(req.activity, t, 'requirement').filter(entry => !entry.event)
  const canAdd = !req.pendingReopen && !['pending', 'completed'].includes(req.status) && onAdd
  if (writeOnly) return canAdd ? h(UpdateLog, { onAdd, t, kind: 'requirement', userFacing: true, initiallyEditing: true }) : null
  const occurrences = new Map()
  const disclosures = notes.reverse().map(note => {
    const raw = req.activity[note.key]
    const count = (occurrences.get(raw) ?? 0) + 1
    occurrences.set(raw, count)
    return h(Disclosure, { key: JSON.stringify([raw, count]),
      label: h('span', { className: 'pw-preview' }, note.date && h('time', { className: 'pw-count' }, note.date, ' · '), note.text.split('\n')[0]) },
      h(ReadingText, { value: note.text }))
  }).reverse()
  return h(React.Fragment, null,
    disclosures.length === 0 && h('p', { className: 'pw-note' }, t('reqNoDevelopment')),
    disclosures,
    canAdd && h(UpdateLog, { onAdd, t, kind: 'requirement', userFacing: true }))
}

export function DeliveryResult({ req, t, compact = false, userFacing = false, showAcceptance = true, foldTasks = false, children, openSnapshot }) {
  const result = requirementResult(req)
  const tasks = req.issues ?? []
  const relevant = req.status === 'pending' || req.status === 'completed'
  const hasCancelled = tasks.some(issue => issue.status === 'cancelled') || !!req.hasCancelled
  const currentImpact = hasCancelled ? result.cancelImpact : ''
  if (userFacing && relevant) {
    const active = tasks.filter(task => task.status !== 'cancelled')
    const confirmed = active.filter(task => task.status === 'done').length
    const gaps = active.map(task => {
      const item = taskResult(task, req.deliveryStartedAt)
      return { count: item.verification.failed + item.verification.incomplete + item.verification.unconfirmedChanges,
        limits: item.limits, preview: taskLimitPreview(task, item, req.deliveryStartedAt).text }
    }).filter(item => item.count || item.limits || item.preview)
    const gapPreview = gaps.find(item => item.preview)?.preview
    const final = req.status === 'completed' && reviewRecords(req.reviews).find(record => record.kind === 'acceptance' && record.decision === 'approved')
    const shortSummary = shortRecordedText(result.summary)
    const snapshot = final?.summary || result.summary
    const taskResults = tasks.map(task => h('div', { key: task.id, className: 'pw-result' },
      h('strong', null, task.title), ' · ', t('st_' + task.status),
      task.status === 'cancelled'
        ? h(ReadingText, { label: t('taskCancelReason'), value: cancellationReason(task) || t('taskNoReason') })
        : h(TaskResult, { task, t, since: req.deliveryStartedAt, userFacing: true, showAcceptance: false })))
    return h('section', { className: 'pw-reading pw-reading-delivery', 'aria-label': t('demoDeliverySummary') },
      h('div', { className: 'pw-reading-block' },
        h('strong', null, req.status === 'completed' ? t('deliveryAccepted') : shortSummary || t(result.summary ? 'reqDeliverySubmitted' : 'missingDeliverySummary')),
        final?.at && h('time', { className: 'pw-note', dateTime: final.at }, ' · ', dateText(final.at)),
        active.length > 0 && h('p', { className: 'pw-note' }, t('reqActiveTasks').replace('{done}', String(confirmed)).replace('{total}', String(active.length))),
        gaps.length > 0 && h('p', { className: 'pw-text' }, t('reqDeliveryGaps').replace('{n}', String(gaps.length)),
          gapPreview && ' · ' + gapPreview),
        hasCancelled && currentImpact && h(ReadingText, { label: t('demoCancelImpact'), value: shortRecordedText(currentImpact) || t('reqDeliverySnapshot') }),
        hasCancelled && !currentImpact && h('p', { className: 'pw-note' }, t('missingCancelImpact'))),
      children,
      h(Disclosure, { label: t('reqDeliverySnapshot'), open: openSnapshot },
        h(ReadingText, { label: t('demoDeliverySummary'), value: snapshot || t('missingDeliverySummary') }),
        final?.opinion && h(ReadingText, { label: t('reviewOpinion'), value: final.opinion }),
        showAcceptance && h(ReadingText, { label: t('requirementCriteria'), value: req.acceptance?.trim() || req.q_success?.trim() || t('missingCriteria') }),
        hasCancelled && h(ReadingText, { label: t('demoCancelImpact'), value: currentImpact || t('missingCancelImpact') }),
        taskResults.length > 0 && h('section', { className: 'pw-reading-block' },
          h('h3', { className: 'pw-reading-label' }, t('deliveredTaskResults')),
          foldTasks || compact
            ? tasks.map((task, index) => h(Disclosure, { key: task.id, label: task.title }, taskResults[index]))
            : taskResults)),
      (result.previousSummary || result.previousCancelImpact) && h(Disclosure, { label: t('previousResult') },
        h(ReadingText, { value: result.previousSummary }),
        h(ReadingText, { label: t('demoCancelImpact'), value: result.previousCancelImpact })))
  }
  if (userFacing) {
    const priorSummary = result.previousSummary || result.summary
    const priorImpact = result.previousCancelImpact || result.cancelImpact
    return (priorSummary || priorImpact) ? h(Disclosure, { label: t('previousResult') },
      h(ReadingText, { value: priorSummary }),
      h(ReadingText, { label: t('demoCancelImpact'), value: priorImpact })) : null
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
