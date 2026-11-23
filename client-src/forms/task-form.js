import React from 'react'
import { draftOf, issueDraftFrom, sameDraft, taskContentPatch } from '../project-state.js'
import { Disclosure, ErrorDetails, Modal } from '../shared/ui.js'
import { taskResult } from '../workbench-content.js'

const h = React.createElement
const { useEffect, useRef, useState } = React

export function EditableField({ form, name, label, rows, disabled, required, autoFocus }) {
  const props = {
    className: rows ? 'pw-textarea' : 'pw-input', value: form.draft[name] ?? '',
    name, disabled, required, autoFocus,
    onChange: event => form.change(name, event.target.value),
  }
  return h('label', { className: 'pw-field' }, h('span', { className: 'pw-label' }, label,
    required && h('span', { 'aria-hidden': true }, ' *')),
    rows ? h('textarea', { ...props, rows }) : h('input', props))
}

export function TaskFields({ form, t, busy, focus = 'title', requireAcceptance = false }) {
  const field = (name, label, rows, required) => h(EditableField, { form, name, label: t(label), rows, required, disabled: busy, autoFocus: focus === name })
  return h('div', { className: 'pw-task-fields' },
    field('title', 'issueTitle', 0, true),
    field('problemOverview', 'taskOverviewField', 1, true),
    field('acceptance', requireAcceptance ? 'taskCriteriaField' : 'taskCriteriaOptional', 2, requireAcceptance),
    h(Disclosure, { label: t('taskAdditional') },
      field('triggerPath', 'taskSteps', 2), field('rootCause', 'taskCause', 2),
      field('description', 'taskSupplement', 2), field('refs', 'taskRefsInput', 2)))
}

export function TaskForm({ form, t, busy, error, focus, onSave, onCancel }) {
  return h('form', { noValidate: true, onSubmit: event => { event.preventDefault(); onSave() } },
    h(TaskFields, { form, t, busy, focus }),
    h(ErrorDetails, { error, t, showRaw: false }),
    h('div', { className: 'pw-actions' },
      h('button', { type: 'submit', className: 'pw-button primary', disabled: busy }, t('save')),
      h('button', { type: 'button', className: 'pw-button pw-quiet', disabled: busy, onClick: onCancel }, t('cancel'))))
}

export function TaskResultForm({ task, t, busy, onSave, onClose, since: requirementSince }) {
  const [original] = useState(task)
  const since = Math.max(Number(original.deliveryStartedAt) || 0, Number(original.requirementDeliveryStartedAt) || 0, Number(requirementSince) || 0)
  const objective = original.hasObjective && (Number(original.objectiveAt) || 0) >= since
  const result = taskResult(original, since)
  const limitsCurrent = Number(original.knownLimitsAt) > 0 && Number(original.knownLimitsAt) >= since
  const [draft, setDraft] = useState(() => ({ resultSummary: result.recordedSummary,
    evidence: (Number(original.evidenceAt) || 0) >= since ? original.evidence ?? '' : '', knownLimits: limitsCurrent ? original.knownLimits ?? '' : '' }))
  const [limitsTouched, setLimitsTouched] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const locked = saving || busy
  const form = { draft, change: (name, value) => { if (name === 'knownLimits') setLimitsTouched(true); setDraft(previous => ({ ...previous, [name]: value })); setError(null) } }
  const submit = async () => {
    if (locked) return
    if (!draft.resultSummary.trim() || (!draft.evidence.trim() && !objective)) {
      setError({ code: 'RESULT_EVIDENCE_REQUIRED' }); return
    }
    setSaving(true)
    const patch = Object.fromEntries(Object.entries(draft).map(([name, value]) => [name, value.trim()]))
    if (!limitsTouched) delete patch.knownLimits
    const result = await onSave({ patch, fileHash: original.hash, recordResult: true })
    if (result?.ok) onClose()
    else { setError(result ?? { code: 'SESSION_BUSY' }); setSaving(false) }
  }
  const formId = 'pw-record-task-result'
  return h(Modal, { title: t('recordTaskResult'), wide: true, onClose: () => { if (!locked) onClose() }, actions: [
    h('button', { type: 'button', className: 'pw-button pw-quiet', disabled: locked, onClick: onClose }, t('cancel')),
    h('button', { type: 'submit', form: formId, className: 'pw-button primary', disabled: locked }, t('save')),
  ] }, h('form', { id: formId, noValidate: true, onSubmit: event => { event.preventDefault(); submit() } },
    h(EditableField, { form, name: 'resultSummary', label: t('demoResult'), rows: 3, required: true, autoFocus: true, disabled: locked }),
    result.unverifiedResultContext && h(Disclosure, { label: t('previousResult') },
      h('p', { className: 'pw-text', style: { whiteSpace: 'pre-wrap' } }, result.unverifiedResultContext)),
    objective && h('p', { className: 'pw-note' }, t('useRecordedEvidence')),
    h(EditableField, { form, name: 'evidence', label: t('demoEvidence'), rows: 3, required: !objective, disabled: locked }),
    h(EditableField, { form, name: 'knownLimits', label: t('demoLimits'), rows: 2, disabled: locked }),
    !limitsCurrent && !!original.knownLimits?.trim() && h(Disclosure, { label: t('previousLimits') },
      h('p', { className: 'pw-text', style: { whiteSpace: 'pre-wrap' } }, original.knownLimits)),
    h(ErrorDetails, { error, t, showRaw: false })))
}

