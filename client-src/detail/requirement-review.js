import React from 'react'
import { aiReviewReports } from '../../core/state.js'
import { rpc } from '../api.js'
import { Disclosure, ErrorDetails, ReadText } from '../shared/ui.js'

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
  },
}

function ReviewSource({ source, t }) {
  if (!source?.requirementVersion) return h('p', { className: 'pw-note' }, t('aiReviewNoSource'))
  const versionText = version => version && h('code', { title: version }, String(version).slice(0, 12))
  const prds = Array.isArray(source.prds) ? source.prds : []
  return h(React.Fragment, null,
    h('p', { className: 'pw-note' }, t('aiReviewRequirementVersion'), ' ', versionText(source.requirementVersion)),
    prds.length
      ? prds.map(prd => h('p', { className: 'pw-note', key: prd.id }, t('aiReviewPrdVersion'), ' ', prd.title, ' · ', prd.revision ? t('prepVersion').replace('{n}', prd.revision) : versionText(prd.version)))
      : h('p', { className: 'pw-note' }, t('aiReviewNoPrd')),
    source.prototype && h('p', { className: 'pw-note' }, t('prepPrototype'), ' · ', t('prepVersion').replace('{n}', source.prototype.version)),
    source.materials && h(Disclosure, { label: t('aiReviewSavedMaterials') },
      (source.materials.documents ?? []).map(doc => h(ReadText, { key: doc.id, label: doc.title, value: doc.excerpt })),
      source.materials.prototype && h(ReadText, { label: t('prepPrototype'), value: JSON.stringify(source.materials.prototype, null, 2) })))
}

export function RequirementReviewHistory({ reports, t }) {
  return reports.map((record, index) => ({ record, index })).reverse().map(({ record, index }) =>
    h(Disclosure, { key: record.marker, id: 'pw-requirement-record-report-' + record.marker,
      label: t('aiReviewRound').replace('{n}', String(index + 1)) },
    record.at && h('p', { className: 'pw-note' }, t('aiReviewAt'), ' ',
      h('time', { dateTime: record.at, title: record.at }, String(record.at).replace('T', ' ').slice(0, 16))),
    h(ReviewSource, { source: record.source, t }),
    h(ReadText, { value: record.opinion })))
}

export function RequirementReview({ req, root, t, busy, onApprove, onReject, onReportSnapshot, recentOnly = false, snapshotOnly = false }) {
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
  const canStart = !busy && !readError && !running && (saveFailed || (details?.hasPrd && !dataUnavailable))
  const canApprove = !busy && !readError && !dataUnavailable && !running && details?.hasReview
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
  const lines = latest?.opinion.split('\n') ?? []
  const suggestedReason = lines.map(line => line.replace(/^[\s#*>-]+/u, '').replaceAll('**', '').trim())
    .find(line => line && !/^建议[：:]/u.test(line)) ?? lines[0]
  const helpId = 'pw-approve-review-help-' + req.id
  const needsReport = reviewing && details?.hasPrd && !details.hasReview && !dataUnavailable
  const title = t(recentOnly ? 'reqReviewCurrent' : 'aiReviewRecords')
  return h('section', { className: 'pw-reading-block pw-reading-divider', 'aria-label': title },
    h('h3', { className: 'pw-reading-label' }, title),
    h('div', { className: 'pw-actions' },
      (reviewing || saveFailed) && h('button', { className: 'pw-button', disabled: !canStart || submitting, onClick: start }, t(startLabel)),
      reviewing && onApprove && h('button', { className: 'pw-button primary', disabled: !canApprove,
        'aria-describedby': needsReport ? helpId : undefined, onClick: () => onApprove(latest?.marker) }, t('approveReview')),
      reviewing && onReject && h('button', { className: 'pw-button danger', disabled: busy, onClick: () => onReject(details?.hasReview ? suggestedReason : '') }, t('rejectRequirement'))),
    needsReport && h('p', { className: 'pw-note', id: helpId }, t('aiReviewRequired')),
    (running || submitting) && h('p', { className: 'pw-note', role: 'status' }, t('aiReviewRunning')),
    reviewing && details?.state === 'failed' && h('p', { className: 'pw-note', role: 'status' }, details?.error ?? t('aiReviewFailed'),
      details?.errorCode && ' (' + [details.errorCode, details.httpStatus].filter(Boolean).join(' · ') + ')'),
    saveFailed && h('p', { className: 'pw-note', role: 'status' }, t('aiReviewSaveFailed')),
    details?.stale && h('p', { className: 'pw-note', role: 'status' }, t('aiReviewStale')),
    h(ErrorDetails, { error: failure ?? readError, t, showRaw: false }),
    dataUnavailable && h('p', { className: 'pw-note', role: 'status' }, t('errUnreadable')),
    (readError || dataUnavailable) && !saveFailed &&
      h('button', { className: 'pw-button pw-quiet', onClick: load }, t('retryRead')),
    reviewing && details?.materials && h(Disclosure, { label: t('aiReviewMaterials'), open: true },
      h(ReviewSource, { source: details.materials, t })),
    reviewing && latest && h(ReadText, { value: latest.opinion }),
    !recentOnly && h(RequirementReviewHistory, { reports, t }))
}
