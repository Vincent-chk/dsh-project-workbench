import React from 'react'
import { effectiveEvidence, startBlockers, taskOverview } from '../../core/state.js'
import { issueDraftKey, issueDraftFrom, taskContentPatch, taskFormError } from '../project-state.js'
import { ReadingLayout, ReadingLink } from '../shared/reading-drawer.js'
import { ReadingText, TaskReading, TaskReferences, TaskVerificationRecords, UpdateLog, hasTaskVerificationRecords } from './task-content.js'
import { AcceptanceAssist } from './acceptance-assist.js'
import { progressRecords, taskProgressRecords, taskResult, taskReworkReason } from '../workbench-content.js'
import { TaskForm, TaskResultForm } from '../forms/task-form.js'
import { useWorkItemDraft } from './requirement-detail.js'

const h = React.createElement
const { useEffect, useState } = React
const prdTrigger = 'pw-task-prds'

export const taskDetailLocale = {
  zh: {
    taskInfo: '任务信息', taskOpenInfo: '查看详情',
    taskInfoEmpty: '尚未记录操作步骤、根因或补充说明。',
    taskReadProgress: '查看完整进展', taskPreviousEvidence: '此前的人工验证记录', taskObjectiveRecords: '文件变更与命令记录',
    taskNoVerificationRecords: '暂无验证记录', taskReviewRecords: '验证记录', taskOpenRecords: '打开验证记录',
    taskGoToAcceptance: '去验收', taskAccept: '通过验收', taskReject: '驳回验收', taskReviewTitle: '验收任务',
    taskReviewInstruction: '核对完成标准和本轮结果。',
    taskReviewNeedsResult: '暂不能通过。请驳回并补齐本轮结果或验证记录，再重新提交。',
    taskReviewAssistRunning: '验收辅助正在运行，结束后可提交验收结论。',
    taskReviewChecks: '本轮检查', taskReviewIncomplete: '{n} 项检查待核实', taskReviewUnverified: '{n} 项改动待核实',
    taskReviewOldResult: '已有上次结果，可在验证记录中查看。', taskConfirmAccept: '确认通过验收',
    taskRejectHint: '写下哪里出了问题，以及希望怎样修改。', taskConfirmReject: '确认驳回',
    taskRejectEffect: '确认后，任务回到「进行中」。修改意见会保存到任务记录。',
    taskRejected: '验收未通过，已退回修改',
    taskReworkNext: '继续处理。修改后记录新结果和验证依据，再重新提交验收。',
    taskReworkReady: '本轮已有新的结果。核对后可重新提交验收。',
  },
  en: {
    taskInfo: 'Task information', taskOpenInfo: 'View details',
    taskInfoEmpty: 'No steps, root cause, or additional notes have been recorded.',
    taskReadProgress: 'Read full progress', taskPreviousEvidence: 'Previous manual verification record', taskObjectiveRecords: 'File changes and command records',
    taskNoVerificationRecords: 'No verification records yet', taskReviewRecords: 'Verification records', taskOpenRecords: 'Open verification records',
    taskGoToAcceptance: 'Review task', taskAccept: 'Accept task', taskReject: 'Reject and return', taskReviewTitle: 'Review for acceptance',
    taskReviewInstruction: 'Check the result against the completion criteria, then accept or return the task.',
    taskReviewNeedsResult: 'This round needs a new result or verification record. Return the task for changes before resubmitting it.',
    taskReviewAssistRunning: 'Wait for acceptance assistance to finish before making a decision.',
    taskReviewChecks: 'Checks this round', taskReviewIncomplete: '{n} checks to verify', taskReviewUnverified: '{n} changes to verify',
    taskReviewOldResult: 'A previous result is available in the verification records.', taskConfirmAccept: 'Confirm task acceptance',
    taskRejectHint: 'Describe what went wrong and what you want changed.', taskConfirmReject: 'Confirm return',
    taskRejectEffect: 'The task will move back to In progress. Your feedback will be saved in its activity.',
    taskRejected: 'Acceptance failed. Returned for changes.',
    taskReworkNext: 'Continue the work. After making the changes, record a new result and verification, then resubmit.',
    taskReworkReady: 'A new result is available. Check it and resubmit the task for acceptance.',
  },
}

