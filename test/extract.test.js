// Stage-1 V-5: extraction tests over REAL persisted log fragments (sanitized).
// normal.jsonl: bot-workspace session 800ff87c (write/edit/bash, incl. sandbox-denied
//   and invalid-argument edit failures). ptc.jsonl: anonymized PTC session events
//   (run_code with inner bash/edit/read/present dispatches, window-cut).
// Patch/outcome shapes follow the rc.3 tool contracts until real patch samples
// are captured from the demo run (see fixtures README).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalizeToolCalls, extractFacts, commandOutcome, patchPaths, patchFacts, successfulRecords, evidenceFacts, isEvidenceOutcome, isTestCommand, testConclusion } from '../core/extract.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = name => readFileSync(join(here, 'fixtures', 'session-events', name), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))

test('V-5 normal: pairs tool/call+result, counts only confirmed writes', () => {
  const recs = normalizeToolCalls(fixture('normal.jsonl'), 's-normal')
  assert.equal(recs.length, 18)
  assert.ok(recs.every(r => r.settled))
  const facts = extractFacts(recs, { root: '/demo/ws' })
  assert.deepEqual(facts.files.map(f => [f.path, f.op, f.status, f.seq]), [
    ['/demo/ws/bot/state.json', 'edit', 'confirmed', 99],
    ['/demo/ws/bot/state.json', 'write', 'confirmed', 132],
  ])
  // sandbox-denied (82/87) and invalid-argument (92) edits are NOT changes
  assert.equal(facts.commands.length, 6)
  assert.deepEqual(facts.commands.map(c => c.seq), [19, 36, 41, 47, 125, 137])
  assert.ok(facts.commands.every(c => c.outcome === 'ok'))
  assert.equal(facts.hasActivity, true)
  assert.deepEqual(facts.workbench, [])
})

test('V-5 PTC: pairs dispatch-start+dispatch by subCallId, ignores orphan/unsettled', () => {
  const recs = normalizeToolCalls(fixture('ptc.jsonl'), 's-ptc')
  const inner = recs.filter(r => r.mode === 'ptc')
  assert.equal(inner.length, 7)
  assert.ok(inner.every(r => r.settled))
  const outer = recs.filter(r => r.mode === 'normal')
  assert.equal(outer.length, 4)
  assert.equal(outer.filter(r => !r.settled).length, 2) // window-cut run_code calls
  const facts = extractFacts(recs, { root: '/demo/ptc-ws' })
  assert.deepEqual(facts.files.map(f => [f.op, f.status, f.seq]), [['edit', 'confirmed', 478]])
  assert.deepEqual(facts.commands.map(c => [c.command.slice(0, 12), c.outcome, c.seq]), [
    ['pwd', 'ok', 35], ['ls -la', 'ok', 37], ["python3 - <<", 'ok', 480],
  ])
  assert.equal(facts.hasActivity, true)
})

test('V-5 demo-run: live stage-1 run — workbench reads are not records, notes are', () => {
  const root = '/demo/workbench-a'
  const recs = normalizeToolCalls(fixture('demo-run.jsonl'), 'session-04014aeb')
  const facts = extractFacts(recs, { root })
  assert.deepEqual(facts.files.map(f => [f.path, f.op, f.status, f.seq]), [
    [`${root}/demo.mjs`, 'edit', 'confirmed', 44],
  ])
  assert.deepEqual(facts.commands.map(c => [c.command, c.outcome, c.seq]), [
    ['pwd && ls -la', 'ok', 30],
    ['node --test demo.test.mjs', 'ok', 51],
  ])
  // task_get is a read; only task_note counts as a successful AI record.
  assert.deepEqual(facts.workbench.map(w => [w.name, w.seq, w.isError]), [
    ['workbench_task_get', 20, false],
    ['workbench_task_note', 56, false],
  ])
  assert.deepEqual(successfulRecords(facts).map(w => w.name), ['workbench_task_note'])
  assert.equal(facts.hasActivity, true)
})

