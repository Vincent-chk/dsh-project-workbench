import React from 'react'
import { taskOverview } from '../../core/state.js'
import { activityEntry, cancellationReason, draftFieldLabel, progressRecords, readingBlocks, taskProgressRecords, taskResult } from '../workbench-content.js'
import { issueDraftFrom, taskContentPatch, taskFormError } from '../project-state.js'
import { TaskFields } from '../forms/task-form.js'
import { Disclosure, ErrorDetails, ReadText } from '../shared/ui.js'

const h = React.createElement
const { useState } = React

export function UpdateLog({ activity, onAdd, t, kind = 'issue', showRecords = true, userFacing = false, reviews, timeline, openWikiPage,
  onReadProgress, initialProgress, showTimelineHeading = true, initiallyEditing = false }) {
  const [text, setText] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(initiallyEditing)
  const add = async () => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      const res = await onAdd(timeline && detail.trim() ? `${value}\n${detail.trim()}` : value)
      if (res?.ok) {
        setText(current => current === text ? '' : current)
        setDetail(current => current === detail ? '' : current)
        if (userFacing) setEditing(false)
      }
    } finally {
      setBusy(false)
    }
  }
  const cancel = () => { setEditing(false); setText(''); setDetail('') }
  if (timeline) {
    return h(ProgressTimeline, { records: taskProgressRecords(activity, t), t, openWikiPage, onAdd, initialProgress, showTimelineHeading },
      editing ? h('form', { className: 'pw-progress-form', onSubmit: event => { event.preventDefault(); add() } },
        h('label', { className: 'pw-field' }, h('span', { className: 'pw-label' }, t('progressSummary')),
          h('input', { className: 'pw-input', autoFocus: true, required: true, readOnly: busy, value: text, onChange: event => setText(event.target.value) })),
        h('label', { className: 'pw-field' }, h('span', { className: 'pw-label' }, t('progressDetail')),
          h('textarea', { className: 'pw-textarea', rows: 3, readOnly: busy, value: detail, placeholder: t('progressDetailHint'), onChange: event => setDetail(event.target.value) })),
        h('div', { className: 'pw-actions' },
          h('button', { className: 'pw-button', type: 'submit', disabled: busy || !text.trim() }, t('addUpdate')),
          h('button', { className: 'pw-button pw-quiet', type: 'button', disabled: busy, onClick: cancel }, t('cancel'))))
        : onAdd && h('button', { className: 'pw-button pw-quiet', onClick: () => setEditing(true) }, t('recordProgress')))
  }
  const records = userFacing ? progressRecords(activity, t, kind, reviews)
    : (activity ?? []).map((line, index) => ({ ...activityEntry(line, t, kind), key: index }))
  const list = entries => h('div', { className: 'pw-update-list' }, entries.map(entry =>
    h('div', { key: entry.key, className: 'pw-update' },
      entry.date && h('span', { className: 'pw-update-ts' }, entry.date),
      h('span', { className: 'pw-update-body' }, entry.text))))
  const form = onAdd && h('form', { className: 'pw-update-add', onSubmit: event => { event.preventDefault(); add() } },
    h('input', { className: 'pw-input', autoFocus: userFacing, readOnly: busy, 'aria-label': t('updatePlaceholder'), placeholder: t('updatePlaceholder'), value: text, onChange: event => setText(event.target.value) }),
    h('button', { className: 'pw-button', type: 'submit', disabled: !text.trim() || busy }, t('addUpdate')),
    userFacing && h('button', { className: 'pw-button', type: 'button', disabled: busy, onClick: cancel }, t('cancel')))
  if (userFacing) {
    if (!records.length && !onAdd) return null
    const latest = kind === 'issue' && records.find(entry => !entry.event)
    const earlier = records.filter(entry => entry !== latest)
    const preview = latest?.text.split(/\r?\n/).find(line => line.trim())
    if (onReadProgress) return h('section', { className: 'pw-task-progress-preview', 'aria-label': t('progressRecords') },
      latest && h('div', null,
        h('h3', { className: 'pw-reading-label' }, t('latestProgress')),
        h('p', { className: 'pw-text pw-preview' }, preview)),
      h('div', { className: 'pw-actions' },
        records.length > 0 && h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: event => onReadProgress(event, latest?.key) }, t('taskReadProgress')),
        onAdd && !editing && h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: () => setEditing(true) }, t('recordProgress'))),
      onAdd && editing && form)
    return h('section', { className: 'pw-updates', 'aria-label': t('progressRecords') },
      latest && h(ReadingText, { label: t('latestProgress'), value: latest.text }),
      earlier.length > 0 && h(Disclosure, { label: t('progressRecords') }, list(earlier)),
      onAdd && (editing ? form : h('button', { className: 'pw-button', onClick: () => setEditing(true) }, t('recordProgress'))))
  }
  return h('section', { className: 'pw-updates', 'aria-label': t('updates') },
    showRecords && h('strong', null, t('updates')),
    showRecords && (records.length ? list(records.slice(0, 3)) : h('div', { className: 'pw-empty' }, t('noActivity'))),
    records.length > 3 && h(Disclosure, { label: t('olderProgress') }, list(records.slice(3))),
    records.some(entry => entry.raw) && h(Disclosure, { label: t('rawDetails') },
      h(ReadText, { value: (activity ?? []).join('\n') })),
    form)
}

