import React from 'react'
import { rpc } from '../api.js'

const h = React.createElement
const { useEffect, useRef, useState } = React

// These strings are spread into the existing client locale by the host entry.
export const acceptanceAssistLocale = {
  zh: {
    acceptanceHelp: '任务验收辅助',
    acceptanceVerify: 'AI 辅助验收', acceptanceGuide: '生成实操验收步骤',
    acceptanceHelpDetails: '使用说明', acceptanceCheckReport: '查看 AI 验收报告',
    acceptanceGuideSteps: '实操验收步骤', acceptanceGuideExpected: '正常应看到',
    acceptanceGuideNotNeeded: '无需实操。请按任务完成标准核对测试和验证记录。',
    acceptanceGuideUnknown: '暂未找到可核对的用户操作入口。',
    acceptanceRunHint: 'AI 验收会尝试运行检查命令，可能消耗模型额度。',
    acceptanceVerifyNotice: 'AI 会尝试运行实际检查命令，可能消耗模型额度；文件只读不代表外部服务或环境隔离。请先确认适合在当前项目运行。',
    acceptanceGuideNotice: '实操步骤由 AI 起草，请先核对项目实际入口。发现异常可在任务的修改原因中反馈。',
    acceptanceHelpRunning: '正在处理，请稍候…', acceptanceHelpError: '验收辅助未完成',
    acceptanceReport: 'AI 说明（需自行核对）', acceptanceNoReport: '没有收到可用说明。',
    acceptanceCommands: '实际命令记录', acceptanceNoCommands: '本次没有记录实际执行的命令，不能据此认为测试已运行。',
    acceptanceCommandsUnavailable: '无法读取本次执行记录，不能判断命令是否运行；请查看对应子会话。',
    acceptanceCommand: '命令', acceptanceOutcome: '执行结果', acceptanceOutput: '实际输出摘录',
    acceptanceCommandOk: '命令执行成功', acceptanceCommandPending: '尚未结束', acceptanceCommandTimeout: '执行超时，未完成',
    acceptanceCommandError: '命令执行出错', acceptanceCommandStopped: '执行已中止，未完成', acceptanceCommandFailed: '命令执行失败', acceptanceCommandUnknown: '执行状态未知',
    acceptanceTestConclusion: '测试结论', acceptanceTestPassed: '测试通过', acceptanceTestFailed: '测试失败',
    acceptanceTestUnknown: '未核实', acceptanceTestSummary: '测试摘要',
    acceptanceUnknown: '未记录', acceptanceNoOutput: '未记录输出',
    acceptanceStale: '需求、任务或会话关联可能变化，或状态无法核对；此结果可能过时，请重新核对。',
    acceptanceRetryStale: '这是上一次结果，本次重新核对尚未成功，请勿当作本次结果。',
    acceptanceSourceLimit: '此结果只检查需求和任务记录是否变化，不检查项目源码是否变化，请结合当前项目核对。',
    acceptanceSession: '子会话记录', acceptanceOutputLimit: '输出只显示摘录，完整记录请查看对应子会话。',
    acceptanceSources: '核对到的资料原文', acceptanceSourcesInsufficient: '可核对的资料不足，请先确认实际入口和步骤。',
    acceptanceSourcesScope: '这里只核对了引用原文是否存在，不代表操作步骤一定正确。',
    acceptanceStayOpen: '本窗口内可离开后返回查看；重载插件后，本页的结果不会自动恢复。',
  },
  en: {
    acceptanceHelp: 'Task acceptance assistance',
    acceptanceVerify: 'Ask AI to check', acceptanceGuide: 'Create a hands-on acceptance guide',
    acceptanceHelpDetails: 'How it works', acceptanceCheckReport: 'View the AI check report',
    acceptanceGuideSteps: 'Hands-on acceptance steps', acceptanceGuideExpected: 'Expected result',
    acceptanceGuideNotNeeded: 'No hands-on steps needed. Review the tests and verification records against the task criteria.',
    acceptanceGuideUnknown: 'No user-facing action could be verified from the available information.',
    acceptanceRunHint: 'AI checks may run commands and use model credits.',
    acceptanceVerifyNotice: 'AI may run actual check commands and use model credits. Read-only files do not isolate external services or the environment. Make sure it is appropriate to run checks in this project.',
    acceptanceGuideNotice: 'Check the project’s actual entry point before following the AI draft. Report problems in the task’s change request.',
    acceptanceHelpRunning: 'Working, please wait…', acceptanceHelpError: 'Acceptance assistance did not complete',
    acceptanceReport: 'AI explanation (review it yourself)', acceptanceNoReport: 'No usable explanation was returned.',
    acceptanceCommands: 'Actual command records', acceptanceNoCommands: 'No executed command was recorded; this does not establish that tests ran.',
    acceptanceCommandsUnavailable: 'The execution records could not be read, so whether commands ran is unknown. Check the child conversation.',
    acceptanceCommand: 'Command', acceptanceOutcome: 'Outcome', acceptanceOutput: 'Actual output excerpt',
    acceptanceCommandOk: 'Command completed successfully', acceptanceCommandPending: 'Not finished', acceptanceCommandTimeout: 'Timed out; not completed',
    acceptanceCommandError: 'Command failed with an error', acceptanceCommandStopped: 'Stopped; not completed', acceptanceCommandFailed: 'Command failed', acceptanceCommandUnknown: 'Command status unknown',
    acceptanceTestConclusion: 'Test conclusion', acceptanceTestPassed: 'Tests passed', acceptanceTestFailed: 'Tests failed',
    acceptanceTestUnknown: 'Not verified', acceptanceTestSummary: 'Test summary',
    acceptanceUnknown: 'Not recorded', acceptanceNoOutput: 'No output recorded',
    acceptanceStale: 'The requirement, task or conversation link may have changed, or its state could not be checked. This result may be out of date.',
    acceptanceRetryStale: 'This is the previous result; the current check has not completed successfully.',
    acceptanceSourceLimit: 'This only checks for changes to the requirement and task records, not the project source files. Check the current project.',
    acceptanceSession: 'Child conversation', acceptanceOutputLimit: 'Output is an excerpt; see the child conversation for the complete record.',
    acceptanceSources: 'Verified source excerpts', acceptanceSourcesInsufficient: 'There are not enough verifiable sources. Check the actual entry points and steps first.',
    acceptanceSourcesScope: 'Only the existence of the quoted text was checked; the steps may still be incorrect.',
    acceptanceStayOpen: 'You can leave and return in this window; the result will not automatically return after the plugin reloads.',
  },
}

