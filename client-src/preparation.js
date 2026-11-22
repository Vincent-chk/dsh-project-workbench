import React from 'react'
import { rpc } from './api.js'
import { ErrorDetails, Modal, ReadText } from './shared/ui.js'

const h = React.createElement
const { useEffect, useRef, useState } = React

export const preparationLocale = {
  zh: {
    prepTitle: '准备工作', prepDiscovery: '需求深挖', prepPrd: 'PRD 撰写', prepPrototype: '流程图与原型',
    pwbOpenPreparation: '进入 PRD 撰写', prepStart: '开始', prepContinue: '继续', prepChoose: '选择 PRD 撰写依据',
    prepExistingPrd: '编辑已有 PRD', prepUseDiscovery: '用深挖记录起草',
    prepPreview: '预览最新草稿', prepNoDraft: '请在当前 Session 和 AI 继续讨论，等 AI 给出完整草稿后再预览。',
    prepSave: '确认保存', prepSaved: '已保存到需求资料', prepHistory: '已确认的原型',
    prepOutsidePool: '回到需求池后可以保存新的版本。',
    prepVersion: '第 {n} 版', prepFrame: '流程图与原型预览', prepPrdFirst: '先关联已保存的 PRD。',
  },
  en: {
    prepTitle: 'Preparation', prepDiscovery: 'Requirement discovery', prepPrd: 'Write PRD', prepPrototype: 'Flow and prototype',
    pwbOpenPreparation: 'Open PRD writing', prepStart: 'Start', prepContinue: 'Continue', prepChoose: 'Choose a source for the PRD',
    prepExistingPrd: 'Edit an existing PRD', prepUseDiscovery: 'Draft from discovery',
    prepPreview: 'Preview latest draft', prepNoDraft: 'Continue the conversation until the AI provides a complete draft.',
    prepSave: 'Confirm and save', prepSaved: 'Saved to this requirement', prepHistory: 'Confirmed prototypes',
    prepOutsidePool: 'Return the requirement to the pool to save a new version.',
    prepVersion: 'Version {n}', prepFrame: 'Flow and prototype preview', prepPrdFirst: 'Link a saved PRD first.',
  },
}

const labels = { discovery: 'prepDiscovery', prd: 'prepPrd', prototype: 'prepPrototype' }

function PrototypeFrame({ html, t }) {
  return h('iframe', { title: t('prepFrame'), srcDoc: html, sandbox: '',
    style: { display: 'block', width: '100%', minHeight: '60vh', border: 0, background: '#fff' } })
}