function ProgressTimeline({ records, t, openWikiPage, onAdd, children, initialProgress, showTimelineHeading }) {
  const [expanded, setExpanded] = useState(() => new Set(initialProgress ? [initialProgress] : []))
  const [showOlder, setShowOlder] = useState(false)
  if (!records.length && !onAdd && showTimelineHeading) return null
  const older = records.slice(3)
  const olderVisible = showOlder || older.some(entry => expanded.has(entry.id))
  const rows = records.map(entry => {
    const links = []
    const detail = entry.detail.replace(/^(?:资料来源[:：]|Reference:)[ \t]*((?:wiki:|openwiki\/)[^\r\n]+)$/gm, (_line, path) => {
      links.push(path.trim()); return ''
    })
    return h('details', { className: 'pw-progress-item', key: entry.id, open: expanded.has(entry.id),
      id: entry.id === initialProgress ? 'pw-task-current-progress' : undefined,
      onToggle: event => {
        const isOpen = event.currentTarget.open
        setExpanded(current => {
          if (current.has(entry.id) === isOpen) return current
          const next = new Set(current)
          if (isOpen) next.add(entry.id); else next.delete(entry.id)
          return next
        })
      } },
    h('summary', null,
      entry.date && h('time', { dateTime: entry.at }, entry.date),
      h('span', { className: 'pw-preview' }, entry.summary)),
    h('div', { className: 'pw-progress-detail' },
      entry.date && h('p', { className: 'pw-note' }, t('progressRecordedAt'), ' ', entry.date),
      h(ReadingText, { value: detail }),
      links.length > 0 && h(TaskReferences, { refs: [...new Set(links)], openWikiPage })))
  })
  return h('section', { className: showTimelineHeading ? 'pw-progress' : 'pw-task-progress-records', 'aria-label': t('progressRecords') },
    showTimelineHeading && h('div', { className: 'pw-progress-head' }, h('h3', null, t('progressRecords')),
      children?.type === 'button' && children),
    !records.length && h('p', { className: 'pw-note' }, t('noTaskProgress')),
    rows.slice(0, 3), older.length > 0 && h('button', { className: 'pw-button pw-quiet', 'aria-expanded': olderVisible,
      onClick: () => {
        if (olderVisible) setExpanded(current => new Set([...current].filter(id => !older.some(entry => entry.id === id))))
        setShowOlder(!olderVisible)
      } }, t(olderVisible ? 'hideOldTaskProgress' : 'oldTaskProgress')),
    olderVisible && rows.slice(3), children?.type !== 'button' && children)
}

