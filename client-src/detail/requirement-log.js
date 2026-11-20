import React from 'react'
import { dateText } from '../shared/list.js'

const h = React.createElement

export const requirementLogLocale = {
  en: {
    requirementLog: 'Activity log',
    requirementLogEmpty: 'No activity has been recorded yet.',
    requirementLogUnknownTime: 'Time not recorded',
    requirementLogCreated: 'Requirement created',
    requirementLogSubmitted: 'Sent for review',
    requirementLogDevelopmentStarted: 'Development started',
    requirementLogDeliverySubmitted: 'Submitted for acceptance',
    requirementLogReopened: 'Requirement reopened',
    requirementLogReportSaved: 'AI review {n} saved',
    requirementLogTaskCreated: 'Task “{title}” created',
    requirementLogTaskMoved: 'Task “{title}” · {move}',
  },
  zh: {
    requirementLog: '日志',
    requirementLogEmpty: '暂无动态。',
    requirementLogUnknownTime: '时间未记录',
    requirementLogCreated: '已创建需求',
    requirementLogSubmitted: '已送审',
    requirementLogDevelopmentStarted: '已开始开发',
    requirementLogDeliverySubmitted: '已提交验收',
    requirementLogReopened: '已重开需求',
    requirementLogReportSaved: '第 {n} 次 AI 评审报告已保存',
    requirementLogTaskCreated: '已创建任务「{title}」',
    requirementLogTaskMoved: '任务「{title}」 · {move}',
  },
}

export function RequirementLog({ entries, t, onOpenReport, onOpenReview, onOpenAcceptance, onOpenIssue }) {
  if (!entries.length) return h('p', { className: 'pw-note' }, t('requirementLogEmpty'))
  const open = { report: onOpenReport, review: onOpenReview, acceptance: onOpenAcceptance, issue: onOpenIssue }
  return h('ul', { className: 'pw-update-list', 'aria-label': t('requirementLog'), style: { padding: 0 } }, entries.map(({ key, at, summary, target }) => {
    const onOpen = target && open[target.kind]
    return h('li', { className: 'pw-update', key },
      at ? h('time', { className: 'pw-update-ts', dateTime: at, title: at }, dateText(at))
        : h('span', { className: 'pw-update-ts' }, t('requirementLogUnknownTime')),
      onOpen ? h('button', { type: 'button', className: 'pw-button pw-quiet pw-update-body', style: { textAlign: 'start' }, onClick: () => onOpen(target.id) }, summary)
        : h('span', { className: 'pw-update-body' }, summary))
  }))
}
