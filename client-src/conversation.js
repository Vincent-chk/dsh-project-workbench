import React from 'react'
import { Button, IconCloseOutlineRegular, IconWarningOutlineRegular, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { rpc } from './api.js'
import { projectIdOf } from './project-state.js'
import { normalizeViewState, openDetail, statusPage } from './shell/nav-state.js'
import { generationStartMessage } from './pages/resources.js'

const { createElement: h, useEffect, useRef, useState } = React
const generating = new Set(['running', 'stopping', 'starting'])
const confirmPrompts = { remove: 'removePrompt', restore: 'restorePrompt', start: 'startPrompt' }
const confirmActions = { remove: 'pwbMoveToTrash', restore: 'pwbRestore', start: 'pwbStart', prd: 'savePrd', reviewEdit: 'pwbConfirm' }
const useNoWorkspaces = () => null

export const conversationLocale = {
  zh: {
    workbenchMention: '在当前项目使用工作台', workbenchHint: '在聊天框输入 /pwb 选择操作，或用 @workbench 直接交代。',
    workbenchConversation: '会话中的项目工作台', openWorkbenchObject: '在工作台查看', openAcceptance: '打开任务与验收',
    removePrompt: '将此草稿移到回收站？', restorePrompt: '将此草稿恢复到需求池？', startPrompt: '开始处理这项任务？',
    prdMarkdown: 'PRD 草稿（Markdown）', prds: '关联 PRD', savePrd: '保存 PRD', checkPrdVersion: '核对已保存版本',
    prdBefore: '原版本中的改动部分', prdAfter: '草稿中的改动部分', prdDiff: '查看新旧差异', noPrdDiff: '内容没有变化',
    pwbCheckPassed: '通过', pwbCheckFailed: '失败', pwbCheckIncomplete: '待核实',
    pwbConfirm: '确认', pwbCancel: '取消', pwbDismiss: '关闭', pwbRetry: '重试',
    pwbPrdReady: 'PRD 草稿已就绪', pwbPreviewPrd: '预览并保存', pwbDiscardPrd: '放弃草稿',
    pwbPrdSaved: 'PRD 已保存', pwbOpenPrd: '查看 PRD',
    pwbPreviewAction: '查看并确认', pwbDetails: '查看详情', pwbReviewDetails: '核对验收',
    pwbMoveToTrash: '移到回收站', pwbRestore: '恢复草稿', pwbStart: '开始处理',
    pwbArchitecture: '架构图', pwbGenerating: '正在生成 {name}', pwbStopping: '正在停止 {name} 生成',
    pwbGenerationCount: '{n} 项资料正在生成', pwbResourceReady: '{name} 已生成', pwbOpenResource: '打开 {name}',
    pwbResourceIdle: '{name} 尚未生成',
  },
  en: {
    workbenchMention: 'Use Project Workbench in this workspace', workbenchHint: 'Type /pwb for commands, or start a message with @workbench.',
    workbenchConversation: 'Project Workbench in chat', openWorkbenchObject: 'View in Workbench', openAcceptance: 'Open task and acceptance',
    removePrompt: 'Move this draft to Trash?', restorePrompt: 'Restore this draft to the requirement pool?', startPrompt: 'Start this task?',
    prdMarkdown: 'PRD draft (Markdown)', prds: 'Related PRDs', savePrd: 'Save PRD', checkPrdVersion: 'Review the saved version',
    prdBefore: 'Changed lines in the saved version', prdAfter: 'Changed lines in the draft', prdDiff: 'Compare versions', noPrdDiff: 'No content changes',
    pwbCheckPassed: 'Passed', pwbCheckFailed: 'Failed', pwbCheckIncomplete: 'Unverified',
    pwbConfirm: 'Confirm', pwbCancel: 'Cancel', pwbDismiss: 'Dismiss', pwbRetry: 'Retry',
    pwbPrdReady: 'PRD draft ready', pwbPreviewPrd: 'Preview and save', pwbDiscardPrd: 'Discard draft',
    pwbPrdSaved: 'PRD saved', pwbOpenPrd: 'View PRD',
    pwbPreviewAction: 'Review and confirm', pwbDetails: 'View details', pwbReviewDetails: 'Review acceptance',
    pwbMoveToTrash: 'Move to Trash', pwbRestore: 'Restore draft', pwbStart: 'Start task',
    pwbArchitecture: 'architecture diagram', pwbGenerating: 'Generating {name}', pwbStopping: 'Stopping {name} generation',
    pwbGenerationCount: '{n} items generating', pwbResourceReady: '{name} ready', pwbOpenResource: 'Open {name}',
    pwbResourceIdle: '{name} has not been generated',
  },
}

export const workbenchMentionSource = (t, icon) => ({
  trigger: '@',
  name: 'project-workbench',
  order: 20,
  showGroupTitle: false,
  async candidates(_session, req) {
    if (req.quoted || req.position !== 'leading' || !'workbench'.startsWith(req.query.toLowerCase())) return []
    return [{ name: 'workbench', label: t('panel'), description: t('workbenchMention'), icon }]
  },
  onPick({ candidate }) {
    if (candidate.name !== 'workbench') return undefined
    return { insert: { source: 'project-workbench', ref: 'workbench', label: '@workbench', clipboardText: '@workbench:' } }
  },
  codec: {
    clipboardText: () => '@workbench:',
    serialize: async () => '@workbench:',
  },
})

export function openConversationTarget(card, workspaces, uiMemory, openMain) {
  if (!card.root) return
  const workspace = workspaces.find(item => item.path === card.root)
  const id = workspace ? projectIdOf(workspace) : null
  const key = id ? 'id:' + id : 'path:' + card.root
  uiMemory.picked = { id, path: card.root }
  const view = normalizeViewState(uiMemory.views[key])
  if (card.reqId) uiMemory.views[key] = openDetail(view, {
    reqId: card.reqId, issueId: card.issueId ?? null, ...(card.prdId && { prdId: card.prdId }),
  }, statusPage(card.status ?? 'backlog'))
  else if (card.type) uiMemory.views[key] = { ...view, page: card.type === 'wiki' ? 'wiki' : 'arch', params: null, history: [] }
  else uiMemory.views[key] = view
  openMain()
}

function relevantEvent(entry) {
  if (entry.type !== 'event') return false
  const { type, data } = entry.event
  return type === 'turn/end' || type === 'tool/result' || type === 'tool/ptc-dispatch' ||
    (type === 'command/run' && data?.name?.startsWith('pwb-')) || type === 'command/done'
}

export function ConversationDock(props) {
  return h(SessionConversationDock, { ...props, key: props.sessionId })
}

function SessionConversationDock({ sessionId, eventSource, t, useWorkspaces, openMain, enterSession, uiMemory, css }) {
  const [cards, setCards] = useState([])
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const shown = useRef(new Set())
  const generation = useRef(0)
  const workspaces = (useWorkspaces ?? useNoWorkspaces)(state => state?.items) ?? []
  const refreshRef = useRef(null)
  useEffect(() => {
    setError(null)
    let disposed = false
    let timer
    let watch
    const refresh = async () => {
      clearTimeout(watch)
      if (document.hidden || disposed) return
      const seq = ++generation.current
      const res = await rpc('conversation/view', { sessionId })
      if (disposed || seq !== generation.current) return
      if (!res.ok) {
        watch = setTimeout(refresh, 3000)
        return
      }
      setCards(res.data.cards)
      const running = res.data.cards.some(resourceRunning)
      watch = setTimeout(refresh, running ? 1200 : 3000)
    }
    refreshRef.current = refresh
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(refresh, 60)
    }
    const off = eventSource?.subscribe(() => {
      const { change } = eventSource.getSnapshot()
      if (change?.kind === 'replace' || (change?.kind === 'append' && change.entries.some(relevantEvent))) schedule()
    })
    document.addEventListener('visibilitychange', schedule)
    refresh()
    return () => {
      disposed = true
      refreshRef.current = null
      clearTimeout(timer)
      clearTimeout(watch)
      off?.()
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [sessionId, eventSource])

  useEffect(() => {
    const ids = new Set(cards.map(card => card.id))
    for (const id of shown.current) if (!ids.has(id)) shown.current.delete(id)
    if (toast) return
    const next = cards.find(card => isReceipt(card) && !shown.current.has(card.id))
    if (!next) return
    shown.current.add(next.id)
    setToast(next)
    // A toast is a one-time receipt. Keep its rendered copy through the fade,
    // while consuming the session card so returning to this chat cannot replay it.
    void rpc('conversation/act', { sessionId, cardId: next.id, action: 'dismiss' })
  }, [cards, sessionId, toast])

  const running = cards.filter(resourceRunning)
  const pending = cards.filter(card => card.kind !== 'resource' && !isReceipt(card))
  const open = card => openConversationTarget(card, workspaces, uiMemory, openMain)
  const perform = async (card, action, extra = {}) => {
    const res = await rpc('conversation/act', { sessionId, cardId: card.id, action, ...extra })
    setError(res.ok ? null : { cardId: card.id, ...res })
    if (refreshRef.current && res.ok && res.data.sessionId) await enterSession(res.data.sessionId)
    await refreshRef.current?.()
    return res
  }
  const dock = running.length > 0 || pending.length > 0
    ? h('section', { className: 'pw-conversation', 'aria-label': t('workbenchConversation') },
      h('style', null, css + conversationCss),
      pending.map(card => h(ConversationAction, { key: card.id, card, t, sessionId, uiMemory,
        error: error?.cardId === card.id ? error : null, perform, open: () => open(card) })),
      running.length > 0 && h(ResourceProgress, { cards: running, t }))
    : null
  return h(React.Fragment, null, dock,
    toast && h(ConversationToast, { key: toast.id, card: toast, t, open: () => open(toast), dismiss: () => setToast(null) }))
}

function resourceRunning(card) {
  return card.kind === 'resource' && generating.has(card.state)
}

function isReceipt(card) {
  return card.kind === 'resource' ? !resourceRunning(card)
    : card.kind === 'receipt' || card.failed || (card.kind === 'open' && !!card.message)
}

function resourceName(card, t) {
  return card.type === 'wiki' ? 'Wiki' : t('pwbArchitecture')
}

function ConversationToast({ card, t, open, dismiss }) {
  const resource = card.kind === 'resource'
  const name = resource ? resourceName(card, t) : null
  const stopped = resource && card.message === 'stopped by user'
  const failed = !stopped && (card.failed || card.state === 'failed')
  const canOpen = card.kind === 'open' || (resource && card.state === 'done')
  let message = card.message
  if (resource && failed) message = generationStartMessage(card, message, key => key === message ? message : t(key))
  else if (resource && stopped) message = t('wikiStopped')
  else if (resource && card.state === 'done') message = t('pwbResourceReady', { name })
  else if (resource && card.state === 'idle') message = t('pwbResourceIdle', { name })
  else if (card.kind === 'open' && card.prdId) message = t('pwbPrdSaved')
  const label = resource ? t('pwbOpenResource', { name }) : t(card.prdId ? 'pwbOpenPrd' : 'openWorkbenchObject')
  return h(Toast, {
    text: message, onDone: dismiss,
    ...(failed ? { icon: h(IconWarningOutlineRegular), holdMs: 6000 }
      : (canOpen || (card.kind === 'receipt' && !card.pending)) && { tone: 'success' }),
    actions: canOpen ? [{ label, prefix: ' · ', onClick: () => { dismiss(); open() } }] : undefined,
  })
}

function ResourceProgress({ cards, t }) {
  const label = card => t(card.state === 'stopping' ? 'pwbStopping' : 'pwbGenerating', { name: resourceName(card, t) })
  const spinner = h('span', { className: 'pw-conversation-spinner', 'aria-hidden': true })
  if (cards.length === 1) return h('div', { className: 'pw-conversation-row pw-conversation-progress', role: 'status' },
    spinner, h('span', null, label(cards[0])))
  return h('details', { className: 'pw-conversation-group' },
    h('summary', { className: 'pw-conversation-row pw-conversation-progress' },
      spinner, h('span', { role: 'status' }, t('pwbGenerationCount', { n: cards.length }))),
    h('ul', null, cards.map(card => h('li', { key: card.id }, label(card)))))
}

function ConversationAction({ card, t, sessionId, uiMemory, error, perform, open }) {
  const isPrd = card.kind === 'prd'
  const canConfirm = Object.hasOwn(confirmActions, card.kind)
  const drafts = uiMemory.drafts ??= {}
  const draftKey = 'conversation-prd:' + sessionId
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [markdown, setMarkdown] = useState(() => isPrd && drafts[draftKey]?.id === card.id
    ? drafts[draftKey].markdown : card.markdown ?? '')
  const [reason, setReason] = useState('')
  const launch = async (action, extra) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await perform(card, action, extra)
      if (res.ok && action === 'openTask') setExpanded(false)
      if (res.ok && isPrd && (action === 'confirm' || action === 'dismiss') && drafts[draftKey]?.id === card.id) {
        delete drafts[draftKey]
      }
    } finally { setBusy(false) }
  }
  const close = () => { if (!busy) setExpanded(false) }
  const confirmation = confirmPrompts[card.kind]
  const direct = card.kind === 'open' || (card.kind === 'openTask' && !card.evidence)
  const label = isPrd ? 'pwbPreviewPrd' : card.kind === 'open' ? 'openWorkbenchObject'
    : direct ? 'openAcceptance' : canConfirm ? 'pwbPreviewAction' : card.evidence ? 'pwbReviewDetails' : 'pwbDetails'
  const row = h('div', { className: 'pw-conversation-row' },
    h('span', { className: 'pw-conversation-label', title: card.title }, isPrd ? t('pwbPrdReady') : card.title),
    h(Button, { size: 'sm', disabled: busy, 'aria-haspopup': direct ? undefined : 'dialog',
      onClick: card.kind === 'open' ? open : direct ? () => launch('openTask') : () => setExpanded(true) }, t(label)),
    !isPrd && h(Button, { size: 'sm', disabled: busy, 'aria-label': t('pwbDismiss'), title: t('pwbDismiss'),
      icon: h(IconCloseOutlineRegular, { size: 14, 'aria-hidden': true }), onClick: () => launch('dismiss') }),
    !expanded && error && h('p', { role: 'alert', className: 'pw-error' }, error.message))
  if (!expanded) return row

  const footer = h(React.Fragment, null,
    isPrd && error?.code === 'PRD_CONFLICT' && card.previous !== undefined &&
      h(Button, { disabled: busy, onClick: () => launch('reloadPrd') }, t('checkPrdVersion')),
    h(Button, { disabled: busy, onClick: canConfirm ? () => launch('dismiss') : close },
      t(isPrd ? 'pwbDiscardPrd' : canConfirm ? 'pwbCancel' : 'pwbDismiss')),
    card.kind === 'openTask' && h(Button, { variant: 'primary', disabled: busy, onClick: () => launch('openTask') }, t('openAcceptance')),
    canConfirm && h(Button, {
      variant: 'primary', disabled: busy || (isPrd && !markdown.trim()) || (card.kind === 'reviewEdit' && !reason.trim()),
      onClick: () => launch('confirm', { ...(isPrd && { markdown }), ...(card.kind === 'reviewEdit' && { reason }) }),
    }, t(confirmActions[card.kind])))
  return h(React.Fragment, null, row,
    h(Modal, {
      open: expanded, onClose: close, title: card.title, closeLabel: t('pwbDismiss'), footer,
      className: 'pw-conversation-dialog' + (isPrd ? ' pw-prd-editor' : ''),
      contentClassName: 'pw-conversation-dialog-content', tone: card.kind === 'remove' ? 'warning' : undefined,
      description: isPrd ? card.requirements.join(' · ') : confirmation ? t(confirmation) : card.evidence || canConfirm ? card.message : undefined,
    },
    card.kind === 'note' && h('p', null, card.message),
    card.evidence && h(TaskEvidence, { data: card.evidence, t }),
    card.kind === 'reviewEdit' && h(React.Fragment, null,
      h('p', null, t('confirmReviewEditBody')),
      h('ul', null, card.changes.map(({ label, value }) => h('li', { key: label }, label, ' · ', value))),
      h('label', { className: 'pw-field' },
        h('span', null, t('reasonTitle')),
        h('input', { className: 'pw-input', value: reason, onChange: event => setReason(event.target.value) }))),
    isPrd && h(React.Fragment, null,
      h('label', { className: 'pw-field' },
        h('span', null, t('prdMarkdown')),
        h('textarea', { className: 'pw-textarea', rows: 10, value: markdown, onChange: event => {
          setMarkdown(event.target.value)
          drafts[draftKey] = { id: card.id, markdown: event.target.value }
        } })),
      card.previous !== undefined && h(PrdDiff, { before: card.previous, after: markdown, t })),
    error && h('p', { role: 'alert', className: 'pw-error' }, error.message)))
}

