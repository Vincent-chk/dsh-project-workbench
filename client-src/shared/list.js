import React from 'react'

const h = React.createElement
const { useLayoutEffect, useRef } = React

export const listLocale = {
  en: {
    listRequirement: 'Requirement', listTask: 'Task', listActions: 'Actions', listPriority: 'Order',
    listEffectiveProgress: 'Done / active tasks', listAttention: 'Needs attention', listReason: 'Reason',
    listDelivery: 'Delivery summary', listOpinion: 'Decision notes', listDocument: 'Document', listRevision: 'Revision',
    listReorder: 'Change order', listFinishReorder: 'Done reordering', listNoAlerts: 'No alerts',
  },
  zh: {
    listRequirement: '需求', listTask: '任务', listActions: '操作', listPriority: '顺位',
    listEffectiveProgress: '已完成 / 有效任务', listAttention: '需要关注', listReason: '原因',
    listDelivery: '交付摘要', listOpinion: '决定意见', listDocument: '文档名称', listRevision: '修订号',
    listReorder: '调整顺位', listFinishReorder: '结束排序', listNoAlerts: '暂无异常',
  },
}

export function useListScroll(wb, page, waiting = false) {
  const ref = useRef(null)
  const memory = wb.uiMemory && (wb.uiMemory.listScroll ??= {})
  const key = wb.projectKey && JSON.stringify([wb.projectKey, page])
  const filter = JSON.stringify(wb.nav.filters[page] ?? {})
  useLayoutEffect(() => {
    const saved = key && memory?.[key]
    if (ref.current && !waiting) ref.current.scrollTop = saved?.filter === filter ? saved.top : 0
  }, [key, filter, waiting, memory])
  return {
    ref,
    onScroll: key && memory && !waiting ? event => {
      memory[key] = { filter, top: event.currentTarget.scrollTop }
    } : undefined,
  }
}

export function listTable(columns, rows, label, hasActions = true) {
  return h('table', { className: 'pw-list-table' + (hasActions ? ' pw-list-table-actions' : ''), role: 'table', 'aria-label': label },
    h('thead', { role: 'rowgroup' },
      h('tr', { role: 'row' }, columns.map((column, index) => h('th', { key: index, scope: 'col', role: 'columnheader' }, column)))),
    h('tbody', { role: 'rowgroup' }, rows.map(({ key, cells }) => h('tr', { key, role: 'row' },
      cells.map((cell, index) => h('td', { key: index, role: 'cell' },
        index > 0 && h('span', { className: 'pw-list-inline-label', 'aria-hidden': true }, columns[index]),
        cell))))))
}

export function listTitle(title, id, onClick) {
  return onClick
    ? h('button', { type: 'button', id: 'pw-list-item-' + id, className: 'pw-list-title', onClick }, title)
    : h('strong', { className: 'pw-list-name' }, title)
}

export function boardLocator(wb, req) {
  return h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: () => wb.locateBoard(req) }, wb.t('locateBoard'))
}

// 加载和错误提示由各页提供，只有读取成功的列表才显示空数据或无匹配。
export function ListPage({ wb, page, title, items, columns, renderRow, emptyText, emptyAction, toolbar, waiting, filtersActive, onClear, hasActions }) {
  const { t, setFilter } = wb
  const query = (wb.nav.filters[page] ?? {}).query ?? ''
  const filtered = !!query.trim() || filtersActive
  const scroll = useListScroll(wb, page, waiting)
  return h('section', { ...scroll, className: 'pw-list pw-list-catalog', 'aria-busy': waiting || undefined },
    h('header', { className: 'pw-list-header' }, h('h2', null, title)),
    h('div', { className: 'pw-list-toolbar' },
      h('input', { type: 'search', className: 'pw-input pw-list-search', placeholder: t('search'), value: query, 'aria-label': t('search'), onChange: e => setFilter(page, { query: e.target.value }) }),
      toolbar,
      filtered && items.length === 0 && !waiting && h('button', { type: 'button', className: 'pw-button pw-quiet',
        onClick: onClear || (() => setFilter(page, { query: '' })) }, t('clearFilter'))),
    items.length > 0 ? listTable(columns, items.map(renderRow), title, hasActions)
      : waiting ? h('p', { className: 'pw-note', role: 'status' }, t('loading'))
        : emptyText && h('div', { className: 'pw-empty' }, filtered ? t('noResults') : emptyText, !filtered && emptyAction))
}

