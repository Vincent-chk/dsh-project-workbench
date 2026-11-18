// Proposal queue storage (§4.8 / C-11 / R-15). Machine cache, NOT commitments:
// proposals live in .project/.local/tmp/sync/ with a hard 24h TTL (lazy purge,
// hard delete, never the trash). The persistent baseline lives in .local/sync/
// and is never TTL-cleared. AI never writes kanban; the Host is the single writer.
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicWrite, WorkbenchError } from './files.js'
import * as store from './store.js'

const TTL_MS = 24 * 60 * 60 * 1000
const KINDS = ['advance', 'review', 'capture', 'clarify', 'stalled', 'wiki_drift', 'field_draft', 'new_task', 'req_draft', 'task_suggestion']

const tmpDir = root => join(root, '.project', '.local', 'tmp', 'sync')
const baseDir = root => join(root, '.project', '.local', 'sync')
const nowIso = () => new Date().toISOString()
const proposalId = () => `prop-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`

function isSplitProposal(doc) {
  return doc.kind === 'new_task' && (!!doc.split || (Array.isArray(doc.evidence) && doc.evidence.includes(`draft://requirement/${doc.target?.reqId}`)))
}

async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }

// Lazy purge: drop expired proposals on open/sync. Never touches .local/sync/ or kanban.
export async function purgeExpired(root) {
  const dir = tmpDir(root)
  let names = []
  try { names = await readdir(dir) } catch { return 0 }
  let removed = 0
  const cutoff = Date.now() - TTL_MS
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const doc = await readJson(join(dir, name))
    const created = doc?.createdAt ? Date.parse(doc.createdAt) : 0
    if (!doc || !Number.isFinite(created) || created < cutoff) {
      await rm(join(dir, name), { force: true }); removed++
    }
  }
  return removed
}

function validateProposal(p) {
  if (!p || typeof p !== 'object') throw new WorkbenchError('INVALID_PROPOSAL', 'proposal must be an object')
  if (!KINDS.includes(p.kind)) throw new WorkbenchError('INVALID_PROPOSAL', `kind must be one of ${KINDS.join('|')}`)
  if (!p.target || typeof p.target !== 'object' || !p.target.reqId) throw new WorkbenchError('INVALID_PROPOSAL', 'target.reqId is required')
  if (!Array.isArray(p.evidence) || p.evidence.length === 0) throw new WorkbenchError('EVIDENCE_REQUIRED', 'no evidence, no proposal')
  if (!p.reason || !String(p.reason).trim()) throw new WorkbenchError('INVALID_PROPOSAL', 'reason is required')
  if (p.kind === 'field_draft') {
    if (!p.target.issueId) throw new WorkbenchError('INVALID_PROPOSAL', 'field_draft needs target.issueId')
    if (!p.suggested_patch || typeof p.suggested_patch !== 'object' || !Object.keys(p.suggested_patch).length) {
      throw new WorkbenchError('INVALID_PROPOSAL', 'field_draft needs a non-empty suggested_patch')
    }
  }
  if (p.kind === 'new_task' && (!p.suggested_patch?.title || !String(p.suggested_patch.title).trim())) {
    throw new WorkbenchError('INVALID_PROPOSAL', 'new_task needs suggested_patch.title')
  }
  if (p.kind === 'req_draft') {
    const patch = p.suggested_patch
    if (!patch || typeof patch !== 'object' || !['q_pain', 'goal', 'scope', 'acceptance'].some(k => typeof patch[k] === 'string' && patch[k].trim())) {
      throw new WorkbenchError('INVALID_PROPOSAL', 'req_draft needs at least one drafted requirement field')
    }
  }
  if (p.kind === 'task_suggestion') {
    if (!p.target.issueId) throw new WorkbenchError('INVALID_PROPOSAL', 'task_suggestion needs target.issueId')
    if (!['scope', 'cancel'].includes(p.suggested_patch?.action) || !String(p.suggested_patch?.text ?? '').trim()) {
      throw new WorkbenchError('INVALID_PROPOSAL', 'task_suggestion needs action scope|cancel and text')
    }
  }
}

function proposalDocument(p, { baseHash, split } = {}) {
  return {
    id: proposalId(), kind: p.kind, target: p.target, evidence: p.evidence,
    suggested_patch: p.suggested_patch ?? null, confidence: p.confidence ?? 'medium',
    reason: String(p.reason).trim(), createdAt: nowIso(), status: 'pending',
    ...(baseHash ? { baseHash } : {}), ...(split ? { split } : {}),
  }
}

