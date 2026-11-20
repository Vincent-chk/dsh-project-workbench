import React from 'react'
import { rpc } from '../api.js'
import { Modal } from '../shared/ui.js'
import { ListPage, listTitle } from '../shared/list.js'
import { renderMarkdown } from './resources.js'

const h = React.createElement
const { useEffect, useRef, useState } = React
const prdDateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
function prdDate(value) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? prdDateFormat.format(time) : ''
}

export const prdLocale = {
  en: {
    navPrds: 'PRD management', prdNew: 'New PRD', prdRead: 'View PRD', prdCloseRead: 'Close PRD', prdTrash: 'Trash', prdActive: 'Active PRDs',
    prdEmpty: 'No PRDs have been saved in this project.', prdTrashEmpty: 'No deleted PRDs.',
    prdRelatedRequirements: 'Related requirements', prdNoRequirements: 'No linked requirements',
    prdLinkPicker: 'Choose a PRD', prdSaveLink: 'Save link', prdUnlink: 'Unlink',
    prdRestore: 'Restore', prdNoLinks: 'This requirement has no linked PRDs.', prdNoOptions: 'No other PRDs are available to link.',
    prdLinkSaved: 'PRD linked.', prdLinkRemoved: 'PRD unlinked.', prdRestored: 'PRD restored.', prdDeleted: 'PRD moved to Trash.',
    prdDeleteTitle: 'Delete PRD?', prdDeleteHint: 'This document will be removed from the following requirements. It can be restored from Trash.',
    prdDeleteUnlinked: 'This document can be restored from Trash.',
    prdOpenFull: 'Open full document', prdOutline: 'On this page',
    prdLinkUnavailable: 'This document is no longer linked here.',
    prdImageMissing: 'Image unavailable', prdImageLoading: 'Loading image',
    reviewPrdRequired: 'Link a saved PRD before sending this requirement for review.', prdGoLink: 'Go to linked PRDs',
  },
  zh: {
    navPrds: 'PRD 管理', prdNew: '新建 PRD', prdRead: '查看 PRD', prdCloseRead: '收起 PRD', prdTrash: '回收站', prdActive: '当前文档',
    prdEmpty: '当前项目还没有已保存的 PRD。', prdTrashEmpty: '回收站为空。',
    prdRelatedRequirements: '关联需求', prdNoRequirements: '未关联需求',
    prdLinkPicker: '选择 PRD', prdSaveLink: '保存关联', prdUnlink: '解除关联',
    prdRestore: '恢复', prdNoLinks: '当前需求还没有关联 PRD。', prdNoOptions: '暂无其他可关联的 PRD。',
    prdLinkSaved: '已保存 PRD 关联。', prdLinkRemoved: '已解除 PRD 关联。', prdRestored: '已恢复 PRD。', prdDeleted: '已将 PRD 移入回收站。',
    prdDeleteTitle: '删除 PRD？', prdDeleteHint: '以下需求将失去此文档的关联。之后可在回收站恢复。',
    prdDeleteUnlinked: '之后可在回收站恢复此文档。',
    prdOpenFull: '打开全文', prdOutline: '本文目录',
    prdLinkUnavailable: '此文档已解除关联。',
    prdImageMissing: '图片无法显示', prdImageLoading: '图片加载中',
    reviewPrdRequired: '请先关联一份 PRD，再提交评审。', prdGoLink: '去关联 PRD',
  },
}

export function notifyPrdChanged(root) {
  window.dispatchEvent(new CustomEvent('pw-prd-changed', { detail: { root } }))
}

function usePrdRead(root, { id, deleted = false } = {}) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState(null)
  const reload = () => setRevision(value => value + 1)
  useEffect(() => {
    const changed = event => { if (event.detail?.root === root) reload() }
    const visible = () => { if (!document.hidden) reload() }
    window.addEventListener('pw-prd-changed', changed)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('pw-prd-changed', changed)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [root])
  useEffect(() => {
    let active = true
    const request = id ? rpc('prd/read', { root, id }) : rpc('prd/list', { root, deleted })
    request.then(res => { if (active) setResult({ root, id, deleted, revision, res }) })
    return () => { active = false }
  }, [root, id, deleted, revision])
  const current = result && result.root === root && result.id === id && result.deleted === deleted ? result : null
  return { data: current?.res.ok ? current.res.data : null, error: current?.res.ok === false ? current.res : null,
    initial: !current, pending: current?.revision !== revision, reload }
}