export const dateText = value => String(value ?? '').replace('T', ' ').slice(0, 16)
export const firstLine = value => String(value ?? '').split(/\r?\n/).find(line => line.trim())?.trim() ?? ''

export const listCss = `
.pw-list-catalog{container:list-catalog / inline-size;min-width:0;gap:14px}
.pw-list-header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.pw-list-header h2{margin:0;font-size:20px;font-weight:650;line-height:1.4}
.pw-list-catalog .pw-list-search{width:220px;max-width:100%;box-sizing:border-box}
.pw-list-table{width:100%;table-layout:auto;border-collapse:separate;border-spacing:0;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;text-align:start}
.pw-list-table th,.pw-list-table td{padding:8px 12px;vertical-align:middle;text-align:start;overflow-wrap:anywhere;border-bottom:1px solid var(--dsw-alias-border-l3)}
.pw-list-table th{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}
.pw-list-table tbody tr:last-child td{border-bottom:0}
.pw-list-table th:first-child{width:30%}
.pw-list-table-actions th:last-child{width:1%;min-width:6em}
.pw-list-table td:first-child{padding-block:1px}
.pw-list-table td .pw-istatus,.pw-list-table td .pw-flag{display:inline-flex;width:max-content;max-width:100%;white-space:normal}
.pw-list-table td .pw-istatus{pointer-events:none}
.pw-list-title{display:block;width:100%;min-height:44px;padding:6px 0;border:0;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-weight:600;text-align:start;cursor:pointer;overflow-wrap:anywhere}
.pw-list-title:hover{text-decoration:underline;color:var(--dsw-alias-brand-primary)}
.pw-list-title:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.pw-list-name{display:block;padding-block:8px;overflow-wrap:anywhere}
.pw-list-value{font-variant-numeric:tabular-nums}
.pw-list-muted,.pw-list-preview,.pw-list-parent{color:var(--dsw-alias-label-secondary)}
.pw-list-parent{display:block;margin-block:2px 7px;font-size:12px}
.pw-list-preview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pw-list-review-note{-webkit-line-clamp:1}
.pw-list-alerts,.pw-list-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pw-list-actions .pw-button{min-height:32px}
.pw-list-actions .pw-orderbtn{min-height:32px;min-width:32px}
.pw-list-actions .pw-orderbtn:focus-visible,.pw-list-menu>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-list-inline-label{display:none}
.pw-list-risk{min-width:0}
.pw-list-risk h3{margin:8px 0;font-size:15px}
.pw-list-menu summary{min-height:32px;box-sizing:border-box;white-space:nowrap}
.pw-list-menu .pw-list-actions{padding-top:6px}
@container list-catalog (max-width:710px){
  .pw-list-table,.pw-list-table tbody{display:block}
  .pw-list-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  .pw-list-table tbody tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px 14px;padding:8px 12px}
  .pw-list-table tbody tr+tr{border-top:1px solid var(--dsw-alias-border-l3)}
  .pw-list-table td{display:block;min-width:0;padding:2px 0;border:0}
  .pw-list-table td:first-child,.pw-list-table-actions td:last-child{grid-column:1 / -1}
  .pw-list-table td:last-child:empty{display:none}
  .pw-list-table-actions td:last-child>.pw-list-inline-label{display:none}
  .pw-list-inline-label{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;margin-bottom:2px}
}
@container list-catalog (max-width:400px){
  .pw-list-table tbody tr{grid-template-columns:minmax(0,1fr)}
}
`
