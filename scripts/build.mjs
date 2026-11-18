// Build the browser plugin artifact: client-src/index.js -> client.js.
// The host supplies React through the factory's require(); nothing else is bundled.
// `node scripts/build.mjs --check` compares without writing (used by npm run check).
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const src = join(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

const result = await build({
  absWorkingDir: src,
  entryPoints: ['client-src/index.js'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: '__projectWorkbenchModule',
  external: ['react'], // resolved at runtime by factory(require)
  legalComments: 'none',
  logLevel: 'silent',
})

// Deterministic output: no timestamps or environment-dependent content.
const artifact = `window.__ModuleLoader__.load({
  id: 'dsh-project-workbench',
  factory(require) {
${result.outputFiles[0].text}
    return __projectWorkbenchModule.default
  },
})
`

const target = join(src, 'client.js')
if (check) {
  const current = await readFile(target, 'utf8')
  if (current !== artifact) {
    console.error('client.js does not match client-src/. Run: npm run build')
    process.exit(1)
  }
  console.log('client.js is up to date with client-src/')
} else {
  await writeFile(target, artifact)
  console.log(`built client.js (${Buffer.byteLength(artifact)} bytes)`)
}
