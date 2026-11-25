import React from 'react'
import { rpc } from './api.js'
import { ErrorDetails, Modal } from './shared/ui.js'
import { renderMarkdown } from './pages/resources.js'

const h = React.createElement
const { useEffect, useRef, useState } = React

export const preparationLocale = {
  zh: {
    prepTitle: '准备工作', prepDiscovery: '需求深挖', prepPrd: 'PRD 撰写', prepPrototype: '流程图与原型',
    pwbOpenPreparation: '进入 PRD 撰写', prepStart: '开始', prepContinue: '继续', prepChoose: '选择 PRD 撰写依据',
    prepExistingPrd: '编辑已有 PRD', prepUseDiscovery: '用深挖记录起草',
    prepPickSource: '请选择依据', prepResumePrd: '继续当前 PRD 会话', prepSourceRequired: '先保存深挖记录或关联已有 PRD。',
    prepPreview: '预览新草稿', prepNoDraft: '暂无新草稿',
    prepReadSaved: '查看已保存版本', prepReadSavedRevision: '查看已保存 v{n}',
    prepCurrentPrd: '当前 PRD · v{n}', prepSavedRevisionUnavailable: '会话保存的旧版没有快照。以下为 PRD 当前版本。',
    prepEditDraft: '编辑草稿', prepReadDraft: '查看草稿', prepDraftText: '草稿正文',
    prepSave: '确认保存', prepHistory: '已确认的原型',
    prepOutsidePool: '回到需求池后可以保存新的版本。',
    prepVersion: '第 {n} 版', prepFrame: '流程图与原型预览', prepPrdFirst: '先保存并关联一份有正文的 PRD。',
  },
  en: {
    prepTitle: 'Preparation', prepDiscovery: 'Requirement discovery', prepPrd: 'Write PRD', prepPrototype: 'Flow and prototype',
    pwbOpenPreparation: 'Open PRD writing', prepStart: 'Start', prepContinue: 'Continue', prepChoose: 'Choose a source for the PRD',
    prepExistingPrd: 'Edit an existing PRD', prepUseDiscovery: 'Draft from discovery',
    prepPickSource: 'Choose a source', prepResumePrd: 'Continue the current PRD session',
    prepSourceRequired: 'Save a discovery record or link an existing PRD first.',
    prepPreview: 'Preview new draft', prepNoDraft: 'No new draft',
    prepReadSaved: 'View saved version', prepReadSavedRevision: 'View saved v{n}',
    prepCurrentPrd: 'Current PRD · v{n}', prepSavedRevisionUnavailable: 'The session’s saved revision has no snapshot. The current PRD is shown below.',
    prepEditDraft: 'Edit draft', prepReadDraft: 'View draft', prepDraftText: 'Draft content',
    prepSave: 'Confirm and save', prepHistory: 'Confirmed prototypes',
    prepOutsidePool: 'Return the requirement to the pool to save a new version.',
    prepVersion: 'Version {n}', prepFrame: 'Flow and prototype preview', prepPrdFirst: 'Save and link a PRD with content first.',
  },
}

const labels = { discovery: 'prepDiscovery', prd: 'prepPrd', prototype: 'prepPrototype' }

function PrototypeFrame({ html, t }) {
  return h('iframe', { title: t('prepFrame'), srcDoc: html, sandbox: '',
    style: { display: 'block', width: '100%', minHeight: '60vh', border: 0, background: '#fff' } })
}

