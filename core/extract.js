// Stage-1 V-5: extract objective facts from PERSISTED session events.
// Input is the durable event log shape ({seq,time,type,data}); normal calls pair
// tool/call ↔ tool/result by callId, PTC inner calls pair tool/ptc-dispatch-start
// ↔ tool/ptc-dispatch by subCallId. The log keeps rendered result text + meta,
// NOT the tool's original return object (apply_patch operations[].changes[] is
// absent), so patch facts come from result text + meta.diffs + meta.stopped.
import { isAbsolute, join, normalize, sep } from 'node:path'

export const textOf = content => (Array.isArray(content) ? content : [])
  .filter(b => b && b.type === 'text').map(b => b.text).join('\n')

function parseArgs(raw) {
  if (raw == null) return {}
  if (typeof raw === 'object') return raw // PTC arguments are already normalized
  try { return JSON.parse(raw) } catch { return { __unparsed: String(raw) } }
}

// Normalize both call modes into one record shape. Unsettled calls stay in the
// list with settled:false so callers never treat a started call as a result.
export function normalizeToolCalls(events, sessionId) {
  const pending = new Map()
  const records = []
  for (const e of events ?? []) {
    const d = e.data ?? {}
    if (e.type === 'tool/call') {
      const rec = { sessionId, mode: 'normal', callId: d.callId, name: d.name, args: parseArgs(d.arguments), callSeq: e.seq, time: e.time, turn: d.turn, step: d.step, settled: false }
      pending.set(d.callId, rec)
      records.push(rec)
    } else if (e.type === 'tool/result') {
      const rec = pending.get(d.message?.toolCallId)
      if (!rec) continue
      rec.settled = true
      rec.seq = e.seq
      rec.resultText = textOf(d.message?.content)
      rec.isError = d.message?.isError === true
      rec.meta = d.meta ?? null
      rec.error = d.error ?? null
    } else if (e.type === 'tool/ptc-dispatch-start') {
      const rec = { sessionId, mode: 'ptc', callId: d.subCallId, parentCallId: d.parentCallId, name: d.name, args: parseArgs(d.arguments), callSeq: e.seq, time: e.time, turn: pending.get(d.parentCallId)?.turn, settled: false }
      pending.set(d.subCallId, rec)
      records.push(rec)
    } else if (e.type === 'tool/ptc-dispatch') {
      const rec = pending.get(d.subCallId)
      if (!rec) continue
      rec.settled = true
      rec.seq = e.seq
      rec.resultText = textOf(d.content)
      rec.isError = d.isError === true
      rec.meta = d.meta ?? null
      rec.error = d.error ?? null
    }
  }
  return records
}

// All source/target paths named by a Codex-style patch input (guard + extraction).
export function patchPaths(input) {
  const paths = []
  for (const line of String(input ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*\*\*\* (?:Add|Update|Delete) File: (.+)$/) ?? line.match(/^\s*\*\*\* Move to: (.+)$/)
    if (m) paths.push(m[1].trim())
  }
  return paths
}

const absOf = (p, cwd) => (isAbsolute(p) ? normalize(p) : normalize(join(cwd ?? '.', p)))
// Within ONE patch record, the result text and meta.diffs may spell the same
// file differently (symlink prefixes, e.g. /tmp vs /private/tmp). Treat a
// path-boundary suffix match as the same file.
// shortcut: suffix equivalence can collide across roots in one patch; upgrade
// to host realpath canonicalization if that ever matters.
const samePath = (a, b) => {
  if (a === b) return true
  const [long, short] = a.length > b.length ? [a, b] : [b, a]
  return long.endsWith(short) // absolute paths: the suffix's leading '/' is the boundary
}
const hasPath = (map, p) => [...map.keys()].some(k => samePath(k, p))
// Extraction excludes every .project/ write (workbench's own writes never count
// as engineering progress); the guard separately allows .project/.local/.
export const insideProject = (p, root) => {
  const abs = absOf(p, root)
  const base = normalize(join(root ?? '.', '.project'))
  return abs === base || abs.startsWith(base + sep)
}

