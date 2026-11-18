// OpenWiki owns generation; the host retains a read-only copy of the last
// pre-update view so an interrupted run does not erase what users can read.
import { readFile, readdir, realpath, stat, lstat, mkdir, open, unlink, rmdir } from 'node:fs/promises'
import { join, relative, isAbsolute, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { atomicWrite, WorkbenchError } from './files.js'
import { wikiCheckpointIssue } from './wiki-guard.js'

const MAX_PAGE_BYTES = 2 * 1024 * 1024

function wikiRoot(root) { return join(root, 'openwiki') }

const VIEW_OWNER = 'project-workbench-wiki-view-v1'
const VIEW_DIR = 'wiki-preserved-views'
const MAX_VIEW_BYTES = 256 * 1024 * 1024
const MAX_ATTRIBUTE_BYTES = 4 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sha = value => createHash('sha256').update(value).digest('hex')
const runSystem = promisify(execFile)

// Node's copyFile drops native xattrs on macOS. Capture exact values with the
// system xattr tool; malformed output, permission errors and oversized values
// are failures, never evidence that the metadata was empty.
async function extendedAttributes(path) {
  const options = { encoding: 'buffer', maxBuffer: MAX_ATTRIBUTE_BYTES * 3 }
  const listed = (await runSystem('/usr/bin/xattr', [path], options)).stdout
  const text = listed.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(listed) || text.includes('\0')) throw new Error('invalid attribute names')
  const names = text.split('\n').filter(Boolean).sort()
  if (new Set(names).size !== names.length || names.some(name => name.startsWith('-') || name.includes('\r'))) throw new Error('invalid attribute names')
  const out = []
  let bytes = 0
  for (const name of names) {
    const raw = (await runSystem('/usr/bin/xattr', ['-p', '-x', name, path], options)).stdout
    if (raw.some(byte => byte > 0x7f)) throw new Error('invalid attribute output')
    const hex = raw.toString('ascii').replace(/\s/g, '')
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error('invalid attribute output')
    const value = Buffer.from(hex, 'hex')
    bytes += value.length
    if (bytes > MAX_ATTRIBUTE_BYTES) throw new Error('attributes exceed preservation limit')
    out.push({ name, value: value.toString('base64') })
  }
  return out
}

const validAttributes = attrs => Array.isArray(attrs) && attrs.every(item => item && typeof item.name === 'string' && item.name &&
  !item.name.includes('\0') && !item.name.includes('\n') && typeof item.value === 'string' &&
  Buffer.from(item.value, 'base64').toString('base64') === item.value) && new Set(attrs.map(item => item.name)).size === attrs.length

async function checkedDirectory(path, create = false) {
  try {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe directory')
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error
    await mkdir(path)
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe directory')
  }
  return path
}

async function localDirectory(root, create = false) {
  const realRoot = await realpath(root)
  let path = realRoot
  for (const part of ['.project', '.local']) {
    path = join(path, part)
    try { await checkedDirectory(path, create) } catch (error) {
      if (!create && error.code === 'ENOENT') return null
      throw error
    }
  }
  const local = await realpath(path)
  if (relative(realRoot, local).startsWith('..' + sep) || isAbsolute(relative(realRoot, local))) throw new Error('local directory leaves project')
  return local
}

async function viewDirectory(root, create = false) {
  const local = await localDirectory(root, create)
  if (!local) return null
  const path = join(local, VIEW_DIR)
  let created = false
  try { await checkedDirectory(path) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (!create) return null
    await mkdir(path); created = true
  }
  const owner = join(path, 'owner')
  if (created) {
    const directoryInfo = await lstat(path)
    let handle, ownedFile
    try {
      handle = await open(owner, 'wx', 0o600)
      ownedFile = await handle.stat()
      await handle.writeFile(VIEW_OWNER); await handle.sync()
      await handle.close(); handle = undefined
    } catch (error) {
      if (handle) await handle.close().catch(() => {})
      // Only remove the file created by this attempt and an empty directory.
      // Unknown files or a replaced directory are never removed.
      if (ownedFile) {
        try {
          const current = await lstat(owner)
          if (current.isFile() && !current.isSymbolicLink() && current.dev === ownedFile.dev && current.ino === ownedFile.ino) await unlink(owner)
        } catch { /* leave anything we cannot identify */ }
      }
      try {
        const current = await lstat(path)
        if (current.isDirectory() && !current.isSymbolicLink() && current.dev === directoryInfo.dev && current.ino === directoryInfo.ino) await rmdir(path)
      } catch { /* retain a nonempty or replaced directory */ }
      throw error
    }
  }
  let ownerInfo
  try { ownerInfo = await lstat(owner) } catch {
    const error = new Error('unknown preservation directory'); error.code = 'WIKI_UNOWNED_VIEW'; throw error
  }
  if (!ownerInfo.isFile() || ownerInfo.isSymbolicLink() || await readFile(owner, 'utf8') !== VIEW_OWNER) {
    const error = new Error('unknown preservation directory'); error.code = 'WIKI_UNOWNED_VIEW'; throw error
  }
  const resolved = await realpath(path)
  if (relative(local, resolved).startsWith('..' + sep) || isAbsolute(relative(local, resolved))) throw new Error('preservation directory leaves project')
  return resolved
}

