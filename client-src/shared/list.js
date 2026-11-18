import React from 'react'

const h = React.createElement

// 列表页通用骨架：搜索工具栏、空数据（给新建或上游入口）、筛选无结果（可清空）。
// 加载中与读取失败由外壳保留框架展示。
export function ListPage({ wb, page, items, renderRow, emptyText, emptyAction, toolbar }) {
  const { t, setFilter } = wb
  const query = (wb.nav.filters[page] ?? {}).query ?? ''
  return h('div', { className: 'pw-list' },
    h('div', { className: 'pw-list-toolbar' },
      toolbar,
      h('input', { className: 'pw-input', style: { maxWidth: 220 }, placeholder: t('search'), value: query, 'aria-label': t('search'), onChange: e => setFilter(page, { query: e.target.value }) }),
      query && items.length === 0 && h('button', { className: 'pw-button pw-quiet', onClick: () => setFilter(page, { query: '' }) }, t('clearFilter'))),
    items.length === 0
      ? h('div', { className: 'pw-empty' }, query ? t('noResults') : emptyText,
        !query && emptyAction)
      : h('div', { className: 'pw-list-rows' }, items.map(renderRow)))
}

export const dateText = value => String(value ?? '').replace('T', ' ').slice(0, 16)