// bash/pwsh share the shell marker contract (dsh-shell parseExitStatus).
export function commandOutcome(rec) {
  if (!rec.settled) return 'pending'
  if (rec.isError) return 'error'
  const t = rec.resultText ?? ''
  // Explicit background calls return an immediate acknowledgement, whereas
  // timed foreground calls promoted to a job use the still-running marker.
  if (rec.args?.run_in_background === true && /^started background job \S+\s*$/.test(t)) return 'background'
  if (/(?:^|\n)\[still running after \d+ms; moved to background job [^\]\r\n]+\]\r?\nThe command keeps running in the background\. You will be notified when it finishes; read newer output with job_output, stop it with job_kill\.\s*$/.test(t)) return 'background'
  if (/(?:^|\n)\[timed out after \d+ms\](?:\r?\n\[stopped: [^\]\r\n]+\])?(?:\r?\n\[(?:killed by signal: [^\]\r\n]+|exit code: -?\d+)\])?\s*$/.test(t)) return 'timeout'
  const stopped = t.match(/(?:^|\n)\[stopped: ([^\]\r\n]+)\](?:\r?\n\[(?:killed by signal: [^\]\r\n]+|exit code: -?\d+)\])?\s*$/)
  if (stopped) return `stopped:${stopped[1]}`
  const signal = t.match(/(?:^|\n)\[killed by signal: ([^\]\r\n]+)\]\s*$/)
  if (signal) return `signal:${signal[1]}`
  const exit = t.match(/(?:^|\n)\[exit code: (-?\d+)\]\s*$/)
  if (exit) return `exit:${exit[1]}`
  return 'ok'
}

// Move pairs from the patch input: a confirmed destination resolves its source
// (the source was moved away, or explicitly remains) — never "unverified".
function movePairs(input) {
  const pairs = []
  let source = null
  for (const line of String(input ?? '').split(/\r?\n/)) {
    const u = line.match(/^\s*\*\*\* Update File: (.+)$/)
    if (u) { source = u[1].trim(); continue }
    const m = line.match(/^\s*\*\*\* Move to: (.+)$/)
    if (m && source) pairs.push([source, m[1].trim()])
    if (!/^\s*\*\*\*/.test(line)) continue
    if (!m) source = null
  }
  return pairs
}

// apply_patch: confirmed changes come from the rendered A/M/D lines (success or
// the Completed: section of a stopped patch) plus meta.diffs. A failed move may
// have written its destination ("destination X was written; source Y remains").
// Requested paths without confirmation stay unverified — never counted as done.
export function patchFacts(rec, cwd) {
  const files = []
  const requested = patchPaths(rec.args?.input)
  const confirmed = new Map() // abs path -> op
  const text = rec.resultText ?? ''
  const rejected = rec.isError && /Patch rejected before any change/.test(text)
  if (!rejected && rec.settled) {
    // Completed lines appear under "Success. Updated the following files:" or "Completed:".
    let section = null
    for (const line of text.split(/\r?\n/)) {
      if (/^Success\. Updated the following files:/.test(line)) { section = 'done'; continue }
      if (/^Completed:/.test(line)) { section = 'done'; continue }
      if (/^(Failed|Outcome unknown|Not executed):/.test(line)) { section = 'bad'; continue }
      if (/^Patch stopped after/.test(line)) { section = null; continue }
      const m = line.match(/^([AMD]) (.+)$/)
      if (m && section === 'done') {
        const op = m[1] === 'A' ? 'add' : m[1] === 'D' ? 'delete' : 'update'
        confirmed.set(absOf(m[2], cwd), op)
      }
      const mv = line.match(/^\s*destination (.+) was written; source (.+) remains$/)
      if (mv) confirmed.set(absOf(mv[1], cwd), 'move-write')
    }
    for (const diff of rec.meta?.diffs ?? []) {
      if (typeof diff?.path === 'string' && !hasPath(confirmed, absOf(diff.path, cwd))) confirmed.set(absOf(diff.path, cwd), diff.newText === '' ? 'delete' : 'update')
    }
  }
  const stopped = rec.meta?.stopped === true || /^Patch stopped after/m.test(text)
  for (const [abs, op] of confirmed) files.push({ path: abs, op, status: 'confirmed', seq: rec.seq, time: rec.time })
  if (!rejected && rec.settled) {
    const movedSources = new Set(movePairs(rec.args?.input)
      .filter(([, dst]) => hasPath(confirmed, absOf(dst, cwd)))
      .map(([src]) => absOf(src, cwd)))
    for (const p of requested) {
      const abs = absOf(p, cwd)
      if (hasPath(confirmed, abs) || [...movedSources].some(s => samePath(s, abs))) continue
      files.push({ path: abs, op: 'requested', status: 'unverified', seq: rec.seq, time: rec.time })
    }
  }
  return { files, stopped, rejected }
}

