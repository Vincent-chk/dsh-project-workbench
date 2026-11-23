import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readWorkspaceFile, WorkbenchError } from './files.js'
import { parseFrontmatter } from './frontmatter.js'
import { hasReviewablePrd } from './prd.js'
import { requirementOverview } from './state.js'
import { latestPrototype } from './prototype-material.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function parseDiscoveryRecord(file, version) {
  const doc = parseFrontmatter(file)
  const result = {
    version: doc.get('version'), savedAt: doc.get('savedAt'), sessionId: doc.get('sessionId'), previewId: doc.get('previewId'),
    skillSeq: doc.get('skillSeq'), from: doc.get('from'), through: doc.get('through'),
    round: doc.get('round'), markdown: doc.body.trim(), hash: createHash('sha256').update(file).digest('hex'),
  }
  const { round, from, through, skillSeq } = result
  const token = /^[a-zA-Z0-9-]{1,128}$/u
  if (!doc.hasFm || result.version !== version || !Number.isFinite(Date.parse(result.savedAt)) || !result.markdown
    || !token.test(result.sessionId ?? '') || !token.test(result.previewId ?? '')
    || ![from, through, skillSeq].every(Number.isSafeInteger) || skillSeq >= from || through < from
    || !Array.isArray(round) || round.length !== 3 || !round.every(Number.isSafeInteger)
    || !(from <= round[0] && round[0] < round[1] && round[1] < round[2] && round[2] <= through)) {
    throw new WorkbenchError('DISCOVERY_INVALID_RECORD', `第 ${version} 版深挖记录无法核验。`)
  }
  return result
}

export async function readDiscoveryRecords(root, reqId) {
  if (!/^req-\d{8}-[a-f0-9]{6}$/u.test(reqId)) throw new WorkbenchError('INVALID_ID', '需求编号无效。')
  const parts = ['.project', 'requirements', reqId, 'discovery']
  let directory = root
  let names
  try {
    for (const part of parts) {
      directory = join(directory, part)
      if (!(await lstat(directory)).isDirectory()) throw new WorkbenchError('INVALID_PATH', '深挖目录不可用。')
    }
    names = await readdir(directory)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const versions = names.filter(name => /^[1-9]\d*\.md$/u.test(name)).map(name => Number(name.slice(0, -3)))
  if (!versions.every(Number.isSafeInteger)) throw new WorkbenchError('DISCOVERY_INVALID_RECORD', '深挖记录版本号无效。')
  return Promise.all(versions.sort((a, b) => b - a).map(async version => {
    const name = `${version}.md`
    if (!(await lstat(join(directory, name))).isFile()) throw new WorkbenchError('INVALID_PATH', '深挖记录路径不可用。')
    const { content } = await readWorkspaceFile(root, join(...parts, name))
    return parseDiscoveryRecord(content, version)
  }))
}

export function reviewFields(req) {
  return {
    id: req.id, title: req.title, overview: requirementOverview(req), audience: req.q_who,
    goal: req.goal, scope: req.scope, outOfScope: req.q_out,
    acceptance: req.acceptance, otherCriteria: req.q_success,
    background: req.background, decisions: req.decisionNotes,
  }
}

export const reviewSubmission = req => req.reviewSubmissionId || req.submittedAt || 'legacy'

export async function reviewMaterial(root, req, documents) {
  const [records, prototype] = await Promise.all([readDiscoveryRecords(root, req.id), latestPrototype(root, req.id)])
  const discovery = records[0]
  const missing = []
  if (!discovery) missing.push('discovery')
  if (!hasReviewablePrd(documents)) missing.push('prd')
  if (!prototype) missing.push('prototype')
  const source = {
    submissionId: reviewSubmission(req),
    requirementVersion: hash(reviewFields(req)),
    prds: documents.map(({ id, title, revision, version }) => ({ id, title, revision, version })),
    ...(discovery && { discovery: { version: discovery.version, hash: discovery.hash } }),
    prototype: prototype ? { version: prototype.version, hash: hash({ material: prototype.material, prds: prototype.prds, html: prototype.html }) } : null,
  }
  source.fingerprint = hash(source)
  return { source, discovery, prototype, missing }
}

export function requireReviewPreparation({ missing }) {
  if (missing.length === 1 && missing[0] === 'prd') {
    throw new WorkbenchError('REVIEW_PRD_REQUIRED', '请先保存并关联一份有正文的 PRD。')
  }
  if (missing.length) throw new WorkbenchError('PREPARATION_REQUIRED', `missing preparation: ${missing.join(', ')}`)
}

export function matchesReview(report, current) {
  return !!report?.source?.fingerprint && report.source.fingerprint === current.fingerprint
}
