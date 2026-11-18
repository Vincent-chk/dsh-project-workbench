// Presentation only. The full saved text is available for the detail view.
const textOf = value => typeof value === 'string' ? value.trim() : ''

export function taskResult(issue, since = issue?.deliveryStartedAt) {
  const roundStart = Math.max(Number(since) || 0, Number(issue?.deliveryStartedAt) || 0, Number(issue?.requirementDeliveryStartedAt) || 0)
  const fullSummary = textOf(issue?.resultSummary) || textOf(issue?.result?.split(/^###[ \t]+(?:摘要|客观记录|已知限制)/m)[0])
  const fullLimits = textOf(issue?.knownLimits)
  const summaryParts = fullSummary.split(/\r?\n\r?\n\[AI 补充\] /).filter(part => part.trim())
  const resultAt = Number(issue?.resultAt) || 0
  const limitsAt = Number(issue?.knownLimitsAt) || 0
  const evidenceAt = Math.max(Number(issue?.evidenceAt) || 0, Number(issue?.objectiveAt) || 0)
  const previousRound = roundStart > 0 && resultAt < roundStart
  const staleResult = previousRound || issue?.resultFresh === false || (roundStart > 0 && resultAt < evidenceAt)
  const current = !staleResult && (!roundStart || evidenceAt >= roundStart)
  const scoped = issue?.resultScopeAt != null && Number(issue.resultScopeAt) === roundStart
  const recordedSummary = previousRound ? '' : scoped ? fullSummary : summaryParts.at(-1)?.trim() ?? ''
  const hasSupplement = !scoped && recordedSummary && summaryParts.length > 1
  const latestSupplement = current && hasSupplement ? recordedSummary : ''
  const earlierSummary = hasSupplement
    ? fullSummary.slice(0, fullSummary.lastIndexOf(recordedSummary)).replace(/\r?\n\r?\n\[AI 补充\] $/, '')
    : ''
  const unknown = { status: 'unverified', passed: 0, failed: 0, incomplete: 0, unconfirmedChanges: 0, hasManualEvidence: false }
  // The store's verification counts are scoped to the task's round. When
  // comparing against a later requirement round, older counts cannot verify it.
  const taskVerification = roundStart <= Math.max(Number(issue?.deliveryStartedAt) || 0, Number(issue?.requirementDeliveryStartedAt) || 0) ? issue?.verification : null
  return {
    summary: current ? recordedSummary.replace(/\r?\n\r?\n\[AI 补充\] /g, '\n\n') : '',
    recordedSummary,
    latestSupplement,
    earlierSummary,
    unverifiedResultContext: staleResult ? fullSummary : earlierSummary,
    previousSummary: staleResult ? fullSummary : '',
    fullSummary,
    limits: limitsAt > 0 && limitsAt >= roundStart ? fullLimits.replace(/\r?\n\r?\n\[AI 补充\] /g, '\n\n') : '',
    unverifiedLimits: limitsAt > 0 && limitsAt >= roundStart ? '' : fullLimits,
    fullLimits,
    verification: taskVerification ?? unknown,
  }
}

export function requirementResult(req) {
  const summary = textOf(req?.deliverySummary)
  const cancelImpact = textOf(req?.cancelImpact)
  const since = Number(req?.deliveryStartedAt) || 0
  const summaryCurrent = (Number(req?.deliverySummaryAt) || 0) >= since
  const impactCurrent = (Number(req?.cancelImpactAt) || 0) >= since
  const hasCancelled = req?.issues?.some(issue => issue.status === 'cancelled') ?? req?.hasCancelled
  return {
    summary: summaryCurrent ? summary : '',
    previousSummary: summaryCurrent ? '' : summary,
    cancelImpact: hasCancelled && impactCurrent ? cancelImpact : '',
    previousCancelImpact: hasCancelled && impactCurrent ? '' : cancelImpact,
  }
}

export const workbenchContentLocale = {
  en: {
    splitReview: 'Task review', splitDetails: 'Review details', splitVerified: 'Verified',
    splitAssigned: 'Existing task', splitGap: 'Gap', splitUnknown: 'Needs checking',
    splitWorking: 'Checking existing tasks and project progress…',
    splitNoNew: 'No new tasks are needed.', splitNoDrafts: 'There are no new tasks ready to adopt.',
    splitRethink: 'Add a note and revise', splitFeedback: 'What should the AI reconsider?',
    splitFeedbackHint: 'For example, keep these two checks in the same task.',
    splitRetry: 'Review again', splitAdopt: 'Adopt and create task',
    splitNowAssigned: 'This gap is assigned to the new task.',
    splitCheckSameTitle: 'A task with the same title already exists. Check whether it covers this gap.',
    splitBasis: 'Requirement covered by this task', splitLocate: 'Open requirement to review',
    splitOld: 'Review the current requirement and progress to update these older suggestions.',
    errSplitReviewRequired: 'Open the requirement to review and adopt each suggestion.',
    draftTitle: 'Title', draftGoal: 'Goal', draftScope: 'Scope', draftProblem: 'What needs fixing', draftSteps: 'How to reproduce it',
    draftCriteria: 'Completion criteria', draftDescription: 'Description', draftCause: 'Cause', draftResult: 'Result', draftLimits: 'Known limits',
    eventEvidence: 'Added {n} records', eventEvidenceAdded: 'Added {n} evidence items', eventAdopted: 'Accepted a suggestion',
    requirementOverview: 'Requirement overview', requirementScope: 'Scope', requirementCriteria: 'Completion criteria',
    requirementMissing: 'Still missing: {fields}', requirementExtra: 'Additional information', requirementBackground: 'Background', decisionNotes: 'Decision notes', fieldSeparator: ', ',
    reviewRecords: 'Review and acceptance records', reviewOpinion: 'Decision notes',
    taskWhat: 'What to do', taskSteps: 'Steps or use cases', taskMissing: 'No task description has been recorded.',
    sidebarTaskDescription: 'Task description', sidebarFinding: 'Recorded finding', sidebarNotRecorded: 'Nothing recorded yet.',
    sidebarRequirementScope: 'Current scope of the parent requirement', sidebarReviewDetails: 'Review information',
    taskOverviewField: 'Task overview', taskCriteriaOptional: 'Completion criteria (can be added later)',
    taskCause: 'Root cause', taskSupplement: 'Additional notes', taskRefsInput: 'References (one per line)',
    newTask: 'New task', backToTasks: 'Back to task list', recordTaskResult: 'Record result',
    useRecordedEvidence: 'The verification already recorded for this round can be used.',
    oldTaskProgress: 'Earlier progress', hideOldTaskProgress: 'Hide earlier progress',
    progressSummary: 'Progress summary', progressDetail: 'Details (optional)',
    progressDetailHint: 'What changed, what was verified, and what still needs work?',
    progressRecordedAt: 'Recorded at', noTaskProgress: 'No progress has been recorded yet.',
    taskAdditional: 'Additional information', taskCancelReason: 'Cancellation reason', taskNoReason: 'No reason was recorded.',
    progressRecords: 'Progress records', latestProgress: 'Latest progress', recordProgress: 'Record progress',
    missingDeliverySummary: 'No delivery summary has been recorded.', missingCancelImpact: 'The impact of cancelled tasks has not been recorded.',
    missingCriteria: 'No completion criteria have been recorded.',
    resultUnverified: 'The recorded result has not been verified for this round.',
    errRequiredFields: 'Fill in {fields} to continue.', errTitleRequired: 'Enter a title first.',
    errReasonRequired: 'Enter a reason or describe the changes you need.', errBlockedReason: 'Explain what is holding up the task.',
    errEnterProgress: 'Enter an update first.', errRefresh: 'This content changed. Refresh and review the latest version.',
    errReviewUpdated: 'The content changed. The latest version is shown; review it before confirming again.',
    errDeliveryStatusChanged: 'This requirement is no longer in development. Your draft was not saved; copy it if needed, close this window and review the current delivery.',
    errDeliveryDataIncomplete: 'A task could not be read. Restore it, then review the delivery again.',
    errDraftStale: 'This suggestion is out of date. Open the latest version before drafting again.',
    errResultEvidence: 'Add the result and verification evidence for this round.', errCriteriaRequired: 'Add completion criteria first.',
    errOldResult: 'Record a new result and evidence for the current round.', errDeliverySummary: 'Provide a summary for this round.',
    errCancelImpact: 'Explain how the cancelled tasks affect this round.', errOpenTasks: 'Finish or cancel the remaining tasks first.',
    errNoTasks: 'There are no tasks to review.', errAllCancelled: 'Complete at least one task before submitting.',
    errTasksNotAccepted: 'Every task must pass acceptance first. Cancelled tasks must be restored and accepted.',
    errNotActive: 'Tasks can only be processed while the requirement is in development. If it is awaiting acceptance or completed, return it on the board or reopen development first.',
    errNotAllowed: 'This action is unavailable in the current state.', errAlreadyRunning: 'A task is still running. Wait or stop it first.',
    errSessionBusy: 'This conversation is busy. Wait or stop the current work first.',
    errSelectTask: 'Open the task in a conversation first.', errSwitchTask: 'Open the task again to use its current conversation.',
    errWrongWorkspace: 'Open a conversation from this workspace.', errWaitingRecords: 'Task records are still arriving. Try again shortly.',
    errReadOnly: 'Open a new round before editing this item.', errReadOnlyData: 'This record can only be viewed. Check or update the project data.',
    errUnreadable: 'Could not read this information. Try again.', errMissing: 'This item is no longer available. Go back and open it again.',
    errEnableProject: 'Enable project management first.', errAccessDenied: 'Check whether this workspace can be accessed.',
    errCancelled: 'The request was cancelled.', errPromptRejected: 'Could not start the task. Check the conversation and try again.',
    errAwaitDraft: 'A draft is already being prepared.', errAssistFailed: 'Could not prepare a draft. Retry or enter the information yourself.',
    errReviewChanged: 'A substantive change to the requirement needs another review.',
    errReopenPending: 'Finish the existing operation first.', errReopenSelection: 'Choose tasks to reopen or add a task.',
    errReopenItems: 'Some tasks could not be reopened. Retry to finish the same request.',
    errInvalidRef: 'Enter a file location within this project.', errInvalidInput: 'Check the information you entered and try again.',
    errTrashDraft: 'Only unused drafts can be deleted.', errExists: 'This item already exists.',
  },
  zh: {
    splitReview: '任务核对结果', splitDetails: '查看核对依据', splitVerified: '已验证',
    splitAssigned: '已有任务负责', splitGap: '仍有缺口', splitUnknown: '待核实',
    splitWorking: '正在核对已有任务和项目进展…',
    splitNoNew: '无需新增任务。', splitNoDrafts: '暂无可采用的新任务建议。',
    splitRethink: '补充说明并重拟', splitFeedback: '希望 AI 重新考虑什么？',
    splitFeedbackHint: '例如，把这两个检查合到同一个任务。',
    splitRetry: '重新核对', splitAdopt: '采用并新建',
    splitNowAssigned: '该缺口已安排到新任务。',
    splitCheckSameTitle: '已有同名任务，请核对它是否覆盖该缺口。',
    splitBasis: '对应的需求', splitLocate: '回需求查看核对结果',
    splitOld: '这些建议需要按当前需求和任务进展重新核对。',
    errSplitReviewRequired: '请回到需求详情核对并逐条采用。',
    draftTitle: '标题', draftGoal: '想达到什么效果', draftScope: '这次做哪些', draftProblem: '遇到了什么问题', draftSteps: '怎样遇到这个问题',
    draftCriteria: '怎样算做好', draftDescription: '说明', draftCause: '为什么会这样', draftResult: '处理结果', draftLimits: '还有哪些限制',
    eventEvidence: '新增 {n} 条处理记录', eventEvidenceAdded: '新增 {n} 条依据', eventAdopted: '已采用建议',
    requirementOverview: '需求概述', requirementScope: '边界', requirementCriteria: '完成标准',
    requirementMissing: '还缺少{fields}。', requirementExtra: '补充信息', requirementBackground: '背景', decisionNotes: '决策记录', fieldSeparator: '、',
    reviewRecords: '评审与验收记录', reviewOpinion: '意见',
    taskWhat: '要做什么', taskSteps: '操作步骤或使用场景', taskMissing: '尚未记录任务说明。',
    sidebarTaskDescription: '任务描述', sidebarFinding: '已记录的发现', sidebarNotRecorded: '尚未记录。',
    sidebarRequirementScope: '所属需求的当前边界', sidebarReviewDetails: '核对信息',
    taskOverviewField: '任务概述', taskCriteriaOptional: '完成标准（可后补）',
    taskCause: '根因', taskSupplement: '附加说明', taskRefsInput: '关联资料（每行一项）',
    newTask: '新建任务', backToTasks: '返回任务列表', recordTaskResult: '记录结果',
    useRecordedEvidence: '可以使用本轮已保存的验证依据。',
    oldTaskProgress: '更早进展', hideOldTaskProgress: '收起更早进展',
    progressSummary: '进展摘要', progressDetail: '详情（选填）',
    progressDetailHint: '可补充处理了什么、验证结果和仍有的缺口。',
    progressRecordedAt: '记录于', noTaskProgress: '暂无进展记录。',
    taskAdditional: '补充信息', taskCancelReason: '取消原因', taskNoReason: '尚未记录原因。',
    progressRecords: '进展记录', latestProgress: '最近进展', recordProgress: '记录进展',
    missingDeliverySummary: '尚未记录本轮交付摘要。', missingCancelImpact: '尚未记录取消任务对范围的影响。',
    missingCriteria: '尚未记录完成标准。',
    resultUnverified: '已记录处理结果，本轮依据尚未核实。',
    errRequiredFields: '请先补全{fields}。', errTitleRequired: '请先填写标题。',
    errReasonRequired: '请填写原因或需要修改的内容。', errBlockedReason: '请说明任务卡在哪里。',
    errEnterProgress: '请先填写进展。', errRefresh: '内容已有更新，请刷新后重新核对。',
    errReviewUpdated: '内容已有更新，已显示最新内容，请重新核对后再确认。',
    errDeliveryStatusChanged: '需求已不在开发中，下面填写的内容未保存。需要时请先复制，再关闭窗口并核对当前交付内容。',
    errDeliveryDataIncomplete: '有任务无法读取，请修复后重新核对交付内容。',
    errDraftStale: '建议已过时，请打开最新内容后重新起草。',
    errResultEvidence: '请补充本次结果和验证依据。', errCriteriaRequired: '请先补充完成标准。',
    errOldResult: '请补充这一轮的新结果和验证依据。', errDeliverySummary: '请填写本轮交付摘要。',
    errCancelImpact: '请说明已取消的任务对本轮有什么影响。', errOpenTasks: '请先完成或取消剩余任务。',
    errNoTasks: '这里还没有可验收的任务。', errAllCancelled: '请先完成至少一项任务。',
    errTasksNotAccepted: '请先通过全部子任务的验收。已取消的任务须恢复后验收。',
    errNotActive: '任务只在所属需求开发中时可处理。待验收或已完成时，请先到需求看板打回或重新开发；查看不会自动执行。',
    errNotAllowed: '当前状态无法进行这项操作。', errAlreadyRunning: '任务正在处理，请等待或停止后再试。',
    errSessionBusy: '会话正在处理，请等待或停止后再试。',
    errSelectTask: '请先在会话中打开这项任务。', errSwitchTask: '任务关联已变化，请重新打开任务。',
    errWrongWorkspace: '请使用此工作区的会话。', errWaitingRecords: '正在保存任务记录，请稍后重试。',
    errReadOnly: '请发起新一轮后再编辑。', errReadOnlyData: '此记录只能查看，请检查项目数据或更新工作台。',
    errUnreadable: '暂时无法读取，请重试。', errMissing: '找不到此项内容，请返回后重新打开。',
    errEnableProject: '请先启用项目管理。', errAccessDenied: '请检查当前工作区是否可访问。',
    errCancelled: '请求已取消。', errPromptRejected: '任务未能开始，请查看会话后重试。',
    errAwaitDraft: '正在起草，请稍等。', errAssistFailed: '暂时无法生成草稿，可以重试或手工填写。',
    errReviewChanged: '需求内容有实质修改，需要重新评审。',
    errReopenPending: '请先完成上一次操作。', errReopenSelection: '请选择要重开的任务，或新增一项任务。',
    errReopenItems: '还有任务未能重开，重试可继续本次操作。',
    errInvalidRef: '请填写此项目内的文件位置。', errInvalidInput: '请检查输入内容后重试。',
    errTrashDraft: '只有尚未使用的需求草稿可以删除。', errExists: '同一项内容已存在。',
  },
}

const draftFields = {
  title: 'draftTitle', overview: 'requirementOverview', q_pain: 'requirementOverview', goal: 'draftGoal', scope: 'draftScope', problemOverview: 'draftProblem', triggerPath: 'draftSteps', acceptance: 'draftCriteria',
  description: 'draftDescription', rootCause: 'draftCause', resultSummary: 'draftResult', knownLimits: 'draftLimits',
}
export const isRequirementSplit = proposal => proposal?.kind === 'new_task' &&
  (!!proposal.split || proposal.evidence?.includes('draft://requirement/' + proposal.target?.reqId))
export const draftFieldLabel = (field, t) => t(Object.hasOwn(draftFields, field) ? draftFields[field] : 'draftDescription')

const requirementLabels = ['backlog', 'reviewing', 'ready', 'in_progress', 'pending', 'completed']
const taskLabels = ['todo', 'doing', 'blocked', 'in_review', 'done', 'cancelled']

function activityParts(rawLine, kind) {
  const raw = textOf(rawLine)
  const dated = raw.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\S*)\s+(.*)$/s)
  const at = dated?.[1] ?? ''
  const date = at.slice(0, 16).replace('T', ' ')
  const body = dated ? dated[2] : raw
  const states = body.match(/^([a-z_]+)\s+→\s+([a-z_]+)(.*)$/s)
  const labels = kind === 'requirement' ? requirementLabels : kind === 'task' || kind === 'issue' ? taskLabels : [...requirementLabels, ...taskLabels]
  return { raw, at, date, body, states: states && labels.includes(states[1]) && labels.includes(states[2]) ? states : null }
}

