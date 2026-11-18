import React from 'react'
import { pendingItems, recordItems } from '../shell/nav-state.js'
import { requirementResult, reviewRecords } from '../workbench-content.js'
import { ListPage, dateText } from '../shared/list.js'

const h = React.createElement

// 待验收：标题、交付结论预览、完成与取消数、提交时间和打回情况；
// 点击阅读本轮验收详情，通过或打回在看板发起（PRD §7.6）。
export function PendingPage({ wb }) {
  const { t, requirements, navigate, openDetail } = wb
  const query = (wb.nav.filters.pending ?? {}).query ?? ''
  const items = pendingItems(requirements, query)
  return h(ListPage, {
    wb, page: 'pending', items,
    emptyText: t('pendingEmpty'),
    emptyAction: h('button', { className: 'pw-button', style: { marginLeft: 8 }, onClick: () => navigate('board') }, t('locateBoard')),
    renderRow: req => {
      const result = requirementResult(req)
      const d = req.derived ?? {}
      const returned = reviewRecords(req.reviews).find(r => r.kind === 'acceptance' && r.decision === 'returned')
      return h('div', { className: 'pw-row', key: req.id },
        h('button', { className: 'pw-row-main', onClick: () => openDetail({ reqId: req.id, issueId: null }, 'pending'), title: req.title },
          h('strong', { className: 'pw-preview' }, req.title),
          h('span', { className: 'pw-preview pw-note' }, (result.summary || result.previousSummary).split(/\r?\n/)[0] || t('missingDeliverySummary')),
          h('span', { className: 'pw-count' },
            t('taskCount').replace('{total}', String((req.issues ?? []).length)).replace('{done}', String(d.doneCount ?? 0)),
            d.cancelledCount > 0 && ' · ' + t('cancelledCount').replace('{n}', String(d.cancelledCount)),
            ' · ', t('submittedAt'), ' ', dateText(req.updated),
            returned && ' · ' + t('wasReturned'))),
        h('div', { className: 'pw-row-actions' },
          h('button', { className: 'pw-button pw-quiet', onClick: () => wb.locateBoard(req) }, t('locateBoard'))))
    },
  })
}

// 验收记录：每行一个决定；支持查找与筛选；只读详情（PRD §7.6）。
export function RecordsPage({ wb }) {
  const { t, requirements, openDetail, setFilter } = wb
  const filters = wb.nav.filters.records ?? {}
  const query = filters.query ?? ''
  const decision = filters.decision ?? ''
  const items = recordItems(requirements, { query, decision })
  return h(ListPage, {
    wb, page: 'records', items,
    toolbar: h('select', { className: 'pw-select', value: decision, 'aria-label': t('recordDecision'), onChange: e => setFilter('records', { decision: e.target.value }) },
      h('option', { value: '' }, t('allDecisions')),
      h('option', { value: 'approved' }, t('deliveryAccepted')),
      h('option', { value: 'returned' }, t('deliveryReturned'))),
    emptyText: t('recordsEmpty'),
    renderRow: record => h('div', { className: 'pw-row', key: record.reqId + '|' + (record.marker || record.round) },
      h('button', { className: 'pw-row-main', onClick: () => openDetail({ record: { reqId: record.reqId, marker: record.marker, round: record.round } }, 'records'), title: record.reqTitle },
        h('strong', { className: 'pw-preview' }, record.reqTitle),
        h('span', { className: 'pw-count' },
          dateText(record.at), ' · ', t(record.decision === 'approved' ? 'deliveryAccepted' : 'deliveryReturned')),
        h('span', { className: 'pw-preview pw-note' }, (record.opinion || record.summary || '').split(/\r?\n/)[0] || t('noOpinion'))),
      h('div', { className: 'pw-row-actions' },
        h('span', { className: 'pw-istatus ' + (record.decision === 'approved' ? 'st-done' : 'st-blocked') },
          t(record.decision === 'approved' ? 'deliveryAccepted' : 'deliveryReturned')))),
  })
}
