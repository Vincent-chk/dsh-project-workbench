import { constants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete gitEnv[key]
async function git(cwd, ...args) {
  const { stdout } = await exec('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, env: gitEnv, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  return stdout
}
async function readIndex(root) {
  try { return await readFile(join(root, '.git', 'index')) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
const sameIndex = (a, b) => a === null ? b === null : b !== null && a.equals(b)
async function gitHead(root) {
  let commit = null, ref = null
  try { commit = (await git(root, 'rev-parse', '--verify', 'HEAD')).toString('ascii').trim() }
  catch (error) { if (error.code !== 128) throw error }
  try { ref = (await git(root, 'symbolic-ref', '--quiet', 'HEAD')).toString('utf8').trim() }
  catch (error) { if (error.code !== 1) throw error }
  if (!commit) {
    if (!ref || !ref.startsWith('refs/heads/')) throw new Error('unsupported Git HEAD')
    try { await git(root, 'show-ref', '--verify', '--quiet', ref); throw new Error('Git HEAD does not identify a commit') }
    catch (error) { if (error.code !== 1) throw error }
  }
  return { commit, ref }
}
function records(bytes) {
  const text = bytes.toString('utf8')
  if (!Buffer.from(text).equals(bytes) || (text && !text.endsWith('\0'))) throw new Error('Git output contains unsupported file names')
  return text ? text.slice(0, -1).split('\0') : []
}
function safePath(root, name) {
  if (!name || name.includes('\\') || isAbsolute(name) || name.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error('unsupported Git path')
  const path = resolve(root, name)
  if (relative(root, path).startsWith(`..${sep}`)) throw new Error('Git path leaves project')
  return path
}
async function regularFile(root, name, target) {
  const parts = name.split('/')
  let current = root
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i])
    let info
    try { info = await lstat(current) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory()) || (i === parts.length - 1 && !info.isFile())) throw new Error(`unsupported source file: ${name}`)
  }
  const handle = await open(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error(`unsupported source file: ${name}`)
    let out
    if (target) {
      await mkdir(dirname(target), { recursive: true })
      out = await open(target, 'wx', before.mode & 0o777)
    }
    const hash = createHash('sha256')
    try {
      for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
        hash.update(chunk)
        if (out) {
          let offset = 0
          while (offset < chunk.length) {
            const { bytesWritten } = await out.write(chunk, offset, chunk.length - offset)
            if (!bytesWritten) throw new Error(`could not copy source file: ${name}`)
            offset += bytesWritten
          }
        }
      }
    } finally { if (out) await out.close() }
    const after = await handle.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) throw new Error(`source changed while copying: ${name}`)
    if (target) await chmod(target, before.mode & 0o777)
    return { hash: hash.digest('hex'), mode: before.mode & 0o777 }
  } finally { await handle.close() }
}

// A private Git root for the Wiki child. The original index and files are read
// only. Ignored files are intentionally omitted, matching Git's normal source
// discovery; links, submodules and nonstandard indexes fail closed.
export async function prepareWikiStaging(sourceRoot, { temporaryRoot = tmpdir() } = {}) {
  const root = await realpath(sourceRoot)
  const top = (await git(root, 'rev-parse', '--show-toplevel')).toString('utf8').trim()
  if (await realpath(top) !== root) throw new Error('Wiki staging requires the exact Git root')
  const dotGit = await lstat(join(root, '.git'))
  if (!dotGit.isDirectory() || dotGit.isSymbolicLink()) throw new Error('linked Git worktrees are not supported')
  try { await lstat(join(root, '.git', 'objects', 'info', 'alternates')); throw new Error('Git object alternates are not supported') } catch (error) { if (error.code !== 'ENOENT') throw error }
  if ((await git(root, 'rev-parse', '--shared-index-path')).toString('utf8').trim()) throw new Error('split Git indexes are not supported')
  const head = await gitHead(root)
  const index = await readIndex(root)
  const staged = records(await git(root, 'ls-files', '--stage', '-z'))
  for (const line of staged) {
    const match = /^(\d+) [0-9a-f]+ ([0-3])\t/.exec(line)
    if (!match || match[2] !== '0' || match[1] === '160000' || match[1] === '120000') throw new Error('conflicted indexes, submodules and symlinks are not supported')
  }
  for (const line of records(await git(root, 'ls-files', '-v', '-z'))) {
    if (!line.startsWith('H ')) throw new Error('sparse or assume-unchanged Git entries are not supported')
  }
  const names = records(await git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'))
  const status = await git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all')
  const temp = await mkdtemp(join(temporaryRoot, 'workbench-wiki-'))
  const destination = join(temp, 'repo')
  try {
    // Borrow committed objects read-only instead of duplicating the repository
    // history. New objects and index writes still go to this private clone.
    await exec('git', ['-c', 'core.fsmonitor=false', 'clone', '--local', '--shared', '--no-checkout', '--', root, destination], { env: gitEnv, maxBuffer: 64 * 1024 * 1024 })
    if (!head.commit) await git(destination, 'symbolic-ref', 'HEAD', head.ref)
    if (index) await copyFile(join(root, '.git', 'index'), join(destination, '.git', 'index'))
    else await rm(join(destination, '.git', 'index'), { force: true })
    const copied = new Map()
    for (const name of names) {
      const target = safePath(destination, name)
      safePath(root, name)
      const file = await regularFile(root, name, target)
      if (!file) { copied.set(name, null); continue } // A tracked file may have been intentionally deleted.
      copied.set(name, file)
    }
    // A clone can inherit different file-mode or case defaults from its disk.
    for (const key of ['core.filemode', 'core.ignorecase', 'core.symlinks']) {
      try {
        const value = (await git(root, 'config', '--get', key)).toString('utf8').trim()
        if (value) await git(destination, 'config', key, value)
      } catch (error) { if (error.code !== 1) throw error }
    }
    const [newHead, newIndex, newStatus, sourceStatus, sourceHead] = await Promise.all([
      gitHead(destination), readIndex(root),
      git(destination, 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
      git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'), gitHead(root),
    ])
    if (JSON.stringify(newHead) !== JSON.stringify(head) || JSON.stringify(sourceHead) !== JSON.stringify(head) || !sameIndex(newIndex, index) || !status.equals(sourceStatus) || !status.equals(newStatus)) throw new Error('Git state changed or could not be reproduced in the Wiki staging tree')
    const verifySource = async () => {
      const [currentHead, currentIndex, currentStatus, currentNames] = await Promise.all([
        gitHead(root), readIndex(root),
        git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
        git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'),
      ])
      if (JSON.stringify(currentHead) !== JSON.stringify(head) || !sameIndex(currentIndex, index) || !currentStatus.equals(status) || JSON.stringify(records(currentNames)) !== JSON.stringify(names)) return false
      for (const [name, saved] of copied) {
        const current = await regularFile(root, name)
        if (!saved ? current !== null : !current || current.hash !== saved.hash || current.mode !== saved.mode) return false
      }
      return true
    }
    if (!await verifySource()) throw new Error('source changed while copying')
    return { root: destination, verifySource, cleanup: () => rm(temp, { recursive: true, force: true }) }
  } catch (error) {
    await rm(temp, { recursive: true, force: true })
    throw error
  }
}
