#!/usr/bin/env node
// Standalone validator (R-14 / T1.9). Runs without the UI: `node bin/check.js [root]`.
import { resolve } from 'node:path'
import { validateProject } from '../core/store.js'

const root = resolve(process.argv[2] ?? process.cwd())
const { ok, data } = await validateProject(root)
if (ok) {
  console.log(`OK: ${root} (.project is valid)`)
  process.exit(0)
}
console.error(`Found ${data.length} problem(s) in ${root}:`)
for (const d of data) console.error(`  [${d.code}] ${d.path}\n    ${d.message}\n    fix: ${d.fix}`)
process.exit(1)