// Host single-writer: accept proposals from the read-only sync child, persist to tmp.
export async function submitProposals(root, proposals) {
  if (!Array.isArray(proposals)) throw new WorkbenchError('INVALID_PROPOSAL', 'proposals must be an array')
  await purgeExpired(root)
  const dir = tmpDir(root)
  await mkdir(dir, { recursive: true })
  // 24h frequency control: a draft can be proposed again against a fresh source version.
  const existing = await listProposals(root, { purge: false })
  const saved = []
  for (const p of proposals) {
    validateProposal(p)
    // A field draft always carries the task fingerprint at draft time, whichever
    // entry produced it, so adoption after a human edit conflicts (§3.5).
    let baseHash = p.baseHash
    if (p.kind === 'field_draft' && !baseHash && p.target.issueId) {
      try { baseHash = (await store.taskStamp(root, p.target.reqId, p.target.issueId)).hash } catch { /* task gone */ }
    }
    const versioned = p.kind === 'field_draft' || p.kind === 'req_draft'
    const doc = proposalDocument(p, { baseHash })
    const legacySplit = isSplitProposal(doc)
    const dup = existing.find(e => !e.split && isSplitProposal(e) === legacySplit &&
      e.target.reqId === p.target.reqId && e.target.issueId === p.target.issueId && e.kind === p.kind &&
      (!versioned || (e.status === 'pending' && e.baseHash === baseHash)) &&
      (p.kind === 'new_task'
        ? String(e.suggested_patch?.title ?? '').trim() === String(p.suggested_patch.title).trim()
        : JSON.stringify(e.suggested_patch ?? null) === JSON.stringify(p.suggested_patch ?? null)))
    if (dup) continue
    await writeDoc(join(dir, `${doc.id}.json`), doc)
    existing.push(doc)
    saved.push(doc.id)
  }
  return { ok: true, data: { saved, skipped: proposals.length - saved.length } }
}

// Only the requirement assessment can publish individually adoptable split drafts.
// A successful new assessment retires the old pending drafts even if no gap remains.
export function saveSplitProposals(root, reqId, proposals) {
  return withProposalLock(root, splitLockKey(reqId), async () => {
    const generation = randomBytes(12).toString('hex')
    const requirementIds = new Set()
    const drafts = proposals.map(p => {
      validateProposal(p)
      const basis = p.split
      if (p.kind !== 'new_task' || p.target.reqId !== reqId || p.target.issueId ||
          !basis?.version?.requirement || !basis.version.tasks || !Array.isArray(basis.requirements) || !basis.requirements.length) {
        throw new WorkbenchError('INVALID_PROPOSAL', '任务草稿需要关联本需求的核对依据')
      }
      for (const requirement of basis.requirements) {
        if (!requirement.id || !requirement.text || requirementIds.has(requirement.id)) {
          throw new WorkbenchError('INVALID_PROPOSAL', '同一缺口只能对应一项新增建议')
        }
        requirementIds.add(requirement.id)
      }
      return proposalDocument(p, { split: { ...basis, generation } })
    })
    const previous = (await listProposals(root)).filter(doc =>
      doc.target?.reqId === reqId && doc.status === 'pending' && isSplitProposal(doc))
    const dir = tmpDir(root)
    await mkdir(dir, { recursive: true })
    const added = [], retired = []
    try {
      for (const doc of drafts) {
        await writeDoc(join(dir, `${doc.id}.json`), doc)
        added.push(doc)
      }
      for (const doc of previous) {
        await writeDoc(join(dir, `${doc.id}.json`), { ...doc, status: 'dismissed', decidedAt: nowIso(), dismissReason: 'superseded' })
        retired.push(doc)
      }
    } catch (error) {
      await Promise.allSettled([
        ...added.map(doc => rm(join(dir, `${doc.id}.json`), { force: true })),
        ...retired.map(doc => writeDoc(join(dir, `${doc.id}.json`), doc)),
      ])
      throw error
    }
    return { ok: true, data: { saved: drafts.map(doc => doc.id), skipped: 0 } }
  })
}