function PrdError({ error, t, onRetry }) {
  if (!error) return null
  return h('div', { className: 'pw-prd-error', role: 'alert' },
    h('span', { className: 'pw-error' }, error.message || t('errGeneric')),
    onRetry && h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: onRetry }, t('retryRead')))
}

const reqTitle = (requirements, id) => requirements.find(item => item.id === id)?.title || id

export function PrdManagement({ wb, onRead, onEdit }) {
  const { root, requirements, t, nav, setFilter } = wb
  const deleted = nav.filters.prds?.deleted === true
  const { data, error, initial, pending, reload } = usePrdRead(root, { deleted })
  const [remove, setRemove] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [notice, setNotice] = useState('')
  const changeTab = next => { setNotice(''); setActionError(null); setFilter('prds', { deleted: next, query: '' }) }
  const manage = async (method, item) => {
    if (busy) return
    setBusy(true); setActionError(null); setNotice('')
    const res = await rpc(method, { root, id: item.id, version: item.version })
    setBusy(false)
    if (!res.ok) {
      setActionError(res)
      if (res.code === 'PRD_CONFLICT') { setRemove(null); reload() }
      return
    }
    setRemove(null)
    setNotice(t(method === 'prd/delete' ? 'prdDeleted' : 'prdRestored'))
    notifyPrdChanged(root)
  }
  const query = String(nav.filters.prds?.query ?? '').trim().toLocaleLowerCase()
  const items = [...(data ?? [])].filter(item => !query || item.title.toLocaleLowerCase().includes(query))
    .sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')) || a.title.localeCompare(b.title))
  const toolbar = h(React.Fragment, null,
    h('div', { className: 'pw-prd-switch', role: 'group', 'aria-label': t('navPrds') },
      h('button', { className: 'pw-button' + (!deleted ? ' primary' : ''), 'aria-pressed': !deleted,
        onClick: () => changeTab(false) }, t('prdActive')),
      h('button', { className: 'pw-button' + (deleted ? ' primary' : ''), 'aria-pressed': deleted,
        onClick: () => changeTab(true) }, t('prdTrash'))),
    !deleted && h('button', { className: 'pw-button', onClick: () => onEdit() }, t('prdNew')))
  return h(React.Fragment, null,
    !remove && h(PrdError, { error: actionError, t }),
    h(PrdError, { error, t, onRetry: reload }),
    notice && h('p', { className: 'pw-prd-notice', role: 'status' }, notice),
    h(ListPage, {
      wb, page: 'prds', title: t('navPrds'), items, toolbar,
      columns: [t('listDocument'), t('listRevision'), t('prdRelatedRequirements'), t('updated'), t('listActions')],
      waiting: initial || (pending && !items.length && !error),
      emptyText: error ? '' : t(deleted ? 'prdTrashEmpty' : 'prdEmpty'),
      renderRow: item => ({
        key: item.id,
        cells: [
          listTitle(item.title, item.id, deleted ? null : () => onRead(item.id)),
          h('span', { className: 'pw-list-value' }, 'v' + item.revision),
          h('span', { className: 'pw-list-preview' },
            item.reqIds.length ? item.reqIds.map(id => reqTitle(requirements, id)).join(t('fieldSeparator')) : t('prdNoRequirements')),
          h('span', { className: 'pw-list-value pw-list-muted' }, prdDate(item.updated) || '—'),
          deleted
            ? h('button', { className: 'pw-button', onClick: () => manage('prd/restore', item), disabled: busy || pending }, t('prdRestore'))
            : h('details', {
              className: 'pw-list-menu',
              onKeyDown: event => {
                if (event.key !== 'Escape' || !event.currentTarget.open) return
                event.stopPropagation()
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
              },
            },
            h('summary', { className: 'pw-button', 'aria-label': t('requirementActions') + ' · ' + item.title }, t('requirementActions')),
            h('div', { className: 'pw-list-actions' },
              h('button', { className: 'pw-button', onClick: () => onEdit(item.id), disabled: busy || pending }, t('edit')),
              h('button', { className: 'pw-button danger', onClick: () => { setRemove(item); setActionError(null) }, disabled: busy || pending }, t('delete')))),
        ],
      }),
    }),
    remove && h(Modal, { title: t('prdDeleteTitle'), onClose: () => { if (!busy) setRemove(null) }, actions: [
      h('button', { key: 'cancel', className: 'pw-button', disabled: busy, onClick: () => setRemove(null) }, t('cancel')),
      h('button', { key: 'delete', className: 'pw-button danger', disabled: busy, onClick: () => manage('prd/delete', remove) }, t('delete')),
    ] }, h('strong', null, remove.title),
    h('p', { className: 'pw-note' }, t(remove.reqIds.length ? 'prdDeleteHint' : 'prdDeleteUnlinked')),
    remove.reqIds.length > 0 && h('ul', { className: 'pw-diaglist' }, remove.reqIds.map(id => h('li', { key: id }, reqTitle(requirements, id)))),
    h(PrdError, { error: actionError, t })))
}

