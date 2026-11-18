// Wiki generation child write scope (C-07 / CT-19).
// rc.3 removed the dedicated tool preset, so a background child inherits the
// caller's tools; this Host guard keeps the wiki child to openwiki/ instead of
// relying on the prompt. PTC programs can use Node APIs directly, bypassing
// individual tool guards, so this child rejects run_code. Denial is model-facing.
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path'

// Only tools needed by the Wiki lifecycle are allowed. In particular, child
// control and future inherited tools must not message the parent or bypass
// the Wiki write boundary.
const ALLOWED_TOOLS = new Set([
  'read', 'glob', 'grep', 'skill', 'write', 'edit',
  'mcp__openwiki__openwiki_begin',
  'mcp__openwiki__openwiki_submit_plan',
  'mcp__openwiki__openwiki_next_page',
  'mcp__openwiki__openwiki_inspect_page_claims',
  'mcp__openwiki__openwiki_submit_page',
  'mcp__openwiki__openwiki_finish',
])
const WRITE_TOOLS = new Set(['write', 'edit'])
const READ_TOOLS = new Set(['read', 'glob', 'grep'])
const RUN_TOOLS = new Set(['openwiki_submit_plan', 'openwiki_next_page', 'openwiki_inspect_page_claims', 'openwiki_submit_page', 'openwiki_finish'])

const targetOf = args => args?.file_path ?? args?.path

// OpenWiki 0.9.0 treats AppleDouble ._*.md files as pages and ._*.json
// inside .claims as sidecars. It may then overwrite pages or delete sidecars.
// Match its traversal (ordinary directories/files, no symlink following),
// and do not treat unrelated metadata such as ._.run.json as a page.
export function wikiMetadataIssue(root) {
  const base = join(root, 'openwiki')
  try {
    let info
    try { info = lstatSync(base) } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw error
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid wiki directory')
    // OpenWiki uses lstat on each name. Do the same rather than relying on
    // Dirent type bits, which some filesystems report as unknown.
    const visit = (dir, inClaims) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        const entry = lstatSync(path)
        if (entry.isDirectory()) {
          if (name.toLowerCase() === '.claims' && !inClaims) {
            if (dir === base) {
              // On a case-insensitive volume .CLAIMS can be the directory
              // actually reached by the engine's lookup of .claims. On a
              // case-sensitive volume a distinct .CLAIMS is not that store.
              let claims
              try { claims = lstatSync(join(base, '.claims')) } catch (error) {
                if (error.code !== 'ENOENT') throw error
              }
              if (claims?.isDirectory() && !claims.isSymbolicLink() &&
                  claims.dev === entry.dev && claims.ino === entry.ino && visit(path, true)) return true
            }
          } else if (visit(path, inClaims)) return true
        } else if (entry.isFile() && name.startsWith('._') && name.endsWith(inClaims ? '.json' : '.md')) {
          return true
        }
      }
      return false
    }
    return visit(base, false) ? 'unsafe' : undefined
  } catch { return 'unreadable' }
}

const companionPath = path => typeof path === 'string' && path.split(/[\\/]/).some(part => part.startsWith('._'))
const checkpointPaths = value => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(path => typeof path !== 'string')) throw new Error('invalid checkpoint paths')
  return value
}
function unsafePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('invalid checkpoint plan')
  if ([...checkpointPaths(plan.deletePages), ...checkpointPaths(plan.deferredClaimPages)].some(companionPath)) return true
  if (plan.pages !== undefined && !Array.isArray(plan.pages)) throw new Error('invalid checkpoint pages')
  for (const page of plan.pages ?? []) {
    if (!page || typeof page !== 'object' || Array.isArray(page) || typeof page.path !== 'string') throw new Error('invalid checkpoint page')
    if (companionPath(page.path) || checkpointPaths(page.relatedPages).some(companionPath)) return true
    if (checkpointPaths(page.seedPaths).some(path => /(?:^|\/)openwiki\//i.test(path.replace(/\\/g, '/')) && companionPath(path))) return true
  }
  return false
}

// A resumable OpenWiki run retains page names even after the corresponding
// filesystem entries disappear. Never resume a plan which has mistaken a
// system companion for a page. The engine performs fuller schema validation;
// this only inspects the page-bearing fields and leaves the checkpoint intact.
export function wikiCheckpointIssue(root) {
  const base = join(root, 'openwiki')
  const checkpoint = join(base, '.run.json')
  try {
    let baseInfo
    try { baseInfo = lstatSync(base) } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw error
    }
    if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new Error('invalid wiki directory')
    let info
    try { info = lstatSync(checkpoint) } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw error
    }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid checkpoint')
    const run = JSON.parse(readFileSync(checkpoint, 'utf8'))
    if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Error('invalid checkpoint')
    if ([...checkpointPaths(run.initialPages), ...checkpointPaths(run.requiredRewritePages)].some(companionPath)) return 'unsafe'
    if (run.preparedWiki !== undefined) {
      if (!run.preparedWiki || typeof run.preparedWiki !== 'object' || Array.isArray(run.preparedWiki)) throw new Error('invalid checkpoint provenance')
      const provenance = run.preparedWiki.generatedProvenance
      if (provenance !== undefined && (!Array.isArray(provenance) || provenance.some(item => !item || typeof item.page !== 'string'))) throw new Error('invalid checkpoint provenance')
      if ((provenance ?? []).some(item => companionPath(item.page))) return 'unsafe'
    }
    if (run.plan !== undefined && unsafePlan(run.plan)) return 'unsafe'
    return undefined
  } catch { return 'unreadable' }
}

