import React from 'react'
import { requirementOverview } from '../../core/state.js'
import { COLS, MOVES, boardItems } from '../shell/nav-state.js'

const h = React.createElement
const { useEffect, useRef, useState } = React

const COL_ACCENT = { reviewing: 'var(--dsw-alias-brand-primary)', ready: 'var(--dsw-alias-label-secondary)', backlog: 'var(--dsw-alias-label-tertiary)', in_progress: 'var(--dsw-alias-brand-primary)', pending: 'var(--dsw-alias-state-warn-primary)', completed: 'var(--dsw-alias-state-success-primary)' }
const flagOf = d => d.blocked ? 'blocked' : d.needsClarification ? 'clarify' : d.submittable ? 'submittable' : d.stalled ? 'stalled' : d.acceptable ? 'acceptable' : null

// 需求看板：六列需求、拖动改阶段（标出合法目标列，折叠的已完成列可投放）、
// N/J/K/H/L 快捷键、点击进详情、返回定位原卡片（PRD §7.5）。
export function BoardPage({ wb }) {
  const { t, requirements, saving, modal, setModal, doMove, navigate, openDetail, setFilter } = wb
  const filters = wb.nav.filters.board ?? {}
  const query = filters.query ?? ''
  const showCompleted = !!filters.showCompleted
  const cursorId = filters.cursor ?? null
  const [dragOver, setDragOver] = useState(null)
  const [dragging, setDragging] = useState(null)
  const dragSource = useRef(null)
  const skipCardClick = useRef(false)
  const newRef = useRef(null)
  const visible = requirements.filter(r => !query || r.title.toLowerCase().includes(query.toLowerCase()))
  const setCursor = id => setFilter('board', { cursor: id })

  const columnAt = event => document.elementFromPoint(event.clientX, event.clientY)
    ?.closest('[data-requirement-column]')?.dataset.requirementColumn
  const moved = (event, start) => Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6
  const clearDrag = () => { dragSource.current = null; setDragging(null); setDragOver(null) }
  const finishDrag = event => {
    const start = dragSource.current
    if (!start || event.button !== 0) return
    clearDrag()
    if (!start.active && !moved(event, start)) return
    skipCardClick.current = true
    const target = columnAt(event)
    const req = requirements.find(item => item.id === start.id)
    if (target && req) doMove(req, target)
  }

  // keyboard: N new, J/K cursor, H/L move column, Enter open, Esc clear cursor
  useEffect(() => {
    const onKey = e => {
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
        if (e.key === 'Escape') e.target.blur()
        return
      }
      if (modal || wb.nav.params) return
      const flat = visible.filter(r => r.status !== 'completed' || showCompleted)
      const idx = flat.findIndex(r => r.id === cursorId)
      const cursor = flat.find(r => r.id === cursorId) ?? null
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newRef.current?.click() }
      else if (['j', 'k'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        const next = e.key.toLowerCase() === 'j' ? Math.min(idx + 1, flat.length - 1) : Math.max(idx - 1, 0)
        const id = flat[next]?.id
        if (id) { setCursor(id); wb.setFocusTarget('pw-board-' + id) }
      }
      else if (e.key === 'Enter' && cursor && tag !== 'button') openDetail({ reqId: cursor.id, issueId: null })
      else if (e.key === 'Escape') setCursor(null)
      else if ((e.key === 'h' || e.key === 'H' || e.key === 'l' || e.key === 'L') && cursor) {
        e.preventDefault()
        const ci = COLS.indexOf(cursor.status)
        const left = e.key.toLowerCase() === 'h'
        const candidates = left ? COLS.slice(0, ci).reverse() : COLS.slice(ci + 1)
        const target = candidates.find(status => MOVES[cursor.status]?.[status])
        if (target) doMove(cursor, target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, cursorId, requirements, showCompleted, modal, wb.nav.params, doMove])

  const card = r => {
    const d = r.derived ?? {}
    const flag = flagOf(d)
    const pct = d.progress == null ? null : Math.round(d.progress * 100)
    const preview = requirementOverview(r) || r.background?.trim()
    const reopenItems = r.pendingReopen?.items ?? []
    return h('div', { key: r.id, className: 'pw-card-shell' },
      h('div', {
        id: 'pw-board-' + r.id, className: 'pw-card' + (r.id === cursorId ? ' selected' : ''), tabIndex: 0,
        role: 'button', 'aria-label': r.title,
        onClick: () => {
          if (skipCardClick.current) { skipCardClick.current = false; return }
          setCursor(r.id); openDetail({ reqId: r.id, issueId: null })
        },
        onFocus: () => setCursor(r.id),
        onKeyDown: e => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault(); e.stopPropagation()
          setCursor(r.id); openDetail({ reqId: r.id, issueId: null })
        },
        onPointerDown: e => {
          skipCardClick.current = false
          if (e.button !== 0 || saving || modal || r.pendingReopen) return
          dragSource.current = { id: r.id, pointer: e.pointerId, x: e.clientX, y: e.clientY }
          e.currentTarget.setPointerCapture(e.pointerId)
        },
        onPointerMove: e => {
          const start = dragSource.current
          if (start?.pointer !== e.pointerId || (!start.active && !moved(e, start))) return
          start.active = true
          setDragging(r.id)
          setDragOver(columnAt(e))
        },
        onPointerCancel: clearDrag,
      },
      h('p', { className: 'pw-cardtitle pw-preview' }, r.title),
      h('div', { className: 'pw-cardmeta' },
        pct !== null && h('div', { className: 'pw-bar', title: `${pct}%` }, h('span', { style: { width: pct + '%' } })),
        flag && h('span', { className: 'pw-flag ' + flag }, t('flag_' + flag))),
      preview && h('div', { className: 'pw-next pw-preview' }, preview)),
      r.pendingReopen && h('button', { className: 'pw-button pw-card-retry', disabled: saving,
        onClick: () => setModal({ kind: 'reopenRequirement', req: r }) },
      t('resumeReopen') + ' · ' + t('reopenProgress').replace('{done}', String(reopenItems.filter(item => item.done).length)).replace('{total}', String(reopenItems.length))))
  }

  const dragged = requirements.find(item => item.id === dragging)
  const column = state => {
    const items = boardItems(visible, '', state)
    const collapsed = state === 'completed' && !showCompleted
    const allowed = dragged && !dragged.pendingReopen && MOVES[dragged.status]?.[state]
    return h('div', {
      key: state, className: 'pw-col' + (allowed ? ' pw-drop-target' : '') + (allowed && dragOver === state ? ' dragover' : ''),
      'data-requirement-column': state,
    },
      h('div', { className: 'pw-colhead' }, h('span', { className: 'pw-dot', style: { background: COL_ACCENT[state] } }), t('col_' + state), h('span', { className: 'pw-count' }, String(items.length)),
        state === 'completed' && !collapsed && h('button', { className: 'pw-button', style: { marginLeft: 'auto', minHeight: 22, padding: '0 6px', fontSize: 12 }, onClick: () => setFilter('board', { showCompleted: false }) }, t('collapse'))),
      collapsed
        ? h('button', { className: 'pw-button', onClick: () => setFilter('board', { showCompleted: true }) }, t('expand'))
        : h('div', { className: 'pw-cards' }, items.length ? items.map(card) : h('div', { className: 'pw-empty' }, t('empty'))))
  }

  return h(React.Fragment, null,
    h('div', { className: 'pw-list-toolbar' },
      h('button', { className: 'pw-button', ref: newRef, disabled: saving, 'aria-keyshortcuts': 'N', onClick: () => setModal({ kind: 'createRequirement' }) }, t('newRequirement')),
      h('input', { className: 'pw-input', style: { maxWidth: 220 }, placeholder: t('search'), value: query, 'aria-label': t('search'), onChange: e => setFilter('board', { query: e.target.value }) }),
      query && visible.length === 0 && h('button', { className: 'pw-button pw-quiet', onClick: () => setFilter('board', { query: '' }) }, t('clearFilter'))),
    query && visible.length === 0
      ? h('div', { className: 'pw-empty' }, t('noResults'))
      : h('div', { className: 'pw-board', onPointerUpCapture: finishDrag, onMouseUpCapture: finishDrag }, COLS.map(column)))
}
