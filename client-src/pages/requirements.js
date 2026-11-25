import React from 'react'
import { requirementOverview } from '../../core/state.js'
import { poolItems, reviewItems, readyItems } from '../shell/nav-state.js'
import { rpc } from '../api.js'
import { ListPage, boardLocator, dateText, firstLine, listTitle } from '../shared/list.js'

const h = React.createElement

const openRequirement = (wb, req, page) => listTitle(req.title, req.id, () => wb.openDetail({ reqId: req.id, issueId: null }, page))
const date = value => h('span', { className: 'pw-list-muted pw-list-value' }, dateText(value) || '—')

export function PoolPage({ wb }) {
  const { t, requirements, setModal } = wb
  const items = poolItems(requirements, wb.nav.filters.pool?.query)
  return h(ListPage, {
    wb, page: 'pool', title: t('navPool'), items,
    columns: [t('listRequirement'), t('requirementOverview'), t('updated'), t('listActions')],
    toolbar: h('button', { type: 'button', className: 'pw-button primary', onClick: () => setModal({ kind: 'createRequirement' }) }, t('newRequirement')),
    emptyText: t('homeFirstRequirement'),
    renderRow: req => ({
      key: req.id,
      cells: [
        h(React.Fragment, null, openRequirement(wb, req, 'pool'),
          req.derived?.needsClarification && h('span', { className: 'pw-flag clarify pw-list-parent' }, t('flag_clarify'))),
        h('span', { className: 'pw-list-preview' },
          firstLine(requirementOverview(req)) || t('requirementMissing').replace('{fields}', t('requirementOverview'))),
        date(req.updated),
        boardLocator(wb, req),
      ],
    }),
  })
}

export function ReviewPage({ wb }) {
  const { t, requirements, navigate, projectKey, root } = wb
  const [snapshot, setSnapshot] = React.useState(null)
  const items = reviewItems(requirements, wb.nav.filters.review?.query)
  const idKey = JSON.stringify(items.map(item => item.id))
  const rows = snapshot?.root === root && snapshot?.projectKey === projectKey && snapshot?.requirements === requirements
    && snapshot?.idKey === idKey ? snapshot.rows : null
  React.useEffect(() => {
    const ids = JSON.parse(idKey)
    if (!root || ids.length === 0) return
    let active = true
    let loading = false
    const load = async () => {
      if (loading || document.hidden) return
      loading = true
      const response = await rpc('requirement/review/statuses', { root, ids })
      loading = false
      if (active) setSnapshot({
        root, projectKey, requirements, idKey,
        rows: new Map((response?.ok ? response.data : []).map(row => [row.id, row])),
      })
    }
    load()
    const timer = setInterval(load, 8000)
    document.addEventListener('visibilitychange', load)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [root, projectKey, requirements, idKey])
  const labelFor = row => {
    if (!rows) return 'loading'
    if (!row || row.unavailable || row.stage !== 'reviewing' || row.reportsUnavailable || row.prdsUnavailable) return 'listReviewUnavailable'
    if (row.missingPreparation.length) return 'listReviewMissing'
    if (row.state === 'running') return 'listReviewRunning'
    if (row.state === 'failed' || row.state === 'save_failed') return 'listReviewRetry'
    if (row.stale) return 'listReviewStale'
    return row.hasReview ? 'listReviewDecision' : 'listReviewPending'
  }
  return h(ListPage, {
    wb, page: 'review', title: t('navReview'), items,
    columns: [t('listRequirement'), t('submittedAt'), t('listCurrentReview'), t('listActions')],
    emptyText: t('reviewEmpty'),
    emptyAction: h('button', { type: 'button', className: 'pw-button', onClick: () => navigate('board') }, t('locateBoard')),
    renderRow: req => ({
      key: req.id,
      cells: [
        openRequirement(wb, req, 'review'),
        date(req.submittedAt),
        h('span', { className: 'pw-list-muted' }, t(labelFor(rows?.get(req.id)))),
        boardLocator(wb, req),
      ],
    }),
  })
}

export function ReadyPage({ wb }) {
  const { t, requirements, navigate, reorder, projectKey, saving } = wb
  const [sortProject, setSortProject] = React.useState(null)
  const sorting = sortProject === projectKey
  const order = readyItems(requirements)
  const query = wb.nav.filters.ready?.query
  const items = query ? readyItems(requirements, query) : order
  const positions = new Map(order.map((req, index) => [req.id, index]))
  return h(ListPage, {
    wb, page: 'ready', title: t('navReady'), items,
    columns: [t('listRequirement'), t('listPriority'), t('reviewedAt'), t('listActions')],
    toolbar: order.length > 1 && h('button', { type: 'button', className: 'pw-button', 'aria-pressed': sorting,
      onClick: () => setSortProject(sorting ? null : projectKey) }, t(sorting ? 'listFinishReorder' : 'listReorder')),
    emptyText: t('readyEmpty'),
    emptyAction: h('button', { type: 'button', className: 'pw-button', onClick: () => navigate('board') }, t('locateBoard')),
    renderRow: req => {
      const index = positions.get(req.id)
      return {
        key: req.id,
        cells: [
          openRequirement(wb, req, 'ready'),
          h('span', { className: 'pw-list-value' }, index + 1),
          date(req.reviewedAt),
          h('div', { className: 'pw-list-actions' },
            sorting && h(React.Fragment, null,
              h('button', { type: 'button', className: 'pw-orderbtn', disabled: saving || index === 0,
                'aria-label': t('moveUp') + ' · ' + req.title, title: t('moveUp'),
                onClick: () => reorder('requirement', null, order, req.id, 'up') }, '↑'),
              h('button', { type: 'button', className: 'pw-orderbtn', disabled: saving || index === order.length - 1,
                'aria-label': t('moveDown') + ' · ' + req.title, title: t('moveDown'),
                onClick: () => reorder('requirement', null, order, req.id, 'down') }, '↓')),
            boardLocator(wb, req)),
        ],
      }
    },
  })
}
