import React from 'react'
import { startBlockers } from '../../core/state.js'
import { issueDraftKey, issueDraftFrom, taskContentPatch, taskFormError } from '../project-state.js'
import { ErrorDetails } from '../shared/ui.js'
import { TaskReading } from './task-content.js'
import { AcceptanceAssist } from './acceptance-assist.js'
import { taskResult } from '../workbench-content.js'
import { TaskForm, TaskResultForm } from '../forms/task-form.js'
import { useWorkItemDraft } from './requirement-detail.js'

const h = React.createElement
const { useEffect, useState } = React

// 任务详情：先读该状态最重要的事实；阅读、编辑、记录结果、补充说明与
// 明确的开始/继续处理入口。查看与定位不触发执行（PRD §7.8、§9.2）。
export function IssueDetail({ issue, req, t, root, mutate, openWikiPage, openTask, onStartTask, onMoveIssue, projectKey, rootRef, onDirty, busy, uiMemory, editFocus, runFact }) {
  const form = useWorkItemDraft(issueDraftKey(projectKey, req.id, issue.id), issue, issueDraftFrom, onDirty, uiMemory)
  const [formError, setFormError] = useState(null)
  const [formFocus, setFormFocus] = useState('title')
  const [recording, setRecording] = useState(false)
  const [supplementing, setSupplementing] = useState(false)
  const [supplement, setSupplement] = useState('')
  const [notice, setNotice] = useState('')
  const [assistRunning, setAssistRunning] = useState(false)
  // 缺开始前必填项时从开始入口直接定位到对应字段。
  useEffect(() => {
    if (editFocus && !['done', 'cancelled'].includes(issue.status)) { setFormFocus(editFocus); form.begin() }
  }, [])
  const save = async () => {
    if (busy) return
    const invalid = taskFormError(form.draft)
    if (invalid) { setFormError(invalid); return }
    const { fileHash } = form.params()
    const patch = taskContentPatch(form.draft, issue)
    if (!Object.keys(patch).length && fileHash === issue.hash) { form.finish(); return }
    const res = await mutate('issue/update', { root, reqId: req.id, id: issue.id, patch, fileHash }, { inlineError: true })
    if (res.ok && rootRef.current === root) form.finish()
    else if (rootRef.current === root) setFormError(res)
  }
  const terminal = ['done', 'cancelled'].includes(issue.status)
  const editing = form.editing && !terminal
  const inactive = req.status !== 'in_progress' || !!req.pendingReopen
  const mayRecord = !inactive && ['todo', 'doing', 'blocked'].includes(issue.status)
  const reviewing = !inactive && issue.status === 'in_review'
  const hasResult = !!taskResult(issue, req.deliveryStartedAt).summary
  const missing = startBlockers(issue)
  const runLocked = !!runFact && (['starting', 'running'].includes(runFact.runState) || runFact.sessionRunning)
  const begin = (focus = 'title') => { setFormFocus(focus); setFormError(null); form.begin() }
  const startWork = () => {
    if (missing.length) { begin(missing[0]); return }
    onStartTask(issue.id)
  }
  const saveSupplement = async event => {
    event.preventDefault()
    const value = supplement.trim()
    if (!value || busy) return
    const res = await mutate('issue/addUpdate', { root, reqId: req.id, id: issue.id, text: '阻塞补充：' + value }, { inlineError: true })
    if (res.ok && rootRef.current === root) { setSupplement(''); setSupplementing(false); setNotice(t('supplementSaved')) }
  }
  const actions = h('div', { className: 'pw-actions' },
    reviewing && h('button', { className: 'pw-button primary', disabled: busy || runLocked || assistRunning || !hasResult,
      onClick: () => onMoveIssue('done') }, t('demoConfirm')),
    reviewing && h('button', { className: 'pw-button', disabled: busy || runLocked || assistRunning,
      onClick: () => onMoveIssue('todo') }, t('reviseTask')),
    !terminal && !inactive && ['todo', 'doing', 'blocked'].includes(issue.status) &&
      h('button', { className: 'pw-button primary', disabled: busy || runLocked, title: runLocked ? t('runRunning') : undefined, onClick: startWork },
        t(missing.length ? 'completeTaskInfo' : issue.status === 'todo' ? 'startTask' : 'demoContinue')),
    issue.status === 'blocked' && !inactive &&
      h('button', { className: 'pw-button', disabled: busy, onClick: () => setSupplementing(v => !v) }, t('supplement')),
    h('button', { className: 'pw-button', disabled: busy, onClick: () => openTask(issue.id) }, t('openTaskSession')),
    mayRecord && hasResult && h('button', { className: 'pw-button', disabled: busy || runLocked,
      onClick: () => mutate('issue/move', { root, reqId: req.id, id: issue.id, to: 'in_review', fileHash: issue.hash }) }, t('submitTaskAcceptance')),
    mayRecord && h('button', { className: 'pw-button pw-quiet', disabled: busy, onClick: () => setRecording(true) }, t('recordTaskResult')))
  return h('section', { className: 'pw-subpage pw-issue-page' + (editing ? '' : ' pw-read-card'), 'aria-label': t('issueDetail') },
    h('header', { className: 'pw-subpage-head' },
      h('div', { className: 'pw-read-title' }, h('h2', null, issue.title),
        h('span', { className: 'pw-count pw-read-status', 'data-status': issue.status }, t('st_' + issue.status))),
      !editing && !terminal && h('button', { className: 'pw-button', onClick: () => begin() }, t('edit'))),
    notice && h('p', { className: 'pw-note', role: 'status' }, notice),
    runLocked && !editing && h('p', { className: 'pw-note', role: 'status' }, t('runRunning')),
    editing ? h(TaskForm, { form: { ...form, change: (...args) => { setFormError(null); form.change(...args) } }, t, busy, focus: formFocus, error: formError, onSave: save, onCancel: form.finish })
      : h(TaskReading, { task: issue, since: req.deliveryStartedAt, t, openWikiPage, onAdd: terminal || inactive ? undefined : text => mutate('issue/addUpdate', { root, reqId: req.id, id: issue.id, text }) },
        inactive && h('p', { className: 'pw-note' }, t(req.pendingReopen ? 'errReopenPending' : 'errNotActive')),
        reviewing && h(AcceptanceAssist, { req, issue, root, t, busy: busy || runLocked, memory: uiMemory, onRunningChange: setAssistRunning }),
        actions,
        supplementing && h('form', { className: 'pw-progress-form', onSubmit: saveSupplement },
          h('textarea', { className: 'pw-textarea', autoFocus: true, rows: 3, 'aria-label': t('supplement'), placeholder: t('supplementPlaceholder'), value: supplement, onChange: e => setSupplement(e.target.value) }),
          h('div', { className: 'pw-actions' },
            h('button', { type: 'submit', className: 'pw-button', disabled: busy || !supplement.trim() }, t('saveSupplement')),
            h('button', { type: 'button', className: 'pw-button pw-quiet', disabled: busy, onClick: () => setSupplementing(false) }, t('cancel'))))),
    recording && h(TaskResultForm, { task: issue, since: req.deliveryStartedAt, t, busy, onClose: () => setRecording(false),
      onSave: params => mutate('issue/update', { root, reqId: req.id, id: issue.id, ...params }, { inlineError: true }) }))
}