export function ReadingText({ label, value, className }) {
  const blocks = readingBlocks(value)
  if (!blocks.length) return null
  return h('div', { className: 'pw-reading-block' + (className ? ' ' + className : '') },
    label && h('h3', { className: 'pw-reading-label' }, label),
    blocks.map(({ tag, lines }, index) => tag === 'p'
      ? h('p', { className: 'pw-text', key: index }, lines.join('\n'))
      : h(tag, { className: 'pw-reading-list', key: index, ...(tag === 'ol' ? { start: lines[0].number } : {}) },
        lines.map((line, item) => h('li', { key: item, ...(tag === 'ol' ? { value: line.number } : {}) },
          tag === 'ol' ? line.text : line)))))
}

export function Verification({ verification, t }) {
  const { passed, failed, incomplete, unconfirmedChanges, hasManualEvidence } = verification
  return h('div', { className: 'pw-reading-verification' }, h('strong', null, t('verify')),
    failed > 0 && h('p', { className: 'pw-text pw-error' }, t('checksFailed').replace('{n}', String(failed))),
    incomplete > 0 && h('p', { className: 'pw-text pw-error' }, t('checksIncomplete')),
    unconfirmedChanges > 0 && h('p', { className: 'pw-text pw-error' }, t('unconfirmedChanges')),
    passed > 0 && h('p', { className: 'pw-text' }, t('checksPassed').replace('{n}', String(passed))),
    !passed && !failed && !incomplete && !hasManualEvidence && h('p', { className: 'pw-text' }, t('noChecks')),
    hasManualEvidence && h('p', { className: 'pw-text' }, t('manualEvidence')))
}

export function hasTaskVerificationRecords(task, result) {
  return !!(result.fullSummary || result.fullLimits || task.evidence?.trim() || task.objective?.trim())
}

export function TaskVerificationRecords({ task, t, since }) {
  const result = taskResult(task, since)
  const roundStart = Math.max(Number(since) || 0, Number(task.deliveryStartedAt) || 0, Number(task.requirementDeliveryStartedAt) || 0)
  return h('section', { className: 'pw-task-evidence', 'aria-label': t('verify') },
    h(ReadingText, { label: t(result.previousSummary ? 'previousResultUnverified' : 'fullResult'), value: result.fullSummary }),
    h(ReadingText, { label: t(result.unverifiedLimits ? 'previousLimits' : 'demoLimits'), value: result.fullLimits }),
    h(ReadingText, { label: t((Number(task.evidenceAt) || 0) < roundStart ? 'taskPreviousEvidence' : 'demoEvidence'), value: task.evidence }),
    h(ReadingText, { label: t('taskObjectiveRecords'), value: task.objective }),
    !hasTaskVerificationRecords(task, result) && h('p', { className: 'pw-note' }, t('taskNoVerificationRecords')))
}