async function readViewPointer(root) {
  try {
    const dir = await viewDirectory(root)
    if (!dir) return null
    const path = join(dir, 'current.json')
    let info
    try { info = await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error('invalid view pointer')
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (value.owner !== VIEW_OWNER || !UUID.test(value.epoch) || (value.snapshotId !== null && !UUID.test(value.snapshotId)) ||
        (value.snapshotId !== null && !/^[0-9a-f]{64}$/.test(value.snapshotHash)) ||
        (value.snapshotId === null && value.snapshotHash !== null) ||
        !['before', 'completed', 'none'].includes(value.kind) || (value.snapshotId === null) !== (value.kind === 'none') ||
        !['prepared', 'ready', 'unstarted'].includes(value.phase) || typeof value.fresh !== 'boolean' ||
        typeof value.unprotected !== 'boolean') throw new Error('invalid view pointer')
    return { ...value, dir }
  } catch (error) {
    // An unrelated/uninitialized directory cannot invalidate a live Wiki when
    // no generation has ever referenced a saved view. Never overwrite it.
    if (error.code === 'WIKI_UNOWNED_VIEW') {
      const job = await readViewJob(root)
      const local = await localDirectory(root)
      let hasPointer = false
      try { await lstat(join(local, VIEW_DIR, 'current.json')); hasPointer = true } catch (e) { if (e.code !== 'ENOENT') throw e }
      if (!job?.viewEpoch && !hasPointer) return null
    }
    throw new WorkbenchError('WIKI_SNAPSHOT_UNREADABLE', 'cannot read the saved Wiki view safely')
  }
}

async function readViewJob(root) {
  try {
    const dir = await localDirectory(root)
    if (!dir) return null
    const path = join(dir, 'wiki-job.json')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid job')
    const job = JSON.parse(await readFile(path, 'utf8'))
    if (!job || typeof job !== 'object' || !['running', 'stopping', 'failed', 'done'].includes(job.status) ||
        (job.viewEpoch !== undefined && (!UUID.test(job.viewEpoch) || (job.viewSnapshotId !== null && !UUID.test(job.viewSnapshotId)))) ||
        (job.viewEpoch !== undefined && job.status === 'done' && !/^[0-9a-f]{64}$/.test(job.viewCompletionHash))) throw new Error('invalid Wiki job')
    return job
  } catch (error) { if (error.code === 'ENOENT') return null; throw new WorkbenchError('WIKI_SNAPSHOT_UNREADABLE', 'cannot read Wiki generation state safely') }
}

const safeRelative = value => typeof value === 'string' && value !== '' && !value.includes('\0') && !value.includes('\\') && !isAbsolute(value) &&
  !value.split('/').some(part => part === '..' || part === '' || part === '.')

async function readViewManifest(pointer) {
  try {
    const dir = join(pointer.dir, pointer.snapshotId)
    await checkedDirectory(dir)
    const path = join(dir, 'manifest.json'), info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error('invalid manifest')
    const raw = await readFile(path)
    if (sha(raw) !== pointer.snapshotHash) throw new Error('manifest checksum mismatch')
    const manifest = JSON.parse(raw.toString('utf8'))
    if (manifest.owner !== VIEW_OWNER || manifest.id !== pointer.snapshotId || !Array.isArray(manifest.files) || !Array.isArray(manifest.dirs) ||
        !manifest.root || !Number.isInteger(manifest.root.mode) || !validAttributes(manifest.root.attrs)) throw new Error('invalid manifest')
    if (manifest.files.some(item => !safeRelative(item.path) || !/^blob-[0-9]{8}$/.test(item.blob) || !/^[0-9a-f]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 0 || !Number.isFinite(item.savedMtimeMs) || !Number.isFinite(item.savedCtimeMs)) ||
        manifest.files.some(item => !validAttributes(item.attrs)) ||
        manifest.dirs.some(item => !item || !safeRelative(item.path) || !Number.isInteger(item.mode) || !validAttributes(item.attrs)) || new Set(manifest.files.map(item => item.path)).size !== manifest.files.length ||
        new Set(manifest.files.map(item => item.blob)).size !== manifest.files.length ||
        new Set(manifest.dirs.map(item => item.path)).size !== manifest.dirs.length) throw new Error('invalid manifest entries')
    const saved = { ...manifest, dir }
    await verifySavedEntries(saved)
    return saved
  } catch { throw new WorkbenchError('WIKI_SNAPSHOT_UNREADABLE', 'saved Wiki view is missing or damaged') }
}

async function fileDigest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

// Distinguish a missing record from an unreadable one when a job fails. The
// recorded bytes let a later completed update be identified without treating
// an older completion marker as a new result.
export async function wikiUpdateRecordState(root) {
  try {
    const path = join(wikiRoot(root), '.last-update.json'), info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) return undefined
    const raw = await readFile(path)
    let at = null
    try { const parsed = Date.parse(JSON.parse(raw.toString('utf8')).updatedAt); if (Number.isFinite(parsed)) at = parsed } catch { /* an invalid record has no reliable time */ }
    return { hash: sha(raw), at }
  } catch (error) { return error.code === 'ENOENT' ? { hash: null, at: null } : undefined }
}

