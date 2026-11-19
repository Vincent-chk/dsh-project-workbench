// Stage-1 DSH 接入原型（PROTOTYPE — 正式接入后移除演示入口，保留可复用接入函数）。
// The link/run/sync machinery now lives in core/link.js (stage 2); this module keeps
// the demo data, demo entry routes/tools and the real apply_patch mount used by V-4.
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as store from './store.js'
import { atomicWrite, WorkbenchError } from './files.js'
import { projectWriteDenial } from './write-guard.js'
import { maybeRunLiveProbe, maybeRunPatchProbe } from './live-probe.js'
import { installLinks } from './link.js'
import { acceptanceMode } from './tools.js'
import { listProposals } from './proposals.js'
import { listPrds, savePrd } from './prd.js'

// Plugins cannot resolve @deepseek-ai/* by name; anchor at the running DSH install.
function dshAnchor() {
  if (process.env.DSH_INSTALL_DIR) return process.env.DSH_INSTALL_DIR
  if (process.resourcesPath) return join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh')
  throw new Error('cannot locate the DSH installation')
}
async function importDshPackage(name) {
  const req = createRequire(join(dshAnchor(), 'package.json'))
  return import(pathToFileURL(req.resolve(name)).href)
}

const DEMO_REQ_TITLE = '演示需求：空名字提示（阶段1原型）'
const DEMO_ISSUE_A = '演示任务A：修复空名字提示'
const DEMO_ISSUE_B = '演示任务B：补充使用说明'
const DEMO_FILES = {
  'demo.mjs': "export function greet(name) {\n  return '你好，' + name + '！'\n}\n",
  'demo.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { greet } from './demo.mjs'\n\ntest('空名字显示填写提示', () => {\n  assert.equal(greet(''), '请填写名字')\n})\ntest('全空格名字显示填写提示', () => {\n  assert.equal(greet('   '), '请填写名字')\n})\ntest('正常名字保留问候', () => {\n  assert.equal(greet('小明'), '你好，小明！')\n})\n",
  'README.md': '# 问候示例\n输入名字时显示问候；空名字应提示填写。\n检查命令：node --test demo.test.mjs\n',
}

// Explicit developer action: prepare recognizable demo data (never auto-runs on reads).
export async function ensureDemoData(root) {
  try { await readFile(join(root, '.project', 'project.md'), 'utf8') } catch { await store.initProject(root, {}) }
  const develop = async reqId => {
    await store.updateRequirement(root, reqId, { goal: '空名字时给出清楚提示', scope: '只处理示例问候函数', acceptance: '三个输入场景通过' })
    if (!(await listPrds(root, reqId)).length) {
      await savePrd(root, {
        reqIds: [reqId],
        markdown: '# 问候示例\n\n用户未填写名字或输入全空格时，显示“请填写名字”。输入正常名字时，保留原问候。',
      })
    }
    await store.moveRequirement(root, reqId, 'reviewing')
    await store.moveRequirement(root, reqId, 'ready')
    await store.moveRequirement(root, reqId, 'in_progress')
  }
  let idx = await store.scanProject(root)
  let req = idx.requirements.find(r => r.title === DEMO_REQ_TITLE)
  if (!req) {
    const created = await store.createRequirement(root, DEMO_REQ_TITLE)
    await develop(created.data.id)
    idx = await store.scanProject(root)
    req = idx.requirements.find(r => r.id === created.data.id)
  } else if (req.status === 'backlog') {
    await develop(req.id)
    idx = await store.scanProject(root)
    req = idx.requirements.find(r => r.id === req.id)
  }
  const issues = []
  const TASK_INFO = {
    [DEMO_ISSUE_A]: {
      description: 'demo.mjs 的 greet 未处理空名字。按 README 与 demo.test.mjs 修复，并运行 node --test demo.test.mjs 验证。',
      problemOverview: '未填写名字仍输出空问候，用户不知道下一步该做什么。',
      triggerPath: "调用 greet('') 或 greet('   ')；正常名字用 greet('小明') 对照。",
      acceptance: '空字符串、全空格返回“请填写名字”；小明返回“你好，小明！”；node --test demo.test.mjs 三个场景通过。',
    },
    [DEMO_ISSUE_B]: {
      description: '在 README.md 补充 greet 的使用说明（输入与输出示例），不修改 demo.mjs。',
      problemOverview: 'README 缺少 greet 的使用说明，新用户不知如何调用。',
      triggerPath: '打开 README.md，查看是否有输入与输出示例。',
      acceptance: 'README.md 增加使用说明小节，含至少一个示例。',
    },
  }
  for (const title of [DEMO_ISSUE_A, DEMO_ISSUE_B]) {
    let issue = (req.issues ?? []).find(i => i.title === title)
    if (!issue) {
      const created = await store.createIssue(root, req.id, title)
      await store.updateIssue(root, req.id, created.data.id, TASK_INFO[title])
      issue = { id: created.data.id, title }
    }
    issues.push({ id: issue.id, title })
  }
  for (const [name, content] of Object.entries(DEMO_FILES)) {
    const p = join(root, name)
    try { await readFile(p, 'utf8') } catch { await atomicWrite(p, content) }
  }
  return { reqId: req.id, issues }
}