export function activityEntry(rawLine, t, kind) {
  const { raw, date, body, states } = activityParts(rawLine, kind)
  const state = name => t((taskLabels.includes(name) ? 'st_' : 'col_') + name)
  const count = body.match(/^客观记录同步：会话 .* 第 \d+[–-]\d+ 条（新增 (\d+) 条依据）$/)?.[1]
  const missingSummaryCount = body.match(/^(?:undefined|null)?\s*[（(]新增\s*(\d+)\s*条依据[）)]$/)?.[1]
  let text = body
  if (states) text = `${state(states[1])} → ${state(states[2])}${states[3]}`
  else if (count) text = t('eventEvidence').replace('{n}', count)
  else if (missingSummaryCount) text = t('eventEvidenceAdded').replace('{n}', missingSummaryCount)
  else if (/^建议已采用：prop-[a-z0-9-]+$/.test(body)) text = t('eventAdopted')
  return { date, text, raw }
}

const recordedDecisions = {
  'reviewing>ready': ['review', 'approved'],
  'reviewing>backlog': ['review', 'returned'],
  'ready>backlog': ['review', 'returned'],
  'in_progress>backlog': ['review', 'returned'],
  'pending>completed': ['acceptance', 'approved'],
  'pending>in_progress': ['acceptance', 'returned'],
  'completed>in_progress': ['acceptance', 'returned'],
}