export function PreparationActions({ req, root, t, busy, open, hasDiscoverySession }) {
  const [result, setResult] = useState(null)
  const [record, setRecord] = useState(null)
  const [failure, setFailure] = useState(null)
  const [selection, setSelection] = useState('')
  const [loadingVersion, setLoadingVersion] = useState(false)
  const openRecordRequest = useRef(0)
  const loadOptions = () => rpc('preparation/options', { root, reqId: req.id })
  useEffect(() => {
    let current = true
    const load = () => loadOptions().then(response => { if (current) setResult(response) })
    void load()
    const changed = event => { if (event.detail?.root === root) void load() }
    window.addEventListener('pw-prd-changed', changed)
    return () => { current = false; window.removeEventListener('pw-prd-changed', changed); openRecordRequest.current++ }
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
  const startPrd = () => {
    if (selection.startsWith('prd-')) open('prd', { prdId: selection })
    else if (selection) open('prd', { discoveryVersion: Number(selection) })
    else open('prd')
  }
  if (!active && !options?.prototypes.length && result?.ok !== false) return null
  return h('section', { className: 'pw-reading-block pw-reading-divider', 'aria-label': t('prepTitle') },
    h('h3', { className: 'pw-reading-label' }, t('prepTitle')),
    active && h(React.Fragment, null,
      h('div', { className: 'pw-actions' },
        ...Object.keys(labels).map(kind => h('button', {
          key: kind, type: 'button', className: 'pw-button',
          disabled: busy || (kind === 'prototype' && !!options && !options.prds.length),
          onClick: kind === 'prd' ? startPrd : () => open(kind),
        }, t(started(kind) ? 'prepContinue' : 'prepStart'), ' · ', t(labels[kind])))),
      !!(options?.prds.length || options?.discoveryVersions.length) &&
        h('label', { className: 'pw-field' }, h('span', null, t('prepChoose')),
          h('select', { value: selection, disabled: busy, onChange: event => setSelection(event.target.value) },
            h('option', { value: '' }, t(started('prd') ? 'prepContinue' : 'prepStart')),
            options.discoveryVersions.map(version => h('option', { key: version, value: version },
              t('prepUseDiscovery'), ' · ', t('prepVersion').replace('{n}', version))),
            options.prds.map(prd => h('option', { key: prd.id, value: prd.id }, t('prepExistingPrd'), ' · ', prd.title)))),
      options && !options.prds.length && h('p', { className: 'pw-note' }, t('prepPrdFirst'))),
    !!options?.prototypes.length && h('div', { className: 'pw-actions' },
      h('span', { className: 'pw-note' }, t('prepHistory')),
      options.prototypes.map(version => h('button', { key: version, type: 'button', className: 'pw-button',
        disabled: busy || loadingVersion, onClick: () => openVersion(version) }, t('prepVersion').replace('{n}', version)))),
    h(ErrorDetails, { error: failure ?? (result?.ok === false ? result : null), t }),
    record && h(Modal, { wide: true, title: t('prepPrototype') + ' · ' + t('prepVersion').replace('{n}', record.version),
      onClose: () => setRecord(null), actions: h('button', { type: 'button', className: 'pw-button', onClick: () => setRecord(null) }, t('close')) },
    h(PrototypeFrame, { html: record.html, t })))
}

export function PreparationSession({ initial, root, sessionId, sessionBusy, t, openRequirement }) {
  const [draft, setDraft] = useState(null)
  const [failure, setFailure] = useState(null)
  const [saved, setSaved] = useState(initial.saved)
  const [busy, setBusy] = useState(false)
  const [empty, setEmpty] = useState(false)
  const request = useRef(false)
  const { requirement: req, kind } = initial
  const inPool = req.status === 'backlog'

  const run = async save => {
    if (request.current) return
    request.current = true
    setBusy(true)
    setFailure(null)
    try {
      const response = await rpc(save ? 'preparation/save' : 'preparation/session', { root, sessionId,
        ...(save ? { draftId: draft.id, markdown: draft.markdown } : { preview: true }),
      })
      if (!response.ok) { setFailure(response); return }
      if (save) {
        setSaved(response.data)
        setDraft(null)
        if (kind === 'prd') window.dispatchEvent(new CustomEvent('pw-prd-changed', { detail: { root } }))
      } else {
        setDraft(response.data.draft ?? null)
        setEmpty(!response.data.draft)
      }
    } finally {
      request.current = false
      setBusy(false)
    }
  }
  return h('section', { className: 'pw-discovery-pane', 'aria-label': t(labels[kind]) },
    h('header', { className: 'pw-discovery-header' },
      h('div', null, h('h3', null, t(labels[kind])), h('p', { className: 'pw-note' }, req.title)),
      h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: () => openRequirement(req.id, req.status) }, t('discoveryReturn'))),
    h('div', { className: 'pw-actions' },
      h('button', { type: 'button', className: 'pw-button primary', disabled: busy || sessionBusy, onClick: () => run(false) }, t('prepPreview'))),
    empty && !draft && h('p', { role: 'status' }, t('prepNoDraft')),
    saved && h('p', { role: 'status' }, t('prepSaved'), ' · ', t('prepVersion').replace('{n}', saved.revision ?? saved.version)),
    !inPool && h('p', { className: 'pw-note' }, t('prepOutsidePool')),
    !draft && h(ErrorDetails, { error: failure, t }),
    draft && h(Modal, { wide: true, title: t(labels[kind]),
      onClose: () => { if (!busy) setDraft(null) },
      actions: h(React.Fragment, null,
        h('button', { type: 'button', className: 'pw-button', disabled: busy, onClick: () => setDraft(null) }, t('close')),
        h('button', { type: 'button', className: 'pw-button primary',
          disabled: busy || sessionBusy || !inPool || (kind === 'prd' && !draft.markdown.trim()),
          onClick: () => run(true) }, t('prepSave'))) },
    kind === 'prd'
      ? h(React.Fragment, null, h(ReadText, { value: draft.markdown }),
        h('label', { className: 'pw-field' }, h('span', null, t('discoveryPreview')),
          h('textarea', { className: 'pw-textarea', rows: 10, value: draft.markdown, disabled: busy || !inPool,
            onChange: event => setDraft({ ...draft, markdown: event.target.value }) })))
      : h(PrototypeFrame, { html: draft.html, t }),
    h(ErrorDetails, { error: failure, t })))
}