async function wikiCompletionRecord(root) {
  try { await lstat(join(wikiRoot(root), '.run.json')); return false } catch (error) { if (error.code !== 'ENOENT') return false }
  try {
    const path = join(wikiRoot(root), '.last-update.json'), info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) return false
    const raw = await readFile(path)
    const update = JSON.parse(raw.toString('utf8'))
    const at = Date.parse(update.updatedAt)
    if (update.status !== 'complete' || !Number.isFinite(at)) return false
    try { await lstat(join(wikiRoot(root), '.run.json')); return false } catch (error) { if (error.code !== 'ENOENT') return false }
    return { hash: sha(raw), at }
  } catch { return false }
}

export async function wikiCompletionFingerprint(root) {
  return (await wikiCompletionRecord(root))?.hash || false
}

// A failed job can leave an old `complete` record even after it changed pages.
// Only a later, different record observed after the terminal job proves that
// another completion occurred. Legacy failures lack that observation.
async function verifiedCurrentCompletion(root, pointer, job) {
  if (pointer?.phase !== 'ready' || job?.viewEpoch !== pointer.epoch || job?.viewSnapshotId !== pointer.snapshotId ||
      !['done', 'failed'].includes(job.status)) return false
  const current = await wikiCompletionRecord(root)
  if (!current) return false
  if (job.status === 'done' && current.hash === job.viewCompletionHash) return current.hash
  const baseline = job.status === 'done' ? job.viewCompletionHash : job.failureUpdateHash
  if (job.status === 'failed' && (!Object.hasOwn(job, 'failureUpdateHash') || !Object.hasOwn(job, 'failureUpdateAt') ||
      !(job.failureUpdateAt === null || Number.isFinite(job.failureUpdateAt)))) return false
  if (!(baseline === null || /^[0-9a-f]{64}$/.test(baseline)) || baseline === current.hash ||
      !Number.isSafeInteger(job.endedAt) || current.at <= job.endedAt || current.at > Date.now() ||
      (job.status === 'failed' && job.failureUpdateAt !== null && current.at <= job.failureUpdateAt)) return false
  return current.hash
}
// Enumerate all regular files, including attachments and AppleDouble bytes.
// Refuse links/special files and a bounded copy rather than silently omitting data.
async function inspectViewTree(base) {
  const files = [], dirs = []
  let total = 0, attributeBytes = 0
  const attributes = async path => {
    const attrs = await extendedAttributes(path)
    for (const item of attrs) attributeBytes += Buffer.byteLength(item.name) + Buffer.from(item.value, 'base64').length
    if (attributeBytes > MAX_ATTRIBUTE_BYTES) throw new Error('Wiki metadata exceeds preservation limit')
    return attrs
  }
  const rootInfo = await lstat(base)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('invalid Wiki directory')
  const root = { mode: rootInfo.mode & 0o777, attrs: await attributes(base) }
  const walk = async (dir, prefix) => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), rel = prefix ? `${prefix}/${name}` : name
      if (!safeRelative(rel)) throw new Error('unsafe Wiki entry')
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('Wiki contains a symbolic link')
      if (info.isDirectory()) { dirs.push({ path: rel, mode: info.mode & 0o777, attrs: await attributes(path) }); await walk(path, rel) }
      else if (info.isFile()) {
        total += info.size
        if (total > MAX_VIEW_BYTES) throw new Error('Wiki exceeds the preservation size limit')
        files.push({ path: rel, size: info.size, mode: info.mode & 0o777, sha256: await fileDigest(path), attrs: await attributes(path) })
      } else throw new Error('Wiki contains a special file')
    }
  }
  await walk(base, '')
  return { root, files, dirs }
}

