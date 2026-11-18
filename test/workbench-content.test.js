import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { activityEntry, cancellationReason, draftFieldLabel, progressRecords, readingBlocks, requirementResult, reviewRecords, taskProgressRecords, taskResult, workbenchContentLocale, workbenchError } from '../client-src/workbench-content.js'
import * as store from '../core/store.js'
import { makeRoot } from './util.js'

test('a recent AI supplement shows the new result without promoting the old base text', () => {
  const resultSummary = '第一轮人工记录\n\n[AI 补充] 较早补充\n\n[AI 补充] 本轮修复了空名字的提示'
  const issue = { deliveryStartedAt: 10, resultAt: 12, objectiveAt: 11, resultFresh: true, resultSummary }
  const current = taskResult(issue)
  assert.equal(current.summary, '本轮修复了空名字的提示')
  assert.equal(current.latestSupplement, current.summary)
  assert.equal(current.earlierSummary, '第一轮人工记录\n\n[AI 补充] 较早补充')
  assert.equal(current.fullSummary, resultSummary)

  const reopened = taskResult({ ...issue, deliveryStartedAt: 20, resultFresh: false })
  assert.equal(reopened.summary, '')
  assert.equal(reopened.latestSupplement, '')
  assert.equal(reopened.earlierSummary, '')
  assert.equal(reopened.previousSummary, resultSummary)
  assert.equal(reopened.recordedSummary, '')
  const awaitingEvidence = taskResult({ ...issue, resultFresh: false })
  assert.equal(awaitingEvidence.summary, '')
  assert.equal(awaitingEvidence.recordedSummary, '本轮修复了空名字的提示')
  assert.equal(awaitingEvidence.previousSummary, resultSummary)
  const windowsLines = taskResult({ resultSummary: '旧结果\r\n\r\n[AI 补充] 新结果' })
  assert.equal(windowsLines.earlierSummary, '旧结果')
  assert.equal(windowsLines.latestSupplement, '新结果')
  assert.equal(windowsLines.fullSummary, '旧结果\r\n\r\n[AI 补充] 新结果')
  assert.equal(taskResult({ result: '旧格式结果\n\n### 客观记录（系统生成，请勿手改）\n执行细节' }).summary, '旧格式结果')
})

test('task limits are dated independently and unknown limits remain visible as unverified history', () => {
  const issue = { deliveryStartedAt: 100, resultAt: 0, resultFresh: false,
    knownLimits: '尚未验证窄屏', knownLimitsAt: 110 }
  assert.equal(taskResult(issue).limits, '尚未验证窄屏')
  assert.equal(taskResult(issue).unverifiedLimits, '')
  const laterRequirement = taskResult({ ...issue, resultAt: 150, resultFresh: true }, 200)
  assert.equal(laterRequirement.limits, '')
  assert.equal(laterRequirement.unverifiedLimits, '尚未验证窄屏')
  const legacy = taskResult({ ...issue, resultAt: 150, resultFresh: true, knownLimitsAt: 0 })
  assert.equal(legacy.limits, '')
  assert.equal(legacy.unverifiedLimits, '尚未验证窄屏')
})

test('proven same-round summary additions remain current while older mixed data stays uncertain', () => {
  const issue = { deliveryStartedAt: 100, resultAt: 120, resultFresh: true,
    objectiveAt: 115, resultSummary: '本轮第一项\n\n[AI 补充] 本轮第二项' }
  const current = taskResult({ ...issue, resultScopeAt: 100 })
  assert.equal(current.summary, '本轮第一项\n\n本轮第二项')
  assert.equal(current.unverifiedResultContext, '')
  const legacy = taskResult(issue)
  assert.equal(legacy.summary, '本轮第二项')
  assert.equal(legacy.unverifiedResultContext, '本轮第一项')
})

test('a prior round summary or cancellation impact cannot appear as the current decision', () => {
  const req = { deliveryStartedAt: 20, deliverySummaryAt: 22, cancelImpactAt: 17,
    deliverySummary: '本轮结果', cancelImpact: '上次范围变化', issues: [{ status: 'cancelled' }] }
  assert.deepEqual(requirementResult(req), {
    summary: '本轮结果', previousSummary: '', cancelImpact: '', previousCancelImpact: '上次范围变化',
  })
  assert.deepEqual(requirementResult({ ...req, deliveryStartedAt: 25 }), {
    summary: '', previousSummary: '本轮结果', cancelImpact: '', previousCancelImpact: '上次范围变化',
  })
})