export function PrdDocuments({ root, reqId, requirements, t, activeId, onRead, onEdit, onNew, onSummary, readOnly, summaryOnly, onOpenFull }) {
  const { data, error, initial, pending, reload } = usePrdRead(root)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [notice, setNotice] = useState('')
  const linked = (data ?? []).filter(item => item.reqIds.includes(reqId))
  const available = (data ?? []).filter(item => !item.reqIds.includes(reqId))
  const candidate = available.find(item => item.id === pick)
  const selected = linked.find(item => item.id === activeId)
  const summary = error ? t('errUnreadable') : initial ? t('reqLoadingPrds')
    : linked.length ? t('reqPrdCount').replace('{n}', String(linked.length)) : t('reqNoPrds')
  useEffect(() => { onSummary?.(summary) }, [onSummary, summary])
  const changeLink = async (item, linked) => {
    if (busy || pending || !item) return
    setBusy(true); setActionError(null); setNotice('')
    const res = await rpc('prd/link', { root, id: item.id, reqId, linked, version: item.version })
    setBusy(false)
    if (!res.ok) {
      setActionError(res)
      if (res.code === 'PRD_CONFLICT') reload()
      return
    }
    setPick('')
    if (!linked && item.id === activeId) onRead(null)
    setNotice(t(linked ? 'prdLinkSaved' : 'prdLinkRemoved'))
    notifyPrdChanged(root)
  }
  if (summaryOnly) return null
  return h('section', { id: readOnly ? undefined : 'pw-prd-associations-' + reqId, tabIndex: -1, className: 'pw-prd-associations', 'aria-label': t('prds') },
    !readOnly && h('header', { className: 'pw-subpage-head' },
      h('button', { type: 'button', className: 'pw-button', onClick: () => onNew(reqId) }, t('prdNew'))),
    h(PrdError, { error, t, onRetry: reload }),
    h(PrdError, { error: actionError, t }),
    initial ? h('p', { className: 'pw-note', role: 'status' }, t('loading')) : !error && h(React.Fragment, null,
      linked.length === 0 && h('p', { className: 'pw-note' }, t('prdNoLinks')),
      linked.length > 0 && h('ul', { className: 'pw-prd-links' }, linked.map(item => h('li', { key: item.id },
        h('button', { type: 'button', className: 'pw-button pw-prd-link', 'aria-expanded': item.id === activeId,
          onClick: () => onRead(activeId === item.id ? null : item.id) }, item.title),
        h('span', { className: 'pw-count' }, 'v' + item.revision),
        !readOnly && h('button', { type: 'button', className: 'pw-button pw-quiet', 'aria-label': `${t('prdUnlink')} · ${item.title}`,
          disabled: busy || pending, onClick: () => changeLink(item, false) }, t('prdUnlink'))))),
      activeId && !selected && h('p', { className: 'pw-note', role: 'status' }, t('prdLinkUnavailable')),
      selected && h(PrdReader, {
        key: activeId, root, id: activeId, requirements, t, onEdit: readOnly ? undefined : onEdit,
        onOpenFull, onBack: () => onRead(null), inline: true, inDrawer: readOnly,
      }),
      !readOnly && h('form', { className: 'pw-prd-link-form', onSubmit: event => { event.preventDefault(); changeLink(candidate, true) } },
        h('label', { className: 'pw-field' }, h('span', null, t('prdLinkPicker')),
          h('select', { className: 'pw-select', value: candidate?.id ?? '', disabled: busy || pending || !available.length, onChange: event => { setPick(event.target.value); setActionError(null) } },
            h('option', { value: '' }, t(available.length ? 'prdLinkPicker' : 'prdNoOptions')),
            available.map(item => h('option', { key: item.id, value: item.id }, `${item.title} · v${item.revision}`)))),
        h('div', { className: 'pw-actions' },
          h('button', { type: 'submit', className: 'pw-button primary', disabled: busy || pending || !candidate }, t('prdSaveLink')),
          h('button', { type: 'button', className: 'pw-button pw-quiet', disabled: busy || !pick,
            onClick: () => { setPick(''); setActionError(null) } }, t('cancel'))))),
    notice && h('p', { className: 'pw-prd-notice', role: 'status' }, notice))
}

