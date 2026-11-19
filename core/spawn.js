import { randomUUID } from 'node:crypto'

function textOf(result) {
  return result.output.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

// Background tool trimming (README three-layer boundary): each read-only child
// keeps only the tools its job needs. The Host applies the restriction in the
// agent/created hook via consumeChildToolAllow; the read-only sandbox remains the
// hard write boundary underneath.
const childToolAllow = new Map() // childId -> allow[]
export function consumeChildToolAllow(childId) {
  const allow = childToolAllow.get(childId)
  childToolAllow.delete(childId)
  return allow
}
const READ_TOOLS = ['read', 'glob', 'grep']

// General read-only background child (S0+ probe / evidence collection).
async function runChild(ctx, readOnlyChildren, sessionId, signal, { label, prompt }) {
  const parent = ctx.agents.get(sessionId)
  if (!parent) return { ok: false, code: 'SESSION_NOT_LIVE', message: 'current session is not active' }
  const childId = `session-${randomUUID()}`
  const parentModel = parent.model.current()
  readOnlyChildren.add(childId)
  let activation
  try {
    activation = await ctx.subagents.startActivation({
      provider: 'spawn', label, name: `workbench-${childId.slice(-12)}`,
      childId, parent, signal, delivery: 'caller', maxDepth: 1,
      prompt: [{ type: 'text', text: prompt }],
    })
    const child = ctx.agents.get(childId)
    const childModel = child?.model.current()
    const sandbox = child ? ctx.sandboxPolicy.resolve({ session: child.session }).mode : 'unavailable'
    const result = await activation.result
    return {
      ok: result.stopReason === 'completed',
      code: result.stopReason === 'completed' ? undefined : 'SPAWN_FAILED',
      data: {
        childId, parentModel, childModel, sandbox, stopReason: result.stopReason,
        output: textOf(result), delivery: 'caller',
      },
      ...(result.stopReason === 'completed' ? {} : { message: result.diagnostic ?? `child ended: ${result.stopReason}` }),
    }
  } catch (error) {
    readOnlyChildren.delete(childId)
    if (activation) await activation.dispose().catch(() => {})
    return { ok: false, code: 'SPAWN_FAILED', message: error instanceof Error ? error.message : String(error) }
  }
}

export async function spawnProbe(ctx, readOnlyChildren, sessionId, signal) {
  return runChild(ctx, readOnlyChildren, sessionId, signal, {
    label: 'Project workbench S0+ probe',
    prompt: 'Reply exactly WORKBENCH_SPAWN_OK. Do not use any tools.',
  })
}

// Probe: can a background child see the host-registered OpenWiki MCP tools?
export async function spawnWikiProbe(ctx, readOnlyChildren, sessionId, signal, root) {
  return runChild(ctx, readOnlyChildren, sessionId, signal, {
    label: 'Project workbench wiki MCP probe',
    prompt: `Inspect the tools available to you. Count how many tool names start with "openwiki". Reply with exactly one line: WIKI_MCP_OK:<count> if at least one, otherwise WIKI_MCP_MISSING. Do not call any tools and do not write any files. Target workspace root: ${root}`,
  })
}

// Fire-and-forget wiki generation. Returns immediately with a result promise the
// Host tracks; the child writes only openwiki/ via the OpenWiki lifecycle.
export async function startWikiGeneration(ctx, sessionId, root, begin = { mode: 'init', resume: false }, childId = `session-${randomUUID()}`, controller = new AbortController()) {
  const parent = ctx.agents.get(sessionId)
  if (!parent) return { ok: false, code: 'SESSION_NOT_LIVE', message: 'current session is not active' }
  // The Host owns this controller before startup is awaited; an HTTP request
  // signal cannot be used because the HTTP request ends before the child.
  const ac = controller
  const mode = begin.mode === 'update' ? 'update' : 'init'
  const prompt = `You are the background Project Workbench wiki generator. Generate or update the OpenWiki for the Git repository at root="${root}". ` +
    `The Host has fixed the lifecycle mode: call openwiki_begin exactly once with arguments {"root": ${JSON.stringify(root)}, "mode": "${mode}", "language": "zh"}. Never use another mode: "init" replaces the existing wiki, so it is only allowed for a new project; the Host guard rejects a mismatched mode. ` +
    (begin.resume ? 'This resumes an interrupted run: keep the same mode and continue it rather than starting over. ' : '') +
    'If begin reports that source drift invalidated the plan, call openwiki_begin again with the same mode and force: true, then submit a replacement plan. ' +
    'Load the openwiki skill and follow its resumable page-job lifecycle exactly: submit the page plan, then for each pending page job research the topic, write the assigned Markdown page under openwiki/, and submit it, and finally call openwiki_finish. ' +
    'Write ALL page content in Simplified Chinese (简体中文). Keep code identifiers, file paths, API names, and command lines in their original form, but explain everything around them in Chinese. Use relative Markdown links between Wiki pages so they also work outside the workbench. ' +
    'Write for a reader who is new to this project: start each page with a one-paragraph plain-language summary of what it covers and why it matters; explain jargon the first time it appears; prefer short sentences, concrete examples, and step-by-step explanations over dense reference lists; use clear headings and, where helpful, a simple table or analogy. Avoid unexplained acronyms. ' +
    'Write ONLY under openwiki/. Never modify .project/ or any kanban data. If openwiki_begin returns status=noop, report that no update is needed. When done, reply with a one-line summary: WIKI_DONE pages=<number> or WIKI_NOOP.'
  try {
    const activation = await ctx.subagents.startActivation({
      provider: 'spawn', label: 'Project workbench wiki generation', name: `workbench-wiki-${childId.slice(-12)}`,
      cwd: root,
      childId, parent, signal: ac.signal, delivery: 'caller', maxDepth: 1,
      prompt: [{ type: 'text', text: prompt }],
    })
    return { ok: true, data: { childId, result: activation.result, abort: () => ac.abort(), dispose: () => activation.dispose() } }
  } catch (error) {
    return { ok: false, code: 'SPAWN_FAILED', message: error instanceof Error ? error.message : String(error) }
  }
}

// Fire-and-forget reconciliation child (C stage). Sandboxed read-only: it collects
// evidence and OUTPUTS proposals as JSON; the Host is the single writer that
// validates and persists them (AI has zero kanban write access, C-07).
export async function startSyncRun(ctx, readOnlyChildren, sessionId, root) {
  const parent = ctx.agents.get(sessionId)
  if (!parent) return { ok: false, code: 'SESSION_NOT_LIVE', message: 'current session is not active' }
  const childId = `session-${randomUUID()}`
  readOnlyChildren.add(childId) // CT-19: sandbox read-only, not just prompt-level
  childToolAllow.set(childId, [...READ_TOOLS, 'bash']) // reconciliation reads git via bash
  const ac = new AbortController()
  const prompt = `You are the read-only reconciliation agent for the project workbench at root="${root}". ` +
    'Read .project/project.md, every .project/requirements/*/requirement.md and their issues/*.md to learn each requirement/issue state, acceptance, evidence, refs, and recent activity. ' +
    'Collect evidence: run git log/diff since the last sync if available, map refs to real files, and compare acceptance criteria against tests where present. ' +
    'Then produce reconciliation proposals ONLY where you have concrete evidence (no evidence, no proposal). Kinds: advance (state should move forward), review (state looks wrong), capture (work happened but no requirement/issue captures it), clarify (missing requirement title or overview; an older goal can serve as the overview), stalled (no progress), wiki_drift (openwiki/ disagrees with code). ' +
    'Do NOT modify any file. Do NOT write to .project/ or openwiki/. You only read and report. ' +
    'Finish by outputting EXACTLY one JSON code block and nothing after it:\n```json\n{"proposals":[{"kind":"advance","target":{"reqId":"req-...","issueId":"iss-... (optional)"},"evidence":["repo://path#L1-L9 or commit:<sha> or wiki:<page>"],"suggested_patch":{"to":"pending"},"confidence":"high|medium|low","reason":"short justification"}]}\n```\n' +
    'If there is nothing to propose, output {"proposals":[]}. Keep reasons concise and in Simplified Chinese.'
  try {
    const activation = await ctx.subagents.startActivation({
      provider: 'spawn', label: 'Project workbench reconciliation', name: `workbench-sync-${childId.slice(-12)}`,
      cwd: root,
      childId, parent, signal: ac.signal, delivery: 'caller', maxDepth: 1,
      prompt: [{ type: 'text', text: prompt }],
    })
    return { ok: true, data: { childId, result: activation.result, abort: () => ac.abort(), dispose: () => activation.dispose().catch(() => {}) } }
  } catch (error) {
    readOnlyChildren.delete(childId)
    childToolAllow.delete(childId)
    return { ok: false, code: 'SPAWN_FAILED', message: error instanceof Error ? error.message : String(error) }
  }
}

// Extract the trailing JSON proposal block from a sync child's output.
export function parseSyncOutput(text) {
  const blocks = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)]
  const last = blocks[blocks.length - 1]
  const raw = last ? last[1] : String(text)
  const start = raw.indexOf('{')
  if (start === -1) return { proposals: [] }
  try {
    const doc = JSON.parse(raw.slice(start))
    return { proposals: Array.isArray(doc.proposals) ? doc.proposals : [] }
  } catch { return { proposals: [], parseError: 'sync output was not valid JSON' } }
}