test('V-5 real patch results: success, preflight refusal, completed move (live apply_patch)', () => {
  const root = '/demo/workbench-a'
  const recs = normalizeToolCalls(fixture('patch.jsonl'), 'session-04014aeb')
  assert.equal(recs.length, 3)
  assert.ok(recs.every(r => r.settled && r.name === 'apply_patch'))
  const [ok, refused, move] = recs
  const okFacts = patchFacts(ok, root)
  assert.equal(okFacts.stopped, false)
  assert.deepEqual(okFacts.files.map(f => [f.path.split('/').pop(), f.op, f.status]).sort(), [
    ['added.txt', 'add', 'confirmed'], ['ok.txt', 'update', 'confirmed'],
  ])
  // Preflight refusal: nothing happened → nothing recorded.
  const refusedFacts = patchFacts(refused, root)
  assert.equal(refusedFacts.rejected, true)
  assert.deepEqual(refusedFacts.files, [])
  // Completed move: destination confirmed by M line; source deletion confirmed by meta.diffs.
  const moveFacts = patchFacts(move, root)
  assert.deepEqual(moveFacts.files.map(f => [f.path.split('/').pop(), f.op, f.status]).sort(), [
    ['moved.txt', 'update', 'confirmed'], ['src.txt', 'delete', 'confirmed'],
  ])
})

test('V-5 real partial + failed move (live apply_patch on APFS)', () => {
  const root = '/tmp/pw-patch-apfs'
  const recs = normalizeToolCalls(fixture('patch-extra.jsonl'), 'session-patch-apfs')
  assert.equal(recs.length, 2)
  const [partial, move] = recs
  // Partial: op1 completed (ok.txt), op2 failed before writing (locked.txt).
  assert.equal(partial.isError, false)
  assert.ok(partial.resultText.startsWith('Patch stopped after 1 of 2 operations.'))
  const pf = patchFacts(partial, root)
  assert.equal(pf.stopped, true)
  assert.deepEqual(pf.files.map(f => [f.path.split('/').pop(), f.op, f.status]), [
    ['ok.txt', 'update', 'confirmed'],
    ['locked.txt', 'requested', 'unverified'],
  ])
  // Failed move: destination written, source remains → only destination is a change.
  assert.ok(move.resultText.includes('was written; source'))
  const mf = patchFacts(move, root)
  assert.equal(mf.stopped, true)
  assert.deepEqual(mf.files.map(f => [f.path.split('/').pop(), f.op, f.status]), [
    ['moved.txt', 'move-write', 'confirmed'],
  ])
})

test('V-5 real bash logs preserve nonzero exit, explicit background and hard timeout', () => {
  const events = fixture('shell-outcomes.jsonl')
  // The first two calls and the timeout are from different live sessions.
  const main = normalizeToolCalls(events.filter(e => e.seq <= 24), 'shell-main')
  const hardTimeout = normalizeToolCalls(events.filter(e => e.seq >= 29), 'shell-timeout')
  assert.deepEqual(main.map(r => [r.name, r.settled, r.isError]), [['bash', true, false], ['bash', true, false]])
  assert.deepEqual(hardTimeout.map(r => [r.name, r.settled, r.isError]), [['bash', true, false]])
  const mainFacts = extractFacts(main, { root: '/demo/workspace' })
  const timeoutFacts = extractFacts(hardTimeout, { root: '/demo/workspace' })
  assert.deepEqual(mainFacts.commands.map(c => [c.command, c.outcome, c.seq]), [
    ['printf pw-exit-marker; exit 7', 'exit:7', 21],
    ['sleep 3; printf pw-bg-done', 'background', 24],
  ])
  assert.deepEqual(timeoutFacts.commands.map(c => [c.command, c.outcome, c.seq]), [['sleep 3', 'timeout', 30]])
  // A foreground program printing similar text must not masquerade as a job.
  assert.equal(commandOutcome({ settled: true, isError: false, args: { command: 'echo text' }, resultText: 'started background job fake' }), 'ok')
})

test('V-4 real PTC guard: inner write denied, inner bash allowed (live ptc preset)', () => {
  const recs = normalizeToolCalls(fixture('ptc-guard.jsonl'), 'session-a6ef9f78')
  const inner = recs.filter(r => r.mode === 'ptc')
  assert.deepEqual(inner.map(r => r.name), ['write', 'bash'])
  const [w, b] = inner
  assert.equal(w.isError, true)
  assert.equal(w.resultText, 'Error: .project/ 由工作台管理，请使用 workbench_* 工具，或在工作台界面操作。')
  assert.equal(b.isError, false)
  assert.ok(b.resultText.includes('ptc-ok'))
  const facts = extractFacts(recs, { root: '/demo/workbench-a' })
  assert.deepEqual(facts.files, []) // denied write is not a change
  assert.deepEqual(facts.commands.map(c => [c.command, c.outcome]), [['echo ptc-ok', 'ok']])
})

