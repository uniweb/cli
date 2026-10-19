/**
 * uniweb pull — bring the backend's copy of a site back to canonical files.
 *
 * The read-side mirror of `uniweb push`. The project's identity on a backend — its
 * site-content uuid, in that backend's section of `sync.json` — keys BOTH pull lanes
 * (the backend owns the site's `@uniweb/folder` and resolves it from the site-content
 * uuid, so the framework never holds a folder uuid). It GETs the two lanes and projects
 * the returned documents back to files via the framework's projection layer
 * (`@uniweb/build/uwx`):
 *
 *   - content lane → `siteContentDocumentToProject` (site.yml/theme.yml/head.html,
 *     pages/**, layout/**), and
 *   - folder lane  → `recordsToProject` (the folder + record files).
 *
 * ⭐ IN A GIT REPOSITORY, A PULL IS A MERGE — of the backend's content, as a commit, into
 * the branch. The backend's documents are written onto the BASE: the newest sync point
 * the history holds, the last state of the site this history shares with the backend
 * (`utils/sync-point.js`). That happens in a stand-in, never in the working tree, so the
 * result differs from the base exactly where the backend changed something; it is
 * committed — a new sync point — and merged with git's own merge, whose merge base is
 * the base. So what either side added, changed, deleted or renamed is merged as git
 * merges it: edits to different parts of a file combine silently, only a genuine overlap
 * gets conflict markers (and a non-zero exit), and a file the base never had — a
 * teammate's new section, your uncommitted one — is never pruned. Uncommitted work is
 * stashed for the merge and put back (`--autostash`).
 *
 * ⛔ Until 2026-10-17 a pull here was a checkout that refused over uncommitted work, and
 * `--merge` three-way merged each file against the version this copy's last pull wrote —
 * a per-machine record, with HEAD where it had none. Committed work outside it was
 * lost: a teammate's new section pruned, a committed record edit overwritten, a fresh
 * clone's committed work reverted (`test/pull-merge-base.test.js`).
 *
 * A history with no sync point — a project synced before there were any, or one whose
 * sync merges were rebased away — merges with no base: a file both sides hold alike
 * merges without a word, and every difference is a conflict to settle. `--force` takes
 * the backend's version whole, and leaves a sync point.
 *
 * Outside a repository there is nothing to merge against: a pull reconciles the files to
 * the backend — section bodies rewritten, pages and sections the backend no longer has
 * DELETED (`--no-delete` keeps them; an empty or partial payload never wipes the tree) —
 * and asks first, unless nothing there is the author's (`pull-written.js`).
 *
 * `uniweb login && uniweb pull`. Run from a site, or a workspace with one site.
 *
 * Usage:
 *   uniweb pull                          GET both lanes; in git merge them, else write them
 *   uniweb pull --no-records             Pull pages only; skip the folder (records) lane
 *   uniweb pull --no-delete              Keep files with no backend item
 *   uniweb pull --force                  Take the backend's version, discarding local changes
 *   uniweb pull --dry-run                Report what it would GET; write nothing
 *
 * The content + folder pull lanes are both keyed by the site's uuid on that backend
 *   (sync.json).
 * Backend: the one you are logged in to — UNIWEB_SERVER overrides it for a script
 *   (resolveBackendOrigin). Auth: UNIWEB_TOKEN  >  the stored session  >  `uniweb login`.
 *   No `--server` or `--token`: switching and signing in are `uniweb login`.
 *
 * A project that never pushed has no `$uuid` to pull by — pull is a no-op with a
 * clear message. The backend serves each lane as a `.uwx` (ZIP: `manifest.json` +
 * `entities/<uuid>.json`); `readPullDocuments` reads the entity files out of it, with
 * a tolerant JSON fallback (`extractDocument` / `splitRecordsPull`). Verified live
 * against the playground backend, 2026-06-17.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync
} from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { join, dirname, relative, resolve } from 'node:path'
import yaml from 'js-yaml'
import { downloadMissingAssets, downloadFileRecords } from '../backend/asset-download.js'
import {
  readBackendState,
  siteContentDocumentToProject,
  dataBlockModels,
  recordsToProject,
  siteSelfScope,
  readZip,
  computeUnitHashes,
  collectUnitUuids,
  collectQueryUuids,
  collectFolderItemUuids,
  documentSchema
} from '@uniweb/build/uwx'
import {
  readWritten,
  recordWritten,
  isPullOutput
} from '../utils/pull-written.js'
import {
  makeModelResolver,
  ensureRegisteredFoundation,
  deploymentFields,
  rebankSyncHashes,
  writeQueryUuids,
  mergeBaseVersions,
  writeItemBaseVersions,
  pulledItemVersions,
  writeUnitBases,
  writeItemUuids,
  writeFolderItemUuids
} from '../backend/site-sync.js'
import { resolveWorkspace } from '../backend/workspace.js'
import { siteContentRoots, siteLaneRoots } from '../utils/git.js'
import {
  repoOf,
  mergeInProgress,
  unmergedPaths,
  ignoringRepo,
  isAncestor,
  historySyncPoint,
  madeOnto,
  baseFor,
  openStandIn,
  mergeSyncPoint,
  takeSyncPoint,
  snapshotFiles,
  changedInFiles,
  filesDifferFrom,
  readSyncPoint,
  writeSyncPoint
} from '../utils/sync-point.js'
import { isNonInteractive } from '../utils/interactive.js'
import {
  BackendClient,
  describeRequestError,
  refusalDetail,
  SOURCE_HEADER,
  WorkspaceMismatchError
} from '../backend/client.js'
import { resolveSiteDir as defaultResolveSiteDir } from './deploy.js'
import { checkFlags } from '../utils/flag-guard.js'
import {
  syncedElsewhere
} from '../utils/site-identity.js'

const FOLDER_MODEL = '@uniweb/folder'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[36m'
}
// Looked up at each call, so a caller that captures the console captures these too.
const log = (...a) => console.log(...a)
const success = (m) => log(`${colors.green}✓${colors.reset} ${m}`)
const error = (m) => console.error(`${colors.red}✗${colors.reset} ${m}`)
const info = (m) => log(`${colors.blue}→${colors.reset} ${m}`)
const note = (m) => log(`  ${colors.dim}${m}${colors.reset}`)

function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('-'))
    return args[i + 1]
  return null
}

// Whether this pull should fetch the asset bytes it does not have.
//
// Two levers, and they are deliberately not the same kind of thing:
//   - `site.yml::assets.download: false` — the PROJECT's standing choice. "We do
//     not keep the bytes here" is usually a property of a repo, not of a run, and
//     a property of a repo belongs in a file every clone reads.
//   - `--no-assets` — the RUN's override, for CI and one-off checkouts, where the
//     project's answer is right and this invocation is the exception.
//
// The flag can only turn fetching OFF. A project that declared `download: false`
// meant it, and a flag that could silently re-enable it would make the declared
// setting advisory.
function shouldFetchAssets(args, siteDir) {
  if (args.includes('--no-assets')) return false
  try {
    const cfg = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))
    if (cfg?.assets?.download === false) return false
  } catch {
    /* no site.yml, or unreadable — fetching is the default */
  }
  return true
}

