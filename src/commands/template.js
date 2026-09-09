/**
 * template — `list` is live; `register` is RESERVED (not on the new backend yet).
 *
 * `uniweb template publish` submitted a site as a cloud template to the legacy
 * registry (the PHP backend + Cloudflare Worker) the CLI no longer talks to. A
 * new-backend equivalent isn't built; when it is, a template is REGISTERED (like
 * a foundation or a schemas package) — the verb will be `register`, not `publish`
 * (`publish` is for SITES only). The command name is kept reserved.
 *
 * (Unrelated: scaffolding FROM a template — `uniweb create --template <name>` —
 * is a separate path and is unaffected.)
 *
 * ⭐ `list` exists so a SCRIPT can enumerate the official templates. The
 * interactive picker in `create` has always shown this list; `--json` is the
 * same data, second rendering, for tooling that scaffolds several templates in
 * a row and needs their names first.
 *
 * ⚠️ IT REPORTS A BUNDLED SNAPSHOT, NOT A LIVE FETCH — the roster is baked into
 * the CLI at publish time (`src/framework-index.json`, rewritten from
 * `templates/manifest.json` by the pre-publish hook). So it answers "which
 * official templates does THIS CLI know", which is the right question when the
 * next step is resolving one of those names with the same CLI. `cliVersion` is
 * in the JSON for exactly that reason. A newer template than your CLI will not
 * appear — and an unknown name is not fatal either way, since `create` falls
 * through to npm `@uniweb/template-<name>`, so this is the OFFICIAL roster
 * rather than the set of resolvable names.
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

function reserved() {
  console.error(
    "\x1b[31m✗\x1b[0m `uniweb template register` isn't available on the new backend yet."
  )
  console.error(
    '  Submitting a site as a cloud template was retired with the PHP backend.'
  )
  console.error(
    '  A template is REGISTERED, like a foundation — `publish` is for sites only.'
  )
  console.error(
    '  (Scaffolding FROM a template still works: `uniweb create --template <name>`.)'
  )
  console.error('')
  console.error('  To list the official templates: `uniweb template list`.')
  process.exit(1)
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
    return
  }

  if (entries.length === 0) {
    // Not a crash: a CLI whose snapshot failed to load falls back to an empty
    // map, and `create` then routes every name to npm. Say which happened.
    console.error(
      `${colors.red}✗${colors.reset} No official templates found in this CLI's bundled index.`
    )
    console.error(
      `  ${colors.dim}A template name will still resolve through npm as @uniweb/template-<name>.${colors.reset}`
    )
    process.exit(1)
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
}

export async function template(args = []) {
  const sub = args.find((a) => !a.startsWith('-'))
  if (sub === 'list') return listTemplates(args)
  return reserved()
}

export default template
