// File-backed project store (PRD §5/§9/§10, tech §3). Host is the single writer.
// All writes are atomic; ids are validated to prevent path traversal; corrupt
// files degrade to read-only diagnostics. New six-info fields default to empty
// on old files (no migration); terminal content is read-only until reopened.
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { join, basename, relative, isAbsolute, sep } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { atomicWrite, WorkbenchError } from './files.js'
import { parseFrontmatter } from './frontmatter.js'
import { canMoveRequirement, canMoveIssue, canCreateIssue, changesReviewedRequirement, freshDelivery, effectiveEvidence, taskContentBlockers, taskOverview, TASK_CONTENT_FIELDS, REQUIREMENT_STATES, ISSUE_STATES, TERMINAL_ISSUE } from './state.js'
import { evidenceFacts, isEvidenceCommand, isEvidenceOutcome, isObservationCommand, isVerificationCommand } from './extract.js'
import { readSplitEvidence } from './split-evidence.js'
import { listPrds, withPrdLock } from './prd.js'

export const SUPPORTED_SCHEMA = 2
const REQ_ID_RE = /^req-\d{8}-[0-9a-f]{6}$/
const ISS_ID_RE = /^iss-\d{8}-[0-9a-f]{6}$/
const MAX_ISSUES_WARN = 5000

const paths = root => ({
  dir: join(root, '.project'),
  project: join(root, '.project', 'project.md'),
  reqs: join(root, '.project', 'requirements'),
  trash: join(root, '.project', '.local', 'trash'),
  gitignore: join(root, '.project', '.gitignore'),
  runs: join(root, '.project', '.local', 'runs'),
  links: join(root, '.project', '.local', 'links'),
})

const yamlText = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')

function nowIso() {
  const d = new Date()
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const pad = n => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const wall = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19)
  return `${wall}${sign}${pad(off / 60)}:${pad(off % 60)}`
}
const dateStamp = () => nowIso().slice(0, 10).replace(/-/g, '')
const newId = prefix => `${prefix}-${dateStamp()}-${randomBytes(3).toString('hex')}`
const diag = (path, code, message, fix) => ({ path, code, message, fix })

async function exists(p) { try { await stat(p); return true } catch { return false } }
async function readText(p) { return readFile(p, 'utf8') }
// Content fingerprint: detects an external edit between read and save (§3.7); not a security token.
const hashText = text => createHash('sha256').update(text).digest('hex').slice(0, 20)
const blank = v => v === undefined || v === null || String(v).trim() === ''

function assertReqId(id) { if (!REQ_ID_RE.test(id)) throw new WorkbenchError('INVALID_ID', 'invalid requirement id') }
function assertIssId(id) { if (!ISS_ID_RE.test(id)) throw new WorkbenchError('INVALID_ID', 'invalid issue id') }

// Serialize the whole read/modify/write, including directory trash/restore.
// A requirement and all of its issue files share one queue so a directory move
// cannot race a child write and recreate an orphaned issue.
const requirementWrites = new Map()
export async function requirementKey(root, reqId) {
  assertReqId(reqId)
  // Different registered paths (including symlink aliases) may point at the
  // same workspace. They must share the same queue before any read or write.
  // If root cannot be resolved, run the ordinary operation with its original
  // path so its existing NOT_FOUND/access error behavior is preserved.
  let canonicalRoot
  try { canonicalRoot = await realpath(root) } catch { canonicalRoot = root }
  return join(canonicalRoot, '.project', 'requirements', reqId)
}
export async function withRequirementLock(root, reqId, action) {
  const key = await requirementKey(root, reqId)
  const previous = requirementWrites.get(key) ?? Promise.resolve()
  const next = previous.then(action, action)
  requirementWrites.set(key, next)
  const cleanup = () => { if (requirementWrites.get(key) === next) requirementWrites.delete(key) }
  void next.then(cleanup, cleanup)
  return next
}
export function withIssueLock(root, reqId, id, action) {
  assertIssId(id)
  return withRequirementLock(root, reqId, action)
}

// ---- body sections (tech §3.2/§3.4). Preserve unrelated body byte-for-byte. ----
function findHeading(body, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(' ', '[ \\t]+')
  return new RegExp(`^${escaped}[ \\t]*$`, 'm').exec(body)
}

