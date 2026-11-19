import React from 'react'
import { rpc } from '../api.js'
import { ErrorDetails, Modal } from '../shared/ui.js'
import { stripFrontmatter, parseEvidenceRef, evidenceLines, wikiLocalDate } from './wiki-source.js'

const h = React.createElement
const { useCallback, useEffect, useRef, useState } = React
const baseName = p => String(p ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''

// Resolve only Markdown pages inside this Wiki; the Host checks the path again.
function wikiLink(href, pagePath) {
  if (!pagePath || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) || /%(?:2f|5c)/i.test(href) || href.includes('\\')) return null
  try {
    const base = `https://wiki.invalid/openwiki/${pagePath.split('/').map(encodeURIComponent).join('/')}`
    const url = new URL(href.startsWith('openwiki/') ? '/' + href : href, base)
    if (url.origin !== 'https://wiki.invalid' || !url.pathname.startsWith('/openwiki/')) return null
    const path = decodeURIComponent(url.pathname.slice('/openwiki/'.length))
    return path.endsWith('.md') ? path : null
  } catch { return null }
}

// Minimal inline markdown: `code`, **bold**, [text](url).
function inline(text, keyBase, wiki) {
  const nodes = []; let rest = text; let k = 0
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/
  while (rest.length) {
    const m = rest.match(re)
    if (!m) { nodes.push(rest); break }
    if (m.index > 0) nodes.push(rest.slice(0, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) nodes.push(h('code', { key: keyBase + '-' + (k++), className: 'pw-inline-code' }, tok.slice(1, -1)))
    else if (tok.startsWith('**')) nodes.push(h('strong', { key: keyBase + '-' + (k++) }, tok.slice(2, -2)))
    else {
      const lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/)
      const path = wikiLink(lm[2], wiki?.pagePath)
      if (path && wiki?.open) nodes.push(h('a', { key: keyBase + '-' + (k++), href: '#', onClick: event => { event.preventDefault(); wiki.open(path) } }, lm[1]))
      else if (/^https?:\/\//i.test(lm[2])) nodes.push(h('a', { key: keyBase + '-' + (k++), href: lm[2], target: '_blank', rel: 'noreferrer' }, lm[1]))
      else nodes.push(lm[1])
    }
    rest = rest.slice(m.index + tok.length)
  }
  return nodes
}

function CodeBlock({ lang, code, t }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard unavailable */ }
  }
  return h('div', { className: 'pw-codeblock' },
    h('div', { className: 'pw-code-head' },
      h('span', { className: 'pw-code-label' }, lang === 'mermaid' ? t('mermaidNote') : (lang || 'code')),
      h('button', { className: 'pw-button pw-copy', onClick: copy }, copied ? t('copied') : t('copy'))),
    h('pre', null, code))
}

// Markdown HTML comments are not visible content. Leave fenced and inline code
// intact, including examples that demonstrate comment syntax.
function withoutComments(src) {
  let fenced = false; let comment = false
  return src.split(/\r?\n/).map(line => {
    if (!comment && /^```/.test(line)) { fenced = !fenced; return line }
    if (fenced) return line
    let out = ''; let i = 0; let code = false
    while (i < line.length) {
      if (comment) {
        const end = line.indexOf('-->', i)
        if (end < 0) break
        comment = false; i = end + 3
      } else if (!code && line.startsWith('<!--', i)) { comment = true; i += 4 }
      else { if (line[i] === '`') code = !code; out += line[i++] }
    }
    return out
  }).join('\n')
}