export function TaskResult({ task, t, children, since, userFacing = false, showAcceptance = true, showSummary = true, onReadEvidence, evidenceOpen, reviewTools }) {
  const result = taskResult(task, since)
  const reviewing = task.status === 'in_review'
  if (userFacing) {
    const summary = result.recordedSummary
    const earlier = (result.previousSummary || result.earlierSummary).replace(/\r?\n\r?\n\[AI 补充\] /g, '\n\n')
    const criteria = showAcceptance && h(ReadingText, {
      label: t('requirementCriteria'), value: task.acceptance?.trim() || t('missingCriteria'), className: 'pw-reading-criteria',
    })
    if (reviewTools) {
      const { passed, failed, incomplete, unconfirmedChanges, hasManualEvidence } = result.verification
      const checks = [
        failed > 0 && t('checksFailed').replace('{n}', String(failed)),
        incomplete > 0 && t('taskReviewIncomplete').replace('{n}', String(incomplete)),
        unconfirmedChanges > 0 && t('taskReviewUnverified').replace('{n}', String(unconfirmedChanges)),
        passed > 0 && t('checksPassed').replace('{n}', String(passed)),
      ].filter(Boolean)
      return h('section', { className: 'pw-reading pw-reading-result pw-task-acceptance', 'aria-label': t('demoResult') },
        h('div', { className: 'pw-task-review-compare' },
          criteria,
          h(ReadingText, { label: t('demoResult'), value: summary || t(result.previousSummary ? 'taskReviewOldResult' : 'demoNoResult') })),
        h(ReadingText, { label: t('demoLimits'), value: result.limits, className: 'pw-reading-reason pw-reading-warning' }),
        h('div', { className: 'pw-task-review-checks' },
          h('div', null,
            h('h3', { className: 'pw-reading-label' }, t('taskReviewChecks')),
            h('p', { className: 'pw-note' }, checks.join(' · ') || t(hasManualEvidence ? 'manualEvidence' : 'noChecks'))),
          hasTaskVerificationRecords(task, result) && h('button', { type: 'button', className: 'pw-button', onClick: onReadEvidence,
            'aria-expanded': evidenceOpen }, t('taskOpenRecords'), h('span', { className: 'pw-reading-chevron', 'aria-hidden': true }, '›'))),
        reviewTools)
    }
    if (onReadEvidence) return h('section', { className: 'pw-reading pw-reading-result pw-task-acceptance', 'aria-label': t('demoResult') },
      h(ReadingText, { label: t('demoResult'), value: summary || t('demoNoResult'), className: 'pw-reading-lead' }),
      h('div', { className: 'pw-task-verification-pair' },
        criteria,
        h('div', { className: 'pw-task-verification' },
          h(Verification, { verification: result.verification, t }),
          hasTaskVerificationRecords(task, result) &&
            h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: onReadEvidence }, t('verifyRecords')))),
      (summary && !result.summary || !summary && result.previousSummary) &&
        h('p', { className: 'pw-note' }, t(summary ? 'resultUnverified' : 'previousResultUnverified')),
      h(ReadingText, {
        label: t('demoLimits'), value: result.limits || t(result.unverifiedLimits ? 'limitsUnverified' : 'noLimits'),
        className: result.limits || result.unverifiedLimits ? 'pw-reading-reason pw-reading-warning' : '',
      }),
      children)
    return h('section', { className: 'pw-reading pw-reading-result' + (showSummary ? '' : ' pw-sidebar-review'),
      'aria-label': t(showSummary ? 'demoResult' : 'sidebarReviewDetails') },
      showSummary && h(ReadingText, { label: t('demoResult'), value: summary || t('demoNoResult'), className: 'pw-reading-lead' }),
      criteria,
      h(Verification, { verification: result.verification, t }),
      result.verification.hasManualEvidence && h(ReadingText, { label: t('demoEvidence'), value: task.evidence }),
      task.hasObjective && !result.verification.hasManualEvidence && result.summary && h('p', { className: 'pw-note pw-evidence-note' }, t('useRecordedEvidence')),
      summary && !result.summary && h('p', { className: 'pw-note' }, t('resultUnverified')),
      h(ReadingText, { label: t('demoLimits'), value: result.limits || t(result.unverifiedLimits ? 'limitsUnverified' : 'noLimits') }),
      earlier && !showSummary && h('p', { className: 'pw-note' }, t('previousResultUnverified')),
      earlier && showSummary && h(Disclosure, { label: t('previousResultUnverified') },
        h(ReadingText, { value: earlier }),
        result.unverifiedLimits && h(ReadingText, { label: t('previousLimits'), value: result.unverifiedLimits })),
      (!earlier || !showSummary) && result.unverifiedLimits && h(Disclosure, { label: t('previousLimits') },
        h(ReadingText, { value: result.unverifiedLimits })),
      children)
  }
  const showResult = reviewing || !!result.summary
  return h(React.Fragment, null,
    (showResult || result.verification.failed > 0 || result.verification.incomplete > 0 || result.verification.unconfirmedChanges > 0) &&
      h('section', { className: 'pw-result', 'aria-label': t('demoResult') },
        showResult && h(ReadText, { label: t(result.latestSupplement ? 'latestSupplement' : 'demoResult'), value: result.summary || t('demoNoResult') }),
        showResult && h(ReadText, { label: t('acceptanceField'), value: task.acceptance }),
        h(Verification, { verification: result.verification, t }),
        showResult && h(ReadText, { label: t('demoLimits'), value: result.limits || t(result.unverifiedLimits ? 'limitsUnverified' : 'noLimits') }),
        children),
    (task.evidence || task.objective || result.previousSummary || result.fullSummary !== result.summary || result.fullLimits !== result.limits || (!showResult && result.fullLimits)) &&
      h(Disclosure, { label: t('verifyRecords') },
        result.latestSupplement ? h(React.Fragment, null,
          h(ReadText, { label: t('previousResult'), value: result.earlierSummary }),
          h(ReadText, { label: t('latestSupplement'), value: result.latestSupplement }),
          h(ReadText, { label: t('fullResult'), value: result.fullSummary }))
          : h(ReadText, { label: t(result.previousSummary ? 'previousResult' : 'demoResult'), value: result.fullSummary }),
        h(ReadText, { label: t(result.unverifiedLimits ? 'previousLimits' : 'demoLimits'), value: result.fullLimits }),
        h(ReadText, { label: t('demoEvidence'), value: task.evidence }),
        h(ReadText, { value: task.objective })))
}