export function getSection(body, heading) {
  const match = findHeading(body, `## ${heading}`)
  if (!match) return ''
  const rest = body.slice(match.index + match[0].length)
  const next = rest.search(/\r?\n#{1,2}[ \t]+/)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}
function setSection(doc, heading, text) {
  const body = doc.body
  const marker = `## ${heading}`
  const match = findHeading(body, marker)
  const block = `${marker}${doc.eol}${doc.eol}${text}${doc.eol}`
  if (!match) { doc.setBody(`${body}${doc.eol}${doc.eol}${block}`); return }
  const rest = body.slice(match.index + match[0].length)
  const next = rest.search(/\r?\n#{1,2}[ \t]+/)
  const tail = next === -1 ? '' : rest.slice(next)
  doc.setBody(body.slice(0, match.index) + block + tail)
}
// ### subsection inside ## 处理结果 (摘要 / 已知限制), keeping 客观记录 intact.
const RESULT_HEAD = '## 处理结果'
function getResultSub(doc, sub) {
  const section = getSection(doc.body, '处理结果')
  const match = findHeading(section, `### ${sub}`)
  if (!match) return ''
  const rest = section.slice(match.index + match[0].length)
  const next = rest.search(/\r?\n#{1,3}[ \t]+/)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}
function setResultSub(doc, sub, text) {
  const body = doc.body
  const match = findHeading(body, RESULT_HEAD)
  const prefix = match ? body.slice(0, match.index) : body + doc.eol + doc.eol
  const rest = match ? body.slice(match.index) : RESULT_HEAD
  const nextSection = rest.search(/\r?\n#{1,2}[ \t]+/)
  const end = nextSection === -1 ? rest.length : nextSection
  let section = rest.slice(0, end)
  const marker = `### ${sub}`
  const subheading = findHeading(section, marker)
  const block = `${marker}${doc.eol}${doc.eol}${text}${doc.eol}`
  if (!subheading) section += `${doc.eol}${doc.eol}${block}`
  else {
    const after = section.slice(subheading.index + subheading[0].length)
    const nextSub = after.search(/\r?\n#{1,3}[ \t]+/)
    const tail = nextSub === -1 ? '' : after.slice(nextSub)
    section = section.slice(0, subheading.index) + block + tail
  }
  doc.setBody(prefix + section + rest.slice(end))
}
// Objective evidence accumulates under a fixed subsection; dedup by session+seq
// is the caller's job (link sync). Exported so there is ONE implementation.
const OBJECTIVE_HEAD = '### 客观记录（系统生成，请勿手改）'
export function appendObjective(doc, lines) {
  const body = doc.body
  const match = findHeading(body, RESULT_HEAD)
  const prefix = match ? body.slice(0, match.index) : body + doc.eol
  const rest = match ? body.slice(match.index) : RESULT_HEAD
  const nextSection = rest.search(/\r?\n#{1,2}[ \t]+/)
  const end = nextSection === -1 ? rest.length : nextSection
  let section = rest.slice(0, end)
  const objective = findHeading(section, OBJECTIVE_HEAD)
  if (!objective) section += `${doc.eol}${doc.eol}${OBJECTIVE_HEAD}`
  const afterHeading = objective ? objective.index + objective[0].length : section.length
  const nextSub = section.slice(afterHeading).search(/\r?\n#{1,3}[ \t]+/)
  const insertAt = nextSub === -1 ? section.length : afterHeading + nextSub
  section = section.slice(0, insertAt).trimEnd() + doc.eol + lines.join(doc.eol) + doc.eol + section.slice(insertAt)
  doc.setBody(prefix + section + rest.slice(end))
}
// The objective-record subsection text (system-generated evidence lines).
export function objectiveText(body) {
  const section = getSection(body, '处理结果')
  const m = findHeading(section, OBJECTIVE_HEAD)
  if (!m) return ''
  const rest = section.slice(m.index + m[0].length)
  const next = rest.search(/\r?\n#{1,3}[ \t]+/)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}
// Use the same saved records to select evidence and to date it. Each delivery
// spans multiple sync batches (and can span multiple sessions).
function objectiveEvidence(content, since, savedTime) {
  const files = []
  const commands = []
  for (const line of content.split(/\r?\n(?=- (?:改动文件|执行命令|待核实)：)/)) {
    const stamp = line.match(/，(\d{4}-\d{2}-\d{2}T[^）]+)）/)?.[1]
    const time = stamp ? Date.parse(stamp) || 0 : 0
    const file = line.match(/^- (改动文件|待核实)：(.*)（[^，]+，会话 /s)
    if (file) files.push({ path: file[2], status: file[1] === '改动文件' ? 'confirmed' : 'unconfirmed', time })
    else if (line.startsWith('- 改动文件：')) files.push({ status: 'confirmed', time })
    const command = line.match(/^- 执行命令：(.*)（结果 ([^，]+)(?:，测试结论 (passed|failed|unknown)(?:，测试摘要 [^，]*)?)?，会话 /s)
    if (command) commands.push({ command: command[1], outcome: command[2], testConclusion: command[3], time })
  }
  const current = evidenceFacts({
    files: files.filter(f => f.time > since),
    commands: commands.filter(c => c.time > since),
  })
  let objectiveAt = 0
  for (const entry of [...current.files, ...current.commands]) objectiveAt = Math.max(objectiveAt, entry.time)
  // Keep historical evidence discoverable, and honor the original stamp when
  // the record predates the dated format and supplies no per-record times.
  const historical = evidenceFacts({ files, commands }, { includeObservations: true })
  const hasHistory = files.some(f => f.status === 'confirmed') || commands.some(c => isEvidenceOutcome(c.outcome))
  if ((historical.files.length || historical.commands.length) && !files.some(f => f.time) && !commands.some(c => c.time)) objectiveAt = savedTime
  return { hasObjective: hasHistory || objectiveAt > 0, objectiveAt, files, commands }
}

// A successful later retry supersedes the same check.
function latestVerificationChecks(commands, since) {
  const latestChecks = new Map()
  for (const command of commands) {
    if ((since && command.time <= since) || (!command.testConclusion && (isObservationCommand(command.command) || !isVerificationCommand(command.command)))) continue
    const last = latestChecks.get(command.command)
    if (!last || last.time <= command.time) latestChecks.set(command.command, command)
  }
  return [...latestChecks.values()].map(command => {
    const { outcome, testConclusion } = command
    let status = 'incomplete'
    if (testConclusion === 'failed') status = 'failed'
    else if (isEvidenceCommand(command)) status = 'passed'
    else if (outcome === 'error' || (/^exit:-?\d+$/.test(outcome) && !isEvidenceOutcome(outcome))) status = 'failed'
    return { command: command.command, outcome, status }
  })
}

export function taskVerificationChecks(issue, since) {
  const { commands } = objectiveEvidence(issue.objective ?? '', since, issue.objectiveAt)
  return latestVerificationChecks(commands, since)
}

function verificationFor({ files, commands }, since, evidence, evidenceAt) {
  const counts = { passed: 0, failed: 0, incomplete: 0 }
  for (const check of latestVerificationChecks(commands, since)) counts[check.status]++
  const { passed, failed, incomplete } = counts
  const latestFiles = new Map()
  for (const file of files) {
    if (!file.path || (since && file.time <= since)) continue
    const last = latestFiles.get(file.path)
    if (!last || last.time <= file.time) latestFiles.set(file.path, file)
  }
  const unconfirmedChanges = [...latestFiles.values()].filter(file => file.status === 'unconfirmed').length
  const status = failed ? 'failed' : passed && !incomplete && !unconfirmedChanges ? 'passed' : 'unverified'
  return { status, passed, failed, incomplete, unconfirmedChanges, hasManualEvidence: !blank(evidence) && evidenceAt >= since }
}

// Atomic objective-sync write (tech §6.4): the objective evidence lines AND the
// one progress activity line land in a SINGLE file write, deduped by session+seq
// (evidence) and exact text (activity). The caller advances the cursor only after
// this succeeds, so a failed write retries both together — never evidence without
// its progress entry. `entries` are {seq, line}; only unseen seqs are appended.
export async function appendObjectiveSync(root, reqId, id, { sid, entries, activityPrefix }) {
  return withIssueLock(root, reqId, id, async () => {
    if (await reqStatus(root, reqId) !== 'in_progress') return { added: 0 }
    const { file, doc } = await loadIssueDoc(root, reqId, id)
    if (TERMINAL_ISSUE.has(doc.get('status'))) return { added: 0 }
    const existingSeqs = new Set([...doc.body.matchAll(new RegExp(`会话 ${sid} 第 (\\d+) 条`, 'g'))].map(m => Number(m[1])))
    const fresh = (entries ?? []).filter(e => !existingSeqs.has(e.seq))
    if (!fresh.length) return { added: 0 }
    appendObjective(doc, fresh.map(e => e.line))
    const prev = Number(doc.get('objectiveAt')) || 0
    const since = Number(doc.get('deliveryStartedAt')) || 0
    const { objectiveAt } = objectiveEvidence(objectiveText(doc.body), since, prev)
    if (objectiveAt !== prev) doc.setPlain('objectiveAt', objectiveAt)
    const prefix = typeof activityPrefix === 'string' && activityPrefix.trim() ? activityPrefix.trim() : '已同步处理记录'
    const activityText = `${prefix}（新增 ${fresh.length} 条依据）`
    if (!extractActivity(doc.body).includes(activityText)) appendActivity(doc, `${nowIso()} ${activityText}`)
    doc.setPlain('updated', nowIso())
    await atomicWrite(file, doc.toString())
    return { added: fresh.length }
  })
}

// Terminal-task listeners (stage 3 §3.6): every entry that ends a task — RPC
// confirm/move AND proposal adoption — fires the same trigger, so the automatic
// delivery summary cannot be bypassed by choosing a different write path.
const terminalListeners = new Set()
export function onTaskTerminal(fn) { terminalListeners.add(fn); return () => terminalListeners.delete(fn) }
function emitTaskTerminal(root, reqId) { for (const fn of terminalListeners) { try { fn(root, reqId) } catch { /* a trigger must not break the write */ } } }

// ---- runtime reads (.local): execution locks and session links ----
async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }
async function readRunLock(root, issueId) { return readJson(join(paths(root).runs, `${issueId}.json`)) }
async function runningIssueIds(root, issues) {
  const out = []
  for (const i of issues) if (await readRunLock(root, i.id)) out.push(i.id)
  return out
}
async function hasLink(root, issueId) {
  let names = []
  try { names = await readdir(paths(root).links) } catch { return false }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const link = await readJson(join(paths(root).links, name))
    if (link?.issueId === issueId) return true
  }
  return false
}

// ---- initialization (explicit enable; reads never initialize) ----
export async function initProject(root, { name = basename(root), goal = '' } = {}) {
  if (!(await stat(root)).isDirectory()) throw new WorkbenchError('INVALID_ROOT', 'workspace path must be a directory')
  const p = paths(root)
  await mkdir(p.reqs, { recursive: true })
  await mkdir(join(p.dir, '.local'), { recursive: true })
  if (!(await exists(p.project))) {
    const ts = nowIso()
    const body = `\n<!-- 图例（自解释，必须保留）：\n     本文件是项目根。需求在 requirements/ 下，一条需求一个目录；issue 在对应需求的 issues/ 下。\n     wiki=项目 Wiki 位置（仓库根 openwiki/，OpenWiki 规范）：由 AI 维护、人用 git diff 审；工作台只读展示。\n-->\n`
    const fm = `---\nschema: ${SUPPORTED_SCHEMA}\nname: "${yamlText(name)}"\ngoal: "${yamlText(goal)}"\nflow: standard\nwiki: openwiki/\nupdated: ${ts}\n---\n`
    await atomicWrite(p.project, fm + body)
  }
  if (!(await exists(p.gitignore))) await atomicWrite(p.gitignore, '.local/\n._*\n.DS_Store\n')
  return { ok: true, data: { dir: p.dir, created: true } }
}

// ---- scanning / index (fault tolerant) ----
const ACTIVITY_HEAD = '## 活动'
function extractActivity(body) {
  const heading = findHeading(body, ACTIVITY_HEAD)
  if (!heading) return []
  const rest = body.slice(heading.index + heading[0].length)
  const end = rest.search(/\r?\n#{1,6}(?:[ \t]|$)/m)
  const records = []
  for (const line of (end === -1 ? rest : rest.slice(0, end)).split(/\r?\n/)) {
    if (line.startsWith('  > ') && records.length) records[records.length - 1] += '\n' + line.slice(4)
    else if (line.trim().startsWith('- ')) records.push(line.trim().slice(2).replace(/ <!-- pwb-update:[0-9a-f]{64} -->$/, ''))
  }
  return records
}
function decodePendingReopen(raw) {
  if (blank(raw)) return null
  try { const v = JSON.parse(raw); return v && Array.isArray(v.items) ? v : null } catch { return null }
}
function decodePendingDecision(raw) {
  if (blank(raw)) return null
  try { const v = JSON.parse(raw); return v && v.marker ? v : null } catch { return null }
}

// A partial scan cannot prove which tasks were reviewed. Keep other projects
// and unrelated requirements usable, but never submit or approve this delivery
// while one of its task files could not be interpreted reliably.
function assertDeliveryDataComplete(index, id) {
  const taskDir = join('requirements', id, 'issues')
  const incomplete = index.diagnostics.some(item =>
    (item.path === taskDir || item.path.startsWith(taskDir + sep)) &&
    ['READ_FAILED', 'MISSING_FRONTMATTER', 'MISSING_FIELD', 'INVALID_STATUS', 'SCHEMA_TOO_NEW'].includes(item.code))
  if (incomplete) throw new WorkbenchError('DELIVERY_DATA_INCOMPLETE', 'a task in this delivery could not be read or interpreted; repair it and review again')
}
// Write a decision record exactly once per attempt. A millisecond attempt marker
// is persisted in pendingDecision BEFORE the decision write, so a retry after any
// failed write reuses the same marker (idempotent), while a new attempt — even with
// identical wording in the same second — gets a fresh marker. The caller clears
// pendingDecision in the status write that completes the transition.
async function recordDecision(root, id, doc, file, { kind, decision, opinion, summary, originalHash, patch }) {
  let pending = decodePendingDecision(doc.get('pendingDecision'))
  if (!pending) {
    pending = { marker: `${Date.now()}-${randomBytes(3).toString('hex')}`, kind, decision, opinion, summary, originalHash, patch }
    doc.setString('pendingDecision', JSON.stringify(pending))
    await atomicWrite(file, doc.toString())
  } else if (pending.kind !== kind || pending.decision !== decision || pending.opinion !== opinion ||
      pending.summary !== summary || JSON.stringify(pending.patch) !== JSON.stringify(patch)) {
    throw new WorkbenchError('DECISION_PENDING', 'finish the previous decision before making another change')
  }
  await writeReview(root, id, { kind: pending.kind, decision: pending.decision, opinion: pending.opinion, summary: pending.summary, marker: pending.marker })
}

async function readReviews(root, reqId) {
  const dir = join(paths(root).reqs, reqId, 'reviews')
  let names = []
  try { names = await readdir(dir) } catch { return [] }
  const out = []
  for (const name of names.filter(n => /^\d+\.md$/.test(n)).sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]))) {
    try {
      const doc = parseFrontmatter(await readText(join(dir, name)))
      out.push({
        round: doc.get('round'), kind: doc.get('kind'), decision: doc.get('decision'),
        by: doc.get('by'), at: doc.get('at'), marker: doc.get('marker') ?? '',
        opinion: doc.get('opinionText') ?? getSection(doc.body, '意见'), summary: doc.get('summaryText') ?? getSection(doc.body, '交付摘要'),
      })
    } catch { /* a corrupt record degrades to absent; the decision list stays usable */ }
  }
  return out
}

function reqFromDoc(doc, path, slug) {
  return {
    id: doc.get('id'), slug, path,
    title: doc.get('title') ?? '', status: doc.get('status'),
    next: doc.get('next') ?? '', order: doc.get('order'),
    q_who: doc.get('q_who') ?? '', q_pain: doc.get('q_pain') ?? '',
    q_success: doc.get('q_success') ?? '', q_out: doc.get('q_out') ?? '',
    goal: doc.get('goal') ?? '', scope: doc.get('scope') ?? '', acceptance: doc.get('acceptance') ?? '',
    background: getSection(doc.body, '背景'), decisionNotes: getSection(doc.body, '决策记录'),
    deliverySummary: doc.get('deliverySummary') ?? '', cancelImpact: doc.get('cancelImpact') ?? '',
    submittedAt: doc.get('submittedAt') ?? '', reviewedAt: doc.get('reviewedAt') ?? '',
    deliveryStartedAt: Number(doc.get('deliveryStartedAt')) || 0,
    deliverySummaryAt: Number(doc.get('deliverySummaryAt')) || 0,
    cancelImpactAt: Number(doc.get('cancelImpactAt')) || 0,
    pendingReopen: decodePendingReopen(doc.get('pendingReopen')),
    refs: doc.get('refs') ?? [], schema: doc.get('schema'),
    created: doc.get('created'), updated: doc.get('updated'),
    activity: extractActivity(doc.body),
  }
}
function issueFromDoc(doc, path, requirementDeliveryStartedAt = 0) {
  const result = getSection(doc.body, '处理结果')
  const deliveryStartedAt = Number(doc.get('deliveryStartedAt')) || 0
  const objective = objectiveText(doc.body)
  const since = Math.max(deliveryStartedAt, Number(requirementDeliveryStartedAt) || 0)
  const { hasObjective, objectiveAt, files, commands } = objectiveEvidence(objective, since, Number(doc.get('objectiveAt')) || 0)
  const issue = {
    id: doc.get('id'), path, title: doc.get('title') ?? '', status: doc.get('status'),
    blocked_reason: doc.get('blocked_reason') ?? '', acceptance: doc.get('acceptance') ?? '',
    evidence: doc.get('evidence') ?? '', order: doc.get('order'), refs: doc.get('refs') ?? [],
    schema: doc.get('schema'), created: doc.get('created'), updated: doc.get('updated'),
    blockedAt: Number(doc.get('blockedAt')) || 0,
    inReviewAt: Number(doc.get('inReviewAt')) || 0,
    deliveryStartedAt, requirementDeliveryStartedAt: Number(requirementDeliveryStartedAt) || 0,
    resultAt: Number(doc.get('resultAt')) || 0,
    resultScopeAt: doc.get('resultScopeAt') == null ? null : Number(doc.get('resultScopeAt')),
    evidenceAt: Number(doc.get('evidenceAt')) || 0,
    knownLimitsAt: Number(doc.get('knownLimitsAt')) || 0,
    description: getSection(doc.body, '说明'),
    problemOverview: getSection(doc.body, '问题概述'),
    triggerPath: getSection(doc.body, '触发路径'),
    rootCause: getSection(doc.body, '根因'),
    result,
    resultSummary: getResultSub(doc, '摘要'),
    knownLimits: getResultSub(doc, '已知限制'),
    objective,
    hasObjective, objectiveAt,
    activity: extractActivity(doc.body),
  }
  // Both result and evidence must belong to this task delivery (see freshDelivery).
  issue.resultFresh = freshDelivery(issue, since)
  issue.verification = verificationFor({ files, commands }, since, issue.evidence, issue.evidenceAt)
  return issue
}
// Effective verification evidence lives in state.js (shared with the guards).

export async function scanProject(root) {
  const p = paths(root)
  const diagnostics = []
  const result = { project: null, requirements: [], diagnostics }
  try {
    if (!(await stat(root)).isDirectory()) throw new Error('workspace path must be a directory')
  } catch (e) {
    diagnostics.push(diag('.', 'WORKSPACE_MISSING', String(e.message ?? e), 'add or reopen the workspace in DSH'))
    return result
  }
  try {
    const doc = parseFrontmatter(await readText(p.project))
    if (!doc.hasFm) diagnostics.push(diag('.project/project.md', 'MISSING_FRONTMATTER', 'project.md has no frontmatter', 'restore the --- block'))
    else result.project = { name: doc.get('name'), goal: doc.get('goal'), schema: doc.get('schema'), wiki: doc.get('wiki'), updated: doc.get('updated') }
  } catch (e) {
    if (e.code === 'ENOENT') {
      diagnostics.push(diag('.project/project.md', 'NOT_INITIALIZED', 'no .project/project.md', 'run project/init'))
      return result
    }
    diagnostics.push(diag('.project/project.md', 'READ_FAILED', String(e.message ?? e), 'fix or restore the file'))
  }

  let slugs = []
  try { slugs = (await readdir(p.reqs, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name) } catch (e) {
    if (e.code !== 'ENOENT') diagnostics.push(diag('requirements', 'READ_FAILED', String(e.message ?? e), 'restore access to the requirements directory'))
  }
  const seenIds = new Set()
  let issueTotal = 0
  for (const slug of slugs.sort()) {
    const reqPath = join(p.reqs, slug, 'requirement.md')
    const rel = relative(p.dir, reqPath)
    let req
    try {
      const raw = await readText(reqPath)
      const doc = parseFrontmatter(raw)
      if (!doc.hasFm) { diagnostics.push(diag(rel, 'MISSING_FRONTMATTER', 'requirement.md has no frontmatter', 'restore the --- block')); continue }
      req = reqFromDoc(doc, reqPath, slug)
      req.hash = hashText(raw)
      req.issues = []
      req.reviews = await readReviews(root, req.id ?? slug)
      req.devHistory = req.reviews.length > 0 || req.activity.some(a => a.includes('→'))
      if (!req.id || !REQ_ID_RE.test(req.id)) diagnostics.push(diag(rel, 'MISSING_FIELD', 'missing/invalid id', 'add a stable req-YYYYMMDD-xxxxxx id'))
      if (!req.title) diagnostics.push(diag(rel, 'MISSING_FIELD', 'missing title', 'add a title'))
      if (!REQUIREMENT_STATES.includes(req.status)) {
        req.readOnly = true
        diagnostics.push(diag(rel, 'INVALID_STATUS', `bad status "${req.status}"`, 'use backlog|reviewing|ready|in_progress|pending|completed'))
      }
      if (req.schema > SUPPORTED_SCHEMA) { req.readOnly = true; diagnostics.push(diag(rel, 'SCHEMA_TOO_NEW', `schema ${req.schema} > ${SUPPORTED_SCHEMA}`, 'upgrade the plugin; file is read-only')) }
      if (req.id && seenIds.has(req.id)) diagnostics.push(diag(rel, 'DUPLICATE_ID', `duplicate id ${req.id}`, 'ids must be unique'))
      if (req.id) seenIds.add(req.id)
      if (req.id && req.id !== slug) diagnostics.push(diag(rel, 'ID_SLUG_MISMATCH', `id ${req.id} != directory ${slug} (R-06)`, 'keep id and directory name identical'))
      for (const ref of Array.isArray(req.refs) ? req.refs : []) {
        if (typeof ref === 'string' && isAbsolute(ref)) diagnostics.push(diag(rel, 'ABSOLUTE_REF', `ref "${ref}" is absolute (R-04)`, 'use a repository-relative path'))
      }
      for (const key of ['created', 'updated']) {
        if (req[key] && !Number.isFinite(Date.parse(req[key]))) diagnostics.push(diag(rel, 'BAD_TIMESTAMP', `${key} is not an ISO timestamp (R-05)`, 'use ISO 8601 with offset'))
      }
    } catch (e) {
      diagnostics.push(diag(rel, 'READ_FAILED', String(e.message ?? e), 'fix or restore the file'))
      continue
    }
    // issues
    const issuesDir = join(p.reqs, slug, 'issues')
    let files = []
    try { files = (await readdir(issuesDir)).filter(f => f.endsWith('.md') && !f.startsWith('.')) } catch (e) {
      if (e.code !== 'ENOENT') diagnostics.push(diag(relative(p.dir, issuesDir), 'READ_FAILED', String(e.message ?? e), 'restore access to the issues directory'))
    }
    for (const f of files.sort()) {
      const ip = join(issuesDir, f)
      const irel = relative(p.dir, ip)
      issueTotal++
      try {
        const raw = await readText(ip)
        const doc = parseFrontmatter(raw)
        if (!doc.hasFm) { diagnostics.push(diag(irel, 'MISSING_FRONTMATTER', 'issue has no frontmatter', 'restore the --- block')); continue }
        const issue = issueFromDoc(doc, ip, req.deliveryStartedAt)
        issue.hash = hashText(raw)
        if (!issue.id || !ISS_ID_RE.test(issue.id)) diagnostics.push(diag(irel, 'MISSING_FIELD', 'missing/invalid issue id', 'add iss-YYYYMMDD-xxxxxx'))
        if (!ISSUE_STATES.includes(issue.status)) {
          issue.readOnly = true
          diagnostics.push(diag(irel, 'INVALID_STATUS', `bad issue status "${issue.status}"`, 'use todo|doing|blocked|in_review|done|cancelled'))
        }
        if (issue.status === 'blocked' && !issue.blocked_reason) diagnostics.push(diag(irel, 'BLOCKED_REASON_REQUIRED', 'blocked issue lacks blocked_reason', 'add a one-line reason'))
        if (issue.updated && !Number.isFinite(Date.parse(issue.updated))) diagnostics.push(diag(irel, 'BAD_TIMESTAMP', 'updated is not an ISO timestamp (R-05)', 'use ISO 8601 with offset'))
        if (issue.schema > SUPPORTED_SCHEMA) { issue.readOnly = true; diagnostics.push(diag(irel, 'SCHEMA_TOO_NEW', `schema ${issue.schema} > ${SUPPORTED_SCHEMA}`, 'upgrade; read-only')) }
        req.issues.push(issue)
      } catch (e) {
        diagnostics.push(diag(irel, 'READ_FAILED', String(e.message ?? e), 'fix or restore the file'))
      }
    }
    if (req.status === 'backlog' && req.issues.length && !req.devHistory) diagnostics.push(diag(rel, 'BACKLOG_HAS_ISSUES', 'a draft with no development history has issue files', 'check the requirement and task history'))
    if (req.status === 'completed' && req.issues.some(i => !TERMINAL_ISSUE.has(i.status))) diagnostics.push(diag(rel, 'COMPLETED_OPEN_ISSUES', 'completed requirement has non-terminal issues (R-09)', 'close or cancel them'))
    result.requirements.push(req)
  }
  if (issueTotal > MAX_ISSUES_WARN) diagnostics.push(diag('.project', 'TOO_MANY_ISSUES', `${issueTotal} issues (> ${MAX_ISSUES_WARN})`, 'consider splitting the project'))
  return result
}

export async function validateProject(root) {
  const { diagnostics } = await scanProject(root)
  return { ok: diagnostics.length === 0, data: diagnostics }
}

// ---- requirement CRUD ----
function assertWritableDoc(doc, states) {
  if (!doc.hasFm) throw new WorkbenchError('MISSING_FRONTMATTER', 'file has no frontmatter and is read-only')
  if (doc.get('schema') > SUPPORTED_SCHEMA) throw new WorkbenchError('SCHEMA_TOO_NEW', 'file is read-only; upgrade the plugin')
  if (!states.includes(doc.get('status'))) throw new WorkbenchError('INVALID_STATUS', 'file has an unknown status and is read-only')
}

async function loadReqDoc(root, id) {
  assertReqId(id)
  const p = paths(root)
  const file = join(p.reqs, id, 'requirement.md')
  if (!(await exists(file))) throw new WorkbenchError('NOT_FOUND', `requirement ${id} not found`)
  const raw = await readText(file)
  const doc = parseFrontmatter(raw)
  assertWritableDoc(doc, REQUIREMENT_STATES)
  return { file, raw, doc }
}

function requestCreationId(kind, creation) {
  return `${kind}-${new Date(creation.time).toISOString().slice(0, 10).replaceAll('-', '')}-${creation.key.slice(0, 6)}`
}

function existingCreation(raw, creation, id) {
  if (parseFrontmatter(raw).get('creationKey') !== creation.key) {
    throw new WorkbenchError('CONFLICT', '记录编号发生冲突，请重新发送新建请求。')
  }
  return { ok: true, data: { id, reused: true } }
}

export async function createRequirement(root, title, fields, { creation } = {}) {
  if (!title || !String(title).trim()) throw new WorkbenchError('TITLE_REQUIRED', 'title is required')
  // The interactive RPC supplies fields. Internal callers can still make a legacy draft.
  if (fields !== undefined && (typeof fields?.q_pain !== 'string' || blank(fields.q_pain))) {
    throw new WorkbenchError('REVIEW_INFO_REQUIRED', 'creation needs: overview')
  }
  const p = paths(root)
  if (!(await exists(p.project))) throw new WorkbenchError('NOT_INITIALIZED', 'run project/init first')
  const id = creation ? requestCreationId('req', creation) : newId('req')
  const dir = join(p.reqs, id)
  const file = join(dir, 'requirement.md')
  const ts = nowIso()
  const fm = `---\nschema: ${SUPPORTED_SCHEMA}\nid: ${id}\ntitle: ""\nstatus: backlog\nnext: ""\norder: 0\ngoal: ""\nscope: ""\nacceptance: ""\nq_who: ""\nq_pain: ""\nq_success: ""\nq_out: ""\nrefs: []\ncreated: ${ts}\nupdated: ${ts}\n---\n`
  const body = `\n## 背景\n\n\n## 决策记录\n\n\n## 活动\n`
  const doc = parseFrontmatter(fm + body)
  doc.setString('title', String(title).trim())
  for (const key of ['q_pain', 'goal', 'scope', 'q_who', 'acceptance']) {
    if (fields?.[key] != null) doc.setString(key, String(fields[key]).trim())
  }
  const save = async () => {
    if (creation) {
      if (await exists(file)) return existingCreation(await readText(file), creation, id)
      doc.setString('creationKey', creation.key)
    }
    await mkdir(join(dir, 'issues'), { recursive: true })
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id } }
  }
  return creation ? withRequirementLock(root, id, save) : save()
}

const REQ_EDITABLE = new Set(['title', 'next', 'q_who', 'q_pain', 'q_success', 'q_out', 'order', 'goal', 'scope', 'acceptance'])
export async function updateRequirement(root, id, patch, { fileHash, confirmReviewInvalid = false, reason, proposalId } = {}) {
  return withRequirementLock(root, id, async () => {
    const { file, raw, doc } = await loadReqDoc(root, id)
    if (proposalId && extractActivity(doc.body).includes(`建议已采用：${proposalId}`)) return { ok: true, data: { id, alreadyApplied: true } }
    const pending = decodePendingDecision(doc.get('pendingDecision'))
    if (fileHash != null && hashText(raw) !== fileHash && pending?.originalHash !== fileHash) throw new WorkbenchError('CONFLICT', 'requirement changed since it was read; refresh and retry')
    const status = doc.get('status')
    if (status === 'pending' || status === 'completed') {
      throw new WorkbenchError('TERMINAL_READ_ONLY', 'requirement is pending/completed; reopen it before editing')
    }
    if (decodePendingReopen(doc.get('pendingReopen'))) {
      throw new WorkbenchError('REOPEN_PENDING', 'a reopen is in progress; finish it before editing the requirement')
    }
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (!REQ_EDITABLE.has(k)) throw new WorkbenchError('FIELD_NOT_EDITABLE', `cannot edit ${k}`)
    }
    if (patch?.title !== undefined && blank(patch.title)) throw new WorkbenchError('TITLE_REQUIRED', 'title is required')
    if (patch?.q_pain !== undefined && blank(patch.q_pain)) throw new WorkbenchError('REVIEW_INFO_REQUIRED', 'editing needs: overview')
    const substantive = (status === 'ready' || status === 'in_progress') &&
      changesReviewedRequirement(reqFromDoc(doc, file, id), patch ?? {})
    if (pending && (!substantive || JSON.stringify(pending.patch) !== JSON.stringify(patch))) {
      throw new WorkbenchError('DECISION_PENDING', 'finish the previous decision before making another change')
    }
    if (substantive && !confirmReviewInvalid) {
      throw new WorkbenchError('REVIEW_INVALIDATION_REQUIRED', 'substantive changes require a new review; confirm to return to the pool')
    }
    if (substantive) {
      const index = await scanProject(root)
      const req = index.requirements.find(r => r.id === id)
      const running = await runningIssueIds(root, req?.issues ?? [])
      const guard = canMoveRequirement({ from: status, to: 'backlog', title: doc.get('title'), issues: req?.issues ?? [], reason, confirmReviewInvalid, running, actor: 'human' })
      if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
      // Decision record before the status write, so a retry recovers it exactly once.
      await recordDecision(root, id, doc, file, { kind: 'review', decision: 'returned', opinion: `评审失效：${reason ?? '实质修改目标/范围/完成标准'}`, summary: '', originalHash: fileHash ?? hashText(raw), patch })
    }
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (k === 'order') doc.setPlain(k, Number(v))
      else doc.setString(k, v ?? '')
    }
    if (substantive) {
      doc.setPlain('status', 'backlog')
      doc.setString('pendingDecision', '')
      doc.setPlain('updated', nowIso())
      appendActivity(doc, `${nowIso()} ${status} → backlog（评审失效：${reason ?? '实质修改'}）`)
      await atomicWrite(file, doc.toString())
      return { ok: true, data: { id, invalidated: true } }
    }
    if (proposalId) appendActivity(doc, `建议已采用：${proposalId}`)
    doc.setPlain('updated', nowIso())
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id } }
  })
}

function appendActivity(doc, line, detail = '', syncKey) {
  const body = doc.body
  const marker = syncKey ? ` <!-- pwb-update:${syncKey} -->` : ''
  if (marker && body.includes(marker)) return false
  line += marker
  const heading = findHeading(body, ACTIVITY_HEAD)
  const lines = detail ? [line, ...detail.split(/\r?\n/).map(text => '  > ' + text)].join(doc.eol) : line
  if (!heading) doc.setBody(body + `${doc.eol}${ACTIVITY_HEAD}${doc.eol}- ${lines}${doc.eol}`)
  else {
    const after = heading.index + heading[0].length
    doc.setBody(body.slice(0, after) + `${doc.eol}- ${lines}` + body.slice(after))
  }
  return true
}

// GitHub-style append-only update log (requirement + issue).
export async function addRequirementUpdate(root, id, text, { syncKey } = {}) {
  if (!text || !String(text).trim()) throw new WorkbenchError('EMPTY_UPDATE', 'update text is required')
  return withRequirementLock(root, id, async () => {
    const { file, doc } = await loadReqDoc(root, id)
    if (decodePendingDecision(doc.get('pendingDecision'))) throw new WorkbenchError('DECISION_PENDING', 'finish the previous decision before recording progress')
    if (decodePendingReopen(doc.get('pendingReopen'))) throw new WorkbenchError('REOPEN_PENDING', 'finish reopening before recording progress')
    const status = doc.get('status')
    if (status === 'pending' || status === 'completed') {
      throw new WorkbenchError('TERMINAL_READ_ONLY', 'requirement is pending/completed; reopen it before editing')
    }
    if (!appendActivity(doc, `${nowIso()} ${String(text).trim().replace(/\n+/g, ' ')}`, '', syncKey)) {
      return { ok: true, data: { id, reused: true } }
    }
    doc.setPlain('updated', nowIso())
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id } }
  })
}

