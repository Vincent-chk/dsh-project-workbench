export const commands = {
  help: { title: '工作台使用帮助', hint: '例如 为什么这个任务不能开始？' },
  requirement: { title: '管理需求', hint: '例如 记一个可切换 AI 风格的聊天网页' },
  task: { title: '处理任务', hint: '例如 验收风格切换任务' },
  update: { title: '同步本会话进展', hint: '按回车同步，或指定需求、任务或要同步的内容' },
  prd: { title: '编写 PRD', hint: '例如 把刚才的需求整理成首版 PRD' },
  'wiki-update': { title: '生成或更新项目 Wiki', hint: '按回车启动，或输入 查看进度' },
  'architecture-update': { title: '生成或更新架构图', hint: '按回车启动，或输入 查看进度' },
  status: { title: '查看项目进展', hint: '例如 只看聊天网页需求' },
}

export function readInvocation(text) {
  const slash = /^\/pwb-([a-z-]+)(?:\s+|$)([\s\S]*)$/u.exec(text.trim())
  if (slash && Object.hasOwn(commands, slash[1])) return { kind: slash[1], text: slash[2].trim() }
  // The picker sends the reserved colon spelling. A bare typed mention can
  // still refer to a real workspace file named workbench.
  const mention = /^@workbench(?:(:|：)\s*|\s+|$)([\s\S]*)$/u.exec(text.trim())
  if (mention) return { kind: 'mention', picked: !!mention[1], text: mention[2].trim() }
  return null
}

export function simpleAction({ kind, text }) {
  const value = text.replace(/[。！.!]+$/u, '').trim()
  if (kind === 'wiki-update' || kind === 'architecture-update') {
    const type = kind === 'wiki-update' ? 'wiki' : 'arch'
    if (/^(?:查看进度|查看状态|进度|状态|status)$/iu.test(value)) return { action: 'resourceStatus', type }
    if (!value || /^(?:更新|生成|重新生成|update|generate)$/.test(value)) return { action: 'generate', type }
    return null
  }
  if (kind === 'task' && /^(?:开始(?:处理)?|继续(?:处理)?|start|continue)$/iu.test(value)) return { action: 'startLinked' }
  if (kind === 'mention') {
    if (/^(?:请|帮我)?\s*(?:生成|更新|重新生成)\s*(?:项目\s*)?wiki$/iu.test(value)) return { action: 'generate', type: 'wiki' }
    if (/^(?:请|帮我)?\s*(?:生成|更新|重新生成)\s*(?:项目\s*)?架构(?:图)?$/u.test(value)) return { action: 'generate', type: 'arch' }
    if (/^(?:请|帮我)?\s*(?:查看|看|查)\s*(?:项目\s*)?wiki\s*(?:生成|更新)?(?:进度|状态)$/iu.test(value)) return { action: 'resourceStatus', type: 'wiki' }
    if (/^(?:请|帮我)?\s*(?:查看|看|查)\s*(?:项目\s*)?架构图?\s*(?:生成|更新)?(?:进度|状态)$/u.test(value)) return { action: 'resourceStatus', type: 'arch' }
    if (/^(?:请|帮我)?\s*(?:查看|看|查)\s*(?:项目\s*)?进展$/u.test(value)) return { action: 'status' }
  }
  if (value) return null
  if (['help', 'status', 'requirement', 'task', 'mention'].includes(kind)) return { action: kind === 'mention' ? 'help' : kind }
  return null
}

export const helpText = [
  '在当前会话输入 /pwb 选择命令，或发「@workbench 帮我记一个需求」。',
  ...Object.entries(commands).map(([key, { title }]) => `/pwb-${key} · ${title}`),
  '任务验收通过由你核对证据后确认。Wiki 需要 Git 仓库顶层，无需提交。架构图需要可引用的本地源码。',
].join('\n')
