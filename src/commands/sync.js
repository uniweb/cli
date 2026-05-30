/**
 * uniweb sync — push a site to the backend over its two directional lanes:
 *   - site-content lane → `@uniweb/site-content` (the static half: pages, sections,
 *     layout, theme, foundation ref, extensions, collection decls);
 *   - collections lane → one `@uniweb/folder` + the collection-record entities it
 *     references (the dynamic half; the `$ref` closure rides together).
 *
 * Each entity is an entity-content document (`$id` + `$model` + sections). First
 * sync carries no `$uuid`; the backend mints them and echoes them back. `sync` then
 * back-fills each entity's uuid into its home file: the site-content uuid → `site.yml`,
 * the folder uuid → `collections.yml`, each record uuid → its source file. site-content
 * syncs wholesale (no per-item uuids on the wire). Push-only, last-push-wins
 * (`collision=force`) in v1.
 *
 * Order: push site-content first (the site is born there), then collections — binding
 * the folder to that site via `?site=<siteContentUuid>` on the first collections push.
 *
 * `uniweb login && uniweb sync`. Run from a site, or a workspace with one site.
 *
 * Usage:
 *   uniweb sync                          Build, push both lanes, back-fill $uuid
 *   uniweb sync --as-org @org            Act as @org (membership-gated)
 *   uniweb sync --dry-run                Report what would be pushed; submit nothing
 *   uniweb sync -o out.uwx               Write the .uwx file(s) per lane; submit nothing
 *   uniweb sync --registry <url>         Override the backend origin
 *   uniweb sync --token <bearer>         Submit with this bearer; skips `uniweb login`
 *   uniweb sync --foundation <dir>       Use this local foundation for the Model schema
 *   uniweb sync --all                    Send every record (bypass the changed-only cache)
 *
 * Endpoints: <origin>/dev/sync/{site-content,collections}/push. origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default.
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import {
  emitSyncPackages,
  backfillEntityUuids,
  writeSiteEntityUuid,
  writeFolderUuid,
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

// Build the data-schema-read path for a registry name. `@scope/name` →
// /dev/registry/data-schemas/{scope}/{name}; a bare name →
// /dev/registry/data-schemas/{name}. The `@` sigil is not part of the path
// segment. (Path segment encoding to confirm at live e2e.)
function modelPathFor(modelName) {
  const m = /^@([^/]+)\/(.+)$/.exec(modelName)
  if (m) return `/dev/registry/data-schemas/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`
  return `/dev/registry/data-schemas/${encodeURIComponent(modelName)}`
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
  const asOrg = flagValue(args, '--as-org')
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

  // Build BOTH directional packages (the producer side). Each carries its own
  // `index` — the per-entity source-file map for back-fill, correlated by submission
  // position. Non-local Models are fetched from the registry on demand. `priorHashes`
  // (the .uniweb sync-cache) drives "send only changed" across both lanes; --all bypasses.
  const priorHashes = readSyncCache(siteDir)
  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, {
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel: makeModelResolver({ apiBase, getToken }),
      priorHashes,
      sendAll,
    })
  } catch (err) {
    error(`Could not build the sync package: ${err.message}`)
    return { exitCode: 2 }
  }
  const { siteContent, collections, siteContentUuid, warnings, hashes, skipped } = pkg
  log('')
  for (const w of warnings) note(`! ${w}`)

  const totalEntities = (siteContent?.entityCount || 0) + (collections?.entityCount || 0)

  // Nothing changed since the last sync — the backend is already in sync.
  if (totalEntities === 0) {
    success(`Nothing to sync — ${skipped} entit${skipped === 1 ? 'y' : 'ies'} unchanged since the last sync.`)
    return { exitCode: 0 }
  }
  if (siteContent) info(`${colors.bright}site-content${colors.reset} → ${siteContent.models.join(', ')}`)
  if (collections) {
    const n = collections.entityCount
    info(`${colors.bright}collections${colors.reset} (${n} entit${n === 1 ? 'y' : 'ies'}) → ${collections.models.join(', ')}`)
  }
  if (skipped) note(`${skipped} unchanged, skipped`)

  // Preview paths — no submit, no auth. Two lanes → up to two files / two routes.
  if (output) {
    const base = output.replace(/\.uwx$/, '')
    if (siteContent) writeFileSync(resolve(`${base}.site-content.uwx`), siteContent.buffer)
    if (collections) writeFileSync(resolve(`${base}.collections.uwx`), collections.buffer)
    const lanes = [siteContent && 'site-content', collections && 'collections'].filter(Boolean)
    success(`Wrote ${lanes.join(' + ')} .uwx — not submitted`)
    return { exitCode: 0 }
  }
  if (dryRun) {
    if (siteContent) info(`Dry run — would push to ${colors.dim}${apiBase}/dev/sync/site-content/push${colors.reset}`)
    if (collections) info(`Dry run — would push to ${colors.dim}${apiBase}/dev/sync/collections/push${colors.reset}`)
    return { exitCode: 0 }
  }

  const token = await getToken()
  const wrote = []
  let finalizedTotal = 0

  // POST one lane's .uwx and parse its finalized list. Returns null on any failure
  // (already reported). `extra` adds lane-specific query params (e.g. `site=`).
  const pushLane = async (label, path, buffer, extra = {}) => {
    const params = new URLSearchParams({ collision: 'force', ...extra })
    if (asOrg) params.set('as_org', asOrg)
    const url = `${apiBase}${path}?${params.toString()}`
    info(`Pushing ${label} to ${colors.dim}${url}${colors.reset} …`)
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
      return null
    }
    if (!res.ok) {
      error(`${label} push rejected: HTTP ${res.status} ${res.statusText}`)
      if (res.status === 401 || res.status === 403) {
        note("Credentials weren't accepted — supply a bearer with --token <bearer> (or UNIWEB_TOKEN).")
      }
      const body = await res.text().catch(() => '')
      if (body) note(body.slice(0, 800))
      return null
    }
    let payload
    try {
      payload = await res.json()
    } catch (err) {
      error(`Could not parse the ${label} response as JSON: ${err.message}`)
      return null
    }
    const finalized = extractFinalized(payload)
    if (!finalized) {
      error(`The ${label} response carried no recognizable finalized list (expected report.finalized[] with index + uuid).`)
      note(JSON.stringify(payload).slice(0, 800))
      return null
    }
    const summary = changedSummary(finalized)
    if (summary) note(`${label}: ${summary}`)
    return finalized
  }

  // Lane 1 — site-content (the site is born here; must exist before binding collections).
  // Capture the minted/known site uuid to bind the collections folder to.
  let boundSiteUuid = siteContentUuid
  if (siteContent) {
    const finalized = await pushLane('site-content', '/dev/sync/site-content/push', siteContent.buffer)
    if (!finalized) return { exitCode: 1 }
    for (const fin of finalized) {
      if (siteContent.index[fin.index]?.kind === 'site') {
        writeSiteEntityUuid(siteDir, fin.uuid)
        boundSiteUuid = fin.uuid
        wrote.push('recorded site $uuid in site.yml')
      }
    }
    finalizedTotal += finalized.length
  }

  // Lane 2 — collections (folder + the records it references). Bind to the site on the
  // first collections push (the folder has no uuid yet) via `?site=<siteContentUuid>`.
  if (collections) {
    const extra = collections.bind && boundSiteUuid ? { site: boundSiteUuid } : {}
    const finalized = await pushLane('collections', '/dev/sync/collections/push', collections.buffer, extra)
    if (!finalized) return { exitCode: 1 }
    for (const fin of finalized) {
      if (collections.index[fin.index]?.kind === 'folder') {
        writeFolderUuid(siteDir, fin.uuid)
        wrote.push('recorded folder $uuid in collections.yml')
      }
    }
    const bf = backfillEntityUuids({ index: collections.index, finalized })
    for (const w of bf.warnings) note(`! ${w}`)
    for (const d of bf.deferred) note(`↷ ${d.id ?? `#${d.index}`}: ${d.reason}`)
    if (bf.updated.length) wrote.push(`wrote ${bf.updated.length} record file(s)`)
    finalizedTotal += finalized.length
  }

  // Persist the full content-hash map so the next sync skips unchanged entities.
  writeSyncCache(siteDir, hashes)
  success(
    `Synced ${finalizedTotal} entit${finalizedTotal === 1 ? 'y' : 'ies'}` +
      (wrote.length ? ` — ${wrote.join(', ')}` : '')
  )
  return { exitCode: 0 }
}
