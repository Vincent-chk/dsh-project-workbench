import React from 'react'
import { MainShell } from './shell/main-shell.js'
import { TaskPane, rightbarLocale } from './rightbar/task-pane.js'
import { workbenchContentLocale } from './workbench-content.js'
import { acceptanceAssistLocale } from './detail/acceptance-assist.js'
import { ConversationDock, conversationLocale, workbenchMentionSource } from './conversation.js'
    const h = React.createElement
    const NS = 'projectWorkbench'
    const PANEL_ID = 'project-workbench'
    const en = {
      ...workbenchContentLocale.en,
      ...rightbarLocale.en,
      ...acceptanceAssistLocale.en,
      ...conversationLocale.en,
      requirementActions: 'More options', resumeReopen: 'Resume reopening',
      reopenProgress: '{done} of {total} tasks prepared',
      confirmIssueTitle: 'Confirm task completion',
      edit: 'Edit', taskNotes: 'Task notes', history: 'View history', olderProgress: 'View earlier updates', rawDetails: 'View original record',
      verify: 'Verification', verifyRecords: 'View verification records', previousResult: 'Previous result', latestSupplement: 'Latest addition', fullResult: 'Full result',
      checksPassed: '{n} checks passed', checksFailed: '{n} checks failed', checksIncomplete: 'Some check results are unverified',
      noChecks: 'No completed check recorded for this round', manualEvidence: 'There is a manual verification record',
      unconfirmedChanges: 'Some changes have not been verified', noLimits: 'Not recorded', limitsUnverified: 'Earlier limits have not been checked this round', previousResultUnverified: 'Previous result (round not verified)', previousLimits: 'Earlier limits (not checked this round)', goal: 'Goal', scope: 'What this covers',
      problemOverview: 'What happens', triggerPath: 'How to see it', rootCause: 'Why it happens', acceptanceField: 'How to check it',
      taskCount: '{done} of {total} tasks confirmed', cancelledCount: '{n} tasks cancelled', fullRequirement: 'Read the full requirement',
      openTaskSession: 'Open task conversation', noLinkedTask: 'Choose a task in this project', linkTask: 'Link and view', pickTask: 'Choose a task',
      aiOrganize: 'Let AI organize this requirement', aiSplit: 'Let AI suggest tasks', draftUnavailable: 'No draft is ready. Add details or try again.',
      draftMissing: 'Please add: {fields}', submitReview: 'Send for review', approveReview: 'Approve review', returnReview: 'Return for edits', startDev: 'Start development',
      col_reviewing: 'In review', col_ready: 'Ready for development', reviewHistory: 'Review and acceptance history', acceptRequirement: 'Accept delivery',
      reviewApproved: 'Review approved', reviewReturned: 'Review returned', deliveryAccepted: 'Delivery accepted', deliveryReturned: 'Delivery returned',
      confirmReviewEdit: 'Save and return to the requirement pool', confirmReviewEditBody: 'This change needs another review. Enter a reason.',
      notCompletedTask: 'Unfinished task', continuedWork: 'Continue editing', deliveredTaskResults: 'Task results', sendBack: 'Send back for changes', reviseTask: 'Request changes',
      askFix: 'What should be changed?', pickReopen: 'Choose at least one task to reopen', unknownRun: 'The conversation status is unavailable.',
      runIdle: 'AI is idle', runRunning: 'AI is working', runWaiting: 'Waiting for permission', runStarting: 'AI is starting', runUncertain: 'Checking whether AI started',
      linkMissing: 'The linked task is unavailable. Choose another task.', switchTask: 'Switch task', noEvidenceYet: 'No verification record yet',
      oldEvidence: 'Previous verification records', startTask: 'Start task',
      panel: 'Project workbench', title: 'Project workbench', back: 'Back to conversation',
      switchWorkspace: 'Switch workspace', chooseWorkspace: 'Choose a workspace', chooseWorkspaceHint: 'Each workspace is one project. Pick one to open its board.',
      openRight: 'Open in right sidebar', openMain: 'Open main panel', openRequirement: 'View parent requirement', fallbackDescription: 'Open the project workbench in the right sidebar',
      noWorkspace: 'Select a session with a working directory first.', loading: 'Loading…', retry: 'Retry',
      noWorkspacesHint: 'No workspaces yet. Add or open a workspace in DSH first, then pick it here.',
      workspaceRemoved: 'This workspace is no longer registered in DSH. Select another workspace or add it again.',
      readFailedTitle: 'Cannot read this project', readFailedHint: 'The project data could not be read. You can switch projects or retry; nothing is written.',
      dataProblems: '{n} data issue(s)', details: 'Details', retryRead: 'Retry read',
      diagWorkspace: 'This workspace could not be opened. Check that the folder is accessible in DSH.',
      diagUnreadable: 'Some project records could not be read.',
      diagVersion: 'Some records need a newer version of the workbench.',
      diagReference: 'Some references are outside the workspace. Update them to point to project documents.',
      diagBlocked: 'Some blocked tasks are missing a reason.',
      diagInconsistent: 'Some requirement or task records are incomplete or inconsistent.',
      diagLarge: 'The project has many tasks and may take longer to load.',
      conflict: 'This file has changed. Copy any edits you want to keep, retry the read, then discard this draft and reopen the form.', saveFailed: 'Save failed; your input is kept, retry when ready.',
      leaveTitle: 'Unsaved changes', leaveBody: 'This form has unsaved changes. Save them before leaving?', saveAndLeave: 'Save and leave', discardDraft: 'Discard changes', keepEditing: 'Keep editing',
      initTitle: 'Enable project management', initBody: 'Store requirements and tasks for this workspace.',
      newRequirement: 'New requirement', search: 'Search', saving: 'Saving…',
      col_backlog: 'Backlog', col_in_progress: 'In progress', col_pending: 'Pending review', col_completed: 'Completed',
      completedToggle: 'Completed {n}', empty: 'Nothing here yet', progress: 'progress',
      flag_blocked: 'Blocked', flag_clarify: 'Needs clarity', flag_stalled: 'Stalled', flag_submittable: 'Ready to submit', flag_acceptable: 'Awaiting review',
      start: 'Start', submit: 'Submit for review', confirm: 'Confirm complete', rework: 'Send back', freeze: 'Freeze', delete: 'Delete',
      reasonTitle: 'A reason is required', reasonPlaceholder: 'Why? (one line)', cancel: 'Cancel', ok: 'OK', moveRejectedTitle: 'Move not allowed',
      confirmCompleteTitle: 'Confirm completion', confirmCompleteBody: 'This is the one sign-off. All issues must be done or cancelled.',
      abandonTitle: 'Abandon open issues', abandonBody: '{n} issue(s) are not finished. Cancelling them requires a reason; the requirement will then be completed.',
      deleteTitle: 'Delete requirement', deleteBody: 'Move "{title}" and its {n} issue(s) to the trash? This is reversible from .local/trash.',
      detail: 'Requirement', next: 'Next step', q_who: 'Intended users', q_success: 'Other completion conditions', q_out: 'Out of scope',
      activity: 'Activity', noActivity: 'No activity yet', updates: 'Updates', updatePlaceholder: 'Add an update…', addUpdate: 'Post update', issues: 'Issues', addIssue: 'Add an issue…', issueLocked: 'Issues can only be added while in progress',
      issueTitle: 'Title', acceptance: 'Acceptance', evidence: 'Evidence', editIssue: 'Edit issue', save: 'Save',
      description: 'Description', refs: 'References', created: 'Created', updated: 'Updated', issueDetail: 'Issue detail', noRefs: 'No references yet', addRef: 'Add', addRefPlaceholder: 'e.g. src/core/store.js or openwiki/data/store.md', removeRef: 'Remove reference',
      st_todo: 'To do', st_doing: 'Doing', st_blocked: 'Blocked', st_in_review: 'Awaiting acceptance', st_done: 'Done', st_cancelled: 'Cancelled',
      blockedReason: 'Blocked reason', today: 'Today', current: 'Currently doing', openIssue: 'Open',
      sug_submittable: 'Ready to submit for review', sug_blocked: 'Has a blocked issue', sug_currentDoing: 'Keep going on the current issue', sug_needsClarification: 'Needs a little clarity', sug_stalled: 'Has been idle a while',
      errGeneric: 'Something went wrong', noSession: 'No session selected',
      undo: 'Undo', trashed: 'Moved to trash', dismiss: 'Dismiss', restored: 'Restored',
      markDone: 'Done', block: 'Block', unblock: 'Resume', reopen: 'Reopen', expand: 'Expand', collapse: 'Collapse',
      bind: 'Session → requirement', unbound: 'Not bound', bindWorkspace: 'Session → this workspace', commit: 'Commit .project', uncommitted: '{n} uncommitted', committed: 'Committed', gitUnavailable: 'git unavailable',
      viewBoard: 'Board', viewWiki: 'Wiki', viewSync: 'Proposals', viewArch: 'Architecture', wikiTitle: 'Project Wiki', wikiEmpty: 'No wiki yet. Generate one.', wikiPages: 'Pages', wikiLastUpdate: 'Last update', wikiDateUnknown: 'Date unavailable', mermaidNote: 'Mermaid diagram (source)', wikiBack: 'Back to pages', copy: 'Copy', copied: 'Copied', wikiEvidence: 'Source evidence', wikiNoEvidence: 'No source records for this page.', wikiUnavailable: 'This source cannot be opened. Check that it is available, then retry.',
      archTitle: 'Architecture', archGenerate: 'Generate diagram', archRegenerate: 'Regenerate', archEmpty: 'No architecture diagram yet. Generate one from the project source code.', archAuthoring: 'Reading source code and drawing the diagram…', archRendering: 'Generating diagram…', archRepairing: 'Refining layout…', archDone: 'Architecture diagram ready.', archHint: 'Auto-generated from the project source',
      syncTitle: 'Reconciliation proposals', syncRun: 'Review progress', syncRunning: 'Collecting evidence…', syncDone: 'Progress review finished.', syncNone: 'The review found no changes to suggest.', syncEmpty: 'No pending suggestions. Review progress to check for updates.', syncDismiss: 'Dismiss', syncEvidence: 'Sources', syncSaved: '{n} new proposals', syncPending: '{n} pending', syncAcceptRate: 'Acceptance rate: {rate}% ({accepted}/{total})',
      kind_advance: 'Advance state', kind_review: 'Review state', kind_capture: 'Capture new work', kind_clarify: 'Needs clarification', kind_stalled: 'Stalled', kind_wiki_drift: 'Wiki drift',
      wikiTryAgain: 'Wiki generation did not finish. You can try again.',
      wikiStagingFailed: 'Could not prepare the temporary copy. Check the project and file permissions, then try again.',
      wikiSourceUnsupported: 'This project uses a Git worktree, submodules, symbolic links, or a Git index that Wiki generation does not support.',
      wikiShowingPrevious: 'Showing the Wiki saved before this update.',
      wikiPreviousUnavailable: 'The unfinished update has no saved earlier version; these pages may have changed.',
      wikiSnapshotFailed: 'Could not safely save the Wiki. Check file permissions, metadata, size and system support before retrying.',
      wikiSnapshotUnreadable: 'The saved Wiki version cannot be read safely. The update was not started.',
      wikiSavedViewUnreadable: 'The saved Wiki version is missing or damaged and cannot be read safely.',
      wikiExternalChangeView: 'The current Wiki changed or cannot be verified. Showing an earlier saved version.',
      wikiNoSavedExternal: 'The Wiki changed or cannot be verified, and no earlier saved version is available.',
      wikiExternalChangeBlocked: 'The current Wiki changed or cannot be verified. Check its update state before starting another update.',
      wikiRootNotTopLevel: 'Open the Git repository’s top-level folder as the project before generating a wiki.',
      wikiNeedsGit: 'Wiki generation requires a Git repository. Initialize Git in this project and try again. You can commit later.',
      wikiGitMissing: 'Git is unavailable. Install Git or check its setup and try again.',
      wikiRootUnavailable: 'Cannot read the Git working directory. Check that Git is available and open the repository’s top-level folder with the project files.',
      wikiStateUnreadable: 'Cannot safely read the existing Wiki or its unfinished update. Check the files before trying again.',
      wikiMetadataUnsafe: 'The Wiki contains system companion files that the generator may misinterpret. Check them before trying again.',
      wikiCheckpointUnsafe: 'The unfinished Wiki update lists system companion files as pages. Check the update record before trying again; existing files are preserved.',
      archTryAgain: 'The architecture diagram could not be generated. You can try again.',
      archSourceRequired: 'No project source could be cited. Check that this project contains readable source files, then try again.',
      archSourceInvalid: 'The diagram references a file or line range that cannot be verified. Check the project files and try again.',
      generationNeedsSession: 'Open a conversation in this project and try again.',
      generationStatusUnavailable: 'The status of this run is unavailable. Try again to check it.',
      generationStopFailed: 'The stop request did not complete. You can try again.',
      syncRunFailed: 'Project review did not finish. You can try again.',
      syncAdoptContent: 'Adopt all content suggestions',
      syncLocateRequirement: 'Find on board', syncLocateTask: 'Find in task list',
      syncSourceConversation: 'Task conversation', syncSourceDraft: 'Drafted from project content',
      syncSourceCommit: 'Code change {revision}',
      syncBatchResult: '{adopted} adopted, {failed} could not be adopted',
      kind_req_draft: 'Requirement draft', kind_field_draft: 'Task draft', kind_new_task: 'New task', kind_task_suggestion: 'Task suggestion',
      wikiBusy: 'Another project is generating its wiki. Wait for it or stop it first.', wikiGenerate: 'Generate wiki', wikiUpdate: 'Update wiki', wikiStop: 'Stop', wikiStopping: 'Stopping…', wikiStopped: 'Generation stopped.', wikiGenerating: 'Generating wiki… this can take a few minutes.', wikiDone: 'Wiki generation finished.', wikiNoop: 'Wiki is already up to date.', wikiProbeOk: 'Wiki generation service is available ({n} tools).', wikiProbeMissing: 'Wiki generation service is unavailable.',
      demoTitle: 'Stage-1 prototype demo (temporary entry)', demoPrepare: 'Prepare demo data', demoView: 'View', demoStart: 'Start once', demoHint: 'View sends no prompt; Start submits exactly one request.',
      demoOpened: 'Task session opened.', demoTabFallback: 'Session opened. Open “Project workbench” in the right sidebar to see the task card.', demoStarted: 'One processing request submitted.', demoAlready: 'A request is already running; entering the session to watch progress.', demoBusy: 'The session is busy with other input; no new request was submitted.', demoUncertain: 'Submission outcome unclear; the run lock is kept. Retry to verify.', demoNoLink: 'This session is not linked to a demo task.', demoUnrecorded: 'This turn may have unrecorded progress.', demoNotePlaceholder: 'Human progress note…', demoNote: 'Record (human)', demoContinue: 'Continue', demoStop: 'Stop', demoRunState: 'Run', demoCursor: 'Recorded to event', demoFailed: 'Demo action failed',
      demoResult: 'Result', demoEvidence: 'Verification evidence', demoAcceptance: 'Completion criteria', demoLimits: 'Known limits', demoNoResult: 'No result yet',
      demoConfirm: 'Accept task', submitTaskAcceptance: 'Submit task for acceptance', demoDrafts: 'Pending drafts', demoAdopt: 'Adopt', demoDismiss: 'Dismiss',
      demoDeliveryFailed: 'Summary generation failed', demoManualSummary: 'Write a delivery summary…', demoSubmitAcceptance: 'Submit for acceptance', demoDeliverySummary: 'Delivery summary', demoPendingAcceptance: 'Awaiting acceptance', demoCancelImpact: 'Cancelled scope impact',
    }
    const zh = {
      ...workbenchContentLocale.zh,
      ...rightbarLocale.zh,
      ...acceptanceAssistLocale.zh,
      ...conversationLocale.zh,
      requirementActions: '更多选项', resumeReopen: '继续重开',
      reopenProgress: '已处理 {done}/{total} 项任务',
      confirmIssueTitle: '确认任务完成',
      edit: '编辑', taskNotes: '查看任务说明', history: '查看历史', olderProgress: '查看较早进展', rawDetails: '查看原始记录',
      verify: '验证情况', verifyRecords: '查看验证记录', previousResult: '之前的结果', latestSupplement: '最近补充', fullResult: '完整结果',
      checksPassed: '{n} 项检查通过', checksFailed: '{n} 项检查未通过', checksIncomplete: '有检查结果尚未核实',
      noChecks: '本轮尚无已完成的检查记录', manualEvidence: '有人工验证记录',
      unconfirmedChanges: '有改动仍待核实', noLimits: '未填写', limitsUnverified: '此前记录的限制本轮尚未核实', previousResultUnverified: '此前结果（轮次未核实）', previousLimits: '此前的限制（本轮未核实）', goal: '目标', scope: '这次包括什么',
      problemOverview: '遇到了什么', triggerPath: '怎样遇到这个问题', rootCause: '为什么会发生', acceptanceField: '怎么知道做好了',
      taskCount: '{total} 个任务，{done} 个已确认完成', cancelledCount: '{n} 个任务已取消', fullRequirement: '查看完整需求',
      openTaskSession: '打开任务会话', noLinkedTask: '选择一个任务，方便在会话里查看进展。', linkTask: '关联并查看', pickTask: '选择任务',
      aiOrganize: '让 AI 整理需求', aiSplit: '让 AI 建议任务', draftUnavailable: '还没有可用的草稿。可以补充说明后重试。',
      draftMissing: '还需要补充 {fields}', submitReview: '送去评审', approveReview: '通过评审', returnReview: '退回补充', startDev: '开始开发',
      col_reviewing: '评审中', col_ready: '待开发', reviewHistory: '查看评审和验收历史', acceptRequirement: '验收通过',
      reviewApproved: '评审通过', reviewReturned: '评审退回', deliveryAccepted: '验收通过', deliveryReturned: '验收打回',
      confirmReviewEdit: '保存并退回需求池', confirmReviewEditBody: '本次修改需要重新评审。请说明原因。',
      notCompletedTask: '未完成的任务', deliveredTaskResults: '各项任务结果', sendBack: '驳回返工', reviseTask: '继续修改',
      askFix: '哪里还需要修改？', pickReopen: '选择至少一项需要重新处理的任务', unknownRun: '暂时无法读取会话状态',
      runIdle: 'AI 暂未运行', runRunning: 'AI 正在处理', runWaiting: '等你在会话中授权', runStarting: '正在开始处理', runUncertain: '正在核对是否已开始处理',
      linkMissing: '原任务暂时无法打开，可以选择其他任务。', switchTask: '更换任务', noEvidenceYet: '暂无验证记录',
      oldEvidence: '之前的验证记录', startTask: '开始处理',
      panel: '项目工作台', title: '项目工作台', back: '返回会话',
      switchWorkspace: '切换工作区', chooseWorkspace: '选择要查看的工作区', chooseWorkspaceHint: '每个工作区就是一个项目。选一个进入，查看它的看板。',
      openRight: '在右栏打开', openMain: '打开主面板', openRequirement: '查看所属需求', fallbackDescription: '在右栏打开项目工作台',
      noWorkspace: '请先选择一个带工作目录的会话。', loading: '加载中…', retry: '重试',
      noWorkspacesHint: '暂无工作区。请先在 DSH 中添加或打开一个工作区，再回到这里选择项目。',
      workspaceRemoved: '此工作区已从 DSH 移除。请选择其他工作区，或在 DSH 中重新添加。',
      readFailedTitle: '无法读取这个项目', readFailedHint: '项目数据读取失败。可以切换项目或重试读取；此操作不会写入任何文件。',
      dataProblems: '{n} 项数据问题', details: '详情', retryRead: '重试读取',
      diagWorkspace: '暂时无法打开此工作区。请检查 DSH 中能否访问该文件夹。',
      diagUnreadable: '部分项目记录暂时无法读取。',
      diagVersion: '部分记录需要更新版本的工作台才能读取。',
      diagReference: '部分关联资料位于工作区之外，可以改为引用项目内的资料。',
      diagBlocked: '部分阻塞任务还没有记录原因。',
      diagInconsistent: '部分需求或任务记录缺少信息，或与当前状态不一致。',
      diagLarge: '项目中的任务较多，加载时间可能更长。',
      conflict: '内容已有更新。你的输入仍在，可以重新核对后再保存。', saveFailed: '保存失败，输入已保留，可重试。',
      leaveTitle: '有未保存的修改', leaveBody: '当前表单还有未保存的修改。离开前先保存吗？', saveAndLeave: '保存后离开', discardDraft: '放弃修改', keepEditing: '继续编辑',
      initTitle: '启用项目管理', initBody: '在此工作区保存需求和任务。',
      newRequirement: '新建需求', search: '搜索', saving: '保存中…',
      col_backlog: '需求池', col_in_progress: '开发中', col_pending: '待验收', col_completed: '已完成',
      completedToggle: '已完成 {n}', empty: '这里还没有内容', progress: '进度',
      flag_blocked: '卡住', flag_clarify: '欠澄清', flag_stalled: '停滞', flag_submittable: '可提交', flag_acceptable: '待验收',
      start: '开始', submit: '提交验收', confirm: '确认完成', rework: '打回', freeze: '冻结', delete: '删除',
      reasonTitle: '需要填写原因', reasonPlaceholder: '为什么？（一句话）', cancel: '取消', ok: '确定', moveRejectedTitle: '无法移动',
      confirmCompleteTitle: '通过验收', confirmCompleteBody: '通过后，这条需求会标为已完成。',
      abandonTitle: '放弃未完成的 issue', abandonBody: '还有 {n} 条 issue 未完成。取消需要填写原因，随后该需求将被完成。',
      deleteTitle: '删除需求', deleteBody: '把「{title}」及其 {n} 条 issue 移入回收站？可从 .local/trash 恢复。',
      detail: '需求', next: '下一步', q_who: '使用对象', q_success: '其他完成条件', q_out: '明确不做',
      activity: '活动', noActivity: '还没有活动', updates: '动态', updatePlaceholder: '记录一条进展…', addUpdate: '发布进展', issues: '任务', addIssue: '加一条任务…', issueLocked: '只有进行中才能新增任务',
      issueTitle: '标题', acceptance: '验收', evidence: '证据', editIssue: '编辑任务', save: '保存',
      description: '描述', refs: '关联', created: '创建于', updated: '更新于', issueDetail: '任务详情', noRefs: '暂无关联', addRef: '添加', addRefPlaceholder: '如 src/core/store.js 或 openwiki/data/store.md', removeRef: '移除关联',
      st_todo: '待办', st_doing: '进行中', st_blocked: '阻塞', st_in_review: '待验收', st_done: '完成', st_cancelled: '取消',
      blockedReason: '阻塞原因', today: '今日建议', current: '当前在做', openIssue: '打开',
      sug_submittable: '可以提交验收了', sug_blocked: '有任务被卡住', sug_currentDoing: '继续当前任务', sug_needsClarification: '还差一点澄清', sug_stalled: '有一阵子没动了',
      errGeneric: '这项操作没有完成，请重试。', noSession: '尚未选择会话',
      undo: '撤销', trashed: '已移入回收站', dismiss: '关闭', restored: '已恢复',
      markDone: '完成', block: '阻塞', unblock: '继续', reopen: '返工', expand: '展开', collapse: '收起',
      bind: '会话 → 需求', unbound: '未绑定', bindWorkspace: '会话 → 本工作区', commit: '提交 .project', uncommitted: '{n} 项未提交', committed: '已提交', gitUnavailable: 'git 不可用',
      viewBoard: '看板', viewWiki: 'Wiki', viewSync: '建议', viewArch: '架构', wikiTitle: '项目 Wiki', wikiEmpty: '还没有 Wiki，点击生成。', wikiPages: '页面', wikiLastUpdate: '最近更新', wikiDateUnknown: '日期未知', mermaidNote: 'Mermaid 图（源码）', wikiBack: '返回页面列表', copy: '复制', copied: '已复制', wikiEvidence: '来源证据', wikiNoEvidence: '此页暂无来源记录。', wikiUnavailable: '来源暂时无法打开，请检查来源是否可用后重试。',
      archTitle: '项目架构图', archGenerate: '生成架构图', archRegenerate: '重新生成', archEmpty: '还没有架构图。点击生成，将基于项目源码自动绘制。', archAuthoring: '正在阅读源码并绘制架构图…', archRendering: '正在生成图…', archRepairing: '正在优化布局…', archDone: '架构图已就绪。', archHint: '基于项目源码自动生成',
      syncTitle: '进展建议', syncRun: '核对进展', syncRunning: '正在查阅记录…', syncDone: '已核对进展。', syncNone: '已核对进展，暂时没有建议。', syncEmpty: '暂无待处理建议。可以核对项目进展，看看是否有更新。', syncDismiss: '忽略', syncEvidence: '参考资料', syncSaved: '新增 {n} 条建议', syncPending: '{n} 条待处理', syncAcceptRate: '采用率 {rate}%（{accepted}/{total}）',
      kind_advance: '状态推进', kind_review: '状态复核', kind_capture: '捕获新工作', kind_clarify: '欠澄清', kind_stalled: '停滞', kind_wiki_drift: 'Wiki 漂移',
      wikiTryAgain: 'Wiki 生成未完成，可以重试。',
      wikiStagingFailed: '无法准备临时工作副本，请检查项目状态和文件权限后重试。原 Wiki 未改动。',
      wikiSourceUnsupported: '此项目包含暂不支持的 Git 工作树、子模块、符号链接或特殊索引，原 Wiki 未改动。',
      wikiPublishConflict: '生成期间项目或 Wiki 有变化，新内容没有覆盖原 Wiki。请重新更新。',
      wikiPublishFailed: '新 Wiki 未能正常发布，请检查项目目录后重试。',
      wikiPublishRecovery: '新 Wiki 未能发布，原资料保存在以下位置，请先检查并恢复：',
      wikiPublishedStatusFailed: '新 Wiki 已发布，但更新状态未能保存；请检查项目目录中的 Wiki 后再重试。',
      wikiPublishing: 'Wiki 已生成，正在发布，此时无法停止。',
      wikiRebuildNotice: '更新会重新生成；Git 忽略文件不参与，原资料保存在项目本地备份中，不会自动合并。',
      wikiShowingPrevious: '正在查看本次更新前保存的 Wiki。',
      wikiPreviousUnavailable: '上次更新没有保存此前版本，当前页面可能已被改写。',
      wikiSnapshotFailed: '无法安全保存 Wiki 副本，更新没有启动；请检查文件权限、属性、大小及系统支持后重试。',
      wikiSnapshotUnreadable: '无法安全读取已保存的 Wiki 版本，更新没有启动。',
      wikiSavedViewUnreadable: '已保存的 Wiki 版本缺失或损坏，暂时无法安全读取。',
      wikiExternalChangeView: '当前 Wiki 状态发生变化或暂时无法核验；正在显示较早的保存版本。',
      wikiNoSavedExternal: '当前 Wiki 状态发生变化或暂时无法核验，没有可读取的较早保存版本。',
      wikiExternalChangeBlocked: '当前 Wiki 状态发生变化或暂时无法核验；请先检查更新状态，再启动新的更新。',
      wikiRootNotTopLevel: '请将 Git 仓库的顶层文件夹作为项目打开后，再生成 Wiki。',
      wikiNeedsGit: '生成 Wiki 需要 Git 仓库。请先在当前项目初始化 Git，无需提交。',
      wikiGitMissing: '找不到 Git。请安装 Git 或检查其配置后重试。',
      wikiRootUnavailable: '无法读取项目的 Git 工作目录。请确认 Git 可用，并打开包含项目文件的仓库顶层文件夹。',
      wikiStateUnreadable: '无法安全读取现有 Wiki 或未完成的更新，请检查文件后重试。',
      wikiMetadataUnsafe: 'Wiki 中有系统伴随文件，当前生成器可能误处理。为保护文件，暂时不能更新，请检查后重试。',
      wikiCheckpointUnsafe: '上次 Wiki 更新记录把系统伴随文件当成了页面。为保护资料，暂时不能继续，请检查更新记录。',
      archTryAgain: '架构图暂时无法生成，可以重试。',
      archSourceRequired: '这次生成没有找到可引用的项目源码。请确认项目中已有可读取的源码，再试一次。',
      archSourceInvalid: '架构图引用的文件或行号无法核对。请检查项目源码后重试。',
      generationNeedsSession: '请打开这个项目中的会话后重试。',
      generationStatusUnavailable: '暂时无法确认处理进度。重试可重新确认。',
      generationStopFailed: '停止请求未完成，可以重试。',
      syncRunFailed: '进展核对未完成，可以重试。',
      syncAdoptContent: '批量采用内容建议',
      syncLocateRequirement: '在看板定位', syncLocateTask: '在任务栏定位',
      syncSourceConversation: '任务会话', syncSourceDraft: '依据项目内容起草',
      syncSourceCommit: '代码提交 {revision}',
      syncBatchResult: '已采用 {adopted} 条，{failed} 条未能采用',
      kind_req_draft: '需求草稿', kind_field_draft: '任务草稿', kind_new_task: '新增任务', kind_task_suggestion: '任务建议',
      wikiBusy: '另一个项目正在生成 Wiki，请等它完成或先停止。', wikiGenerate: '生成 Wiki', wikiUpdate: '更新 Wiki', wikiStop: '停止', wikiStopping: '正在停止…', wikiStopped: '已停止生成。', wikiGenerating: '正在生成 Wiki…可能需要几分钟。', wikiDone: 'Wiki 生成完成。', wikiNoop: 'Wiki 已是最新，无需更新。', wikiProbeOk: 'Wiki 生成服务可用（{n} 个工具）。', wikiProbeMissing: 'Wiki 生成服务不可用。',
      demoTitle: '阶段1原型演示（临时入口）', demoPrepare: '准备演示数据', demoView: '查看', demoStart: '开始处理', demoHint: '查看不发送请求；开始只提交一次。',
      demoOpened: '已打开任务会话。', demoTabFallback: '会话已打开；请在右栏打开「项目工作台」查看任务卡。', demoStarted: '已提交一次处理请求。', demoAlready: '已有执行中的请求，进入会话查看进度。', demoBusy: '会话正在处理其他输入，未提交新请求。', demoUncertain: '提交结果不明确，已保留执行锁；请重试核实。', demoNoLink: '本会话未关联演示任务。', demoUnrecorded: '本轮可能有未记录的进展。', demoNotePlaceholder: '输入人工进展…', demoNote: '人工记录', demoContinue: '继续处理', demoStop: '停止', demoRunState: '执行', demoCursor: '已记录到事件', demoFailed: '演示操作失败',
      demoResult: '处理结果', demoEvidence: '验证依据', demoAcceptance: '完成标准', demoLimits: '已知限制', demoNoResult: '尚无结果',
      demoConfirm: '任务验收通过', submitTaskAcceptance: '提交任务验收', demoDrafts: '待采用草稿', demoAdopt: '采用', demoDismiss: '放弃',
      demoDeliveryFailed: '摘要生成失败', demoManualSummary: '填写交付摘要…', demoSubmitAcceptance: '提交验收', demoDeliverySummary: '交付摘要', demoPendingAcceptance: '待验收', demoCancelImpact: '取消对范围的影响',
    }

    const css = `
.pw-page{box-sizing:border-box;position:relative;height:100%;display:flex;flex-direction:column;overflow:hidden;padding:calc(20px + var(--dsh-frame-top-clearance,0px)) clamp(16px,3vw,32px) 16px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px)}
.pw-page *{box-sizing:border-box}
.pw-page ::-webkit-scrollbar{width:10px;height:10px}
.pw-page ::-webkit-scrollbar-track{background:transparent}
.pw-page ::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:6px;border:2px solid transparent;background-clip:content-box}
.pw-page ::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2);background-clip:content-box}
.pw-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px}
.pw-title{margin:0;font-size:18px;font-weight:500}
.pw-ws-switch{position:relative;display:flex;align-items:center;min-width:0}
.pw-ws-button{display:inline-flex;align-items:center;gap:6px;max-width:min(52vw,560px);border:none;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:18px;font-weight:500;padding:2px 4px;border-radius:6px;cursor:pointer}
.pw-ws-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-ws-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-ws-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pw-ws-caret{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.pw-ws-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:30;display:flex;flex-direction:column;gap:2px;min-width:240px;max-width:min(420px,80vw);max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.28)}
.pw-ws-item{display:flex;align-items:center;gap:8px;width:100%;border:none;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;padding:7px 8px;border-radius:6px;cursor:pointer;overflow-wrap:anywhere}
.pw-ws-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-ws-item.active{background:var(--dsw-alias-interactive-bg-active)}
.pw-ws-check{flex:none;width:14px;font-size:12px;color:var(--dsw-alias-brand-primary)}
.pw-workspace-list{display:flex;flex-direction:column;gap:8px;width:min(440px,92%);max-height:50vh;overflow:auto;margin:6px 0}
.pw-workspace-card{display:flex;flex-direction:column;align-items:flex-start;gap:3px;width:100%;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.pw-workspace-card:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}
.pw-workspace-card .pw-count{max-width:100%;overflow-wrap:anywhere}
.pw-spacer{flex:1}
.pw-button{min-height:30px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;transition:background .12s ease,border-color .12s ease}
.pw-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pw-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.pw-button:disabled{opacity:.5;cursor:not-allowed}
.pw-button.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.pw-button.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.pw-button.danger{color:var(--dsw-alias-state-error-primary)}
.pw-button:focus-visible,.pw-input:focus-visible,.pw-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-input{min-height:32px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;width:100%}
.pw-banner{padding:8px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);margin-bottom:10px;font-size:13px;display:flex;gap:8px;align-items:center}
.pw-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.pw-banner.pw-warn{border-color:var(--dsw-alias-state-warn-primary)}
.pw-diaglist{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
.pw-diaglist code{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.pw-diagwrap{display:flex;flex-direction:column;gap:4px;min-width:0}
.pw-diagwrap summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.pw-board{flex:1;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(160px,1fr);gap:12px;min-height:0;overflow:auto;padding-bottom:4px}
.pw-col{display:flex;flex-direction:column;min-height:0;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px}
.pw-col.pw-drop-target{border-color:var(--dsw-alias-brand-primary)}
.pw-col.dragover{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-colhead{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:10px}
.pw-dot{width:8px;height:8px;border-radius:50%;flex:none}
.pw-count{font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:400}
.pw-cards{display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0;padding-right:2px}
.pw-card{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);padding:10px;cursor:grab;min-height:44px;user-select:none;transition:border-color .12s ease,transform .12s ease,box-shadow .12s ease}
.pw-preview{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.pw-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 8px}
.pw-subpage-head h2{overflow-wrap:anywhere}
.pw-disclosure{border-top:1px solid var(--dsw-alias-border-l3);padding:8px 0}
.pw-disclosure summary{cursor:pointer;color:var(--dsw-alias-label-secondary);padding:4px 0}
.pw-disclosure summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-result{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:10px;margin:6px 0;min-width:0}
.pw-task-pane{overflow:auto;display:block;padding:10px 12px 16px}
.pw-result ul{padding-inline-start:20px}
.pw-card:hover{border-color:var(--dsw-alias-border-l1);transform:translateY(-1px)}
.pw-card:active{cursor:grabbing}
.pw-card.selected{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.pw-cardtitle{font-size:14px;line-height:20px;margin:0 0 7px;overflow-wrap:anywhere;font-weight:500}
.pw-cardmeta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.pw-flag{padding:1px 7px;border-radius:5px;font-size:11px;line-height:16px;flex:none;background:var(--dsw-alias-bg-layer-2)}
.pw-flag.blocked{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.pw-flag.clarify,.pw-flag.stalled{color:var(--dsw-alias-state-warn-label)}
.pw-flag.submittable,.pw-flag.acceptable{color:var(--dsw-alias-state-success-primary)}
.pw-next{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:5px;overflow-wrap:anywhere}
.pw-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;flex:1}
.pw-bar>span{display:block;height:100%;background:var(--dsw-alias-brand-primary);transition:width .2s ease}
.pw-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:12px 4px;text-align:center;border:1px dashed var(--dsw-alias-border-l3);border-radius:8px}
.pw-lower{display:flex;gap:12px;margin-top:12px;min-height:0;max-height:42%}
.pw-detail,.pw-issues{flex:1;overflow:auto;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px}
.pw-field{margin-bottom:10px}
.pw-label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.pw-issue{display:flex;align-items:center;gap:8px;padding:0 8px 0 0;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-base);margin-bottom:6px}
.pw-istatus{font-size:11px;line-height:16px;padding:1px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);flex:none}
.pw-istatus.st-doing{color:var(--dsw-alias-brand-primary)}
.pw-istatus.st-done{color:var(--dsw-alias-state-success-primary)}
.pw-istatus.st-blocked{color:var(--dsw-alias-state-error-primary)}
.pw-istatus.st-cancelled{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.pw-select{min-height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.pw-act{font-size:12px;color:var(--dsw-alias-label-secondary);padding:2px 0}
.pw-modal-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-base);opacity:.55;z-index:40}
.pw-modal{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:41;width:min(420px,90%);max-height:90%;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:16px;display:flex;flex-direction:column;gap:10px}
.pw-modal h3{margin:0;font-size:15px}
.pw-modal p{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.pw-modal-actions{display:flex;justify-content:flex-end;gap:8px}
.pw-modal.wide{width:min(620px,92vw);max-height:86vh}
.pw-modal-body{overflow:auto;display:flex;flex-direction:column;gap:10px;min-height:0;padding-right:2px}
.pw-textarea{width:100%;min-height:72px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;resize:vertical;line-height:1.5}
.pw-textarea:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.pw-issue-title{display:flex;align-items:center;gap:8px;justify-content:space-between;flex:1;min-width:0;min-height:44px;padding:4px 8px;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;text-align:left}
.pw-issue-title:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.pw-issue-title:focus-visible,.pw-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-issue .pw-select{flex:none;max-width:42%}
.pw-refchip{display:inline-block;font-size:11px;padding:1px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin:0 4px 4px 0;font-family:var(--dsh-font-family-mono,monospace)}
.pw-reflink{border:none;cursor:pointer;color:var(--dsw-alias-brand-primary)}
.pw-reflink:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-refwrap{display:inline-flex;align-items:center;gap:2px;margin:0 6px 4px 0}
.pw-refdel{border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:10px;padding:2px;border-radius:4px}
.pw-refdel:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}
.pw-meta-row{display:flex;gap:16px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex-wrap:wrap}
.pw-detail-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pw-updates{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l3);padding-top:10px}
.pw-update-list{display:flex;flex-direction:column;gap:6px;margin:6px 0 10px;max-height:220px;overflow:auto}
.pw-update{display:flex;gap:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-base)}
.pw-update-ts{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsh-font-family-mono,monospace);padding-top:1px}
.pw-update-body{font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.pw-update-add{display:flex;gap:6px}
.pw-update-add .pw-input{flex:1}
.pw-init{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center}
.pw-sync{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:auto}
.pw-sync-list{display:flex;flex-direction:column;gap:10px}
.pw-proposal{border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px;display:flex;flex-direction:column;gap:8px}
.pw-proposal-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pw-proposal-reason{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.pw-proposal-evidence{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pw-moveerr{font-size:14px;line-height:1.6;color:var(--dsw-alias-label-primary);padding:4px 0}
.pw-evidence{margin-top:16px;border-top:1px solid var(--dsw-alias-border-l3);padding-top:10px}
.pw-claim{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);padding:8px 10px;margin-top:8px}
.pw-claim-stmt{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.pw-claim-ev{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}
.pw-arch{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px}
.pw-arch-frame{flex:1;min-height:0;width:100%;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base)}
.pw-subpage-stack{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px}
.pw-subpage-stack>.pw-subpage{flex:none}
.pw-subpage{min-height:0;overflow:auto;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:20px}
.pw-breadcrumb{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;overflow:auto;white-space:nowrap;flex:none}
.pw-crumb{border:none;background:none;color:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;padding:2px 4px;border-radius:4px}
.pw-crumb:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-crumb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-crumb-sep{color:var(--dsw-alias-label-tertiary)}
.pw-crumb-current{color:var(--dsw-alias-label-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis}
.pw-subpage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
.pw-subpage-head h2{margin:0 0 4px;font-size:20px;line-height:28px;overflow-wrap:anywhere}
.pw-reading{max-width:860px;line-height:1.6}
.pw-reading-block{margin:0 0 12px}
.pw-reading-label{font-size:14px;font-weight:600;margin:0 0 4px}
.pw-reading-list{padding-inline-start:22px;margin:4px 0 8px;overflow-wrap:anywhere}
.pw-reading-list li{margin:3px 0;white-space:pre-wrap}
.pw-read-card{padding:clamp(14px,2vw,24px)}
.pw-read-card .pw-subpage-head{flex-direction:row;flex-wrap:wrap;gap:10px 20px;margin-bottom:18px}
.pw-read-card .pw-subpage-head>.pw-actions{max-width:100%}
.pw-read-card .pw-read-title{display:flex;align-items:center;flex:1 1 280px;flex-wrap:wrap;gap:6px 10px;min-width:0}
.pw-read-card .pw-read-title h2{max-width:100%;margin:0;font-size:1.6em;line-height:1.25;font-weight:650}
.pw-read-card .pw-read-status{
  --pw-status-accent:var(--dsw-alias-label-secondary);
  display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 8px;
  border:1px solid var(--dsw-alias-border-l3);border-radius:999px;
  background:var(--dsw-alias-bg-layer-2);
  background:color-mix(in srgb,var(--pw-status-accent) 9%,var(--dsw-alias-bg-layer-1));
  color:var(--dsw-alias-label-primary);font-size:.85em;font-weight:550;line-height:1.5;overflow-wrap:anywhere
}
.pw-read-card .pw-read-status::before{content:'';flex:none;width:6px;height:6px;border-radius:50%;background:var(--pw-status-accent)}
.pw-read-card .pw-read-status:is([data-status="in_progress"],[data-status="doing"]){--pw-status-accent:var(--dsw-alias-brand-primary)}
.pw-read-card .pw-read-status:is([data-status="completed"],[data-status="done"]){--pw-status-accent:var(--dsw-alias-state-success-primary)}
.pw-read-card .pw-read-status[data-status="blocked"]{--pw-status-accent:var(--dsw-alias-state-warn-label)}
.pw-read-card > .pw-reading{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;max-width:760px;line-height:1.65}
.pw-read-card .pw-reading-block{margin:0}
.pw-read-card .pw-reading-label{margin:0 0 4px;color:var(--dsw-alias-label-secondary);font-size:.93em}
.pw-read-card .pw-reading-block > :is(.pw-text,.pw-reading-list){margin-block:0}
.pw-read-card .pw-reading-block > :is(.pw-text,.pw-reading-list) + :is(.pw-text,.pw-reading-list){margin-block-start:6px}
.pw-read-card .pw-reading-block > div + div{margin-block-start:8px}
.pw-read-card .pw-reading-block > div > strong{color:var(--dsw-alias-label-secondary);font-size:.9em}
.pw-read-card .pw-reading-lead > :is(p,ol,ul):first-child,
.pw-read-card .pw-reading-lead > h3 + :is(p,ol,ul){font-size:1.12em}
.pw-read-card :is(.pw-reading-divider,.pw-reading-delivery,.pw-reading-footer){border-block-start:1px solid var(--dsw-alias-border-l3);padding-block-start:12px}
.pw-read-card .pw-reading-divider:first-child{border:0;padding:0}
.pw-read-card .pw-reading-criteria{
  padding:10px 14px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-1))
}
.pw-read-card .pw-reading-reason{
  padding:10px 14px;border-inline-start:3px solid var(--dsw-alias-border-l2);border-radius:6px;
  background:var(--dsw-alias-bg-layer-2)
}
.pw-read-card .pw-reading-warning{
  border-inline-start-color:var(--dsw-alias-state-warn-label);
  background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 10%,var(--dsw-alias-bg-layer-1))
}
.pw-read-card :is(.pw-reading-result,.pw-reading-delivery){display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.pw-read-card > .pw-reading > .pw-reading-result{border-block:1px solid var(--dsw-alias-border-l3);padding-block:12px}
.pw-read-card > .pw-reading > .pw-reading-result:first-child{border-block-start:0;padding-block-start:0}
.pw-read-card .pw-reading-verification strong{font-size:.93em;color:var(--dsw-alias-label-secondary)}
.pw-read-card .pw-reading-verification .pw-text{margin:2px 0}
.pw-read-card .pw-reading > .pw-note{margin:0;color:var(--dsw-alias-label-secondary)}
.pw-read-card .pw-reading-result > .pw-note{color:var(--dsw-alias-state-warn-label)}
.pw-read-card > .pw-reading > .pw-disclosure{border:0;padding:0}
.pw-read-card > .pw-reading > .pw-disclosure > .pw-reading-block + .pw-reading-block{margin-block-start:10px}
.pw-read-card .pw-reading-footer{color:var(--dsw-alias-label-secondary);font-size:.9em;font-variant-numeric:tabular-nums}
.pw-detail-more{border:0;padding:0}
.pw-detail-more summary{margin-bottom:4px}
.pw-card-shell{min-width:0}
.pw-card-retry{margin-top:4px}
.pw-actions{display:flex;gap:8px;flex-wrap:wrap}
.pw-quiet{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.pw-quiet:focus-visible,.pw-task-menu summary:focus-visible,.pw-progress-item summary:focus-visible,.pw-choice:focus-within{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-task-fields .pw-field,.pw-task-picker .pw-field,.pw-progress-form .pw-field{display:block;margin:0 0 10px}
.pw-task-fields .pw-textarea[rows="1"]{min-height:32px;padding-block:5px}
.pw-task-toolbar,.pw-task-tools{display:flex;align-items:center;gap:6px;min-width:0}
.pw-task-toolbar{justify-content:space-between;flex-wrap:wrap;margin:0 0 10px}
.pw-task-tools{justify-content:flex-end;flex-wrap:wrap}
.pw-task-toolbar .pw-quiet{padding-inline:8px}
.pw-task-menu{position:relative}
.pw-task-menu summary{list-style:none;cursor:pointer;display:grid;place-items:center;border-radius:6px;min-width:34px;min-height:32px;font-size:21px;line-height:1}
.pw-task-menu summary::-webkit-details-marker,.pw-progress-item summary::-webkit-details-marker{display:none}
.pw-task-menu summary:hover,.pw-task-menu[open] summary{background:var(--dsw-alias-interactive-bg-hover)}
.pw-task-menu-items{position:absolute;z-index:4;inset-inline-end:0;top:calc(100% + 4px);width:max-content;max-width:210px;min-width:126px;display:grid;gap:2px;padding:5px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.22)}
.pw-task-menu-items .pw-button{text-align:start}
.pw-sidebar-notice{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;margin:0 0 9px;color:var(--dsw-alias-label-secondary);font-size:.9em}
.pw-sidebar-detail,.pw-task-picker{padding:14px 16px;overflow:visible}
.pw-sidebar-detail{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;line-height:1.55}
.pw-sidebar-heading{display:grid;gap:6px;padding-block-end:12px;border-block-end:1px solid var(--dsw-alias-border-l3)}
.pw-sidebar-title{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px}
.pw-sidebar-meta,.pw-task-picker-head,.pw-progress-head{display:flex;gap:4px 10px;align-items:center;flex-wrap:wrap;min-width:0}
.pw-sidebar-title h2,.pw-task-picker-head h2{font-size:1.38em;line-height:1.35;margin:0;overflow-wrap:anywhere;min-width:0}
.pw-sidebar-title h2{font-weight:650}
.pw-sidebar-title .pw-quiet,.pw-task-toolbar .pw-button{font-size:.92em}
.pw-task-picker-head .pw-quiet,.pw-progress-head .pw-quiet{margin-inline-start:auto}
.pw-parent-link{font-size:.9em;text-align:start;overflow-wrap:anywhere;max-width:100%;padding-inline:2px}
.pw-parent-link:hover{text-decoration:underline}
.pw-sidebar-detail :is(.pw-note,.pw-error){margin:0;overflow-wrap:anywhere}
.pw-sidebar-detail .pw-note{color:var(--dsw-alias-label-secondary);font-size:.89em}
.pw-sidebar-detail>.pw-reading{gap:14px;line-height:1.6}
.pw-sidebar-detail .pw-reading-label{margin-block-end:3px;font-size:.91em}
.pw-sidebar-detail .pw-reading-lead > h3 + :is(p,ol,ul){font-size:1em}
.pw-sidebar-detail .pw-sidebar-empty-field .pw-text{color:var(--dsw-alias-label-secondary);font-size:.93em}
.pw-sidebar-detail .pw-reading-divider{padding-block-start:12px}
.pw-sidebar-detail>.pw-reading>.pw-sidebar-review{
  gap:12px;padding:12px;border:1px solid var(--dsw-alias-border-l3);
  border-radius:8px;background:var(--dsw-alias-bg-base);min-width:0
}
.pw-sidebar-review .pw-reading-criteria{padding:8px 10px;border:0;border-inline-start:2px solid var(--dsw-alias-brand-primary);border-radius:4px}
.pw-sidebar-review .pw-reading-verification .pw-text{margin-block:3px 0}
.pw-sidebar-detail .pw-sidebar-review>.pw-evidence-note{color:var(--dsw-alias-label-secondary)}
.pw-sidebar-review .pw-acceptance-assist,.pw-review-actions{border-block-start:1px solid var(--dsw-alias-border-l3);padding-block-start:10px}
.pw-sidebar-review .pw-acceptance-assist{display:grid;grid-template-columns:minmax(0,1fr);gap:7px}
.pw-sidebar-review .pw-acceptance-assist>.pw-reading-label{margin:0}
.pw-assist-actions{display:flex;flex-wrap:wrap;gap:6px}
.pw-assist-actions>.pw-button{flex:1 1 auto;max-width:100%;padding-inline:9px}
.pw-sidebar-review .pw-assist-disclosure{padding:0;border:0}
.pw-sidebar-review .pw-assist-disclosure summary{padding:5px 6px;border-radius:4px;font-size:.9em}
.pw-sidebar-review .pw-assist-disclosure summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-sidebar-review .pw-assist-report{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:8px 6px 3px;overflow-wrap:anywhere}
.pw-sidebar-review .pw-assist-report h4{margin:5px 0 0;font-size:.95em;font-weight:650}
.pw-guide-steps{display:grid;gap:8px}
.pw-guide-steps li>.pw-note{margin:2px 0 0;color:var(--dsw-alias-label-secondary)}
.pw-sidebar-review .pw-assist-report pre{font-size:.89em;background:var(--dsw-alias-bg-layer-1);border-radius:4px;padding:6px 8px}
.pw-task-action-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px}
.pw-task-action-row .primary{min-height:38px;padding-inline:14px}
.pw-sidebar-detail :is(.pw-task-action-row,.pw-assist-actions)>.pw-button{min-width:0;overflow-wrap:anywhere}
.pw-review-options{display:flex;flex-wrap:wrap;gap:2px 6px;min-width:0}
.pw-review-actions .pw-task-action-row .pw-quiet{font-size:.93em;padding-inline:6px}
.pw-review-actions .pw-progress-form{display:grid;justify-items:start;gap:8px}
.pw-task-picker-head{margin-bottom:12px}
.pw-choice-list{display:grid;gap:4px;max-height:min(46vh,380px);overflow:auto;padding:2px;margin:0 0 10px;overscroll-behavior:contain}
.pw-choice{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:9px;min-height:44px;padding:8px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l3);cursor:pointer}
.pw-choice[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}
.pw-choice-copy{display:grid;gap:2px;min-width:0;overflow-wrap:anywhere}
.pw-choice-copy .pw-note{margin:0;font-size:.86em}
.pw-progress{border-top:1px solid var(--dsw-alias-border-l3);padding-top:9px;min-width:0}
.pw-progress-head{min-height:32px;margin-bottom:2px}
.pw-progress-head h3{font-size:1em;margin:0}
.pw-progress-item{border-bottom:1px solid var(--dsw-alias-border-l3)}
.pw-progress-item summary{list-style:none;display:grid;grid-template-columns:minmax(0,1fr) auto;align-content:center;gap:1px 8px;min-height:44px;cursor:pointer;padding:5px 4px}
.pw-progress-item summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-progress-item time{grid-column:1;color:var(--dsw-alias-label-secondary);font-size:.82em;line-height:1.3;font-variant-numeric:tabular-nums}
.pw-progress-item summary .pw-preview{grid-column:1;line-height:1.4}
.pw-progress-item summary::after{content:'›';grid-column:2;grid-row:1 / span 2;align-self:center;color:var(--dsw-alias-label-secondary);font-size:1.25em}
.pw-progress-item[open] summary::after{transform:rotate(90deg)}
.pw-progress-detail{padding:4px 8px 10px 12px;border-inline-start:2px solid var(--dsw-alias-border-l3);margin:0 0 8px 4px;overflow-wrap:anywhere}
.pw-progress-detail>.pw-note{font-size:.85em;margin:0 0 5px}
.pw-sidebar-detail .pw-progress{padding-block-start:12px}
.pw-sidebar-detail .pw-progress-head{margin-block-end:4px}
.pw-sidebar-detail .pw-progress-item summary{padding:7px 6px;gap:3px 8px}
.pw-sidebar-detail .pw-progress-item summary .pw-preview{font-size:.95em}
.pw-progress-form{margin:8px 0 4px}
.pw-requirement-fields .pw-field{display:block}
.pw-requirement-fields .pw-textarea[rows="1"]{min-height:34px;padding-block:6px}
.pw-subpage-stack .pw-issues{overflow:visible;flex:none}
.pw-issue-page .pw-updates{max-width:860px}
.pw-viewswitch{display:flex;gap:4px}
.pw-wiki-wrap{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px}
.pw-wiki{flex:1;display:flex;gap:12px;min-height:0;overflow:hidden}
.pw-wiki-list{width:240px;flex:none;overflow:auto;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px;display:flex;flex-direction:column;gap:4px}
.pw-wiki-item{background:none;border:none;text-align:left;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);padding:6px 8px;border-radius:6px;cursor:pointer;overflow-wrap:anywhere}
.pw-wiki-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-wiki-item.active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.pw-wiki-group{margin-top:6px}
.pw-wiki-grouhead{display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;font:inherit;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);padding:5px 6px;border-radius:6px;cursor:pointer;text-transform:none}
.pw-wiki-grouhead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-caret{display:inline-block;font-size:10px;color:var(--dsw-alias-label-tertiary);transition:transform .12s}
.pw-caret.closed{transform:rotate(-90deg)}
.pw-wiki-groupitems{display:flex;flex-direction:column;gap:2px;padding-left:16px}
.pw-wiki-body{flex:1;overflow:auto;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:16px}
.pw-md{max-width:760px;line-height:1.6;font-size:14px}
.pw-md-h{margin:16px 0 8px;line-height:1.3}
.pw-md-p{margin:8px 0}
.pw-md-ul{margin:8px 0;padding-left:22px}
.pw-inline-code{font-family:var(--dsh-font-family-mono,monospace);font-size:.9em;background:var(--dsw-alias-bg-layer-2);padding:1px 5px;border-radius:4px}
.pw-codeblock{margin:10px 0;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;overflow:hidden}
.pw-code-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}
.pw-code-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.pw-copy{min-height:22px;padding:0 8px;font-size:11px}
.pw-codeblock pre{margin:0;padding:12px;overflow:auto;font-family:var(--dsh-font-family-mono,monospace);font-size:12px;line-height:1.5;background:var(--dsw-alias-bg-base)}
.pw-md a{color:var(--dsw-alias-brand-primary)}
.pw-md-tablewrap{overflow:auto;margin:10px 0;border:1px solid var(--dsw-alias-border-l3);border-radius:8px}
.pw-md-table{border-collapse:collapse;width:100%;font-size:13px}
.pw-md-table th{background:var(--dsw-alias-bg-layer-2);text-align:left;font-weight:600}
.pw-md-table th,.pw-md-table td{border:1px solid var(--dsw-alias-border-l3);padding:6px 10px;line-height:1.5;vertical-align:top}
.pw-md-table tbody tr:nth-child(even){background:var(--dsw-alias-bg-base)}
@media(max-width:1023px){.pw-board{grid-template-columns:repeat(2,minmax(0,1fr))}.pw-lower{flex-direction:column;max-height:none}}
@media(max-width:767px){.pw-board{grid-template-columns:1fr}.pw-subpage-head{flex-direction:column}}
@media(prefers-reduced-motion:reduce){.pw-page *{transition:none!important}}
`

    function WorkbenchIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 2, y: 3, width: 4, height: 11, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('rect', { x: 8, y: 3, width: 4, height: 14, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('rect', { x: 14, y: 3, width: 4, height: 8, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 }))
    }

    const shellCss = `
.pw-shell-body{flex:1;display:flex;gap:12px;min-height:0}
.pw-menu{flex:none;width:170px;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:8px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.pw-menu-group{display:flex;flex-direction:column;gap:2px;margin-top:8px}
.pw-menu-grouptitle{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:2px 8px}
.pw-menu-item{border:none;background:none;text-align:left;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);padding:7px 10px;border-radius:6px;cursor:pointer;min-height:32px}
.pw-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-menu-item.active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}
.pw-menu-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-content{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.pw-content>.pw-breadcrumb{flex:none}
.pw-home{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;overflow:auto}
.pw-home-title{margin:0 0 10px;font-size:15px}
.pw-home-list{display:flex;flex-direction:column;gap:8px}
.pw-home-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base)}
.pw-home-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pw-home-counts{display:flex;flex-wrap:wrap;gap:10px}
.pw-home-count{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:88px;padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.pw-home-count:hover{border-color:var(--dsw-alias-brand-primary)}
.pw-home-count:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-home-count strong{font-size:20px}
.pw-home-count span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.pw-list{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:auto}
.pw-list-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none}
.pw-list-rows{display:flex;flex-direction:column;gap:8px}
.pw-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.pw-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;border:none;background:none;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;padding:4px 6px;border-radius:6px;min-height:44px}
.pw-row-main:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-row-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-row-static{cursor:default}
.pw-row-static:hover{background:none}
.pw-row-actions{display:flex;align-items:center;gap:6px;flex:none}
.pw-order{display:inline-flex;flex-direction:column;gap:2px}
.pw-orderbtn{border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);border-radius:4px;width:22px;height:18px;line-height:1;cursor:pointer;font-size:11px;padding:0}
.pw-orderbtn:disabled{opacity:.4;cursor:not-allowed}
.pw-orderbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pw-dev-progress{display:flex;align-items:center;gap:8px;min-width:0}
.pw-dev-progress .pw-bar{max-width:120px;flex:none;width:120px}
.pw-startbtn{flex:none}
.pw-source-view{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);font-family:var(--dsh-font-family-mono,monospace);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:50vh;overflow:auto}
.pw-blocked-section{margin-bottom:4px}
.pw-issue .pw-order{flex:none}
@media(max-width:767px){.pw-shell-body{flex-direction:column}.pw-menu{width:auto;flex-direction:row;flex-wrap:wrap;flex:none}.pw-menu-group{flex-direction:row;flex-wrap:wrap;margin-top:0;align-items:center}.pw-menu-grouptitle{display:none}}
`

    // Browsing state for this plugin instance: survives panel unmount, not page
    // reload. Keyed by project identity so switching projects never mixes data/drafts.
    const uiMemory = { picked: null, views: {}, drafts: {}, newRequirements: {}, wikiGen: {}, taskReviews: {} }

    const shellLocale = {
      en: {
        navHome: 'Home', navRequirements: 'Requirements', navPool: 'Requirement pool', navReview: 'Review', navReady: 'Ready',
        navDevelopment: 'Development', navDev: 'In development', navBlocked: 'Blocked & risks', navBoard: 'Board',
        navAcceptance: 'Acceptance', navPending: 'Pending acceptance', navRecords: 'Acceptance records',
        navResources: 'Resources', navWiki: 'Wiki', navArch: 'Architecture',
        backToPage: 'Back to {page}', backToPrevious: 'Back to previous page',
        homeNeedsYou: 'Needs your attention', homeProgress: 'Project progress', homeNothing: 'Nothing needs your attention right now.',
        homeIncomplete: 'Some project data could not be read. Reminders may be incomplete and progress counts are unavailable. Check the data and retry.',
        runFactsUnavailable: 'Task run status could not be read. Permission reminders may be incomplete or out of date. Retry to check again.',
        homeFirstRequirement: 'Record your first requirement', homeGoReview: 'Review', homeViewPlan: 'View plan', homeGoConfirm: 'Confirm',
        homeGoAccept: 'Accept', homeGoHandle: 'Handle', homeBlockedTasks: 'Blocked tasks',
        waitNow: 'just now', waitMinute: 'waiting {n} min', waitHour: 'waiting {n} h', waitDay: 'waiting {n} d',
        waitUnknown: 'Waiting time unknown', authWaitUnknown: 'Authorization wait time unknown', blockedAndAuthWaitUnknown: 'Blocked and authorization wait times unknown', confirmationAndAuthWaitUnknown: 'Confirmation and authorization wait times unknown', blockedWaitWithUnknownAuth: 'Blocked: {wait}; authorization wait time unknown', confirmationWaitWithUnknownAuth: 'Confirmation: {wait}; authorization wait time unknown', authRequestWait: 'Authorization requested: {wait}', blockedWaitWithAuth: 'Blocked: {wait}; authorization requested: {auth}', confirmationWaitWithAuth: 'Confirmation: {wait}; authorization requested: {auth}', authRemindersRefreshing: 'Updating authorization reminders; combined task reminders may be temporarily hidden.',
        clearFilter: 'Clear filters', noResults: 'No matching results', locateBoard: 'Find on board',
        submittedAt: 'Submitted', reviewedAt: 'Approved', noOpinion: 'No notes yet', wasReturned: 'previously returned',
        reviewEmpty: 'No requirements awaiting review. Send one from the board.', readyEmpty: 'No approved requirements waiting to start.',
        devEmpty: 'No requirements in development. Start one from the board.', pendingEmpty: 'No requirements awaiting acceptance.',
        recordsEmpty: 'No acceptance decisions yet.', blockedEmpty: 'No blocked tasks, pending permissions, failures or recorded risks.',
        devInReview: '{n} awaiting acceptance', devBlocked: '{n} blocked', noProgress: 'No completion rate',
        moveUp: 'Move up', moveDown: 'Move down',
        reorderProgress: 'Reordering: {done} of {total} changes saved.',
        reorderFailed: 'The order was only partly saved. Retry to finish the same change. If content changed, review the list and start again.',
        reorderRetry: 'Continue reordering', reorderDiscard: 'Review and reorder again',
        blockedSection: 'Blocked tasks', authSection: 'Awaiting permission', failureSection: 'Execution failures', riskSection: 'AI-recorded risks',
        viewOriginalTask: 'View task', viewFailureReason: 'View failure',
        deliveryDetail: 'This delivery',
        previousReturns: 'Earlier return notes', recordDetail: 'Acceptance decision', decisionAt: 'Decided',
        recordReadonlyHint: 'This is a read-only record of the decision made at that time; later edits do not change it.',
        jumpToRequirement: 'Open current requirement', recordDecision: 'Decision', allDecisions: 'All decisions',
        wikiSearch: 'Search pages', sourceOpen: 'Open source', sourceUnavailable: 'This source cannot be opened right now. Check that the file still exists in the project, then retry.',
      },
      zh: {
        navHome: '首页', navRequirements: '需求管理', navPool: '需求池', navReview: '需求评审', navReady: '待开发',
        navDevelopment: '开发管理', navDev: '开发中', navBlocked: '阻塞与风险', navBoard: '看板',
        navAcceptance: '验收管理', navPending: '待验收', navRecords: '验收记录',
        navResources: '项目资料', navWiki: 'Wiki', navArch: '架构',
        backToPage: '返回{page}', backToPrevious: '返回上一页',
        homeNeedsYou: '需要你处理', homeProgress: '项目进展', homeNothing: '暂时没有需要你处理的事项。',
        homeIncomplete: '部分项目数据无法读取，提醒可能不完整，暂时无法统计项目进展。请检查数据后重试。',
        runFactsUnavailable: '无法读取任务运行状态，待授权提醒可能不完整或已过期。请重试。',
        homeFirstRequirement: '记录第一个需求', homeGoReview: '去评审', homeViewPlan: '查看安排', homeGoConfirm: '去验收任务',
        homeGoAccept: '去验收', homeGoHandle: '去处理', homeBlockedTasks: '阻塞任务',
        waitNow: '刚刚', waitMinute: '已等待 {n} 分钟', waitHour: '已等待 {n} 小时', waitDay: '已等待 {n} 天',
        waitUnknown: '等待时间未知', authWaitUnknown: '授权等待时间未知', blockedAndAuthWaitUnknown: '阻塞和授权等待时间均未知', confirmationAndAuthWaitUnknown: '确认和授权等待时间均未知', blockedWaitWithUnknownAuth: '阻塞：{wait}；授权等待时间未知', confirmationWaitWithUnknownAuth: '等待确认：{wait}；授权等待时间未知', authRequestWait: '授权请求发起：{wait}', blockedWaitWithAuth: '阻塞：{wait}；授权请求发起：{auth}', confirmationWaitWithAuth: '等待确认：{wait}；授权请求发起：{auth}', authRemindersRefreshing: '授权提醒正在更新，合并的任务提醒可能暂时隐藏。',
        clearFilter: '清空筛选', noResults: '没有符合条件的结果', locateBoard: '定位看板',
        submittedAt: '送审于', reviewedAt: '评审通过于', noOpinion: '暂无意见', wasReturned: '曾被退回',
        reviewEmpty: '暂无待评审需求，可在看板送审。', readyEmpty: '暂无评审通过、等待开始的需求。',
        devEmpty: '暂无开发中的需求，可在看板开始开发。', pendingEmpty: '暂无待验收的需求。',
        recordsEmpty: '还没有验收决定。', blockedEmpty: '暂无阻塞任务、待授权、执行失败或已记录的风险。',
        devInReview: '{n} 个待验收任务', devBlocked: '{n} 个阻塞', noProgress: '暂无完成率',
        moveUp: '上移', moveDown: '下移',
        reorderProgress: '排序已保存 {done}/{total} 项。',
        reorderFailed: '排序只完成了一部分，可继续完成本次调整。若内容已变化，请重新查看列表后再排序。',
        reorderRetry: '继续排序', reorderDiscard: '重新查看并排序',
        blockedSection: '阻塞任务', authSection: '等待授权', failureSection: '执行失败', riskSection: 'AI 记录的风险',
        viewOriginalTask: '查看原任务', viewFailureReason: '查看失败原因',
        deliveryDetail: '本轮验收详情',
        previousReturns: '历史打回意见', recordDetail: '验收记录详情', decisionAt: '决定时间',
        recordReadonlyHint: '这是当时决定的只读记录，后续编辑不会改写它。',
        jumpToRequirement: '查看当前需求', recordDecision: '决定类型', allDecisions: '全部决定',
        wikiSearch: '搜索页面', sourceOpen: '打开来源', sourceUnavailable: '暂时无法打开这个来源。请确认项目中的文件仍存在，然后重试。',
      },
    }