export function renderMarkdown(src, t, wiki) {
  const lines = withoutComments(src).split(/\r?\n/)
  const out = []; let i = 0; let key = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^```(\w*)/)
    if (fence) {
      const lang = fence[1]; const buf = []; i++
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++ }
      i++ // closing fence
      out.push(h(CodeBlock, { key: key++, lang, code: buf.join('\n'), t }))
      continue
    }
    const head = line.match(/^(#{1,4})\s+(.*)$/)
    if (head) { const lvl = head[1].length; out.push(h('h' + lvl, { key: key++, className: 'pw-md-h' }, inline(head[2], 'h' + key, wiki))); i++; continue }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++ }
      out.push(h('ul', { key: key++, className: 'pw-md-ul' }, items.map((it, j) => h('li', { key: j }, inline(it, 'li' + key + '-' + j, wiki)))))
      continue
    }
    // GFM table: header row + |---| separator, then body rows.
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const splitRow = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
      const header = splitRow(line); i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(splitRow(lines[i])); i++ }
      out.push(h('div', { key: key++, className: 'pw-md-tablewrap' },
        h('table', { className: 'pw-md-table' },
          h('thead', null, h('tr', null, header.map((c, j) => h('th', { key: j }, inline(c, 'th' + key + '-' + j, wiki))))),
          h('tbody', null, rows.map((r, ri) => h('tr', { key: ri }, r.map((c, ci) => h('td', { key: ci }, inline(c, 'td' + key + '-' + ri + '-' + ci, wiki)))))))))
      continue
    }
    if (line.trim() === '') { i++; continue }
    out.push(h('p', { key: key++, className: 'pw-md-p' }, inline(line, 'p' + key, wiki))); i++
  }
  return out
}

export function generationStartMessage(error, fallback, t) {
  if (error?.code === 'SESSION_NOT_LIVE') return t('generationNeedsSession')
  if (error?.code === 'WORKSPACE_MISMATCH') return t('errWrongWorkspace')
  if (error?.code === 'NOT_GIT') return t('wikiNeedsGit')
  if (error?.code === 'GIT_MISSING') return t('wikiGitMissing')
  if (error?.code === 'WIKI_BUSY') return t('wikiBusy')
  if (error?.code === 'WIKI_ROOT_NOT_TOPLEVEL') return t('wikiRootNotTopLevel')
  if (error?.code === 'WIKI_ROOT_UNAVAILABLE') return t('wikiRootUnavailable')
  if (error?.code === 'WIKI_STATE_UNREADABLE') return t('wikiStateUnreadable')
  if (error?.code === 'WIKI_METADATA_UNSAFE') return t('wikiMetadataUnsafe')
  if (error?.code === 'WIKI_CHECKPOINT_UNSAFE') return t('wikiCheckpointUnsafe')
  if (error?.code === 'WIKI_SNAPSHOT_FAILED') return t('wikiSnapshotFailed')
  if (error?.code === 'WIKI_SNAPSHOT_UNREADABLE') return t('wikiSnapshotUnreadable')
  if (error?.code === 'WIKI_EXTERNAL_CHANGE') return t('wikiExternalChangeBlocked')
  if (error?.code === 'WIKI_STAGING_FAILED') return t('wikiStagingFailed')
  if (error?.code === 'WIKI_SOURCE_UNSUPPORTED') return t('wikiSourceUnsupported')
  if (error?.code === 'ARCH_SOURCE_REQUIRED') return t('archSourceRequired')
  if (error?.code === 'ARCH_SOURCE_INVALID') return t('archSourceInvalid')
  return t(fallback)
}

function wikiJobMessage(error, t) {
  if (error === 'stopped by user') return t('wikiStopped')
  if (error === 'Wiki or source changed during generation') return t('wikiPublishConflict')
  if (error === 'Wiki publication failed') return t('wikiPublishFailed')
  if (error === 'Wiki was published but its status could not be saved') return t('wikiPublishedStatusFailed')
  if (typeof error === 'string' && error.startsWith('Wiki publication needs recovery: ')) {
    return `${t('wikiPublishRecovery')} ${error.slice('Wiki publication needs recovery: '.length)}`
  }
  return t('wikiTryAgain')
}

export function WikiView({ root, sessionId, t, target, onPageChange, uiMemory }) {
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState(null)
  const [page, setPage] = useState(null) // {path, content}
  const [evidence, setEvidence] = useState(null) // {claims:[{statement,evidence[]}]}
  const [err, setErr] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState(null) // {label, path, range?, content?, error?, loading?}
  const pageSeq = useRef(0)
  const statusSeq = useRef(0)
  const [gen, setGen] = useState(() => uiMemory.wikiGen[root] ?? null) // {busy, message}
  const [genChecked, setGenChecked] = useState(false)
  const pollRef = useRef(null)
  const setGenState = g => { uiMemory.wikiGen[root] = g; setGen(g) }
  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  const loadStatus = useCallback(async () => {
    const seq = ++statusSeq.current
    const res = await rpc('wiki/status', { root })
    if (seq !== statusSeq.current) return
    setStatusError(res.ok ? null : res)
    if (res.ok) setStatus(res.data)
  }, [root])
  const fetchGenStatus = () => fetch('/api/project-workbench/wiki-generate-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) }).then(r => r.json()).catch(() => null)
  const pollGen = (refresh = loadStatus) => {
    stopPoll()
    // Poll until the background child finishes; the page list grows as it writes.
    pollRef.current = setInterval(async () => {
      const st = await fetchGenStatus()
      const s = st?.data?.status
      await refresh()
      if (s === 'done' || s === 'idle') {
        stopPoll()
        const last = st?.data?.last
        const noop = /WIKI_NOOP/i.test(st?.data?.summary || '')
        if (last?.status === 'failed') setGenState({ busy: false, failed: true, message: wikiJobMessage(last.error, t) })
        else setGenState({ busy: false, message: noop ? t('wikiNoop') : t('wikiDone') })
      } else if (s === 'failed') {
        stopPoll()
        setGenState({ busy: false, failed: true, message: wikiJobMessage(st?.data?.error, t) })
      } else if (s === 'stopping') {
        setGenState({ busy: true, message: t('wikiStopping') })
      } else if (!st?.ok) {
        stopPoll()
        setGenState({ busy: false, failed: true, message: t('generationStatusUnavailable') })
      }
    }, 4000)
  }
  // Navigation must not lose a running generation: the Host job is the source of truth, so re-attach on mount.
  useEffect(() => {
    let alive = true
    fetchGenStatus().then(st => {
      if (!alive) return
      if (!st?.ok || !st.data) { setGenChecked('error'); setGenState({ busy: false, message: t('generationStatusUnavailable') }); return }
      setGenChecked(true)
      const d = st.data
      if (d.status === 'running') { setGenState({ busy: true, message: t('wikiGenerating') }); pollGen() }
      else if (d.status === 'stopping') { setGenState({ busy: true, message: t('wikiStopping') }); pollGen() }
      else if (d.status === 'done') setGenState({ busy: false, message: /WIKI_NOOP/i.test(d.summary || '') ? t('wikiNoop') : t('wikiDone') })
      else if (d.status === 'failed') setGenState({ busy: false, failed: true, message: wikiJobMessage(d.error, t) })
      else if (d.last?.status === 'failed') setGenState({ busy: false, failed: true, message: wikiJobMessage(d.last.error, t) })
      else if (uiMemory.wikiGen[root]?.busy) setGenState(null)
    })
    return () => { alive = false; stopPoll() }
  }, [root])
  const [collapsed, setCollapsed] = useState({}) // group -> bool
  useEffect(() => {
    loadStatus()
    return () => { pageSeq.current++; statusSeq.current++ }
  }, [loadStatus])
  const open = async path => {
    const normalized = path.replace(/^openwiki\//, '')
    onPageChange?.(normalized)
    const seq = ++pageSeq.current
    // A generation can finish between the page and its Claims request. Read
    // both against the same view; if it changed, retry the complete pair.
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await rpc('wiki/status', { root })
      if (seq !== pageSeq.current) return
      if (!current.ok) { setStatusError(current); setErr({ path }); return }
      const viewVersion = current.data.viewVersion
      const args = { root, path, viewVersion }
      const res = await rpc('wiki/page', args)
      if (seq !== pageSeq.current) return
      if (!res.ok && res.code === 'WIKI_VIEW_CHANGED') continue
      if (!res.ok) { setErr({ path, code: res.code }); return }
      const ev = await rpc('wiki/evidence', { ...args, viewVersion: res.data.viewVersion ?? viewVersion })
      if (seq !== pageSeq.current) return
      if (!ev.ok && ev.code === 'WIKI_VIEW_CHANGED') continue
      if (!ev.ok) { setErr({ path, code: ev.code }); return }
      setStatus(current.data); setStatusError(null)
      setPage({ ...res.data, viewVersion, viewIsSnapshot: !!current.data.viewIsSnapshot }); setErr('')
      setEvidence(ev.data)
      return
    }
    if (seq === pageSeq.current) setErr({ path })
  }
  // Once an update finishes, reopen the page and Claims against its new view.
  useEffect(() => {
    if (page && status?.viewVersion && page.viewVersion && page.viewVersion !== status.viewVersion) void open(page.path)
  }, [status?.viewVersion])
  // A referenced page can be absent from the index; try reading it so the
  // user gets a retryable error instead of silently losing the target.
  useEffect(() => {
    if (!target) return
    open(target)
  }, [target])
  const retryPage = async () => {
    const path = err.path
    const seq = ++pageSeq.current
    const fresh = await rpc('wiki/status', { root })
    if (seq !== pageSeq.current) return
    if (fresh.ok) { setStatus(fresh.data); setStatusError(null) }
    await open(path)
  }
  // 来源证据按现有能力打开：repo:// 读工作区文件片段，wiki:/openwiki/ 跳页面。
  const openSource = async ref => {
    const parsed = parseEvidenceRef(ref)
    if (parsed.kind === 'wiki') { open(parsed.path); return }
    if (parsed.kind !== 'file') return
    setSource({ ...parsed, loading: true })
    const res = await rpc('probe/read', { root, path: parsed.path })
    setSource(current => current?.label === parsed.label
      ? (res.ok ? { ...parsed, content: evidenceLines(res.data.content, parsed.from, parsed.to) } : { ...parsed, error: res })
      : current)
  }
  const evidenceItem = ref => {
    const parsed = parseEvidenceRef(ref)
    if (parsed.kind === 'text') return h('span', { key: ref, className: 'pw-refchip', title: ref }, ref)
    return h('button', { key: ref, className: 'pw-refchip pw-reflink', title: parsed.kind === 'file' ? t('sourceOpen') : ref, onClick: () => openSource(ref) }, ref)
  }
  const pageError = err && h('div', { className: 'pw-banner pw-error', role: 'alert' },
    h('span', null, err.code === 'WIKI_SNAPSHOT_UNREADABLE' ? t('wikiSavedViewUnreadable') : t('wikiUnavailable'), ' ', baseName(err.path)),
    h('button', { className: 'pw-button', onClick: retryPage }, t('retry')))
  const readError = statusError && h('div', { className: 'pw-banner pw-error', role: 'alert' },
    statusError.code === 'WIKI_SNAPSHOT_UNREADABLE' ? h('span', null, t('wikiSavedViewUnreadable')) : h(ErrorDetails, { error: statusError, t, showRaw: false }),
    h('button', { className: 'pw-button', onClick: loadStatus }, t('retryRead')))
  const generate = async () => {
    setGenState({ busy: true, starting: true, message: t('wikiGenerating') })
    try {
      const res = await fetch('/api/project-workbench/wiki-generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, sessionId }) })
      const j = await res.json()
      if (!j.ok) { setGenState({ busy: false, failed: true, startFailed: true, message: generationStartMessage(j, 'wikiTryAgain', t) }); return }
      setGenState({ busy: true, message: t('wikiGenerating') })
      pollGen() // a job that is already running also lands here
    } catch { setGenState({ busy: false, failed: true, startFailed: true, message: t('wikiTryAgain') }) }
  }
  const stopGen = async () => {
    setGenState({ busy: true, message: t('wikiStopping') })
    const res = await fetch('/api/project-workbench/wiki-generate-stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) }).then(r => r.json()).catch(() => null)
    if (!res?.ok) { setGenState({ busy: true, message: t('generationStopFailed') }); return }
    if (res.data?.stopped === false && res.data.reason === 'finishing') setGenState({ busy: true, message: t('wikiPublishing') })
    else if (res.data?.stopped === false) setGenState({ busy: true, message: t('generationStopFailed') })
    pollGen() // only report stopped once the Host confirms the child settled
  }
  // An interrupted lifecycle marker is not a successful update. A real running
  // Host job takes precedence; only report interruption after checking it.
  const interrupted = genChecked === true && !gen?.busy && status?.lastUpdate?.status === 'interrupted'
  const checkpointMessage = null // New updates start in an independent temporary project.
  const genMessage = genChecked === false || (statusError && !gen?.failed) ? null : checkpointMessage || (status?.viewExternalChanged && !gen?.failed ? null : interrupted && !gen?.failed ? t('wikiTryAgain') : gen?.message)
  const lastCompleted = status?.lastCompleted ?? (!status?.viewIsSnapshot && status?.lastUpdate?.status === 'complete' ? status.lastUpdate : null)
  // Keep the previous page in state so it can be reopened after a view change,
  // but never present it (or its Claims) under a different view's label.
  const visiblePage = !statusError && page && (!status?.viewVersion || !page.viewVersion || page.viewVersion === status.viewVersion) ? page : null
  const genError = gen?.startFailed && genMessage ? h('div', { className: 'pw-banner pw-error', role: 'alert' }, genMessage) : null
  const genBar = h('div', { className: 'pw-banner', role: 'status' },
    h('button', { className: 'pw-button primary', onClick: generate, disabled: genChecked === false || gen?.busy }, status?.exists ? t('wikiUpdate') : t('wikiGenerate')),
    gen?.busy && h('button', { className: 'pw-button', onClick: stopGen }, t('wikiStop')),
    !genError && genMessage && h('span', { style: { marginLeft: 10 } }, genMessage))
  if (!status && !page) return h('div', { className: 'pw-init' }, readError || h('p', null, t('loading')))
  if (!status?.exists && !page) return h('div', { className: 'pw-init' }, h('h2', null, t('wikiTitle')), h('p', { className: 'pw-note' }, t('wikiEmpty')), readError, pageError, genBar, genError)
  // Hierarchical nav: group pages by top-level directory; root pages stay top-level.
  const needle = query.trim().toLowerCase()
  const pages = (status?.pages ?? []).filter(p => !needle || p.toLowerCase().includes(needle))
  const groups = new Map(); const rootPages = []
  for (const p of pages) {
    const slash = p.indexOf('/')
    if (slash === -1) rootPages.push(p)
    else { const g = p.slice(0, slash); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p) }
  }
  const pageBtn = p => h('button', { key: p, className: 'pw-wiki-item' + (page?.path === p ? ' active' : ''), onClick: () => open(p), title: p }, p.split('/').pop())
  return h('div', { className: 'pw-wiki-wrap' }, genBar, genError,
    h('div', { className: 'pw-note' }, t('wikiRebuildNotice')), readError,
    status?.viewExternalChanged ? h('div', { className: 'pw-note', role: 'status' }, t(status.viewUnavailable ? 'wikiNoSavedExternal' : 'wikiExternalChangeView'))
      : (page ? page.viewIsSnapshot : status?.viewIsSnapshot) && h('div', { className: 'pw-note', role: 'status' }, t('wikiShowingPrevious')),
    status?.viewUnprotected && h('div', { className: 'pw-note', role: 'status' }, t('wikiPreviousUnavailable')),
    h('div', { className: 'pw-wiki' },
      h('aside', { className: 'pw-wiki-list' },
        h('strong', null, t('wikiPages')),
        lastCompleted?.updatedAt && h('div', { className: 'pw-count', style: { margin: '4px 0 8px' } }, `${t('wikiLastUpdate')}: ${wikiLocalDate(lastCompleted.updatedAt) || t('wikiDateUnknown')}`),
        h('input', { className: 'pw-input', style: { marginBottom: 6 }, placeholder: t('search'), value: query, onChange: e => setQuery(e.target.value), 'aria-label': t('wikiSearch') }),
        needle && !pages.length && h('div', { className: 'pw-empty' }, t('noResults')),
        rootPages.map(pageBtn),
        [...groups.entries()].map(([g, pages]) => h('div', { key: g, className: 'pw-wiki-group' },
          h('button', { className: 'pw-wiki-grouhead', onClick: () => setCollapsed(c => ({ ...c, [g]: !c[g] })), 'aria-expanded': !collapsed[g] },
            h('span', { className: 'pw-caret' + (collapsed[g] ? ' closed' : '') }, '▾'), g, h('span', { className: 'pw-count' }, String(pages.length))),
          !collapsed[g] && h('div', { className: 'pw-wiki-groupitems' }, pages.map(pageBtn))))),
      h('div', { className: 'pw-wiki-body' },
        pageError,
        visiblePage ? h(React.Fragment, null,
          h('button', { className: 'pw-button', style: { marginBottom: 10 }, onClick: () => { setPage(null); onPageChange?.(null) } }, t('wikiBack')),
          h('div', { className: 'pw-md' }, renderMarkdown(stripFrontmatter(visiblePage.content), t, { pagePath: visiblePage.path, open })),
          h('div', { className: 'pw-evidence' },
            h('span', { className: 'pw-label' }, t('wikiEvidence')),
            evidence && evidence.claims.length
              ? evidence.claims.map((c, i) => h('div', { key: i, className: 'pw-claim' },
                h('div', { className: 'pw-claim-stmt' }, c.statement),
                h('div', { className: 'pw-claim-ev' }, c.evidence.map(evidenceItem))))
              : h('div', { className: 'pw-empty', style: { border: 'none', padding: '4px 0' } }, t('wikiNoEvidence'))))
          : h('div', { className: 'pw-empty' }, t('wikiPages')))),
    source && h(Modal, {
      title: source.path + (source.from ? ` · L${source.from}${source.to > source.from ? `–L${source.to}` : ''}` : ''),
      wide: true,
      onClose: () => setSource(null),
      actions: [
        source.error && h('button', { className: 'pw-button', onClick: () => openSource(source.label) }, t('retry')),
        h('button', { className: 'pw-button primary', onClick: () => setSource(null) }, t('ok')),
      ],
    },
    source.loading && h('p', { className: 'pw-note' }, t('loading')),
    source.error && h('p', { className: 'pw-error' }, t('sourceUnavailable')),
    source.content != null && h('pre', { className: 'pw-source-view' }, source.content)))
}

export function ArchView({ root, sessionId, t }) {
  const [arch, setArch] = useState(null) // {exists, html}
  const [run, setRun] = useState(null) // {busy, message}
  const [readError, setReadError] = useState(null)
  const [source, setSource] = useState(null)
  const sourceSeq = useRef(0)
  const timer = useRef(null)
  const mounted = useRef(false)
  const stopPoll = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }, [])
  const load = useCallback(async () => {
    const res = await rpc('architecture/read', { root })
    if (!mounted.current) return
    setReadError(res.ok ? null : res)
    if (res.ok) setArch(res.data)
  }, [root])
  const showRunFailure = useCallback(data => {
    const stopped = data.error === 'stopped by user'
    setRun({ busy: false, failed: !stopped, message: stopped ? t('wikiStopped') : generationStartMessage(data, 'archTryAgain', t) })
  }, [t])
  const poll = useCallback(() => {
    stopPoll()
    timer.current = setInterval(async () => {
      const st = await fetch('/api/project-workbench/arch-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) }).then(r => r.json()).catch(() => null)
      if (!mounted.current) return
      const s = st?.data?.status
      if (st?.data?.phase === 'rendering') setRun({ busy: true, message: t('archRendering') })
      else if (st?.data?.phase === 'repairing') setRun({ busy: true, message: t('archRepairing') })
      if (s === 'done') { stopPoll(); setRun({ busy: false, message: t('archDone') }); load() }
      else if (s === 'failed') { stopPoll(); showRunFailure(st.data) }
      else if (s === 'stopping') { setRun({ busy: true, message: t('wikiStopping') }) }
      else if (s === 'idle') { stopPoll(); setRun(null) }
      else if (!st?.ok) { stopPoll(); setRun({ busy: false, message: t('generationStatusUnavailable') }) }
    }, 4000)
  }, [root, t, load, stopPoll, showRunFailure])
  // On mount: load the last diagram AND resume polling if a job is still running
  // (survives sidebar collapse / session switch, since the Host job persists).
  useEffect(() => {
    mounted.current = true
    load()
    let alive = true
    fetch('/api/project-workbench/arch-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) }).then(r => r.json()).then(st => {
      if (!alive) return
      if (st?.data?.status === 'running') {
        const ph = st.data.phase
        setRun({ busy: true, message: ph === 'rendering' ? t('archRendering') : ph === 'repairing' ? t('archRepairing') : t('archAuthoring') })
        poll()
      } else if (st?.data?.status === 'stopping') {
        setRun({ busy: true, message: t('wikiStopping') }); poll()
      } else if (st?.data?.status === 'failed') {
        showRunFailure(st.data)
      }
    }).catch(() => {})
    return () => { alive = false; mounted.current = false; stopPoll() }
  }, [root, load, poll, stopPoll, t, showRunFailure])
  const generate = async () => {
    setRun({ busy: true, starting: true, message: t('archAuthoring') })
    const res = await fetch('/api/project-workbench/arch-generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, sessionId }) }).then(r => r.json()).catch(() => null)
    if (!mounted.current) return
    if (!res?.ok) { showRunFailure(res ?? {}); return }
    setRun({ busy: true, message: t('archAuthoring') })
    poll()
  }
  const stop = async () => {
    const res = await fetch('/api/project-workbench/arch-stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) }).then(r => r.json()).catch(() => null)
    if (!mounted.current) return
    if (!res?.ok) { setRun({ busy: true, message: t('generationStopFailed') }); return }
    if (!res.data?.stopped) { poll(); return }
    stopPoll()
    setRun({ busy: false, message: t('wikiStopped') })
  }
  const openSource = async ref => {
    const token = ++sourceSeq.current
    const item = { label: ref.label, path: ref.path, from: ref.from, to: ref.to }
    setSource({ ...item, loading: true })
    const res = await rpc('probe/read', { root, path: item.path })
    if (!mounted.current || token !== sourceSeq.current) return
    setSource(res.ok ? { ...item, content: evidenceLines(res.data.content, item.from, item.to) } : { ...item, error: res })
  }
  const closeSource = () => { sourceSeq.current++; setSource(null) }
  return h('div', { className: 'pw-arch' },
    h('div', { className: 'pw-banner', role: 'status' },
      h('button', { className: 'pw-button primary', onClick: generate, disabled: run?.busy }, arch?.exists ? t('archRegenerate') : t('archGenerate')),
      run?.busy && h('button', { className: 'pw-button', onClick: stop, disabled: run.starting }, t('wikiStop')),
      h('span', { className: 'pw-count', style: { marginLeft: 8 } }, t('archHint')),
      run && !run.failed && h('span', { style: { marginLeft: 10 } }, run.message)),
    run?.failed && h('div', { className: 'pw-banner pw-error', role: 'alert' }, run.message),
    readError && h('div', { className: 'pw-banner pw-error', role: 'alert' },
      h(ErrorDetails, { error: readError, t, showRaw: false }),
      h('button', { className: 'pw-button', onClick: load }, t('retryRead'))),
    arch?.exists
      ? h(React.Fragment, null,
        h('iframe', { className: 'pw-arch-frame', title: t('archTitle'), srcDoc: arch.html, sandbox: 'allow-scripts allow-same-origin' }),
        h('section', { className: 'pw-evidence', 'aria-label': t('wikiEvidence') },
          h('span', { className: 'pw-label' }, t('wikiEvidence')),
          (arch.sources ?? []).length ? arch.sources.map((ref, index) => h('button', {
            key: index, className: 'pw-refchip pw-reflink', title: t('sourceOpen'),
            onClick: () => openSource(ref),
          }, ref.label ? ref.label + ' · ' : '', ref.path, ref.from ? `#L${ref.from}${ref.to > ref.from ? `-L${ref.to}` : ''}` : ''))
            : h('p', { className: 'pw-note' }, t('wikiNoEvidence'))))
      : !readError && h('div', { className: 'pw-init' }, h('h2', null, t('archTitle')), h('p', { className: 'pw-note' }, t(arch ? 'archEmpty' : 'loading'))),
    source && h(Modal, {
      title: source.path + (source.from ? ` · L${source.from}${source.to > source.from ? `–L${source.to}` : ''}` : ''), wide: true,
      onClose: closeSource, actions: [
        source.error && h('button', { className: 'pw-button', onClick: () => openSource(source) }, t('retry')),
        h('button', { className: 'pw-button primary', onClick: closeSource }, t('ok')),
      ],
    }, source.loading && h('p', { className: 'pw-note' }, t('loading')),
    source.error && h('p', { className: 'pw-error' }, t('sourceUnavailable')),
    source.content != null && h('pre', { className: 'pw-source-view' }, source.content)))
}
