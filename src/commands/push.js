/**
 * uniweb push — push a site to the backend over its two directional lanes:
 *   - content lane → `@uniweb/site-content` (the static half: pages, sections,
 *     layout, theme, foundation ref, extensions, collection decls);
 *   - folder lane → one `@uniweb/folder` + the collection-record entities it
 *     references (the dynamic half; the `$ref` closure rides together).
 *
 * Each entity is an entity-content document (`$id` + `$model` + sections). The site
 * holds exactly one identity: `site.yml::$uuid` (the site-content entity). A first
 * push has none — it CREATEs the site (uuid-less), the backend mints + adopts it
 * and returns the new uuid, which `push` records into `site.yml`. Later pushes
 * UPDATE by that uuid. The folder lane is keyed by the SAME site-content uuid —
 * the backend owns the site's `@uniweb/folder`, so the framework never holds a
 * folder uuid. Records still round-trip their own `$uuid`
 * (back-filled into their source files). site-content is pushed wholesale (no per-item
 * uuids on the wire). Push-only, last-push-wins (`collision=force`) in v1.
 *
 * Order: content first (CREATE or UPDATE — the site must exist before its folder),
 * then the folder, keyed by the site's uuid. On a brand-new site the backend creates
 * the folder on its first folder push for that uuid.
 *
 * `uniweb login && uniweb push`. Run from a site, or a workspace with one site.
 *
 * Usage:
 *   uniweb push                          Build, push both lanes, back-fill $uuid
 *   uniweb push --as-org @org            Act as @org (membership-gated)
 *   uniweb push --dry-run                Report what would be pushed; submit nothing
 *   uniweb push -o out.uwx               Write the .uwx file(s) per lane; submit nothing
 *   uniweb push --registry <url>         Override the backend origin
 *   uniweb push --token <bearer>         Submit with this bearer; skips `uniweb login`
 *   uniweb push --foundation <dir>       Use this local foundation for the Model schema
 *   uniweb push --all                    Send every record (bypass the changed-only cache)
 *
 * Backend: via BackendClient (the content + folder sync lanes). Origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default.
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import {
  emitSyncPackages,
  backfillEntityUuids,
  writeSiteEntityUuid,
} from '@uniweb/build/uwx'
import { BackendClient } from '../backend/client.js'
import { resolveSiteDir } from './deploy.js'

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

// Pull the minted site-content uuid out of a CREATE
// response. The exact shape is an open backend item — tolerant of a bare
// `{ siteContentUuid }` / `{ $uuid }` / `{ uuid }`, or the same `report.finalized[]`
// envelope the update/folder lanes return (the site entity is submitted alone, so its
// minted uuid is the first finalized entry). Returns null if none is present. (Single
// adjust-point to pin at the first live CREATE.)
export function extractMintedSiteUuid(payload) {
  if (typeof payload?.siteContentUuid === 'string') return payload.siteContentUuid
  if (typeof payload?.$uuid === 'string') return payload.$uuid
  if (typeof payload?.uuid === 'string') return payload.uuid
  const finalized = extractFinalized(payload)
  if (finalized && finalized.length) {
    const site = finalized.find((f) => f.index === 0) || finalized[0]
    return site?.uuid ?? null
  }
  return null
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

// Resolve a Model NOT defined by the local foundation by reading its declaration
// (the `@uniweb/data-schema` form) from the backend via the client. Cached per run;
// HTTP 404 → null (the emitter then says "register it first"). The bearer is acquired
// lazily by the client, so a fully-local sync never authenticates.
export function makeModelResolver({ client }) {
  const cache = new Map()
  return async (modelName) => {
    if (cache.has(modelName)) return cache.get(modelName)
    const decl = await client.readDataSchema(modelName)
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

export async function push(args = []) {
  const dryRun = args.includes('--dry-run')
  const output = flagValue(args, '-o') || flagValue(args, '--output')
  const tokenFlag = flagValue(args, '--token')
  const asOrg = flagValue(args, '--as-org')
  const foundationDir = flagValue(args, '--foundation')
  const sendAll = args.includes('--all') // bypass the send-only-changed cache
  // One front door. The bearer is resolved lazily on first need (a non-local Model
  // read during the build, or the submit), so a fully-local sync — and --dry-run / -o
  // — never authenticate when every Model is defined by the local foundation.
  const client = new BackendClient({
    originFlag: flagValue(args, '--registry'),
    token: tokenFlag,
    args,
    command: 'Syncing',
  })

  const siteDir = await resolveSiteDir(args, 'push')

  // Build BOTH directional packages (the producer side). Each carries its own
  // `index` — the per-entity source-file map for back-fill, correlated by submission
  // position. Non-local Models are fetched from the registry on demand. `priorHashes`
  // (the .uniweb push-cache) drives "send only changed" across both lanes; --all bypasses.
  const priorHashes = readSyncCache(siteDir)
  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, {
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel: makeModelResolver({ client }),
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

  // Nothing changed since the last push — the backend is already up to date.
  if (totalEntities === 0) {
    success(`Nothing to push — ${skipped} entit${skipped === 1 ? 'y' : 'ies'} unchanged since the last push.`)
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
    if (siteContent) {
      const verb = siteContentUuid ? 'update' : 'create'
      info(`Dry run — would ${verb} content at ${colors.dim}${client.origin}${colors.reset}`)
    }
    if (collections) {
      info(`Dry run — would push the folder at ${colors.dim}${client.origin}${colors.reset}`)
    }
    return { exitCode: 0 }
  }

  const wrote = []
  let finalizedTotal = 0

  // POST one lane via the client and parse the JSON response. `doRequest` is a thunk
  // returning the client's Response promise (so the "Pushing …" line prints before the
  // request fires). The client carries `collision=force` (last-push-wins) + the optional
  // `--as-org`. Returns the parsed payload, or null on any transport/HTTP/parse failure
  // (already reported).
  const postLane = async (label, doRequest) => {
    info(`Pushing ${label} to ${colors.dim}${client.origin}${colors.reset} …`)
    let res
    try {
      res = await doRequest()
    } catch (err) {
      error(`Could not reach the backend at ${client.origin}: ${err.message}`)
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
    try {
      return await res.json()
    } catch (err) {
      error(`Could not parse the ${label} response as JSON: ${err.message}`)
      return null
    }
  }

  // POST a lane that round-trips entity uuids (content UPDATE + the folder): parse the
  // finalized list (for record back-fill + the changed summary). Returns the finalized
  // array, or null on failure (already reported).
  const pushLane = async (label, doRequest) => {
    const payload = await postLane(label, doRequest)
    if (payload === null) return null
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

  // Lane 1 — site-content (the site is born here; it must exist before its folder). A
  // known site uuid → UPDATE by uuid; none → CREATE (the backend mints + adopts the
  // site and returns its uuid, which we record into site.yml). `boundSiteUuid` carries
  // the minted/known uuid forward to key the folder push.
  let boundSiteUuid = siteContentUuid
  if (siteContent) {
    if (siteContentUuid) {
      const finalized = await pushLane(
        'site-content',
        () => client.updateSiteContent(siteContentUuid, siteContent.buffer, { asOrg })
      )
      if (!finalized) return { exitCode: 1 }
      finalizedTotal += finalized.length
    } else {
      const payload = await postLane(
        'site-content',
        () => client.createSiteContent(siteContent.buffer, { asOrg })
      )
      if (payload === null) return { exitCode: 1 }
      const minted = extractMintedSiteUuid(payload)
      if (!minted) {
        error('The create response carried no minted site-content uuid — cannot record the site identity or push its folder.')
        note(JSON.stringify(payload).slice(0, 800))
        return { exitCode: 1 }
      }
      writeSiteEntityUuid(siteDir, minted)
      boundSiteUuid = minted
      wrote.push('recorded site $uuid in site.yml')
      finalizedTotal += extractFinalized(payload)?.length ?? 1
    }
  }

  // Lane 2 — collections (the @uniweb/folder + the records it references), keyed by the
  // site-content uuid. On a brand-new site the backend creates the folder on this first
  // push. Records round-trip their own $uuid (back-filled into source files); the folder
  // itself has no uuid (the backend owns it).
  if (collections) {
    if (!boundSiteUuid) {
      error('Cannot push collections — the site has no uuid yet. Push the site-content lane first.')
      return { exitCode: 1 }
    }
    const finalized = await pushLane(
      'collections',
      () => client.pushFolder(boundSiteUuid, collections.buffer, { asOrg })
    )
    if (!finalized) return { exitCode: 1 }
    const bf = backfillEntityUuids({ index: collections.index, finalized })
    for (const w of bf.warnings) note(`! ${w}`)
    for (const d of bf.deferred) note(`↷ ${d.id ?? `#${d.index}`}: ${d.reason}`)
    if (bf.updated.length) wrote.push(`wrote ${bf.updated.length} record file(s)`)
    finalizedTotal += finalized.length
  }

  // Persist the full content-hash map so the next push skips unchanged entities.
  writeSyncCache(siteDir, hashes)
  success(
    `Pushed ${finalizedTotal} entit${finalizedTotal === 1 ? 'y' : 'ies'}` +
      (wrote.length ? ` — ${wrote.join(', ')}` : '')
  )
  return { exitCode: 0 }
}
