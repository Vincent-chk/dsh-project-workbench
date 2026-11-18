// One-click commit of .project/ only (§5.6 / T4.5). Never stages other files.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { WorkbenchError } from './files.js'

const exec = promisify(execFile)

async function git(root, args) {
  try {
    const { stdout } = await exec('git', args, { cwd: root, timeout: 15000 })
    return stdout
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().trim()
    if (/not a git repository/i.test(msg)) throw new WorkbenchError('NOT_GIT', 'this workspace is not a git repository')
    if (e.code === 'ENOENT') throw new WorkbenchError('GIT_MISSING', 'git is not available')
    throw new WorkbenchError('GIT_FAILED', msg || 'git command failed')
  }
}

export async function gitStatus(root) {
  await git(root, ['rev-parse', '--show-toplevel'])
  const out = await git(root, ['status', '--porcelain', '--', '.project'])
  const lines = out.split('\n').filter(l => l.trim() !== '')
  return { available: true, uncommitted: lines.length, files: lines.map(l => l.slice(3)) }
}

// OpenWiki resolves a supplied directory to its Git top-level. Verify that
// this cannot silently redirect generation into a parent project.
export async function wikiGitRoot(root) {
  try {
    if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('invalid root')
    const selected = await realpath(root)
    const top = await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim())
    if (selected !== top) return { ok: false, code: 'WIKI_ROOT_NOT_TOPLEVEL', message: '请选择 Git 仓库的顶层文件夹后再生成 Wiki。' }
    return { ok: true }
  } catch {
    return { ok: false, code: 'WIKI_ROOT_UNAVAILABLE', message: '无法确认 Git 仓库根目录，请检查 Git 可用且当前项目是 Git 仓库。' }
  }
}

export async function gitCommitProject(root, message) {
  await git(root, ['rev-parse', '--show-toplevel'])
  const status = await gitStatus(root)
  if (status.uncommitted === 0) throw new WorkbenchError('NOTHING_TO_COMMIT', 'no .project changes to commit')
  await git(root, ['add', '--', '.project'])
  const msg = (message && String(message).trim()) || 'project: update workbench'
  await git(root, ['commit', '-m', msg, '--', '.project'])
  const head = (await git(root, ['rev-parse', '--short', 'HEAD'])).trim()
  return { committed: true, head, message: msg }
}