// Extract objective facts from normalized records. `root` is the session cwd
// (relative paths resolve against it). workbench_* calls are tracked separately
// as AI record attempts (V-2), never as engineering progress.
export function extractFacts(records, { root } = {}) {
  const files = []
  const commands = []
  const workbench = []
  for (const rec of records) {
    if (typeof rec.name !== 'string') continue
    if (rec.name.startsWith('workbench_')) {
      if (rec.settled) workbench.push({ name: rec.name, seq: rec.seq, isError: rec.isError, resultText: rec.resultText ?? '' })
      continue
    }
    if (!rec.settled) continue
    if (rec.name === 'write' || rec.name === 'edit') {
      const p = rec.args?.file_path
      if (typeof p !== 'string' || rec.isError) continue
      const abs = absOf(p, root)
      if (insideProject(abs, root)) continue
      files.push({ path: abs, op: rec.name, status: 'confirmed', seq: rec.seq, time: rec.time })
    } else if (rec.name === 'apply_patch') {
      const { files: pf } = patchFacts(rec, root)
      for (const f of pf) if (!insideProject(f.path, root)) files.push(f)
    } else if (rec.name === 'str_replace_editor') {
      const cmd = rec.args?.command
      if (!['create', 'str_replace', 'insert'].includes(cmd) || rec.isError) continue
      const p = rec.args?.path
      if (typeof p !== 'string') continue
      const abs = absOf(p, root)
      if (insideProject(abs, root)) continue
      files.push({ path: abs, op: cmd, status: 'confirmed', seq: rec.seq, time: rec.time })
    } else if (rec.name === 'bash' || rec.name === 'pwsh') {
      const command = String(rec.args?.command ?? '')
      if (!command.trim()) continue
      const conclusion = isTestCommand(command) ? testConclusion(rec.resultText) : null
      // shortcut: bounded excerpts prevent unbounded task-file growth; use the
      // original session log when a result beyond this excerpt needs review.
      const output = String(rec.resultText ?? '').slice(-2000)
      commands.push({ command: command.slice(0, 1000), outcome: commandOutcome(rec), ...(conclusion && { testConclusion: conclusion.status, testSummary: conclusion.summary }), ...(output && { output }), seq: rec.seq, time: rec.time })
    }
  }
  const hasActivity = files.some(f => f.status === 'confirmed') || commands.length > 0
  return { files, commands, workbench, hasActivity }
}

// Successful AI record calls (normal or PTC) — the V-2 "已成功记录" test.
// Only note/update/submit are records; workbench_task_get is a read. A call that
// returned a no-op explanation (e.g. submit on an already-pending task) did NOT
// write anything, so it must not count as a successful record. The formal tools
// signal a real write with a leading 已记录/已追加/已提交结果 marker.
const RECORD_TOOLS = new Set(['workbench_task_note', 'workbench_task_update', 'workbench_task_submit'])
const WROTE_MARKER = /^(已记录|已追加|已提交结果)/
export const successfulRecords = facts => facts.workbench.filter(w => !w.isError && RECORD_TOOLS.has(w.name) && WROTE_MARKER.test(w.resultText ?? ''))

