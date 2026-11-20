import React from 'react'
import { pendingItems, recordItems } from '../shell/nav-state.js'
import { requirementResult, reviewRecords } from '../workbench-content.js'
import { ListPage, boardLocator, dateText, firstLine, listTitle } from '../shared/list.js'

const h = React.createElement

export function PendingPage({ wb }) {
  const { t, requirements, navigate, openDetail } = wb
  const items = pendingItems(requirements, wb.nav.filters.pending?.query)
  return h(ListPage, {
    wb, page: 'pending', title: t('navPending'), items,
    columns: [t('listRequirement'), t('listDelivery'), t('listAttention'), t('listActions')],
    emptyText: t('pendingEmpty'),
    emptyAction: h('button', { type: 'button', className: 'pw-button', onClick: () => navigate('board') }, t('locateBoard')),
    renderRow: req => {
      const result = requirementResult(req)
      const d = req.derived ?? {}
      const returned = reviewRecords(req.reviews).some(record => record.kind === 'acceptance' && record.decision === 'returned')
      return {
        key: req.id,
        cells: [
          h(React.Fragment, null,
            listTitle(req.title, req.id, () => openDetail({ reqId: req.id, issueId: null }, 'pending')),
            dateText(req.updated) && h('span', { className: 'pw-list-parent pw-list-value' }, t('submittedAt'), ' ', dateText(req.updated))),
          h('span', { className: 'pw-list-preview' }, firstLine(result.summary) || t('missingDeliverySummary')),
          h('div', { className: 'pw-list-alerts' },
            !result.summary && result.previousSummary && h('span', { className: 'pw-list-muted' }, t('previousResult')),
            d.cancelledCount > 0 && h('span', { className: 'pw-list-muted' }, t('cancelledCount').replace('{n}', String(d.cancelledCount))),
            returned && h('span', { className: 'pw-istatus st-blocked' }, t('wasReturned')),
            h('span', { className: 'pw-list-muted' }, t('taskCount')
              .replace('{total}', String((req.issues ?? []).length)).replace('{done}', String(d.doneCount ?? 0)))),
          boardLocator(wb, req),
        ],
      }
    },
  })
}

export function RecordsPage({ wb }) {
  const { t, requirements, openDetail, setFilter } = wb
  const { query = '', decision = '' } = wb.nav.filters.records ?? {}
  const items = recordItems(requirements, { query, decision })
  return h(ListPage, {
    wb, page: 'records', title: t('navRecords'), items, hasActions: false,
    columns: [t('listRequirement'), t('recordDecision'), t('decisionAt'), t('listOpinion')],
    toolbar: h('select', { className: 'pw-select', value: decision, 'aria-label': t('recordDecision'), onChange: e => setFilter('records', { decision: e.target.value }) },
      h('option', { value: '' }, t('allDecisions')),
      h('option', { value: 'approved' }, t('deliveryAccepted')),
      h('option', { value: 'returned' }, t('deliveryReturned'))),
    filtersActive: !!decision,
    onClear: () => setFilter('records', { query: '', decision: '' }),
    emptyText: t('recordsEmpty'),
    renderRow: record => {
      const identity = record.marker || record.round || JSON.stringify([record.at, record.decision, record.opinion, record.summary])
      const key = record.reqId + '|' + identity
      const approved = record.decision === 'approved'
      return {
        key,
        cells: [
          listTitle(record.reqTitle, key, () => openDetail({ record: { reqId: record.reqId, marker: record.marker, round: record.round } }, 'records')),
          h('span', { className: 'pw-istatus ' + (approved ? 'st-done' : 'st-blocked') }, t(approved ? 'deliveryAccepted' : 'deliveryReturned')),
          h('span', { className: 'pw-list-muted pw-list-value' }, dateText(record.at) || '—'),
          h('span', { className: 'pw-list-preview' }, firstLine(record.opinion || record.summary) || t('noOpinion')),
        ],
      }
    },
  })
}