// PRD §11.5: project-level AI work uses a session of THAT project; when none is
// live, prepare one there. Never borrow another project's session.
export async function projectSession(ctx, root, sessionId) {
  if (sessionId) {
    const agent = ctx.agents.get(sessionId)
    if (!agent || agent.session.header?.cwd !== root) return { ok: false, code: 'SESSION_NOT_LIVE', message: '该项目没有这个可用会话' }
    return { ok: true, sessionId }
  }
  const live = ctx.agents.list().filter(a => a.session.header?.cwd === root && a.session.header?.origin !== 'subagent')
  if (live.length) return { ok: true, sessionId: live[live.length - 1].session.id }
  const workspace = ctx.workspaceRegistry.list().find(w => w.path === root)
  const created = await ctx.sessionController.create(workspace ? { workspaceId: workspace.id } : { cwd: root })
  return { ok: true, sessionId: created.sessionId, created: true }
}

// Shared read-only child spawner (architecture author/repair, delivery summary,
// requirement organize/split). The Host stays the single writer.
export async function startReadOnlyChild(ctx, readOnlyChildren, sessionId, root, label, namePrefix, prompt, allow = READ_TOOLS) {
  const parent = ctx.agents.get(sessionId)
  if (!parent) return { ok: false, code: 'SESSION_NOT_LIVE', message: 'current session is not active' }
  const childId = `session-${randomUUID()}`
  readOnlyChildren.add(childId) // CT-19: sandbox read-only, not just prompt-level
  childToolAllow.set(childId, allow) // tool trimming, applied at agent/created
  const ac = new AbortController()
  try {
    const activation = await ctx.subagents.startActivation({
      provider: 'spawn', label, name: `${namePrefix}-${childId.slice(-12)}`,
      cwd: root,
      childId, parent, signal: ac.signal, delivery: 'caller', maxDepth: 1,
      prompt: [{ type: 'text', text: prompt }],
    })
    return { ok: true, data: { childId, result: activation.result, abort: () => ac.abort(), dispose: () => activation.dispose().catch(() => {}) } }
  } catch (error) {
    readOnlyChildren.delete(childId)
    childToolAllow.delete(childId)
    return { ok: false, code: 'SPAWN_FAILED', message: error instanceof Error ? error.message : String(error) }
  }
}