export async function addIssueUpdate(root, reqId, id, text, { syncKey } = {}) {
  if (!text || !String(text).trim()) throw new WorkbenchError('EMPTY_UPDATE', 'update text is required')
  return withIssueLock(root, reqId, id, async () => {
    const { file, doc } = await loadIssueDoc(root, reqId, id)
    if (TERMINAL_ISSUE.has(doc.get('status'))) throw new WorkbenchError('TERMINAL_READ_ONLY', 'task is done/cancelled; reopen it before recording progress')
    const [summary, ...details] = String(text).trim().split(/\r?\n/)
    if (!appendActivity(doc, `${nowIso()} ${summary.trim()}`, details.join('\n'), syncKey)) {
      return { ok: true, data: { id, reused: true } }
    }
    doc.setPlain('updated', nowIso())
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id } }
  })
}

// ---- review / acceptance decision records (tech §3.5). History is read-only. ----
// Idempotent: if the latest record already matches this decision AND marker (a
// previous attempt wrote it before failing), reuse it so a retry never duplicates
// it. The marker distinguishes separate attempts that share the same wording
// (e.g. two reopens with the same reason carry different reopen timestamps).
async function writeReview(root, reqId, { kind, decision, opinion = '', summary = '', marker = '' }) {
  const dir = join(paths(root).reqs, reqId, 'reviews')
  await mkdir(dir, { recursive: true })
  const existing = await readReviews(root, reqId)
  const last = existing[existing.length - 1]
  if (marker && last && last.marker === marker) {
    return last.round
  }
  const names = await readdir(dir)
  const round = names.filter(n => /^\d+\.md$/.test(n)).reduce((max, n) => Math.max(max, Number(n.slice(0, -3))), 0) + 1
  const fm = `---\nschema: ${SUPPORTED_SCHEMA}\nkind: ${kind}\nround: ${round}\ndecision: ${decision}\nby: human\nat: ${nowIso()}\nmarker: "${marker}"\nopinionText: ${JSON.stringify(opinion)}\nsummaryText: ${JSON.stringify(summary)}\n---\n`
  const body = `\n## 意见\n\n${opinion}\n\n## 交付摘要\n\n${summary}\n`
  await atomicWrite(join(dir, `${round}.md`), fm + body)
  return round
}