test('V-5 exclusions: .project writes and workbench tools are not engineering progress', () => {
  const ev = (seq, type, data) => ({ seq, time: 1700000000000 + seq, type, data })
  const call = (seq, callId, name, args) => ev(seq, 'tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
  const result = (seq, callId, text, isError = false, meta = null) => ev(seq, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }], isError }, meta })
  const events = [
    call(1, 'c1', 'write', { file_path: '/demo/ws/.project/project.md', content: 'x' }),
    result(2, 'c1', 'Updated file'),
    call(3, 'c2', 'write', { file_path: '/demo/ws/.project/.local/runs/x.json', content: 'x' }),
    result(4, 'c2', 'Updated file'),
    call(5, 'c3', 'workbench_task_note', { text: '进展' }),
    result(6, 'c3', '已记录'),
    call(7, 'c4', 'edit', { file_path: 'src/a.js', old_string: 'a', new_string: 'b' }),
    result(8, 'c4', 'updated'),
  ]
  const facts = extractFacts(normalizeToolCalls(events, 's'), { root: '/demo/ws' })
  assert.deepEqual(facts.files.map(f => f.path), ['/demo/ws/src/a.js'])
  assert.equal(facts.commands.length, 0)
  assert.deepEqual(facts.workbench, [{ name: 'workbench_task_note', seq: 6, isError: false, resultText: '已记录' }])
  assert.deepEqual(successfulRecords(facts).map(w => w.seq), [6])
  assert.equal(facts.hasActivity, true)
})

test('a no-op record call (no write) does not count as a successful record', () => {
  const ev = (seq, type, data) => ({ seq, time: seq, type, data })
  const call = (seq, callId, name, args) => ev(seq, 'tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
  const result = (seq, callId, text, isError = false) => ev(seq, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }], isError } })
  const events = [
    call(1, 's1', 'workbench_task_submit', { summary: 'x' }),
    result(2, 's1', '任务已在等你确认；如需修改请让用户选择继续修改'), // no-op, wrote nothing
    call(3, 'n1', 'workbench_task_note', { text: 'x' }),
    result(4, 'n1', '已记录'), // real write
  ]
  const facts = extractFacts(normalizeToolCalls(events, 's'), { root: '/demo/ws' })
  assert.deepEqual(successfulRecords(facts).map(w => w.seq), [4])
})

test('only successful commands count as verification evidence', () => {
  const ev = (seq, type, data) => ({ seq, time: seq, type, data })
  const call = (seq, callId, command) => ev(seq, 'tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: JSON.stringify({ command }) })
  const result = (seq, callId, text) => ev(seq, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }] } })
  const events = [
    call(1, 'ok', 'node --test a.mjs'), result(2, 'ok', '# tests 1\n# pass 1\n# fail 0\n[exit code: 0]'),
    call(3, 'fail', 'node --test b.mjs'), result(4, 'fail', 'fail\n[exit code: 1]'),
    ev(5, 'tool/call', { turn: 1, step: 1, callId: 'bg', name: 'bash', arguments: JSON.stringify({ command: 'sleep 100', run_in_background: true }) }), result(6, 'bg', 'started background job job-1'),
  ]
  const facts = extractFacts(normalizeToolCalls(events, 's'), { root: '/demo/ws' })
  assert.equal(facts.commands.length, 3) // all are activity
  assert.deepEqual(evidenceFacts(facts).commands.map(c => c.command), ['node --test a.mjs'])
  assert.equal(isEvidenceOutcome('exit:1'), false)
  assert.equal(isEvidenceOutcome('background'), false)
  assert.equal(isEvidenceOutcome('timeout'), false)
})

test('V-5 command facts keep bounded real output for grounded delivery summaries', () => {
  const output = `${'x'.repeat(2100)}\n你好， 小明 ！`
  const [fact] = extractFacts([{ name: 'bash', settled: true, args: { command: `node -e "${'x'.repeat(1100)}"` }, resultText: output, seq: 1, time: 1 }]).commands
  assert.equal(fact.command.length, 1000)
  assert.equal(fact.output.length, 2000)
  assert.ok(fact.output.includes('你好， 小明 ！'))
})