function PrdImage({ root, id, name, alt, revision, t }) {
  const [image, setImage] = useState(null)
  useEffect(() => {
    let active = true
    rpc('prd/image', { root, id, name }).then(({ ok, data }) => {
      if (!active) return
      const safe = ok && /^image\/(?:png|jpeg|gif|webp)$/.test(data?.mime) && typeof data.base64 === 'string'
      setImage(safe ? `data:${data.mime};base64,${data.base64}` : '')
    })
    return () => { active = false }
  }, [root, id, name, revision])
  if (image) return h('img', { className: 'pw-prd-image', src: image, alt, loading: 'lazy', decoding: 'async', onError: () => setImage('') })
  return h('span', { className: 'pw-note' }, alt || t(image === null ? 'prdImageLoading' : 'prdImageMissing'))
}

function headingText(node) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(headingText).join('')
  return node?.props ? node.props.alt ?? headingText(node.props.children) : ''
}

export function PrdReader({
  root, id, requirements, t, onEdit, onBack, inline = false, inDrawer = false,
  backLabel, onOpenFull, readingMemory,
}) {
  const { data: prd, error, initial, reload } = usePrdRead(root, { id })
  const reader = useRef(null)
  const scroller = useRef(null)
  const readingKey = JSON.stringify([root, id, inDrawer ? 'drawer' : 'full'])
  React.useLayoutEffect(() => {
    if (!initial && scroller.current) scroller.current.scrollTop = readingMemory?.[readingKey] ?? 0
  }, [initial, readingKey, readingMemory])
  useEffect(() => {
    if (inline && !inDrawer && !initial) reader.current?.scrollIntoView({ block: 'nearest' })
  }, [inline, inDrawer, initial])
  const headings = []
  const content = prd && renderMarkdown(prd.markdown.replace(/^#[ \t]+[^\r\n]+(?:\r?\n|$)/, ''), t, {
    image: (alt, path, key) => {
      const name = /^assets\/([a-z0-9][a-z0-9_.-]*)$/i.exec(path)?.[1]
      return name ? h(PrdImage, { key: key + ':' + name + ':' + prd.version, name, alt, root, id, revision: prd.revision, t })
        : h('span', { key, className: 'pw-note' }, alt || t('prdImageMissing'))
    },
  }).map((node, index) => {
    if (inline || typeof node.type !== 'string' || !/^h[1-4]$/.test(node.type)) return node
    const title = headingText(node.props.children).trim()
    if (title) headings.push({ index, title })
    return React.cloneElement(node, { 'data-prd-heading': index, tabIndex: -1 })
  })
  const jump = index => {
    const heading = scroller.current?.querySelector('[data-prd-heading="' + index + '"]')
    heading?.scrollIntoView({ block: 'start' })
    heading?.focus({ preventScroll: true })
  }
  const hasOutline = headings.length > 1
  return h('section', {
    ref: reader,
    className: 'pw-prd-reader' + (inline ? ' pw-prd-reader-inline' : '') + (inDrawer ? ' pw-prd-reader-drawer' : ''),
    'aria-label': t('prdRead'),
  },
  h('header', { className: 'pw-prd-reader-head' },
    onBack && h('button', { className: 'pw-button', onClick: onBack }, backLabel || t(inline ? 'prdCloseRead' : 'backToPrevious')),
    prd && onOpenFull && h('button', { id: 'pw-prd-open-full', className: 'pw-button', onClick: () => onOpenFull(id) }, t('prdOpenFull')),
    prd && onEdit && h('button', { className: 'pw-button', onClick: () => onEdit(id) }, t('edit'))),
  h(PrdError, { error, t, onRetry: reload }),
  initial && h('p', { className: 'pw-note', role: 'status' }, t('loading')),
  prd && h('div', {
    className: 'pw-prd-scroll', ref: scroller, tabIndex: inDrawer ? undefined : 0, role: 'region', 'aria-label': prd.title,
    onScroll: readingMemory && (event => { readingMemory[readingKey] = event.currentTarget.scrollTop }),
  },
  h('div', { className: 'pw-prd-page' + (hasOutline ? ' pw-prd-page-outline' : '') },
    hasOutline && h('nav', { className: 'pw-prd-outline', 'aria-label': t('prdOutline') },
      h('strong', null, t('prdOutline')),
      h('ul', null, headings.map(({ index, title }) => h('li', { key: index },
        h('button', { type: 'button', className: 'pw-prd-outline-link', onClick: () => jump(index) }, title))))),
    h('article', { className: 'pw-md pw-prd-article' },
      h('h1', { className: 'pw-md-h' }, prd.title),
      h('p', { className: 'pw-count' }, 'v' + prd.revision, ' · ', t('updated'), ' ', prdDate(prd.updated)),
      prd.reqIds.length > 0 && h('p', { className: 'pw-note' }, t('prdRelatedRequirements'), ' · ', prd.reqIds.map(reqId => reqTitle(requirements, reqId)).join(t('fieldSeparator'))),
      content))))
}