function outcomeText(outcome, t) {
  if (outcome === 'ok' || outcome === 'exit:0') return t('acceptanceCommandOk')
  if (outcome === 'background' || outcome === 'pending') return t('acceptanceCommandPending')
  if (outcome === 'timeout') return t('acceptanceCommandTimeout')
  if (outcome === 'error') return t('acceptanceCommandError')
  if (/^(?:signal|stopped):/.test(String(outcome ?? ''))) return t('acceptanceCommandStopped')
  const exit = String(outcome ?? '').match(/^exit:(-?\d+)$/)
  return exit ? `${t('acceptanceCommandFailed')} (${exit[1]})` : t('acceptanceCommandUnknown')
}

const notify = entry => { for (const listener of entry.listeners) listener() }

export function AcceptanceAssist({ req, issue, root, sessionId, t, busy = false, onRunningChange, memory, compact = false }) {
  const localMemory = useRef({})
  const cache = (memory ?? localMemory.current).acceptanceAssist ??= {}
  const entry = cache[JSON.stringify([root, req.id, issue.id])] ??= { pending: '', results: {}, error: null, listeners: new Set() }
  const [, redraw] = useState(0)
  const runningCallback = useRef(onRunningChange)
  const context = JSON.stringify([req.hash, req.status, issue.hash, issue.status])
  const reviewable = req.status === 'in_progress' && !req.pendingReopen && issue.status === 'in_review'
  runningCallback.current = onRunningChange
  useEffect(() => {
    const listener = () => { redraw(n => n + 1); runningCallback.current?.(!!entry.pending) }
    entry.listeners.add(listener)
    runningCallback.current?.(!!entry.pending)
    return () => { entry.listeners.delete(listener); runningCallback.current?.(false) }
  }, [entry])

  const run = async kind => {
    if (entry.pending || busy || !reviewable) return
    entry.pending = kind
    entry.error = null
    if (entry.results[kind]) entry.results[kind] = { ...entry.results[kind], outdated: true }
    notify(entry)
    try {
      const response = await rpc('acceptance/assist', { root, reqId: req.id, issueId: issue.id, sessionId, kind })
      if (!response?.ok) {
        entry.error = { kind, code: response?.code, message: response?.message }
      } else {
        entry.results[kind] = { ...response.data, context }
      }
    } catch (e) {
      entry.error = { kind, message: e instanceof Error ? e.message : String(e) }
    } finally {
      entry.pending = ''
      notify(entry)
    }
  }

  const renderResult = kind => {
    const result = entry.results[kind]
    if (!result) return null
    const stale = !!result.stale || !!result.outdated || result.context !== context || !!(sessionId && result.sessionId && sessionId !== result.sessionId)
    const staleNotice = stale && h('p', { className: 'pw-note', role: 'status' }, t(result.outdated ? 'acceptanceRetryStale' : 'acceptanceStale'))
    if (kind === 'guide') {
      if (result.guideStatus !== 'steps') return h(React.Fragment, null, staleNotice,
        h('p', { className: 'pw-note', role: 'status' }, t(result.guideStatus === 'not_needed' ? 'acceptanceGuideNotNeeded' : 'acceptanceGuideUnknown')))
      const sources = result.sources ?? []
      return h('section', { className: 'pw-reading-block pw-assist-report', 'aria-label': t('acceptanceGuideSteps') },
        staleNotice,
        h('h4', null, t('acceptanceGuideSteps')),
        h('ol', { className: 'pw-reading-list pw-guide-steps' }, result.steps.map(({ action, expected }, index) =>
          h('li', { key: index },
            h('span', null, action),
            h('p', { className: 'pw-note' }, t('acceptanceGuideExpected'), ' · ', expected)))),
        sources.length < result.sourcesRequested && h('p', { className: 'pw-note' }, t('acceptanceSourcesInsufficient')),
        h('details', { className: 'pw-disclosure pw-assist-disclosure' },
          h('summary', null, t('acceptanceSources')),
          sources.map((source, index) => h('div', { key: index, className: 'pw-reading-block' },
            h('strong', null, source.path),
            h('p', { className: 'pw-text' }, source.quote))),
          h('p', { className: 'pw-note' }, t('acceptanceSourcesScope')),
          h('p', { className: 'pw-note' }, t('acceptanceSourceLimit')),
          result.childId && h('p', { className: 'pw-note' }, t('acceptanceSession'), '：', result.childId)))
    }
    const commands = Array.isArray(result.commands) ? result.commands : []
    const report = h('section', { className: 'pw-reading-block pw-assist-report', 'aria-label': t('acceptanceVerify') },
      !compact && staleNotice,
      h('p', { className: 'pw-note' }, t('acceptanceSourceLimit')),
      h('h4', null, t('acceptanceReport')),
      h('p', { className: 'pw-text', style: { whiteSpace: 'pre-wrap' } }, typeof result.report === 'string' && result.report.trim() ? result.report : t('acceptanceNoReport')),
      result.childId && h('p', { className: 'pw-note' }, t('acceptanceSession'), '：', result.childId),
      h('h4', null, t('acceptanceCommands')),
      result.commandsUnavailable && h('p', { className: 'pw-note' }, t('acceptanceCommandsUnavailable')),
      !result.commandsUnavailable && !commands.length && h('p', { className: 'pw-note' }, t('acceptanceNoCommands')),
      commands.length > 0 && h('p', { className: 'pw-note' }, t('acceptanceOutputLimit')),
      commands.map((command, index) => h('div', { key: index, className: 'pw-reading-block' },
        h('strong', null, t('acceptanceCommand')), h('pre', { className: 'pw-text', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, command?.command || t('acceptanceUnknown')),
        h('strong', null, t('acceptanceOutcome')), h('p', { className: 'pw-text' }, outcomeText(command?.outcome, t)),
        h('strong', null, t('acceptanceTestConclusion')), h('p', { className: 'pw-text' },
          t(command?.testConclusion === 'passed' ? 'acceptanceTestPassed' : command?.testConclusion === 'failed' ? 'acceptanceTestFailed' : 'acceptanceTestUnknown')),
        command?.testSummary && h(React.Fragment, null, h('strong', null, t('acceptanceTestSummary')), h('p', { className: 'pw-text' }, command.testSummary)),
        h('strong', null, t('acceptanceOutput')), h('pre', { className: 'pw-text', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, command?.output || t('acceptanceNoOutput')))))
    if (!compact) return report
    const failed = commands.some(command => command?.testConclusion === 'failed')
    return h(React.Fragment, null,
      h('details', { className: 'pw-disclosure pw-assist-disclosure' },
        h('summary', null, t('acceptanceCheckReport')),
        report),
      staleNotice,
      failed && h('p', { className: 'pw-error', role: 'status' }, t('acceptanceTestFailed')))
  }

  if (!reviewable) return null
  const button = (kind, label) => h('button', {
    type: 'button', className: 'pw-button', disabled: busy || !!entry.pending, onClick: () => run(kind),
  }, t(label))
  const help = label => h('p', { className: 'pw-note' }, t(label))
  return h('section', { className: 'pw-reading-block pw-acceptance-assist', 'aria-label': t('acceptanceHelp'), 'aria-busy': !!entry.pending },
    h('h3', { className: 'pw-reading-label' }, t('acceptanceHelp')),
    compact ? h(React.Fragment, null,
      h('div', { className: 'pw-assist-actions' }, button('verify', 'acceptanceVerify'), button('guide', 'acceptanceGuide')),
      help('acceptanceRunHint'),
      h('details', { className: 'pw-disclosure pw-assist-disclosure' },
        h('summary', null, t('acceptanceHelpDetails')),
        h('div', { className: 'pw-assist-report' }, help('acceptanceVerifyNotice'), help('acceptanceGuideNotice'), help('acceptanceStayOpen'))))
      : h(React.Fragment, null,
        help('acceptanceStayOpen'), help('acceptanceVerifyNotice'), button('verify', 'acceptanceVerify'),
        help('acceptanceGuideNotice'), button('guide', 'acceptanceGuide')),
    entry.pending && h('p', { className: 'pw-note', role: 'status' }, t('acceptanceHelpRunning')),
    entry.error && h('p', { className: 'pw-error', role: 'alert' }, t('acceptanceHelpError'), entry.error.code ? ` · ${entry.error.code}` : '', entry.error.message ? `：${entry.error.message}` : ''),
    renderResult('verify'), renderResult('guide'))
}
