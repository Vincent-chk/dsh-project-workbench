import React from 'react'
import { discoveryQuestionText } from '../core/discovery-qa.js'
import { rpc } from './api.js'
import { Disclosure, ErrorDetails } from './shared/ui.js'
import { renderMarkdown } from './pages/resources.js'
import { PreparationSession } from './preparation.js'

const h = React.createElement
const { useEffect, useId, useMemo, useRef, useState } = React

export const discoveryLocale = {
  zh: {
    discoveryStart: '开始深挖', discoveryContinue: '继续深挖', discoveryRecords: '深挖需求记录',
    discoveryNone: '尚无深挖需求记录', discoveryVersion: '第{n}版', discoveryFrom: '查看来源会话',
    discoverySummarize: '结束头脑风暴，整理需求', discoveryGenerating: '正在整理会话…', discoveryPreview: '整理预览 · 可编辑',
    discoverySave: '保存为第{n}版', discoverySaved: '已保存第{n}版', discoveryReturn: '查看需求详情',
    discoveryQuestions: 'Grill Me 问题', discoveryNoQuestions: 'Grill Me 的提问会显示在这里。',
    discoveryAnswered: '已回复', discoveryRound: '第{n}轮',
    discoveryAnsweredCount: '已回复 {n} 题', discoveryWaitingCount: '还有 {n} 题待回复',
    discoveryWait: '请在主会话完成当前回复或待办操作后再整理。', discoverySummaryTitle: '整理需求',
    discoveryWaitForQuestion: '请等 Grill Me 在主会话完成首次提问。',
    discoveryNeedDiscussion: '请在主会话补充实质答复，等 AI 给出深化建议后再整理。',
    discoveryNoNewDiscussion: '请在主会话继续讨论，形成新的完整回合后再整理。',
    discoveryPool: '需求深挖仅在需求池开放。', discoveryPrd: 'AI 辅助 PRD 生成', discoveryPrdPending: '正在生成 PRD 草稿…',
    discoveryUseVersion: '用此版起草 PRD', discoveryPrdSource: '起草参考', discoveryPrdLinked: '关联需求',
    discoveryGate: '请先完成一轮需求深挖', discoverySaveGate: '请先整理并保存深挖记录',
    discoveryGateBody: '在当前需求的深挖会话中回答 Grill Me 的问题，收到深化建议后，整理并保存一版记录。',
    discoverySaveGateBody: '回到深挖会话，点击「结束头脑风暴，整理需求」，核对内容并确认保存。',
    discoveryPoolGateBody: '这条需求已流转。可以按现有规则回到需求池，再开始深挖，也可以手工新建 PRD。',
    discoveryGo: '去深挖', discoveryGoSave: '去整理', discoveryClose: '关闭',
  },
  en: {
    discoveryStart: 'Start discovery', discoveryContinue: 'Continue discovery', discoveryRecords: 'Discovery records',
    discoveryNone: 'No discovery records yet', discoveryVersion: 'Version {n}', discoveryFrom: 'View source conversation',
    discoverySummarize: 'Finish brainstorming and summarize', discoveryGenerating: 'Summarizing conversation…', discoveryPreview: 'Editable summary preview',
    discoverySave: 'Save as version {n}', discoverySaved: 'Version {n} saved', discoveryReturn: 'View requirement',
    discoveryQuestions: 'Grill Me questions', discoveryNoQuestions: 'Questions from Grill Me will appear here.',
    discoveryAnswered: 'Answered', discoveryRound: 'Round {n}',
    discoveryAnsweredCount: '{n} answered', discoveryWaitingCount: '{n} more to answer',
    discoveryWait: 'Wait for the reply or handle the pending action in the conversation.', discoverySummaryTitle: 'Summarize requirement',
    discoveryWaitForQuestion: 'Wait for Grill Me to finish asking its first questions in the conversation.',
    discoveryNeedDiscussion: 'Answer in the conversation and wait for the AI’s recommendation before summarizing.',
    discoveryNoNewDiscussion: 'Continue the conversation and complete another round before summarizing.',
    discoveryPool: 'Discovery is available in the requirement pool.', discoveryPrd: 'Generate PRD with AI', discoveryPrdPending: 'Drafting PRD…',
    discoveryUseVersion: 'Draft PRD from this version', discoveryPrdSource: 'Drafted from', discoveryPrdLinked: 'Linked requirements',
    discoveryGate: 'Complete a discovery round first', discoverySaveGate: 'Summarize and save a discovery record first',
    discoveryGateBody: 'In this requirement’s discovery conversation, answer Grill Me, review its recommendation, and save the summary.',
    discoverySaveGateBody: 'Go to the discovery conversation, select “Finish brainstorming and summarize”, then review and confirm the record.',
    discoveryPoolGateBody: 'This requirement has left the pool. Return it to the pool if available, or create the PRD manually.',
    discoveryGo: 'Go to discovery', discoveryGoSave: 'Go to summary', discoveryClose: 'Close',
  },
}

const recordTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const versionText = (t, n) => t('discoveryVersion').replace('{n}', String(n))
const questionText = text => text.replace(/(\*\*|__|`)([^\n]+?)\1/g, '$2')

export function discoveryReference(t, requirements, sources) {
  return sources?.map(({ version }, index) => requirements[index] + ' · ' + versionText(t, version)).join(' / ')
}

export function useDiscoveryRecords(root, reqId) {
  const [result, setResult] = useState(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setResult(null)
    rpc('discovery/list', { root, reqId }).then(res => { if (active) setResult(res) })
    return () => { active = false }
  }, [root, reqId, retry])
  return { result, retry: () => setRetry(n => n + 1) }
}

export function DiscoveryRecords({ result, retry, t, busy, openSource, generatePrd }) {
  if (!result) return h('p', { role: 'status', className: 'pw-note' }, t('loading'))
  if (!result.ok) return h(React.Fragment, null, h(ErrorDetails, { error: result, t }),
    h('button', { type: 'button', className: 'pw-button', onClick: retry }, t('retryRead')))
  const { records } = result.data
  if (!records.length) return h('p', { className: 'pw-note' }, t('discoveryNone'))
  return h('div', { className: 'pw-reading-list' }, records.map(record => h(Disclosure, {
    key: record.version,
    label: versionText(t, record.version) + ' · ' + recordTime.format(new Date(record.savedAt)),
  },
    h('div', { className: 'pw-md' }, renderMarkdown(record.markdown, t)),
    h('div', { className: 'pw-actions' },
      h('button', { type: 'button', className: 'pw-button', disabled: busy, onClick: () => openSource(record.version) }, t('discoveryFrom')),
      h('button', { type: 'button', className: 'pw-button', disabled: busy, onClick: () => generatePrd(record.version) }, t('discoveryUseVersion'))))))
}

export function DiscoverySession({ root, sessionId, sessionStatus, visible, t, uiMemory, openRequirement, renderTask, DiscoveryModal }) {
  const [result, setResult] = useState(null)
  const sessionBusy = sessionStatus?.running === true || !!sessionStatus?.pendingInteraction
  useEffect(() => {
    if (!visible) return
    let disposed = false
    let timer
    const read = async () => {
      const discovery = await rpc('discovery/session', { root, sessionId })
      const res = discovery.ok && !discovery.data.requirement
        ? await rpc('preparation/session', { root, sessionId }) : discovery
      if (disposed) return
      setResult(res)
      if (!res.ok || res.data.requirement || res.data.preparation) timer = setTimeout(read, 2500)
    }
    read()
    return () => { disposed = true; clearTimeout(timer) }
  }, [root, sessionId, visible, sessionBusy])
  if (!result) return visible && h('p', { role: 'status', className: 'pw-note' }, t('loading'))
  if (!result.ok) return h(ErrorDetails, { error: result, t })
  const { requirement: req, questions, preparation } = result.data
  if (preparation) return h(PreparationSession, { key: sessionId, initial: preparation, root, sessionId, sessionBusy, t, openRequirement, DiscoveryModal })
  return req ? h(DiscoverySummary, {
    req, root, sessionId, sessionBusy, t, uiMemory, openRequirement, questions, DiscoveryModal,
  }) : renderTask()
}

function QuestionRow({ row, showRound, t }) {
  const { number, round, question, answered } = row
  const { stem, choices } = useMemo(() => discoveryQuestionText(question), [question])
  const id = useId()
  const text = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [clipped, setClipped] = useState(false)
  const canExpand = choices.length > 0 || clipped || expanded
  useEffect(() => {
    const element = text.current
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight)
      setClipped(element.scrollHeight > Math.ceil(lineHeight * 3))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [canExpand, stem])
  return h('div', { className: 'pw-discovery-item' },
    h(canExpand ? 'button' : 'div', {
      className: 'pw-discovery-row',
      ...(canExpand && { type: 'button', 'aria-expanded': expanded, 'aria-controls': choices.length ? id + '-choices' : id,
        onClick: () => setExpanded(open => !open) }),
    },
      h('span', { className: 'pw-discovery-status', title: answered ? t('discoveryAnswered') : undefined },
        answered ? h('span', { role: 'img', 'aria-label': t('discoveryAnswered') }, '✓') : null),
      h('span', { className: 'pw-discovery-label' },
        h('span', null, 'Q' + number),
        showRound && h('small', null, t('discoveryRound').replace('{n}', String(round)))),
      h('span', { id, ref: text, className: 'pw-discovery-line' }, questionText(stem)),
      canExpand && h('span', { className: 'pw-discovery-chevron', 'aria-hidden': true })),
    choices.length > 0 && h('div', { className: 'pw-discovery-options', id: id + '-choices', hidden: !expanded },
      h('ul', { className: 'pw-discovery-choices', role: 'list' },
        choices.map(choice => h('li', { key: choice.label },
          h('span', { className: 'pw-discovery-option-label' }, choice.label),
          h('span', null, questionText(choice.text)))))))
}

function DiscoverySummary({ req, root, sessionId, sessionBusy, questions, t, uiMemory, openRequirement, DiscoveryModal }) {
  const drafts = uiMemory.discoveryDrafts ??= {}
  const key = JSON.stringify([root, sessionId, req.id])
  const [preview, setPreview] = useState(() => drafts[key])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [failure, setFailure] = useState(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const live = useRef(false)
  const action = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const remember = value => {
    if (value) drafts[key] = value
    else delete drafts[key]
    if (live.current) setPreview(value)
  }
  const prepare = async () => {
    if (preview) { setFailure(null); setPreviewOpen(true); return }
    if (action.current || sessionBusy) return
    action.current = true
    setBusy('prepare')
    setFailure(null)
    setNotice('')
    const res = await rpc('discovery/prepare', { root, reqId: req.id, sessionId })
    action.current = false
    if (res.ok) remember(res.data)
    if (!live.current) return
    if (res.ok) setPreviewOpen(true)
    else setFailure(res)
    setBusy('')
  }
  const save = async () => {
    if (action.current) return
    action.current = true
    setBusy('save')
    setFailure(null)
    const res = await rpc('discovery/save', { root, reqId: req.id, sessionId, previewId: preview.previewId, markdown: preview.markdown })
    action.current = false
    if (res.ok) {
      remember(null)
      window.dispatchEvent(new CustomEvent('pw-preparation-changed', { detail: { root, reqId: req.id } }))
    }
    if (!live.current) return
    if (res.ok) {
      setPreviewOpen(false)
      setNotice(t('discoverySaved').replace('{n}', String(res.data.version)))
    } else setFailure(res)
    setBusy('')
  }
  const closePreview = () => {
    if (action.current) return
    setPreviewOpen(false)
    setFailure(null)
  }
  const inPool = req.status === 'backlog'
  const waiting = inPool && !preview && sessionBusy
  const counts = new Map()
  for (const { number } of questions) counts.set(number, (counts.get(number) ?? 0) + 1)
  const [current, ...pending] = questions.filter(row => !row.answered)
  const answered = questions.filter(row => row.answered)
  const questionRow = row => h(QuestionRow, { key: row.id, row, showRound: counts.get(row.number) > 1, t })

  return h('section', { className: 'pw-discovery-pane', 'aria-label': t('discoveryRecords') },
    h('header', { className: 'pw-discovery-header' },
      h('h3', null, req.title),
      h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: () => openRequirement(req.id, req.status) }, t('discoveryReturn'))),
    h('section', { className: 'pw-discovery-current', 'aria-label': t('discoveryQuestions') },
      current && questionRow(current),
      !questions.length && h('p', { className: 'pw-note' }, t('discoveryNoQuestions'))),
    h('footer', { className: 'pw-discovery-footer' },
      (inPool || preview) && h('button', { type: 'button', className: 'pw-button primary', 'aria-haspopup': 'dialog',
        disabled: !!busy || waiting, onClick: prepare }, t('discoverySummarize')),
      (busy === 'prepare' || waiting) && h('p', { role: 'status', className: 'pw-note' }, t(busy === 'prepare' ? 'discoveryGenerating' : 'discoveryWait')),
      !inPool && h('p', { className: 'pw-note' }, t('discoveryPool')),
      !previewOpen && h(ErrorDetails, { error: failure, t }),
      notice && h('p', { role: 'status', className: 'pw-note' }, notice)),
    (pending.length > 0 || answered.length > 0) && h('div', { className: 'pw-discovery-history' },
      pending.length > 0 && h(Disclosure, { label: t('discoveryWaitingCount').replace('{n}', pending.length) }, pending.map(questionRow)),
      answered.length > 0 && h(Disclosure, { label: t('discoveryAnsweredCount').replace('{n}', answered.length) }, answered.map(questionRow))),
    previewOpen && preview && h(DiscoveryModal, {
      open: true, title: t('discoverySummaryTitle'), description: req.title, onClose: closePreview, closeLabel: t('discoveryClose'),
      className: 'pw-discovery-dialog', contentClassName: 'pw-discovery-dialog-content',
      footer: h(React.Fragment, null,
        h('button', { type: 'button', className: 'pw-button', disabled: !!busy, onClick: () => { closePreview(); remember(null) } }, t('pwbDiscardPrd')),
        h('button', { type: 'button', className: 'pw-button primary', disabled: !!busy || !preview.markdown.trim() || !inPool, onClick: save },
          t('discoverySave').replace('{n}', String(preview.version)))),
    },
      h('label', { className: 'pw-field' }, h('span', null, t('discoveryPreview')),
        h('textarea', { className: 'pw-textarea', rows: 12, value: preview.markdown, disabled: !!busy || !inPool,
          onChange: event => remember({ ...preview, markdown: event.target.value }) })),
      !inPool && h('p', { className: 'pw-note' }, t('discoveryPool')),
      h(ErrorDetails, { error: failure, t })))
}
