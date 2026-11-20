// Stage-1 V-4: generic write guard for .project/ (PRD 11.4, tech spec §7.3).
// Registered through ctx.tools.guard — synchronous, monotonic, applies to ALL
// sessions and to PTC inner dispatches (same prepare stage as native calls).
// Heuristic command checks cover common model mistakes, not deliberate attacks.
import { isAbsolute, join, normalize, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { patchPaths } from './extract.js'

export const PROJECT_DENIAL = '.project/ 由工作台管理，请使用 workbench_* 工具，或在工作台界面操作。'
export const TASK_READ_DENIAL = '当前任务只能读取本工作区资料。请改用项目内路径；其他项目请通过工作台明确切换。'

const absOf = (p, cwd) => (isAbsolute(p) ? normalize(p) : normalize(join(cwd ?? '.', p)))
const outsideRoot = (value, cwd, projectRoot = cwd) => {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) return false
  const path = value.trim().replace(/^["']|["']$/g, '')
  if (!path || path.includes('\0') || path.startsWith('~')) return true
  const root = normalize(projectRoot ?? '.')
  const abs = absOf(path, cwd)
  return abs !== root && !abs.startsWith(root + sep)
}

// Common read commands and their path arguments. This is deliberately a small
// heuristic for accidental cross-project exploration, not a shell sandbox:
// interpreter code and custom commands need the host's own isolation as well.
const READ_COMMAND = /(?:^|[;&|]\s*|\s)(?:ls|cat|find|grep|rg|head|tail|sed|awk|less|more|stat|realpath|readlink)\s+([^;&|\r\n]+)/gi
export function commandReadsOutside(command, cwd) {
  let current = cwd
  for (const segment of String(command ?? '').split(/[;&|]+/)) {
    const cd = segment.trim().match(/^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/)
    if (cd) {
      const target = cd[1] ?? cd[2] ?? cd[3]
      if (outsideRoot(target, current, cwd)) return true
      current = absOf(target, current)
      continue
    }
    for (const match of segment.matchAll(READ_COMMAND)) {
      for (const token of match[1].matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
        const value = token[1] ?? token[2] ?? token[3]
        if (/^\d*>/.test(value) || ['>', '>>', '<'].includes(value)) continue
        if (outsideRoot(value, current, cwd)) return true
      }
    }
  }
  return false
}

export function taskReadDenial(name, args, cwd) {
  if (['read', 'read_image', 'glob', 'grep'].includes(name)) {
    return outsideRoot(args?.file_path ?? args?.path, cwd) ? TASK_READ_DENIAL : undefined
  }
  if (name === 'bash' || name === 'pwsh') return commandReadsOutside(args?.command, cwd) ? TASK_READ_DENIAL : undefined
  return undefined
}

export function reviewToolDenial(name, args, cwd) {
  if (!['read', 'glob', 'grep'].includes(name)) return '旧评审会话仅可读取项目资料。'
  const path = args?.file_path ?? args?.path ?? cwd
  if (typeof path !== 'string' || outsideRoot(path, cwd)) return TASK_READ_DENIAL
  try {
    if (outsideRoot(realpathSync(absOf(path, cwd)), realpathSync(cwd))) return TASK_READ_DENIAL
  } catch { /* the read tool reports missing files */ }
  return undefined
}

// Protected: <root>/.project/ except its runtime-only .local/ subtree.
export function isProtectedPath(p, root) {
  if (typeof p !== 'string' || !p.trim()) return false
  const abs = absOf(p, root)
  const base = normalize(join(root ?? '.', '.project'))
  if (abs !== base && !abs.startsWith(base + sep)) return false
  const local = normalize(join(base, '.local'))
  return !(abs === local || abs.startsWith(local + sep))
}

// Write-ish command features (spec §7.3): redirections, in-place editors,
// file movers/removers, git state restores, interpreter file writes.
const COMMAND_WRITE = /(?:^|[;&|]\s*|\s)(?:tee|sed\s+-i|mv|cp|rm|install|dd|truncate|chmod|chown|ln|touch|mkdir|rmdir|patch|git\s+(?:checkout|restore|apply|clean|reset)|python3?\b[^\n]*\b(?:write|open)\(|node\b[^\n]*\b(?:writeFile|appendFile|createWriteStream)|perl\s+-i|ruby\s+-i)/
const REDIRECT = />{1,2}/

export function commandWritesProject(command, root) {
  const text = String(command ?? '')
  if (!text.includes('.project')) return false
  // A redirect into a protected path, or any write-ish feature mentioning .project.
  if (REDIRECT.test(text)) {
    for (const m of text.matchAll(/>{1,2}\s*(\S+)/g)) {
      if (isProtectedPath(m[1].replace(/^["']|["']$/g, ''), root)) return true
    }
  }
  return COMMAND_WRITE.test(text)
}

// Pure decision: exec is {name, arguments}; cwd is the session working directory.
// Returns a denial reason string, or undefined to allow.
export function projectWriteDenial(name, args, cwd) {
  if (name === 'write' || name === 'edit') {
    return isProtectedPath(args?.file_path, cwd) ? PROJECT_DENIAL : undefined
  }
  if (name === 'apply_patch') {
    // Every source and target path in the patch; reject BEFORE execution.
    const paths = patchPaths(args?.input)
    return paths.some(p => isProtectedPath(p, cwd)) ? PROJECT_DENIAL : undefined
  }
  if (name === 'str_replace_editor') {
    if (!['create', 'str_replace', 'insert'].includes(args?.command)) return undefined // view is read-only
    return isProtectedPath(args?.path, cwd) ? PROJECT_DENIAL : undefined
  }
  if (name === 'bash' || name === 'pwsh') {
    return commandWritesProject(args?.command, cwd) ? PROJECT_DENIAL : undefined
  }
  return undefined
}