// Decision edges that leave a durable review/acceptance record.
const REVIEW_RECORD_EDGES = {
  'reviewing>ready': { kind: 'review', decision: 'approved' },
  'reviewing>backlog': { kind: 'review', decision: 'returned' },
  'ready>backlog': { kind: 'review', decision: 'returned' },
  'in_progress>backlog': { kind: 'review', decision: 'returned' },
  'pending>completed': { kind: 'acceptance', decision: 'approved' },
}

export async function moveRequirement(root, id, to, { reason, actor = 'human', opinion = '', fileHash, confirmReviewInvalid = false, reopenCount = 0, proposalId, expectFingerprint } = {}) {
  return withRequirementLock(root, id, async () => {
    const { file, raw, doc } = await loadReqDoc(root, id)
    const from = doc.get('status')
    if (proposalId && extractActivity(doc.body).includes(`建议已采用：${proposalId}`)) {
      return { ok: true, data: { id, to, alreadyApplied: true } }
    }
    const pending = decodePendingDecision(doc.get('pendingDecision'))
    if (fileHash != null && hashText(raw) !== fileHash && pending?.originalHash !== fileHash) {
      throw new WorkbenchError('CONFLICT', 'requirement changed since it was read; refresh and retry')
    }
    if (decodePendingReopen(doc.get('pendingReopen'))) {
      throw new WorkbenchError('REOPEN_PENDING', 'finish reopening before changing this requirement')
    }
    // Review invalidation must flow through requirement/update with an actual
    // substantive edit; the generic move entry cannot return a reviewed
    // requirement to the pool on a bare confirmation.
    if ((from === 'ready' || from === 'in_progress') && to === 'backlog') {
      throw new WorkbenchError('REVIEW_INVALIDATION_REQUIRED', 'returning a reviewed requirement to the pool requires a substantive change via requirement/update')
    }
    const index = await scanProject(root)
    const req = index.requirements.find(r => r.id === id)
    const issues = req?.issues ?? []
    if (from === 'pending' && to === 'completed') assertDeliveryDataComplete(index, id)
    // A status suggestion is only a location hint; adopting one must never
    // bypass the human confirmation of the actual delivery contents.
    if (from === 'pending' && to === 'completed' && proposalId && !expectFingerprint) {
      throw new WorkbenchError('FINGERPRINT_REQUIRED', 'review the delivery before acceptance')
    }
    // 验收通过核对用户看到的需求与任务内容指纹：任一任务在确认期间被改动，
    // 旧确认必须失效并重新核对（PRD §5.4），不能只依赖需求自身哈希。
    if (from === 'pending' && to === 'completed' && expectFingerprint != null &&
        deliveryFingerprint(req ?? { issues: [] }) !== expectFingerprint) {
      throw new WorkbenchError('ROUND_CHANGED', 'requirement or its tasks changed since the delivery was reviewed; re-check and confirm again')
    }
    const running = await runningIssueIds(root, issues)
    const guard = canMoveRequirement({
      from, to, title: doc.get('title'), issues, reason, actor,
      q_pain: doc.get('q_pain'), goal: doc.get('goal'),
      confirmReviewInvalid, running,
      summary: doc.get('deliverySummary'),
      pendingReopen: decodePendingReopen(doc.get('pendingReopen')), reopenCount,
      reqDeliveryStartedAt: Number(doc.get('deliveryStartedAt')) || 0,
      summaryAt: Number(doc.get('deliverySummaryAt')) || 0,
    })
    if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
    // Decision record before the status write, with a persisted attempt marker so
    // a failed write retries exactly once (see recordDecision).
    const record = REVIEW_RECORD_EDGES[`${from}>${to}`]
    if (!record && pending) throw new WorkbenchError('DECISION_PENDING', 'finish the previous decision before making another change')
    const commit = async () => {
      if (record) await recordDecision(root, id, doc, file, { ...record, opinion: opinion || reason || '', summary: doc.get('deliverySummary') ?? '', originalHash: fileHash })
      doc.setPlain('status', to)
      if (from === 'backlog' && to === 'reviewing') doc.setString('submittedAt', nowIso())
      if (from === 'reviewing' && to === 'ready') doc.setString('reviewedAt', nowIso())
      if (from === 'ready' && to === 'in_progress') {
        const priorStart = Number(doc.get('deliveryStartedAt')) || 0
        const latest = issues.reduce((value, issue) => Math.max(value, issue.deliveryStartedAt || 0, issue.resultAt || 0, issue.evidenceAt || 0, issue.objectiveAt || 0, issue.knownLimitsAt || 0, issue.resultScopeAt || 0), priorStart)
        doc.setPlain('deliveryStartedAt', Math.max(Date.now(), latest ? latest + 1 : 0))
      }
      if (record) doc.setString('pendingDecision', '')
      doc.setPlain('updated', nowIso())
      appendActivity(doc, `${nowIso()} ${from} → ${to}${reason ? `（${reason}）` : ''}`)
      if (proposalId) appendActivity(doc, `建议已采用：${proposalId}`)
      await atomicWrite(file, doc.toString())
      return { ok: true, data: { id, from, to } }
    }
    if (from !== 'backlog' || to !== 'reviewing') return commit()
    return withPrdLock(root, async directory => {
      if (!(await listPrds(directory, id)).length) {
        throw new WorkbenchError('REVIEW_PRD_REQUIRED', '请先关联一份 PRD，再提交评审。')
      }
      return commit()
    })
  })
}

