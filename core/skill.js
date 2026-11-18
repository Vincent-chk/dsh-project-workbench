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
