import React from 'react'
import { aiReviewReports } from '../../core/state.js'
import { rpc } from '../api.js'
import { Disclosure, ErrorDetails, ReadText } from '../shared/ui.js'
import { dateText } from '../shared/list.js'

const h = React.createElement
const { useCallback, useEffect, useRef, useState } = React

export const requirementReviewLocale = {
  en: {
    aiReview: 'Start AI review', aiReviewUseSuggestion: 'Use AI suggestion', aiReviewMaterials: 'Review materials', aiReviewSavedMaterials: 'Snapshot used for review', aiReviewRecords: 'AI review reports', aiReviewAgain: 'Review again',
    aiReviewRound: 'Review {n}', aiReviewRunning: 'Review in progress', rejectRequirement: 'Return for edits',
    aiReviewFailed: 'The review did not finish. Try again.',
    aiReviewSaveFailed: 'The review finished. The report could not be saved.',
    aiReviewRetrySave: 'Retry saving', aiReviewStale: 'The last review used an earlier version of the materials.',
    aiReviewRequired: 'Complete an AI review of the current materials before approving.',
    aiReviewAt: 'Reviewed at', aiReviewRequirementVersion: 'Requirement version', aiReviewPrdVersion: 'PRD version',
    aiReviewNoPrd: 'No PRD was linked at the time of review.', aiReviewNoSource: 'This report has no version details.',
    aiReviewCannotApprove: 'Cannot approve yet', aiReviewMissing: 'Still needed: {items}.', aiReviewPrdMaterial: 'PRD with content',
    aiReviewReturnToPool: 'Return to pool to add materials', aiReviewReturnReason: 'Add missing review materials: {items}.',
    aiReviewReturnConfirm: 'Return to pool', aiReviewWaitingDecision: 'Ready for a human decision',
    aiReviewOpen: 'Open this review report', aiReviewOpenHistorical: 'Open report',
    aiReviewReport: 'AI review report', aiReviewEarlierMaterials: 'Uses earlier materials', aiReviewReportSaved: 'Report saved',
    aiReviewBack: 'Back to requirement', aiReviewFailureDetails: 'View read or review error',
    aiReviewNewMaterials: 'Current materials need a new review', aiReviewAiAdvice: 'AI recommendation',
    aiReviewProceed: 'Proceed', aiReviewReduceScope: 'Reduce scope', aiReviewVerifyFirst: 'Verify first', aiReviewHold: 'Hold',
  },
  zh: {
    aiReview: '开始 AI 评审', aiReviewUseSuggestion: '带入 AI 意见', aiReviewMaterials: '本轮评审材料', aiReviewSavedMaterials: '查看本轮材料快照', aiReviewRecords: 'AI 评审记录', aiReviewAgain: '再次评审',
    aiReviewRound: '第 {n} 次评审', aiReviewRunning: '正在评审', rejectRequirement: '退回修改',
    aiReviewFailed: '评审未完成，可以重试。',
    aiReviewSaveFailed: '评审已完成，报告保存失败。',
    aiReviewRetrySave: '重试保存', aiReviewStale: '资料已更新，上次评审基于较早版本。',
    aiReviewRequired: '请先完成对当前材料的 AI 评审。',
    aiReviewAt: '评审时间', aiReviewRequirementVersion: '需求版本', aiReviewPrdVersion: 'PRD 版本',
    aiReviewNoPrd: '评审时未关联 PRD。', aiReviewNoSource: '这份报告未记录资料版本。',
    aiReviewCannotApprove: '暂不能通过', aiReviewMissing: '还缺{items}。', aiReviewPrdMaterial: '有正文的 PRD',
    aiReviewReturnToPool: '退回需求池补材料', aiReviewReturnReason: '补齐评审材料：{items}。',
    aiReviewReturnConfirm: '退回需求池', aiReviewWaitingDecision: '待人工决定',
    aiReviewOpen: '查看本轮报告', aiReviewOpenHistorical: '打开报告',
    aiReviewReport: 'AI 评审报告', aiReviewEarlierMaterials: '基于旧资料', aiReviewReportSaved: '报告已保存',
    aiReviewBack: '返回需求详情', aiReviewFailureDetails: '查看读取或评审错误',
    aiReviewNewMaterials: '当前材料待重新评审', aiReviewAiAdvice: 'AI 建议',
    aiReviewProceed: '推进', aiReviewReduceScope: '缩小范围', aiReviewVerifyFirst: '先验证', aiReviewHold: '暂缓',
  },
}