function TaskEvidence({ data, t }) {
  const { verification, currentEvidence } = data
  const counts = verification && t('checksPassed', { n: verification.passed }) + ' · ' + t('checksFailed', { n: verification.failed })
  const outcomeLabels = { passed: 'pwbCheckPassed', failed: 'pwbCheckFailed', incomplete: 'pwbCheckIncomplete' }
  return h('details', { open: true },
    h('summary', null, t('verify')),
    h('p', null, t('acceptanceField'), ' · ', data.acceptance || t('noLimits')),
    counts && h('p', null, counts),
    verification?.status === 'unverified' && h('p', null, t('noChecks')),
    (verification?.incomplete > 0 || verification?.unconfirmedChanges > 0) && h('p', null, t('checksIncomplete')),
    data.currentLimits && h('p', null, data.currentLimits),
    data.checks?.length > 0 && h('ul', null, data.checks.map(check =>
      h('li', { key: check.command }, t(outcomeLabels[check.status]), ' · ', h('code', null, check.command), ' · ', check.outcome))),
    currentEvidence && h('pre', null, currentEvidence))
}

// Collapse identical leading/trailing lines. The full edited Markdown stays
// in the text area, so no Markdown renderer or diff dependency is needed.
export function changedLines(before, after) {
  const a = before.trim().split(/\r?\n/), b = after.trim().split(/\r?\n/)
  let start = 0
  let end = 0
  const min = Math.min(a.length, b.length)
  while (start < min && a[start] === b[start]) start++
  while (end < min - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  return [a.slice(start, a.length - end).join('\n'), b.slice(start, b.length - end).join('\n')]
}

function PrdDiff({ before, after, t }) {
  const [removed, added] = changedLines(before, after)
  return h('details', { className: 'pw-prd-diff', open: true }, h('summary', null, t('prdDiff')),
    !removed && !added ? h('p', null, t('noPrdDiff')) : h('div', { className: 'pw-prd-diff-columns' },
      h('div', null, h('span', null, t('prdBefore')), h('pre', null, removed)),
      h('div', null, h('span', null, t('prdAfter')), h('pre', null, added))))
}

const conversationCss = [
  '.pw-conversation{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px));max-width:var(--dsh-composer-card-max-width,920px);margin:0 auto 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px}',
  '.pw-conversation>*+*{border-top:1px solid var(--dsw-alias-border-l3)}.pw-conversation>style+*{border-top:0}',
  '.pw-conversation-row{display:flex;align-items:center;gap:8px;min-height:34px;padding:2px 10px}',
  '.pw-conversation-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.pw-conversation-row .pw-error{overflow-wrap:anywhere}',
  '.pw-conversation-progress{font-size:inherit}.pw-conversation-group>summary{cursor:pointer;display:list-item;list-style-position:inside;padding-block:8px;min-height:0}',
  '.pw-conversation-group>summary .pw-conversation-spinner{display:inline-block;margin:0 6px;vertical-align:-1px}',
  '.pw-conversation-group ul{margin:0;padding:0 12px 8px 32px;line-height:1.6}',
  '.pw-conversation-spinner{flex:none;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:pw-conversation-spin .85s linear infinite}',
  '@keyframes pw-conversation-spin{to{transform:rotate(1turn)}}',
  '@media(prefers-reduced-motion:reduce){.pw-conversation-spinner{animation:none}}',
  '.pw-conversation-dialog.pw-conversation-dialog{width:min(560px,100%);max-height:100%;font-size:14px}',
  '.pw-conversation-dialog.pw-prd-editor{width:min(720px,100%)}',
  '.pw-conversation-dialog-content{min-height:0;overflow:auto}',
  '.pw-conversation-dialog p,.pw-conversation-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}',
  '.pw-conversation-dialog li{overflow-wrap:anywhere}',
  '.pw-prd-diff-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px}',
  '.pw-conversation-dialog details pre{max-height:150px;overflow:auto}',
  '.pw-conversation-dialog .pw-field{display:block}.pw-conversation-dialog textarea{box-sizing:border-box;max-height:40vh}',
].join('\n')