export const prdCss = `
.pw-prd-error{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-block:6px}
.pw-prd-notice{margin-block:3px;color:var(--dsw-alias-label-secondary)}
.pw-prd-switch{display:flex;gap:6px}
.pw-prd-associations:focus-visible,.pw-prd-scroll:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-prd-associations .pw-subpage-head{align-items:center;flex-wrap:wrap;margin-bottom:10px}
.pw-prd-links{list-style:none;padding:0;margin:0 0 14px}
.pw-prd-links li{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l3);padding-block:4px}
.pw-prd-links li .pw-button:last-child{margin-inline-start:auto}
.pw-prd-links .pw-prd-link{max-width:100%;white-space:normal;overflow-wrap:anywhere;text-align:start}
.pw-prd-link-form{display:grid;grid-template-columns:minmax(180px,1fr) auto;align-items:end;gap:8px 12px;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.pw-prd-link-form .pw-field{margin:0;min-width:0}
.pw-prd-link-form select{width:100%;min-height:32px}
.pw-prd-reader{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column}
.pw-prd-reader-inline{margin-block:12px 16px}
.pw-prd-reader-inline .pw-prd-scroll{max-height:60vh}
.pw-prd-reader-head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding-bottom:8px}
.pw-prd-scroll{flex:1;min-width:0;min-height:0;overflow:auto;container:prd-reader / inline-size;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);border-radius:10px}
.pw-prd-reader-drawer .pw-prd-scroll{overflow:visible;max-height:none;border:0;background:transparent}
.pw-prd-reader-drawer .pw-prd-article{padding:0}
.pw-prd-reader-drawer .pw-prd-article h1:first-child{font-size:20px}
.pw-prd-page{min-width:0;padding:clamp(14px,4cqi,36px)}
.pw-prd-reader-drawer .pw-prd-page{padding:0}
.pw-prd-page-outline{display:grid;grid-template-columns:minmax(130px,170px) minmax(0,760px);gap:clamp(18px,3cqi,36px);justify-content:center;align-items:start}
.pw-prd-outline{position:sticky;inset-block-start:14px;max-block-size:min(50vh,390px);overflow:auto;padding-inline-end:12px;border-inline-end:1px solid var(--dsw-alias-border-l3)}
.pw-prd-outline strong{display:block;margin-block:3px 8px;font-size:13px}
.pw-prd-outline ul{display:grid;gap:3px;list-style:none;padding:0;margin:0}
.pw-prd-outline-link{display:block;width:100%;text-align:start;overflow-wrap:anywhere;cursor:pointer;padding:4px 5px;color:var(--dsw-alias-label-secondary);font:inherit;border:0;border-radius:4px;background:none}
.pw-prd-outline-link:hover{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}
.pw-prd-outline-link:focus-visible,.pw-prd-article [data-prd-heading]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-prd-article{margin:0 auto;min-width:0;width:100%;box-sizing:border-box;overflow-wrap:anywhere}
.pw-prd-article h1:first-child{margin-top:0}
.pw-prd-article [data-prd-heading]{scroll-margin-top:14px}
@container prd-reader (max-width:650px){
  .pw-prd-page-outline{grid-template-columns:minmax(0,1fr)}
  .pw-prd-outline{position:static;max-block-size:110px;border-inline-end:0;padding:0 0 8px;border-block-end:1px solid var(--dsw-alias-border-l3)}
  .pw-prd-outline ul{display:flex;flex-wrap:wrap}
}
.pw-prd-article h1{font-size:clamp(22px,3vw,30px)}
.pw-prd-article .pw-md-table{min-width:max-content}
.pw-prd-article .pw-prd-image{display:block;max-width:100%;height:auto;margin-block:8px;border-radius:6px}
@media(max-width:620px){.pw-prd-link-form{grid-template-columns:1fr}}
`