export function installPrototype(ctx) {
  const links = installLinks(ctx)
  const { locate, runStart, findLinkByIssue, issueOf, catchUpIdle, linkFile, runFile, cursorFile } = links
  const patchMounts = new Set() // demo sessions that get the real apply_patch tool
  const patchMounted = new Set() // sessions already mounted (idempotent demo/patch-tool)

  const sessionOf = sid => ctx.agents.get(sid)
  const cwdOf = agent => agent?.session?.header?.cwd
  const readJson = async p => { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }

  // ---- V-4: generic .project write guard, all sessions incl. PTC inner calls ----
  ctx.effect(() => ctx.tools.guard(exec =>
    projectWriteDenial(exec.name, exec.arguments, cwdOf(exec.agent)),
  ), 'project-workbench: stage-1 .project write guard')

  // ---- demo sessions may mount the REAL apply_patch tool (deployment disables it) ----
  ctx.effect(() => ctx.on('agent/created', async ({ agent }) => {
    if (!patchMounts.has(agent.session.id)) return
    patchMounts.delete(agent.session.id)
    try {
      const ToolFs = await importDshPackage('@deepseek-ai/dsh-tool-fs')
      agent.ctx.effect(() => {
        const fiber = agent.ctx.plugin(ToolFs, { read: false, readImage: false, write: false, edit: false, applyPatch: true })
        return () => fiber.dispose()
      }, 'project-workbench: demo apply_patch')
      patchMounted.add(agent.session.id)
    } catch (e) { ctx.logger?.warn?.(`project-workbench: demo apply_patch mount failed: ${e?.message ?? e}`) }
  }), 'project-workbench: demo patch tool mount')

  // ---- V-3: human source is set by the entry, never trusted from the body ----
  const demoRoutes = {
    'demo/setup': async i => { assertRoot(i.root); return ensureDemoData(i.root) },
    'demo/locate': async i => { assertRoot(i.root); return locate(i.root, i.issueId) },
    'demo/start': async i => { assertRoot(i.root); return runStart(i.root, i.issueId) },
    'demo/stop': async i => ctx.sessionController.cancel({ sessionId: i.sessionId }),
    'demo/note': async i => {
      assertRoot(i.root)
      // i.actor is deliberately ignored: the authenticated UI entry IS the human source.
      const data = (await store.addIssueUpdate(i.root, i.reqId, i.id, `人工操作：${i.text}`)).data
      return { ...data, actor: 'human' }
    },
    'demo/state': async i => {
      assertRoot(i.root)
      let link = i.sessionId ? await readJson(linkFile(i.root, i.sessionId)) : (i.issueId ? await findLinkByIssue(i.root, i.issueId) : null)
      if (link) {
        await catchUpIdle(i.root, link.sessionId)
        link = await readJson(linkFile(i.root, link.sessionId))
      }
      const run = link ? await readJson(runFile(i.root, link.issueId)) : null
      const cursor = link ? await readJson(cursorFile(i.root, link.sessionId)) : null
      const agent = link ? sessionOf(link.sessionId) : null
      let task = null, req = null, proposals = [], delivery = null
      if (link) {
        try {
          const found = await issueOf(i.root, link.issueId)
          const issue = found.issue, r = found.req
          // Use the same task and requirement data as the workbench details.
          task = { ...issue, reqId: r.id, reqStatus: r.status }
          req = { ...r, hasCancelled: (r.issues ?? []).some(i => i.status === 'cancelled') }
          proposals = (await listProposals(i.root)).filter(p => p.status === 'pending' && p.target.reqId === r.id && (p.target.issueId === issue.id || p.kind === 'new_task'))
          delivery = await readJson(join(i.root, '.project', '.local', 'delivery', `${r.id}.json`))
        } catch { /* deleted task */ }
      }
      return { link, run, cursor, task, req, proposals, delivery, session: link ? { live: !!agent, status: agent?.status ?? 'cold' } : null }
    },
    'demo/patch-tool': async i => {
      if (patchMounted.has(i.sessionId)) return { mounted: true, already: true }
      const agent = sessionOf(i.sessionId)
      if (!agent) { patchMounts.add(i.sessionId); return { mounted: 'on-next-create' } }
      const ToolFs = await importDshPackage('@deepseek-ai/dsh-tool-fs')
      agent.ctx.effect(() => {
        const fiber = agent.ctx.plugin(ToolFs, { read: false, readImage: false, write: false, edit: false, applyPatch: true })
        return () => fiber.dispose()
      }, 'project-workbench: demo apply_patch')
      patchMounted.add(i.sessionId)
      return { mounted: true }
    },
  }
  function assertRoot(root) {
    if (typeof root !== 'string' || !root.startsWith('/') || root.includes('\0')) throw new WorkbenchError('INVALID_ROOT', 'root must be an absolute path')
  }
  const routes = { ...links.routes, ...demoRoutes }

  // ---- demo driver tools (PROTOTYPE; removable). The formal task tools live
  // in core/tools.js and are installed by index.js. Demo drivers are confined to
  // an explicit isolated-acceptance scenario (the ACCEPTANCE_FLAG file), so they
  // never appear in ordinary sessions (§3.7). ----
  const demoAllowed = ({ agent }) => {
    const root = cwdOf(agent)
    return Boolean(root) && agent.session.header.origin !== 'subagent' && acceptanceMode(root)
  }
  const tool = (name, description, properties, required, execute) => ctx.tools.register({
    name, description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute: (args, exec) => {
      if (!demoAllowed(exec)) throw new WorkbenchError('DEMO_DISABLED', '当前会话未启用工作台验收工具')
      const root = cwdOf(exec.agent)
      if (args.root !== undefined && args.root !== root) {
        throw new WorkbenchError('WORKSPACE_MISMATCH', '验收工具只能操作当前会话所属项目')
      }
      if (args.sessionId !== undefined) {
        const target = sessionOf(args.sessionId)
        if (!target || cwdOf(target) !== root || target.session.header.origin === 'subagent') {
          throw new WorkbenchError('WORKSPACE_MISMATCH', '指定会话不属于当前验收项目的可用会话')
        }
      }
      return execute(args, exec)
    },
  }, { when: demoAllowed })
  ctx.effect(() => {
    const disposers = [
      tool('workbench_demo_enter', '原型演示：准备演示数据并定位/开始演示任务会话。', {
        root: { type: 'string', description: '演示工作区绝对路径' },
        issueId: { type: 'string', description: '任务 ID；缺省用演示任务A' },
        start: { type: 'boolean', description: 'true 时提交一次处理请求；缺省只查看' },
        patchTool: { type: 'boolean', description: 'true 时为该会话挂载真实 apply_patch 工具' },
      }, ['root'], async args => {
        const demo = await ensureDemoData(args.root)
        const issueId = args.issueId ?? demo.issues[0].id
        const located = await locate(args.root, issueId)
        if (args.patchTool) await routes['demo/patch-tool']({ sessionId: located.sessionId })
        const started = args.start ? await runStart(args.root, issueId) : null
        return JSON.stringify({ ...demo, ...located, started }, null, 1)
      }),
      tool('workbench_demo_stop', '原型演示：停止演示会话当前回合（等同 DSH 原生停止）。', { sessionId: { type: 'string', description: '会话 ID' } }, ['sessionId'], async args =>
        JSON.stringify(await ctx.sessionController.cancel({ sessionId: args.sessionId }))),
      tool('workbench_demo_state', '原型演示：读取演示关联、执行锁、游标与漏记状态。', {
        root: { type: 'string', description: '演示工作区绝对路径' }, sessionId: { type: 'string' }, issueId: { type: 'string' },
      }, ['root'], async args => JSON.stringify(await routes['demo/state'](args), null, 1)),
    ]
    return () => { for (const d of disposers) d?.() }
  }, 'project-workbench: stage-1 prototype tools')

  maybeRunLiveProbe(ctx, { routes, locate, runStart, ensureDemoData })
  maybeRunPatchProbe(ctx, { routes, locate, runStart, ensureDemoData })
  return { routes, locate, runStart, ensureDemoData, links }
}
