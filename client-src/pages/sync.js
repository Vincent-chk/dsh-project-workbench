import React from 'react'
import { taskOverview } from '../../core/state.js'
import { rpc } from '../api.js'
import { ErrorDetails } from '../shared/ui.js'
import { DraftSuggestions } from '../detail/task-content.js'
import { isRequirementSplit } from '../workbench-content.js'
import { generationStartMessage } from './resources.js'

const h = React.createElement
const { useCallback, useEffect, useRef, useState } = React
const STATES = ['todo', 'doing', 'blocked', 'in_review', 'done', 'cancelled', 'backlog', 'reviewing', 'ready', 'in_progress', 'pending', 'completed']

// 进展建议（对账队列）：保留既有数据与接口；状态建议只定位，内容建议可采用。
export function SyncView({ root, sessionId, t, refresh, requirements = [], onLocateProposal }) {
  const [list, setList] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [run, setRun] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const poll = useRef(null)
  const mounted = useRef(false)
  const load = useCallback(async () => {
    const res = await rpc('sync/proposals', { root })
    if (!mounted.current) return
    setLoadError(res.ok ? null : res)
    if (res.ok) { setList(res.data.proposals.filter(p => p.status === 'pending')); setBaseline(res.data.baseline) }
  }, [root])
  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false; clearInterval(poll.current) }
  }, [load])
  const canApply = proposal => {
    const { kind, suggested_patch: patch } = proposal
    return !isRequirementSplit(proposal) && !patch?.to && (
      ['req_draft', 'new_task', 'field_draft'].includes(kind) ||
      (kind === 'task_suggestion' && patch?.action === 'scope'))
  }
  const content = (list ?? []).filter(p => canApply(p) && (p.kind !== 'new_task' || taskOverview(p.suggested_patch)))
  const sourceLabel = source => {
    if (typeof source !== 'string') return ''
    if (source.startsWith('session://')) return t('syncSourceConversation')
    if (source.startsWith('draft://')) return t('syncSourceDraft')
    if (source.startsWith('repo://')) return source.slice('repo://'.length)
    if (source.startsWith('wiki:')) return source.slice('wiki:'.length)
    const revision = source.match(/^commit:([a-f0-9]{7,40})$/i)?.[1]
    return revision ? t('syncSourceCommit').replace('{revision}', revision.slice(0, 7)) : ''
  }
  const startSync = async () => {
    if (run?.busy) return
    setRun({ busy: true, message: t('syncRunning') })
    const res = await fetch('/api/project-workbench/sync-run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, sessionId }) }).then(r => r.json()).catch(() => null)
    if (!mounted.current) return
    if (!res?.ok) { setRun({ busy: false, message: generationStartMessage(res, 'syncRunFailed', t) }); return }
    clearInterval(poll.current)
    poll.current = setInterval(async () => {
      const st = await fetch('/api/project-workbench/sync-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) }).then(r => r.json()).catch(() => null)
      if (!mounted.current) return
      const s = st?.data?.status
      if (s === 'done' || s === 'idle') {
        clearInterval(poll.current)
        const produced = st?.data?.produced ?? 0
        const saved = st?.data?.saved ?? 0
        const msg = produced === 0 ? t('syncNone') : `${t('syncDone')} ${t('syncSaved').replace('{n}', String(saved))}`
        setRun({ busy: false, message: msg })
        load()
      } else if (s === 'failed' || !st?.ok) {
        clearInterval(poll.current)
        setRun({ busy: false, message: t(s === 'failed' ? 'syncRunFailed' : 'generationStatusUnavailable') })
      }
    }, 4000)
  }
  const decide = async (p, approve, patch) => {
    if (run?.busy || (approve && !canApply(p))) return
    setRun({ busy: true })
    const res = await rpc(approve ? 'sync/apply' : 'sync/dismiss', { root, proposalId: p.id, patch, reason: approve ? undefined : 'dismissed in queue' })
    if (!mounted.current) return
    if (!res.ok) { setRun({ busy: false, error: res }); return }
    await load()
    setRun(null)
    refresh()
  }
  const approveAll = async () => {
    if (run?.busy || !content.length) return
    setRun({ busy: true, message: t('syncAdoptContent') })
    let ok = 0; let fail = 0
    for (const p of content) {
      const res = await rpc('sync/apply', { root, proposalId: p.id })
      if (res.ok) ok++; else fail++
    }
    if (!mounted.current) return
    await load()
    setRun({ busy: false, message: t('syncBatchResult').replace('{adopted}', String(ok)).replace('{failed}', String(fail)) })
    refresh()
  }
  const total = (baseline?.accepted ?? 0) + (baseline?.dismissed ?? 0)
  const rate = total > 0 ? Math.round(((baseline?.accepted ?? 0) / total) * 100) : 0
  return h('div', { className: 'pw-sync' },
    h('div', { className: 'pw-banner', role: 'status' },
      h('button', { className: 'pw-button primary', onClick: startSync, disabled: run?.busy }, t('syncRun')),
      content.length > 0 && h('button', { className: 'pw-button', onClick: approveAll, disabled: run?.busy }, t('syncAdoptContent')),
      list && h('span', { className: 'pw-count', style: { marginLeft: 8 } }, t('syncPending').replace('{n}', String(list.length))),
      baseline && total > 0 && h('span', { className: 'pw-count', style: { marginLeft: 8 } }, t('syncAcceptRate').replace('{rate}', String(rate)).replace('{accepted}', String(baseline.accepted ?? 0)).replace('{total}', String(total))),
      run?.message && h('span', { style: { marginLeft: 10 } }, run.message),
      run?.error && h(ErrorDetails, { error: run.error, t, showRaw: false })),
    loadError && h('div', { className: 'pw-banner pw-error', role: 'alert' },
      h(ErrorDetails, { error: loadError, t, showRaw: false }),
      h('button', { className: 'pw-button', onClick: load }, t('retryRead'))),
    !list ? !loadError && h('div', { className: 'pw-empty' }, t('loading'))
      : list.length === 0 ? h('div', { className: 'pw-empty' }, t('syncEmpty'))
      : h('div', { className: 'pw-sync-list' }, list.map(p => {
        const req = requirements.find(req => req.id === p.target?.reqId)
        const task = req?.issues?.find(task => task.id === p.target.issueId)
        const state = p.kind === 'task_suggestion' && p.suggested_patch?.action === 'cancel' ? 'cancelled' : p.suggested_patch?.to
        const stateLabel = (p.target?.issueId ? 'st_' : 'col_') + state
        const sources = [...new Set((p.evidence ?? []).map(sourceLabel).filter(Boolean))]
        const split = isRequirementSplit(p)
        return h('div', { key: p.id, className: 'pw-proposal' },
          h('div', { className: 'pw-proposal-head' },
            h('span', { className: 'pw-istatus st-doing' }, t('kind_' + p.kind)),
            h('strong', null, task?.title ?? req?.title ?? t(p.target?.issueId ? 'issueDetail' : 'detail')),
            STATES.includes(state) && h('span', { className: 'pw-count' }, '→ ', t(stateLabel))),
          (p.kind !== 'new_task' || split) && h('div', { className: 'pw-proposal-reason' }, split ? p.suggested_patch?.title : p.reason),
          sources.length > 0 && h('div', { className: 'pw-proposal-evidence' },
            h('span', { className: 'pw-label' }, t('syncEvidence')),
            sources.map(source => h('span', { key: source, className: 'pw-refchip' }, source))),
          p.kind === 'new_task' && canApply(p) ? h(DraftSuggestions, { proposals: [p], root, t, busy: run?.busy,
            act: (method, input) => decide(p, method === 'proposal/adopt', input.patch) }) : h('div', { className: 'pw-actions' },
            canApply(p)
              ? h('button', { className: 'pw-button primary', onClick: () => decide(p, true), disabled: run?.busy }, t('demoAdopt'))
              : p.target?.reqId && h('button', { className: 'pw-button', onClick: () => onLocateProposal({ ...p.target, split }) },
                t(split ? 'splitLocate' : p.target.issueId ? 'syncLocateTask' : 'syncLocateRequirement')),
            !split && h('button', { className: 'pw-button', onClick: () => decide(p, false), disabled: run?.busy }, t('syncDismiss'))))
      })))
}