export function PreparationActions({ req, root, t, busy, open, hasDiscoverySession, PreparationModal, focusRequest, onFocusHandled }) {
  const [result, setResult] = useState(null)
  const [record, setRecord] = useState(null)
  const [failure, setFailure] = useState(null)
  const [selection, setSelection] = useState(null)
  const [loadingVersion, setLoadingVersion] = useState(false)
  const prdButton = useRef(null)
  const section = useRef(null)
  const openRecordRequest = useRef(0)
  useEffect(() => {
    let current = true
    let latest = 0
    const load = async () => {
      const request = ++latest
      const response = await rpc('preparation/options', { root, reqId: req.id })
      if (current && request === latest) setResult(response)
    }
    if (req.status !== 'backlog') setSelection(null)
    void load()
    const changed = event => {
      if (event.detail?.root === root && (!event.detail.reqId || event.detail.reqId === req.id)) void load()
    }
    const events = ['pw-prd-changed', 'pw-preparation-changed']
    for (const event of events) window.addEventListener(event, changed)
    return () => {
      current = false
      for (const event of events) window.removeEventListener(event, changed)
      openRecordRequest.current++
    }
  }, [root, req.id, req.status])
  const options = result?.data
  const active = req.status === 'backlog'
  const openVersion = async version => {
    const request = ++openRecordRequest.current
    setLoadingVersion(true)
    setFailure(null)
    const response = await rpc('preparation/prototype', { root, reqId: req.id, version })
    if (request !== openRecordRequest.current) return
    setLoadingVersion(false)
    if (response.ok) setRecord(response.data)
    else setFailure(response)
  }
  const started = kind => !!req.preparationTasks?.[kind] || (kind === 'discovery' && hasDiscoverySession)
  const resumePrd = started('prd')
  const canWritePrd = !!(options?.discoveryVersions.length || options?.prds.length)
  const canPrototype = !!options?.hasReviewablePrd
  const choices = [
    ...(resumePrd ? [{ value: 'continue', label: t('prepResumePrd') }] : []),
    ...(options?.discoveryVersions ?? []).map(version => ({
      value: String(version), input: { discoveryVersion: version },
      label: `${t('prepUseDiscovery')} · ${t('prepVersion').replace('{n}', version)}`,
    })),
    ...(options?.prds ?? []).map(({ id, title }) => ({
      value: id, input: { prdId: id }, label: `${t('prepExistingPrd')} · ${title}`,
    })),
  ]
  const selected = choices.find(choice => choice.value === selection)
  const closePicker = () => {
    setSelection(null)
    requestAnimationFrame(() => prdButton.current?.focus({ preventScroll: true }))
  }
  const choosePrd = () => setSelection(resumePrd || choices.length === 1 ? choices[0].value : '')
  const startPrd = () => {
    if (busy || !canWritePrd || !selected) return
    closePicker()
    open('prd', selected.input)
  }
  useEffect(() => {
    if (!focusRequest || !active || busy || !result) return
    const inferred = !options?.discoveryVersions.length ? 'discovery'
      : !canPrototype ? 'prd' : !options.prototypes.length ? 'prototype' : 'discovery'
    const kind = focusRequest.kind || inferred
    const target = options
      ? section.current?.querySelector(`button[data-kind="${kind}"]:enabled`)
        ?? section.current?.querySelector('button[data-kind]:enabled') ?? section.current
      : section.current
    if (!target) return
    const frame = requestAnimationFrame(() => {
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'nearest' })
      onFocusHandled?.(focusRequest)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, onFocusHandled, active, busy, result, options, canPrototype])
  if (!active && !options?.prototypes.length && result?.ok !== false) return null
  const missing = { prd: !canWritePrd && 'prepSourceRequired', prototype: !canPrototype && 'prepPrdFirst' }
  return h('section', { ref: section, tabIndex: -1, className: 'pw-reading-block pw-reading-divider pw-preparation', 'aria-label': t('prepTitle') },
    h('h3', { className: 'pw-reading-label' }, t('prepTitle')),
    active && h('div', { className: 'pw-actions pw-preparation-actions' },
      Object.keys(labels).map(kind => {
        const reason = missing[kind]
        const reasonId = options && reason ? `pw-preparation-${req.id}-${kind}-hint` : undefined
        return h('div', { key: kind, className: 'pw-preparation-action' },
          h('button', {
            type: 'button', className: 'pw-button', disabled: busy || !!reason, 'data-kind': kind,
            ref: kind === 'prd' ? prdButton : undefined,
            'aria-describedby': reasonId, 'aria-haspopup': kind === 'prd' ? 'dialog' : undefined,
            onClick: kind === 'prd' ? choosePrd : () => open(kind),
          }, t(started(kind) ? 'prepContinue' : 'prepStart'), ' · ', t(labels[kind])),
          reasonId && h('span', { id: reasonId, className: 'pw-note' }, t(reason)))
      })),
    active && !result && h('p', { className: 'pw-preparation-status', role: 'status' }, t('loading')),
    active && selection !== null && h(PreparationModal, {
      open: true, title: t('prepChoose'), onClose: closePicker, closeLabel: t('close'),
      footer: h(React.Fragment, null,
        h('button', { type: 'button', className: 'pw-button', onClick: closePicker }, t('cancel')),
        h('button', { type: 'button', className: 'pw-button primary', onClick: startPrd,
          disabled: busy || !canWritePrd || !selected }, t('pwbOpenPreparation'))),
    },
    h('select', { className: 'pw-select pw-preparation-select', value: selected?.value ?? '', autoFocus: true,
      'aria-label': t('prepChoose'), disabled: busy || !canWritePrd, onChange: event => setSelection(event.target.value) },
      h('option', { value: '', disabled: true, hidden: true }, t('prepPickSource')),
      choices.map(choice => h('option', { key: choice.value, value: choice.value }, choice.label)))),
    !!options?.prototypes.length && h('div', { className: 'pw-actions' },
      h('span', { className: 'pw-note' }, t('prepHistory')),
      options.prototypes.map(version => h('button', { key: version, type: 'button', className: 'pw-button',
        disabled: busy || loadingVersion, onClick: () => openVersion(version) }, t('prepVersion').replace('{n}', version)))),
    h(ErrorDetails, { error: failure ?? (result?.ok === false ? result : null), t }),
    record && h(Modal, { wide: true, title: t('prepPrototype') + ' · ' + t('prepVersion').replace('{n}', record.version),
      onClose: () => setRecord(null), actions: h('button', { type: 'button', className: 'pw-button', onClick: () => setRecord(null) }, t('close')) },
    h(PrototypeFrame, { html: record.html, t })))
}

