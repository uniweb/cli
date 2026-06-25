/**
 * uniweb pull — bring the backend's copy of a site back to canonical files.
 *
 * The read-side mirror of `uniweb push`. The project holds exactly one identity —
 * `site.yml::$uuid` (the site-content entity) — and BOTH pull lanes are keyed by it
 * (the backend owns the site's `@uniweb/folder` and resolves it from the site-content
 * uuid, so the framework never holds a folder uuid). It GETs the two lanes and projects
 * the returned documents back to files via the framework's projection layer
 * (`@uniweb/build/uwx`):
 *
 *   - content lane → `siteContentDocumentToProject` (site.yml/theme.yml/head.html,
 *     pages/**, layout/**), and
 *   - folder lane  → `collectionsToProject` (the folder + record files).
 *
 * Pull is git-pull-like: it reconciles the working tree to the backend, DELETING
 * pages/sections that no longer exist there (toggle off with `--no-delete`). The
 * deletion is guarded so an empty/partial payload never wipes the tree.
 *
 * `uniweb login && uniweb pull`. Run from a site, or a workspace with one site.
 *
 * Usage:
 *   uniweb pull                          GET both lanes, project to files, prune orphans
 *   uniweb pull --no-collections         Pull pages only; skip the folder (collections) lane
 *   uniweb pull --no-delete              Project, but keep files with no backend item
 *   uniweb pull --dry-run                Report what it would GET; write nothing
 *   uniweb pull --registry <url>         Override the backend origin
 *   uniweb pull --token <bearer>         Read with this bearer; skips `uniweb login`
 *
 * Backend: via BackendClient (the content + folder pull lanes), both keyed by
 *   `site.yml::$uuid`. Origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default.
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 *
 * A project that never pushed has no `$uuid` to pull by — pull is a no-op with a
 * clear message. The backend serves each lane as a `.uwx` (ZIP: `manifest.json` +
 * `entities/<uuid>.json`); `readPullDocuments` reads the entity files out of it, with
 * a tolerant JSON fallback (`extractDocument` / `splitCollectionsPull`). Verified live
 * against the playground backend, 2026-06-17.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import yaml from 'js-yaml'
import {
  siteContentDocumentToProject,
  collectionsToProject,
  resolveCollectionsConfig,
  readZip,
} from '@uniweb/build/uwx'
import { makeModelResolver } from './push.js'
import { BackendClient } from '../backend/client.js'
import { resolveSiteDir as defaultResolveSiteDir } from './deploy.js'

const FOLDER_MODEL = '@uniweb/folder'

const colors = { reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', blue: '\x1b[36m' }
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

// Read a top-level `$uuid:` scalar from a YAML file, or null.
function readYamlUuid(filePath) {
  try {
    const obj = yaml.load(readFileSync(filePath, 'utf8'))
    return typeof obj?.$uuid === 'string' ? obj.$uuid : null
  } catch {
    return null
  }
}

// Conditional-pull ETag cache (gitignored `.uniweb/pull-cache.json`): the last ETag
// seen per lane. The ETag is OPAQUE — cached and echoed verbatim in If-None-Match,
// never parsed or recomputed (the backend owns the hash; the client treats it as a
// token). A missing cache just means a full (unconditional) pull.
function pullCachePath(siteDir) {
  return join(siteDir, '.uniweb', 'pull-cache.json')
}
function readPullCache(siteDir) {
  try {
    const obj = JSON.parse(readFileSync(pullCachePath(siteDir), 'utf8'))
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}
function writePullCache(siteDir, { content, folder }) {
  const p = pullCachePath(siteDir)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ version: 1, content, folder }, null, 2) + '\n')
}

// Extract a single entity `$`-document from a pull response. Tolerant of a raw
// document, or a `{ document }` / `{ entity }` envelope. (Adjust at live e2e.)
export function extractDocument(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.$model || payload.$id || payload.info) return payload
  return payload.document || payload.entity || null
}

// Split a collections pull (the folder + the entities it references) into the
// folder document and the record documents. Tolerant of an array, an
// `{ entities }` / `{ documents }` list, or an explicit `{ folder, records }`.
export function splitCollectionsPull(payload) {
  if (payload?.folder) return { folderDoc: payload.folder, recordDocs: payload.records || [] }
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entities)
      ? payload.entities
      : Array.isArray(payload?.documents)
        ? payload.documents
        : null
  if (!list) return { folderDoc: null, recordDocs: [] }
  const docs = list.map(extractDocument).filter(Boolean)
  return {
    folderDoc: docs.find((d) => d.$model === FOLDER_MODEL) || null,
    recordDocs: docs.filter((d) => d.$model !== FOLDER_MODEL),
  }
}

// Read a pull lane's bytes into entity `$`-documents. The backend serves a `.uwx`
// (our Stored ZIP: `manifest.json` + `entities/<uuid>.json`); the entity files ARE the
// documents. Falls back to a JSON body (a raw doc, a `{document}`/`{entity}` envelope,
// or a list) so the lane survives a future envelope change. Returns an array (possibly
// empty).
export function readPullDocuments(buf) {
  // `.uwx` ZIP — the local-file signature is "PK\x03\x04".
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const docs = []
    for (const [name, data] of readZip(buf)) {
      if (name === 'manifest.json' || !name.endsWith('.json')) continue
      try {
        docs.push(JSON.parse(data.toString('utf8')))
      } catch {
        /* skip a non-document entry */
      }
    }
    return docs
  }
  // JSON fallback — flatten any envelope splitCollectionsPull understands into a
  // flat `$`-document list (a raw doc, a list, `{entities}`/`{documents}`, or
  // `{folder, records}`).
  let payload
  try {
    payload = JSON.parse(buf.toString('utf8'))
  } catch {
    return []
  }
  if (Array.isArray(payload)) return payload.map(extractDocument).filter(Boolean)
  if (payload?.folder) return [payload.folder, ...(payload.records || [])].filter(Boolean)
  const list = Array.isArray(payload?.entities)
    ? payload.entities
    : Array.isArray(payload?.documents)
      ? payload.documents
      : null
  if (list) return list.map(extractDocument).filter(Boolean)
  const single = extractDocument(payload)
  return single ? [single] : []
}