export function reviewRecords(reviews = []) {
  const seen = new Set()
  return [...reviews].reverse().filter(record => {
    if (!['review', 'acceptance'].includes(record.kind) || !['approved', 'returned'].includes(record.decision)) return false
    const identity = record.marker || record.round || JSON.stringify([record.kind, record.decision, record.at, record.opinion, record.summary])
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

export function progressRecords(activity = [], t, kind, reviews = []) {
  const usedReviews = new Set()
  return activity.flatMap((line, index) => {
    const { at, date, body, states } = activityParts(line, kind)
    if (!body || /^(?:客观记录同步：会话 |建议已采用：prop-)/.test(body)) return []
    if (states && kind === 'requirement') {
      const decision = recordedDecisions[`${states[1]}>${states[2]}`]
      const note = states[3].match(/^（(.*)）$/)?.[1]
      const matched = decision && reviews.find(record => !usedReviews.has(record) && record.kind === decision[0] &&
        record.decision === decision[1] && (!note || record.decision === 'approved' || note === textOf(record.opinion)) &&
        Math.abs(Date.parse(at) - Date.parse(record.at)) < 60_000)
      if (matched) {
        usedReviews.add(matched)
        return []
      }
    }
    let { text } = activityEntry(line, t, kind)
    if (states) text = text.replace(/(?:：proposal:prop-[a-z0-9-]+(?=）)|（proposal:prop-[a-z0-9-]+）)$/i, '')
    else text = text.replace(/^\[AI\]\s*|^人工操作：\s*/, '')
    return text ? [{ date, text, key: index, event: !!states || /^重开完成：/.test(body) }] : []
  })
}

export function taskProgressRecords(activity, t) {
  const copies = new Map()
  return progressRecords(activity, t, 'issue').reverse().map(entry => {
    const raw = activity[entry.key]
    const occurrence = copies.get(raw) ?? 0
    copies.set(raw, occurrence + 1)
    const { at, states } = activityParts(raw, 'issue')
    const [first, ...detail] = entry.text.split(/\r?\n/)
    const summary = states ? `${t('st_' + states[1])} → ${t('st_' + states[2])}` : first
    return { id: JSON.stringify([raw, occurrence]), date: entry.date, at, summary, detail: detail.join('\n').trim() || entry.text }
  }).reverse()
}

export function cancellationReason(task) {
  for (const line of task.activity ?? []) {
    const { states } = activityParts(line, 'issue')
    if (!states || states[2] !== 'cancelled') continue
    const [metadata, ...details] = states[3].split('\n')
    const savedReason = details.join('\n').trim()
    if (savedReason) return savedReason
    const reason = textOf(metadata.match(/^\s*[（(]([\s\S]*)[）)]\s*$/)?.[1])
      .replace(/^(人工|AI|系统)[：:]\s*/, '')
    return /^(人工|AI|系统|proposal:prop-[a-z0-9-]+)$/i.test(reason) ? '' : reason
  }
  return ''
}

export function readingBlocks(value) {
  const blocks = []
  for (const line of textOf(value).split(/\r?\n/)) {
    if (!line.trim()) {
      if (blocks.at(-1)?.lines.length) blocks.push({ tag: 'p', lines: [] })
      continue
    }
    const ordered = line.match(/^\s*(\d+)(?:[.)]\s+|[、．）]\s*)(.+)$/)
    const bullet = line.match(/^\s*(?:[-*+]\s+|•\s*)(.+)$/)
    const tag = ordered ? 'ol' : bullet ? 'ul' : 'p'
    let block = blocks.at(-1)
    if (block?.tag !== tag) {
      if (!block?.lines.length) blocks.pop()
      block = { tag, lines: [] }
      blocks.push(block)
    }
    block.lines.push(ordered ? { number: Number(ordered[1]), text: ordered[2] } : bullet?.[1] ?? line)
  }
  return blocks.filter(block => block.lines.length)
}

const errors = {
  TITLE_REQUIRED: 'errTitleRequired', REASON_REQUIRED: 'errReasonRequired', BLOCKED_REASON_REQUIRED: 'errBlockedReason',
  EMPTY_UPDATE: 'errEnterProgress', CONFLICT: 'errRefresh', FINGERPRINT_REQUIRED: 'errRefresh', ROUND_CHANGED: 'errRefresh', REVIEW_CONTENT_UPDATED: 'errReviewUpdated', DELIVERY_STATUS_CHANGED: 'errDeliveryStatusChanged', DELIVERY_DATA_INCOMPLETE: 'errDeliveryDataIncomplete',
  DRAFT_STALE: 'errDraftStale', ASSIST_STALE: 'errDraftStale', SPLIT_REVIEW_REQUIRED: 'errSplitReviewRequired', ACCEPTANCE_REQUIRED: 'errCriteriaRequired',
  RESULT_EVIDENCE_REQUIRED: 'errResultEvidence', EVIDENCE_REQUIRED: 'errResultEvidence', RESULT_STALE: 'errOldResult',
  SUMMARY_REQUIRED: 'errDeliverySummary', SUMMARY_STALE: 'errDeliverySummary',
  CANCEL_IMPACT_REQUIRED: 'errCancelImpact', CANCEL_IMPACT_STALE: 'errCancelImpact', ISSUES_NOT_TERMINAL: 'errOpenTasks',
  NO_ISSUES: 'errNoTasks', ALL_CANCELLED: 'errAllCancelled', TASKS_NOT_ACCEPTED: 'errTasksNotAccepted', REQ_NOT_ACTIVE: 'errNotActive',
  ILLEGAL_TRANSITION: 'errNotAllowed', INVALID_STATE: 'errNotAllowed', HUMAN_ONLY: 'errNotAllowed',
  RUNNING: 'errAlreadyRunning', RUNNING_ISSUES: 'errAlreadyRunning', SESSION_BUSY: 'errSessionBusy',
  NOT_LINKED: 'errSelectTask', NO_LINK: 'errSelectTask', SESSION_NOT_LIVE: 'errSwitchTask', LINK_CHANGED: 'errSwitchTask',
  WORKSPACE_MISMATCH: 'errWrongWorkspace', SYNC_PENDING: 'errWaitingRecords', SYNC_UNSTABLE: 'errWaitingRecords',
  TERMINAL_READ_ONLY: 'errReadOnly', SCHEMA_TOO_NEW: 'errReadOnlyData', MISSING_FRONTMATTER: 'errReadOnlyData', INVALID_STATUS: 'errReadOnlyData',
  READ_FAILED: 'errUnreadable', NOT_FOUND: 'errMissing', WORKSPACE_MISSING: 'errMissing', NOT_INITIALIZED: 'errEnableProject',
  ACCESS_DENIED: 'errAccessDenied', CANCELLED: 'errCancelled', PROMPT_REJECTED: 'errPromptRejected',
  ASSIST_BUSY: 'errAwaitDraft', ASSIST_FAILED: 'errAssistFailed', SPAWN_FAILED: 'errAssistFailed',
  REVIEW_INVALIDATION_REQUIRED: 'errReviewChanged', REOPEN_PENDING: 'errReopenPending', REOPEN_CONFLICT: 'errReopenPending',
  DECISION_PENDING: 'errReopenPending', REOPEN_SELECTION_REQUIRED: 'errReopenSelection', REOPEN_ITEM_FAILED: 'errReopenItems',
  ABSOLUTE_REF: 'errInvalidRef', INVALID_REF: 'errInvalidRef', FIELD_NOT_EDITABLE: 'errInvalidInput',
  INVALID_ID: 'errInvalidInput', INVALID_ROOT: 'errInvalidInput', INVALID_PROPOSAL: 'errInvalidInput',
  NOT_A_DRAFT: 'errTrashDraft', INVALID_KIND: 'errTrashDraft', ALREADY_EXISTS: 'errExists',
}

export function workbenchError(error, t) {
  const code = textOf(error?.code)
  const message = textOf(error?.message) || textOf(error)
  const raw = [code, message, textOf(error?.method) && `接口：${textOf(error.method)}`].filter(Boolean).join('\n')
  if (code === 'REOPEN_ITEM_FAILED') {
    const access = /EACCES|EPERM|EROFS|EBUSY|immutable|permission|read.?only|权限|不可变/i.test(message)
    return { text: `${t('errReopenItems')}${access ? ' 工作区或任务文件当前不可写，请恢复权限或文件限制后重试。' : ' 请核对未完成任务后重试。'} 已处理部分不会重复，新建任务沿用原 ID。`, raw }
  }
  if (code === 'MISSING_START_FIELDS' || code === 'MISSING_TASK_FIELDS' || code === 'REVIEW_INFO_REQUIRED') {
    const fields = message.split(': ').at(-1).split(', ').filter(field => Object.hasOwn(draftFields, field)).map(field => {
      if (field === 'problemOverview') return t('taskOverviewField')
      if (field === 'acceptance') return t('requirementCriteria')
      return draftFieldLabel(field, t)
    })
    if (fields.length) return { text: t('errRequiredFields').replace('{fields}', fields.join('、')), raw }
  }
  return { text: t(Object.hasOwn(errors, code) ? errors[code] : 'errGeneric'), raw }
}
