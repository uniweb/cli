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
 * Endpoints: <origin>/dev/site/content/pull/{uuid} + /dev/site/folder/pull/{uuid},
 *   both keyed by `site.yml::$uuid`. Origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default.
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 *
 * A project that never pushed has no `$uuid` to pull by — pull is a no-op with a
 * clear message. NOTE: the backend pull routes have not been exercised live; the
 * response-envelope extraction (extractDocument / splitCollectionsPull) is
 * deliberately tolerant and is the single point to adjust at the first live run.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import {
  siteContentDocumentToProject,
  collectionsToProject,
  resolveCollectionsConfig,
} from '@uniweb/build/uwx'
import { makeModelResolver } from './push.js'
import { ensureRegistryAuth } from '../utils/registry-auth.js'
import { resolveSiteDir as defaultResolveSiteDir } from './deploy.js'

const DEFAULT_BACKEND_ORIGIN = 'http://localhost:8080'
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

/**
 * @param {string[]} args
 * @param {object} [deps] - injectable seams for testing: `fetch` (default global
 *   fetch), `resolveSiteDir`, `getToken` (skip auth).
 */
export async function pull(args = [], deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const resolveSiteDir = deps.resolveSiteDir || defaultResolveSiteDir

  const dryRun = args.includes('--dry-run')
  const tokenFlag = flagValue(args, '--token')
  const prune = !(args.includes('--no-delete') || args.includes('--no-prune')) // git-like by default
  const noCollections = args.includes('--no-collections') || args.includes('--content-only')
  const registryFlag = flagValue(args, '--registry') || process.env.UNIWEB_REGISTER_URL || DEFAULT_BACKEND_ORIGIN

  let apiBase
  try {
    apiBase = new URL(registryFlag).origin
  } catch {
    error(`Invalid --registry / UNIWEB_REGISTER_URL: ${registryFlag}`)
    return { exitCode: 2 }
  }

  const siteDir = await resolveSiteDir(args, 'pull')
  // One identity per site: `site.yml::$uuid`. Both lanes (content + folder) are keyed
  // by it — the backend resolves the site's `@uniweb/folder` from this uuid.
  const siteContentUuid = readYamlUuid(join(siteDir, 'site.yml'))

  if (!siteContentUuid) {
    info('Nothing to pull — this project has no $uuid yet. Run `uniweb push` first.')
    return { exitCode: 0 }
  }

  // Lazy bearer — acquired on first GET (a dry run stays offline). Tests inject
  // deps.getToken to skip auth entirely.
  let cachedToken = null
  const getToken =
    deps.getToken ||
    (async () => {
      if (cachedToken) return cachedToken
      cachedToken = tokenFlag || process.env.UNIWEB_TOKEN || (await ensureRegistryAuth({ apiBase, command: 'Pulling', args }))
      return cachedToken
    })

  if (dryRun) {
    info(`Dry run — would GET ${colors.dim}${apiBase}/dev/site/content/pull/${siteContentUuid}${colors.reset}`)
    if (!noCollections) info(`Dry run — would GET ${colors.dim}${apiBase}/dev/site/folder/pull/${siteContentUuid}${colors.reset}`)
    return { exitCode: 0 }
  }

  // GET a pull lane and parse it as JSON. 404 → null (deleted / no access); any
  // failure is reported and returns null (the lane is skipped, not fatal).
  const getJson = async (path, label) => {
    const url = `${apiBase}${path}`
    info(`Pulling ${colors.bright}${label}${colors.reset} from ${colors.dim}${url}${colors.reset} …`)
    let res
    try {
      res = await fetchImpl(url, { headers: { Authorization: `Bearer ${await getToken()}` } })
    } catch (err) {
      error(`Could not reach the backend at ${url}: ${err.message}`)
      note('Set the origin with --registry <url> or UNIWEB_REGISTER_URL.')
      return null
    }
    if (res.status === 404) {
      note(`${label}: not found (404) — it was deleted, or you lack access.`)
      return null
    }
    if (!res.ok) {
      error(`${label} pull failed: HTTP ${res.status} ${res.statusText}`)
      if (res.status === 401 || res.status === 403) note("Credentials weren't accepted — supply a bearer with --token <bearer>.")
      return null
    }
    try {
      return await res.json()
    } catch (err) {
      error(`Could not parse the ${label} response as JSON: ${err.message}`)
      return null
    }
  }

  let pages = 0
  let sections = 0
  let records = 0
  let deleted = 0

  // Lane 1 — content → config + pages/** + layout/**.
  const siteDoc = extractDocument(
    await getJson(`/dev/site/content/pull/${encodeURIComponent(siteContentUuid)}`, 'content')
  )
  if (siteDoc) {
    const report = siteContentDocumentToProject({ document: siteDoc, siteRoot: siteDir, prune })
    pages += report.pages.length
    sections += report.sections.length
    deleted += report.deleted.length
  }

  // Lane 2 — folder → the folder + record files, keyed by the SAME site-content uuid
  // (the backend resolves the site's `@uniweb/folder` from it; the framework never
  // holds a folder uuid). Models are resolved by name (async) up front, so
  // collectionsToProject keeps its synchronous contract.
  if (!noCollections) {
    const payload = await getJson(`/dev/site/folder/pull/${encodeURIComponent(siteContentUuid)}`, 'collections')
    if (payload) {
      const { folderDoc, recordDocs } = splitCollectionsPull(payload)
      const resolveModel = makeModelResolver({ apiBase, getToken, fetchImpl })
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
  }

  success(
    `Pulled — ${pages} page(s), ${sections} section(s), ${records} record(s)` + (deleted ? `, ${deleted} deleted` : '')
  )
  return { exitCode: 0 }
}
