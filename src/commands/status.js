/**
 * uniweb status — show how a site's local files compare to the Uniweb backend:
 * its sync identity, unpushed content changes, and the foundation it references.
 *
 * Fully local + offline: it builds the sync packages with an OFFLINE Model
 * resolver and diffs them against the send-only-changed cache (the same diff
 * `uniweb push` runs) — no auth, no backend round-trip. The richer
 * "registered foundation version" and "backend draft vs live" signals need
 * backend reads and land later (see kb shipping-verbs-and-freshness.md §5).
 *
 * Usage:
 *   uniweb status            Sync identity + unpushed content + foundation ref
 *   uniweb status --json     One JSON line { synced, uuid, foundation, changed, unchanged }
 *
 * Run from a site, or a workspace with one site.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { resolveSiteDir } from './deploy.js'
import { probeUnpushed } from '../backend/site-sync.js'

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

function readSiteYml(siteDir) {
  const p = join(siteDir, 'site.yml')
  if (!existsSync(p)) return {}
  try {
    return yaml.load(readFileSync(p, 'utf8')) || {}
  } catch {
    return {}
  }
}

function foundationRef(siteYml) {
  const f = siteYml.foundation
  if (!f) return null
  return typeof f === 'string' ? f : f.ref || null
}

export async function status(args = []) {
  const jsonMode = args.includes('--json')
  const siteDir = await resolveSiteDir(args, 'status')
  const siteYml = readSiteYml(siteDir)
  const uuid = siteYml.$uuid || null
  const fnd = foundationRef(siteYml)

  // Offline content diff — builds the sync packages, never authenticates.
  // Tolerate a build failure (e.g. an unresolved Model) rather than crash.
  let probe = null
  let probeErr = null
  try {
    probe = await probeUnpushed(siteDir)
  } catch (err) {
    probeErr = err.message
  }

  if (jsonMode) {
    console.log(
      JSON.stringify({
        synced: Boolean(uuid),
        uuid,
        foundation: fnd,
        changed: probe ? probe.changed : null,
        unchanged: probe ? probe.unchanged : null,
        ...(probeErr ? { error: probeErr } : {}),
      })
    )
    return { exitCode: 0 }
  }

  console.log('')

  // Sync identity
  if (uuid) {
    say.ok(`Synced — site-content ${c.bold}${uuid}${c.reset}`)
  } else {
    say.warn('Not synced — this site has never been pushed to a backend.')
    say.dim('Run `uniweb push` to create it, or `uniweb deploy` to ship it in one step.')
  }

  // Content
  if (probeErr) {
    say.warn(`Couldn't compute content changes: ${probeErr}`)
    say.dim('A build error or an unresolved data Model can block the offline diff.')
  } else if (!uuid) {
    const n = probe.changed
    say.info(`${n} content ${n === 1 ? 'entity' : 'entities'} ready to push.`)
  } else if (probe.changed === 0) {
    say.ok('Content is in sync with the last push.')
  } else {
    const n = probe.changed
    say.info(
      `${c.bold}${n}${c.reset} content ${n === 1 ? 'entity' : 'entities'} not pushed` +
        (probe.unchanged ? ` (${probe.unchanged} unchanged)` : '') +
        '.'
    )
    say.dim('Run `uniweb push` to sync, then `uniweb publish` to go live (or `uniweb deploy` for both).')
  }

  // Foundation
  if (fnd) say.dim(`Foundation: ${fnd}`)

  console.log('')
  return { exitCode: 0 }
}

export default status
