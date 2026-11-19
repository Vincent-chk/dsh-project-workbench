import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { readWorkspaceFile, WorkbenchError } from './files.js'
import * as store from './store.js'
import { gitStatus, gitCommitProject } from './git.js'
import { wikiStatus, wikiPage, wikiEvidence } from './wiki.js'
import { readArchitecture } from './architecture.js'
import { listPrds, readPrd, readPrdImage, savePrd, setPrdDeleted, setPrdLink } from './prd.js'
import * as proposals from './proposals.js'
import { deriveRequirement, currentDoing, todaySuggestion, rankSuggestions, homeSummary } from './derive.js'

function failure(code, message) {
  return { ok: false, code, message }
}

function assertRoot(root) {
  if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0')) {
    throw new WorkbenchError('INVALID_ROOT', 'root must be an absolute path')
  }
}

// Routes map 1:1 to the RPC contract; every write goes through the store.
// The authenticated UI entry IS the human source: actor is set here, never read
// from the request body (tech §7.2). Store mutators return {ok,data}; unwrap so
// dispatch is the single envelope producer.
const routes = {
  'project/open': async i => { assertRoot(i.root); return store.scanProject(i.root) },
  'project/init': async i => { assertRoot(i.root); return (await store.initProject(i.root, { name: i.name, goal: i.goal })).data },
  'project/validate': async i => { assertRoot(i.root); return (await store.validateProject(i.root)).data },
  'requirement/create': async i => { assertRoot(i.root); return (await store.createRequirement(i.root, i.title, i.fields ?? {})).data },
  'requirement/update': async i => { assertRoot(i.root); return (await store.updateRequirement(i.root, i.id, i.patch, { fileHash: i.fileHash, confirmReviewInvalid: i.confirmReviewInvalid, reason: i.reason })).data },
  'requirement/move': async i => {
    assertRoot(i.root)
    if (i.to === 'completed' && (typeof i.expectFingerprint !== 'string' || !i.expectFingerprint.trim())) {
      throw new WorkbenchError('FINGERPRINT_REQUIRED', 'review the requirement and its tasks before acceptance')
    }
    return (await store.moveRequirement(i.root, i.id, i.to, { reason: i.reason, opinion: i.opinion, fileHash: i.fileHash, confirmReviewInvalid: i.confirmReviewInvalid, expectFingerprint: i.expectFingerprint, actor: 'human' })).data
  },
  'requirement/review': async i => {
    assertRoot(i.root)
    const to = { submit: 'reviewing', approve: 'ready', return: 'backlog' }[i.action]
    if (!to) throw new WorkbenchError('INVALID_ACTION', 'action must be submit|approve|return')
    return (await store.moveRequirement(i.root, i.id, to, { reason: i.reason, opinion: i.opinion, actor: 'human' })).data
  },
  'requirement/startDev': async i => { assertRoot(i.root); return (await store.moveRequirement(i.root, i.id, 'in_progress', { actor: 'human' })).data },
  'requirement/submit': async i => {
    assertRoot(i.root)
    if (typeof i.expectFingerprint !== 'string' || !i.expectFingerprint.trim()) {
      throw new WorkbenchError('FINGERPRINT_REQUIRED', 'review the requirement and its tasks before submission')
    }
    return (await store.submitRequirement(i.root, i.id, { summary: i.summary, cancelImpact: i.cancelImpact, expectFingerprint: i.expectFingerprint, actor: 'human' })).data
  },
  'requirement/reopen': async i => { assertRoot(i.root); return (await store.reopenRequirement(i.root, i.id, { reason: i.reason, reopen: i.reopen, create: i.create, fileHash: i.fileHash })).data },
  'issue/create': async i => { assertRoot(i.root); return (await store.createIssue(i.root, i.reqId, i.title, i.fields ?? {})).data },
  'issue/update': async i => { assertRoot(i.root); return (await store.updateIssue(i.root, i.reqId, i.id, i.patch, {
    fileHash: i.fileHash, validateContent: true, recordResult: i.recordResult === true,
  })).data },
  'issue/move': async i => { assertRoot(i.root); return (await store.moveIssue(i.root, i.reqId, i.id, i.to, { reason: i.reason, blockedReason: i.blockedReason, actor: 'human', fileHash: i.fileHash })).data },
  'issue/confirm': async i => { assertRoot(i.root); return (await store.confirmIssue(i.root, i.reqId, i.id, { summary: i.summary, evidence: i.evidence, opinion: i.opinion, fileHash: i.fileHash })).data },
  'issue/continue': async i => { assertRoot(i.root); return (await store.continueIssue(i.root, i.reqId, i.id, { text: i.text, fileHash: i.fileHash })).data },
  'requirement/addUpdate': async i => { assertRoot(i.root); return (await store.addRequirementUpdate(i.root, i.id, i.text)).data },
  'issue/addUpdate': async i => { assertRoot(i.root); return (await store.addIssueUpdate(i.root, i.reqId, i.id, i.text)).data },
  'project/trash': async i => { assertRoot(i.root); return (await store.trash(i.root, i.kind, i.id, { reqId: i.reqId })).data },
  'project/restore': async i => { assertRoot(i.root); return (await store.restore(i.root, { location: i.location })).data },
  'task/stamp': async i => { assertRoot(i.root); return store.taskStamp(i.root, i.reqId, i.id) },
  'project/gitStatus': async i => { assertRoot(i.root); return gitStatus(i.root) },
  'project/gitCommit': async i => { assertRoot(i.root); return gitCommitProject(i.root, i.message) },
  'wiki/status': async i => { assertRoot(i.root); return wikiStatus(i.root, i.viewVersion) },
  'wiki/page': async i => { assertRoot(i.root); return wikiPage(i.root, i.path, i.viewVersion) },
  'wiki/evidence': async i => { assertRoot(i.root); return wikiEvidence(i.root, i.path, i.viewVersion) },
  'architecture/read': async i => { assertRoot(i.root); return readArchitecture(i.root) },
  'prd/list': async i => { assertRoot(i.root); return listPrds(i.root, i.reqId, { deleted: i.deleted === true }) },
  'prd/read': async i => { assertRoot(i.root); return readPrd(i.root, i.id) },
  'prd/save': async i => { assertRoot(i.root); return savePrd(i.root, i) },
  'prd/link': async i => { assertRoot(i.root); return setPrdLink(i.root, i) },
  'prd/delete': async i => { assertRoot(i.root); return setPrdDeleted(i.root, { ...i, deleted: true }) },
  'prd/restore': async i => { assertRoot(i.root); return setPrdDeleted(i.root, { ...i, deleted: false }) },
  'prd/image': async i => { assertRoot(i.root); return readPrdImage(i.root, i.id, i.name) },
  'sync/proposals': async i => { assertRoot(i.root); return { proposals: await proposals.listProposals(i.root), baseline: await proposals.readBaseline(i.root) } },
  'sync/submit': async i => { assertRoot(i.root); return (await proposals.submitProposals(i.root, i.proposals)).data },
  'sync/apply': async i => { assertRoot(i.root); return (await proposals.adoptProposal(i.root, i.proposalId, i.patch)).data },
  'sync/dismiss': async i => {
    assertRoot(i.root)
    const data = (await proposals.markDismissed(i.root, i.proposalId, i.reason)).data
    const base = await proposals.readBaseline(i.root)
    await proposals.writeBaseline(i.root, { dismissed: (base.dismissed ?? 0) + 1 })
    return data
  },
  'proposal/list': async i => { assertRoot(i.root); return { proposals: await proposals.listProposals(i.root) } },
  'proposal/adopt': async i => { assertRoot(i.root); return (await proposals.adoptProposal(i.root, i.proposalId, i.patch, { reqId: i.reqId })).data },
  'proposal/dismiss': async i => { assertRoot(i.root); return (await proposals.markDismissed(i.root, i.proposalId, i.reason)).data },
  'requirement/list': async i => {
    assertRoot(i.root)
    const idx = await store.scanProject(i.root)
    const byId = Object.fromEntries(idx.requirements.map(r => [r.id, r.issues ?? []]))
    const requirements = idx.requirements.map(r => ({ ...r, derived: deriveRequirement(r, r.issues ?? []) }))
    return { project: idx.project, initialized: !!idx.project, requirements, diagnostics: idx.diagnostics, currentDoing: currentDoing(idx.requirements, byId), todaySuggestion: todaySuggestion(idx.requirements, byId), suggestions: rankSuggestions(idx.requirements, byId) }
  },
  'requirement/get': async i => {
    assertRoot(i.root)
    const idx = await store.scanProject(i.root)
    const req = idx.requirements.find(r => r.id === i.id)
    if (!req) throw new WorkbenchError('NOT_FOUND', `requirement ${i.id} not found`)
    return { ...req, derived: deriveRequirement(req, req.issues ?? []) }
  },
  'home/summary': async i => {
    assertRoot(i.root)
    const idx = await store.scanProject(i.root)
    const byId = Object.fromEntries(idx.requirements.map(r => [r.id, r.issues ?? []]))
    // Runtime run facts (awaiting authorization, failures) are passed in by the
    // caller; nothing here is persisted. Uninitialized → recognizable empty state.
    const { reminders, counts } = homeSummary(idx.requirements, byId, { running: Array.isArray(i.running) ? i.running : [] })
    const files = idx.requirements.map(req => [req.hash, req.issues.map(issue => issue.hash)])
    const awaitingAuth = (Array.isArray(i.running) ? i.running : [])
      .filter(item => item?.awaitingAuth).map(item => [item.issueId, item.authAskedAt ?? null, item.authIdentity ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    // Request identity and time must change the stamp even for the same task.
    const stamp = idx.project
      ? createHash('sha256').update(JSON.stringify([idx.project, idx.diagnostics, files, awaitingAuth])).digest('hex')
      : null
    return { project: idx.project, initialized: !!idx.project, diagnostics: idx.diagnostics, reminders, counts, stamp }
  },
}

export async function dispatch(endpoint, input, signal, extraRoutes, hooks) {
  if (signal.aborted) return failure('CANCELLED', 'request was cancelled')
  try {
    if (endpoint === 'probe/read') {
      const data = await readWorkspaceFile(input?.root, input?.path)
      if (signal.aborted) return failure('CANCELLED', 'request was cancelled')
      return { ok: true, data }
    }
    const route = routes[endpoint] ?? extraRoutes?.[endpoint]
    if (!route) return failure('NOT_FOUND', `unknown method: ${endpoint}`)
    const data = await route(input ?? {}, hooks)
    if (signal.aborted) return failure('CANCELLED', 'request was cancelled')
    return { ok: true, data }
  } catch (error) {
    if (error instanceof WorkbenchError) return failure(error.code, error.message)
    if (error?.code === 'ENOENT') return failure('NOT_FOUND', 'file or workspace does not exist')
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return failure('ACCESS_DENIED', 'file permission was denied')
    return failure('READ_FAILED', error instanceof Error ? error.message : String(error))
  }
}

export async function handleRequest(request, extraRoutes, hooks) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json(failure('INVALID_JSON', 'request body must be JSON'), { status: 400 })
  }
  return Response.json(await dispatch(body?.method, body?.input, request.signal, extraRoutes, hooks))
}