// The review prompt specifies one recommendation on its own line. Legacy or
// free-form reports retain the generic saved label and the full report entry.
function reportRecommendation(report, t) {
  const line = report?.opinion?.trim().split(/\r?\n/, 1)[0].replaceAll('**', '').trim()
  const verdict = line?.match(/^建议\s*[：:]\s*(推进|缩小范围|先验证|暂缓)$/u)?.[1]
  const key = { 推进: 'aiReviewProceed', 缩小范围: 'aiReviewReduceScope', 先验证: 'aiReviewVerifyFirst', 暂缓: 'aiReviewHold' }[verdict]
  return key ? t('aiReviewAiAdvice') + ' · ' + t(key) : ''
}

function ReviewSource({ source, t, expanded = false }) {
  if (!source?.requirementVersion) return h('p', { className: 'pw-note' }, t('aiReviewNoSource'))
  const versionText = version => version && h('code', { title: version }, String(version).slice(0, 12))
  const prds = Array.isArray(source.prds) ? source.prds : []
  const materialBody = source.materials && h(React.Fragment, null,
    source.materials.discovery && h(ReadText, { label: t('prepDiscovery'), value: source.materials.discovery }),
    (source.materials.documents ?? []).map(doc => h(ReadText, { key: doc.id, label: doc.title, value: doc.excerpt })),
    source.materials.prototype && h(ReadText, { label: t('prepPrototype'), value: JSON.stringify(source.materials.prototype, null, 2) }))
  return h(React.Fragment, null,
    h('p', { className: 'pw-note' }, t('aiReviewRequirementVersion'), ' ', versionText(source.requirementVersion)),
    prds.length
      ? prds.map(prd => h('p', { className: 'pw-note', key: prd.id }, t('aiReviewPrdVersion'), ' ', prd.title, ' · ', prd.revision ? t('prepVersion').replace('{n}', prd.revision) : versionText(prd.version)))
      : h('p', { className: 'pw-note' }, t('aiReviewNoPrd')),
    source.discovery && h('p', { className: 'pw-note' }, t('prepDiscovery'), ' · ', t('prepVersion').replace('{n}', source.discovery.version)),
    source.prototype && h('p', { className: 'pw-note' }, t('prepPrototype'), ' · ', t('prepVersion').replace('{n}', source.prototype.version)),
    materialBody && (expanded ? materialBody : h(Disclosure, { label: t('aiReviewSavedMaterials') }, materialBody)))
}

export function RequirementReviewHistory({ reports, t, onOpenReport }) {
  return h('ul', { className: 'pw-update-list pw-review-history' },
    reports.map((record, index) => ({ record, index })).reverse().map(({ record, index }) => {
      const id = 'pw-requirement-record-report-' + record.marker
      const round = t('aiReviewRound').replace('{n}', String(index + 1))
      return h('li', { className: 'pw-update', key: record.marker },
        h('span', { className: 'pw-update-body' }, h('strong', null, round), ' · ', reportRecommendation(record, t) || t('aiReviewReportSaved'),
          record.at && h('time', { className: 'pw-note', dateTime: record.at, title: record.at }, ' · ', dateText(record.at))),
        h('button', { type: 'button', id, className: 'pw-button pw-quiet', 'aria-label': round + ' · ' + t('aiReviewOpenHistorical'),
          onClick: () => onOpenReport(record.marker, id) }, t('aiReviewOpenHistorical')))
    }))
}

