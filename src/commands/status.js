/**
 * uniweb status — show how a site's local files compare to the Uniweb backend:
 * its sync identity, unpushed content changes, and the foundation it references.
 *
 * LOCAL + OFFLINE by default: it builds the sync packages with an OFFLINE Model
 * resolver and diffs them against the send-only-changed cache (the same diff
 * `uniweb push` runs) — no auth, no backend round-trip.
 *
 * `--remote` adds the backend signals (may prompt for login, like `git fetch`):
 *   - whether the synced draft differs from what's live (publish needed), and
 *   - whether a newer foundation version is registered than the site pins.
 * Those use ASSUMED endpoints (see kb shipping-verbs-and-freshness.md §6.5); until
 * the backend exposes them, `--remote` degrades silently to the local view.
 *
 * Usage:
 *   uniweb status            Sync identity + unpushed content + foundation ref (local)
 *   uniweb status --remote   Also: draft-vs-live + a newer-registered-foundation check
 *   uniweb status --json     One JSON line (adds a `remote` object under --remote)
 *
 * Run from a site, or a workspace with one site.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { resolveSiteDir, resolveSiteBackend } from './deploy.js'
import { probeUnpushed } from '../backend/site-sync.js'
import { BackendClient } from '../backend/client.js'
import { readFlagValue } from '../utils/args.js'
import { resolveLocalFoundation } from '../backend/foundation-bring-along.js'
import { computeFoundationDigest } from '../utils/code-upload.js'

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

// A versioned registry ref `@org/name@1.2.3` → its scoped name `@org/name` and
// pinned version `1.2.3`. A bare/local/unversioned ref → nulls.
function splitFoundationRef(fnd) {
  if (!fnd || fnd[0] !== '@') return { scope: null, version: null }
  const at = fnd.lastIndexOf('@')
  return at > 0 ? { scope: fnd.slice(0, at), version: fnd.slice(at + 1) } : { scope: null, version: null }
}

export async function status(args = []) {
  const jsonMode = args.includes('--json')
  const remote = args.includes('--remote')
  const siteDir = await resolveSiteDir(args, 'status')
  const siteYml = readSiteYml(siteDir)
  const uuid = siteYml.$uuid || null
  const fnd = foundationRef(siteYml)
  const { scope: fndScope, version: fndVersion } = splitFoundationRef(fnd)

  // Local content diff — builds the sync packages, never authenticates.
  let probe = null
  let probeErr = null
  try {
    probe = await probeUnpushed(siteDir)
  } catch (err) {
    probeErr = err.message
  }

  // Remote signals — opt-in (`--remote`). May prompt for login. Degrades to null
  // on 404 / any failure, so a backend without the endpoints just shows local.
  let site = null
  let fdnLatest = null
  let foundationFresh = null // true/false when both digests are known; else null
  if (remote) {
    try {
      const client = new BackendClient({
        originFlag: readFlagValue(args, '--backend') || readFlagValue(args, '--registry'),
        siteBackend: await resolveSiteBackend(siteDir),
        token: readFlagValue(args, '--token') || undefined,
        args,
        command: 'Status',
      })
      if (uuid) site = await client.siteStatus(uuid)
      // Foundation freshness: prefer the LOCAL foundation's scoped name (so a
      // local-foundation site can be checked too); fall back to a scoped
      // site.yml ref. The digest compare is read-only — it never builds, so it
      // only fires when the local foundation is already built (dist present).
      const local = resolveLocalFoundation(siteDir, siteYml)
      const lookupName = local?.scopedName || fndScope
      if (lookupName) fdnLatest = await client.readFoundationLatest(lookupName)
      if (local?.dir && fdnLatest?.digest) {
        const localDigest = computeFoundationDigest(join(local.dir, 'dist'))
        if (localDigest) foundationFresh = localDigest === fdnLatest.digest
      }
    } catch {
      // degrade silently
    }
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
        ...(remote ? { remote: { site, foundation_latest: fdnLatest?.latest_version ?? null, foundation_fresh: foundationFresh } } : {}),
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
    say.dim('Run `uniweb push` to create it, or `uniweb publish` to sync and go live in one step.')
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
    say.dim('Run `uniweb publish` to sync and go live (or `uniweb push` to sync only).')
  }

  // Foundation
  if (fnd) say.dim(`Foundation: ${fnd}`)

  // Remote signals
  if (remote) {
    if (site) {
      if (site.draft_dirty) {
        say.info('Synced draft has changes not yet live — run `uniweb publish` to go live.')
      } else if (site.published) {
        say.ok('Live with the latest synced content.')
      } else {
        say.info('Synced but not published yet — run `uniweb publish` to go live.')
      }
    }
    if (fdnLatest?.latest_version && fndVersion && fdnLatest.latest_version !== fndVersion) {
      say.info(`A newer foundation version (${fdnLatest.latest_version}) is registered than the site pins (${fndVersion}).`)
    }
    if (foundationFresh === false) {
      say.info('Local foundation differs from the registered version — `uniweb register` (or `uniweb publish`) to release the change.')
    } else if (foundationFresh === true) {
      say.ok('Local foundation matches the registered version.')
    }
    if (!site && !fdnLatest) {
      say.dim('(No remote signals — the backend may not expose them yet.)')
    }
  }

  console.log('')
  return { exitCode: 0 }
}

export default status