export function TaskReferences({ refs, openWikiPage }) {
  return h('div', null, refs.map(ref => {
    const wiki = /^(?:openwiki\/|wiki:)/.test(ref)
    return wiki && openWikiPage
      ? h('button', { key: ref, className: 'pw-button', onClick: () => openWikiPage(ref.replace(/^(?:openwiki\/|wiki:)/, '')) }, ref)
      : h('span', { key: ref, className: 'pw-refchip' }, ref)
  }))
}

export function TaskReading({ task, requirement, t, openWikiPage, onAdd, sidebar = false, resultActions, children, since, onReadProgress, onReadEvidence,
  evidenceOpen, reviewTools, hidePriorResult }) {
  const resultFirst = ['in_review', 'done'].includes(task.status)
  const result = taskResult(task, since)
  const hasResult = result.fullSummary || result.fullLimits || result.verification.failed ||
    result.verification.incomplete || result.verification.unconfirmedChanges
  if (sidebar) {
    const overview = taskOverview(task)
    const description = task.description?.trim()
    const supplementary = description !== overview ? description : ''
    const scope = requirement?.scope?.trim()
    const exclusions = requirement?.q_out?.trim()
    return h('div', { className: 'pw-reading' },
      task.status === 'blocked' && h(ReadingText, {
        label: t('blockedReason'), value: task.blocked_reason?.trim() || t('taskNoReason'), className: 'pw-reading-reason pw-reading-warning',
      }),
      task.status === 'cancelled' && h(ReadingText, {
        label: t('taskCancelReason'), value: cancellationReason(task) || t('taskNoReason'), className: 'pw-reading-reason',
      }),
      h(ReadingText, { label: t('sidebarTaskDescription'), value: overview || t('taskMissing'), className: 'pw-reading-lead' }),
      h(ReadingText, { label: t('sidebarFinding'), value: task.rootCause?.trim() || t('sidebarNotRecorded'),
        className: task.rootCause?.trim() ? undefined : 'pw-sidebar-empty-field' }),
      h(ReadingText, { label: t('taskSteps'), value: task.triggerPath }),
      requirement && h('section', { className: 'pw-reading-block pw-reading-divider' },
        h('h3', { className: 'pw-reading-label' }, t('sidebarRequirementScope')),
        h(ReadingText, { value: scope || (!exclusions && t('sidebarNotRecorded')) }),
        h(ReadingText, { label: t('q_out'), value: exclusions })),
      !resultFirst && h(ReadingText, { label: t('requirementCriteria'), value: task.acceptance, className: 'pw-reading-criteria' }),
      resultFirst && h(TaskResult, { task, t, since, userFacing: true, showSummary: false }, resultActions),
      !resultFirst && task.status !== 'cancelled' && !!hasResult && h(TaskResult, { task, t, since, userFacing: true, showAcceptance: false, showSummary: false }),
      children,
      (supplementary || task.refs?.length > 0) && h(Disclosure, { label: t('taskAdditional') },
        h(ReadingText, { label: t('taskSupplement'), value: supplementary }),
        task.refs?.length > 0 && h(TaskReferences, { refs: task.refs, openWikiPage })))
  }
  const progress = h(UpdateLog, { activity: task.activity, t, onAdd: ['done', 'cancelled'].includes(task.status) ? null : onAdd, userFacing: true, onReadProgress })
  return h('div', { className: 'pw-reading pw-task-reading' },
    task.status === 'blocked' && h(ReadingText, {
      label: t('blockedReason'), value: task.blocked_reason?.trim() || t('taskNoReason'), className: 'pw-reading-reason pw-reading-warning',
    }),
    task.status === 'cancelled' && h(ReadingText, {
      label: t('taskCancelReason'), value: cancellationReason(task) || t('taskNoReason'), className: 'pw-reading-reason',
    }),
    resultFirst && h(TaskResult, { task, t, since, userFacing: true, onReadEvidence, evidenceOpen, reviewTools }, resultActions),
    !resultFirst && h(ReadingText, { label: t('requirementCriteria'), value: task.acceptance?.trim() || t('missingCriteria'), className: 'pw-reading-criteria' }),
    !resultFirst && task.status !== 'cancelled' && !hidePriorResult && !!hasResult && h(TaskResult, { task, t, since, userFacing: true, showAcceptance: false, onReadEvidence }),
    children,
    progress)
}