export function RequirementReportReader({ req, root, marker, t, onBack, fromDrawer }) {
  const [result, setResult] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const heading = useRef(null)
  useEffect(() => {
    let active = true
    rpc('requirement/review/status', { root, id: req.id }).then(res => { if (active) setResult(res) })
    return () => { active = false }
  }, [root, req.id, attempt])
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  const reports = (result?.ok && !result.data.reportsUnavailable ? result.data.reports : null) ?? aiReviewReports(req.reviews)
  const index = reports.findIndex(record => record.marker === marker)
  const record = reports[index]
  const unreadable = result && (!result.ok || result.data.reportsUnavailable)
  const older = result?.ok && result.data.status === 'reviewing' && (index < reports.length - 1 || result.data.stale)
  const title = t('aiReviewReport')
  return h('div', { className: 'pw-subpage-stack' },
    h('article', { className: 'pw-subpage pw-read-card', 'aria-label': title },
      h('header', { className: 'pw-subpage-head' },
        h('div', { className: 'pw-read-title' }, h('h2', { ref: heading, tabIndex: -1 }, title),
          record && h('span', { className: 'pw-note' }, t('aiReviewRound').replace('{n}', String(index + 1))),
          record?.at && h('time', { className: 'pw-note', dateTime: record.at, title: record.at }, dateText(record.at)),
          record && older && h('span', { className: 'pw-note' }, t('aiReviewEarlierMaterials'))),
        h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: onBack }, t(fromDrawer ? 'backToReading' : 'aiReviewBack'))),
      !record && !result && h('p', { className: 'pw-note', role: 'status' }, t('loading')),
      !record && result && h('div', { className: 'pw-actions' },
        h('span', { className: 'pw-note', role: 'status' }, t(unreadable ? 'errUnreadable' : 'errMissing')),
        unreadable && h('button', { type: 'button', className: 'pw-button', onClick: () => { setResult(null); setAttempt(n => n + 1) } }, t('retryRead'))),
      record && h('div', { className: 'pw-reading' },
        h(ReadText, { value: record.opinion }),
        h(Disclosure, { label: t('aiReviewSavedMaterials') }, h(ReviewSource, { source: record.source, t, expanded: true })))))
}