async function saveSnapshot(root, dir) {
  const source = wikiRoot(root)
  const info = await lstat(source)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid Wiki directory')
  const before = await inspectViewTree(source)
  if (before.files.some(entry => entry.path === '.run.json')) throw new Error('Wiki run appeared while preserving its previous view')
  if (!before.files.length && !before.dirs.length && !before.root.attrs.length) return null
  const id = randomUUID(), target = join(dir, id), copy = join(target, 'blobs')
  await mkdir(target); await mkdir(copy)
  const copied = []
  for (const [index, entry] of before.files.entries()) {
    const blob = `blob-${String(index).padStart(8, '0')}`
    const from = join(source, entry.path), to = join(copy, blob)
    const sourceInfo = await lstat(from)
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error('Wiki changed during copy')
    // -n prevents overwriting even if an unexpected file appears in our new
    // private directory; -p asks the macOS system tool to retain native xattrs.
    await runSystem('/bin/cp', ['-pn', from, to], { maxBuffer: MAX_ATTRIBUTE_BYTES })
    const savedInfo = await lstat(to)
    // In DSH on macOS the copy's provenance differed despite cp -p. Its
    // source bytes are retained in the manifest and rechecked by the full
    // source-tree scan below; the blob's own value may differ and this does
    // not promise that the source attribute can later be restored.
    const comparable = attrs => attrs.filter(item => item.name !== 'com.apple.provenance')
    if (!savedInfo.isFile() || savedInfo.isSymbolicLink() || savedInfo.size !== entry.size || await fileDigest(to) !== entry.sha256 ||
        JSON.stringify(comparable(await extendedAttributes(to))) !== JSON.stringify(comparable(entry.attrs))) throw new Error('Wiki copy verification failed')
    const savedHandle = await open(to, 'r')
    try { await savedHandle.sync() } finally { await savedHandle.close() }
    copied.push({ ...entry, blob, savedMtimeMs: savedInfo.mtimeMs, savedCtimeMs: savedInfo.ctimeMs })
  }
  const after = await inspectViewTree(source)
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Wiki changed during copy')
  const manifest = { owner: VIEW_OWNER, id, root: before.root, files: copied, dirs: before.dirs }
  const raw = JSON.stringify(manifest)
  if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw new Error('Wiki metadata exceeds preservation limit')
  const handle = await open(join(target, 'manifest.json'), 'wx', 0o600)
  try { await handle.writeFile(raw); await handle.sync() } finally { await handle.close() }
  let lastUpdate = null
  const metadata = copied.find(entry => entry.path === '.last-update.json')
  if (metadata) {
    try { lastUpdate = JSON.parse(await readFile(join(copy, metadata.blob), 'utf8')) } catch { /* a baseline can lack valid metadata */ }
  }
  return { id, hash: sha(raw), kind: lastUpdate?.status === 'complete' ? 'completed' : 'before' }
}