/**
 * @param {string[]} args
 * @param {object} [deps] - injectable seams for testing: `fetch` (default global
 *   fetch), `resolveSiteDir`, `getToken` (skip auth).
 */
export async function pull(args = [], deps = {}) {
  const resolveSiteDir = deps.resolveSiteDir || defaultResolveSiteDir

  const dryRun = args.includes('--dry-run')
  const tokenFlag = flagValue(args, '--token')
  const prune = !(args.includes('--no-delete') || args.includes('--no-prune')) // git-like by default
  const noCollections = args.includes('--no-collections') || args.includes('--content-only')
  const client = new BackendClient({
    originFlag: flagValue(args, '--backend') || flagValue(args, '--registry'),
    token: tokenFlag,
    getToken: deps.getToken,
    fetchImpl: deps.fetch,
    args,
    command: 'Pulling',
  })

  const siteDir = await resolveSiteDir(args, 'pull')
  // One identity per site: `site.yml::$uuid`. Both lanes (content + folder) are keyed
  // by it — the backend resolves the site's `@uniweb/folder` from this uuid.
  const siteContentUuid = readYamlUuid(join(siteDir, 'site.yml'))

  if (!siteContentUuid) {
    info('Nothing to pull — this project has no $uuid yet. Run `uniweb push` first.')
    return { exitCode: 0 }
  }

  if (dryRun) {
    info(`Dry run — would pull content from ${colors.dim}${client.origin}${colors.reset}`)
    if (!noCollections) info(`Dry run — would also pull collections`)
    return { exitCode: 0 }
  }

  // GET a pull lane via the client and return `{ docs, etag }` from its `.uwx` (ZIP)
  // body — `readPullDocuments` reads the entity files out of it (JSON fallback). A
  // conditional request whose ETag matches returns `{ notModified: true }` (304, empty
  // body). `doRequest` is a thunk returning the client's Response promise. 404 / any
  // failure → null (the lane is skipped, not fatal).
  const getDocs = async (label, doRequest) => {
    info(`Pulling ${colors.bright}${label}${colors.reset} from ${colors.dim}${client.origin}${colors.reset} …`)
    let res
    try {
      res = await doRequest()
    } catch (err) {
      error(`Could not reach the backend at ${client.origin}: ${err.message}`)
      note('Set the origin with --backend <url> or UNIWEB_REGISTER_URL.')
      return null
    }
    if (res.status === 404) {
      note(`${label}: not found (404) — it was deleted, or you lack access.`)
      return null
    }
    if (res.status === 304) {
      note(`${label}: unchanged (304)`)
      return { notModified: true }
    }
    if (!res.ok) {
      error(`${label} pull failed: HTTP ${res.status} ${res.statusText}`)
      if (res.status === 401 || res.status === 403) note("Credentials weren't accepted — supply a bearer with --token <bearer>.")
      return null
    }
    try {
      const etag = res.headers?.get?.('etag') ?? null
      const docs = readPullDocuments(Buffer.from(await res.arrayBuffer()))
      return { docs, etag }
    } catch (err) {
      error(`Could not read the ${label} response: ${err.message}`)
      return null
    }
  }

  let pages = 0
  let sections = 0
  let records = 0
  let deleted = 0

  // Conditional-pull cache: the last ETag seen per lane (opaque token — cached and
  // echoed verbatim, never recomputed). Lives in the gitignored `.uniweb/`.
  const cache = readPullCache(siteDir)
  let etagContent = cache.content
  let etagFolder = cache.folder

  // Lane 1 — content → config + pages/** + layout/**. The .uwx carries a single
  // entity (the site-content document). A 304 (unchanged) leaves local files as-is.
  const content = await getDocs('content', () => client.pullSiteContent(siteContentUuid, { etag: etagContent }))
  if (content && !content.notModified) {
    const siteDoc = content.docs && (content.docs.find((d) => d?.info || d?.$model) || content.docs[0] || null)
    if (siteDoc) {
      const report = siteContentDocumentToProject({ document: siteDoc, siteRoot: siteDir, prune })
      pages += report.pages.length
      sections += report.sections.length
      deleted += report.deleted.length
    }
    if (content.etag) etagContent = content.etag
  }

  // Lane 2 — folder → the folder + record files, keyed by the SAME site-content uuid
  // (the backend resolves the site's `@uniweb/folder` from it; the framework never
  // holds a folder uuid). Models are resolved by name (async) up front, so
  // collectionsToProject keeps its synchronous contract. A 304 leaves files as-is.
  if (!noCollections) {
    const folder = await getDocs('collections', () => client.pullFolder(siteContentUuid, { etag: etagFolder }))
    if (folder && !folder.notModified && folder.docs?.length) {
      const { folderDoc, recordDocs } = splitCollectionsPull(folder.docs)
      const resolveModel = makeModelResolver({ client })
      const declByModel = new Map()
      for (const model of [...new Set(recordDocs.map((d) => d.$model).filter(Boolean))]) {
        try {
          declByModel.set(model, await resolveModel(model))
        } catch (err) {
          note(`! could not resolve model ${model}: ${err.message}`)
        }
      }
      const collectionsConfig = await resolveCollectionsConfig(siteDir).catch(() => null)
      const report = collectionsToProject({
        folderDoc,
        recordDocs,
        siteRoot: siteDir,
        opts: { resolveDeclaration: (name) => declByModel.get(name) || null, collectionsConfig },
      })
      records += report.placed.length + report.updated.length
      for (const s of report.skipped) note(`↷ ${s.slug ?? s.uuid ?? '(record)'}: ${s.reason}`)
      for (const w of report.warnings) note(`! ${w}`)
    }
    if (folder?.etag) etagFolder = folder.etag
  }

  // Persist the ETags so the next pull is conditional (304 when unchanged).
  writePullCache(siteDir, { content: etagContent, folder: etagFolder })

  success(
    `Pulled — ${pages} page(s), ${sections} section(s), ${records} record(s)` + (deleted ? `, ${deleted} deleted` : '')
  )
  return { exitCode: 0 }
}
