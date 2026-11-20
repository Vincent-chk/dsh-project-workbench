import React from 'react'
import { reviewRecords } from '../workbench-content.js'
import { ReadingText } from './task-content.js'
import { DeliveryResult, RequirementDecisionRecords } from './requirement-content.js'

const h = React.createElement

// 本轮验收详情复用看板的状态变更流程，保留确认与冲突保护。
export function RequirementDelivery({ req, t, onMove, busy = false }) {
  const records = reviewRecords(req.reviews).filter(record => record.kind === 'acceptance')
  const recovering = !!req.pendingReopen
  const pending = req.status === 'pending'
  const completed = req.status === 'completed'
  const hasDelivery = pending || completed || req.deliverySummary?.trim() || req.cancelImpact?.trim()
  return h('div', { className: 'pw-reading' },
    onMove && (recovering || pending || completed) && h('div', { className: 'pw-actions' },
      recovering && h('button', { className: 'pw-button primary', disabled: busy, onClick: () => onMove(req, completed ? 'in_progress' : 'completed') }, t('resumeReopen')),
      !recovering && pending && h('button', { className: 'pw-button primary', disabled: busy, onClick: () => onMove(req, 'completed') }, t('acceptRequirement')),
      !recovering && (pending || completed) && h('button', { className: 'pw-button', disabled: busy, onClick: () => onMove(req, 'in_progress') }, t(completed ? 'reopen' : 'sendBack'))),
    hasDelivery && h(DeliveryResult, { req, t, userFacing: true }),
    !hasDelivery && !records.length && h('p', { className: 'pw-note' }, t('noRequirementDelivery')),
    h(RequirementDecisionRecords, { records, group: 'delivery', t }))
}

export { RequirementDelivery as DeliveryDetail }

// 验收记录详情：只读的决定、当时意见与一段交付摘要；入口指向当前需求。
export function RecordDetail({ record, req, t, onOpenRequirement }) {
  return h('section', { className: 'pw-subpage pw-read-card', 'aria-label': t('recordDetail') },
    h('header', { className: 'pw-subpage-head' },
      h('div', { className: 'pw-read-title' }, h('h2', null, record.reqTitle),
        h('span', { className: 'pw-count pw-read-status', 'data-status': record.decision === 'approved' ? 'completed' : 'in_progress' },
          t(record.decision === 'approved' ? 'deliveryAccepted' : 'deliveryReturned'))),
      h('div', { className: 'pw-actions' },
        req
          ? h('button', { className: 'pw-button', onClick: () => onOpenRequirement(req) }, t('jumpToRequirement'))
          : h('span', { className: 'pw-note' }, t('errMissing')))),
    h('div', { className: 'pw-reading' },
      record.at && h('p', { className: 'pw-note' }, t('decisionAt'), ' ', String(record.at).replace('T', ' ').slice(0, 16)),
      h(ReadingText, { label: t('reviewOpinion'), value: record.opinion || t('noOpinion') }),
      h(ReadingText, { label: t('demoDeliverySummary'), value: record.summary || t('missingDeliverySummary') }),
      h('p', { className: 'pw-note' }, t('recordReadonlyHint'))))
}