// A command counts as verification EVIDENCE only when it confirmed success.
// Failed tests, timeouts, signals and background starts are activity, not proof.
export const isEvidenceOutcome = outcome => outcome === 'ok' || outcome === 'exit:0'
// A verification-type command (test/check/build/lint). Trivial commands (pwd, ls,
// echo) are not verification.
const VERIFICATION_CMD = /\b(?:test|tests|testing|check|build|lint|verify|spec|vitest|jest|pytest|tsc|eslint)\b/i
export const isVerificationCommand = cmd => VERIFICATION_CMD.test(String(cmd ?? ''))
// Test runners need an explicit result summary. A successful shell invocation
// alone (including `npm test || true`) cannot establish that tests passed.
export const isTestCommand = cmd => /(?:^|\s)(?:--test(?:=\S+)?|(?:test|tests)(?::[\w.-]+)?|vitest|jest|pytest)(?=\s|$)/i.test(String(cmd ?? ''))
export function testConclusion(output) {
  const lines = String(output ?? '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(line => line.trim())
  const failed = lines.find(line => /^(?:(?:#|ℹ)\s*fail\s+[1-9]\d*\b|not ok\s+\d+\b|(?:Tests?|Test Suites?):\s*.*\b[1-9]\d*\s+failed\b|=+\s*.*\b[1-9]\d*\s+(?:failed|errors?)\b)/i.test(line))
  if (failed) return { status: 'failed', summary: failed.slice(0, 240) }
  const groups = []
  let hasTestSummary = false
  let node = null
  const finishNode = () => {
    if (!node) return
    const complete = node.tests > 0 && node.pass === node.tests && node.fail === 0 && !node.cancelled && !node.skipped && !node.todo
    groups.push({ complete, summary: `tests ${node.tests}; pass ${node.pass}; fail ${node.fail}` })
    hasTestSummary = true
    node = null
  }
  for (const line of lines) {
    const count = line.match(/^(?:#|ℹ)\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/i)
    if (count) {
      const field = count[1].toLowerCase()
      if (node && Object.hasOwn(node, field)) finishNode()
      node ??= {}
      node[field] = Number(count[2])
      continue
    }
    if (/^(?:Tests?|Test Suites?):/i.test(line)) {
      finishNode()
      if (/^Tests?:/i.test(line)) hasTestSummary = true
      const counts = line.match(/\b([1-9]\d*)\s+passed\b.*\b([1-9]\d*)\s+total\b/i)
      groups.push({ complete: !!counts && counts[1] === counts[2] && !/\b[1-9]\d*\s+(?:skipped|pending|todo|xfailed|xpassed)\b/i.test(line), summary: line })
    } else if (/^=+.*(?:\bpassed\b|\bfailed\b|\bskipped\b|\bxfailed\b|\bxpassed\b|\berrors?\b|\bno tests ran\b)/i.test(line)) {
      finishNode()
      hasTestSummary = true
      groups.push({ complete: /\b[1-9]\d*\s+passed\b.*\bin\s+\d/i.test(line) && !/\b[1-9]\d*\s+(?:skipped|pending|todo|xfailed|xpassed|errors?)\b/i.test(line), summary: line })
    }
  }
  finishNode()
  if (hasTestSummary && groups.every(group => group.complete)) return { status: 'passed', summary: groups.map(group => group.summary).join(' | ').slice(0, 240) }
  return { status: 'unknown', summary: '' }
}
export const isEvidenceCommand = c => isEvidenceOutcome(c.outcome) && (c.testConclusion ? c.testConclusion === 'passed' : !isTestCommand(c.command))
const OBSERVATION_CMD = /^\s*(?:pwd|ls|dir|echo|printf|cat|type|Get-Location|Get-ChildItem|Get-Content)(?:\s[^;&|\r\n]*)?\s*$/i
export const isObservationCommand = cmd => OBSERVATION_CMD.test(String(cmd ?? ''))
// Objective facts that may support a delivery: confirmed file changes plus
// successful commands. Diagnostic commands stay in history but do not verify a
// result. When a verification failed, other successful commands cannot replace it.
export const evidenceFacts = (facts, { includeObservations = false } = {}) => {
  const commands = includeObservations ? facts.commands : facts.commands.filter(c => c.testConclusion || !isObservationCommand(c.command))
  const failedVerification = commands.some(c => (c.testConclusion || isVerificationCommand(c.command)) && !isEvidenceCommand(c))
  return {
    files: facts.files.filter(f => f.status === 'confirmed'),
    commands: commands.filter(c => isEvidenceCommand(c) && (!failedVerification || c.testConclusion || isVerificationCommand(c.command))),
  }
}