test('older requirement body text remains readable without rewriting stored content', async t => {
  const root = await makeRoot(t)
  await store.initProject(root)
  const { id } = (await store.createRequirement(root, '旧需求')).data
  const path = join(root, '.project', 'requirements', id, 'requirement.md')
  const original = (await readFile(path, 'utf8')).replace('## 背景\n', '## 背景\n\n原有背景。\n').replace('## 决策记录\n', '## 决策记录\n\n先做空名字提醒。\n')
  await writeFile(path, original)
  const [req] = (await store.scanProject(root)).requirements
  assert.equal(req.background, '原有背景。')
  assert.equal(req.decisionNotes, '先做空名字提醒。')
  assert.equal(await readFile(path, 'utf8'), original)
})

test('activity and errors use readable labels and retain the original details', () => {
  const words = { ...workbenchContentLocale.zh, st_doing: '处理中', st_in_review: '等你确认', errGeneric: '出了点问题' }
  const t = key => words[key]
  const transition = '2026-11-15T12:34:22+08:00 doing → in_review（AI 提交结果）'
  assert.deepEqual(activityEntry(transition, t, 'task'), { date: '2026-11-15 12:34', text: '处理中 → 等你确认（AI 提交结果）', raw: transition })
  const log = '客观记录同步：会话 session-private 第 1–8 条（新增 2 条依据）'
  assert.deepEqual(activityEntry(log, t), { date: '', text: '新增 2 条处理记录', raw: log })
  assert.equal(activityEntry('用户备注，先做 test 1', t).text, '用户备注，先做 test 1')
  assert.equal(draftFieldLabel('rootCause', t), '为什么会这样')
  assert.equal(workbenchError({ code: 'REVIEW_INFO_REQUIRED', message: 'review needs: overview' }, t).text, '请先补全需求概述。')
  assert.deepEqual(workbenchError({ code: 'MISSING_START_FIELDS', message: 'fill before starting: problemOverview, acceptance' }, t), {
    text: '请先补全任务概述、完成标准。', raw: 'MISSING_START_FIELDS\nfill before starting: problemOverview, acceptance',
  })
  assert.deepEqual(workbenchError({ code: 'TOOLS_BUSY', message: 'Internal runtime message' }, t), {
    text: '出了点问题', raw: 'TOOLS_BUSY\nInternal runtime message',
  })
  assert.equal(workbenchError({ code: 'READ_FAILED', message: 'disk unavailable', method: 'requirement/get' }, t).raw,
    'READ_FAILED\ndisk unavailable\n接口：requirement/get')
  const reopen = workbenchError({ code: 'REOPEN_ITEM_FAILED', message: '重开未完成，剩余 1 项：iss-test；重试将沿用同一组任务（EACCES: permission denied）' }, t)
  assert.match(reopen.text, /不可写.*恢复权限或文件限制后重试/)
  assert.match(reopen.text, /已处理部分不会重复.*原 ID/)
})

test('sidebar progress keeps details with their summary, with stable identities after a prepend', () => {
  const t = key => workbenchContentLocale.zh[key] ?? key
  const note = '2026-11-16T16:20:00+08:00 [AI] 修复空名字提示\n空输入已验证。\n- 全空格待复测。'
  const legacy = '2026-11-15T21:26:00+08:00 人工操作：保存了原有说明'
  const sync = '2026-11-16T16:21:00+08:00 客观记录同步：会话 s 第 1–2 条（新增 2 条依据）'
  const original = taskProgressRecords([sync, note, legacy], t)
  assert.equal(original.length, 2)
  assert.equal(original[0].summary, '修复空名字提示')
  assert.equal(original[0].detail, '空输入已验证。\n- 全空格待复测。')
  assert.equal(original[1].detail, '保存了原有说明')
  const refreshed = taskProgressRecords([note, sync, note, legacy], t)
  assert.notEqual(refreshed[0].id, refreshed[1].id)
  assert.deepEqual(refreshed.slice(1), original)
})

