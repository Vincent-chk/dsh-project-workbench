import React from 'react'
import { devItems, blockedItems, failureItems, riskItems } from '../shell/nav-state.js'
import { ListPage, boardLocator, dateText, listTable, listTitle, useListScroll } from '../shared/list.js'

const h = React.createElement

// 待验收和取消都不计成已完成。取消任务不占有效任务数。
export function DevPage({ wb }) {
  const { t, requirements, navigate, openDetail } = wb
  const items = devItems(requirements, wb.nav.filters.dev?.query)
  return h(ListPage, {
    wb, page: 'dev', title: t('navDev'), items,
    columns: [t('listRequirement'), t('listEffectiveProgress'), t('listAttention'), t('listActions')],
    emptyText: t('devEmpty'),
    emptyAction: h('button', { type: 'button', className: 'pw-button', onClick: () => navigate('board') }, t('locateBoard')),
    renderRow: req => {
      const { progress, doneCount = 0, cancelledCount = 0, blockedCount = 0, inReviewCount = 0 } = req.derived ?? {}
      const activeCount = (req.issues ?? []).length - cancelledCount
      return {
        key: req.id,
        cells: [
          listTitle(req.title, req.id, () => openDetail({ reqId: req.id, issueId: null }, 'dev')),
          activeCount > 0
            ? h('span', { className: 'pw-list-value', title: progress == null ? undefined : Math.round(progress * 100) + '%' },
              h('strong', null, doneCount), ' / ', activeCount)
            : h('span', { className: 'pw-list-muted' }, t('noProgress')),
          h('div', { className: 'pw-list-alerts' },
            blockedCount > 0 && h('span', { className: 'pw-istatus st-blocked' }, t('devBlocked').replace('{n}', String(blockedCount))),
            inReviewCount > 0 && h('span', { className: 'pw-istatus st-in_review' }, t('devInReview').replace('{n}', String(inReviewCount))),
            (cancelledCount > 0 || (!blockedCount && !inReviewCount)) && h('span', { className: 'pw-list-muted' },
              cancelledCount > 0 ? t('cancelledCount').replace('{n}', String(cancelledCount)) : t('listNoAlerts'))),
          boardLocator(wb, req),
        ],
      }
    },
  })
}

