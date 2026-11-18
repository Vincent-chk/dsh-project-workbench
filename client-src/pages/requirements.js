import React from 'react'
import { requirementOverview } from '../../core/state.js'
import { poolItems, reviewItems, readyItems } from '../shell/nav-state.js'
import { reviewRecords } from '../workbench-content.js'
import { ListPage, dateText } from '../shared/list.js'

const h = React.createElement

const Row = ({ req, page, wb, meta, actions }) => {
  const { t, openDetail, locateBoard } = wb
  return h('div', { className: 'pw-row', key: req.id },
    h('button', { className: 'pw-row-main', onClick: () => openDetail({ reqId: req.id, issueId: null }, page), title: req.title },
      h('strong', { className: 'pw-preview' }, req.title),
      meta),
    h('div', { className: 'pw-row-actions' },
      actions,
      h('button', { className: 'pw-button pw-quiet', onClick: () => locateBoard(req) }, t('locateBoard'))))
}

// 需求池：标题、需求概述、最近更新、送审缺项提示；新建/编辑/整理/草稿删除在详情。
export function PoolPage({ wb }) {
  const { t, requirements, setModal } = wb
  const query = (wb.nav.filters.pool ?? {}).query ?? ''
  const items = poolItems(requirements, query)
  return h(ListPage, {
    wb, page: 'pool', items,
    toolbar: h('button', { className: 'pw-button', onClick: () => setModal({ kind: 'createRequirement' }) }, t('newRequirement')),
    emptyText: t('homeFirstRequirement'),
    emptyAction: h('button', { className: 'pw-button primary', style: { marginLeft: 8 }, onClick: () => setModal({ kind: 'createRequirement' }) }, t('newRequirement')),
    renderRow: req => h(Row, { req, page: 'pool', wb, key: req.id,
      meta: h(React.Fragment, null,
        h('span', { className: 'pw-preview pw-note' }, requirementOverview(req) || t('requirementMissing').replace('{fields}', t('requirementOverview'))),
        h('span', { className: 'pw-count' }, t('updated'), ' ', dateText(req.updated),
          req.derived?.needsClarification && h('span', { className: 'pw-flag clarify', style: { marginLeft: 8 } }, t('flag_clarify')))) }),
  })
}

// 需求评审：按送审时间从早到晚；标题、送审时间、最近意见。
export function ReviewPage({ wb }) {
  const { t, requirements, navigate } = wb
  const query = (wb.nav.filters.review ?? {}).query ?? ''
  const items = reviewItems(requirements, query)
  return h(ListPage, {
    wb, page: 'review', items,
    emptyText: t('reviewEmpty'),
    emptyAction: h('button', { className: 'pw-button', style: { marginLeft: 8 }, onClick: () => navigate('board') }, t('locateBoard')),
    renderRow: req => {
      const latest = reviewRecords(req.reviews).find(r => r.kind === 'review')
      return h(Row, { req, page: 'review', wb, key: req.id,
        meta: h(React.Fragment, null,
          h('span', { className: 'pw-count' }, t('submittedAt'), ' ', dateText(req.submittedAt)),
          h('span', { className: 'pw-preview pw-note' }, latest?.opinion?.trim() || t('noOpinion'))) })
    },
  })
}

// 待开发：顺序、标题、评审通过时间；上移下移保留顺序，实质修改在详情确认重审。
export function ReadyPage({ wb }) {
  const { t, requirements, navigate, reorder } = wb
  const query = (wb.nav.filters.ready ?? {}).query ?? ''
  const items = readyItems(requirements, query)
  return h(ListPage, {
    wb, page: 'ready', items,
    emptyText: t('readyEmpty'),
    emptyAction: h('button', { className: 'pw-button', style: { marginLeft: 8 }, onClick: () => navigate('board') }, t('locateBoard')),
    renderRow: (req, index) => h(Row, { req, page: 'ready', wb, key: req.id,
      meta: h('span', { className: 'pw-count' }, t('reviewedAt'), ' ', dateText(req.reviewedAt)),
      actions: h('span', { className: 'pw-order' },
        h('button', { className: 'pw-orderbtn', disabled: index === 0, 'aria-label': t('moveUp'), title: t('moveUp'), onClick: () => reorder('requirement', null, items, req.id, 'up') }, '↑'),
        h('button', { className: 'pw-orderbtn', disabled: index === items.length - 1, 'aria-label': t('moveDown'), title: t('moveDown'), onClick: () => reorder('requirement', null, items, req.id, 'down') }, '↓')) }),
  })
}