export async function listProposals(root, { purge = true } = {}) {
  if (purge) await purgeExpired(root)
  const dir = tmpDir(root)
  let names = []
  try { names = await readdir(dir) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const doc = await readJson(join(dir, name))
    if (doc && doc.id) out.push(doc)
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

async function loadProposal(root, proposalId) {
  if (!/^prop-[a-z0-9-]+$/.test(proposalId)) throw new WorkbenchError('INVALID_ID', 'invalid proposal id')
  const doc = await readJson(join(tmpDir(root), `${proposalId}.json`))
  if (!doc) throw new WorkbenchError('NOT_FOUND', 'proposal not found or expired')
  return doc
}

// Human approval: mark approved; the caller then invokes the SAME move RPC (guards unchanged).
export async function markApproved(root, proposalId) {
  const doc = await loadProposal(root, proposalId)
  doc.status = 'approved'; doc.decidedAt = nowIso()
  await atomicWrite(join(tmpDir(root), `${proposalId}.json`), JSON.stringify(doc, null, 2) + '\n')
  return { ok: true, data: doc }
}

// Human rejection: see markDismissed below (shares the adoption serial region).

// Persistent baseline (no TTL): last sync commit/time + acceptance metrics.
export async function readBaseline(root) {
  return (await readJson(join(baseDir(root), 'baseline.json'))) ?? { lastCommit: null, lastSyncAt: null, accepted: 0, dismissed: 0, produced: 0 }
}
export async function writeBaseline(root, patch) {
  const dir = baseDir(root)
  await mkdir(dir, { recursive: true })
  const cur = await readBaseline(root)
  const next = { ...cur, ...patch }
  await atomicWrite(join(dir, 'baseline.json'), JSON.stringify(next, null, 2) + '\n')
  return { ok: true, data: next }
}

// Apply a proposal through the SAME store guards as manual actions. Drafts only
// become formal objects here; adopting never bypasses state rules. A new task is
// created atomically WITH its fields, idempotent by the pre-allocated ID.
export async function applyProposal(root, doc) {
  const patch = doc.suggested_patch ?? {}
  if (doc.kind === 'field_draft') {
    // baseHash is the task fingerprint at draft time: a human edit since then
    // makes adoption conflict rather than overwrite human content (§3.5). An old
    // draft without a fingerprint cannot be checked, so refuse it (re-draft).
    if (!doc.baseHash) throw new WorkbenchError('DRAFT_STALE', '字段草稿缺少版本指纹，请重新起草后再采用')
    return (await store.updateIssue(root, doc.target.reqId, doc.target.issueId, patch, { proposalId: doc.id, fileHash: doc.baseHash })).data
  }
  if (doc.kind === 'new_task') {
    const { title, ...fields } = patch
    let splitVersion
    if (doc.split) {
      const tasks = { ...doc.split.version.tasks }
      const siblings = await listProposals(root, { purge: false })
      for (const sibling of siblings) {
        if (sibling.id === doc.id || sibling.target?.reqId !== doc.target.reqId || sibling.split?.generation !== doc.split.generation) continue
        if (sibling.adoptedResult?.hash) tasks[sibling.adoptedResult.id] = sibling.adoptedResult.hash
      }
      splitVersion = { ...doc.split.version, tasks, sources: doc.split.sources }
    }
    const created = (await store.createIssue(root, doc.target.reqId, title, fields, doc.adoptedResult?.id ?? null, { reuseTitle: true, splitVersion })).data
    return { ...created, reqId: doc.target.reqId }
  }
  if (doc.kind === 'req_draft') {
    // baseHash: the requirement as it was when the draft was produced. A later
    // human edit makes adoption conflict instead of silently overwriting.
    return (await store.updateRequirement(root, doc.target.reqId, patch, { fileHash: doc.baseHash, proposalId: doc.id })).data
  }
  if (doc.kind === 'task_suggestion') {
    if (patch.action === 'cancel') {
      // Adoption IS the human decision; the AI only proposed it.
      return (await store.moveIssue(root, doc.target.reqId, doc.target.issueId, 'cancelled', { reason: patch.text, actor: 'human', proposalId: doc.id })).data
    }
    const idx = await store.scanProject(root)
    const issue = idx.requirements.find(r => r.id === doc.target.reqId)?.issues?.find(i => i.id === doc.target.issueId)
    if (!issue) throw new WorkbenchError('NOT_FOUND', `issue ${doc.target.issueId} not found`)
    const description = [issue.description, patch.text].filter(s => String(s ?? '').trim()).join('\n\n')
    return (await store.updateIssue(root, doc.target.reqId, doc.target.issueId, { description }, { proposalId: doc.id })).data
  }
  return doc.target.issueId
    ? (await store.moveIssue(root, doc.target.reqId, doc.target.issueId, patch.to, { reason: `proposal:${doc.id}`, blockedReason: patch.blockedReason, proposalId: doc.id })).data
    : (await store.moveRequirement(root, doc.target.reqId, patch.to, { reason: `proposal:${doc.id}`, actor: 'human', proposalId: doc.id })).data
}

// The canonical lock is per proposal for ordinary drafts. A split's drafts
// share the requirement key so adoption sees every task created in that batch.
const proposalChains = new Map()
const splitLockKey = reqId => `split-${reqId}`
const proposalLockKey = doc => isSplitProposal(doc) ? splitLockKey(doc.target.reqId) : doc.id
function withProposalLock(root, proposalId, fn) {
  return realpath(root).catch(() => root).then(canonicalRoot => {
    const key = join(tmpDir(canonicalRoot), `${proposalId}.json`)
    const prev = proposalChains.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const settled = next.catch(() => {})
    proposalChains.set(key, settled)
    const cleanup = () => { if (proposalChains.get(key) === settled) proposalChains.delete(key) }
    void next.then(cleanup, cleanup)
    return next
  })
}
const writeDoc = (file, doc) => atomicWrite(file, JSON.stringify(doc, null, 2) + '\n')

// Human adoption, shared by proposal/adopt and sync/apply. The durable "adopting"
// claim is written BEFORE any object is created (with a pre-allocated task ID), so
// a crash at any later write retries against the same object — never a duplicate.
export async function adoptProposal(root, proposalId, revisedPatch, { reqId } = {}) {
  const doc = await loadProposal(root, proposalId)
  if (isSplitProposal(doc)) {
    if (reqId !== doc.target.reqId) throw new WorkbenchError('SPLIT_REVIEW_REQUIRED', '请回到需求详情逐条采用任务建议')
    if (!doc.split) throw new WorkbenchError('DRAFT_STALE', '旧的任务建议缺少核对依据，请回到需求重新生成')
  }
  return withProposalLock(root, proposalLockKey(doc), () => adoptInner(root, proposalId, revisedPatch))
}
async function adoptInner(root, proposalId, revisedPatch) {
  const file = join(tmpDir(root), `${proposalId}.json`)
  const doc = await loadProposal(root, proposalId)
  if (doc.status === 'adopted') return { ok: true, data: { ...doc.adoptedResult, alreadyAdopted: true } }
  if (doc.status === 'dismissed' && doc.dismissReason === 'superseded' && isSplitProposal(doc)) {
    throw new WorkbenchError('DRAFT_STALE', '任务建议已更新，请重新核对后再采用')
  }
  // The user may revise a draft before adopting; persist the revision so a crash
  // retry applies the same content (§3.5).
  if (revisedPatch && typeof revisedPatch === 'object' && doc.status === 'pending') {
    doc.suggested_patch = { ...(doc.suggested_patch ?? {}), ...revisedPatch }
  }
  if (doc.status === 'adopting') {
    if (doc.adoptedResult) {
      // Effect already recorded; for a new task ensure it exists (idempotent by ID).
      if (doc.kind === 'new_task') await applyProposal(root, doc)
      doc.status = 'adopted'; doc.decidedAt = nowIso()
      await writeDoc(file, doc)
      await bumpAccepted(root)
      return { ok: true, data: { ...doc.adoptedResult, alreadyAdopted: true } }
    }
    // Claimed but the effect was not recorded (crashed during apply): apply now.
    const result = await applyProposal(root, doc)
    doc.adoptedResult = result; doc.status = 'adopted'; doc.decidedAt = nowIso()
    await writeDoc(file, doc)
    await bumpAccepted(root)
    return { ok: true, data: result }
  }
  if (doc.status !== 'pending') throw new WorkbenchError('INVALID_STATE', `proposal already ${doc.status}`)
  // Claim BEFORE creating: pre-allocate the task ID so a later crash reuses it.
  if (doc.kind === 'new_task') doc.adoptedResult = { id: store.newIssueId(), reqId: doc.target.reqId }
  doc.status = 'adopting'
  await writeDoc(file, doc)
  let result
  try {
    result = await applyProposal(root, doc) // invalid → throws; no object created (atomic)
  } catch (e) {
    // A thrown error means nothing was created: revert the claim so the proposal
    // is cleanly retryable. (A process crash instead leaves "adopting" → reuse.)
    doc.status = 'pending'; delete doc.adoptedResult
    await writeDoc(file, doc).catch(() => {})
    throw e
  }
  doc.adoptedResult = result
  await writeDoc(file, doc) // record the effect durably before finalizing
  doc.status = 'adopted'; doc.decidedAt = nowIso()
  await writeDoc(file, doc)
  await bumpAccepted(root)
  return { ok: true, data: result }
}
async function bumpAccepted(root) {
  const base = await readBaseline(root)
  await writeBaseline(root, { accepted: (base.accepted ?? 0) + 1 })
}

// Human rejection: same serial region and status check as adoption, so a concurrent
// adopt and dismiss cannot both succeed.
export async function markDismissed(root, proposalId, reason) {
  return withProposalLock(root, proposalLockKey(await loadProposal(root, proposalId)), async () => {
    const doc = await loadProposal(root, proposalId)
    if (doc.status !== 'pending') throw new WorkbenchError('INVALID_STATE', `proposal already ${doc.status}`)
    doc.status = 'dismissed'; doc.decidedAt = nowIso(); doc.dismissReason = reason ? String(reason) : ''
    await writeDoc(join(tmpDir(root), `${proposalId}.json`), doc)
    return { ok: true, data: doc }
  })
}