test('V-5 command outcomes: exit code, timeout, background, stop, signal stay distinct', () => {
  const rec = text => ({ settled: true, isError: false, resultText: text })
  assert.equal(commandOutcome(rec('done\n')), 'ok')
  assert.equal(commandOutcome(rec('boom\n[exit code: 2]')), 'exit:2')
  assert.equal(commandOutcome(rec('partial\n[timed out after 5000ms]\n[exit code: 124]')), 'timeout')
  assert.equal(commandOutcome(rec('[still running after 30000ms; moved to background job job-1]\nThe command keeps running in the background. You will be notified when it finishes; read newer output with job_output, stop it with job_kill.')), 'background')
  assert.equal(commandOutcome(rec('[stopped: user]')), 'stopped:user')
  assert.equal(commandOutcome(rec('partial\n[stopped: user]\n[killed by signal: SIGTERM]')), 'stopped:user')
  assert.equal(commandOutcome(rec('[killed by signal: SIGTERM]')), 'signal:SIGTERM')
  assert.equal(commandOutcome({ settled: true, isError: true, resultText: 'Error: spawn failed' }), 'error')
  assert.equal(commandOutcome({ settled: false }), 'pending')
  // tool success ≠ test pass: a test command exiting non-zero keeps its exit outcome
  assert.equal(commandOutcome(rec('tests 1 fail\n[exit code: 1]')), 'exit:1')
  for (const sample of ['[still running after 30000ms; moved to background job job-1]', '[timed out after 5000ms]', '[stopped: user]', '[killed by signal: SIGTERM]', '[exit code: 2]']) {
    assert.equal(commandOutcome(rec(`example ${sample}\nmore output`)), 'ok')
    assert.equal(commandOutcome(rec(`example ${sample}`)), 'ok')
  }
  assert.equal(commandOutcome({ ...rec('started background job fake\nmore output'), args: { run_in_background: true } }), 'ok')
})

test('test summaries distinguish explicit failures, success and unknown output', () => {
  for (const output of ['Tests: 1 failed, 1 total', '# tests 2\n# pass 1\n# fail 1', 'ℹ tests 2\nℹ pass 1\nℹ fail 1\nℹ skipped 1', '==== 1 failed, 1 passed in 0.03s ====', '==== 1 passed, 1 error in 0.1s ====', '==== 2 errors in 0.1s ====']) {
    assert.equal(testConclusion(output).status, 'failed')
  }
  for (const output of ['# tests 3\n# pass 3\n# fail 0', 'ℹ tests 438\nℹ pass 438\nℹ fail 0', 'Tests: 3 passed, 3 total', '==== 3 passed in 0.03s ====']) {
    assert.equal(testConclusion(output).status, 'passed')
  }
  for (const output of ['', 'pass', 'Tests started', 'ℹ tests 0\nℹ pass 0\nℹ fail 0', 'ℹ tests 2\nℹ pass 0\nℹ fail 0\nℹ skipped 2', 'ℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ skipped 1', 'ℹ tests 3\nℹ pass 1\nℹ fail 0', '# tests 2\n# pass 1\n# fail 0\n# cancelled 1', 'Tests: 1 skipped, 2 passed, 3 total', 'Tests: 2 passed, 3 total', '==== 1 passed, 1 xfailed in 0.1s ====', '==== 1 passed, 1 xpassed in 0.1s ====']) {
    assert.equal(testConclusion(output).status, 'unknown')
  }
  const nodePassed = '# tests 1\n# pass 1\n# fail 0'
  assert.equal(testConclusion(nodePassed).summary, 'tests 1; pass 1; fail 0')
  const passedFacts = extractFacts([{ name: 'bash', settled: true, args: { command: 'node --test' }, resultText: nodePassed, seq: 1, time: 1 }])
  assert.equal(passedFacts.commands[0].testSummary, 'tests 1; pass 1; fail 0')
  const nodeIncomplete = '# tests 2\n# pass 0\n# fail 0'
  const jestPassed = 'Tests: 1 passed, 1 total'
  for (const output of [nodePassed + '\n' + nodeIncomplete, nodeIncomplete + '\n' + jestPassed, jestPassed + '\n' + nodeIncomplete, jestPassed + '\nTests: 0 total', nodePassed + '\n# tests 1\n# pass 1']) {
    assert.equal(testConclusion(output).status, 'unknown', output)
  }
  assert.equal(testConclusion(nodePassed + '\n' + jestPassed).status, 'passed')
  assert.equal(testConclusion(nodePassed + '\n# tests 1\n# pass 0\n# fail 1').status, 'failed')
  assert.equal(testConclusion('Test Suites: 1 failed, 1 passed, 2 total\nTests: 2 passed, 2 total').status, 'failed')
  for (const suite of ['Test Suites: 1 skipped, 1 passed, 2 total', 'Test Suites: 1 passed, 2 total', 'Test Suites: 0 total']) {
    assert.equal(testConclusion(suite + '\n' + jestPassed).status, 'unknown', suite)
  }
  assert.equal(testConclusion('Test Suites: 1 passed, 1 total').status, 'unknown')
  assert.equal(testConclusion('Test Suites: 1 passed, 1 total\n' + jestPassed).status, 'passed')
  assert.equal(isTestCommand('npm run test:unit || true'), true)
  assert.equal(isTestCommand('npm run test:coverage || true'), true)
  const long = 'echo ' + 'x'.repeat(130) + ' && npm run test:unit || true'
  const facts = extractFacts([{ name: 'bash', settled: true, args: { command: long }, resultText: 'Tests: 1 failed, 1 total\n[exit code: 0]', seq: 1, time: 1 }])
  assert.equal(facts.commands[0].testConclusion, 'failed')
  assert.equal(evidenceFacts(facts).commands.length, 0)
})