// Bind the summary to the source files it was drafted from, including task
// activity such as cancellation reasons and any changes to the requirement.
export function deliveryFingerprint(req) {
  const tasks = (req.issues ?? []).map(i => [i.id, i.hash])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  return hashText(JSON.stringify([req.hash, tasks]))
}

// Submit for acceptance: save the summary, then enforce the shared PRD 9.5
// conditions. Auto (stage 3) and manual (stage 5) flows call this same entry.
export async function submitRequirement(root, id, { summary, cancelImpact = '', actor = 'human', expectFingerprint } = {}) {
  return withRequirementLock(root, id, async () => {
    const { file, doc } = await loadReqDoc(root, id)
    const from = doc.get('status')
    if (from !== 'in_progress') {
      // A manual submit can race the automatic delivery summary. When the
      // reviewed snapshot changed, tell the caller to reload it instead of
      // reporting a generic invalid move; never write the stale summary.
      if (expectFingerprint != null) {
        const index = await scanProject(root)
        assertDeliveryDataComplete(index, id)
        const req = index.requirements.find(r => r.id === id)
        if (deliveryFingerprint(req ?? { issues: [] }) !== expectFingerprint) {
          throw new WorkbenchError('ROUND_CHANGED', 'the delivery changed while the summary was drafted; re-draft for the current delivery')
        }
      }
      throw new WorkbenchError('ILLEGAL_TRANSITION', `move ${from} -> pending is not allowed`)
    }
    if (decodePendingReopen(doc.get('pendingReopen'))) throw new WorkbenchError('REOPEN_PENDING', 'finish reopening before submitting for acceptance')
    if (decodePendingDecision(doc.get('pendingDecision'))) throw new WorkbenchError('DECISION_PENDING', 'finish the previous decision before submitting')
    const index = await scanProject(root)
    const req = index.requirements.find(r => r.id === id)
    assertDeliveryDataComplete(index, id)
    // Same-delivery guard (§3.6): rechecked INSIDE the shared lock against the task
    // results the summary was drafted from — a task reopen/re-complete mid-flight
    // changes the fingerprint and rejects the stale summary.
    if (expectFingerprint != null && deliveryFingerprint(req ?? { issues: [] }) !== expectFingerprint) {
      throw new WorkbenchError('ROUND_CHANGED', 'the delivery changed while the summary was drafted; re-draft for the current delivery')
    }
    const stamp = Math.max(Date.now(), Number(doc.get('deliveryStartedAt')) || 0)
    if (!blank(summary)) { doc.setString('deliverySummary', String(summary).trim()); doc.setPlain('deliverySummaryAt', stamp) }
    if (!blank(cancelImpact)) { doc.setString('cancelImpact', String(cancelImpact).trim()); doc.setPlain('cancelImpactAt', stamp) }
    const guard = canMoveRequirement({
      from, to: 'pending', title: doc.get('title'), issues: req?.issues ?? [], actor,
      summary: doc.get('deliverySummary'),
      pendingReopen: decodePendingReopen(doc.get('pendingReopen')),
      reqDeliveryStartedAt: Number(doc.get('deliveryStartedAt')) || 0,
      summaryAt: Number(doc.get('deliverySummaryAt')) || 0,
    })
    if (!guard.ok) {
      // Preserve the entered summary even when conditions are not yet met.
      doc.setPlain('updated', nowIso())
      await atomicWrite(file, doc.toString())
      throw new WorkbenchError(guard.code, guard.reason)
    }
    doc.setPlain('status', 'pending')
    doc.setPlain('updated', nowIso())
    appendActivity(doc, `${nowIso()} ${from} → pending（提交验收）`)
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id, from, to: 'pending' } }
  })
}

// ---- issue CRUD ----
const issuePath = (root, reqId, id) => join(paths(root).reqs, reqId, 'issues', `${id}.md`)
async function loadIssueDoc(root, reqId, id) {
  assertReqId(reqId); assertIssId(id)
  const file = issuePath(root, reqId, id)
  if (!(await exists(file))) throw new WorkbenchError('NOT_FOUND', `issue ${id} not found`)
  const raw = await readText(file)
  const doc = parseFrontmatter(raw)
  assertWritableDoc(doc, ISSUE_STATES)
  return { file, raw, doc }
}
async function reqStatus(root, reqId) {
  const { doc } = await loadReqDoc(root, reqId)
  return doc.get('status')
}

function issueFileText(id, title, deliveryStartedAt, fields, creation) {
  const ts = nowIso()
  const fm = `---\nschema: ${SUPPORTED_SCHEMA}\nid: ${id}\ntitle: ""\nstatus: todo\nblocked_reason: ""\nacceptance: ""\nevidence: ""\norder: 0\nrefs: []\ndeliveryStartedAt: ${deliveryStartedAt}\ncreated: ${ts}\nupdated: ${ts}\n---\n`
  const doc = parseFrontmatter(fm + `\n## 说明\n\n`)
  doc.setString('title', title.trim())
  if (creation) doc.setString('creationKey', creation.key)
  // Validate and apply initial fields BEFORE writing, so an invalid proposal
  // never leaves a half-created task.
  if (fields) applyIssuePatch(doc, fields)
  return doc.toString()
}

function assertTaskContent(issue) {
  const missing = taskContentBlockers(issue)
  if (missing.length === 1 && missing[0] === 'title') throw new WorkbenchError('TITLE_REQUIRED', 'title is required')
  if (missing.length) throw new WorkbenchError('MISSING_TASK_FIELDS', `task needs: ${missing.join(', ')}`)
}

function initialTaskFields(fields = {}) {
  const initial = {}
  for (const [key, value] of Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))) {
    if (key === 'title' || !TASK_CONTENT_FIELDS.includes(key)) throw new WorkbenchError('FIELD_NOT_EDITABLE', `cannot set ${key} at creation`)
    if (key === 'refs' ? Array.isArray(value) && value.length : typeof value === 'string' && value.trim()) initial[key] = value
  }
  return initial
}

export const newIssueId = () => newId('iss')
export async function createIssue(root, reqId, title, fields = null, id = null, { reuseTitle = false, splitVersion, creation } = {}) {
  return withRequirementLock(root, reqId, async () => {
    const requestedId = creation ? requestCreationId('iss', creation) : id
    // Finishing a suggestion that already created its task does not create or modify a task.
    if (requestedId && await exists(issuePath(root, reqId, requestedId))) {
      return creation
        ? existingCreation(await readText(issuePath(root, reqId, requestedId)), creation, requestedId)
        : { ok: true, data: { id: requestedId, reused: true } }
    }
    const { doc: requirement } = await loadReqDoc(root, reqId)
    const status = requirement.get('status')
    const guard = canCreateIssue(status)
    if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
    if (decodePendingReopen(requirement.get('pendingReopen'))) throw new WorkbenchError('REOPEN_PENDING', 'finish reopening before creating a task')
    // Internal fixtures and the old prototype can still open a title-only task.
    if (fields === null) {
      if (typeof title !== 'string' || blank(title)) throw new WorkbenchError('TITLE_REQUIRED', 'title is required')
    } else {
      fields = initialTaskFields(fields)
      assertTaskContent({ ...fields, title })
    }
    // Check the assessment and look for a same-title task within the creation lock.
    if (reuseTitle || splitVersion) {
      const index = await scanProject(root)
      const current = index.requirements.find(req => req.id === reqId)
      const issues = current?.issues ?? []
      if (splitVersion && (current?.hash !== splitVersion.requirement || issues.length !== Object.keys(splitVersion.tasks).length ||
          issues.some(issue => splitVersion.tasks[issue.id] !== issue.hash))) {
        throw new WorkbenchError('DRAFT_STALE', '需求或任务进展已变化，请重新核对后再采用')
      }
      if (splitVersion?.sources?.length && (await readSplitEvidence(root, splitVersion.sources)).length !== splitVersion.sources.length) {
        throw new WorkbenchError('DRAFT_STALE', '建议引用的项目资料已变化，请重新核对后再采用')
      }
      const existing = reuseTitle && issues.find(issue => issue.title === title.trim())
      if (existing) return { ok: true, data: { id: existing.id, reused: true } }
    }
    const issueId = requestedId ?? newId('iss')
    const text = issueFileText(issueId, title, Math.max(Date.now(), Number(requirement.get('deliveryStartedAt')) || 0), fields, creation)
    await atomicWrite(issuePath(root, reqId, issueId), text)
    return { ok: true, data: { id: issueId, ...(splitVersion ? { hash: hashText(text) } : {}) } }
  })
}