// 任务详情：先读该状态最重要的事实；阅读、编辑、记录结果、补充说明与
// 明确的开始/继续处理入口。查看与定位不触发执行（PRD §7.8、§9.2）。
export function IssueDetail({ issue, req, t, root, mutate, openWikiPage, openTask, onStartTask, onMoveIssue, projectKey, rootRef, onDirty, busy, uiMemory, editFocus, runFact,
  renderPrds, initialPrdId, restorePrds, onClosePrds, modalActive }) {
  const form = useWorkItemDraft(issueDraftKey(projectKey, req.id, issue.id), issue, issueDraftFrom, onDirty, uiMemory)
  const [formError, setFormError] = useState(null)
  const [formFocus, setFormFocus] = useState('title')
  const [recording, setRecording] = useState(false)
  const [supplementing, setSupplementing] = useState(false)
  const [supplement, setSupplement] = useState('')
  const [notice, setNotice] = useState('')
  const [assistRunning, setAssistRunning] = useState(false)
  const [drawerView, setDrawerView] = useState(() => initialPrdId || restorePrds ? { kind: 'prds', trigger: prdTrigger, returnFocus: !!initialPrdId } : null)
  const [prdSummary, setPrdSummary] = useState(undefined)
  const scrollMemory = uiMemory.detailScroll ??= {}
  // 缺开始前必填项时从开始入口直接定位到对应字段。
  useEffect(() => {
    if (editFocus && !['done', 'cancelled'].includes(issue.status)) { setFormFocus(editFocus); form.begin() }
  }, [])
  useEffect(() => {
    if (initialPrdId || restorePrds) setDrawerView(previous => previous?.kind === 'prds' ? previous : { kind: 'prds', trigger: prdTrigger })
  }, [initialPrdId, restorePrds])
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
  const overview = taskOverview(issue)
  const description = issue.description?.trim()
  const supplementary = description !== overview ? description : ''
  const hasExtraInfo = !!(issue.triggerPath?.trim() || issue.rootCause?.trim() || supplementary || issue.refs?.length)
  const infoOpen = drawerView?.kind === 'info'
  const inactive = req.status !== 'in_progress' || !!req.pendingReopen
  const mayRecord = !inactive && ['todo', 'doing', 'blocked'].includes(issue.status)
  const reviewing = !inactive && issue.status === 'in_review'
  const result = taskResult(issue, req.deliveryStartedAt)
  const hasResult = !!result.summary
  const reviewReady = hasResult && !!String(effectiveEvidence(issue)).trim()
  const reworkReason = mayRecord && taskReworkReason(issue)
  const missing = startBlockers(issue)
  const runLocked = !!runFact && (['starting', 'running'].includes(runFact.runState) || runFact.sessionRunning)
  const showDrawer = (kind, trigger, initialProgress) => {
    if (drawerView?.kind === 'prds' && kind !== 'prds') onClosePrds?.()
    setDrawerView(kind ? { kind, trigger, initialProgress } : null)
  }
  const closeDrawer = () => showDrawer(null)
  const begin = (focus = 'title') => { closeDrawer(); setFormFocus(focus); setFormError(null); form.begin() }
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
  const reviewNotice = runLocked ? 'runRunning' : assistRunning ? 'taskReviewAssistRunning' : !reviewReady ? 'taskReviewNeedsResult' : null
  const reviewStep = reviewing && h('section', { className: 'pw-task-review-step', 'aria-labelledby': 'pw-task-acceptance' },
    h('div', { className: 'pw-task-review-head' },
      h('div', null,
        h('h3', { id: 'pw-task-acceptance', tabIndex: -1 }, t('taskReviewTitle')),
        h('p', { className: 'pw-note' }, t('taskReviewInstruction'))),
      h('div', { className: 'pw-actions' },
        h('button', { id: 'pw-task-accept', type: 'button', className: 'pw-button primary', disabled: busy || !!reviewNotice,
          'aria-describedby': reviewNotice ? 'pw-task-review-notice' : undefined,
          onClick: () => onMoveIssue('done', 'pw-task-accept') }, t('taskAccept')),
        h('button', { id: 'pw-task-reject', type: 'button', className: 'pw-button', disabled: busy || runLocked || assistRunning,
          onClick: () => onMoveIssue('doing', 'pw-task-reject') }, t('taskReject')))),
    reviewNotice && h('p', { id: 'pw-task-review-notice', className: 'pw-note pw-task-review-notice', role: 'status' }, t(reviewNotice)))
  const actions = h('div', { className: 'pw-actions' },
    mayRecord &&
      h('button', { className: 'pw-button' + (reworkReason && reviewReady ? '' : ' primary'), disabled: busy || runLocked, title: runLocked ? t('runRunning') : undefined, onClick: startWork },
        t(missing.length ? 'completeTaskInfo' : issue.status === 'todo' ? 'startTask' : 'demoContinue')),
    issue.status === 'blocked' && !inactive &&
      h('button', { className: 'pw-button', disabled: busy, onClick: () => setSupplementing(v => !v) }, t('supplement')),
    mayRecord && (reworkReason ? reviewReady : hasResult) && h('button', { className: 'pw-button' + (reworkReason ? ' primary' : ''), disabled: busy || runLocked,
      onClick: () => mutate('issue/move', { root, reqId: req.id, id: issue.id, to: 'in_review', fileHash: issue.hash }) }, t('submitTaskAcceptance')),
    h('button', { className: 'pw-button', disabled: busy, onClick: () => openTask(issue.id) }, t('openTaskSession')),
    mayRecord && h('button', { className: 'pw-button pw-quiet', disabled: busy, onClick: () => { closeDrawer(); setRecording(true) } }, t('recordTaskResult')))
  const readProgress = (event, activityKey) => {
    const index = progressRecords(issue.activity, t, 'issue').findIndex(entry => entry.key === activityKey)
    const entry = index >= 0 ? taskProgressRecords(issue.activity, t)[index] : null
    showDrawer('progress', event.currentTarget, entry?.id)
  }
  const readEvidence = event => drawerView?.kind === 'evidence' ? closeDrawer() : showDrawer('evidence', event.currentTarget)
  const rail = editing ? null : h(React.Fragment, null,
    renderPrds && h(ReadingLink, { id: prdTrigger, label: t('reqRelatedPrds'), summary: prdSummary, expanded: drawerView?.kind === 'prds',
      onClick: event => showDrawer('prds', event.currentTarget) }),
    h(ReadingLink, { label: t('progressRecords'), expanded: drawerView?.kind === 'progress', onClick: readProgress }),
    !reviewing && hasTaskVerificationRecords(issue, result) && h(ReadingLink, { label: t('verifyRecords'), expanded: drawerView?.kind === 'evidence', onClick: readEvidence }))
  let drawer = null
  if (!editing && drawerView) {
    const { kind, trigger, initialProgress } = drawerView
    if (kind === 'info') drawer = {
      key: kind, trigger, title: t('taskInfo'),
      body: h('section', { className: 'pw-task-info-body', tabIndex: 0, 'aria-label': t('taskInfo') },
        h(ReadingText, { label: t('taskOverviewField'), value: overview || t('taskMissing') }),
        h(ReadingText, { label: t('taskSteps'), value: issue.triggerPath }),
        h(ReadingText, { label: t('taskCause'), value: issue.rootCause }),
        h(ReadingText, { label: t('taskSupplement'), value: supplementary }),
        issue.refs?.length > 0 && h('div', { className: 'pw-reading-block' },
          h('h3', { className: 'pw-reading-label' }, t('refs')),
          h(TaskReferences, { refs: issue.refs, openWikiPage })),
        !hasExtraInfo && h('p', { className: 'pw-text pw-note' }, t('taskInfoEmpty'))),
    }
    if (kind === 'prds' && renderPrds) drawer = {
      key: kind, scrollKey: initialPrdId, trigger, title: t('reqRelatedPrds'),
      focusId: drawerView.returnFocus ? 'pw-prd-open-full' : undefined, body: renderPrds(setPrdSummary, { readOnly: true }),
    }
    if (kind === 'evidence') drawer = { key: kind, trigger, title: t('taskReviewRecords'), body: h(TaskVerificationRecords, { task: issue, t, since: req.deliveryStartedAt }) }
    if (kind === 'progress') drawer = {
      key: kind, trigger, title: t('progressRecords'), focusId: initialProgress && 'pw-task-current-progress',
      body: h(UpdateLog, { key: initialProgress, activity: issue.activity, t, timeline: true, userFacing: true,
        openWikiPage, initialProgress, showTimelineHeading: false }),
    }
  }
  const scrollKey = `${projectKey}:${issue.id}` + (reviewing ? `:review:${issue.inReviewAt || issue.deliveryStartedAt || 0}` : '')
  return h(ReadingLayout, { t, rail, drawer, onClose: closeDrawer, scrollMemory, scrollKey, modalActive: modalActive || recording },
    !editing && drawerView?.kind !== 'prds' && renderPrds?.(setPrdSummary, { summaryOnly: true }),
    h('section', { className: 'pw-subpage pw-issue-page' + (editing ? '' : ' pw-read-card'), 'aria-label': t('issueDetail') },
      h('header', { className: 'pw-subpage-head' },
        h('div', { className: 'pw-read-title' }, h('h2', { id: 'pw-task-title', tabIndex: -1, 'aria-describedby': 'pw-task-status' }, issue.title),
          h('span', { id: 'pw-task-status', className: 'pw-count pw-read-status', 'data-status': issue.status }, t('st_' + issue.status))),
        !editing && !terminal && h('button', { className: 'pw-button', onClick: () => begin() }, t('edit'))),
      !editing && h('section', { className: 'pw-task-info', 'aria-labelledby': 'pw-task-info-heading' },
        h('div', { className: 'pw-task-info-head' },
          h('h3', { id: 'pw-task-info-heading', className: 'pw-reading-label' }, t('taskInfo')),
          h('button', {
            type: 'button', className: 'pw-button', 'aria-expanded': infoOpen,
            onClick: event => infoOpen ? closeDrawer() : showDrawer('info', event.currentTarget),
          }, t('taskOpenInfo'), h('span', { className: 'pw-reading-chevron', 'aria-hidden': true }, '›'))),
        h('p', { className: 'pw-text pw-preview' }, overview || t('taskMissing'))),
      notice && h('p', { className: 'pw-note', role: 'status' }, notice),
      runLocked && !editing && !reviewing && h('p', { className: 'pw-note', role: 'status' }, t('runRunning')),
      editing ? h(TaskForm, { form: { ...form, change: (...args) => { setFormError(null); form.change(...args) } }, t, busy, focus: formFocus, error: formError, onSave: save, onCancel: form.finish })
        : h(React.Fragment, null,
          reviewStep,
          reworkReason && h('section', { className: 'pw-task-review-step', 'aria-labelledby': 'pw-task-rework' },
            h('h3', { id: 'pw-task-rework', tabIndex: -1 }, t('taskRejected')),
            h('p', { className: 'pw-text' }, reworkReason),
            h('p', { className: 'pw-note' }, t(reviewReady ? 'taskReworkReady' : 'taskReworkNext')),
            actions),
          h(TaskReading, { task: issue, since: req.deliveryStartedAt, t,
            hidePriorResult: !!reworkReason && !hasResult, evidenceOpen: drawerView?.kind === 'evidence',
            reviewTools: reviewing && h(AcceptanceAssist, { req, issue, root, t, compact: true, showInstructions: false,
              busy: busy || runLocked, memory: uiMemory, onRunningChange: setAssistRunning }),
            onReadProgress: readProgress, onReadEvidence: readEvidence,
            onAdd: terminal || inactive ? undefined : text => mutate('issue/addUpdate', { root, reqId: req.id, id: issue.id, text }) },
            inactive && h('p', { className: 'pw-note' }, t(req.pendingReopen ? 'errReopenPending' : 'errNotActive')),
            !reworkReason && actions,
            supplementing && h('form', { className: 'pw-progress-form', onSubmit: saveSupplement },
              h('textarea', { className: 'pw-textarea', autoFocus: true, rows: 3, 'aria-label': t('supplement'), placeholder: t('supplementPlaceholder'), value: supplement, onChange: e => setSupplement(e.target.value) }),
              h('div', { className: 'pw-actions' },
                h('button', { type: 'submit', className: 'pw-button', disabled: busy || !supplement.trim() }, t('saveSupplement')),
                h('button', { type: 'button', className: 'pw-button pw-quiet', disabled: busy, onClick: () => setSupplementing(false) }, t('cancel')))))),
      recording && h(TaskResultForm, { task: issue, since: req.deliveryStartedAt, t, busy, onClose: () => setRecording(false),
        onSave: params => mutate('issue/update', { root, reqId: req.id, id: issue.id, ...params }, { inlineError: true }) })))
}

