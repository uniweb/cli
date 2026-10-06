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
 *   uniweb status --remote   Also: whether the backend still holds the site, draft-vs-live,
 *                            and a newer-registered-foundation check
 *   uniweb status --json     One JSON line (adds a `remote` object under --remote, whose
 *                            `site_state` is live / gone / unknown — `gone` only on the
 *                            backend's own word that it holds no such site)
 *
 * Run from a site, or a workspace with one site.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { resolveSiteDir } from './deploy.js'
import { probeUnpushed } from '../backend/site-sync.js'
import { resolveWorkspace } from '../backend/workspace.js'
import {
  BackendClient,
  resolveBackendOrigin,
  WorkspaceMismatchError
} from '../backend/client.js'
import { readBackendState } from '@uniweb/build/uwx'
import {
  resolveLocalFoundation,
  foundationScopedName
} from '../backend/foundation-bring-along.js'
import { computeFoundationDigest } from '../utils/code-upload.js'
import { compareSemverPrecedence } from '../utils/semver-precedence.js'
import { checkFlags } from '../utils/flag-guard.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m'
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`)
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
  return at > 0
    ? { scope: fnd.slice(0, at), version: fnd.slice(at + 1) }
    : { scope: null, version: null }
}

export async function status(args = []) {
  // See utils/flag-guard.js — an unrecognized flag is invisible to a literal scan.
  // Straight to stderr: this is a usage error, so it must not be mistaken for the
  // status document even under --json.
  const badFlag = checkFlags('status', args)
  if (badFlag) {
    console.error(`\x1b[31m✗\x1b[0m ${badFlag.message}`)
    return { exitCode: 2 }
  }
  const jsonMode = args.includes('--json')
  const remote = args.includes('--remote')
  const siteDir = await resolveSiteDir(args, 'status')
  const siteYml = readSiteYml(siteDir)
  const fnd = foundationRef(siteYml)
  const { scope: fndScope, version: fndVersion } = splitFoundationRef(fnd)

  // Local content diff — builds the sync packages, never authenticates.
  //
  // ⭐ The ORIGIN is resolved here rather than taken from the client below, because
  // this probe is deliberately offline and the client may never be built. It decides
  // whose asset ids the comparison reads: against the wrong backend every media ref
  // reads as changed.
  const probeBackend = resolveBackendOrigin()
  // ⭐ Identity is this backend's, from sync.json. It read `site.yml::$uuid`, so after
  // step 4 moved the key every project reported itself as never synced.
  const uuid = readBackendState(siteDir, probeBackend).site?.uuid || null
  let probe = null
  let probeErr = null
  try {
    probe = await probeUnpushed(siteDir, { backend: probeBackend })
  } catch (err) {
    probeErr = err.message
  }

  // Remote signals — opt-in (`--remote`). May prompt for login. Degrades to null
  // on 404 / any failure, so a backend without the endpoints just shows local.
  let site = null
  // Whether the backend holds the site this binding names — live / gone / unknown, never
  // folded (`client.siteState`). Null when there is no binding to ask about.
  let siteState = null
  let fdnLatest = null
  let foundationFresh = null // true/false when both digests are known; else null
  let localFoundationVersion = null
  let remoteError = null // a refusal about the workspace — the one remote failure worth saying
  if (remote) {
    try {
      const client = new BackendClient({
        args,
        command: 'Status'
      })
      // The workspace this status works in — the login's, unless this command names
      // another (`workspace.js`). None chosen is reported, like a site outside it.
      const ws = await resolveWorkspace({ client, args })
      if (ws.refused) throw Object.assign(new Error(ws.reason), { status: 409 })
      client.setWorkspace(ws.workspace, { source: ws.source })
      if (uuid) {
        siteState = await client.siteState(uuid)
        if (siteState.state === 'live') {
          site = siteState.site || null
          // In another workspace: it exists, and the refusal says where — report it.
          if (siteState.status === 409) remoteError = siteState.detail
        }
      }
      // Foundation freshness: prefer the LOCAL foundation's scoped name (so a
      // local-foundation site can be checked too); fall back to a scoped
      // site.yml ref. The digest compare is read-only — it never builds, so it
      // only fires when the local foundation is already built (dist present).
      const local = resolveLocalFoundation(siteDir, siteYml)
      localFoundationVersion = local?.version ?? null
      const lookupName =
        (local && (await foundationScopedName(local.dir))) || fndScope
      if (lookupName) fdnLatest = await client.readFoundationLatest(lookupName)
      if (local?.dir && fdnLatest?.digest) {
        const localDigest = computeFoundationDigest(join(local.dir, 'dist'))
        if (localDigest) foundationFresh = localDigest === fdnLatest.digest
      }
    } catch (err) {
      // Degrade silently — except a refusal about the workspace: `--org` named one the
      // backend does not work on this site from, or the deployment has another. Saying
      // nothing would read as "fine".
      if (err instanceof WorkspaceMismatchError || err?.status === 409) remoteError = err.message
      // Not asked, or not answered: that is not knowing, never `gone`.
      if (uuid && !siteState) siteState = { state: 'unknown', status: null, detail: err?.message || null }
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
        ...(remote
          ? {
              remote: {
                // ⭐ live · gone · unknown — `gone` only on the backend's own word about
                // this site; null when this directory names no site on this backend.
                site_state: siteState ? siteState.state : null,
                site_state_detail: siteState?.detail ?? null,
                site,
                foundation_latest: fdnLatest?.latest_version ?? null,
                foundation_fresh: foundationFresh,
                ...(remoteError ? { error: remoteError } : {})
              }
            }
          : {})
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
    say.dim(
      'Run `uniweb push` to create it, or `uniweb publish` to sync and go live in one step.'
    )
  }

  // Content
  if (probeErr) {
    say.warn(`Couldn't compute content changes: ${probeErr}`)
    say.dim(
      'A build error or an unresolved data Model can block the offline diff.'
    )
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
    say.dim(
      'Run `uniweb publish` to sync and go live (or `uniweb push` to sync only).'
    )
  }

  // Foundation
  if (fnd) say.dim(`Foundation: ${fnd}`)

  // Remote signals
  if (remote) {
    if (remoteError) say.warn(remoteError)
    if (siteState?.state === 'gone') {
      say.warn(`The backend has no site ${uuid} — it was deleted there, or the backend was rebuilt.`)
      say.dim(
        `To push this as a new site: uniweb forget --backend ${probeBackend}, then uniweb push.`
      )
    } else if (siteState?.state === 'unknown') {
      say.dim(
        `Could not tell whether the backend holds this site${siteState.detail ? ` (${siteState.detail})` : ''}.`
      )
    }
    if (site) {
      if (site.draft_dirty) {
        say.info(
          'Synced draft has changes not yet live — run `uniweb publish` to go live.'
        )
      } else if (site.published) {
        say.ok('Live with the latest synced content.')
      } else {
        say.info(
          'Synced but not published yet — run `uniweb publish` to go live.'
        )
      }
    }
    if (
      fdnLatest?.latest_version &&
      fndVersion &&
      fdnLatest.latest_version !== fndVersion
    ) {
      say.info(
        `A newer foundation version (${fdnLatest.latest_version}) is registered than the site pins (${fndVersion}).`
      )
    }
    // What the next push or publish does with it (`backend/foundation-bring-along.js`):
    // release changed code — under the next version when its own is taken — unless the
    // registry holds a NEWER version, which stops them. ⛔ This pointed at `uniweb
    // register` until 2026-09-24 — which cannot release a change under a version
    // already registered, since a registered version is immutable.
    if (foundationFresh === false) {
      if (compareSemverPrecedence(localFoundationVersion, fdnLatest.latest_version) === -1) {
        say.info(
          `The registry holds foundation ${fdnLatest.latest_version}, newer than your ${localFoundationVersion} — a push or publish stops until you pull that change, or pass \`--bump\` to release yours above it.`
        )
      } else {
        say.info(
          'Local foundation differs from the registered version — the next `uniweb push` or `uniweb publish` releases it.'
        )
      }
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