export default {
      inject: ['slots', 'locale', 'layout', 'connection', 'uiSession'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: { ...en, ...shellLocale.en }, zh: { ...zh, ...shellLocale.zh } }), 'project-workbench: locale')
        const t = ctx.locale.bind(NS)
        const currentSession = {
          getSnapshot: () => ctx.uiSession.adapter.current.getSnapshot().key,
          subscribe: listener => ctx.uiSession.adapter.current.subscribe(listener),
        }
        const injected = () => ({
          hooks: { currentSession }, uiMemory, css: css + shellCss,
          showConversation: () => { ctx.layout.selectPanel(null) },
          openMain: () => { ctx.layout.selectPanel(PANEL_ID) },
          // V-1: open the session first; openTab needs the session ON SCREEN, so
          // retry briefly and fall back to the two-step flow (never re-submits).
          enterSession: async sessionId => {
            const uiWorkspace = ctx.get('uiWorkspace')
            if (!uiWorkspace?.openSession) return { ok: false, tab: false }
            uiWorkspace.openSession(sessionId)
            const right = ctx.get('sidebarRight')
            if (!right) return { ok: true, tab: false }
            for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 100))
              try { right.openTab(PANEL_ID); return { ok: true, tab: true } } catch { /* session not on screen yet */ }
            }
            return { ok: true, tab: false }
          },
        })
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => injected() }, MainShell))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('panel'), locale: NS }, WorkbenchIcon))
        ctx.inject(['inputTriggers', 'sessions'], conversation => {
          conversation.effect(() => conversation.inputTriggers.registerSource(workbenchMentionSource(t, WorkbenchIcon)), 'project-workbench: @ candidate')
          conversation.slots.inject('conversation.input.dock', () => conversation.slots.register({
            name: 'conversation.input.dock', id: PANEL_ID, locale: NS, order: 20,
            inject: sessionId => ({ ...injected(), sessionId, eventSource: conversation.sessions.binding(sessionId)?.eventSource }),
          }, ConversationDock))
        })
        ctx.inject(['sidebarRight', 'sidebarRightTabs'], right => {
          right.effect(() => right.sidebarRightTabs.register({
            id: '@local/project-workbench/right', kind: PANEL_ID, title: () => t('panel'),
            guide: [{ id: PANEL_ID, order: 20, title: () => t('panel'), description: () => t('fallbackDescription'), icon: WorkbenchIcon }],
          }), 'project-workbench: right tab type')
          right.slots.inject('sidebar.right.pane.tab', () => right.slots.register({ name: 'sidebar.right.pane.tab', key: '@local/project-workbench/right', locale: NS, inject: () => injected() }, TaskPane))
        })
      },
    }