// Read a top-level `$uuid:` scalar from a YAML file.
//
// ⛔ THREE STATES, AND COLLAPSING THEM TO `null` IS A LIE TO THE USER.
// This returned `null` on any throw, so a site.yml that EXISTS and carries a
// `$uuid:` line but does not PARSE was reported as "this project has no $uuid
// yet. Run `uniweb push` first." — advice that is wrong, and actively harmful
// on a cloned site, since `push` would send an empty tree at the uuid the file
// already holds.
//
// It is also invisible: the user greps the file, sees `$uuid:`, and disbelieves
// the CLI. The clone suite's own comment records an earlier round of exactly
// this ("an unquoted `@…` scalar matched a regex here while the file did not
// parse, and `pull` then found no `$uuid`") — that CAUSE was fixed by quoting
// the ref; the SYMPTOM stayed reachable by any other parse error.
// Re-surfaced 2026-09-18 by the backend lane, whose clone wrote a `$uuid:` and
// whose pull then said there was none.
//
// ⇒ Name the state. A missing file and a `$uuid`-less file are "no uuid"; a
// file that will not parse is an error with the parser's own message.
function readYamlUuid(filePath) {
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return { uuid: null } // no site.yml — genuinely nothing to pull
  }
  let obj
  try {
    obj = yaml.load(text)
  } catch (err) {
    return { uuid: null, unparsed: err.message.split('\n')[0] }
  }
  // Only whether site.yml parses. The uuid itself lives in sync.json now.
  return { uuid: null }
}

// Conditional-pull ETag cache (gitignored `.uniweb/pull-cache.json`): the last ETag
// seen per lane. The ETag is OPAQUE — cached and echoed verbatim in If-None-Match,
// never parsed or recomputed (the backend owns the hash; the client treats it as a
// token). A missing cache just means a full (unconditional) pull.
function pullCachePath(siteDir) {
  return join(siteDir, '.uniweb', 'pull-cache.json')
}
// ⛔ VERSION 2 DISOWNS EVERY ETAG A VERSION-1 PULL WROTE. Before 2026-09-23 a merge that
// kept a local file whole — every one, in the default layout — still cached the ETag of
// content it never took. Every later pull then answered 304 and the file never caught up.
// Ignoring those once costs one full pull. (In a repository an ETag is echoed only while
// the sync point it was banked with is in the history — see `cacheHolds` below.)
const PULL_CACHE_VERSION = 2
function readPullCache(siteDir) {
  try {
    const obj = JSON.parse(readFileSync(pullCachePath(siteDir), 'utf8'))
    return obj && typeof obj === 'object' && obj.version >= PULL_CACHE_VERSION ? obj : {}
  } catch {
    return {}
  }
}
function writePullCache(siteDir, { content, folder }) {
  const p = pullCachePath(siteDir)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(
    p,
    JSON.stringify({ version: PULL_CACHE_VERSION, content, folder }, null, 2) + '\n'
  )
}

// Extract a single entity `$`-document from a pull response. Tolerant of a raw
// document, or a `{ document }` / `{ entity }` envelope. (Adjust at live e2e.)
export function extractDocument(payload) {
  if (!payload || typeof payload !== 'object') return null
  // ⛔ `$uuid` counts: every stored entity has one. Without it, a document naming no
  // `$schema` stopped being a document at all — it vanished from the pull, which then
  // reported "0 record(s)" and succeeded (2026-09-24, when `$model` left this test).
  if (payload.$schema || payload.$uuid || payload.$id || payload.info) return payload
  return payload.document || payload.entity || null
}