test('V-5 apply_patch: success, partial failure, move-with-write, preflight refusal', () => {
  const base = { settled: true, isError: false, seq: 10, time: 1700000000000, args: {} }
  // Full success: A/M/D lines are the confirmed facts (moves render M at destination).
  const ok = patchFacts({ ...base, args: { input: '*** Begin Patch\n*** Add File: a.js\n+x\n*** Update File: b.js\n*** Move to: c.js\n@@\n-y\n+z\n*** End Patch' }, resultText: 'Success. Updated the following files:\nA a.js\nM c.js', meta: { diffs: [{ path: 'c.js', oldText: 'y', newText: 'z' }], stopped: false } }, '/demo/ws')
  assert.deepEqual(ok.files.filter(f => f.status === 'confirmed').map(f => [f.path, f.op]).sort(), [
    ['/demo/ws/a.js', 'add'], ['/demo/ws/c.js', 'update'],
  ])
  assert.equal(ok.files.length, 2) // move source b.js is resolved by its confirmed destination
  assert.equal(ok.stopped, false)
  // Partial: first op completed, second failed; requested-but-unconfirmed stays unverified.
  const partial = patchFacts({ ...base, args: { input: '*** Begin Patch\n*** Update File: a.js\n@@\n-y\n+z\n*** Update File: b.js\n@@\n-nope\n+q\n*** End Patch' }, resultText: 'Patch stopped after 1 of 2 operations.\nCompleted:\nM a.js\nFailed:\n- operation 2 (update b.js, patch line 6): context not found', meta: { diffs: [{ path: 'a.js', oldText: 'y', newText: 'z' }], stopped: true } }, '/demo/ws')
  assert.equal(partial.stopped, true)
  assert.deepEqual(partial.files.map(f => [f.path, f.status]), [
    ['/demo/ws/a.js', 'confirmed'], ['/demo/ws/b.js', 'unverified'],
  ])
  // Move failed AFTER writing the destination: destination is a confirmed change;
  // the source explicitly remains, so it is not a change and not unverified.
  const move = patchFacts({ ...base, args: { input: '*** Begin Patch\n*** Update File: src.js\n*** Move to: dst.js\n@@\n-a\n+b\n*** End Patch' }, resultText: 'Patch stopped after 0 of 1 operations.\nFailed:\n- operation 1 (move src.js -> dst.js, patch line 2): source removal failed\n  destination dst.js was written; source src.js remains', meta: { diffs: [{ path: 'dst.js', oldText: 'a', newText: 'b' }], stopped: true } }, '/demo/ws')
  assert.deepEqual(move.files.map(f => [f.path, f.op, f.status]), [
    ['/demo/ws/dst.js', 'move-write', 'confirmed'],
  ])
  // Preflight refusal: nothing happened, nothing is recorded (not even unverified).
  const refused = patchFacts({ ...base, isError: true, args: { input: '*** Begin Patch\n*** Update File: a.js\n@@\n-nope\n+q\n*** End Patch' }, resultText: 'Error: Patch rejected before any change (1 problems):\n- operation 1 (update a.js, patch line 2): context not found', meta: null }, '/demo/ws')
  assert.deepEqual(refused.files, [])
  assert.equal(refused.rejected, true)
})

test('V-5 patchPaths: every Add/Update/Delete/Move path is visible to the guard', () => {
  const input = '*** Begin Patch\n*** Add File: a.js\n+x\n*** Update File: dir/b.js\n*** Move to: dir/c.js\n@@\n-y\n+z\n*** Delete File: old.js\n*** End Patch'
  assert.deepEqual(patchPaths(input), ['a.js', 'dir/b.js', 'dir/c.js', 'old.js'])
})
