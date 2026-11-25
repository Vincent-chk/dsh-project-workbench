import React from 'react'
import { Disclosure, Modal } from '../shared/ui.js'
import { rpc } from '../api.js'
import { discoveryReference } from '../discovery.js'

const { createElement: h, useEffect, useState } = React
const button = (key, text, props = {}) => h('button', { key, type: 'button', className: 'pw-button', ...props }, text)
const maxImageBytes = 2 * 1024 * 1024
const imageExtensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const prdEditorLocale = {
  zh: {
    prdEditTitle: '编辑 PRD', prdCreateTitle: '新建 PRD', prdTitleField: '文档名称', prdBodyField: '正文（Markdown）',
    prdAddImage: '插入本地图片', prdChooseImage: '选择图片', prdImageHelp: '支持 PNG、JPEG、WebP、GIF，每张最多 2 MB。',
    prdImageInvalid: '请选择支持的图片格式，且单张不超过 2 MB。', prdImageReadError: '无法读取这张图片，请重新选择。',
    prdTitleRequired: '请输入文档名称。', prdLoadLatest: '读取最新版', prdSaveOverwrite: '覆盖保存',
    prdLatestForReview: '当前已保存的正文', prdDraftPreserved: '草稿已保留。请核对当前正文，再确认覆盖。',
    prdDiscardEditor: '放弃草稿', prdSaveNew: '保存 PRD', prdCloseEditor: '关闭',
  },
  en: {
    prdEditTitle: 'Edit PRD', prdCreateTitle: 'New PRD', prdTitleField: 'Document name', prdBodyField: 'Body (Markdown)',
    prdAddImage: 'Insert a local image', prdChooseImage: 'Choose image', prdImageHelp: 'PNG, JPEG, WebP and GIF, up to 2 MB per image.',
    prdImageInvalid: 'Select a supported image of 2 MB or less.', prdImageReadError: 'Unable to read this image. Choose it again.',
    prdTitleRequired: 'Enter a document name.', prdLoadLatest: 'Load current version', prdSaveOverwrite: 'Overwrite',
    prdLatestForReview: 'Current saved text', prdDraftPreserved: 'Your draft is still here. Check the saved text before overwriting.',
    prdDiscardEditor: 'Discard draft', prdSaveNew: 'Save PRD', prdCloseEditor: 'Close',
  },
}

function draftFrom(doc) {
  const heading = /^#[ \t]+([^\r\n]+)(?:\r?\n|$)/.exec(doc.markdown)
  return {
    title: doc.title,
    body: heading ? doc.markdown.slice(heading[0].length).trimStart() : doc.markdown,
    version: doc.version,
    images: [],
    original: doc.markdown,
  }
}

function imageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function PrdEditor({ root, id, reqId, generated, t, onSaved, onClose, uiMemory }) {
  const key = JSON.stringify(['prd-editor', root, id ?? generated?.id ?? null, reqId ?? null])
  const drafts = uiMemory.drafts
  const [draft, setDraft] = useState(() => drafts[key] ?? (generated
    ? draftFrom({ ...generated, title: generated.markdown.split(/\r?\n/)[0].replace(/^#\s+/, '') })
    : id ? null : { title: '', body: '', images: [] }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [latest, setLatest] = useState(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!id || drafts[key]) return
    let active = true
    rpc('prd/read', { root, id }).then(res => {
      if (!active) return
      if (res.ok) setDraft(draftFrom(res.data))
      else setError(res)
    })
    return () => { active = false }
  }, [root, id, key, drafts, retry])

  const remember = update => {
    setDraft(current => {
      const next = { ...current, ...update }
      drafts[key] = next
      return next
    })
  }

  const close = event => {
    if (busy || event?.currentTarget?.classList?.contains('pw-modal-mask')) return
    onClose()
  }

  const save = async event => {
    event?.preventDefault()
    if (!draft || busy || error?.code === 'PRD_CONFLICT') return
    if (!draft.title.trim()) {
      setError({ message: t('prdTitleRequired') })
      return
    }
    setBusy(true)
    const edited = '# ' + draft.title.trim() + (draft.body.trim() ? '\n\n' + draft.body.trim() : '')
    const original = draft.original && draftFrom({ title: /^#[ \t]+([^\r\n]+)/.exec(draft.original)?.[1], markdown: draft.original })
    const markdown = original && original.title === draft.title && original.body === draft.body ? draft.original : edited
    const images = draft.images.filter(image => markdown.includes(`(assets/${image.name})`))
    const res = generated
      ? await rpc('prd/saveGenerated', { root, id: generated.id, markdown, images })
      : await rpc('prd/save', { root, id, markdown, version: draft.version, images, ...(reqId && !id && { reqIds: [reqId] }) })
    setBusy(false)
    if (res.ok) {
      delete drafts[key]
      onSaved(res.data)
    } else setError(res)
  }

  const loadLatest = async () => {
    setBusy(true)
    const res = await rpc('prd/read', { root, id })
    if (res.ok) {
      setLatest(res.data.markdown)
      remember({ version: res.data.version })
      setError(null)
    } else setError({ ...res, code: 'PRD_CONFLICT' })
    setBusy(false)
  }

  const insertImage = async event => {
    const file = event.currentTarget.files[0]
    event.currentTarget.value = ''
    if (!file) return
    const extension = imageExtensions[file.type]
    if (!extension || file.size > maxImageBytes) {
      setError({ message: t('prdImageInvalid') })
      return
    }
    setBusy(true)
    try {
      const name = crypto.randomUUID() + '.' + extension
      const base64 = await imageData(file)
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]\r\n]/g, '')
      const syntax = `![${alt}](assets/${name})`
      const body = [draft.body.trimEnd(), syntax].filter(Boolean).join('\n\n')
      remember({ body, images: [...draft.images, { name, base64 }] })
      setError(null)
    } catch {
      setError({ message: t('prdImageReadError') })
    } finally { setBusy(false) }
  }

  const conflicted = error?.code === 'PRD_CONFLICT'
  return h(Modal, {
    onClose: close, title: t(id ? 'prdEditTitle' : 'prdCreateTitle'), wide: true, className: 'pw-prd-editor', manageFocus: true,
    actions: [
      draft && drafts[key] && button('discard', t('prdDiscardEditor'), { disabled: busy, onClick: () => { delete drafts[key]; onClose() } }),
      button('close', t('prdCloseEditor'), { disabled: busy, onClick: () => close() }),
      button('save', t(id ? 'prdSaveOverwrite' : 'prdSaveNew'), { className: 'pw-button primary', disabled: busy || !draft || conflicted, onClick: save }),
    ],
  },
  h('style', null, '.pw-prd-edit-content pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:210px;overflow:auto}'),
  h('div', { className: 'pw-prd-edit-content' },
  generated && h(React.Fragment, null,
    h('p', { className: 'pw-note' }, t('discoveryPrdLinked') + ' · ' + generated.requirements.join(' / ')),
    h(Disclosure, { label: t('discoveryPrdSource') }, h('p', { className: 'pw-note' },
      discoveryReference(t, generated.requirements, generated.sources)))),
  draft && h('form', { onSubmit: save },
    h('label', { className: 'pw-field' }, h('span', null, t('prdTitleField')),
      h('input', { className: 'pw-input', 'data-modal-initial-focus': true, disabled: busy, value: draft.title, onChange: event => remember({ title: event.target.value }) })),
    h('label', { className: 'pw-field' }, h('span', null, t('prdBodyField')),
      h('textarea', { className: 'pw-textarea', rows: 10, disabled: busy, value: draft.body, onChange: event => remember({ body: event.target.value }) })),
    h(Disclosure, { label: t('prdAddImage') },
      h('label', { className: 'pw-field' },
        h('small', { className: 'pw-note' }, t('prdImageHelp')),
        h('input', { type: 'file', 'aria-label': t('prdChooseImage'),
          accept: Object.keys(imageExtensions).join(','), disabled: busy || conflicted, onChange: insertImage })))),
  !draft && !error && h('p', { role: 'status' }, t('loading')),
  error && h('p', { role: 'alert', className: 'pw-error' }, error.message,
    conflicted && button('reload', t('prdLoadLatest'), { disabled: busy, onClick: loadLatest }),
    !draft && button('retry', t('pwbRetry'), { onClick: () => { setError(null); setRetry(n => n + 1) } })),
  latest && h('details', { open: true }, h('summary', null, t('prdLatestForReview')),
    h('p', null, t('prdDraftPreserved')), h('pre', null, latest))))
}
