import { readFile } from 'node:fs/promises'

export async function loadOpenWikiSkill() {
  const markdown = await readFile(new URL('../skills/openwiki/SKILL.md', import.meta.url), 'utf8')
  const end = markdown.indexOf('\n---\n', 4)
  if (!markdown.startsWith('---\n') || end < 0) throw new Error('OpenWiki skill frontmatter is invalid')
  return {
    name: 'openwiki',
    description: 'Initialize, update, search, and read a repository OpenWiki through its resumable page lifecycle.',
    content: markdown.slice(end + 5).replace(/^\r?\n/, ''),
    source: 'runtime',
    provider: 'project-workbench',
    invocation: { modelInvocable: true, userInvocable: false },
  }
}

export const discoverySkillName = 'pwb-grill-me'
export const discoverySkillMarker = 'project-workbench:discovery-interview:v1'

export async function loadDiscoverySkill() {
  const upstream = new URL('../skills/discovery/upstream/', import.meta.url)
  const [wrapper, interview] = await Promise.all([
    readFile(new URL('grill-me.md', upstream), 'utf8'),
    readFile(new URL('grilling.md', upstream), 'utf8'),
  ])
  const body = text => {
    const end = text.indexOf('\n---\n', 4)
    if (!text.startsWith('---\n') || end < 0) throw new Error('Grill Me skill frontmatter is invalid')
    return text.slice(end + 5).trim()
  }
  const instructions = body(interview).replace(/^Finding _facts_.*$/m,
    'Resolve available facts using read-only project context. Ask the user about decisions, priorities and information you cannot verify.')
  const skill = body(wrapper).replace('Call the Skill tool with "grilling".', instructions)
  return {
    name: discoverySkillName,
    description: 'Grill Me · Interview the user to clarify the current workbench requirement.',
    content: [
      '<!-- ' + discoverySkillMarker + ' -->', skill,
      'Workbench use: stay on the current requirement and use the user’s language. Reply directly in the conversation and keep the interview read-only.',
      'Focus each round on questions that change goals, scope or acceptance. After a substantive reply, summarize what the user confirmed and state a concrete recommendation or trade-off before moving on to more questions.',
      'The user can save a checkpoint from the workbench sidebar at any time after a complete round. Keep unanswered decisions separate from confirmed decisions.',
    ].join('\n\n'),
    source: 'runtime',
    provider: 'project-workbench',
    invocation: { modelInvocable: false, userInvocable: true },
  }
}
