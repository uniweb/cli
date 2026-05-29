/**
 * uniweb sync — push a site's file-based collections to the backend as entities,
 * with a stable-identity round trip.
 *
 * Each `model:`-mapped collection record is sent as one entity-content document
 * (`$id` + `$model` + the brief section). First sync carries no `$uuid`; the
 * backend mints one and returns it, and `sync` back-fills it into the source file
 * so a re-sync updates in place rather than duplicating. Push-only, last-push-wins
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
 *
 * Endpoint: <origin>/api/core/exchange/restore, origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default.
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emitCollectionSyncPackage, backfillEntityUuids } from '@uniweb/build/uwx'
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

// Pull the finalized entities ({ $id, $model, $uuid }) out of the restore
// response. The response is `{ report: { created, updated, skipped, minted,
// finalized: [ <$-document>, … ] } }`; each finalized entry IS the symmetric
// `$`-document, carrying top-level `$id` / `$model` / `$uuid`. A couple of
// shapes are tolerated for resilience; only entries with both $id and $uuid are
// usable for back-fill.
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
    .map((d) => ({ $id: d?.$id, $model: d?.$model, $uuid: d?.$uuid }))
    .filter((e) => e.$id && e.$uuid)
}

// Optional one-line summary of the create/replace/skip counts the report carries.
function reportSummary(payload) {
  const r = payload?.report
  if (!r || typeof r !== 'object') return null
  const n = (k) => (Array.isArray(r[k]) ? r[k].length : null)
  const parts = []
  for (const k of ['created', 'updated', 'skipped']) {
    const c = n(k)
    if (c != null) parts.push(`${c} ${k}`)
  }
  return parts.length ? parts.join(', ') : null
}

export async function sync(args = []) {
  const dryRun = args.includes('--dry-run')
  const output = flagValue(args, '-o') || flagValue(args, '--output')
  const tokenFlag = flagValue(args, '--token')
  const asUnit = flagValue(args, '--as-unit')
  const foundationDir = flagValue(args, '--foundation')
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

  // Build the package (the producer side). Carries `index` — the per-entity
  // ($model, $id) → source-file map used to back-fill minted uuids.
  let pkg
  try {
    pkg = await emitCollectionSyncPackage(siteDir, foundationDir ? { foundationDir } : {})
  } catch (err) {
    error(`Could not build the sync package: ${err.message}`)
    return { exitCode: 2 }
  }
  const { buffer, models, entityCount, warnings, index } = pkg
  log('')
  info(`${colors.bright}${entityCount}${colors.reset} record(s) → ${models.join(', ')}`)
  for (const w of warnings) note(`! ${w}`)

  // Preview paths — no submit, no auth.
  if (output) {
    writeFileSync(resolve(output), buffer)
    success(`Wrote ${output} (${entityCount} entities, ${buffer.length} bytes) — not submitted`)
    return { exitCode: 0 }
  }
  if (dryRun) {
    info(`Dry run — would submit to ${colors.dim}${apiBase}/api/core/exchange/restore${colors.reset}`)
    return { exitCode: 0 }
  }

  // Submit: binary .uwx body, sync-lane query params, bearer auth.
  const token =
    tokenFlag || process.env.UNIWEB_TOKEN || (await ensureRegistryAuth({ apiBase, command: 'Syncing', args }))
  const params = new URLSearchParams({ collision: 'force', binding: 'sync' })
  if (asUnit) params.set('as_unit', asUnit)
  const url = `${apiBase}/api/core/exchange/restore?${params.toString()}`

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
    error('The response carried no recognizable finalized list (expected the finalized `$`-documents).')
    note(JSON.stringify(payload).slice(0, 800))
    return { exitCode: 1 }
  }

  const summary = reportSummary(payload)
  if (summary) note(summary)
  const bf = backfillEntityUuids({ index, finalized })
  for (const w of bf.warnings) note(`! ${w}`)
  for (const d of bf.deferred) note(`↷ ${d.id} (${d.model}): ${d.reason}`)
  success(
    `Synced ${finalized.length} entit${finalized.length === 1 ? 'y' : 'ies'} — ` +
      `back-filled $uuid into ${bf.updated.length} file(s)` +
      (bf.unchanged.length ? `, ${bf.unchanged.length} unchanged` : '')
  )
  return { exitCode: 0 }
}
