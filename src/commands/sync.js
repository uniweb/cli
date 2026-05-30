/**
 * uniweb sync — push a site to the backend as entities, with a stable-identity
 * round trip. One sync pushes BOTH facets:
 *   - static content → `@uniweb/site-content` (the nested `$`-document: pages,
 *     sections, layout, theme, foundation ref, extensions, collection decls);
 *   - dynamic content → one entity per `model:`-mapped collection record.
 *
 * Each entity is an entity-content document (`$id` + `$model` + sections). First
 * sync carries no `$uuid`; the backend mints them and echoes them back. `sync`
 * then back-fills each entity's uuid into its home file: collection-record uuids
 * into their source files; the `@uniweb/folder` uuid into `collections.yml`; the
 * site-content uuid into `site.yml`. Per-page/section identity is our own local
 * ledger (`.uniweb/site-ids.json`), never on the wire. Push-only, last-push-wins
 * (`collision=force`) in v1.
 *
 * `uniweb login && uniweb sync`. Run from a site, or a workspace with one site.
 *
 * Usage:
 *   uniweb sync                          Build the .uwx, submit, back-fill $uuid
 *   uniweb sync --as-unit @org           Act as @org (membership-gated)
 *   uniweb sync --dry-run                Report what would be sent; submit nothing
 *   uniweb sync -o collections.uwx       Write the .uwx to a file; submit nothing
 *   uniweb sync --registry <url>         Override the backend origin
 *   uniweb sync --token <bearer>         Submit with this bearer; skips `uniweb login`
 *   uniweb sync --foundation <dir>       Use this local foundation for the Model schema
 *   uniweb sync --all                    Send every record (bypass the changed-only cache)
 *
 * Endpoint: a site sync (bundle includes site-content) POSTs to
 *   <origin>/api/sites/sync; a loose-entity sync (no site-content) stays on
 *   <origin>/api/core/exchange/restore?binding=sync. origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default.
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import {
  emitSyncPackage,
  backfillEntityUuids,
  writeSiteEntityUuid,
  recordSiteIdLedger,
  writeFolderUuid,
  SITE_ID_LEDGER_RELPATH,
} from '@uniweb/build/uwx'
import { ensureRegistryAuth } from '../utils/registry-auth.js'
import { resolveSiteDir } from './deploy.js'

// Same backend host as `uniweb register`; only the path differs (the restore
// lane). Overridable via --registry / UNIWEB_REGISTER_URL (a URL; origin taken).
const DEFAULT_BACKEND_ORIGIN = 'http://localhost:8080'

const colors = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[36m',
}
const log = console.log
const success = (m) => log(`${colors.green}✓${colors.reset} ${m}`)
const error = (m) => console.error(`${colors.red}✗${colors.reset} ${m}`)
const info = (m) => log(`${colors.blue}→${colors.reset} ${m}`)
const note = (m) => log(`  ${colors.dim}${m}${colors.reset}`)

function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1]
  return null
}

// Pull the finalized entities out of the restore response. The backend returns
// `{ report: { finalized: [ { index, uuid, changed, document }, … ] } }` — each
// entry carries its position in the SUBMITTED sequence (`index`, the correlation
// key — `$id` is not echoed), the minted entity `uuid`, a `changed` flag, and the
// full `document` (verbatim stored content with every `$uuid` filled in). A couple
// of shapes are tolerated; only entries with a valid `index` + `uuid` are usable.
function extractFinalized(payload) {
  const list = Array.isArray(payload?.report?.finalized)
    ? payload.report.finalized
    : Array.isArray(payload?.finalized)
      ? payload.finalized
      : Array.isArray(payload)
        ? payload
        : null
  if (!list) return null
  return list
    .map((d) => ({
      index: d?.index,
      uuid: d?.uuid ?? d?.document?.$uuid ?? null,
      changed: d?.changed,
      document: d?.document ?? null,
    }))
    .filter((e) => Number.isInteger(e.index) && e.uuid)
}

// One-line summary from the authoritative per-entity `changed` flag (`false` = a
// true no-op). Falls back silently when the backend omits it.
function changedSummary(finalized) {
  const changed = finalized.filter((f) => f.changed === true).length
  const unchanged = finalized.filter((f) => f.changed === false).length
  const parts = []
  if (changed) parts.push(`${changed} changed`)
  if (unchanged) parts.push(`${unchanged} unchanged`)
  return parts.length ? parts.join(', ') : null
}

// Build the Model-read path for a registry name. `@scope/name` →
// /api/models/{scope}/{name}; a bare name → /api/models/{name}. The `@` sigil is
// not part of the path segment. (Path segment encoding to confirm at live e2e.)
function modelPathFor(modelName) {
  const m = /^@([^/]+)\/(.+)$/.exec(modelName)
  if (m) return `/api/models/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`
  return `/api/models/${encodeURIComponent(modelName)}`
}

// Resolve a Model NOT defined by the local foundation by fetching its declaration
// (the `@uniweb/data-schema` form) from the backend's Model-read route. Cached per
// run; HTTP 404 → null (the emitter then says "register it first"). The bearer is
// acquired lazily via getToken, so a fully-local sync never authenticates.
function makeModelResolver({ apiBase, getToken }) {
  const cache = new Map()
  return async (modelName) => {
    if (cache.has(modelName)) return cache.get(modelName)
    const url = `${apiBase}${modelPathFor(modelName)}`
    const token = await getToken()
    let res
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    } catch (err) {
      throw new Error(`could not reach the Model-read endpoint ${url}: ${err.message}`)
    }
    if (res.status === 404) {
      cache.set(modelName, null)
      return null
    }
    if (!res.ok) {
      throw new Error(`Model-read ${url} failed: HTTP ${res.status} ${res.statusText}`)
    }
    let decl
    try {
      decl = await res.json()
    } catch (err) {
      throw new Error(`Model-read ${url} returned non-JSON: ${err.message}`)
    }
    cache.set(modelName, decl)
    return decl
  }
}

// "Send only changed" cache: content hashes from the last successful sync, keyed
// `<model> <id>`. Gitignored, per-clone, deletable (a deleted cache just means one
// full re-sync, which the backend then no-ops). NOT identity — the minted `$uuid`
// lives in the source files; this is a pure wire-efficiency cache.
function syncCachePath(siteDir) {
  return join(siteDir, '.uniweb', 'sync-cache.json')
}
function readSyncCache(siteDir) {
  try {
    const obj = JSON.parse(readFileSync(syncCachePath(siteDir), 'utf8'))
    return obj && typeof obj.hashes === 'object' && obj.hashes ? obj.hashes : {}
  } catch {
    return {} // missing / unreadable → treat everything as changed
  }
}
function writeSyncCache(siteDir, hashes) {
  const p = syncCachePath(siteDir)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ version: 1, hashes }, null, 2) + '\n')
}

export async function sync(args = []) {
  const dryRun = args.includes('--dry-run')
  const output = flagValue(args, '-o') || flagValue(args, '--output')
  const tokenFlag = flagValue(args, '--token')
  const asUnit = flagValue(args, '--as-unit')
  const foundationDir = flagValue(args, '--foundation')
  const sendAll = args.includes('--all') // bypass the send-only-changed cache
  const registryFlag =
    flagValue(args, '--registry') || process.env.UNIWEB_REGISTER_URL || DEFAULT_BACKEND_ORIGIN

  let apiBase
  try {
    apiBase = new URL(registryFlag).origin
  } catch {
    error(`Invalid --registry / UNIWEB_REGISTER_URL: ${registryFlag}`)
    return { exitCode: 2 }
  }

  const siteDir = await resolveSiteDir(args, 'sync')

  // Lazy bearer — acquired once, on first need (a non-local Model fetch during the
  // build, or the submit). A fully-local sync never triggers it, so --dry-run / -o
  // stay offline when every Model is defined by the local foundation.
  let cachedToken = null
  const getToken = async () => {
    if (cachedToken) return cachedToken
    cachedToken =
      tokenFlag || process.env.UNIWEB_TOKEN || (await ensureRegistryAuth({ apiBase, command: 'Syncing', args }))
    return cachedToken
  }

  // Build the package (the producer side). Carries `index` — the per-entity
  // source-file map used to render/back-fill minted uuids, correlated by the
  // submission `index`. Non-local Models are fetched from the registry on demand.
  // `priorHashes` (the .uniweb sync-cache) drives "send only changed"; --all bypasses.
  const priorHashes = readSyncCache(siteDir)
  let pkg
  try {
    pkg = await emitSyncPackage(siteDir, {
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel: makeModelResolver({ apiBase, getToken }),
      priorHashes,
      sendAll,
    })
  } catch (err) {
    error(`Could not build the sync package: ${err.message}`)
    return { exitCode: 2 }
  }
  const { buffer, models, entityCount, siteIncluded, warnings, index, hashes, skipped } = pkg
  log('')
  for (const w of warnings) note(`! ${w}`)

  // Route by facet: a site sync (bundle carries site-content) is a first-class site
  // operation; a loose-entity sync stays on the generic restore lane.
  const submitUrl = siteIncluded
    ? `${apiBase}/api/sites/sync`
    : `${apiBase}/api/core/exchange/restore`

  // Nothing changed since the last sync — the backend is already in sync.
  if (entityCount === 0) {
    success(`Nothing to sync — ${skipped} entit${skipped === 1 ? 'y' : 'ies'} unchanged since the last sync.`)
    return { exitCode: 0 }
  }
  info(
    `${colors.bright}${entityCount}${colors.reset} changed entit${entityCount === 1 ? 'y' : 'ies'} → ${models.join(', ')}` +
      (skipped ? `  ${colors.dim}(${skipped} unchanged, skipped)${colors.reset}` : '')
  )

  // Preview paths — no submit, no auth.
  if (output) {
    writeFileSync(resolve(output), buffer)
    success(`Wrote ${output} (${entityCount} entities, ${buffer.length} bytes) — not submitted`)
    return { exitCode: 0 }
  }
  if (dryRun) {
    info(`Dry run — would submit to ${colors.dim}${submitUrl}${colors.reset}`)
    return { exitCode: 0 }
  }

  // Submit: binary .uwx body, sync-lane query params, bearer auth. The site route
  // takes `collision`; the loose-entity restore lane also takes `binding=sync`.
  const token = await getToken()
  const params = new URLSearchParams({ collision: 'force' })
  if (!siteIncluded) params.set('binding', 'sync')
  if (asUnit) params.set('as_unit', asUnit)
  const url = `${submitUrl}?${params.toString()}`

  info(`Submitting to ${colors.dim}${url}${colors.reset} …`)
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip', Authorization: `Bearer ${token}` },
      body: buffer,
    })
  } catch (err) {
    error(`Could not reach the backend at ${url}: ${err.message}`)
    note('Set the origin with --registry <url> or UNIWEB_REGISTER_URL.')
    return { exitCode: 2 }
  }
  if (!res.ok) {
    error(`Sync rejected: HTTP ${res.status} ${res.statusText}`)
    if (res.status === 401 || res.status === 403) {
      note("Credentials weren't accepted — supply a bearer with --token <bearer> (or UNIWEB_TOKEN).")
    }
    const body = await res.text().catch(() => '')
    if (body) note(body.slice(0, 800))
    return { exitCode: 1 }
  }

  // Parse the finalized response and back-fill the minted $uuids.
  let payload
  try {
    payload = await res.json()
  } catch (err) {
    error(`Could not parse the sync response as JSON: ${err.message}`)
    return { exitCode: 1 }
  }
  const finalized = extractFinalized(payload)
  if (!finalized) {
    error('The response carried no recognizable finalized list (expected `report.finalized[]` with index + uuid).')
    note(JSON.stringify(payload).slice(0, 800))
    return { exitCode: 1 }
  }

  const summary = changedSummary(finalized)
  if (summary) note(summary)
  // Back-fill the minted uuids, by facet: each entity's uuid into its home file —
  // site-content → site.yml, @uniweb/folder → collections.yml, records → their
  // source files. Per-page/section local ids go into the committed move-tracking
  // ledger (never on the wire).
  let siteRecorded = false
  let folderRecorded = false
  for (const fin of finalized) {
    const entry = index[fin.index]
    if (entry?.kind === 'site') {
      writeSiteEntityUuid(siteDir, fin.uuid)
      recordSiteIdLedger(join(siteDir, SITE_ID_LEDGER_RELPATH), entry.document)
      siteRecorded = true
    } else if (entry?.kind === 'folder') {
      writeFolderUuid(siteDir, fin.uuid)
      folderRecorded = true
    }
  }
  const bf = backfillEntityUuids({ index, finalized })
  for (const w of bf.warnings) note(`! ${w}`)
  for (const d of bf.deferred) note(`↷ ${d.id ?? `#${d.index}`}: ${d.reason}`)
  // Persist the full content-hash map so the next sync skips unchanged entities.
  writeSyncCache(siteDir, hashes)
  const wrote = []
  if (siteRecorded) wrote.push('recorded site $uuid in site.yml')
  if (folderRecorded) wrote.push('recorded folder $uuid in collections.yml')
  if (bf.updated.length) wrote.push(`wrote ${bf.updated.length} record file(s)`)
  success(
    `Synced ${finalized.length} entit${finalized.length === 1 ? 'y' : 'ies'}` +
      (wrote.length ? ` — ${wrote.join(', ')}` : '') +
      (bf.unchanged.length ? ` (${bf.unchanged.length} file(s) unchanged)` : '')
  )
  return { exitCode: 0 }
}