// Publish a new epoch before starting a child. Retry keeps the same saved
// pre-update view; never make a previous-success claim for a legacy run.
export async function prepareWikiView(root, { resume = false } = {}) {
  try {
    const old = await readViewPointer(root), job = await readViewJob(root)
    if (!old && job?.viewEpoch) throw new WorkbenchError('WIKI_SNAPSHOT_UNREADABLE', 'saved Wiki view pointer is missing')
    const terminal = old?.phase === 'ready' && job?.viewEpoch === old.epoch && job?.viewSnapshotId === old.snapshotId && ['done', 'failed'].includes(job?.status)
    const completionHash = terminal ? await verifiedCurrentCompletion(root, old, job) : false
    const safeCompleted = !!completionHash
    const oldManifest = old?.snapshotId && !safeCompleted ? await readViewManifest(old) : null
    // An unfinished external run has no verified baseline for this update.
    // A completed external update is read directly and protected on start.
    const failedCurrent = terminal && job.status === 'failed' && !safeCompleted && !resume ? await wikiCompletionRecord(root) : false
    let legacyUnchanged = false
    if (failedCurrent && !Object.hasOwn(job, 'failureUpdateHash') && oldManifest && Number.isSafeInteger(job.endedAt) && failedCurrent.at < job.endedAt) {
      const savedRecord = await readSavedFile(oldManifest, '.last-update.json')
      legacyUnchanged = !!savedRecord && sha(savedRecord) === failedCurrent.hash
    }
    const failedUnverified = failedCurrent && (Object.hasOwn(job, 'failureUpdateHash') ? failedCurrent.hash !== job.failureUpdateHash : !legacyUnchanged)
    if ((job?.status === 'done' && terminal && !safeCompleted) || (safeCompleted && resume) || failedUnverified) {
      throw new WorkbenchError('WIKI_EXTERNAL_CHANGE', 'Wiki changed outside the workbench; check its update state before retrying')
    }
    const oldDone = old && (old.phase === 'unstarted' || (old.phase === 'prepared' && old.fresh) ||
      safeCompleted)
    let snapshotId = !oldDone ? old?.snapshotId ?? null : null
    let snapshotHash = snapshotId ? old.snapshotHash : null
    let kind = snapshotId ? old.kind : 'none'
    let unprotected = !snapshotId && (!!resume || (!!old && !oldDone))
    const dir = await viewDirectory(root, true)
    if (!snapshotId && !resume && (!old || oldDone)) {
      let wikiExists = true
      try { await lstat(wikiRoot(root)) } catch (error) { if (error.code === 'ENOENT') wikiExists = false; else throw error }
      if (wikiExists) {
        if (process.platform !== 'darwin') throw new Error('native Wiki metadata preservation is unavailable on this platform')
        const saved = await saveSnapshot(root, dir)
        snapshotId = saved?.id ?? null
        snapshotHash = saved?.hash ?? null
        if (snapshotId) kind = saved.kind
      }
    }
    if (safeCompleted && ((await wikiCompletionFingerprint(root)) !== completionHash || (await readViewPointer(root))?.epoch !== old.epoch)) {
      throw new WorkbenchError('WIKI_EXTERNAL_CHANGE', 'Wiki changed while preparing the update')
    }
    const epoch = randomUUID()
    const value = { owner: VIEW_OWNER, epoch, snapshotId, snapshotHash, kind, unprotected,
      phase: 'prepared', fresh: !resume && (!old || !!oldDone) }
    await atomicWrite(join(dir, 'current.json'), JSON.stringify(value))
    // If this was a retry, retain its terminal observation when startup later
    // fails without launching a child. The earlier copy remains the baseline.
    const priorFailure = !value.fresh && job?.status === 'failed' && job.viewEpoch === old?.epoch && job.viewSnapshotId === old?.snapshotId &&
      Object.hasOwn(job, 'failureUpdateHash') && Object.hasOwn(job, 'failureUpdateAt')
      ? { hash: job.failureUpdateHash, at: job.failureUpdateAt } : undefined
    return { epoch, snapshotId, ...(priorFailure ? { priorFailure } : {}) }
  } catch (error) {
    if (error instanceof WorkbenchError && ['WIKI_SNAPSHOT_UNREADABLE', 'WIKI_EXTERNAL_CHANGE'].includes(error.code)) throw error
    throw new WorkbenchError('WIKI_SNAPSHOT_FAILED', 'cannot safely preserve the existing Wiki; check files, permissions and size before retrying')
  }
}

// Use only when the caller knows no activation was even requested. Retain the
// copy, but allow the next new run to capture edits made after the failed start.
export async function markWikiViewUnstarted(root, epoch) {
  const pointer = await readViewPointer(root)
  if (!pointer || pointer.epoch !== epoch || !pointer.fresh) return false
  try { await lstat(join(wikiRoot(root), '.run.json')); return false } catch (error) { if (error.code !== 'ENOENT') throw error }
  const { dir, ...value } = pointer
  await atomicWrite(join(dir, 'current.json'), JSON.stringify({ ...value, phase: 'unstarted' }))
  return true
}

// A child may be started only after its reservation and this marker are both
// durable. If another attempt replaced the pointer, do not start the old one.
export async function markWikiViewReady(root, epoch) {
  const pointer = await readViewPointer(root)
  if (!pointer || pointer.epoch !== epoch || pointer.phase !== 'prepared') {
    throw new WorkbenchError('WIKI_VIEW_CHANGED', 'Wiki preparation changed; retry the update')
  }
  const { dir, ...value } = pointer
  await atomicWrite(join(dir, 'current.json'), JSON.stringify({ ...value, phase: 'ready' }))
}

