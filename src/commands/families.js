/**
 * `uniweb families` — the standard section families this CLI knows.
 *
 * ⭐ NAMED AFTER THE FIELD, not after the things it lists. A developer's question
 * is "what can I put in `family:`?", and they will type the word they just read
 * in a `meta.js` or a doctor warning.
 *
 * ⚠️ IT REPORTS THE ROSTER THIS CLI SHIPS WITH, not a live fetch — the list comes
 * from the `@uniweb/schemas` version this CLI resolved. That is the right answer,
 * because it is also the list `uniweb doctor` matched against. A newer family
 * than your CLI will not appear, and declaring one is not fatal either way: an
 * unrecognized value falls back to a generic illustration.
 */

import { FAMILIES, GROUPS } from '@uniweb/schemas/families'
import { getCliVersion } from '../versions.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m'
}

export async function families(args = []) {
  if (args.includes('--json')) {
    // ⛔ stdout carries JSON and nothing else, so it pipes. Every human-facing
    // line in this command goes to stdout only in the non-JSON branch.
    process.stdout.write(
      JSON.stringify(
        { cliVersion: getCliVersion(), count: FAMILIES.length, groups: GROUPS, families: FAMILIES },
        null,
        2
      ) + '\n'
    )
    return
  }

  const filter = args.find((a) => !a.startsWith('-'))
  const shown = filter
    ? FAMILIES.filter(
        (f) =>
          f.id.includes(filter.toLowerCase()) ||
          f.label.toLowerCase().includes(filter.toLowerCase()) ||
          f.group === filter.toLowerCase()
      )
    : FAMILIES

  console.log('')
  console.log(
    `${colors.bright}Section families${colors.reset} ${colors.dim}(uniweb ${getCliVersion()})${colors.reset}`
  )

  if (shown.length === 0) {
    console.log('')
    console.log(`  ${colors.dim}Nothing matches "${filter}".${colors.reset}`)
    console.log(
      `  ${colors.dim}A name of your own is fine — it falls back to a generic illustration.${colors.reset}`
    )
    console.log('')
    return
  }

  const width = Math.max(...shown.map((f) => f.id.length))
  for (const group of GROUPS) {
    const rows = shown.filter((f) => f.group === group.id)
    if (rows.length === 0) continue
    console.log('')
    console.log(`  ${colors.bright}${group.label}${colors.reset} ${colors.dim}— ${group.move}${colors.reset}`)
    for (const f of rows) {
      console.log(`    ${colors.cyan}${f.id.padEnd(width)}${colors.reset}  ${colors.dim}${f.label}${colors.reset}`)
    }
  }

  console.log('')
  console.log(`  ${colors.dim}Declare one in a section's meta.js:  family: 'hero'${colors.reset}`)
  console.log(
    `  ${colors.dim}A component already named for its family needs no declaration.${colors.reset}`
  )
  console.log(`  ${colors.dim}--json for scripts. uniweb doctor reports what your sections resolved to.${colors.reset}`)
  console.log('')
}