const ISSUE_EDITABLE = new Set([...TASK_CONTENT_FIELDS, 'evidence', 'order', 'resultSummary', 'knownLimits'])
const ISSUE_SECTION_FIELDS = { description: '说明', problemOverview: '问题概述', triggerPath: '触发路径', rootCause: '根因' }
const RESULT_INVALIDATING_FIELDS = ['triggerPath', 'acceptance', 'resultSummary']
const TASK_RESULT_FIELDS = ['resultSummary', 'evidence', 'knownLimits']
// Validate + apply editable fields. Shared by create and update so a new task
// is written atomically with its fields. Result and evidence are stamped
// SEPARATELY: updating only one leaves the other stale for this delivery.
function applyIssuePatch(doc, patch, requirementDeliveryStartedAt = 0) {
  for (const k of Object.keys(patch ?? {})) {
    if (!ISSUE_EDITABLE.has(k)) throw new WorkbenchError('FIELD_NOT_EDITABLE', `cannot edit ${k}`)
  }
  let resultAuthored = false, evidenceAuthored = false, limitsAuthored = false
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k === 'order') doc.setPlain(k, Number(v))
    else if (k === 'refs') {
      const refs = Array.isArray(v) ? v : []
      for (const ref of refs) {
        if (typeof ref !== 'string' || !ref.trim()) throw new WorkbenchError('INVALID_REF', 'ref must be a non-empty string')
        if (isAbsolute(ref.trim())) throw new WorkbenchError('ABSOLUTE_REF', `ref "${ref}" must be repository-relative (R-04)`)
      }
      doc.setPlain('refs', `[${refs.map(r => `"${r.trim().replace(/"/g, '\\"')}"`).join(', ')}]`)
    }
    else if (ISSUE_SECTION_FIELDS[k]) setSection(doc, ISSUE_SECTION_FIELDS[k], v ?? '')
    else if (k === 'resultSummary') {
      const previous = getResultSub(doc, '摘要')
      const replacement = String(v ?? '')
      if (!blank(previous) && previous !== replacement && !replacement.includes(previous)) {
        appendActivity(doc, `${nowIso()} 此前记录的结果（轮次待核实）`, previous)
      }
      setResultSub(doc, '摘要', v ?? '')
      if (!blank(v)) resultAuthored = true
    }
    else if (k === 'knownLimits') {
      const previous = getResultSub(doc, '已知限制')
      const since = Math.max(Number(doc.get('deliveryStartedAt')) || 0, requirementDeliveryStartedAt)
      const previousAt = Number(doc.get('knownLimitsAt')) || 0
      const replacement = String(v ?? '')
      if (!blank(previous) && previous !== replacement && !replacement.includes(previous)) {
        const label = !previousAt || previousAt < since ? '此前记录的限制（本轮未核实）' : '此前记录的限制'
        appendActivity(doc, `${nowIso()} ${label}`, previous)
      }
      setResultSub(doc, '已知限制', v ?? '')
      limitsAuthored = true
    }
    else {
      if (k === 'evidence') {
        const previous = String(doc.get('evidence') ?? '')
        const replacement = String(v ?? '')
        if (!blank(previous) && previous !== replacement && !replacement.includes(previous)) {
          appendActivity(doc, `${nowIso()} 此前记录的验证依据（轮次待核实）`, previous)
        }
        if (!blank(v)) evidenceAuthored = true
      }
      doc.setString(k, v ?? '')
    }
  }
  const scopeStart = Math.max(Number(doc.get('deliveryStartedAt')) || 0, requirementDeliveryStartedAt)
  const now = Math.max(Date.now(), scopeStart)
  if (resultAuthored) {
    doc.setPlain('resultAt', now)
    doc.setPlain('resultScopeAt', scopeStart)
  }
  if (evidenceAuthored) doc.setPlain('evidenceAt', now)
  if (limitsAuthored) doc.setPlain('knownLimitsAt', now)
}
export async function updateIssue(root, reqId, id, patch, { fileHash, proposalId, actor = 'human', validateContent = false, recordResult = false } = {}) {
  return withIssueLock(root, reqId, id, async () => {
    const { file, raw, doc } = await loadIssueDoc(root, reqId, id)
    if (proposalId && extractActivity(doc.body).includes(`建议已采用：${proposalId}`)) return { ok: true, data: { id, alreadyApplied: true } }
    if (fileHash != null && hashText(raw) !== fileHash) throw new WorkbenchError('CONFLICT', 'issue changed since it was read; refresh and retry')
    const from = doc.get('status')
    const { doc: requirementDoc } = await loadReqDoc(root, reqId)
    const reqSince = Number(requirementDoc.get('deliveryStartedAt')) || 0
    // Done/cancelled tasks are content read-only, but a human list reorder only
    // rewrites the order field; content, result and status stay untouched.
    const orderOnly = Object.keys(patch ?? {}).length === 1 && Object.hasOwn(patch, 'order')
    if (TERMINAL_ISSUE.has(from) && !(orderOnly && actor === 'human')) throw new WorkbenchError('TERMINAL_READ_ONLY', 'task is done/cancelled; reopen it before editing')
    if (recordResult) {
      if (fileHash == null) throw new WorkbenchError('FINGERPRINT_REQUIRED', 'recording a result requires the task fingerprint')
      if (from === 'in_review') throw new WorkbenchError('INVALID_STATE', 'return the task before recording a new result')
      if (await readRunLock(root, id)) throw new WorkbenchError('RUNNING', 'stop the running task before recording a result')
      if (await reqStatus(root, reqId) !== 'in_progress') throw new WorkbenchError('REQ_NOT_ACTIVE', 'the requirement must be in development')
      if (Object.keys(patch ?? {}).some(key => !TASK_RESULT_FIELDS.includes(key))) throw new WorkbenchError('FIELD_NOT_EDITABLE', 'record only the result and verification')
      const task = issueFromDoc(doc, file, reqSince)
      const objective = task.hasObjective && task.objectiveAt >= Math.max(reqSince, task.deliveryStartedAt)
      if (blank(patch?.resultSummary) || (blank(patch?.evidence) && !objective)) {
        throw new WorkbenchError('RESULT_EVIDENCE_REQUIRED', 'record this round’s result and verification evidence')
      }
    }
    const current = {
      title: doc.get('title'), problemOverview: currentIssueField(doc, 'problemOverview'), description: currentIssueField(doc, 'description'),
    }
    if (validateContent && TASK_CONTENT_FIELDS.some(key => Object.hasOwn(patch ?? {}, key))) {
      assertTaskContent({ ...current, ...patch })
      // Older clients sent the unchanged result along with the task definition.
      patch = { ...patch }
      for (const key of ['resultSummary', 'evidence', 'knownLimits']) {
        if (patch[key] === currentIssueField(doc, key)) delete patch[key]
      }
    }
    // A substantive edit to a result awaiting confirmation invalidates that result.
    const invalidates = from === 'in_review' &&
      (taskOverview({ ...current, ...patch }) !== taskOverview(current) ||
        RESULT_INVALIDATING_FIELDS.some(k => patch?.[k] !== undefined && String(patch[k] ?? '') !== currentIssueField(doc, k)))
    const requirementStatus = (actor === 'ai' || invalidates) ? await reqStatus(root, reqId) : null
    if (actor === 'ai' && requirementStatus !== 'in_progress') {
      throw new WorkbenchError('REQ_NOT_ACTIVE', '所属需求不是开发中，拒绝写入')
    }
    if (invalidates) {
      const guard = canMoveIssue({ from, to: 'doing', requirementStatus, actor, resultInvalidated: true })
      if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
      doc.setPlain('deliveryStartedAt', Math.max(Date.now(), Number(doc.get('deliveryStartedAt')) || 0, (Number(doc.get('knownLimitsAt')) || 0) + 1, (Number(doc.get('resultScopeAt')) || 0) + 1))
      doc.setPlain('resultAt', 0)
      doc.setPlain('evidenceAt', 0)
      doc.setPlain('objectiveAt', 0)
    }
    applyIssuePatch(doc, patch, reqSince)
    if (invalidates) {
      doc.setPlain('status', 'doing')
      doc.setPlain('inReviewAt', 0)
      appendActivity(doc, `${nowIso()} in_review → doing（保存实质变更，原结果失效）`)
    }
    if (proposalId) appendActivity(doc, `建议已采用：${proposalId}`)
    doc.setPlain('updated', nowIso())
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id, invalidated: invalidates || undefined } }
  })
}
function currentIssueField(doc, k) {
  if (ISSUE_SECTION_FIELDS[k]) return getSection(doc.body, ISSUE_SECTION_FIELDS[k])
  if (k === 'resultSummary') return getResultSub(doc, '摘要')
  if (k === 'knownLimits') return getResultSub(doc, '已知限制')
  return String(doc.get(k) ?? '')
}