// 阻塞与风险：现有阻塞、待授权、执行失败和有依据的 AI 风险；不另建风险台账。
export function BlockedPage({ wb }) {
  const { t, requirements, runFacts, runError, refreshBlocked, awaitingAuthSessions, authDetails, blocked, openDetail, openTaskSession, locateBoard, locateTask, setFilter, navigate } = wb
  const filters = wb.nav.filters.blocked ?? {}
  const query = filters.query ?? ''
  const reqId = filters.reqId ?? ''
  const blockedList = blockedItems(requirements, { query, reqId })
  const authList = (runFacts ?? []).filter(f => awaitingAuthSessions.has(f.issueId)).map(f => {
    const req = requirements.find(r => r.id === f.reqId)
    const issue = req?.issues?.find(i => i.id === f.issueId)
    return issue ? { reqId: req.id, issueId: issue.id, title: issue.title, reqTitle: req.title, sessionId: awaitingAuthSessions.get(f.issueId) } : null
  }).filter(Boolean).filter(item => (!reqId || item.reqId === reqId) && (!query || item.title.toLowerCase().includes(query.toLowerCase())))
  const failures = failureItems(requirements).filter(item => (!reqId || item.reqId === reqId) && (!query || item.title.toLowerCase().includes(query.toLowerCase())))
  const deliveryFailed = (blocked?.deliveryFailed ?? []).filter(item => (!reqId || item.reqId === reqId) && (!query || item.title.toLowerCase().includes(query.toLowerCase())))
  const risks = riskItems(blocked?.proposals).filter(p => {
    const req = requirements.find(r => r.id === p.target?.reqId)
    if (!req || (reqId && req.id !== reqId)) return false
    const issue = req.issues?.find(i => i.id === p.target?.issueId)
    const title = issue?.title ?? req.title
    return !query || title.toLowerCase().includes(query.toLowerCase())
  })
  const total = blockedList.length + authList.length + failures.length + deliveryFailed.length + risks.length
  const item = (key, title, reqTitle, reason, at, actions) => ({
    key,
    cells: [
      h(React.Fragment, null, h('strong', { className: 'pw-list-name' }, title),
        reqTitle && reqTitle !== title && h('span', { className: 'pw-list-parent' }, reqTitle)),
      h('div', null, reason, at ? h('time', { className: 'pw-list-parent', dateTime: new Date(at).toISOString() },
        dateText(new Date(at).toISOString())) : null),
      actions,
    ],
  })
  const scroll = useListScroll(wb, 'blocked')
  const section = (label, rows) => h('section', { className: 'pw-list-risk' },
    h('h3', null, label),
    Array.isArray(rows) ? listTable([t('listTask'), t('listReason'), t('listActions')], rows, label) : rows)
  return h('section', { ...scroll, className: 'pw-list pw-list-catalog' },
    h('header', { className: 'pw-list-header' }, h('h2', null, t('navBlocked'))),
    h('div', { className: 'pw-list-toolbar' },
      h('input', { type: 'search', className: 'pw-input pw-list-search', placeholder: t('search'), value: query, 'aria-label': t('search'), onChange: e => setFilter('blocked', { query: e.target.value }) }),
      h('select', { className: 'pw-select', value: reqId, 'aria-label': t('parentRequirement'), onChange: e => setFilter('blocked', { reqId: e.target.value }) },
        h('option', { value: '' }, t('allRequirements')),
        requirements.map(r => h('option', { key: r.id, value: r.id }, r.title))),
      (query || reqId) && h('button', { className: 'pw-button pw-quiet', onClick: () => setFilter('blocked', { query: '', reqId: '' }) }, t('clearFilter'))),
    runError && h('div', { className: 'pw-banner pw-warn', role: 'status' },
      h('span', null, t('runFactsUnavailable')),
      h('button', { className: 'pw-button', onClick: refreshBlocked }, t('retryRead'))),
    !runError && runFacts == null && h('p', { className: 'pw-note', role: 'status' }, t('loading')),
    total === 0 && !runError && runFacts != null && h('div', { className: 'pw-empty' }, query || reqId ? t('noResults') : t('blockedEmpty')),
    authList.length > 0 && section(t('authSection'), authList.map(a =>
      item('a' + a.issueId, a.title, a.reqTitle, t('runWaiting') + ' · ' + (() => {
        const at = authDetails?.get(a.issueId)?.askedAt
        if (at == null) return t('authWaitUnknown')
        const date = new Date(at)
        const pad = value => String(value).padStart(2, '0')
        const when = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
        return t('authRequestWait').replace('{wait}', when)
      })(), null,
        h('button', { className: 'pw-button', onClick: () => openTaskSession(a.issueId, a.sessionId) }, t('goAuthorize'))))),
    (failures.length > 0 || deliveryFailed.length > 0) && section(t('failureSection'), [
      ...failures.map(f => item('f' + f.issueId, f.title, f.reqTitle, t('checksFailed').replace('{n}', String(f.failed)), f.at,
        h('button', { className: 'pw-button', onClick: () => openDetail({ reqId: f.reqId, issueId: f.issueId }, 'dev') }, t('viewFailureReason')))),
      ...deliveryFailed.map(d => item('d' + d.reqId, d.title, t('requirementDelivery'), t('demoDeliveryFailed'), d.at,
        h('button', { className: 'pw-button', onClick: () => openDetail({ reqId: d.reqId, issueId: null }, 'dev') }, t('viewOriginalTask')))),
    ]),
    blockedList.length > 0 && section(t('blockedSection'), blockedList.map(b =>
      item('b' + b.issueId, b.title, b.reqTitle, b.reason || t('taskNoReason'), b.at,
        h('button', { className: 'pw-button', onClick: () => openDetail({ reqId: b.reqId, issueId: b.issueId }, 'dev') }, t('viewOriginalTask'))))),
    blocked?.proposals == null
      ? section(t('riskSection'), h('p', { className: 'pw-note' }, t('loading')))
      : risks.length > 0 && section(t('riskSection'), risks.map(p => {
        const req = requirements.find(r => r.id === p.target.reqId)
        const issue = req?.issues?.find(i => i.id === p.target.issueId)
        return item('r' + p.id, issue?.title ?? req.title, req.title, p.reason, Date.parse(p.createdAt) || 0,
          h('button', { className: 'pw-button', onClick: () => issue ? locateTask(req.id, issue.id) : locateBoard(req) },
            t(issue ? 'syncLocateTask' : 'syncLocateRequirement')))
      })))
}
