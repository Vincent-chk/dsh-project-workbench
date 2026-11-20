import React from 'react'
import { effectiveEvidence } from '../../core/state.js'
import { rpc } from '../api.js'
import { issueDraftFrom, newTaskInput, taskFormError } from '../project-state.js'
import { ErrorDetails, Modal } from './ui.js'
import { TaskFields, TaskForm } from '../forms/task-form.js'
import { RequirementFields } from '../forms/requirement-form.js'
import { TaskResult } from '../detail/task-content.js'
import { DeliveryResult, ManualDelivery } from '../detail/requirement-content.js'
import { taskResult } from '../workbench-content.js'

const h = React.createElement
const { useEffect, useState } = React

// 关键操作弹窗：原因收集、送审/验收确认、打回与重开（含部分成功接续）、
// 人工交付提交、草稿删除。提交中禁止重复操作，失败保留输入与真实状态。
export function ReasonModal({ modal, t, setModal, mutate, root, trashWithUndo, reopenState, requirements, newDraft, changeNewDraft, createReq, clearNewDraft, locatePrdLink }) {
  const [value, setValue] = useState('')
  const [checked, setChecked] = useState([])
  const [newTask, setNewTask] = useState(issueDraftFrom)
  const [addingTask, setAddingTask] = useState(false)
  const [reviewIssue, setReviewIssue] = useState(modal.issue)
  const [reviewReq, setReviewReq] = useState(modal.req)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [deliveryFailed, setDeliveryFailed] = useState(false)
  useEffect(() => {
    if (modal.kind !== 'submitDelivery') return
    let active = true
    rpc('delivery/status', { root, reqId: modal.req.id }).then(res => {
      if (active && res.ok) setDeliveryFailed(res.data.job?.status === 'failed')
    })
    return () => { active = false }
  }, [modal, root])
  const close = (saved = false) => {
    setModal(current => current === modal ? null : current)
    modal.restoreFocus?.(saved === true)
  }
  // 其他详情可以展示刷新后的数据。验收确认使用打开时展示的快照，
  // 避免轮询悄悄替换用户正在核对的内容。
  const liveReq = modal.req && requirements
    ? (requirements.find(r => r.id === modal.req.id) ?? modal.req)
    : modal.req
  const cancel = () => { if (!busy) close() }
  const run = async action => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await action()
    if (res.ok) close(true)
    else { setError(res); setBusy(false) }
  }
  const errorView = h(ErrorDetails, { error, t, showRaw: false })
  const taskForm = { draft: newTask, change: (name, value) => { setError(null); setNewTask(draft => ({ ...draft, [name]: value })) } }
  if (modal.kind === 'createRequirement') {
    const formId = 'pw-create-requirement'
    const form = { draft: newDraft, change: (name, value) => { setError(null); changeNewDraft(name, value) } }
    return h(Modal, { title: t('newRequirement'), onClose: cancel, wide: true, actions: [
      h('button', { type: 'button', className: 'pw-button', disabled: busy,
        onClick: () => { clearNewDraft(); cancel() } }, t('cancel')),
      h('button', { type: 'submit', form: formId, className: 'pw-button primary', disabled: busy }, t('save')),
    ] }, h('form', { id: formId, noValidate: true, onSubmit: e => { e.preventDefault(); run(createReq) } },
      h(RequirementFields, { form, t, busy, autoFocus: true }), errorView))
  }
  if (modal.kind === 'createTask') {
    const create = async () => {
      const invalid = taskFormError(newTask)
      if (invalid) return invalid
      const result = await mutate('issue/create', { root, reqId: modal.req.id, ...newTaskInput(newTask) }, { inlineError: true })
      if (result.ok) modal.onCreated(result.data.id)
      return result
    }
    return h(Modal, { title: t('newTask'), onClose: cancel, wide: true, actions: [] },
      h('p', { className: 'pw-note' }, modal.req.title),
      h(TaskForm, { form: taskForm, t, busy, error, onSave: () => run(create), onCancel: cancel }))
  }
  if (modal.kind === 'moveError') {
    const needsPrd = modal.error?.code === 'REVIEW_PRD_REQUIRED' && !!modal.reqId
    return h(Modal, { title: t('moveRejectedTitle'), onClose: close, actions: [
      h('button', { key: 'close', className: 'pw-button' + (needsPrd ? '' : ' primary'), onClick: close }, t('ok')),
      needsPrd && h('button', { key: 'prd', className: 'pw-button primary', onClick: () => { close(); locatePrdLink(modal.reqId) } }, t('prdGoLink')),
    ] }, needsPrd ? h('p', { role: 'alert' }, t('reviewPrdRequired'))
      : h(ErrorDetails, { error: modal.error ?? { message: modal.message }, t, showRaw: false }))
  }
  if (modal.kind === 'reason') {
    const submit = () => { if (value.trim()) return run(() => modal.onOk(value.trim())) }
    return h(Modal, { title: modal.title ?? t('reasonTitle'), onClose: cancel, actions: [
      h('button', { className: 'pw-button', disabled: busy, onClick: cancel }, t('cancel')),
      h('button', { className: 'pw-button primary', disabled: busy || !value.trim(), onClick: submit }, t('ok')),
    ] }, modal.body && h('p', null, modal.body),
    h('input', { className: 'pw-input', autoFocus: true, readOnly: busy, 'aria-label': t('reasonTitle'), placeholder: t('reasonPlaceholder'), value,
      onChange: e => setValue(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit() } }),
    errorView)
  }
  if (modal.kind === 'rejectTaskAcceptance') {
    const { issue, reqId } = modal
    const reject = () => mutate('issue/continue', { root, reqId, id: issue.id, text: value.trim(), fileHash: issue.hash }, { inlineError: true })
    return h(Modal, { title: t('taskReject'), onClose: cancel, actions: [
      h('button', { type: 'button', className: 'pw-button', disabled: busy, onClick: cancel }, t('cancel')),
      h('button', { type: 'button', className: 'pw-button primary', disabled: busy || !value.trim(), onClick: () => run(reject) }, t('taskConfirmReject')),
    ] }, h('p', null, issue.title),
    h('label', { className: 'pw-field' }, h('span', { className: 'pw-label' }, t('askFix')),
      h('textarea', { className: 'pw-textarea', rows: 3, autoFocus: true, required: true, readOnly: busy,
        placeholder: t('taskRejectHint'), value, onChange: e => setValue(e.target.value) })),
    h('p', { className: 'pw-note' }, t('taskRejectEffect')), errorView)
  }
  if (modal.kind === 'submitDelivery') {
    const submit = async (method, input) => {
      setBusy(true)
      const res = await mutate(method, input, { inlineError: true })
      if (!res.ok) setBusy(false)
      return res
    }
    return h(Modal, { title: t('submit'), onClose: cancel, wide: true, actions: [
      h('button', { className: 'pw-button', disabled: busy, onClick: cancel }, t('cancel')),
    ] },
    h('p', null, liveReq.title),
    deliveryFailed && h('p', { className: 'pw-error' }, t('demoDeliveryFailed')),
    h(ManualDelivery, { req: liveReq, t, act: submit, root, busy, userFacing: true, onSuccess: close }))
  }
  if (modal.kind === 'confirmComplete' || modal.kind === 'confirmIssue') {
    const issue = reviewIssue
    const confirm = async () => {
      const res = await mutate('issue/confirm', { root, reqId: modal.reqId, id: issue.id, fileHash: issue.hash }, { inlineError: true })
      if (res.code !== 'CONFLICT') return res
      const latest = await rpc('requirement/get', { root, id: modal.reqId })
      if (!latest.ok) return latest
      const current = latest.data.issues.find(task => task.id === issue.id)
      if (!current) return { ok: false, code: 'NOT_FOUND' }
      setReviewIssue(current)
      setReviewReq(latest.data)
      return res
    }
    const confirmRequirement = async () => {
      const res = await modal.onOk(reviewReq)
      if (res.code !== 'CONFLICT' && res.code !== 'ROUND_CHANGED') return res
      const latest = await rpc('requirement/get', { root, id: reviewReq.id })
      if (latest.ok) { setReviewReq(latest.data); return { ...res, code: 'REVIEW_CONTENT_UPDATED' } }
      return res
    }
    return h(Modal, { title: t(issue ? 'taskConfirmAccept' : 'confirmCompleteTitle'), onClose: cancel, wide: true, actions: [
      h('button', { className: 'pw-button', autoFocus: !!issue, disabled: busy, onClick: cancel }, t('cancel')),
      h('button', { className: 'pw-button primary', disabled: busy || (issue && (issue.status !== 'in_review' || !taskResult(issue, reviewReq?.deliveryStartedAt).summary || !String(effectiveEvidence(issue)).trim())),
        onClick: () => run(issue ? confirm : confirmRequirement) }, t(issue ? 'taskAccept' : 'acceptRequirement')),
    ] }, h('p', null, issue?.title ?? reviewReq.title),
    issue ? h(TaskResult, { task: issue, since: reviewReq?.deliveryStartedAt, t, userFacing: true }) : h(DeliveryResult, { req: reviewReq, t, userFacing: true }),
    errorView)
  }
  if (modal.kind === 'reopenRequirement') {
    const req = liveReq
    const retry = reopenState || req.pendingReopen
    const submit = () => run(() => {
      const invalid = !retry && addingTask && taskFormError(newTask)
      if (invalid) return invalid
      return mutate('requirement/reopen', retry ? { root, id: req.id } : {
        root, id: req.id, reason: value.trim(), reopen: checked, create: addingTask ? [newTaskInput(newTask)] : [], fileHash: req.hash,
      }, { inlineError: true })
    })
    return h(Modal, { title: t(retry ? 'resumeReopen' : req.status === 'completed' ? 'reopen' : 'sendBack'), onClose: cancel, actions: [
      h('button', { className: 'pw-button', disabled: busy, onClick: close }, t('cancel')),
      h('button', { className: 'pw-button primary', disabled: busy || (!retry && (!value.trim() || (!checked.length && !addingTask))), onClick: submit }, t(retry ? 'retry' : req.status === 'completed' ? 'reopen' : 'sendBack')),
    ] },
    h('p', null, req.title),
    retry && h('p', null, t('reopenProgress').replace('{done}', String(retry.items.filter(item => item.done).length)).replace('{total}', String(retry.items.length))),
    !retry && h(React.Fragment, null,
      h('textarea', { className: 'pw-textarea', 'aria-label': t('askFix'), placeholder: t('askFix'), value, readOnly: busy, onChange: e => setValue(e.target.value) }),
      h('p', null, t('pickReopen')),
      (req.issues ?? []).filter(i => ['done', 'cancelled'].includes(i.status)).map(i =>
        h('label', { key: i.id }, h('input', { type: 'checkbox', disabled: busy, checked: checked.includes(i.id), onChange: e => {
          const selected = e.target.checked
          setChecked(prev => selected ? [...prev, i.id] : prev.filter(id => id !== i.id))
        } }), i.title)),
      h('label', { className: 'pw-field' }, h('input', { type: 'checkbox', checked: addingTask, disabled: busy,
        onChange: event => { setError(null); setAddingTask(event.target.checked) } }), ' ', t('newTask')),
      addingTask && h(TaskFields, { form: taskForm, t, busy })),
    errorView)
  }
  if (modal.kind === 'delete') {
    const n = (modal.req.issues ?? []).length
    return h(Modal, { title: t('deleteTitle'), onClose: close, actions: [
      h('button', { className: 'pw-button', onClick: close }, t('cancel')),
      h('button', { className: 'pw-button danger', onClick: () => { setModal(null); trashWithUndo('requirement', modal.req.id, undefined, modal.req.title) } }, t('delete')),
    ] }, h('p', null, t('deleteBody').replace('{title}', modal.req.title).replace('{n}', String(n))))
  }
  return null
}