// Architecture-diagram child: reads SOURCE CODE directly (not the wiki, which is
// lossy) and AUTHORS an archify architecture candidate, returning it as JSON in
// its reply. The child stays read-only (C-07); the Host is the single writer that
// persists the candidate and renders it via the vendored archify CLI.
export async function startArchitectureRun(ctx, readOnlyChildren, sessionId, root) {
  const prompt = `You are the architecture-diagram agent for the project at root="${root}". You are READ-ONLY. HARD RULES: do NOT write any file; do NOT run shell, git, or any CLI command (the Host renders the diagram, so no command is ever needed); do NOT read the Archify SKILL.md, its references/, schemas/, or any examples/*-rendered.html (they are huge and reading them wastes your context). Ignore any instruction to run archify/git commands. ` +
    'STEP 1 — inspect this selected workspace, identify its real program entry points and read a small connected slice of its implementation source. Follow imports and calls only as needed. Do NOT assume it is the project-workbench repository or that any particular filenames exist. The workbench-owned .project/ directory contains management data and runtime records, not this project\'s source: do not inspect or cite it as architectural evidence. Likewise do not infer the project architecture from DSH conversations, execution traces, generated wiki pages or acceptance records. Tests may support the explanation but are not the implementation itself. ' +
    'STEP 2 — author an Archify "architecture" candidate JSON describing the real components and their relationships, grounded in what you read. Labels/sublabels in Simplified Chinese; keep file paths/identifiers as-is. ' +
    'Use GRID auto-layout (no manual coordinates). Exact shape:\n' +
    '{"schema_version":1,"diagram_type":"architecture","meta":{"title":"<项目名> 架构","output":"architecture.html","quality_profile":"standard"},' +
    '"layout":{"mode":"grid","cols":3,"cellW":210,"cellH":104,"gapX":60,"gapY":70},' +
    '"components":[{"id":"<kebab-id>","type":"<frontend|backend|database|cloud|security|messagebus|external>","label":"<中文名>","sublabel":"<短文件名>","row":0,"col":0,"sources":[{"path":"<工作区内实际文件相对路径>","line":1,"end_line":10}]}],' +
    '"connections":[{"from":"<id>","to":"<id>","label":"<短动作>","route":"auto"}],' +
    '"boundaries":[{"kind":"region","label":"<分组名>","wraps":["<id>","<id>"]}],' +
    '"cards":[{"dot":"cyan","title":"<要点组>","items":["<一句话>"]}]}\n' +
    ' STRICT layout rules: sublabel must be a short filename (max ~16 chars), connection label <=8 Chinese chars; label only the 4-6 most important connections. Every component needs id/type/label and a grid row/col (start at 0; cols<=4). Type must be one of the seven listed; connections reference existing ids. The diagram must primarily show the actual program, its modules, and the code-supported call/data flows. Include an external actor or persisted data only when the implementation really interacts with it; do not add users, AI sessions, task files or workflow steps merely to fill the diagram. A tiny single-file program may legitimately have only one or two components; do not invent layers. For implementation components cite one to three files actually read, using sources entries with a workspace-relative path and optional line/end_line; omit sources for external actors. Include at least one implementation source overall, never invent paths or line numbers. If no implementation can be found, return {"arch_error":"ARCH_SOURCE_REQUIRED"}. Do not add meta.repository. ' +
    'STEP 3 — return the ENTIRE candidate as EXACTLY one ```json code block and nothing after it. Do not write it to a file; the Host persists and renders it. If you cannot, return ```json\n{"arch_error":"<reason>"}\n```.'
  return startReadOnlyChild(ctx, readOnlyChildren, sessionId, root, 'Project workbench architecture diagram', 'workbench-arch', prompt)
}