export function RequirementReview({ req, root, t, busy, onApprove, onReject, onOpenReport, onReportSnapshot, recentOnly = false, snapshotOnly = false }) {
  const [details, setDetails] = useState(null)
  const [failure, setFailure] = useState(null)
  const [readError, setReadError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const mounted = useRef(false)
  const reading = useRef(false)
  const request = useRef(false)
  const revision = useRef(0)
  const load = useCallback(async () => {
    if (reading.current || request.current || !mounted.current) return
    const version = revision.current
    reading.current = true
    try {
      const res = await rpc('requirement/review/status', { root, id: req.id })
      if (!mounted.current || revision.current !== version) return
      if (res.ok) setDetails(res.data)
      setReadError(res.ok ? null : res)
    } finally { reading.current = false }
  }, [root, req.id])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => { void load() }, [load, req.status])

  const savedReports = details?.reportsUnavailable ? undefined : details?.reports
  const reports = savedReports ?? aiReviewReports(req.reviews)
  const reportState = readError || details?.reportsUnavailable ? 'unavailable' : details ? 'loaded' : 'loading'
  useEffect(() => { onReportSnapshot?.({ reports: savedReports, state: reportState, retry: load }) },
    [onReportSnapshot, savedReports, reportState, load])
  const latest = reports.at(-1)
  const reviewing = req.status === 'reviewing' && (!details || details.status === 'reviewing')
  const running = details?.state === 'running'
  const saveFailed = details?.state === 'save_failed'
  useEffect(() => {
    if (!reviewing && !running) return
    const timer = setInterval(() => { if (!document.hidden) void load() }, 2000)
    return () => clearInterval(timer)
  }, [load, reviewing, running])
  useEffect(() => {
    if (!reviewing) return
    const changed = event => { if (event.detail?.root === root) void load() }
    window.addEventListener('pw-prd-changed', changed)
    return () => window.removeEventListener('pw-prd-changed', changed)
  }, [load, reviewing, root])

  const dataUnavailable = details?.reportsUnavailable || details?.prdsUnavailable
  const missingPreparation = !readError && !dataUnavailable ? details?.missingPreparation ?? [] : []
  const canStart = !busy && !readError && !running && (saveFailed || (details?.hasPrd && !dataUnavailable))
  const canApprove = !busy && !readError && !dataUnavailable && !running && !missingPreparation.length && details?.hasReview
  const start = async () => {
    if (request.current || !canStart) return
    request.current = true
    revision.current++
    setSubmitting(true)
    setFailure(null)
    try {
      const res = await rpc('requirement/review/start', {
        root, id: req.id, after: latest?.marker ?? null,
        ...(saveFailed && { retrySave: true, runId: details.runId }),
      })
      if (!mounted.current) return
      if (!res.ok) setFailure(res)
      else setDetails(res.data)
    } finally {
      request.current = false
      if (mounted.current) {
        setSubmitting(false)
        void load()
      }
    }
  }

  if (snapshotOnly) return null
  if (!reviewing && !reports.length && !running && !saveFailed && !readError && !dataUnavailable) return null
  const startLabel = saveFailed ? 'aiReviewRetrySave' : latest ? 'aiReviewAgain' : 'aiReview'
  const lines = latest?.opinion?.split('\n') ?? []
  const suggestedReason = lines.map(line => line.replace(/^[\s#*>-]+/u, '').replaceAll('**', '').trim())
    .find(line => line && !/^建议[：:]/u.test(line)) ?? lines[0]
  const materials = { discovery: 'prepDiscovery', prd: 'aiReviewPrdMaterial', prototype: 'prepPrototype' }
  const missing = Object.keys(materials).filter(key => missingPreparation.includes(key))
  const missingText = missing.map(key => t(materials[key])).join(t('fieldSeparator'))
  const waiting = running || submitting
  const status = (readError || dataUnavailable) ? 'errUnreadable'
    : !details ? 'loading'
      : missing.length ? 'aiReviewCannotApprove'
        : waiting ? 'aiReviewRunning'
          : saveFailed ? 'aiReviewSaveFailed'
            : failure || details.state === 'failed' ? 'aiReviewFailed'
              : details.hasReview ? 'aiReviewWaitingDecision'
                : details.stale ? 'aiReviewNewMaterials' : 'aiReviewRequired'
  const currentReportId = 'pw-req-current-report-' + req.id
  const rejectId = 'pw-req-review-return-' + req.id
  const title = t(recentOnly ? 'reqReviewCurrent' : 'aiReviewRecords')
  return h('section', { className: 'pw-reading-block pw-reading-divider', 'aria-label': title },
    h('h3', { className: 'pw-reading-label' }, title),
    (reviewing || waiting || saveFailed) && h('div', { className: 'pw-reading-block pw-review-decision' },
      h('p', { className: 'pw-text', role: 'status' }, h('strong', null, t(status)),
        missing.length > 0 && ' · ' + t('aiReviewMissing').replace('{items}', () => missingText)),
      missing.length > 0 && waiting && h('span', { className: 'pw-note' }, t('aiReviewRunning')),
      h('div', { className: 'pw-actions' },
        reviewing && onReject && missing.length > 0 && h('button', {
          type: 'button', id: rejectId, className: 'pw-button primary', disabled: busy,
          onClick: () => onReject({ missingKind: missing[0], initialReason: t('aiReviewReturnReason').replace('{items}', () => missingText), triggerId: rejectId }),
        }, t('aiReviewReturnToPool')),
        reviewing && onApprove && details?.hasReview && !missing.length && h('button', {
          type: 'button', className: 'pw-button primary', disabled: !canApprove || submitting, onClick: () => onApprove(latest?.marker),
        }, t('approveReview')),
        (saveFailed || reviewing && details?.hasPrd) && h('button', {
          type: 'button', className: 'pw-button' + (!missing.length && (saveFailed || !details.hasReview) ? ' primary' : ''),
          disabled: !canStart || submitting, onClick: start,
        }, t(startLabel)),
        reviewing && onReject && !missing.length && h('button', {
          type: 'button', id: rejectId, className: 'pw-button danger', disabled: busy,
          onClick: () => onReject({ suggestion: details?.hasReview ? suggestedReason : '', triggerId: rejectId }),
        }, t('rejectRequirement')),
        (readError || dataUnavailable) && h('button', { type: 'button', className: 'pw-button', onClick: load }, t('retryRead'))),
      (failure || readError || details?.error || details?.errorCode) && h(Disclosure, { label: t('aiReviewFailureDetails') },
        h(ErrorDetails, { error: failure ?? readError, t, showRaw: false }),
        details?.error && h(ReadText, { value: details.error }),
        details?.errorCode && h('p', { className: 'pw-note' }, [details.errorCode, details.httpStatus].filter(Boolean).join(' · ')))),
    reviewing && latest && onOpenReport && h('div', { className: 'pw-actions' },
      h('button', { type: 'button', id: currentReportId, className: 'pw-button pw-quiet',
        onClick: () => onOpenReport(latest.marker, currentReportId) }, t('aiReviewOpen')),
      details?.stale ? h('span', { className: 'pw-note' }, t('aiReviewEarlierMaterials'))
        : details?.hasReview && h('span', { className: 'pw-note' }, reportRecommendation(latest, t))),
    reviewing && details?.materials && h(Disclosure, { label: t('aiReviewMaterials') },
      h(ReviewSource, { source: details.materials, t })),
    !recentOnly && !!reports.length && h(RequirementReviewHistory, { reports, t, onOpenReport }))
}