export async function moveIssue(root, reqId, id, to, { reason, blockedReason, actor = 'human', fileHash, proposalId } = {}) {
  return withIssueLock(root, reqId, id, async () => {
    const { file, raw, doc } = await loadIssueDoc(root, reqId, id)
    if (proposalId && extractActivity(doc.body).includes(`建议已采用：${proposalId}`)) return { ok: true, data: { id, alreadyApplied: true } }
    const from = doc.get('status')
    // Confirming completion checks the fingerprint of the displayed content.
    if (to === 'done' || (to === 'in_review' && fileHash != null)) {
      if (fileHash == null) throw new WorkbenchError('FINGERPRINT_REQUIRED', 'task acceptance requires the content fingerprint (fileHash)')
      if (hashText(raw) !== fileHash) throw new WorkbenchError('CONFLICT', 'task changed since it was read; refresh and re-check the result')
    }
    const { doc: requirementDoc } = await loadReqDoc(root, reqId)
    const requirementStatus = requirementDoc.get('status')
    const issue = issueFromDoc(doc, file, Number(requirementDoc.get('deliveryStartedAt')) || 0)
    const running = !!(await readRunLock(root, id))
    const linked = await hasLink(root, id)
    const guard = canMoveIssue({
      from, to, requirementStatus, reason, blockedReason, actor, linked, running,
      result: issue.resultSummary, evidence: effectiveEvidence(issue), acceptance: issue.acceptance, resultFresh: issue.resultFresh,
    })
    if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
    doc.setPlain('status', to)
    if (to === 'blocked') { doc.setString('blocked_reason', blockedReason); doc.setPlain('blockedAt', Date.now()) }
    if (from === 'blocked' && to !== 'blocked') { doc.setString('blocked_reason', ''); doc.setPlain('blockedAt', 0) }
    if (to === 'in_review') doc.setPlain('inReviewAt', Date.now())
    if (from === 'in_review' && to !== 'in_review') doc.setPlain('inReviewAt', 0)
    // Reopen / result-return resets this delivery's starting point; an old task
    // without one gets it backfilled on first start (no batch migration).
    if (to === 'todo' || (from === 'in_review' && to === 'doing')) {
      doc.setPlain('deliveryStartedAt', Math.max(Date.now(), Number(doc.get('deliveryStartedAt')) || 0, (Number(doc.get('knownLimitsAt')) || 0) + 1, (Number(doc.get('resultScopeAt')) || 0) + 1))
      doc.setPlain('resultAt', 0)
      doc.setPlain('evidenceAt', 0)
      doc.setPlain('objectiveAt', 0)
    }
    else if (to === 'doing' && !(Number(doc.get('deliveryStartedAt')) > 0)) doc.setPlain('deliveryStartedAt', Date.now())
    doc.setPlain('updated', nowIso())
    const who = actor === 'human' ? '人工' : actor === 'ai' ? 'AI' : '系统'
    const explanation = String((to === 'blocked' ? blockedReason : reason) ?? '').trim()
    appendActivity(doc, `${nowIso()} ${from} → ${to}（${who}）`, explanation)
    if (proposalId) appendActivity(doc, `建议已采用：${proposalId}`)
    await atomicWrite(file, doc.toString())
    if (to === 'done' || to === 'cancelled') emitTaskTerminal(root, reqId)
    return { ok: true, data: { id, from, to } }
  })
}

// Human confirmation of completion (PRD §9.4). Result + evidence may be supplied
// for direct completion; the fingerprint of the displayed content is required.
export async function confirmIssue(root, reqId, id, { summary, evidence, opinion = '', fileHash } = {}) {
  if (fileHash == null) throw new WorkbenchError('FINGERPRINT_REQUIRED', 'confirming completion requires the content fingerprint (fileHash)')
  return withIssueLock(root, reqId, id, async () => {
    const { file, raw, doc } = await loadIssueDoc(root, reqId, id)
    if (hashText(raw) !== fileHash) throw new WorkbenchError('CONFLICT', 'task changed since it was read; refresh and re-check the result')
    const from = doc.get('status')
    if (TERMINAL_ISSUE.has(from)) throw new WorkbenchError('ILLEGAL_TRANSITION', 'task is already done/cancelled')
    const patch = {}
    if (!blank(summary)) patch.resultSummary = String(summary).trim()
    if (!blank(evidence)) patch.evidence = String(evidence).trim()
    const { doc: requirementDoc } = await loadReqDoc(root, reqId)
    const reqSince = Number(requirementDoc.get('deliveryStartedAt')) || 0
    applyIssuePatch(doc, patch, reqSince)
    const requirementStatus = requirementDoc.get('status')
    const issue = issueFromDoc(doc, file, reqSince)
    const running = !!(await readRunLock(root, id))
    const guard = canMoveIssue({ from, to: 'done', requirementStatus, actor: 'human', running, result: issue.resultSummary, evidence: effectiveEvidence(issue), acceptance: issue.acceptance, resultFresh: issue.resultFresh })
    if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
    doc.setPlain('status', 'done')
    if (from === 'in_review') doc.setPlain('inReviewAt', 0)
    doc.setPlain('updated', nowIso())
    appendActivity(doc, `${nowIso()} ${from} → done（人工确认完成）`, [String(opinion ?? '').trim(), issue.resultSummary].filter(Boolean).join('\n\n'))
    await atomicWrite(file, doc.toString())
    emitTaskTerminal(root, reqId)
    return { ok: true, data: { id, from, to: 'done' } }
  })
}

// Human "continue modifying": save the modification requirement, invalidate the
// pending result and reset this delivery's starting point (PRD §10.3).
export async function continueIssue(root, reqId, id, { text, fileHash } = {}) {
  if (!text || !String(text).trim()) throw new WorkbenchError('REASON_REQUIRED', 'a modification requirement is required')
  return withIssueLock(root, reqId, id, async () => {
    const { file, raw, doc } = await loadIssueDoc(root, reqId, id)
    if (fileHash != null && hashText(raw) !== fileHash) throw new WorkbenchError('CONFLICT', 'task changed since it was read; refresh and retry')
    const from = doc.get('status')
    if (from !== 'in_review') throw new WorkbenchError('INVALID_STATE', 'continue modifies a task awaiting confirmation (in_review); use run/start to resume processing')
    if (await readRunLock(root, id)) throw new WorkbenchError('RUNNING', 'stop the running task before requesting changes')
    const requirementStatus = await reqStatus(root, reqId)
    const guard = canMoveIssue({ from, to: 'doing', requirementStatus, actor: 'human', reason: text })
    if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
    doc.setPlain('status', 'doing')
    doc.setPlain('inReviewAt', 0)
    doc.setPlain('deliveryStartedAt', Math.max(Date.now(), Number(doc.get('deliveryStartedAt')) || 0, (Number(doc.get('knownLimitsAt')) || 0) + 1, (Number(doc.get('resultScopeAt')) || 0) + 1))
    doc.setPlain('resultAt', 0)
    doc.setPlain('evidenceAt', 0)
    doc.setPlain('objectiveAt', 0)
    doc.setPlain('updated', nowIso())
    appendActivity(doc, `${nowIso()} ${from} → doing（继续修改：${String(text).trim().replace(/\n+/g, ' ')}）`)
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id, from, to: 'doing' } }
  })
}

// AI submit for confirmation (tech §6.4): validate acceptance and THIS delivery's
// evidence BEFORE writing anything, then write the result/limits and move to
// in_review in one lock. A failed validation leaves the task untouched (the
// summary is not saved first). The incoming summary is itself fresh result, so
// freshness here turns on the evidence belonging to the current delivery round.
export async function submitIssueResult(root, reqId, id, { summary, limits, actor = 'ai', fileHash } = {}) {
  if (blank(summary)) throw new WorkbenchError('RESULT_EVIDENCE_REQUIRED', 'submitting for confirmation needs a result summary')
  return withIssueLock(root, reqId, id, async () => {
    const { file, raw, doc } = await loadIssueDoc(root, reqId, id)
    if (fileHash != null && hashText(raw) !== fileHash) throw new WorkbenchError('CONFLICT', 'task changed since it was read; refresh and retry')
    const from = doc.get('status')
    if (from === 'in_review') return { ok: true, data: { id, alreadyPending: true } }
    if (from !== 'doing') throw new WorkbenchError('INVALID_STATE', 'only a task in progress can submit a result; record the start first')
    const { doc: requirementDoc } = await loadReqDoc(root, reqId)
    const requirementStatus = requirementDoc.get('status')
    const reqSince = Number(requirementDoc.get('deliveryStartedAt')) || 0
    if (requirementStatus !== 'in_progress') throw new WorkbenchError('REQ_NOT_ACTIVE', 'the requirement must be in development to submit a task result')
    const since = Math.max(reqSince, Number(doc.get('deliveryStartedAt')) || 0)
    const prospectiveBase = issueFromDoc(doc, file, reqSince)
    // This is an explicitly new summary written AFTER the sync above. Event
    // timestamps may be slightly ahead of the local clock; do not make that new
    // summary stale against the evidence it has just incorporated.
    const now = Math.max(Date.now(), since, Number(prospectiveBase.objectiveAt) || 0, Number(prospectiveBase.evidenceAt) || 0)
    const prospective = { ...prospectiveBase, resultAt: now, resultSummary: String(summary).trim() }
    const guard = canMoveIssue({
      from, to: 'in_review', requirementStatus, actor,
      result: prospective.resultSummary, evidence: effectiveEvidence(prospective), acceptance: prospective.acceptance,
      resultFresh: freshDelivery(prospective, since),
    })
    if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
    applyIssuePatch(doc, { resultSummary: String(summary).trim(), ...(!blank(limits) ? { knownLimits: String(limits).trim() } : {}) }, reqSince)
    doc.setPlain('status', 'in_review')
    doc.setPlain('inReviewAt', Date.now())
    doc.setPlain('updated', nowIso())
    appendActivity(doc, `${nowIso()} doing → in_review（${actor === 'ai' ? 'AI' : '人工'}提交结果，等你确认）`,
      [String(summary).trim(), !blank(limits) ? '已知限制：' + String(limits).trim() : ''].filter(Boolean).join('\n\n'))
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id, from, to: 'in_review' } }
  })
}

// Record the actual start of a run (todo/blocked → doing). Called by the link
// layer AFTER the host accepts the request; the caller owns the execution lock,
// so running is false here (the only lock is this run's own).
export async function recordRunStart(root, reqId, id, { fileHash } = {}) {
  return withIssueLock(root, reqId, id, async () => {
    const { file, doc, raw } = await loadIssueDoc(root, reqId, id)
    if (fileHash != null && hashText(raw) !== fileHash) throw new WorkbenchError('CONFLICT', 'task changed before recording its start; refresh and retry')
    const from = doc.get('status')
    if (from === 'doing') return { ok: true, data: { id, from, to: 'doing', changed: false } }
    const requirementStatus = await reqStatus(root, reqId)
    const issue = issueFromDoc(doc, file)
    const guard = canMoveIssue({ from, to: 'doing', requirementStatus, actor: 'system', reason: '开始处理', linked: true, running: false, result: issue.result, evidence: effectiveEvidence(issue), acceptance: issue.acceptance, resultFresh: issue.resultFresh })
    if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
    doc.setPlain('status', 'doing')
    if (from === 'blocked') { doc.setString('blocked_reason', ''); doc.setPlain('blockedAt', 0) }
    if (!(Number(doc.get('deliveryStartedAt')) > 0)) doc.setPlain('deliveryStartedAt', Date.now())
    doc.setPlain('updated', nowIso())
    appendActivity(doc, `${nowIso()} ${from} → doing（系统：开始处理）`)
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id, from, to: 'doing', changed: true } }
  })
}

