/**
 * template — lists the official templates.
 *
 * ⭐ `list` exists so a SCRIPT can enumerate the official templates. The
 * interactive picker in `create` shows the same list; `--json` is the same
 * data, second rendering, for tooling that scaffolds several templates in a
 * row and needs their names first. A bare `uniweb template` lists too.
 *
 * ⚠️ IT REPORTS THIS CLI'S SNAPSHOT, NOT A LIVE FETCH — the roster is baked into
 * the CLI at publish time (`src/framework-index.json`), and `create` downloads
 * these templates from the release that same snapshot names. So it answers
 * "which official templates does THIS CLI scaffold", which is the right
 * question when the next step is resolving one of those names with the same
 * CLI. `cliVersion` is in the JSON for exactly that reason. A newer template
 * than your CLI will not appear — and an unknown name is not fatal either way,
 * since `create` falls through to npm `@uniweb/template-<name>`, so this is the
 * OFFICIAL roster rather than the set of resolvable names.
 *
 * ⛔ There is no `template register` [Diego, 2026-10-08]: a site is offered as a
 * template by the backend it is pushed to when its `site.yml` says
 * `template: true`, so there is nothing for a verb to do. It was a reserved
 * refusal until then, and never worked on the current backend.
 */

import { OFFICIAL_TEMPLATE_MAP } from '../templates/resolver.js'
import { getCliVersion } from '../versions.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
}

function listTemplates(args) {
  const entries = Object.entries(OFFICIAL_TEMPLATE_MAP).map(([id, info]) => ({
    id,
    name: info?.name || id,
    description: info?.description || '',
    tags: info?.tags || []
  }))

  if (args.includes('--json')) {
    // ⛔ stdout carries JSON and nothing else, so it pipes. Every human-facing
    // line in this command goes to stderr for the same reason.
    process.stdout.write(
      JSON.stringify(
        { cliVersion: getCliVersion(), count: entries.length, templates: entries },
        null,
        2
      ) + '\n'
    )
    return { exitCode: 0 }
  }

  if (entries.length === 0) {
    // Not a crash: a CLI whose snapshot failed to load has an empty map, and
    // `create` then routes every name to npm. Say which happened.
    console.error(
      `${colors.red}✗${colors.reset} No official templates found in this CLI's bundled index.`
    )
    console.error(
      `  ${colors.dim}A template name will still resolve through npm as @uniweb/template-<name>.${colors.reset}`
    )
    return { exitCode: 1 }
  }

  const width = Math.max(...entries.map((e) => e.id.length))
  console.log('')
  console.log(
    `${colors.bright}Official templates${colors.reset} ${colors.dim}(uniweb ${getCliVersion()})${colors.reset}`
  )
  console.log('')
  for (const e of entries) {
    console.log(
      `  ${colors.cyan}${e.id.padEnd(width)}${colors.reset}  ${e.description || e.name}`
    )
  }
  console.log('')
  console.log(
    `  ${colors.dim}uniweb create <project> --template <name>${colors.reset}`
  )
  console.log(
    `  ${colors.dim}--json for scripts. This is the roster THIS CLI ships with, not a live fetch.${colors.reset}`
  )
  console.log('')
  return { exitCode: 0 }
}

/**
 * @param {string[]} args - what follows `uniweb template`
 * @returns {{ exitCode: number }}
 */
export async function template(args = []) {
  const sub = args.find((a) => !a.startsWith('-'))
  if (sub === undefined || sub === 'list') return listTemplates(args)
  console.error(
    `${colors.red}✗${colors.reset} Unknown subcommand: uniweb template ${sub}`
  )
  console.error(
    `  ${colors.dim}uniweb template list   lists the official templates${colors.reset}`
  )
  return { exitCode: 2 }
}

export default template