export function DraftSuggestions({ proposals, act, root, t, busy, dismissMethod = 'sync/dismiss', showHeading = true, rememberEdits, adoptDisabled = false }) {
  const [edits, setEdits] = useState(() => ({ ...rememberEdits }))
  if (!proposals.length) return null
  return h('section', { className: 'pw-result', 'aria-label': t('demoDrafts') },
    showHeading && h('strong', null, t('demoDrafts')),
    proposals.map(proposal => {
      const patch = proposal.suggested_patch ?? {}
      const creating = proposal.kind === 'new_task'
      const values = edits[proposal.id] ?? (creating ? issueDraftFrom(patch) : patch)
      const fields = Object.entries(values).filter(([key]) => key !== 'action')
      const change = (key, value) => {
        const next = { ...values, [key]: value }
        if (rememberEdits) rememberEdits[proposal.id] = next
        setEdits(previous => ({ ...previous, [proposal.id]: next }))
      }
      const missing = creating && taskFormError(values)
      const canAdopt = creating ? !missing : fields.length && fields.every(([, value]) => String(value).trim())
      const revised = creating ? taskContentPatch(values, patch) : edits[proposal.id]
      return h('div', { key: proposal.id, className: 'pw-disclosure' },
        creating && h('strong', null, t('newTask')),
        h(ReadText, { value: proposal.reason }),
        proposal.split && h(ReadText, { label: t('splitBasis'), value: proposal.split.requirements?.map(item => item.text).join('\n') }),
        creating ? h(TaskFields, { form: { draft: values, change }, t, busy, focus: null })
          : fields.map(([key, value]) => h('label', { key, className: 'pw-field' },
          h('span', { className: 'pw-label' }, draftFieldLabel(key, t)),
          h('textarea', { className: 'pw-textarea', rows: 2, value, onChange: event => change(key, event.target.value) }))),
        creating && h(ErrorDetails, { error: missing, t, showRaw: false }),
        h('div', { className: 'pw-actions' },
          h('button', { className: 'pw-button', disabled: busy || adoptDisabled || !canAdopt, onClick: () => act('proposal/adopt', { root, proposalId: proposal.id, patch: revised }) }, t(proposal.split ? 'splitAdopt' : 'demoAdopt')),
          h('button', { className: 'pw-button', disabled: busy, onClick: () => act(dismissMethod, { root, proposalId: proposal.id }) }, t('demoDismiss'))))
    }))
}