test('legacy objective progress without a summary shows the evidence count in plain language', () => {
  const t = key => workbenchContentLocale.zh[key] ?? key
  const old = '2026-11-15T21:26:29+08:00 undefined（新增 3 条依据）'
  const [record] = taskProgressRecords([old], t)
  assert.equal(record.summary, '新增 3 条依据')
  assert.equal(record.detail, '新增 3 条依据')
  assert.equal(activityEntry(old, t, 'issue').raw, old)
  const regular = taskProgressRecords(['2026-11-16T11:51:13+08:00 实机验收：检查失败提示（新增 1 条依据）'], t)
  assert.equal(regular[0].summary, '实机验收：检查失败提示（新增 1 条依据）')
})
test('progress skips technical events and duplicate decisions while keeping legacy decisions and their reasons', () => {
  const t = key => ({ col_in_progress: '开发中', col_pending: '待验收', col_reviewing: '评审中', col_backlog: '需求池' })[key]
  const current = { kind: 'acceptance', decision: 'returned', marker: 'return-2', at: '2026-11-16T12:34:24+08:00', opinion: '需要补充提示' }
  const reviews = reviewRecords([current, { ...current }])
  assert.deepEqual(reviews, [current])
  const activity = [
    '2026-11-16T12:35:00+08:00 客观记录同步：会话 session-private 第 1–8 条（新增 2 条依据）',
    '2026-11-16T12:34:25+08:00 pending → in_progress（需要补充提示）',
    '2026-11-16T12:34:22+08:00 [AI] 开发中卡片现在可显示负责人。',
    '建议已采用：prop-private',
    '2026-11-13T12:34:22+08:00 reviewing → backlog（缺少覆盖范围）',
  ]
  assert.deepEqual(progressRecords(activity, t, 'requirement', reviews), [
    { date: '2026-11-16 12:34', text: '开发中卡片现在可显示负责人。', key: 2, event: false },
    { date: '2026-11-13 12:34', text: '评审中 → 需求池（缺少覆盖范围）', key: 4, event: true },
  ])
  assert.equal(cancellationReason({ activity: [
    '2026-11-16T12:34:22+08:00 blocked → cancelled（人工：与另一个任务重复）',
    '2026-11-13T12:34:22+08:00 doing → cancelled（人工：上一轮已处理）',
  ] }), '与另一个任务重复')
  assert.equal(cancellationReason({ activity: ['todo → cancelled'] }), '')
})

test('reading blocks preserve ordinary lines and authored list numbering', () => {
  assert.deepEqual(readingBlocks('首行\r\n第二行\r\n\r\n3. 第三项\r\n5、第五项\r\n\r\n- 甲\r\n* 乙\r\n1.5 V'), [
    { tag: 'p', lines: ['首行', '第二行'] },
    { tag: 'ol', lines: [{ number: 3, text: '第三项' }, { number: 5, text: '第五项' }] },
    { tag: 'ul', lines: ['甲', '乙'] },
    { tag: 'p', lines: ['1.5 V'] },
  ])
})

test('current verification reports failed and unresolved checks even after a successful pwd', async t => {
  const root = await makeRoot(t)
  await store.initProject(root)
  const { id: reqId } = (await store.createRequirement(root, '空名字提示')).data
  await store.updateRequirement(root, reqId, { goal: '提示填写名字', scope: '空名字', acceptance: '看到请填写名字' })
  for (const status of ['reviewing', 'ready', 'in_progress']) await store.moveRequirement(root, reqId, status)
  const { id } = (await store.createIssue(root, reqId, '修复空名字提示')).data
  const read = async () => (await store.scanProject(root)).requirements[0].issues[0]
  const since = (await read()).deliveryStartedAt
  const stamp = offset => new Date(since + offset).toISOString()
  const sid = 'session-checks'
  const command = (text, outcome, seq, offset, conclusion = '') => ({ seq, line: `- 执行命令：${text}（结果 ${outcome}${conclusion ? `，测试结论 ${conclusion}，测试摘要 # fail 0` : ''}，会话 ${sid} 第 ${seq} 条，${stamp(offset)}）` })
  const sync = entries => store.appendObjectiveSync(root, reqId, id, { sid, entries, activityPrefix: '测试记录' })
  await sync([
    command('node --test old.mjs', 'ok', 1, -5),
    command('node --test demo.mjs', 'exit:1', 2, 5),
    command('pwd', 'ok', 3, 10),
    command('npm run lint', 'background', 4, 15),
    { seq: 5, line: `- 待核实：demo.mjs（补丁请求未确认完成，会话 ${sid} 第 5 条，${stamp(20)}）` },
    command('cat demo.test.mjs', 'ok', 9, 21),
  ])
  assert.deepEqual(taskResult(await read()).verification, { status: 'failed', passed: 0, failed: 1, incomplete: 1, unconfirmedChanges: 1, hasManualEvidence: false })

  await sync([
    command('node --test demo.mjs', 'exit:0', 6, 25, 'passed'),
    command('npm run lint', 'ok', 7, 30),
    { seq: 8, line: `- 改动文件：demo.mjs（edit，会话 ${sid} 第 8 条，${stamp(35)}）` },
  ])
  const issue = await read()
  assert.deepEqual(taskResult(issue).verification, { status: 'passed', passed: 2, failed: 0, incomplete: 0, unconfirmedChanges: 0, hasManualEvidence: false })
  assert.match(issue.objective, /结果 exit:1/)
  assert.equal(taskResult(issue, since + 40).verification.status, 'unverified')
  await store.appendObjectiveSync(root, reqId, id, { sid, entries: [command('npm test', 'ok', 10, 45)] })
  const saved = await read()
  assert.ok(saved.activity.some(line => /已同步处理记录（新增 1 条依据）/.test(line)))
  assert.ok(!saved.activity.some(line => /undefined（新增/.test(line)))
})