// Split a collections pull (the folder + the entities it references) into the
// folder document and the record documents. Tolerant of an array, an
// `{ entities }` / `{ documents }` list, or an explicit `{ folder, records }`.
export function splitRecordsPull(payload) {
  if (payload?.folder)
    return { folderDoc: payload.folder, recordDocs: payload.records || [] }
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
    folderDoc: docs.find((d) => documentSchema(d) === FOLDER_MODEL) || null,
    recordDocs: docs.filter((d) => documentSchema(d) !== FOLDER_MODEL)
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Say why a pull did not place every record it was sent: a headline for an error
 * and the lines under it.
 *
 * ⛔ A data schema named by id, or not named at all, is said first, and instead of the
 * per-record reasons. The folder is found by its data schema's scoped name
 * (`splitRecordsPull`) and a record is placed in `records/<schema>/` by its data
 * schema's scoped name, so a response naming them by id — or naming none — places
 * nothing, and every record is then skipped as "not in the folder", which hides the
 * cause. Measured 2026-09-23: a backend answered the folder lane with ids for the
 * folder and every record, under the key `$schema` replaced (`$model`).
 *
 * @param {{ docs: object[], taken: number, skipped: object[] }} lane - every document
 *        the lane carried, how many records were written or already current, and the
 *        projection's skips
 * @returns {{ headline: string, lines: string[] }}
 */
export function describeUnplacedRecords({ docs, taken, skipped }) {
  const none = taken === 0
  const lead = none ? 'No record' : 'Not every record'
  const placedBy =
    "A record is placed in records/<schema>/ by its data schema's scoped name, so these cannot be placed."
  const byId = [
    ...new Set((docs || []).map((d) => documentSchema(d)).filter((m) => m && UUID_RE.test(m)))
  ]
  if (byId.length) {
    return {
      headline: `${lead} could be placed — the backend named their data schemas by id, not by scoped name.`,
      lines: [
        `Named by id: ${byId.slice(0, 3).join(', ')}${byId.length > 3 ? ', …' : ''}`,
        placedBy,
        'Your record files are unchanged.'
      ]
    }
  }
  const unnamed = (docs || []).filter((d) => !documentSchema(d)).length
  if (unnamed) {
    return {
      headline: `${lead} could be placed — ${unnamed} of the backend's documents name no data schema (\`$schema\`).`,
      lines: [placedBy, 'Your record files are unchanged.']
    }
  }
  const n = skipped.length
  return {
    headline: `${n} record${n === 1 ? '' : 's'} could not be placed — ${n === 1 ? 'its file is' : 'their files are'} unchanged.`,
    lines: skipped.map((s) => `↷ ${s.slug ?? s.uuid ?? '(record)'}: ${s.reason}`)
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
  // JSON fallback — flatten any envelope splitRecordsPull understands into a
  // flat `$`-document list (a raw doc, a list, `{entities}`/`{documents}`, or
  // `{folder, records}`).
  let payload
  try {
    payload = JSON.parse(buf.toString('utf8'))
  } catch {
    return []
  }
  if (Array.isArray(payload))
    return payload.map(extractDocument).filter(Boolean)
  if (payload?.folder)
    return [payload.folder, ...(payload.records || [])].filter(Boolean)
  const list = Array.isArray(payload?.entities)
    ? payload.entities
    : Array.isArray(payload?.documents)
      ? payload.documents
      : null
  if (list) return list.map(extractDocument).filter(Boolean)
  const single = extractDocument(payload)
  return single ? [single] : []
}

// Read the per-entity optimistic-concurrency tokens out of a pull lane's manifest.
// The backend stamps each entity entry with a top-level `version` (opaque RFC3339);
// we cache it and echo it back as `base_version` on the next push, so a push
// against a base the backend has moved past is refused instead of silently
// overwriting. Returns a `{ <backend-uuid>: <version> }` map — empty for a JSON
// fallback body (no manifest ⇒ no tokens ⇒ that lane simply stays unconditional).
//
// TOP-LEVEL on the entry. The backend's `Entry::extra` is `#[serde(flatten)]`, so
// it never appears on the wire; reading `extra.version` finds nothing and silently
// leaves the gate disarmed (which is exactly what it did before 2026-07-26).
//
// Keyed by `entries[].uuid`, which on a PULL manifest is the real backend uuid.
// Note that is NOT symmetric with what we EMIT: on the push side that field is our
// `$id` handle, and the backend correlates our `base_version` via the body's
// `$uuid` instead. Same field name, different meaning by direction.
//
// This reads the SAME manifest.json that readPullDocuments deliberately skips:
// there the entity files are the payload, here the manifest is the index we were
// previously discarding.
export function readPullVersions(buf) {
  return readManifestTokens(buf).entity
}

/**
 * Per-ITEM staleness tokens: `{ <record $uuid>: <opaque version> }`, from the
 * entry's `item_versions`.
 *
 * The entity token can only say "something in this document moved"; these say
 * which records did, which is what lets two people editing different sections
 * both land instead of one being refused. Echoed back as `item_base_versions`.
 *
 * Keyed by record uuid rather than by our file path deliberately: the token then
 * joins to the body by the same identity the backend's reconcile uses, and a file
 * rename cannot silently re-target it. Absent for an entity with no items, and
 * absent from an older backend — both mean "no per-item precondition", fall back
 * to the entity grain.
 */
export function readPullItemVersions(buf) {
  return readManifestTokens(buf).item
}

// One manifest read for both grains — they arrive on the same entry and must not
// drift apart by being parsed in two places.
function readManifestTokens(buf) {
  const out = { entity: {}, item: {} }
  if (!(buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b)) return out
  for (const [name, data] of readZip(buf)) {
    if (name !== 'manifest.json') continue
    try {
      const manifest = JSON.parse(data.toString('utf8'))
      for (const entry of manifest?.entries || []) {
        if (entry?.uuid && typeof entry.version === 'string')
          out.entity[entry.uuid] = entry.version
        const items = entry?.item_versions
        if (items && typeof items === 'object') {
          for (const [uuid, v] of Object.entries(items)) {
            if (typeof v === 'string') out.item[uuid] = v
          }
        }
      }
    } catch {
      /* an unreadable manifest just means no tokens this pull */
    }
    break
  }
  return out
}

/**
 * @param {string[]} args
 * @param {object} [deps] - injectable seams for testing: `fetch` (default global
 *   fetch), `resolveSiteDir`, `getToken` (skip auth).
 */
// Every file under `roots` (site-relative paths, files or directories), site-relative.
function filesUnder(siteDir, roots) {
  const out = []
  const walk = (rel) => {
    const abs = join(siteDir, rel)
    let stat
    try {
      stat = statSync(abs)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(abs)) walk(join(rel, name))
    } else if (stat.isFile()) {
      out.push(rel)
    }
  }
  for (const root of roots) walk(root)
  return out
}

/**
 * Outside git, refuse a pull that would overwrite unsaved work. Returns a result object to
 * return from `pull`, or null to proceed.
 *
 * Nothing stands behind the tree there, so it asks — and in a non-interactive context
 * refuses rather than assume consent — unless nothing under pull's roots is the author's:
 * every file is one a pull, or the clone that made the site, wrote and nothing has changed
 * since (`pull-written.js`). ⛔ Until 2026-09-26 a fresh clone's own pull, which runs with no
 * terminal to ask, refused here, and `uniweb clone` could not finish.
 */
async function checkWorkingTree(siteDir, args) {
  const roots = siteContentRoots(siteDir)
  const written = readWritten(siteDir)
  if (filesUnder(siteDir, roots).every((f) => isPullOutput(siteDir, f, written))) return null
  // A folder the repository around it ignores is outside git too — said as such, since a
  // repository is right there and "not in a repository" is not what the person sees.
  const ignoredBy = ignoringRepo(siteDir)
  if (isNonInteractive(args)) {
    error(
      ignoredBy
        ? 'Refusing to pull: this site is in a folder the repository around it ignores, so no repository holds it.'
        : 'Refusing to pull: this site is not in a git repository.'
    )
    note(
      'Pull rewrites pages, sections and layout from the backend and deletes what it no longer has.'
    )
    note(
      'Without version control there is no way back, and this session cannot ask.'
    )
    note(
      ignoredBy
        ? 'Re-run with --force to accept that, or give the site a repository of its own (`git init`, then commit) — there a pull merges.'
        : 'Re-run with --force to accept that, or put the site under git first — there a pull merges.'
    )
    return { exitCode: 1 }
  }
  const ok = await confirm(
    `Pull will overwrite ${roots.length} content location(s), and no git repository holds this site. Continue?`
  )
  if (!ok) {
    info('Nothing pulled.')
    return { exitCode: 0 }
  }
  return null
}

// The written-record helpers live in `utils/pull-written.js`: outside git they are how a
// pull tells its own output from the author's work (`checkWorkingTree`), and that module
// imports nothing of `@uniweb/build`.

// Minimal yes/no prompt; defaults to no, because the default must not destroy.
async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    return a === 'y' || a === 'yes'
  } finally {
    rl.close()
  }
}

// Read what a file holds, or null — to put it back if a merge cannot be made.
function bytesOf(path) {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}
function restore(path, bytes) {
  if (bytes === null) rmSync(path, { force: true })
  else writeFileSync(path, bytes)
}

// The sync point's subject line, and the merge's.
const pulledFrom = (origin) => `The site's content on ${origin}`
const mergedFrom = (origin) => `Merge the site's content from ${origin}`
const takenFrom = (origin) => `Take the site's content from ${origin}`

