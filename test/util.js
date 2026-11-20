import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { reviewPrds, savePrd } from '../core/prd.js'

export async function makeRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'pw-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

// Setup for tests of development or acceptance. The formal review run is
// exercised separately; its saved report is a prerequisite to approval.
export async function seedReviewPrd(root, reqId) {
  const [existing] = await reviewPrds(root, reqId)
  return existing ?? savePrd(root, { id: 'prd-' + randomUUID(), reqIds: [reqId], markdown: '# 评审夹具\n\n执行测试需求的首版范围。' })
}

export async function seedAIReview(root, reqId) {
  const { id, title, version } = await seedReviewPrd(root, reqId)
  const source = JSON.stringify(JSON.stringify({ prds: [{ id, title, version }] }))
  const reviews = join(root, '.project', 'requirements', reqId, 'reviews')
  await mkdir(reviews, { recursive: true })
  await writeFile(join(reviews, '0.md'), `---\nschema: 2\nkind: ai_review\nround: 0\ndecision: reported\nby: ai\nmarker: test-ai-review\nopinionText: "需求评审夹具"\nsource: ${source}\n---\n`)
}

export function saveReviewPrd(root, reqId) {
  return savePrd(root, { reqIds: [reqId], markdown: '# 送审用 PRD\n\n确认本需求的范围。' })
}

// Content fingerprint matching store.hashText, for tests that confirm completion.
export async function issueFileHash(root, reqId, id) {
  const raw = await readFile(join(root, '.project', 'requirements', reqId, 'issues', `${id}.md`), 'utf8')
  return createHash('sha256').update(raw).digest('hex').slice(0, 20)
}

// Stub Host for background-child flows (delivery summary, organize/split):
// startActivation captures each child; the test resolves its result promise.
export function stubSpawnHost(root) {
  const agents = new Map()
  const children = []
  let created = 0
  const ctx = {
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    on() { return () => {} },
    tools: { guard: () => () => {}, register: () => () => {} },
    systemPrompt: { context: () => () => {} },
    agents: { get: sid => agents.get(sid), list: () => [...agents.values()] },
    sessions: { get: sid => agents.get(sid)?.session },
    workspaceRegistry: { list: () => [] },
    sessionController: {
      create: async ({ cwd } = {}) => {
        const sessionId = `session-stub-${++created}`
        agents.set(sessionId, { session: { id: sessionId, header: { cwd: cwd ?? root }, seq: 0, snapshotEvents: () => [] }, status: 'idle' })
        return { sessionId }
      },
      prompt: async () => ({ accepted: true }),
      cancel: async () => ({ accepted: true }),
    },
    subagents: {
      startActivation: async opts => {
        const child = { childId: opts.childId, name: opts.name, prompt: opts.prompt[0].text, parentId: opts.parent?.session?.id }
        children.push(child)
        child.result = new Promise(resolve => { child.resolve = resolve })
        return { result: child.result, dispose: async () => {} }
      },
      interrupt: () => {},
    },
    sandboxPolicy: { resolve: () => ({ mode: 'read-only' }) },
    logger: { warn: () => {} },
  }
  return { ctx, agents, children }
}

export const childReply = doc => ({ stopReason: 'completed', output: [{ type: 'text', text: '```json\n' + JSON.stringify(doc) + '\n```' }], diagnostic: null })
export const waitFor = async fn => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 10)) } throw new Error('waitFor timeout') }
