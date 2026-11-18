// Publish a completed, independently generated Wiki without touching the old
// directory during generation. This is a recoverable two-rename operation, not
// an atomic directory exchange; callers must surface the retained old path.
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const signature = info => ({ dev: String(info.dev), ino: String(info.ino), mode: info.mode, size: info.size,
  mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs })
async function fileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function fingerprintTree(path) {
  let root
  try { root = await fs.lstat(path) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Wiki path is not a directory')
  const hash = createHash('sha256')
  const visit = async (absolute, name) => {
    const before = await fs.lstat(absolute)
    const meta = signature(before)
    hash.update(JSON.stringify([name, meta, before.isDirectory() ? 'directory' : before.isFile() ? 'file' : before.isSymbolicLink() ? 'link' : 'other']))
    if (before.isDirectory()) {
      for (const entry of (await fs.readdir(absolute)).sort()) await visit(join(absolute, entry), name ? `${name}/${entry}` : entry)
    } else if (before.isFile()) {
      for await (const chunk of createReadStream(absolute)) hash.update(chunk)
    } else if (before.isSymbolicLink()) {
      hash.update(await fs.readlink(absolute))
    } else throw new Error('Wiki contains a special file')
    if (!same(meta, signature(await fs.lstat(absolute)))) throw new Error('Wiki changed while checking it')
  }
  await visit(path, '')
  return hash.digest('hex')
}

// Content and filesystem stat are checked; platforms may not report all
// metadata changes through ctime. No attempt is made to read or discard ._ files.
export async function captureWikiBaseline(root) {
  return fingerprintTree(join(await fs.realpath(root), 'openwiki'))
}

async function verifyCandidate(candidate) {
  const info = await fs.lstat(candidate)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('candidate is not a directory')
  try { await fs.lstat(join(candidate, '.run.json')); throw new Error('candidate is unfinished') } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const update = JSON.parse(await fs.readFile(join(candidate, '.last-update.json'), 'utf8'))
  if (update.status !== 'complete' || !Number.isFinite(Date.parse(update.updatedAt))) throw new Error('candidate is not complete')
  // Reject links and special files in a generated candidate: copying a link
  // could redirect later Wiki reads or point back to the live project.
  const walk = async path => {
    for (const name of await fs.readdir(path)) {
      const item = join(path, name), entry = await fs.lstat(item)
      if (entry.isSymbolicLink()) throw new Error('candidate contains a symbolic link')
      if (entry.isDirectory()) await walk(item)
      else if (!entry.isFile()) throw new Error('candidate contains a special file')
    }
  }
  await walk(candidate)
}

const exists = async path => {
  try { await fs.lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

// Candidate must be outside the project, and fully completed before calling.
// Existing Wiki is moved as one directory and retained on the same volume.
// A second rename installs the new tree. If installation fails we restore the
// old directory where possible and return the backup path otherwise. A process
// crash between renames requires recovery using the retained old directory.
export async function publishWikiCandidate(root, candidate, baseline) {
  if (baseline !== null && (typeof baseline !== 'string' || !/^[0-9a-f]{64}$/.test(baseline))) throw new Error('invalid Wiki baseline')
  root = await fs.realpath(root)
  candidate = await fs.realpath(candidate)
  const candidateRel = relative(root, candidate)
  if (!candidateRel || (!candidateRel.startsWith('..' + sep) && !isAbsolute(candidateRel))) throw new Error('candidate must be outside the project')
  await verifyCandidate(candidate)
  const beforeCandidate = await fingerprintTree(candidate)
  const target = join(root, 'openwiki')
  // Reuse the existing ignored workbench-local directory. Never follow a
  // redirected .project/.local or place temporary trees on a different volume.
  let local = root
  for (const part of ['.project', '.local']) {
    local = join(local, part)
    const info = await fs.lstat(local)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Wiki local directory is unsafe')
  }
  const localReal = await fs.realpath(local), localRel = relative(root, localReal)
  if (!localRel || localRel.startsWith('..' + sep) || isAbsolute(localRel) ||
      (await fs.stat(root)).dev !== (await fs.stat(localReal)).dev) throw new Error('Wiki local directory is outside the project volume')
  const stageContainer = await fs.mkdtemp(join(localReal, 'wiki-next-'))
  let backupContainer, backup, movedOld = false, installed = false
  try {
    const staged = join(stageContainer, 'openwiki')
    await fs.cp(candidate, staged, { recursive: true, force: false, errorOnExist: true })
    await verifyCandidate(staged)
    if (beforeCandidate !== await fingerprintTree(candidate)) throw new Error('candidate changed while copying')
    // Compare paths and contents without requiring inode or timestamp equality
    // across volumes; copyFile has no native xattr preservation guarantee.
    const compareContents = async (left, right) => {
      const names = (await fs.readdir(left)).sort()
      const copiedNames = (await fs.readdir(right)).sort()
      for (const name of copiedNames.filter(name => !names.includes(name))) {
        // macOS may create an AppleDouble companion when writing to exFAT.
        // It must be a real regular file attached to a copied name; leave its
        // bytes in place rather than deleting or treating it as generated text.
        if (!name.startsWith('._') || !names.includes(name.slice(2))) throw new Error('candidate copy differs')
        const info = await fs.lstat(join(right, name))
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('candidate copy differs')
        const handle = await fs.open(join(right, name), 'r')
        try {
          const magic = Buffer.alloc(4), { bytesRead } = await handle.read(magic, 0, 4, 0)
          if (bytesRead !== 4 || !magic.equals(Buffer.from([0, 5, 22, 7]))) throw new Error('candidate copy differs')
        } finally { await handle.close() }
      }
      if (names.some(name => !copiedNames.includes(name))) throw new Error('candidate copy differs')
      for (const name of names) {
        const a = join(left, name), b = join(right, name), ai = await fs.lstat(a), bi = await fs.lstat(b)
        if (ai.isDirectory() && bi.isDirectory()) await compareContents(a, b)
        else if (ai.isFile() && bi.isFile()) {
          if (ai.size !== bi.size || await fileHash(a) !== await fileHash(b)) throw new Error('candidate copy differs')
        } else throw new Error('candidate copy differs')
      }
    }
    await compareContents(candidate, staged)
    if (baseline !== await captureWikiBaseline(root)) {
      const error = new Error('Wiki changed during generation'); error.code = 'WIKI_CONFLICT'; throw error
    }
    if (baseline !== null) {
      backupContainer = await fs.mkdtemp(join(localReal, 'wiki-old-'))
      backup = join(backupContainer, 'openwiki')
      await fs.rename(target, backup)
      movedOld = true
    }
    // Refuse to overwrite a new target created after the baseline check.
    if (await exists(target)) { const error = new Error('Wiki appeared during publishing'); error.code = 'WIKI_CONFLICT'; throw error }
    await fs.rename(staged, target)
    installed = true
    return { backup: backup ?? null }
  } catch (error) {
    if (movedOld && !installed) {
      try {
        if (await exists(target)) throw new Error('a new Wiki occupies the original path')
        await fs.rename(backup, target)
        movedOld = false
      } catch (rollbackError) {
        error.backup = backup
        error.rollbackError = rollbackError.message
      }
    }
    throw error
  } finally {
    // The staging directory is created exclusively by this call; the retained
    // backup is never recursively removed, even after successful publication.
    await fs.rm(stageContainer, { recursive: true, force: true }).catch(() => {})
    if (backupContainer && !movedOld) await fs.rmdir(backupContainer).catch(() => {})
  }
}