// ---- reopen / return-to-development with resumable retry (tech §3.7.4) ----
// A retry continues the saved plan only when it carries the same selection (or
// no selection, meaning "continue"); a different selection must not hijack it.
function planMatches(plan, reopen, create) {
  const reqReopen = [...new Set(reopen ?? [])].sort()
  const reqCreate = (create ?? []).map(c => ({ title: String(c?.title ?? '').trim(), fields: initialTaskFields(c?.fields ?? {}) }))
  if (reqReopen.length === 0 && reqCreate.length === 0) return true
  const planReopen = (plan.request?.reopen ?? plan.items.filter(i => i.action === 'reopen').map(i => i.id)).slice().sort()
  const planCreate = plan.items.filter(i => i.action === 'create').map(i => ({ title: i.title, fields: initialTaskFields(i.fields ?? {}) }))
  return JSON.stringify(reqReopen) === JSON.stringify(planReopen) && JSON.stringify(reqCreate) === JSON.stringify(planCreate)
}
export async function reopenRequirement(root, id, { reason, reopen = [], create = [], fileHash } = {}) {
  return withRequirementLock(root, id, async () => {
    const { file, raw, doc } = await loadReqDoc(root, id)
    const from = doc.get('status')
    let plan = decodePendingReopen(doc.get('pendingReopen'))
    if (plan) {
      if ((reason != null && String(reason).trim() !== plan.reason) || !planMatches(plan, reopen, create)) {
        throw new WorkbenchError('REOPEN_CONFLICT', 'a different reopen plan is in progress; finish it before starting another')
      }
      // Recover the decision if the plan was saved before the decision write landed.
      if (plan.reviewRound == null) {
        plan.reviewRound = await writeReview(root, id, { kind: 'acceptance', decision: 'returned', opinion: plan.reason, summary: plan.summary ?? doc.get('deliverySummary') ?? '', marker: plan.marker ?? String(plan.atMs) })
        doc.setString('pendingReopen', JSON.stringify(plan))
        doc.setPlain('updated', nowIso())
        await atomicWrite(file, doc.toString())
      }
    } else {
      // A fresh request checks the fingerprint; a retry resuming a plan does not.
      if (fileHash != null && hashText(raw) !== fileHash) throw new WorkbenchError('CONFLICT', 'requirement changed since it was read; refresh and retry')
      if (from !== 'pending' && from !== 'completed') throw new WorkbenchError('ILLEGAL_TRANSITION', `move ${from} -> in_progress is not allowed`)
      const reopenIds = [...new Set(reopen)]
      for (const iid of reopenIds) {
        assertIssId(iid)
        const { doc: idoc } = await loadIssueDoc(root, id, iid)
        if (!TERMINAL_ISSUE.has(idoc.get('status'))) throw new WorkbenchError('ILLEGAL_TRANSITION', `task ${iid} is not done/cancelled; nothing to reopen`)
      }
      const createItems = (create ?? []).map(c => {
        const fields = initialTaskFields(c?.fields ?? {})
        assertTaskContent({ ...fields, title: c?.title })
        return { id: newId('iss'), action: 'create', title: c.title.trim(), fields, done: false }
      })
      const guard = canMoveRequirement({ from, to: 'in_progress', title: doc.get('title'), reason, actor: 'human', reopenCount: reopenIds.length + createItems.length })
      if (!guard.ok) throw new WorkbenchError(guard.code, guard.reason)
      // Allocate new-task IDs FIRST. Persist the plan + status BEFORE the decision
      // so any failed write retries against the same plan and the same attempt.
      // A new round starts after every existing result and summary, including
      // when the previous submission and reopen share a millisecond.
      const index = await scanProject(root)
      const existingIssues = index.requirements.find(req => req.id === id)?.issues ?? []
      const previousSummaryAt = Math.max(Number(doc.get('deliverySummaryAt')) || 0, Number(doc.get('cancelImpactAt')) || 0)
      const atMs = Math.max(Date.now(), previousSummaryAt + 1, ...existingIssues.map(issue =>
        Math.max(issue.resultAt || 0, issue.evidenceAt || 0, issue.objectiveAt || 0, issue.knownLimitsAt || 0, issue.resultScopeAt || 0) + 1))
      for (const item of createItems) issueFileText(item.id, item.title, atMs, item.fields)
      plan = {
        at: nowIso(), atMs, marker: `${atMs}-${randomBytes(3).toString('hex')}`, reason: String(reason).trim(), summary: doc.get('deliverySummary') ?? '', reviewRound: null,
        request: { reopen: reopenIds, create: createItems.map(c => c.title) },
        items: [
          ...reopenIds.map(iid => ({ id: iid, action: 'reopen', done: false })),
          ...createItems,
        ],
      }
      doc.setPlain('status', 'in_progress')
      doc.setPlain('deliveryStartedAt', atMs) // a new requirement delivery round
      doc.setString('pendingReopen', JSON.stringify(plan))
      doc.setPlain('updated', nowIso())
      appendActivity(doc, `${nowIso()} ${from} → in_progress（${plan.reason}）`)
      await atomicWrite(file, doc.toString())
      // Decision after the plan; its round is recorded so a retry never duplicates.
      plan.reviewRound = await writeReview(root, id, { kind: 'acceptance', decision: 'returned', opinion: plan.reason, summary: plan.summary, marker: plan.marker })
      doc.setString('pendingReopen', JSON.stringify(plan))
      doc.setPlain('updated', nowIso())
      await atomicWrite(file, doc.toString())
    }
    // Process items one by one; persist progress after each so a retry resumes.
    try {
      for (const item of plan.items) {
        if (item.done) continue
        if (item.action === 'reopen') {
          const { file: ifile, doc: idoc } = await loadIssueDoc(root, id, item.id)
          const st = idoc.get('status')
          if (st !== 'todo' && String(idoc.get('reopenMarker') ?? '') !== String(plan.marker ?? plan.atMs)) {
            const g = canMoveIssue({ from: st, to: 'todo', requirementStatus: 'in_progress', reason: plan.reason, actor: 'human' })
            if (!g.ok) throw new WorkbenchError(g.code, g.reason)
            idoc.setPlain('status', 'todo')
            if (st === 'in_review') idoc.setPlain('inReviewAt', 0)
            idoc.setPlain('deliveryStartedAt', plan.atMs)
            idoc.setString('reopenMarker', String(plan.marker ?? plan.atMs))
            idoc.setPlain('resultAt', 0)
            idoc.setPlain('evidenceAt', 0)
            idoc.setPlain('objectiveAt', 0)
            idoc.setPlain('updated', nowIso())
            appendActivity(idoc, `${nowIso()} ${st} → todo（${plan.reason}）`)
            await atomicWrite(ifile, idoc.toString())
          }
        } else if (!(await exists(issuePath(root, id, item.id)))) {
          // Existing file → reuse the ID (never match by title); else create it.
          await atomicWrite(issuePath(root, id, item.id), issueFileText(item.id, item.title, plan.atMs, item.fields))
        }
        item.done = true
        doc.setString('pendingReopen', JSON.stringify(plan))
        doc.setPlain('updated', nowIso())
        try { await atomicWrite(file, doc.toString()) } catch (e) { item.done = false; throw e }
      }
    } catch (e) {
      const unfinished = plan.items.filter(i => !i.done).map(i => i.action === 'create' ? `${i.id}（新建：${i.title}）` : i.id)
      throw new WorkbenchError('REOPEN_ITEM_FAILED', `重开未完成，剩余 ${unfinished.length} 项：${unfinished.join('、')}；重试将沿用同一组任务（${e.message}）`)
    }
    doc.setString('pendingReopen', '')
    doc.setPlain('updated', nowIso())
    appendActivity(doc, `${nowIso()} 重开完成：${plan.items.length} 项任务`)
    await atomicWrite(file, doc.toString())
    return { ok: true, data: { id, status: 'in_progress', reopenedAt: plan.at, reopenedAtMs: plan.atMs, items: plan.items } }
  })
}

// ---- soft delete: ONLY untouched drafts (PRD §10.3). Tasks are cancelled, not deleted. ----
export async function trash(root, kind, id, { fileHash } = {}) {
  const p = paths(root)
  if (kind !== 'requirement') throw new WorkbenchError('INVALID_KIND', 'only draft requirements can be deleted; cancel tasks instead')
  assertReqId(id)
  const src = join(p.reqs, id)
  const remove = async () => {
    if (!(await exists(src))) throw new WorkbenchError('NOT_FOUND', `requirement ${id} not found`)
    const { doc, raw } = await loadReqDoc(root, id)
    if (fileHash && hashText(raw) !== fileHash) throw new WorkbenchError('CONFLICT', '草稿已变化，请重新核对后移除。')
    if (doc.get('status') !== 'backlog') throw new WorkbenchError('NOT_A_DRAFT', 'only requirements in the pool can be deleted')
    const index = await scanProject(root)
    const req = index.requirements.find(r => r.id === id)
    if ((req?.issues ?? []).length) throw new WorkbenchError('NOT_A_DRAFT', 'requirement has tasks; it is not a draft')
    if (req?.devHistory) throw new WorkbenchError('NOT_A_DRAFT', 'requirement has development history; it cannot be deleted as a draft')
    const stamp = nowIso().replace(/[:.]/g, '-')
    const destDir = join(p.trash, stamp)
    await mkdir(destDir, { recursive: true })
    await rename(src, join(destDir, id))
    return { ok: true, data: { trashed: id, kind, id, location: relative(p.dir, join(destDir, id)) } }
  }
  return withRequirementLock(root, id, remove)
}

export async function listTrashedRequirements(root) {
  const p = paths(root)
  const listDirs = async path => {
    try { return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  const result = []
  for (const when of await listDirs(p.trash)) {
    for (const item of await listDirs(join(p.trash, when.name))) {
      if (!REQ_ID_RE.test(item.name)) continue
      const folder = join(p.trash, when.name, item.name)
      const file = join(folder, 'requirement.md')
      try {
        if (!(await lstat(file)).isFile()) continue
        const doc = parseFrontmatter(await readText(file))
        if (doc.hasFm && doc.get('id') === item.name) result.push({
          id: item.name, title: doc.get('title') || item.name, location: relative(p.dir, folder).split(sep).join('/'),
        })
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  return result
}

// ---- restore from trash (drafts come back to the pool, never auto-reviewed) ----
export async function restore(root, { location }) {
  const p = paths(root)
  if (typeof location !== 'string' || location.includes('..') || isAbsolute(location)) {
    throw new WorkbenchError('INVALID_PATH', 'invalid trash location')
  }
  const src = join(p.dir, location)
  if (!src.startsWith(p.trash + sep)) throw new WorkbenchError('PATH_ESCAPE', 'location is outside the trash')
  const label = src.split(sep).pop()
  if (label.includes('__')) throw new WorkbenchError('INVALID_PATH', 'only draft requirements can be restored')
  assertReqId(label)
  if (!(await exists(src))) throw new WorkbenchError('NOT_FOUND', 'trashed item not found')
  const dest = join(p.reqs, label)
  const recover = async () => {
    if (await exists(dest)) throw new WorkbenchError('ALREADY_EXISTS', 'an item with that id already exists')
    await mkdir(join(dest, '..'), { recursive: true })
    await rename(src, dest)
    return { ok: true, data: { restored: label } }
  }
  return withRequirementLock(root, label, recover)
}

// ---- refresh stamp: file mtime for polling, content hash for save checks ----
export async function taskStamp(root, reqId, id) {
  assertReqId(reqId); assertIssId(id)
  const file = issuePath(root, reqId, id)
  const info = await stat(file)
  const raw = await readText(file)
  return { modified: info.mtimeMs, hash: hashText(raw) }
}
