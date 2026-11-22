import { createHash } from 'node:crypto'
import { requirementOverview } from './state.js'
import { latestPrototype } from './prototype-material.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

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
  const prototype = await latestPrototype(root, req.id)
  const source = {
    submissionId: reviewSubmission(req),
    requirementVersion: hash(reviewFields(req)),
    prds: documents.map(({ id, title, revision, version }) => ({ id, title, revision, version })),
    prototype: prototype ? { version: prototype.version, hash: hash({ material: prototype.material, prds: prototype.prds, html: prototype.html }) } : null,
  }
  source.fingerprint = hash(source)
  return { source, prototype }
}

export function matchesReview(report, current) {
  return !!report?.source?.fingerprint && report.source.fingerprint === current.fingerprint
}