export function PreparationSession({ initial, root, sessionId, sessionBusy, t, openRequirement, DiscoveryModal }) {
  const [draft, setDraft] = useState(null)
  const [record, setRecord] = useState(null)
  const [editing, setEditing] = useState(false)
  const [failure, setFailure] = useState(null)
  const [saved, setSaved] = useState(initial.saved)
  const [busy, setBusy] = useState(false)
  const [empty, setEmpty] = useState(false)
  const edits = useRef(null)
  const request = useRef(false)
  const { requirement: req, kind } = initial
  const inPool = req.status === 'backlog'

  const run = async mode => {
    if (request.current) return
    const save = mode === 'save'
    request.current = true
    setBusy(true)
    setFailure(null)
    try {
      const response = await rpc(save ? 'preparation/save' : 'preparation/session', { root, sessionId,
        ...(save ? { draftId: draft.id, markdown: draft.markdown } : mode === 'saved' ? { readSaved: true } : { preview: true }),
      })
      if (!response.ok) { setFailure(response); return }
      if (save) {
        edits.current = null
        setSaved(response.data)
        setDraft(null)
        if (kind === 'prd') window.dispatchEvent(new CustomEvent('pw-prd-changed', { detail: { root } }))
        else window.dispatchEvent(new CustomEvent('pw-preparation-changed', { detail: { root, reqId: req.id } }))
      } else if (mode === 'saved') {
        setSaved(response.data.preparation.saved)
        setRecord(response.data.record)
      } else {
        const next = response.data.draft ?? null
        if (edits.current?.id !== next?.id) edits.current = null
        setEditing(false)
        setDraft(edits.current ?? next)
        setEmpty(!next)
      }
    } finally {
      request.current = false
      setBusy(false)
    }
  }
  const version = saved?.revision ?? saved?.version
  const close = () => { if (!busy) { setDraft(null); setRecord(null); setFailure(null) } }
  const title = t(labels[kind]) + (record ? ' · ' + (record.newer ? t('prepCurrentPrd').replace('{n}', record.revision)
    : t('prepVersion').replace('{n}', version)) : '')
  return h('section', { className: 'pw-discovery-pane', 'aria-label': t(labels[kind]) },
    h('header', { className: 'pw-discovery-header' },
      h('div', null, h('h3', null, t(labels[kind])), h('p', { className: 'pw-note' }, req.title)),
      h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: () => openRequirement(req.id, req.status) }, t('discoveryReturn'))),
    h('div', { className: 'pw-actions' },
      h('button', { type: 'button', className: 'pw-button primary', 'aria-haspopup': 'dialog', disabled: busy || sessionBusy,
        onClick: () => run('preview') }, t('prepPreview')),
      saved && h('button', { type: 'button', className: 'pw-button', 'aria-haspopup': 'dialog', disabled: busy,
        onClick: () => run('saved') }, kind === 'prd' ? t('prepReadSavedRevision').replace('{n}', version)
        : t('prepReadSaved') + ' · ' + t('prepVersion').replace('{n}', version))),
    empty && !draft && h('p', { role: 'status', className: 'pw-note' }, t('prepNoDraft')),
    !inPool && h('p', { className: 'pw-note' }, t('prepOutsidePool')),
    !draft && !record && h(ErrorDetails, { error: failure, t }),
    (draft || record) && h(DiscoveryModal, {
      open: true, title, description: req.title, onClose: close, closeLabel: t('close'),
      className: kind === 'prototype' ? 'pw-prototype-dialog' : 'pw-discovery-dialog',
      contentClassName: 'pw-discovery-dialog-content',
      footer: h(React.Fragment, null,
        draft && kind === 'prd' && inPool && h('button', { type: 'button', className: 'pw-button', disabled: busy,
          onClick: () => setEditing(value => !value) }, t(editing ? 'prepReadDraft' : 'prepEditDraft')),
        h('button', { type: 'button', className: 'pw-button', disabled: busy, onClick: close }, t('close')),
        draft && h('button', { type: 'button', className: 'pw-button primary',
          disabled: busy || sessionBusy || !inPool || (kind === 'prd' && !draft.markdown.trim()),
          onClick: () => run('save') }, t('prepSave'))) },
    record?.newer && h('p', { className: 'pw-note' }, t('prepSavedRevisionUnavailable')),
    kind === 'prototype' ? h(PrototypeFrame, { html: (record ?? draft).html, t })
      : draft && editing ? h('textarea', { className: 'pw-textarea', rows: 18, 'aria-label': t('prepDraftText'),
        value: draft.markdown, disabled: busy, autoFocus: true,
        onChange: event => {
          const next = { ...draft, markdown: event.target.value }
          edits.current = next
          setDraft(next)
        } })
        : h('div', { className: 'pw-wiki-content' }, renderMarkdown((record ?? draft).markdown, t)),
    h(ErrorDetails, { error: failure, t })))
}
