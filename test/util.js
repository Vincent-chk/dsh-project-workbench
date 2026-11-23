import { mkdtemp, rm, readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { reviewPrds, savePrd } from '../core/prd.js'
import { createIssue, moveRequirement, readRequirement } from '../core/store.js'
import { reviewMaterial } from '../core/review-material.js'
import { savePrototype } from '../core/prototype-material.js'

export async function makeRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'pw-store-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  return root
}

// Setup for tests of development or acceptance. The formal review run is
// exercised separately; its saved report is a prerequisite to approval.
export async function seedReviewPrd(root, reqId) {
  const [existing] = await reviewPrds(root, reqId)
  return existing ?? savePrd(root, { id: 'prd-' + randomUUID(), reqIds: [reqId], markdown: '# 评审夹具\n\n执行测试需求的首版范围。' })
}

export async function seedReviewPreparation(root, reqId, { prd = true } = {}) {
  const documents = prd ? [await seedReviewPrd(root, reqId)] : []
  const dir = join(root, '.project', 'requirements', reqId, 'discovery')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '1.md'), '---\nversion: 1\nsavedAt: "2026-01-01T00:00:00Z"\nsessionId: fixture-session\npreviewId: fixture-preview\nskillSeq: 1\nfrom: 2\nthrough: 4\nround: [2, 3, 4]\n---\n\n核对需求范围与验收标准。\n', { flag: 'wx' })
    .catch(error => { if (error.code !== 'EEXIST') throw error })
  await savePrototype(root, reqId, {
    prds: documents.map(({ id, version }) => ({ id, version })), html: '<p>验收预览</p>',
    material: { summary: '核对验收流程', flow: [{ from: '提交', to: '通过', when: '结果符合预期' }],
      screens: [{ title: '验收', state: '待核对', elements: [{ kind: 'button', label: '确认' }] }] },
  }, 1)
}

export async function seedAIReview(root, reqId, { submit = false, preparation = true } = {}) {
  if (preparation) await seedReviewPreparation(root, reqId)
  else await seedReviewPrd(root, reqId)
  if (submit) await moveRequirement(root, reqId, 'reviewing')
  const current = await reviewMaterial(root, await readRequirement(root, reqId), await reviewPrds(root, reqId))
  const source = JSON.stringify(JSON.stringify(current.source))
  const reviews = join(root, '.project', 'requirements', reqId, 'reviews')
  await mkdir(reviews, { recursive: true })
  await writeFile(join(reviews, '0.md'), `---\nschema: 2\nkind: ai_review\nround: 0\ndecision: reported\nby: ai\nmarker: test-ai-review\nopinionText: "需求评审夹具"\nsource: ${source}\n---\n`)
}

// Exercise the real transition, then remove its fixture task so downstream tests
// can arrange and assert on exactly the task set they need.
export async function startTestDevelopment(root, reqId, start = () => moveRequirement(root, reqId, 'in_progress')) {
  const { data: { id } } = await createIssue(root, reqId, '开工夹具', { problemOverview: '测试任务', acceptance: '验收通过' })
  const result = await start()
  if (result?.ok === false) throw new Error(result.message)
  await unlink(join(root, '.project', 'requirements', reqId, 'issues', `${id}.md`))
  return result
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