export async function pull(args = [], deps = {}) {
  // See utils/flag-guard.js — an unrecognized flag is invisible to a literal scan, so
  // it silently keeps the default: a mistyped `--dry-run` would pull for real, and a
  // mistyped `--no-delete` would prune. *(This named `--backend` until 2026-10-16;
  // pull has taken no backend flag since 2026-09-21.)*
  const badFlag = checkFlags('pull', args)
  if (badFlag) {
    error(badFlag.message)
    return { exitCode: 2 }
  }
  const resolveSiteDir = deps.resolveSiteDir || defaultResolveSiteDir

  const dryRun = args.includes('--dry-run')
  const prune = !(args.includes('--no-delete') || args.includes('--no-prune')) // git-like by default
  const noRecords =
    args.includes('--no-records') || args.includes('--content-only')
  const force = args.includes('--force')

  const siteDir = await resolveSiteDir(args, 'pull')
  const fetchAssets = shouldFetchAssets(args, siteDir)

  // ⭐ IN A REPOSITORY A PULL MERGES; OUTSIDE ONE IT CHECKS OUT. A merge needs the state both
  // sides started from, and only a history holds one (`utils/sync-point.js`). Outside git
  // a pull rewrites the files, so work there that a pull did not write stops it.
  const repo = repoOf(siteDir)
  if (repo && !dryRun) {
    if (!repo.head) {
      error('This repository has no commits yet, so there is nothing for a pull to merge into.')
      note('Commit the project, then pull.')
      return { exitCode: 1 }
    }
    if (mergeInProgress(repo)) {
      error('A merge is in progress here.')
      note('Finish it (`git commit`) or abandon it (`git merge --abort`), then pull.')
      return { exitCode: 1 }
    }
    const unsettled = unmergedPaths(repo)
    if (unsettled.length) {
      error(`${unsettled.length} file(s) here are in conflict:`)
      for (const p of unsettled.slice(0, 12)) note(`  ${p}`)
      note('Settle them first — `git status` says how — then pull.')
      return { exitCode: 1 }
    }
  } else if (!repo && !dryRun && !force) {
    const blocked = await checkWorkingTree(siteDir, args)
    if (blocked) return blocked
  }
  // ⭐ THE BACKEND YOU ARE LOGGED IN TO is where this goes *[Diego, 2026-09-21]*, for every
  // backend verb (resolveBackendOrigin). Only UNIWEB_SERVER — the automation
  // override — outranks it, and nothing talks to a backend the user is not logged in to:
  // logged in nowhere, the origin is the default backend and the first request asks for
  // that login. ⛔ There is no `--server` here: switching is `uniweb login --server`.
  // ⛔ The project's own record — its synced backend, deploy.yml's default target — routes
  // NOTHING. For part of 2026-09-21 it answered a "logged in nowhere" tier, which cannot
  // be reached: *"We do not allow any communication with backend if the user is not
  // logged into a backend."*
  const client = new BackendClient({
    getToken: deps.getToken,
    fetchImpl: deps.fetch,
    args,
    command: 'Pulling'
  })
  // One reader of Models for the whole pull, so a Model is read once whichever lane asks first.
  const readModel = makeModelResolver({ client, siteDir })

  // ⭐ No scope check any more — and none is needed. This project's identity on
  // `client.origin` is read from that origin's own section of sync.json, so a
  // wrong-backend pull cannot happen: it would find no uuid and stop below.

  // One identity per site per backend. Both lanes (content + folder) are keyed by it —
  // the backend resolves the site's `@uniweb/folder` from this uuid.
  const siteYmlPath = join(siteDir, 'site.yml')
  const identity = readYamlUuid(siteYmlPath)

  // A file that will not parse is an error, not an absence — see readYamlUuid.
  if (identity.unparsed) {
    error(`site.yml did not parse: ${identity.unparsed}`)
    note(siteYmlPath)
    note(
      'Nothing was read, so the $uuid in it (if any) was not seen. Fix the YAML and re-run.'
    )
    return { exitCode: 1 }
  }

  // ⛔ FROM sync.json, FOR THIS BACKEND. This read `identity.uuid` — site.yml's `$uuid`
  // — and kept doing so after step 4 moved the key, so EVERY pull of a synced project
  // answered "Nothing to pull — this project has no $uuid yet". site.yml is still
  // parsed above, because a file that will not parse is its own error.
  const siteContentUuid = readBackendState(siteDir, client.origin).site?.uuid || null

  if (!siteContentUuid) {
    // Following the login can land on a backend with no site for this project while it
    // has one elsewhere — say where, rather than only "push first", which would create a
    // second site. Not when UNIWEB_SERVER chose the backend: that is a decision.
    const known = !process.env.UNIWEB_SERVER
      ? syncedElsewhere(siteDir, client.origin)
      : null
    if (known) {
      info(`Nothing to pull — this project has no site on ${client.origin}.`)
      note(
        `Its ${known.length === 1 ? `site is on ${known[0]}` : `sites are on ${known.join(', ')}`}. To pull from there: uniweb login --server <url>`
      )
      return { exitCode: 0 }
    }
    info(
      `Nothing to pull — this project has not synced with ${client.origin} yet. Run \`uniweb push\` first.`
    )
    return { exitCode: 0 }
  }

  if (dryRun) {
    info(
      `Dry run — would pull content from ${colors.dim}${client.origin}${colors.reset}`
    )
    if (!noRecords) info(`Dry run — would also pull records`)
    return { exitCode: 0 }
  }

  // The workspace this pull works in — the one chosen with the login, unless this
  // command names another (`workspace.js`). Resolved at the first request, not before:
  // a pull with nothing to pull never needs one. A site kept elsewhere stops it.
  const ws = await resolveWorkspace({ client, args })
  if (ws.refused) {
    error('This pull works in one workspace, and none is chosen.')
    note(ws.reason)
    return { exitCode: 2 }
  }
  client.setWorkspace(ws.workspace, { source: ws.source })

  // GET a pull lane via the client and return `{ docs, etag }` from its `.uwx` (ZIP)
  // body — `readPullDocuments` reads the entity files out of it (JSON fallback). A
  // conditional request whose ETag matches returns `{ notModified: true }` (304, empty
  // body). `doRequest` is a thunk returning the client's Response promise. 404 / any
  // failure → null (the lane is skipped, not fatal) — except a workspace mismatch,
  // `{ refused: true }`, which stops the pull: the other lane would only say it again.
  const getDocs = async (label, doRequest) => {
    info(
      `Pulling ${colors.bright}${label}${colors.reset} from ${colors.dim}${client.origin}${colors.reset} …`
    )
    let res
    try {
      res = await doRequest()
    } catch (err) {
      error(describeRequestError(err, client.origin))
      if (err instanceof WorkspaceMismatchError) return { refused: true }
      note('Is that the backend you meant? Switch with: uniweb login --server <url>')
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
      const detail = await refusalDetail(res)
      if (detail) note(detail)
      if (res.status === 401 || res.status === 403)
        note(
          "Credentials weren't accepted — log in again (`uniweb login --server <url>`), or check UNIWEB_TOKEN."
        )
      return null
    }
    try {
      const etag = res.headers?.get?.('etag') ?? null
      // ⭐ The commit the backend says this content last came from — a push's, which this
      // history may hold (`utils/sync-point.js`).
      const source = res.headers?.get?.(SOURCE_HEADER) ?? null
      const buf = Buffer.from(await res.arrayBuffer())
      const docs = readPullDocuments(buf)
      // The staleness tokens this lane carried, so the next push is gated against
      // the state we took. Banked by the caller once the content is taken — a lane the
      // files did not take must not have its token recorded as taken. A 304 carries
      // none, correctly: the tokens we hold are still current.
      return {
        docs,
        etag,
        source,
        versions: readPullVersions(buf),
        itemVersions: readPullItemVersions(buf)
      }
    } catch (err) {
      error(`Could not read the ${label} response: ${err.message}`)
      return null
    }
  }

  // Every file the projection writes — outside git, so the next pull can tell its own
  // output from the user's work (see readWritten).
  const wrote = []
  const removed = []
  let pages = 0
  let sections = 0
  let records = 0
  let deleted = 0
  // Set when the folder lane carried records this pull did not place — see the ⛔
  // where it is set.
  let recordsNotPlaced = null

  // Conditional-pull cache: the last ETag seen per lane (opaque token — cached and
  // echoed verbatim, never recomputed). Lives in the gitignored `.uniweb/`.
  //
  // ⛔ In a repository an ETag says "the backend has not moved since the content it came
  // with" — about the FILES only while that content is in their history. A merge
  // abandoned, a branch reset: the backend did not move, the files did. So it is echoed
  // only while the sync point it was banked with is.
  const cache = readPullCache(siteDir)
  const held = repo ? readSyncPoint(siteDir, client.origin) : null
  const cacheHolds = !repo || Boolean(held && isAncestor(repo, held))
  let etagContent = cache.content
  let etagFolder = cache.folder

  // ⛔ `--force` IS UNCONDITIONAL. It means "take the backend's version over mine", and
  // an ETag answers a different question — whether the BACKEND moved, never whether
  // the files still hold what it sent. Echoed here, a `git checkout` followed by
  // `pull --force` got a 304 and left the checked-out files in place (2026-09-23).
  const conditional = !force && cacheHolds

  // Lane 1 — content → config + pages/** + layout/**. The .uwx carries a single
  // entity (the site-content document). A 304 (unchanged) leaves local files as-is.
  const content = await getDocs('content', () =>
    client.pullSiteContent(siteContentUuid, { etag: conditional ? etagContent : undefined })
  )
  if (content?.refused) return { exitCode: 1 }
  const siteDoc =
    content && !content.notModified && content.docs
      ? content.docs.find((d) => d?.info || documentSchema(d)) || content.docs[0] || null
      : null
  if (content?.etag) etagContent = content.etag

  // Lane 2 — folder → the folder + record files, keyed by the SAME site-content uuid
  // (the backend resolves the site's `@uniweb/folder` from it; the framework never
  // holds a folder uuid). A 304 leaves files as-is.
  let folderLane = null
  if (!noRecords) {
    folderLane = await getDocs('records', () =>
      client.pullFolder(siteContentUuid, { etag: conditional ? etagFolder : undefined })
    )
    if (folderLane?.refused) return { exitCode: 1 }
    if (folderLane?.etag) etagFolder = folderLane.etag
  }
  const folderTaken =
    folderLane && !folderLane.notModified && folderLane.docs?.length
      ? splitRecordsPull(folderLane.docs)
      : null
  const projected = Boolean(siteDoc) || Boolean(folderTaken)

  // ── What the project itself says, read before anything is written ──────────
  // The foundation, the Models and the scope come from the project as it is: in a
  // repository the content is written into a stand-in, where none of them is read.

  // ⛔ Do NOT overwrite a workspace project's `site.yml::foundation`.
  //
  // Same principle as restoring authored asset paths, and the same failure it prevents:
  // a round trip must not mangle what the author wrote. `publish` stamps the RELEASED,
  // version-pinned ref into `info.foundation` (delivery is version-pinned end to end),
  // so projecting the stored value back turns `foundation: src` into `@org/x@1.2.3` —
  // which the build then REFUSES to resolve, leaving the project unable to `build`,
  // `dev` or `export`. It stays publishable throughout, so nothing surfaces it.
  //
  // ⚖️ Only suppressed when the AUTHORED value resolves to a local foundation. A project
  // from `uniweb clone` has no local foundation on disk, and there the pinned ref is
  // exactly what site.yml should say — so this is a question about which project shape
  // we are writing into, not a blanket "never project it".
  //
  // Lazily imported: the resolver lives behind `@uniweb/build`'s root, which pulls the
  // vite chain, and this file deliberately imports only the `uwx` leaf. Reused rather
  // than reimplemented so "which foundation" cannot drift from what the build itself
  // resolves.
  let keepAuthoredFoundation = false
  let dataModel = null
  // The Models the pulled site's queries name, as the push qualified them — the re-bank
  // resolves with them too.
  let pulledQueryModels = []
  if (siteDoc) {
    pulledQueryModels = (Array.isArray(siteDoc.queries) ? siteDoc.queries : [])
      .map((q) => q?.schema)
      .filter((s) => typeof s === 'string' && /^@[^/]+\//.test(s))
    try {
      const { resolveLocalFoundation } = await import(
        '../backend/foundation-bring-along.js'
      )
      const authored = yaml.load(readFileSync(siteYmlPath, 'utf8'))
      keepAuthoredFoundation = Boolean(resolveLocalFoundation(siteDir, authored))
    } catch {
      // No site.yml, unreadable, or nothing local — project the stored value, which is
      // the pre-existing behaviour and right for a fresh clone.
    }
    // A foundation named by catalog ref — a clone's: keep its registered version before the
    // queries are written, since its section types are what type a query named for a data key.
    if (!keepAuthoredFoundation) {
      await ensureRegisteredFoundation({ client, siteDir, siteUuid: siteContentUuid, ref: siteDoc?.info?.foundation })
    }
    // A translated data block is read back by what its section's type declares it is, as the
    // push translated it — after the registered foundation above, whose section types say it.
    dataModel = await dataBlockModels(siteDir)
  }
  // ⭐ THE SCOPE THE PULLED RECORDS AND QUERIES WERE QUALIFIED WITH — the pushed site's
  // FOUNDATION's: the scope of the pinned ref it carries (`info.foundation`), else the
  // local foundation's name. A push qualifies `@/x` with it, so this is what undoes it,
  // and a record lands back in `records/article/` rather than `records/acme/article/`.
  // ⛔ It was the site owner's org, from sync.json, until 2026-09-22; a foundation may be
  // registered under any org its author belongs to.
  const pinned = siteDoc?.info?.foundation
  const pullScope = projected
    ? await siteSelfScope(siteDir, pinned !== undefined ? { foundation: pinned } : {})
    : undefined
  // The record lane's Models, by name — resolved up front, so `recordsToProject` keeps its
  // synchronous contract. ⛔ NO QUERY CONFIG: a record's home is decided by what it IS —
  // its data schema (`documentSchema`) names the pool folder — not by any query that
  // happens to select it.
  const declByModel = new Map()
  if (folderTaken) {
    for (const model of [
      ...new Set(folderTaken.recordDocs.map((d) => documentSchema(d)).filter(Boolean))
    ]) {
      try {
        declByModel.set(model, await readModel(model))
      } catch (err) {
        note(`! could not resolve model ${model}: ${err.message}`)
      }
    }
  }
  // ⭐ The re-bank resolves with the Models this pull read, and those its queries name — a
  // query may name a schema no record uses yet. It is offline, and a site whose foundation
  // is not in the project (a clone's) resolves none of them otherwise: every template clone
  // said "could not re-bank" until 2026-09-25, and banked nothing.
  const declarations = new Map(declByModel)
  for (const model of pulledQueryModels) {
    if (declarations.has(model)) continue
    try {
      declarations.set(model, await readModel(model))
    } catch {
      // Unreadable here: the re-bank says so if it needs it.
    }
  }
  const fields = projected ? await deploymentFields({ client, siteDir }) : null

  // ── Where the backend's content is written ──────────────────────────────────
  // ⭐ In a repository, onto the BASE — the newest sync point HEAD's history holds — in a
  // stand-in, so the result differs from the base exactly where the backend changed
  // something. That result is committed, a new sync point, and merged: git's merge, with
  // the base as its merge base. `--force`, and a history with no sync point, write onto
  // HEAD instead: the first to take the backend's whole, the second so a file both sides
  // hold alike merges without a word.
  const roots = [...siteContentRoots(siteDir), 'public']
  let base = null
  let onto = null
  let standIn = null
  if (repo && projected) {
    // The bases this copy knows of itself — then what the backend names, per lane.
    const known = [
      historySyncPoint(repo, { origin: client.origin, siteUuid: siteContentUuid }),
      held,
      // What a sync point the branch no longer holds — a merge abandoned — was made onto.
      ...madeOnto(repo, held, { origin: client.origin, siteUuid: siteContentUuid })
    ]
    const laneRoots = siteLaneRoots(siteDir)
    const taken = (lane) => lane && !lane.notModified && !lane.refused
    base = baseFor(repo, {
      known,
      // ⛔ What each lane the backend answered names is a base only where every lane holds it (`baseFor`).
      lanes: [
        ...(taken(content) ? [{ source: content.source, roots: laneRoots.content }] : []),
        ...(taken(folderLane) ? [{ source: folderLane.source, roots: laneRoots.records }] : [])
      ],
      origin: client.origin,
      siteUuid: siteContentUuid
    })
    onto = force || !base ? repo.head : base
    try {
      standIn = openStandIn(repo, { roots, rev: onto })
    } catch (err) {
      error(`Could not merge the site: ${err.message}.`)
      return { exitCode: 1 }
    }
  }
  const projDir = standIn ? standIn.siteDir : siteDir

  // The versions this copy holds after the pull: every site-content item the pulled
  // document carries (`pulledItemVersions`), banked below once the content is taken.
  let pulledVersions = null
  // The record documents this pull took — the re-bank pairs their list items with the files.
  let pulledRecordDocs = []
  let merge = { conflicted: [], changed: [] }
  let notTaken = false
  try {
    if (siteDoc) {
      // Re-base the page attribution. The pulled document IS the backend's own
      // representation, so it becomes the remote base directly. We deliberately
      // CLEAR the local base rather than reuse it: our source files were just
      // rewritten from this document, and what we would emit from them is not
      // byte-identical to it, so the old local base no longer describes anything.
      // The next push re-establishes it; until then our side reports as unknown,
      // which is honest rather than wrong.
      writeUnitBases(projDir, client.origin, { remote: computeUnitHashes(siteDoc), local: {} })
      pulledVersions = pulledItemVersions(siteDoc, content.itemVersions)
      // Per-item identity for the next push. Without it the backend reads our
      // records as new and re-mints every page and section row.
      writeItemUuids(projDir, client.origin, collectUnitUuids(siteDoc))
      // The collections section's identity has no file to live in either — same
      // reason, same remedy, keyed by name. A pull is the other route by which a
      // copy can recover it (see readQueryUuids).
      writeQueryUuids(projDir, client.origin, collectQueryUuids(siteDoc))
      // Bring the media down BEFORE projecting: a newly-landed asset gains a map
      // entry, and the projection reads that map to put authored paths back. Run
      // after, and this pull's new assets would project as URLs and only restore
      // on the NEXT pull — a lag nobody would attribute to ordering.
      //
      // Declining is a project-level choice (`site.yml::assets.download: false`)
      // with a per-run override (`--no-assets`), because "we do not want the
      // bytes" is usually a property of the project and only sometimes of the
      // invocation (CI). Either way the content keeps its URL and still renders.
      if (fetchAssets) {
        const dl = await downloadMissingAssets({
          document: siteDoc,
          siteDir: projDir,
          origin: client.origin,
          onProgress: (m) => note(`  ${m}`),
          warn: (m) => note(`! ${m}`)
        })
        if (dl.downloaded.length) {
          note(`Assets        : ${dl.downloaded.length} downloaded`)
        }
        if (dl.failed.length) {
          note(
            `Assets        : ${dl.failed.length} could not be fetched — content keeps their URL`
          )
        }
      }
      const report = siteContentDocumentToProject({
        document: siteDoc,
        siteRoot: projDir,
        // Which backend's asset ids to read back as the author's own paths. Without
        // it a pull leaves every image pointing at a backend route.
        backend: client.origin,
        prune,
        keepAuthoredFoundation,
        // So a query's `@acme/member` comes back as the author's `@/member`.
        scope: pullScope,
        dataModel
      })
      wrote.push(...report.pages, ...report.sections, ...report.layout)
      removed.push(
        ...(report.deleted || []),
        ...(report.renamed || []).map((r) => r.from)
      )
      pages += report.pages.length
      sections += report.sections.length
      deleted += report.deleted.length
    }

    if (folderTaken) {
      const { folderDoc, recordDocs } = folderTaken
      pulledRecordDocs = recordDocs
      const report = recordsToProject({
        folderDoc,
        recordDocs,
        siteRoot: projDir,
        opts: {
          // Whose record map to read and extend.
          backend: client.origin,
          resolveDeclaration: (name) => declByModel.get(name) || null,
          // The scope a model's `@/x` was qualified with, so `@acme/article` is placed
          // back in `records/article/` — see `pullScope`.
          scope: pullScope
        }
      })
      // ⭐ THE FOLDER'S PLACEMENT IDENTITY, from the folder this pull took — as a push banks
      // it from the folder it sent. ⛔ Only a push banked it until 2026-09-25, so a copy that
      // had never pushed (every clone) sent its first folder with its placements uuid-less,
      // and the backend refused that push (`identity_required`, section `contents`) —
      // measured on a template clone's first edit.
      if (folderDoc) writeFolderItemUuids(projDir, client.origin, collectFolderItemUuids(folderDoc))
      // The folder's organization, `folder.yml` in the records directory — named as
      // the author would write it (`records/folder.yml`, or under `paths.records`).
      if (report.records === 'updated') {
        info(`Wrote ${report.recordsFile}`)
        wrote.push(resolve(projDir, report.recordsFile))
      } else if (report.records === 'removed') {
        // The backend's folder has no sub-folders, and the file holds nothing else.
        info(`Removed ${report.recordsFile} — the folder has no sub-folders`)
        removed.push(resolve(projDir, report.recordsFile))
      }
      records += report.placed.length + report.updated.length
      // ⭐ A FILE RECORD'S BYTES (`@uniweb/file`, 2026-09-28): fetched to where `folder.yml` now
      // places each one, as media are fetched. A file that did not arrive is a record not taken —
      // reported, and the pull fails below as it does for any, so the next one fetches it again.
      if (report.fileDownloads?.length) {
        const got = await downloadFileRecords({
          downloads: report.fileDownloads,
          siteDir: projDir,
          origin: client.origin,
          onProgress: (m) => note(`  ${m}`),
          warn: (m) => note(`! ${m}`)
        })
        records += got.downloaded.length
        wrote.push(...got.downloaded)
        if (got.failed.length) {
          report.skipped.push(
            ...got.failed.map((path) => ({ slug: relative(projDir, path), reason: 'its file could not be fetched' }))
          )
        }
      }
      // ⛔ A PULL THAT DID NOT PLACE A RECORD HAS NOT TAKEN THE BACKEND'S RECORDS.
      // Until 2026-09-23 each skip was a dim note, the pull said "✓ Pulled … 0
      // record(s)" and exited 0, and it banked the lane's ETag and tokens. So the next
      // pull would hear 304 and never retry, and a `refresh && push` would go on to
      // push — and a push sends the folder whole (`utils/records-guard.js`), so the
      // skipped records would leave it. It is an error now, the lane is not recorded
      // as taken (below), and the exit is non-zero (the end).
      if (report.skipped.length) {
        recordsNotPlaced = describeUnplacedRecords({
          docs: folderLane.docs,
          taken: report.placed.length + report.updated.length + report.unchanged.length,
          skipped: report.skipped
        })
        error(recordsNotPlaced.headline)
        for (const line of recordsNotPlaced.lines) note(`  ${line}`)
      }
      for (const w of report.warnings) note(`! ${w}`)
    }

    // Outside git: what this pull wrote, so the next one can tell its own output from the
    // author's work. Config files are rewritten every pull whether or not they changed;
    // include the ones the projector owns so a pull-then-pull doesn't trip on them either.
    if (!repo) {
      recordWritten(
        siteDir,
        [
          ...wrote,
          // The records folder's `folder.yml` is in `wrote` when this pull wrote it.
          ...['site.yml', 'theme.yml', 'head.html', 'queries.yml'].map((f) =>
            join(siteDir, f)
          )
        ],
        removed
      )
    }

    // ⛔ RE-BANK THE SEND-ONLY-CHANGED HASHES OVER WHAT THE BACKEND HOLDS.
    //
    // The projection is canonical, not byte-identical to what was on disk: it moves
    // section ordering out of filename prefixes (`1-hero.md` → `hero.md` plus an
    // explicit `sections:` list) and stamps each section's `id`. Lossless, and a
    // different document — which is exactly why the `local` unit base is cleared above.
    //
    // ⚠️ That same reasoning was never carried to the hashes, so they were left STALE
    // rather than unknown, and `uniweb status` reported unpushed content immediately
    // after a pull, permanently. Measured on matinee 2026-08-29: push → pull reported
    // 1 changed of 8, with nothing edited in between.
    //
    // ⭐ Over the backend's content — the stand-in's, in a repository — never over local
    // work merged into it: a hash banked for an edit says it is already pushed.
    //
    // Best-effort: a failure here costs an unnecessary re-send on the next push, never
    // wrong content, and must not fail a pull whose content is already taken.
    if (projected) {
      try {
        await rebankSyncHashes(projDir, client.origin, {
          recordDocs: pulledRecordDocs,
          ...(declarations.size ? { declarations } : {}),
          fields
        })
      } catch (err) {
        note(`! could not re-bank the sync cache: ${err.message}`)
        note('  The next push will re-send content that is already current.')
      }
    }

    // ── In a repository: commit the backend's content, and merge it ──────────
    if (standIn) {
      const syncFile = join(siteDir, 'sync.json')
      const cacheFile = join(siteDir, '.uniweb', 'backend-cache.json')
      const before = { sync: bytesOf(syncFile), cache: bytesOf(cacheFile) }
      // What this copy keeps, taken back from the stand-in: the identity the backend minted
      // (`sync.json`, before the merge, so a merge's stash carries it) and its caches.
      const syncNow = bytesOf(join(projDir, 'sync.json'))
      if (syncNow && !(before.sync && syncNow.equals(before.sync))) writeFileSync(syncFile, syncNow)
      const cacheNow = bytesOf(join(projDir, '.uniweb', 'backend-cache.json'))
      if (cacheNow) {
        mkdirSync(dirname(cacheFile), { recursive: true })
        writeFileSync(cacheFile, cacheNow)
      }
      // ⭐ A history with no sync point gets one even when nothing differs, so the next pull
      // has a base; so does `--force`.
      const made = standIn.commit({
        parent: base,
        subject: pulledFrom(client.origin),
        origin: client.origin,
        siteUuid: siteContentUuid,
        always: force || !base
      })
      // The commit that holds the backend's content as the files would — the base itself when
      // they hold the same.
      merge.theirs = made.commit || base
      if (!made.commit) {
        // The backend holds what the base holds: nothing to merge.
        writeSyncPoint(siteDir, client.origin, base)
      } else {
        // The files as they are, to tell what the pull changes in them from what they held.
        const files = snapshotFiles(repo)
        const result = force
          ? takeSyncPoint(repo, made.commit, { roots, message: takenFrom(client.origin) })
          : mergeSyncPoint(repo, made.commit, { message: mergedFrom(client.origin) })
        if (!result.ok) {
          // ⛔ A merge that could not be made took nothing: the files are as they were, and
          // nothing of this pull is recorded as taken.
          notTaken = true
          restore(syncFile, before.sync)
          restore(cacheFile, before.cache)
          if (result.reason === 'untracked') {
            error(`Not merged — the backend's content would overwrite ${result.paths.length} file(s) that are not committed:`)
            for (const p of result.paths.slice(0, 12)) note(`  ${p}`)
            if (result.paths.length > 12) note(`  … and ${result.paths.length - 12} more`)
            note('Commit them, or move them aside, then pull again.')
          } else if (result.reason === 'merge-in-progress') {
            error('A merge is in progress here.')
            note('Finish it (`git commit`) or abandon it (`git merge --abort`), then pull.')
          } else if (result.reason === 'unmerged') {
            error(`${result.paths.length} file(s) here are in conflict:`)
            for (const p of result.paths.slice(0, 12)) note(`  ${p}`)
            note('Settle them first — `git status` says how — then pull.')
          } else {
            error("Could not merge the backend's content:")
            for (const line of String(result.detail).split('\n').slice(0, 8)) note(`  ${line}`)
          }
        } else {
          merge.conflicted = result.conflicted || []
          merge.stashKept = Boolean(result.stashKept)
          // Whether anything was set aside for the merge: the files as they were, against HEAD.
          merge.setAside = files !== repo.head
          merge.noBase = !force && !base
          merge.changed = changedInFiles(repo, {
            from: repo.head,
            files,
            staged: merge.conflicted.length > 0 && !merge.stashKept,
            skip: merge.conflicted
          })
          writeSyncPoint(siteDir, client.origin, made.commit)
        }
      }
      // ⭐ What this pull wrote where the repository ignores it travels in no commit — media
      // in a folder kept out of git — so it is placed where the files lack it, once the
      // content is taken. Never over a file they have.
      if (!notTaken) {
        const placed = standIn.placeIgnored()
        if (placed.length) {
          note(`Placed ${placed.length} file(s) the repository ignores, which no commit carries:`)
          for (const p of placed.slice(0, 12)) note(`  ${p}`)
          if (placed.length > 12) note(`  … and ${placed.length - 12} more`)
        }
      }
      standIn.close()
      standIn = null
    }
  } finally {
    standIn?.close()
  }

  // ⛔ THE TOKENS AND ETAGS SAY "THIS COPY HOLDS THE BACKEND'S VERSION" — so they are
  // banked only once the content is taken: written, merged, or in conflict for a person to
  // settle. In a repository they describe the sync point recorded above, and a push uses
  // them only while HEAD holds it (`untakenBase`, backend/site-sync.js). Measured
  // 2026-09-23, both, when they were banked for content a merge did not take: a push that
  // quietly put back a heading another writer had replaced, and pulls answered 304 forever.
  if (!notTaken) {
    for (const lane of [content, folderLane]) {
      if (!lane || lane.notModified || lane.refused) continue
      // Records this pull did not place were not taken, so neither is their lane.
      if (lane === folderLane && recordsNotPlaced) continue
      mergeBaseVersions(siteDir, client.origin, lane.versions)
    }
    // ⭐ The site-content items' versions REPLACE what this copy held: a pull is how it
    // sees the site, and a version kept for an item the site no longer has would be sent
    // again, asking the backend to delete it. The folder lane's are not kept — that lane
    // is gated by its entity version. (Both were merged into one map until 2026-10-07.)
    if (pulledVersions && content && !content.notModified && !content.refused) {
      writeItemBaseVersions(siteDir, client.origin, pulledVersions)
    }
    // Persist the ETags so the next pull is conditional (304 when unchanged). The
    // folder's is DROPPED when records were not placed, so the next pull fetches
    // them again rather than hearing 304 about a state it never took.
    writePullCache(siteDir, {
      content: etagContent,
      folder: recordsNotPlaced ? null : etagFolder
    })
  }
  if (recordsNotPlaced) {
    note('Records not recorded as taken — the next pull fetches them again.')
  }

  const summary =
    `Pulled — ${pages} page(s), ${sections} section(s), ${records} record(s)` +
    (deleted ? `, ${deleted} deleted` : '')
  if (notTaken || recordsNotPlaced) info(summary)
  else success(summary)
  if (repo && !notTaken) {
    // ⭐ What the pull changed in the files — not the backend's content against the base,
    // which also lists what the files already held (`changedInFiles`).
    if (projected && merge.changed.length) {
      info(
        force
          ? `Took ${client.origin}'s version of ${merge.changed.length} file(s):`
          : `Merged ${merge.changed.length} change(s) from ${client.origin}:`
      )
      const label = { A: 'added', M: 'changed', D: 'removed', R: 'renamed' }
      for (const [s, p] of merge.changed.slice(0, 12)) note(`  ${label[s] || s} ${p}`)
      if (merge.changed.length > 12) note(`  … and ${merge.changed.length - 12} more`)
      if (force) note('What they held is in the commit before this one (`git diff HEAD^1 HEAD`), unless it was never committed.')
    } else if (!merge.conflicted.length) {
      // ⛔ Nothing changed in the files is not the files holding what the backend has: what
      // this copy changed since the base, the backend lacks. Until 2026-10-18 it said they
      // held it either way — measured over a revert the backend did not have yet.
      const ahead = merge.theirs ? filesDifferFrom(repo, merge.theirs, roots) : []
      if (!ahead.length) note(`Your files already hold what ${client.origin} has.`)
      else {
        note(`Nothing new from ${client.origin}. ${ahead.length} file(s) here hold changes it does not have yet — \`uniweb push\` sends them:`)
        for (const p of ahead.slice(0, 12)) note(`  ${p}`)
        if (ahead.length > 12) note(`  … and ${ahead.length - 12} more`)
      }
    }
    if (merge.conflicted.length) {
      error(`${merge.conflicted.length} file(s) have conflicts to resolve:`)
      for (const f of merge.conflicted) note(`  ${f}`)
      if (merge.stashKept) {
        // The merge is made; what clashed is the uncommitted work put back over it.
        note('Your uncommitted changes there overlap what the pull brought.')
        note('Settle the markers and `git add` each file, then `git stash drop` — git kept those changes in the stash as well.')
      } else {
        if (merge.noBase) {
          note(`No commit in this history is one ${client.origin}'s content came from, so nothing tells`)
          note("your changes from the backend's: each file where they differ is a conflict, yours against the backend's.")
          note('Once this merge is committed, later pulls merge from it.')
        }
        note(
          `Settle them and \`git add\` each, then \`git commit\` to finish the merge${merge.setAside ? ' — your uncommitted changes come back with it' : ''}.`
        )
      }
    }
  }
  // Unresolved conflicts are a non-zero exit, the way a conflicted `git merge` is.
  // The pull itself worked; there is work left for a human. This is what makes a
  // chained `uniweb pull && uniweb push` safe by construction — without it, the
  // obvious one-liner pushes conflict markers into live content.
  // Records it could not place are the same: the pull ran, and what it was sent is not
  // all in the files — a chained push must not go on as if it were. And a merge that
  // could not be made took nothing.
  return {
    exitCode: merge.conflicted.length || recordsNotPlaced || notTaken ? 1 : 0,
    merge
  }
}