async function wikiView(root) {
  const job = await readViewJob(root)
  // After the first staged publication the live tree is the new baseline.
  // Later staged jobs must continue showing it while running or after failure,
  // instead of falling back to a snapshot created by an older implementation.
  // During the first migration a legacy snapshot may still be the only safe
  // readable copy, so the host records that case as baseView: 'legacy'.
  if (job?.strategy === 'staged' && (job.status === 'done' || job.baseView === 'live')) {
    return { version: `live:staged:${job.startedAt}:${job.status === 'done' ? 'published' : 'before'}`, snapshot: false, unprotected: false }
  }
  const pointer = await readViewPointer(root)
  if (!pointer) {
    if (job?.viewEpoch) throw new WorkbenchError('WIKI_SNAPSHOT_UNREADABLE', 'saved Wiki view pointer is missing')
    let hasCheckpoint = false
    try { await lstat(join(wikiRoot(root), '.run.json')); hasCheckpoint = true } catch (error) { if (error.code !== 'ENOENT') throw error }
    return { version: 'live:initial', snapshot: false, unprotected: hasCheckpoint || ['running', 'stopping', 'failed'].includes(job?.status) }
  }
  const terminal = pointer.phase === 'ready' && job?.viewEpoch === pointer.epoch && job?.viewSnapshotId === pointer.snapshotId && ['done', 'failed'].includes(job?.status)
  const completionHash = terminal ? await verifiedCurrentCompletion(root, pointer, job) : false
  if (completionHash) return { version: `live:${pointer.epoch}:${completionHash}`, snapshot: false, unprotected: false }
  const failedCurrentHash = terminal && job.status === 'failed' ? await wikiCompletionFingerprint(root) : false
  const unverifiedExternal = failedCurrentHash && (!Object.hasOwn(job, 'failureUpdateHash') || failedCurrentHash !== job.failureUpdateHash)
  if (terminal && (job.status === 'done' || unverifiedExternal)) {
    // The live state no longer matches our completed job. Keep the earlier
    // preserved view readable, without presenting it as the external result.
    if (!pointer.snapshotId) return { version: `unavailable:${pointer.epoch}`, snapshot: false, unavailable: true, externalChanged: true }
    const manifest = await readViewManifest(pointer)
    return { version: `snapshot:${pointer.snapshotId}`, snapshot: true, manifest, kind: pointer.kind, externalChanged: true }
  }
  const manifest = pointer.snapshotId ? await readViewManifest(pointer) : null
  const done = pointer.phase === 'unstarted'
  if (manifest && !done) return { version: `snapshot:${pointer.snapshotId}`, snapshot: true, manifest, kind: pointer.kind }
  return { version: `live:${pointer.epoch}`, snapshot: false, unprotected: !done && (pointer.unprotected || !manifest) }
}

async function exists(p) { try { await stat(p); return true } catch { return false } }

// Resolve a page path relative to openwiki/, rejecting traversal/symlink escape.
async function resolvePage(root, pagePath) {
  if (typeof pagePath !== 'string' || pagePath === '' || pagePath.includes('\0') || isAbsolute(pagePath)) {
    throw new WorkbenchError('INVALID_PATH', 'page must be a relative path under openwiki/')
  }
  const realBase = await realpath(wikiRoot(root))
  const rel = relative(realBase, join(realBase, pagePath))
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw new WorkbenchError('PATH_ESCAPE', 'page leaves openwiki/')
  const real = await realpath(join(realBase, pagePath))
  const rel2 = relative(realBase, real)
  if (rel2.startsWith('..' + sep) || rel2 === '..' || isAbsolute(rel2)) throw new WorkbenchError('PATH_ESCAPE', 'page leaves openwiki/')
  if (!(await stat(real)).isFile()) throw new WorkbenchError('NOT_A_FILE', 'page is not a file')
  return real
}

async function listPages(dir, base, out) {
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('._')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) await listPages(full, base, out)
    else if (e.name.endsWith('.md')) out.push(relative(base, full).split(sep).join('/'))
  }
}

