import React from 'react'
import { pendingItems, recordItems } from '../shell/nav-state.js'
import { requirementResult, reviewRecords, shortRecordedText, taskResult } from '../workbench-content.js'
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
      const tasks = (req.issues ?? []).filter(task => task.status !== 'cancelled')
      const confirmed = tasks.filter(task => task.status === 'done')
      const titles = confirmed.map(task => shortRecordedText(task.title, 45)).filter(Boolean)
      const taskNames = titles.length === confirmed.length && titles.length <= 3
        ? shortRecordedText(titles.join(t('fieldSeparator')))
        : ''
      const needsChecking = tasks.filter(task => {
        const current = taskResult(task, req.deliveryStartedAt)
        const verification = current.verification
        return current.limits || verification.failed > 0 || verification.incomplete > 0 || verification.unconfirmedChanges > 0
      }).length
      return {
        key: req.id,
        cells: [
          h(React.Fragment, null,
            listTitle(req.title, req.id, () => openDetail({ reqId: req.id, issueId: null }, 'pending')),
            dateText(req.updated) && h('span', { className: 'pw-list-parent pw-list-value' }, t('submittedAt'), ' ', dateText(req.updated))),
          h('span', { className: 'pw-list-preview' }, result.summary
            ? shortRecordedText(result.summary) || taskNames || t('listDeliveryReady')
            : t('missingDeliverySummary')),
          h('div', { className: 'pw-list-alerts' },
            !result.summary && result.previousSummary && h('span', { className: 'pw-list-muted' }, t('previousResult')),
            h('span', { className: 'pw-list-muted pw-list-value' }, t('listDeliveryConfirmed')
              .replace('{total}', String(tasks.length)).replace('{done}', String(confirmed.length))),
            needsChecking > 0 && h('span', { className: 'pw-istatus st-in_review' },
              t('listDeliveryNeedsChecking').replace('{n}', String(needsChecking))),
            d.cancelledCount > 0 && h('span', { className: 'pw-list-muted' }, t('cancelledCount').replace('{n}', String(d.cancelledCount))),
            returned && h('span', { className: 'pw-istatus st-blocked' }, t('wasReturned'))),
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
          h('span', { className: 'pw-list-preview' }, firstLine(record.opinion) || '—'),
        ],
      }
    },
  })
}