// Match the filesystem backend: resolve existing symlinks, including those in
// the parent of a file that has not been created yet. Fail closed on errors.
function realTarget(path) {
  const missing = []
  let current = path
  for (;;) {
    try {
      lstatSync(current)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
      continue
    }
    // realpath fails for a dangling symlink; it must not be treated as absent.
    return join(realpathSync(current), ...missing.reverse())
  }
}

export function wikiGuardDenial(toolName, args, target) {
  if (!target) return undefined
  const root = typeof target === 'string' ? target : target.root
  const mode = typeof target === 'string' ? undefined : target.mode
  if (toolName === 'run_code') {
    return '项目工作台：Wiki 生成暂不支持 PTC 模式，请使用原生工具模式。'
  }
  if (!ALLOWED_TOOLS.has(toolName)) {
    return `项目工作台：Wiki 生成分身只能使用生成 Wiki 所需的工具，不能使用 ${toolName}。`
  }
  if (toolName.startsWith('mcp__openwiki__')) {
    const metadata = wikiMetadataIssue(root)
    if (metadata === 'unsafe') return '项目工作台：Wiki 内有系统伴随文件，当前生成器可能误处理这些文件；为保护文件，已停止更新。'
    if (metadata === 'unreadable') return '项目工作台：无法安全检查 Wiki 文件，已停止更新。'
    const checkpoint = wikiCheckpointIssue(root)
    if (checkpoint === 'unsafe') return '项目工作台：上次 Wiki 更新记录包含系统伴随文件的页面路径；为保护资料，已停止更新。'
    if (checkpoint === 'unreadable') return '项目工作台：无法安全检查上次 Wiki 更新记录，已停止更新。'
    if (toolName === 'mcp__openwiki__openwiki_submit_plan') {
      try {
        if (unsafePlan(args)) return '项目工作台：Wiki 计划包含系统伴随文件的页面路径，不能提交。'
      } catch { return '项目工作台：无法安全检查 Wiki 页面计划，不能提交。' }
    }
  }
  if (toolName === 'skill' && args?.name !== 'openwiki') {
    return '项目工作台：Wiki 生成分身只能加载 openwiki 技能。'
  }
  if (READ_TOOLS.has(toolName)) {
    // read uses the filesystem backend (which expands ~); searches run rg
    // from the child's initial project cwd and do not follow symlinks in a
    // directory traversal. Check explicit roots and read targets physically.
    const path = toolName === 'read' ? args?.file_path : (args?.path ?? '.')
    if (typeof path !== 'string' || !path.trim() || path === '~' || path.startsWith('~/') || (process.platform === 'win32' && path.startsWith('~\\'))) {
      return `项目工作台：${toolName} 只能读取当前项目内的路径。`
    }
    try {
      // Do not normalize before realpath: a symlink followed by .. has
      // physical path semantics and may otherwise escape the root.
      const absolute = isAbsolute(path) ? path : `${root}${sep}${path}`
      const realRoot = realpathSync(root)
      const actual = realpathSync(absolute)
      if (actual !== realRoot && !actual.startsWith(realRoot + sep)) throw new Error('path leaves project')
    } catch { return `项目工作台：${toolName} 只能读取当前项目内的路径。` }
  }
  // The Host owns the lifecycle mode: a wrong mode could replace an existing wiki.
  if (mode && /^mcp__openwiki__openwiki_begin$/.test(toolName)) {
    if (args?.mode !== mode) return `项目工作台：本次生成必须使用 openwiki 的 "${mode}" 模式（由宿主按现有 Wiki 选择），不能使用 "${String(args?.mode)}"。`
    if (typeof args?.root !== 'string' || normalize(args.root) !== normalize(root)) return '项目工作台：只能对当前项目调用 openwiki_begin。'
    try {
      const realRoot = realpathSync(root)
      const base = join(root, 'openwiki')
      if (realTarget(base) !== join(realRoot, 'openwiki')) throw new Error('wiki root is redirected')
      // A resumed init or update must still be bound to the checkpoint the
      // host inspected. A new update must not silently resume a later run.
      if (target.resumeRunId) {
        try {
          const checkpoint = join(base, '.run.json')
          const info = lstatSync(checkpoint)
          if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid checkpoint')
          const run = JSON.parse(readFileSync(checkpoint, 'utf8'))
          if (run.runId !== target.resumeRunId || run.mode !== mode) throw new Error('checkpoint changed')
        } catch { return '项目工作台：Wiki 更新记录在启动期间发生变化或无法读取，请重新检查后重试。' }
      } else if (mode === 'init') {
        // A new init may run only once within this child. Retrying an
        // interrupted init starts a new child bound to its checkpoint.
        if (target.initStarted) throw new Error('init already attempted')
        try { if (readdirSync(base).length) throw new Error('wiki is not empty') }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        target.initStarted = true
      } else {
        try {
          lstatSync(join(base, '.run.json'))
          return '项目工作台：Wiki 更新记录在启动期间发生变化，请重新检查后重试。'
        } catch (error) {
          if (error.code !== 'ENOENT') return '项目工作台：无法安全检查 Wiki 更新记录，请检查后重试。'
        }
      }
    } catch { return '项目工作台：无法确认 Wiki 目录属于当前项目。' }
  }
  const lifecycleName = toolName.startsWith('mcp__openwiki__') ? toolName.slice('mcp__openwiki__'.length) : ''
  if (RUN_TOOLS.has(lifecycleName)) {
    try {
      const base = join(root, 'openwiki')
      const realBase = join(realpathSync(root), 'openwiki')
      if (realTarget(base) !== realBase || realTarget(join(base, '.run.json')) !== join(realBase, '.run.json')) throw new Error('run is redirected')
      const state = JSON.parse(readFileSync(join(base, '.run.json'), 'utf8'))
      if (typeof args?.runId !== 'string' || args.runId !== state.runId) throw new Error('run does not belong to project')
    } catch { return '项目工作台：Wiki 操作只能使用当前项目的生成任务。' }
  }
  if (!WRITE_TOOLS.has(toolName)) return undefined
  const filePath = targetOf(args)
  if (typeof filePath !== 'string' || !filePath.trim()) return `项目工作台：${toolName} 需要明确的目标路径。`
  if (basename(filePath).startsWith('._')) return '项目工作台：不能修改 Wiki 的系统伴随文件。'
  // The filesystem backend resolves symlink/.. physically, unlike path.join.
  if (filePath.split(/[\\/]/).includes('..')) return '项目工作台：Wiki 写入路径不能包含上级目录。'
  const abs = isAbsolute(filePath) ? normalize(filePath) : normalize(join(root, filePath))
  const base = normalize(join(root, 'openwiki'))
  if (abs !== base && !abs.startsWith(base + sep)) return '项目工作台：Wiki 生成只能写入 openwiki/，不能修改项目数据或源码。'
  try {
    const realBase = join(realpathSync(root), 'openwiki')
    // openwiki itself must not redirect generation to another directory.
    if (realTarget(base) !== realBase) throw new Error('openwiki is redirected')
    const realPath = realTarget(abs)
    if (realPath !== realBase && !realPath.startsWith(realBase + sep)) throw new Error('target leaves openwiki')
  } catch {
    return '项目工作台：Wiki 写入路径无法确认在 openwiki/ 内，不能修改项目数据或源码。'
  }
  return undefined
}