export async function wikiStatus(root, requestedVersion) {
  const base = wikiRoot(root)
  const view = await wikiView(root, requestedVersion)
  if (view.unavailable) return { exists: true, pages: [], pageCount: 0, lastUpdate: null, lastCompleted: null,
    viewVersion: view.version, viewIsSnapshot: false, viewExternalChanged: true, viewUnavailable: true }
  if (!view.snapshot && !(await exists(base))) return { exists: false, pages: [], pageCount: 0, lastUpdate: null,
    viewVersion: view.version, viewIsSnapshot: false, viewUnprotected: !!view.unprotected }
  const pages = []
  if (view.snapshot) {
    for (const file of view.manifest.files) {
      if (file.path.endsWith('.md') && file.path.split('/').every(part => !part.startsWith('.'))) pages.push(file.path)
    }
  } else await listPages(base, base, pages)
  pages.sort()
  let lastUpdate = null
  try {
    const path = join(base, '.last-update.json'), info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid update record')
    lastUpdate = JSON.parse(await readFile(path, 'utf8'))
  } catch { /* optional */ }
  let lastCompleted = view.snapshot ? null : (lastUpdate?.status === 'complete' ? lastUpdate : null)
  if (view.snapshot) {
    const saved = await readSavedFile(view.manifest, '.last-update.json')
    try { const previous = JSON.parse(saved?.toString('utf8') ?? ''); if (previous.status === 'complete') lastCompleted = previous } catch { /* no trustworthy completed record */ }
  }
  // A snapshot's completion date must come from that snapshot. A live run's
  // previousLastUpdate can refer to a newer, different Wiki version.
  if (!view.snapshot && !lastCompleted && lastUpdate?.status === 'interrupted') {
    try {
      const path = join(base, '.run.json'), info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid run record')
      const previous = JSON.parse(await readFile(path, 'utf8')).previousLastUpdate
      if (previous?.status === 'complete') lastCompleted = previous
    } catch { /* an older completed update is not always available */ }
  }
  const after = await wikiView(root)
  if (view.version !== after.version) throw new WorkbenchError('WIKI_VIEW_CHANGED', 'Wiki view changed; reload it')
  // This is a read-only hint, not permission to start: the generation entry
  // checks the live checkpoint again immediately before preparing the run.
  const checkpointIssue = wikiCheckpointIssue(root)
  return { exists: true, pages, pageCount: pages.length, lastUpdate, lastCompleted,
    viewVersion: view.version, viewIsSnapshot: view.snapshot, viewUnprotected: !!view.unprotected,
    ...(checkpointIssue ? { checkpointIssue } : {}),
    ...(view.externalChanged ? { viewExternalChanged: true } : {}),
    ...(view.snapshot ? { viewSnapshotKind: view.kind } : {}) }
}

// A child finishing its conversation is not proof that OpenWiki finished.
// Require the durable completion record from this job and no unfinished run.
export async function wikiJobCompleted(root, { startedAt, endedAt, previousUpdate }) {
  try {
    await lstat(join(wikiRoot(root), '.run.json'))
    return false
  } catch (error) {
    if (error.code !== 'ENOENT') return false
  }
  try {
    const raw = await readFile(join(wikiRoot(root), '.last-update.json'), 'utf8')
    const update = JSON.parse(raw)
    const at = Date.parse(update.updatedAt)
    return raw !== previousUpdate && update.status === 'complete' && Number.isFinite(at) && at >= startedAt && at <= endedAt
  } catch { return false }
}

function normalizedPage(root, pagePath) {
  if (typeof pagePath !== 'string' || pagePath === '' || pagePath.includes('\0') || isAbsolute(pagePath)) {
    throw new WorkbenchError('INVALID_PATH', 'page must be a relative path under openwiki/')
  }
  const base = wikiRoot(root), rel = relative(base, join(base, pagePath))
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw new WorkbenchError('PATH_ESCAPE', 'page leaves openwiki/')
  return rel.split(sep).join('/')
}

async function verifySavedEntries(manifest) {
  try {
    const base = join(manifest.dir, 'blobs')
    await checkedDirectory(base)
    for (const file of manifest.files) {
      const info = await lstat(join(base, file.blob))
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size ||
          info.mtimeMs !== file.savedMtimeMs || info.ctimeMs !== file.savedCtimeMs) throw new Error('saved file changed')
    }
  } catch { throw new WorkbenchError('WIKI_SNAPSHOT_UNREADABLE', 'saved Wiki content is missing or damaged') }
}

async function readSavedFile(manifest, path) {
  const entry = manifest.files.find(file => file.path === path)
  if (!entry) return null
  try {
    const current = join(manifest.dir, 'blobs')
    await checkedDirectory(current)
    const file = join(current, entry.blob), info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.size) throw new Error('saved file is missing or changed')
    const bytes = await readFile(file)
    if (sha(bytes) !== entry.sha256) throw new Error('saved file is damaged')
    return bytes
  } catch { throw new WorkbenchError('WIKI_SNAPSHOT_UNREADABLE', 'saved Wiki content is missing or damaged') }
}

