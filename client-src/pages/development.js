import React from 'react'
import { devItems, blockedItems, failureItems, riskItems } from '../shell/nav-state.js'
import { activityEntry } from '../workbench-content.js'
import { ListPage, dateText } from '../shared/list.js'

const h = React.createElement

// 开发中：需求及任务概况、已完成/待验收/阻塞数量、最近进展；
// 进度 = 人工确认完成 / 未取消总数，待验收不计完成（PRD §7.5）。
export function DevPage({ wb }) {
  const { t, requirements, navigate, openDetail } = wb
  const query = (wb.nav.filters.dev ?? {}).query ?? ''
  const items = devItems(requirements, query)
  return h(ListPage, {
    wb, page: 'dev', items,
    emptyText: t('devEmpty'),
    emptyAction: h('button', { className: 'pw-button', style: { marginLeft: 8 }, onClick: () => navigate('board') }, t('locateBoard')),
    renderRow: req => {
      const d = req.derived ?? {}
      const total = (req.issues ?? []).length
      const pct = d.progress == null ? null : Math.round(d.progress * 100)
      const latest = latestOf(req, t)
      return h('div', { className: 'pw-row', key: req.id },
        h('button', { className: 'pw-row-main', onClick: () => openDetail({ reqId: req.id, issueId: null }, 'dev'), title: req.title },
          h('strong', { className: 'pw-preview' }, req.title),
          h('span', { className: 'pw-count' },
            t('taskCount').replace('{total}', String(total)).replace('{done}', String(d.doneCount ?? 0)),
            d.inReviewCount > 0 && ' · ' + t('devInReview').replace('{n}', String(d.inReviewCount)),
            d.blockedCount > 0 && ' · ' + t('devBlocked').replace('{n}', String(d.blockedCount)),
            d.cancelledCount > 0 && ' · ' + t('cancelledCount').replace('{n}', String(d.cancelledCount))),
          h('span', { className: 'pw-dev-progress' },
            pct === null
              ? h('span', { className: 'pw-count' }, t('noProgress'))
              : h('span', { className: 'pw-bar', title: `${pct}%` }, h('span', { style: { width: pct + '%' } })),
            latest && h('span', { className: 'pw-preview pw-note' }, latest)))
        ,
        h('div', { className: 'pw-row-actions' },
          h('button', { className: 'pw-button pw-quiet', onClick: () => wb.locateBoard(req) }, t('locateBoard'))))
    },
  })
}

function latestOf(req, t) {
  let best = null
  for (const line of req.activity ?? []) {
    const at = Date.parse(String(line).match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\S*/)?.[0] ?? '')
    if (Number.isFinite(at) && (!best || at > best.at)) best = { at, line, kind: 'requirement' }
  }
  for (const issue of req.issues ?? []) {
    for (const line of issue.activity ?? []) {
      const at = Date.parse(String(line).match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\S*/)?.[0] ?? '')
      if (Number.isFinite(at) && (!best || at > best.at)) best = { at, line, kind: 'issue' }
    }
  }
  return best ? activityEntry(best.line, t, best.kind).text : ''
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
  const item = (key, title, reqTitle, reason, at, actions) => h('div', { className: 'pw-row', key },
    h('div', { className: 'pw-row-main pw-row-static' },
      h('strong', { className: 'pw-preview' }, title),
      h('span', { className: 'pw-note' }, reqTitle, ' · ', reason),
      at ? h('span', { className: 'pw-count' }, dateText(new Date(at).toISOString())) : null),
    h('div', { className: 'pw-row-actions' }, actions))
  const section = (label, children) => h('section', { className: 'pw-subpage pw-blocked-section', 'aria-label': label },
    h('h3', { className: 'pw-home-title' }, label), children)
  return h('div', { className: 'pw-list' },
    h('div', { className: 'pw-list-toolbar' },
      h('input', { className: 'pw-input', style: { maxWidth: 220 }, placeholder: t('search'), value: query, 'aria-label': t('search'), onChange: e => setFilter('blocked', { query: e.target.value }) }),
      h('select', { className: 'pw-select', value: reqId, 'aria-label': t('parentRequirement'), onChange: e => setFilter('blocked', { reqId: e.target.value }) },
        h('option', { value: '' }, t('allRequirements')),
        requirements.map(r => h('option', { key: r.id, value: r.id }, r.title))),
      (query || reqId) && h('button', { className: 'pw-button pw-quiet', onClick: () => setFilter('blocked', { query: '', reqId: '' }) }, t('clearFilter'))),
    runError && h('div', { className: 'pw-banner pw-warn', role: 'status' },
      h('span', null, t('runFactsUnavailable')),
      h('button', { className: 'pw-button', onClick: refreshBlocked }, t('retryRead'))),
    !runError && runFacts == null && h('p', { className: 'pw-note', role: 'status' }, t('loading')),
    total === 0 && !runError && runFacts != null && h('div', { className: 'pw-empty' }, query || reqId ? t('noResults') : t('blockedEmpty')),
    blockedList.length > 0 && section(t('blockedSection'), blockedList.map(b =>
      item('b' + b.issueId, b.title, b.reqTitle, b.reason || t('taskNoReason'), b.at,
        h('button', { className: 'pw-button', onClick: () => openDetail({ reqId: b.reqId, issueId: b.issueId }, 'dev') }, t('viewOriginalTask'))))),
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
