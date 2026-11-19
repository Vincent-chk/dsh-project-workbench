// One-click commit of .project/ only (§5.6 / T4.5). Never stages other files.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { WorkbenchError } from './files.js'

const exec = promisify(execFile)

async function git(root, args) {
  try {
    const { stdout } = await exec('git', args, { cwd: root, timeout: 15000, env: { ...process.env, LC_ALL: 'C' } })
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
  } catch (error) {
    if (error.code === 'NOT_GIT') return { ok: false, code: 'NOT_GIT', message: '生成 Wiki 需要 Git 仓库。请先在当前项目初始化 Git，无需提交。' }
    if (error.code === 'GIT_MISSING') return { ok: false, code: 'GIT_MISSING', message: '找不到 Git。请安装 Git 或检查其配置后重试。' }
    return { ok: false, code: 'WIKI_ROOT_UNAVAILABLE', message: '无法读取项目的 Git 工作目录。请确认 Git 可用，并打开包含项目文件的仓库顶层文件夹。' }
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