async function readViewPair(root, pagePath, view) {
  if (view.unavailable) throw new WorkbenchError('WIKI_SNAPSHOT_UNREADABLE', 'no saved Wiki view is available')
  const rel = normalizedPage(root, pagePath)
  let page = null, claims = null
  if (view.snapshot) {
    page = await readSavedFile(view.manifest, rel)
    claims = await readSavedFile(view.manifest, '.claims/' + rel.replace(/\.md$/, '') + '.json')
  } else {
    try {
      const file = await resolvePage(root, pagePath), info = await stat(file)
      if (info.size > MAX_PAGE_BYTES) throw new WorkbenchError('FILE_TOO_LARGE', 'wiki page exceeds the read limit')
      page = await readFile(file)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const claimsBase = join(wikiRoot(root), '.claims'), sidecar = join(claimsBase, rel.replace(/\.md$/, '') + '.json')
    try {
      const wiki = await realpath(wikiRoot(root)), base = await realpath(claimsBase), baseRel = relative(wiki, base)
      if (baseRel.startsWith('..' + sep) || baseRel === '..' || isAbsolute(baseRel)) throw new WorkbenchError('PATH_ESCAPE', 'Claims leave the Wiki')
      const file = await realpath(sidecar), path = relative(base, file)
      if (path.startsWith('..' + sep) || path === '..' || isAbsolute(path)) throw new WorkbenchError('PATH_ESCAPE', 'Claims leave the Wiki')
      claims = await readFile(file)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (page && page.length > MAX_PAGE_BYTES) throw new WorkbenchError('FILE_TOO_LARGE', 'wiki page exceeds the read limit')
  const fingerprint = sha(`${page === null ? 'missing' : sha(page)}|${claims === null ? 'missing' : sha(claims)}`)
  const after = await wikiView(root)
  if (view.version !== after.version) throw new WorkbenchError('WIKI_VIEW_CHANGED', 'Wiki view changed; reload it')
  return { page, claims, fingerprint }
}

export async function wikiPage(root, pagePath, version) {
  normalizedPage(root, pagePath)
  const view = await wikiView(root, version)
  if (version != null && version !== view.version) throw new WorkbenchError('WIKI_VIEW_CHANGED', 'Wiki view changed; reload it')
  const pair = await readViewPair(root, pagePath, view)
  if (!pair.page) throw new WorkbenchError('NOT_FOUND', 'Wiki page not found in this view')
  return { path: pagePath, content: pair.page.toString('utf8'), bytes: pair.page.length, viewVersion: `${view.version}|${pair.fingerprint}` }
}

// Validate only the fields needed to select the lifecycle mode. OpenWiki 0.9.0
// validates the complete checkpoint before it can replace an existing Wiki.
function validWikiRun(run) {
  return run !== null && typeof run === 'object' && !Array.isArray(run) &&
    run.schemaVersion === 1 && typeof run.runId === 'string' && run.runId.trim().length > 0 &&
    ['init', 'update'].includes(run.mode) && ['planning', 'generating'].includes(run.phase)
}

// Only a missing or completely empty wiki may be initialized: OpenWiki init
// replaces the whole directory, including attachments and hidden files.
export async function wikiBeginMode(root) {
  const base = wikiRoot(root)
  let entries
  try {
    const info = await lstat(base)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid wiki directory')
    entries = await readdir(base)
  } catch (error) {
    if (error.code === 'ENOENT') return { mode: 'init', resume: false }
    throw new WorkbenchError('WIKI_STATE_UNREADABLE', 'cannot inspect the existing Wiki safely')
  }
  if (entries.includes('.run.json')) {
    try {
      const path = join(base, '.run.json')
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid checkpoint')
      const run = JSON.parse(await readFile(path, 'utf8'))
      if (!validWikiRun(run)) throw new Error('invalid checkpoint')
      return { mode: run.mode, resume: true, runId: run.runId }
    } catch {
      throw new WorkbenchError('WIKI_STATE_UNREADABLE', 'cannot read the existing Wiki run safely')
    }
  }
  return { mode: entries.length ? 'update' : 'init', resume: false }
}

// Active OpenWiki run phase (planning/generating) or null. Guards against
// starting a second concurrent generation, even across plugin reloads.
export async function wikiRunPhase(root) {
  try {
    const run = JSON.parse(await readFile(join(wikiRoot(root), '.run.json'), 'utf8'))
    return (run.phase === 'planning' || run.phase === 'generating') ? run.phase : null
  } catch { return null }
}

// Page-level source evidence (FR-25 / B-A3): read the Claims sidecar for a page
// and return each claim's statement + repo:// evidence spans. Read-only.
export async function wikiEvidence(root, pagePath, version) {
  normalizedPage(root, pagePath)
  const view = await wikiView(root, version)
  const pair = await readViewPair(root, pagePath, view)
  if (version != null && version !== `${view.version}|${pair.fingerprint}`) throw new WorkbenchError('WIKI_VIEW_CHANGED', 'Wiki page or evidence changed; reload it')
  let doc = null
  try { doc = JSON.parse(pair.claims?.toString('utf8') ?? '') } catch { return { path: pagePath, claims: [] } }
  const claims = (Array.isArray(doc.claims) ? doc.claims : []).map(c => ({
    statement: c.statement ?? '',
    evidence: (Array.isArray(c.evidence) ? c.evidence : []).map(e => e.resource).filter(r => typeof r === 'string'),
  }))
  return { path: pagePath, claims }
}