export const taskDetailCss = `
.pw-task-info{display:grid;gap:4px;padding-block-end:10px;margin-block-end:14px;border-block-end:1px solid var(--dsw-alias-border-l3)}
.pw-task-info-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px 12px}
.pw-task-info-head .pw-reading-label,.pw-task-info .pw-preview{margin:0}
.pw-task-info .pw-preview{line-height:1.5}
.pw-task-info-head .pw-reading-chevron{margin-inline-start:6px}
.pw-task-info-body{line-height:1.6}
.pw-task-info-body:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.pw-issue-page .pw-task-reading{container-type:inline-size;max-width:none;gap:18px}
.pw-task-reading>.pw-reading-block,.pw-task-acceptance>.pw-reading-block,.pw-task-progress-preview{max-inline-size:46em}
.pw-issue-page .pw-task-acceptance{max-width:none;gap:14px}
.pw-task-review-step{display:grid;gap:8px;padding:12px 14px;margin-block-end:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base)}
.pw-task-review-head,.pw-task-review-checks{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex-wrap:wrap}
.pw-task-review-head>div:first-child{flex:1 1 240px}
.pw-task-review-step h3{margin:0;font-size:1.08em}
.pw-task-review-step :is(.pw-note,.pw-text){margin:0;line-height:1.55;overflow-wrap:anywhere}
.pw-task-review-step .pw-note,.pw-task-review-checks .pw-note{color:var(--dsw-alias-label-secondary)}
.pw-task-review-step .pw-task-review-notice{color:var(--dsw-alias-label-primary);border-block-start:1px solid var(--dsw-alias-border-l3);padding-block-start:8px}
.pw-task-review-step .pw-button,.pw-task-review-checks .pw-button{min-height:34px;max-width:100%;overflow-wrap:anywhere}
.pw-task-review-compare{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.pw-task-review-compare>.pw-reading-block{min-width:0;padding:10px 14px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px}
.pw-task-review-checks{border-block-start:1px solid var(--dsw-alias-border-l3);padding-block-start:10px}
.pw-task-review-checks .pw-note{margin:0}
.pw-task-review-checks .pw-reading-chevron{margin-inline-start:6px}
.pw-task-acceptance .pw-acceptance-assist{border-block-start:1px solid var(--dsw-alias-border-l3);padding-block-start:10px;overflow-wrap:anywhere}
.pw-task-acceptance .pw-assist-actions>.pw-button{flex:0 1 auto}
.pw-task-acceptance .pw-assist-hint{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:.86em;line-height:1.4}
.pw-task-acceptance .pw-assist-actions+.pw-assist-hint{margin-block-start:6px}
.pw-task-verification-pair{display:grid;gap:12px;align-items:start;grid-template-columns:minmax(0,1fr)}
.pw-task-verification-pair>*{min-inline-size:0}
.pw-task-verification{padding-block:7px}
.pw-task-verification>.pw-quiet{padding-inline:0;color:var(--dsw-alias-brand-primary);margin-top:3px}
@container (min-width:545px){
  .pw-task-verification-pair:has(.pw-reading-criteria){grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}
  .pw-task-verification-pair:has(.pw-reading-criteria)>.pw-task-verification{padding-inline-start:16px;border-inline-start:1px solid var(--dsw-alias-border-l3)}
}
@container (min-width:475px){.pw-task-review-compare{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}}
.pw-task-progress-preview{padding-block-start:10px;border-block-start:1px solid var(--dsw-alias-border-l3)}
.pw-task-progress-preview .pw-text{margin:0 0 6px}
.pw-task-progress-preview .pw-actions>.pw-quiet{padding-inline:7px}
.pw-task-progress-records .pw-progress-item[open] summary .pw-preview{display:block}
.pw-task-evidence,.pw-task-info-body{display:grid;gap:12px;min-width:0}
:is(.pw-task-evidence,.pw-task-info-body) :is(.pw-reading-block,.pw-text){margin-block:0}
.pw-task-evidence .pw-text{white-space:pre-wrap;overflow-wrap:anywhere}
`