// The saved base never moves while a dirty draft exists. Polling may replace the
// reading view, but cannot overwrite user input or the fingerprint used to save it.
export function useTaskDraft(draftKey, item, memory) {
  const remembered = memory.drafts[draftKey]
  const [editing, setEditing] = useState(() => !!remembered)
  const [draft, setDraft] = useState(() => draftOf(memory.drafts, draftKey, issueDraftFrom(item)))
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const base = useRef({ fields: issueDraftFrom(item), fileHash: remembered?.fileHash ?? item.hash })
  const previousHash = useRef(item.hash)
  const dirty = !!memory.drafts[draftKey] || !sameDraft(draft, base.current.fields)

  useEffect(() => {
    if (previousHash.current === item.hash) return
    previousHash.current = item.hash
    if (dirty) { setUpdateAvailable(true); return }
    base.current = { fields: issueDraftFrom(item), fileHash: item.hash }
    setDraft(base.current.fields)
  }, [item, dirty])

  const begin = () => {
    base.current = { fields: issueDraftFrom(item), fileHash: item.hash }
    previousHash.current = item.hash
    setDraft(base.current.fields)
    setUpdateAvailable(false)
    setEditing(true)
  }
  const change = (key, value) => {
    const next = { ...draft, [key]: value }
    const nextDirty = !sameDraft(next, base.current.fields)
    setDraft(next)
    if (nextDirty) memory.drafts[draftKey] = { fields: next, fileHash: memory.drafts[draftKey]?.fileHash ?? base.current.fileHash }
    else delete memory.drafts[draftKey]
  }
  const finish = () => {
    delete memory.drafts[draftKey]
    setEditing(false)
    setUpdateAvailable(false)
  }
  const loadUpdate = () => {
    delete memory.drafts[draftKey]
    base.current = { fields: issueDraftFrom(item), fileHash: item.hash }
    previousHash.current = item.hash
    setDraft(base.current.fields)
    setUpdateAvailable(false)
  }
  const params = () => ({ patch: taskContentPatch(draft, item), fileHash: memory.drafts[draftKey]?.fileHash ?? base.current.fileHash })
  return { editing, begin, finish, params, draft, change, dirty, updateAvailable, keepUpdate: () => setUpdateAvailable(false), loadUpdate }
}