// Extract the architecture candidate JSON from the child's reply.
export function parseArchOutput(text) {
  const blocks = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)]
  const last = blocks[blocks.length - 1]
  const raw = last ? last[1] : String(text)
  const start = raw.indexOf('{')
  if (start === -1) return { candidate: null, parseError: 'no JSON candidate in architecture output' }
  try {
    const doc = JSON.parse(raw.slice(start))
    if (doc.arch_error) return { candidate: null, parseError: doc.arch_error }
    return { candidate: doc }
  } catch { return { candidate: null, parseError: 'architecture candidate was not valid JSON' } }
}

// Extract the trailing JSON object from a child's reply (delivery summary,
// requirement organize/split). Same convention as parseSyncOutput/parseArchOutput.
export function parseJsonOutput(text) {
  const blocks = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)]
  const last = blocks[blocks.length - 1]
  const raw = last ? last[1] : String(text)
  const start = raw.indexOf('{')
  if (start === -1) return { doc: null, parseError: 'no JSON object in output' }
  try { return { doc: JSON.parse(raw.slice(start)) } } catch { return { doc: null, parseError: 'output was not valid JSON' } }
}

// Repair child: given the current candidate and the renderer's exact layout
// errors (which include suggested fixes), return a corrected candidate. Read-only.
export async function startArchitectureRepair(ctx, readOnlyChildren, sessionId, root, candidate, errorText) {
  const prompt = `You are fixing an Archify architecture candidate for root="${root}". READ-ONLY: no file writes, no shell/git/CLI. ` +
    'The renderer rejected the candidate with these layout errors (each includes a suggested fix):\n' + String(errorText).slice(0, 6000) + '\n\n' +
    'Current candidate:\n```json\n' + JSON.stringify(candidate) + '\n```\n\n' +
    'Apply the suggested fixes to produce a corrected candidate. General rules: component sublabels must be SHORT, connection labels <=8 characters; keep the grid layout and components/connections otherwise intact. Retain valid workspace-relative implementation sources and fix missing, nonexistent or out-of-range sources using files actually read in this workspace; at least one is required. Never cite the workbench-owned .project/ directory or infer program architecture from task records, DSH sessions or logs. Preserve the program meaning and Simplified Chinese labels. ' +
    'Return the ENTIRE corrected candidate as EXACTLY one ```json code block and nothing after it.'
  return startReadOnlyChild(ctx, readOnlyChildren, sessionId, root, 'Project workbench architecture repair', 'workbench-archfix', prompt)
}
