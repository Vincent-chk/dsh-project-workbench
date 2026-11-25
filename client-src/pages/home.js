import React from 'react'
import { homeSummaryIncomplete, waitParts } from '../shell/nav-state.js'
import { ErrorDetails } from '../shared/ui.js'
import { shortBlocker } from '../workbench-content.js'

const h = React.createElement

// 首页只有两块：需要你处理 + 项目进展（PRD §7.3）。提醒含对象、所属需求、
// 原因、等待时间；同一任务合并；所有入口只定位，不直接通过或启动。
const REMINDER_ACTION = {
  blocked: { label: 'homeGoHandle', target: 'task' },
  awaitingAuth: { label: 'homeGoHandle', target: 'session' },
  inReview: { label: 'homeGoConfirm', target: 'session' },
  pending: { label: 'homeGoAccept', target: 'delivery' },
  reviewing: { label: 'homeGoReview', target: 'requirement' },
  ready: { label: 'homeViewPlan', target: 'requirement' },
}
const COUNT_PAGES = [
  { key: 'reviewing', page: 'review', label: 'col_reviewing' },
  { key: 'ready', page: 'ready', label: 'col_ready' },
  { key: 'in_progress', page: 'dev', label: 'col_in_progress' },
  { key: 'pending', page: 'pending', label: 'col_pending' },
  { key: 'blocked', page: 'blocked', label: 'homeBlockedTasks' },
]

export function HomePage({ wb }) {
  const { t, home, homeError, runError, requirements, refreshHome, setModal, navigate, openDetail, openTaskSession, awaitingAuthSessions } = wb
  if (homeError && !home) {
    return h('div', { className: 'pw-init' },
      h('h2', null, t('readFailedTitle')),
      h(ErrorDetails, { error: homeError, t, showRaw: false }),
      h('button', { className: 'pw-button primary', onClick: refreshHome }, t('retry')))
  }
  if (!home) return h('div', { className: 'pw-init' }, h('p', null, t('loading')))
  const go = item => {
    const action = REMINDER_ACTION[item.kind] ?? REMINDER_ACTION.blocked
    if (item.kind === 'awaitingAuth' || item.kinds?.includes('awaitingAuth')) {
      const sessionId = awaitingAuthSessions?.get(item.issueId)
      return sessionId ? openTaskSession(item.issueId, sessionId) : refreshHome()
    }
    if (action.target === 'session') return openTaskSession(item.issueId)
    if (action.target === 'task') return openDetail({ reqId: item.reqId, issueId: item.issueId }, 'dev')
    if (action.target === 'delivery') return openDetail({ reqId: item.reqId, issueId: null }, 'pending')
    return openDetail({ reqId: item.reqId, issueId: null }, item.kind === 'reviewing' ? 'review' : 'ready')
  }
  const reminders = home.reminders ?? []
  const counts = home.counts ?? {}
  const incomplete = homeSummaryIncomplete(home, homeError)
  return h('div', { className: 'pw-home' },
    h('section', { className: 'pw-subpage', 'aria-label': t('homeNeedsYou') },
      h('h2', { className: 'pw-home-title' }, t('homeNeedsYou')),
      incomplete && h('div', { className: 'pw-banner pw-warn', role: 'status' },
        h('span', null, t(runError ? 'runFactsUnavailable' : 'homeIncomplete')),
        h('button', { className: 'pw-button', onClick: refreshHome }, t('retryRead'))),
      home.authRefreshing && h('div', { className: 'pw-banner pw-warn', role: 'status' },
        h('span', null, t('authRemindersRefreshing')),
        h('button', { className: 'pw-button', onClick: refreshHome }, t('retryRead'))),
      reminders.length === 0
        ? !incomplete && !home.authRefreshing && h('p', { className: 'pw-note' }, requirements.length === 0 ? t('homeFirstRequirement') : t('homeNothing'))
        : h('div', { className: 'pw-home-list' }, reminders.map(item => {
          const wait = item.waitingSince == null ? null : waitParts(item.waitingSince)
          const hasAuth = item.kind === 'awaitingAuth' || item.kinds?.includes('awaitingAuth')
          let waitText = wait ? t(wait.key).replace('{n}', String(wait.n)) : t('waitUnknown')
          if (!wait && hasAuth) {
            const key = item.kinds?.includes('blocked') ? 'blockedAndAuthWaitUnknown'
              : item.kinds?.includes('inReview') ? 'confirmationAndAuthWaitUnknown' : 'authWaitUnknown'
            waitText = t(key)
          }
          if (wait && hasAuth) {
            const authWait = item.authWaitingSince == null ? null : waitParts(item.authWaitingSince)
            const authText = authWait ? t(authWait.key).replace('{n}', String(authWait.n)) : null
            if (item.waitingKind === 'blocked') waitText = authText
              ? t('blockedWaitWithAuth').replace('{wait}', waitText).replace('{auth}', authText)
              : t('blockedWaitWithUnknownAuth').replace('{wait}', waitText)
            else if (item.waitingKind === 'inReview') waitText = authText
              ? t('confirmationWaitWithAuth').replace('{wait}', waitText).replace('{auth}', authText)
              : t('confirmationWaitWithUnknownAuth').replace('{wait}', waitText)
            else if (item.waitingKind === 'awaitingAuth' && authText) waitText = t('authRequestWait').replace('{wait}', authText)
          }
          const action = REMINDER_ACTION[item.kind] ?? REMINDER_ACTION.blocked
          const blocker = item.kinds?.includes('blocked')
          const reason = blocker ? shortBlocker(item.reasons?.[0]) || t('listBlockerInTask') : null
          return h('div', { key: (item.issueId ?? item.reqId) + '|' + item.kind, className: 'pw-home-item' },
            h('div', { className: 'pw-home-copy' },
              h('strong', { className: 'pw-preview' }, item.title),
              reason && h('span', { className: 'pw-list-preview' }, reason)),
            h('span', { className: 'pw-note pw-home-wait' }, waitText),
            h('button', { className: 'pw-button', onClick: () => go(item) }, t(action.label)))
        })),
      !incomplete && requirements.length === 0 && h('button', { className: 'pw-button primary', onClick: () => setModal({ kind: 'createRequirement' }) }, t('newRequirement'))),
    h('section', { className: 'pw-subpage', 'aria-label': t('homeProgress') },
      h('h2', { className: 'pw-home-title' }, t('homeProgress')),
      h('div', { className: 'pw-home-counts' }, COUNT_PAGES.map(({ key, page, label }) =>
        h('button', { key, className: 'pw-home-count', onClick: () => navigate(page) },
          h('strong', null, incomplete ? '—' : String(counts[key] ?? 0)),
          h('span', null, t(label)))))))
}
