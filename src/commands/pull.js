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
 * Pull is a CHECKOUT, not a merge — the "git-pull-like" it used to claim here was
 * misleading. It reconciles the working tree to the backend: section bodies are
 * rewritten from the fetched document, and pages/sections the backend no longer has
 * are DELETED (toggle off with `--no-delete`). The deletion is guarded so an
 * empty/partial payload never wipes the tree.
 *
 * Because it overwrites rather than merges, it REFUSES when there is uncommitted
 * work under the directories it owns — that was the one remaining way the CLI could
 * destroy a user's work without them agreeing to it. Commit or stash first, or pass
 * `--force`. Outside a git repository there is nothing to fall back on, so it asks
 * instead (and refuses when it cannot).
 *
 * `--merge` is the third option, and usually the one you want after a refused push:
 * three-way merge local work with what the backend sends, instead of choosing
 * between them. Most "conflicts" are two people editing different paragraphs of one
 * section, which merges silently; only genuine overlaps get conflict markers. The
 * common ancestor is the version the last pull wrote, found in the repo's history —
 * the backend keeps no per-version history and does not need to — so `--merge`
 * requires a repo, and the merge itself is `git merge-file`.
 *
 * `uniweb login && uniweb pull`. Run from a site, or a workspace with one site.
 *
 * Usage:
 *   uniweb pull                          GET both lanes, project to files, prune orphans
 *   uniweb pull --no-records         Pull pages only; skip the folder (records) lane
 *   uniweb pull --no-delete              Project, but keep files with no backend item
 *   uniweb pull --merge                  Three-way merge local changes with the backend's
 *   uniweb pull --force                  Pull over uncommitted local changes (discards them)
 *   uniweb pull --dry-run                Report what it would GET; write nothing
 *
 * The content + folder pull lanes are both keyed by the site's uuid on that backend
 *   (sync.json).
 * Backend: the one you are logged in to — UNIWEB_REGISTER_URL overrides it for a script
 *   (resolveBackendOrigin). Auth: UNIWEB_TOKEN  >  the stored session  >  `uniweb login`.
 *   No `--backend` or `--token`: switching and signing in are `uniweb login`.
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
  mkdtempSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { join, dirname, relative, resolve } from 'node:path'
import yaml from 'js-yaml'
import { downloadMissingAssets } from '../backend/asset-download.js'
import {
  readBackendState,
  siteContentDocumentToProject,
  recordsToProject,
  siteSelfScope,
  readZip,
  computeUnitHashes,
  collectUnitUuids,
  collectQueryUuids
} from '@uniweb/build/uwx'
import {
  readWritten,
  recordWritten,
  isPullOutput
} from '../utils/pull-written.js'
import {
  makeModelResolver,
  rebankSyncHashes,
  writeQueryUuids,
  mergeBaseVersions,
  mergeItemBaseVersions,
  writeUnitBases,
  writeItemUuids
} from '../backend/site-sync.js'
import { resolveWorkspace } from '../backend/workspace.js'
import {
  uncommittedUnder,
  siteContentRoots,
  showAtHead,
  findCommitted,
  mergeFile
} from '../utils/git.js'
import { isNonInteractive } from '../utils/interactive.js'
import {
  BackendClient,
  describeRequestError,
  refusalDetail,
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
const log = console.log
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
// ⛔ VERSION 2 DISOWNS EVERY ETAG A VERSION-1 PULL WROTE. Before 2026-09-23 a
// `--merge` that kept a local file whole — every one, in the default layout (see
// `showAt`) — still cached the ETag of content it never took. Every later pull then
// answered 304 and the file never caught up. Ignoring those once costs one full pull.
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
  if (payload.$model || payload.$id || payload.info) return payload
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
    folderDoc: docs.find((d) => d.$model === FOLDER_MODEL) || null,
    recordDocs: docs.filter((d) => d.$model !== FOLDER_MODEL)
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
/**
 * Refuse a pull that would overwrite unsaved work. Returns a result object to
 * return from `pull`, or null to proceed.
 *
 * With a repo: uncommitted work under pull's roots blocks, naming the files.
 * Without one: there is nothing standing behind the tree, so ask — and in a
 * non-interactive context refuse rather than assume consent.
 */
async function checkWorkingTree(siteDir, args) {
  const roots = siteContentRoots(siteDir)
  let dirty = uncommittedUnder(siteDir, roots)

  if (dirty === null) {
    // Not a git work tree. Nothing to fall back on if this goes wrong.
    if (isNonInteractive(args)) {
      error('Refusing to pull: this site is not in a git repository.')
      note(
        'Pull rewrites pages, sections and layout from the backend and deletes what it no longer has.'
      )
      note(
        'Without version control there is no way back, and this session cannot ask.'
      )
      note(
        'Re-run with --force to accept that, or put the site under git first.'
      )
      return { exitCode: 1 }
    }
    const ok = await confirm(
      `Pull will overwrite ${roots.length} content location(s) and this site is not in git. Continue?`
    )
    if (!ok) {
      info('Nothing pulled.')
      return { exitCode: 0 }
    }
    return null
  }

  const written = readWritten(siteDir)
  dirty = dirty.filter((f) => !isPullOutput(siteDir, f, written))
  if (!dirty.length) return null

  error(
    `Refusing to pull: ${dirty.length} uncommitted change(s) under the files pull rewrites.`
  )
  for (const f of dirty.slice(0, 12)) note(`  ${f}`)
  if (dirty.length > 12) note(`  … and ${dirty.length - 12} more`)
  note(
    'Pull reconciles the working tree to the backend, so these would be overwritten or deleted.'
  )
  note(
    'Commit or stash them first — then pull, and your work is still in git either way.'
  )
  note('To discard them and take the backend version, re-run with --force.')
  return { exitCode: 1 }
}

// The written-record helpers live in `utils/pull-written.js` so `clone` can share
// them: clone scaffolds site.yml/theme.yml and then delegates here, and this
// module cannot be imported from there — it statically imports `@uniweb/build`,
// which resolves from a project that does not exist yet when clone runs.

/**
 * `--merge`: keep local work instead of refusing, by three-way merging it with what
 * the backend sends.
 *
 * Without this the recovery from a same-section conflict is commit → pull (which
 * overwrites your version) → re-apply by hand → push. Yet most such "conflicts"
 * aren't: two people edited different paragraphs of one section, and a real merge
 * takes both. Only genuine overlaps need a human.
 *
 * Works by capturing local content BEFORE the projection overwrites it, then
 * merging afterwards — so the projector stays a plain writer and needs no hook, and
 * nothing is lost in between because "mine" is already in memory.
 *
 * Requires a repo, and that is not a mandate creeping in: the ancestor is a
 * committed version, and the merge is git's. There is nothing to merge against
 * without one.
 *
 * ⭐ THE ANCESTOR IS THE VERSION THE LAST PULL WROTE — found in history by the hash
 * the pull recorded (`findCommitted`), HEAD's only for a file no pull ever wrote.
 * HEAD stops being that version the moment someone commits an edit on top of it,
 * and a merge against it read their edit as the starting point: the backend's
 * version won whole, reverting the committed edit (measured 2026-09-23 — commit,
 * push refused, `uniweb refresh`, the edit gone from the working tree). The same
 * reason brings in work that is COMMITTED but was never pushed: clean to git, so a
 * dirty scan cannot see it, yet the projection would overwrite it.
 *
 * @returns {Map<string, {content: Buffer, base: Buffer|null}>|null} captured work,
 *   or null when merging isn't possible here (the caller reports and stops).
 */
function captureLocalWork(siteDir) {
  const dirty = uncommittedUnder(siteDir, siteContentRoots(siteDir))
  if (dirty === null) return null
  const written = readWritten(siteDir)
  const ancestorOf = (rel) => {
    const recorded = written.files[rel]
    return (recorded && findCommitted(siteDir, rel, recorded)) || showAtHead(siteDir, rel)
  }
  const out = new Map()
  for (const rel of dirty) {
    if (isPullOutput(siteDir, rel, written)) continue // pull's own output, not work
    try {
      out.set(rel, { content: readFileSync(join(siteDir, rel)), base: ancestorOf(rel) })
    } catch {
      // Locally deleted. Pull will restore the backend's copy, which is the
      // sensible reading of "I removed this and then asked for their version".
    }
  }
  // Committed work: a file a pull wrote, edited and committed since. Its ancestor is
  // only ever the version the pull wrote — HEAD is the edit itself — and when that is
  // not in history there is none, which the merge treats as such.
  for (const [rel, recorded] of Object.entries(written.files)) {
    if (out.has(rel) || dirty.includes(rel)) continue
    let content
    try {
      content = readFileSync(join(siteDir, rel))
    } catch {
      continue
    }
    if (createHash('sha256').update(content).digest('hex') === recorded) continue // untouched
    out.set(rel, { content, base: findCommitted(siteDir, rel, recorded) })
  }
  return out
}

// Merge captured work back over what the projection just wrote. Returns a report;
// `unavailable` lists files whose merge could not run at all — they did NOT take the
// backend's version, so the caller must not record this pull as taken.
function mergeLocalWork(siteDir, captured) {
  const clean = []
  const conflicted = []
  const kept = []
  const unavailable = []
  for (const [rel, { content: mine, base }] of captured) {
    const abs = join(siteDir, rel)
    let theirs = null
    try {
      theirs = readFileSync(abs)
    } catch {
      /* pruned by the pull */
    }

    if (theirs === null) {
      // The backend no longer has it, but we changed it. Restoring is the
      // non-destructive reading; the alternative silently discards local work to
      // honour a deletion the user never saw.
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, mine)
      kept.push(`${rel} (removed upstream, kept yours)`)
      continue
    }
    if (theirs.equals(mine)) continue // both sides agree already

    // ⛔ NO ANCESTOR IS A TWO-WAY MERGE, NOT "KEEP OURS". Both sides hold the file and
    // no common version is on record — added on both sides, or a pull's version that
    // was never committed. Keeping ours hid the backend's version entirely, and the
    // pull then recorded it as taken. An empty ancestor is git's add/add: both
    // versions, under conflict markers, for a person to settle.
    const dir = mkdtempSync(join(tmpdir(), 'uniweb-merge-'))
    try {
      const basePath = join(dir, 'base')
      const theirsPath = join(dir, 'theirs')
      writeFileSync(basePath, base || '')
      writeFileSync(theirsPath, theirs)
      writeFileSync(abs, mine) // merge-file rewrites this in place
      const r = mergeFile(siteDir, abs, basePath, theirsPath)
      if (!r.merged) {
        writeFileSync(abs, mine) // merge couldn't run — never leave a half-state
        kept.push(`${rel} (merge unavailable, kept yours)`)
        unavailable.push(rel)
      } else if (r.conflicted) {
        conflicted.push(rel)
      } else {
        clean.push(rel)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return { clean, conflicted, kept, unavailable }
}

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

export async function pull(args = [], deps = {}) {
  // See utils/flag-guard.js — an unrecognized flag is invisible to a
  // literal scan, so it silently keeps the default (production, for --backend).
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
  const mergeMode = args.includes('--merge')

  const siteDir = await resolveSiteDir(args, 'pull')
  const fetchAssets = shouldFetchAssets(args, siteDir)

  // Don't overwrite work that isn't saved anywhere. Pull reconciles the working
  // tree to the backend — it rewrites section bodies from the fetched document and
  // prunes what the backend doesn't have — so uncommitted work under the
  // directories it owns is destroyed with no way back. That is the one place the
  // CLI could still lose a user's work without them agreeing to it.
  //
  // Checked coarsely, by root, on purpose: pull rewrites essentially every file
  // under those roots, so an exact per-file intersection would refuse the same
  // cases while being able to miss one.
  // `--merge` keeps local work instead of refusing it: capture what is dirty now,
  // let the projection write the backend's version, then merge ours back over it.
  let captured = null
  let mergeReport = null
  if (!dryRun && mergeMode) {
    captured = captureLocalWork(siteDir)
    if (captured === null) {
      error('Cannot merge: this site is not in a git repository.')
      note(
        'The common ancestor a merge needs is the committed version of each file.'
      )
      note(
        'Without a repo there is nothing to merge against — use `uniweb pull --force` to take the backend version.'
      )
      return { exitCode: 1 }
    }
  } else if (!dryRun && !force) {
    const blocked = await checkWorkingTree(siteDir, args)
    if (blocked) return blocked
  }
  // ⭐ THE BACKEND YOU ARE LOGGED IN TO is where this goes *[Diego, 2026-09-21]*, for every
  // backend verb (resolveBackendOrigin). Only UNIWEB_REGISTER_URL — the automation
  // override — outranks it, and nothing talks to a backend the user is not logged in to:
  // logged in nowhere, the origin is the default backend and the first request asks for
  // that login. ⛔ There is no `--backend` here: switching is `uniweb login --backend`.
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
    // second site. Not when UNIWEB_REGISTER_URL chose the backend: that is a decision.
    const known = !process.env.UNIWEB_REGISTER_URL
      ? syncedElsewhere(siteDir, client.origin)
      : null
    if (known) {
      info(`Nothing to pull — this project has no site on ${client.origin}.`)
      note(
        `Its ${known.length === 1 ? `site is on ${known[0]}` : `sites are on ${known.join(', ')}`}. To pull from there: uniweb login --backend <url>`
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
      note('Is that the backend you meant? Switch with: uniweb login --backend <url>')
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
          "Credentials weren't accepted — log in again (`uniweb login --backend <url>`), or check UNIWEB_TOKEN."
        )
      return null
    }
    try {
      const etag = res.headers?.get?.('etag') ?? null
      const buf = Buffer.from(await res.arrayBuffer())
      const docs = readPullDocuments(buf)
      // The staleness tokens this lane carried, so the next push is gated against
      // the state we took. Banked by the caller once local work is merged back — a
      // file the merge did not take must not have its token recorded as taken. A 304
      // carries none, correctly: the tokens we hold are still current.
      return {
        docs,
        etag,
        versions: readPullVersions(buf),
        itemVersions: readPullItemVersions(buf)
      }
    } catch (err) {
      error(`Could not read the ${label} response: ${err.message}`)
      return null
    }
  }

  // Every file the projection writes, so the next pull can tell its own output
  // apart from the user's work (see readWritten).
  const wrote = []
  const removed = []
  let pages = 0
  let sections = 0
  let records = 0
  let deleted = 0

  // Conditional-pull cache: the last ETag seen per lane (opaque token — cached and
  // echoed verbatim, never recomputed). Lives in the gitignored `.uniweb/`.
  const cache = readPullCache(siteDir)
  let etagContent = cache.content
  let etagFolder = cache.folder

  // ⭐ THE SCOPE THE PULLED RECORDS AND QUERIES WERE QUALIFIED WITH — the pushed site's
  // FOUNDATION's: the scope of the pinned ref it carries (`info.foundation`), else the
  // local foundation's name. A push qualifies `@/x` with it, so this is what undoes it,
  // and a record lands back in `records/article/` rather than `records/acme/article/`.
  // Resolved once, up front — it may load main.js — and handed to the synchronous
  // projections, as Models are. ⛔ It was the site owner's org, from sync.json, until
  // 2026-09-22; a foundation may be registered under any org its author belongs to.
  let pullScope
  const scopeFor = async (doc) => {
    if (pullScope === undefined) {
      const pinned = doc?.info?.foundation
      pullScope = await siteSelfScope(siteDir, pinned !== undefined ? { foundation: pinned } : {})
    }
    return pullScope
  }

  // ⛔ `--force` IS UNCONDITIONAL. It means "take the backend's version over mine", and
  // an ETag answers a different question — whether the BACKEND moved, never whether
  // the files still hold what it sent. Echoed here, a `git checkout` followed by
  // `pull --force` got a 304 and left the checked-out files in place (2026-09-23).
  const conditional = !force
  // Lane 1 — content → config + pages/** + layout/**. The .uwx carries a single
  // entity (the site-content document). A 304 (unchanged) leaves local files as-is.
  const content = await getDocs('content', () =>
    client.pullSiteContent(siteContentUuid, { etag: conditional ? etagContent : undefined })
  )
  if (content?.refused) return { exitCode: 1 }
  if (content && !content.notModified) {
    const siteDoc =
      content.docs &&
      (content.docs.find((d) => d?.info || d?.$model) ||
        content.docs[0] ||
        null)
    if (siteDoc) {
      // Re-base the page attribution. The pulled document IS the backend's own
      // representation, so it becomes the remote base directly. We deliberately
      // CLEAR the local base rather than reuse it: our source files were just
      // rewritten from this document, and what we would emit from them is not
      // byte-identical to it, so the old local base no longer describes anything.
      // The next push re-establishes it; until then our side reports as unknown,
      // which is honest rather than wrong.
      writeUnitBases(siteDir, client.origin, { remote: computeUnitHashes(siteDoc), local: {} })
      // Per-item identity for the next push. Without it the backend reads our
      // records as new and re-mints every page and section row.
      writeItemUuids(siteDir, client.origin, collectUnitUuids(siteDoc))
      // The collections section's identity has no file to live in either — same
      // reason, same remedy, keyed by name. A pull is the other route by which a
      // copy can recover it (see readQueryUuids).
      writeQueryUuids(siteDir, client.origin, collectQueryUuids(siteDoc))
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
          siteDir,
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

      // ⛔ Do NOT overwrite a workspace project's `site.yml::foundation`.
      //
      // Same principle as restoring authored asset paths above, and the same
      // failure it prevents: a round trip must not mangle what the author wrote.
      // `publish` stamps the RELEASED, version-pinned ref into `info.foundation`
      // (delivery is version-pinned end to end), so projecting the stored value
      // back turns `foundation: src` into `@org/x@1.2.3` — which the build then
      // REFUSES to resolve, leaving the project unable to `build`, `dev` or
      // `export`. It stays publishable throughout, so nothing surfaces it.
      //
      // ⚖️ Only suppressed when the AUTHORED value resolves to a local foundation.
      // A project from `uniweb clone` has no local foundation on disk, and there
      // the pinned ref is exactly what site.yml should say — so this is a
      // question about which project shape we are writing into, not a blanket
      // "never project it".
      //
      // Lazily imported: the resolver lives behind `@uniweb/build`'s root, which
      // pulls the vite chain, and this file deliberately imports only the `uwx`
      // leaf. Reused rather than reimplemented so "which foundation" cannot drift
      // from what the build itself resolves.
      let keepAuthoredFoundation = false
      try {
        const { resolveLocalFoundation } = await import(
          '../backend/foundation-bring-along.js'
        )
        const authored = yaml.load(
          readFileSync(join(siteDir, 'site.yml'), 'utf8')
        )
        keepAuthoredFoundation = Boolean(
          resolveLocalFoundation(siteDir, authored)
        )
      } catch {
        // No site.yml, unreadable, or nothing local — project the stored value,
        // which is the pre-existing behaviour and right for a fresh clone.
      }

      const report = siteContentDocumentToProject({
        document: siteDoc,
        siteRoot: siteDir,
        // Which backend's asset ids to read back as the author's own paths. Without
        // it a pull leaves every image pointing at a backend route.
        backend: client.origin,
        prune,
        keepAuthoredFoundation,
        // So a query's `@acme/member` comes back as the author's `@/member`.
        scope: await scopeFor(siteDoc)
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
    if (content.etag) etagContent = content.etag
  }

  // Lane 2 — folder → the folder + record files, keyed by the SAME site-content uuid
  // (the backend resolves the site's `@uniweb/folder` from it; the framework never
  // holds a folder uuid). Models are resolved by name (async) up front, so
  // recordsToProject keeps its synchronous contract. A 304 leaves files as-is.
  let folderLane = null
  if (!noRecords) {
    const folder = await getDocs('records', () =>
      client.pullFolder(siteContentUuid, { etag: conditional ? etagFolder : undefined })
    )
    folderLane = folder
    if (folder?.refused) return { exitCode: 1 }
    if (folder && !folder.notModified && folder.docs?.length) {
      const { folderDoc, recordDocs } = splitRecordsPull(folder.docs)
      const resolveModel = makeModelResolver({ client })
      const declByModel = new Map()
      for (const model of [
        ...new Set(recordDocs.map((d) => d.$model).filter(Boolean))
      ]) {
        try {
          declByModel.set(model, await resolveModel(model))
        } catch (err) {
          note(`! could not resolve model ${model}: ${err.message}`)
        }
      }
      // ⛔ NO QUERY CONFIG. A record's home is decided by what it IS — its
      // `$model` names the pool folder — not by any query that happens to select
      // it. Handed the foundation's scope (`scopeFor`), `recordsToProject` places a
      // `@/x` model the producer resolved to `@acme/x` back where the author wrote it.
      const report = recordsToProject({
        folderDoc,
        recordDocs,
        siteRoot: siteDir,
        opts: {
          // Whose record map to read and extend.
          backend: client.origin,
          resolveDeclaration: (name) => declByModel.get(name) || null,
          // The scope a model's `@/x` was qualified with, so `@acme/article` is placed
          // back in `records/article/` — see `scopeFor`.
          scope: await scopeFor(null)
        }
      })
      // The folder's organization, `folder.yml` in the records directory — named as
      // the author would write it (`records/folder.yml`, or under `paths.records`).
      if (report.records === 'updated') {
        info(`Wrote ${report.recordsFile}`)
        wrote.push(resolve(siteDir, report.recordsFile))
      } else if (report.records === 'removed') {
        // The backend's folder has no sub-folders, and the file holds nothing else.
        info(`Removed ${report.recordsFile} — the folder has no sub-folders`)
        removed.push(resolve(siteDir, report.recordsFile))
      }
      records += report.placed.length + report.updated.length
      for (const s of report.skipped)
        note(`↷ ${s.slug ?? s.uuid ?? '(record)'}: ${s.reason}`)
      for (const w of report.warnings) note(`! ${w}`)
    }
    if (folder?.etag) etagFolder = folder.etag
  }

  // ⛔ WHAT THIS PULL WROTE, AND THE HASHES A PUSH DIFFS AGAINST, DESCRIBE THE
  // BACKEND'S CONTENT — so both are taken over the projection, BEFORE local work is
  // merged back. Taken after it, as they were until 2026-09-23, they recorded the
  // merged-in local edits as pull output and as already pushed: the next push said
  // "Nothing to push", `status` said in sync, and the edit never left this machine —
  // while a later plain pull would have overwritten it as its own output.
  //
  // Config files are rewritten every pull whether or not they changed; include the
  // ones the projector owns so a pull-then-pull doesn't trip on them either.
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

  // ⛔ RE-BANK THE SEND-ONLY-CHANGED HASHES OVER WHAT WE JUST WROTE.
  //
  // The projection above is canonical, not byte-identical to what was on disk: it
  // moves section ordering out of filename prefixes (`1-hero.md` → `hero.md` plus an
  // explicit `sections:` list) and stamps each section's `id`. Lossless, and a
  // different document — which is exactly why the `local` unit base is cleared above.
  //
  // ⚠️ That same reasoning was never carried to the hashes, so they were left STALE
  // rather than unknown, and `uniweb status` reported unpushed content immediately
  // after a pull, permanently. Measured on matinee 2026-08-29: push → pull reported
  // 1 changed of 8, with nothing edited in between.
  //
  // Re-banking rather than clearing, because after a pull the on-disk state IS the
  // agreed state — it came from the backend, so a push with no edits should send
  // nothing. Clearing would make it send everything.
  //
  // Best-effort: a failure here costs an unnecessary re-send on the next push, never
  // wrong content, and must not fail a pull whose files are already written.
  if (!dryRun) {
    try {
      await rebankSyncHashes(siteDir, client.origin)
    } catch (err) {
      note(`! could not re-bank the sync cache: ${err.message}`)
      note('  The next push will re-send content that is already current.')
    }
  }

  // Merge captured local work back over what the projection just wrote. Runs after
  // BOTH lanes, so a file either lane produced is merged the same way.
  if (captured && captured.size) {
    mergeReport = mergeLocalWork(siteDir, captured)
    const r = mergeReport
    if (r.clean.length) {
      info(`Merged your changes into ${r.clean.length} file(s):`)
      for (const f of r.clean) note(`  ${f}`)
    }
    for (const f of r.kept) note(`\u21b7 ${f}`)
    if (r.conflicted.length) {
      error(`${r.conflicted.length} file(s) have conflicts to resolve:`)
      for (const f of r.conflicted) note(`  ${f}`)
      note('Conflict markers are in place. Resolve them, then commit and push.')
    }
  }

  // ⛔ THE TOKENS AND ETAGS SAY "THIS COPY HOLDS THE BACKEND'S VERSION" — so they are
  // banked only once every file has taken it, merged or in conflict. A token banked
  // for a file that kept ours makes the next push of it read as "only you changed it"
  // and overwrite the backend's version; an ETag banked for it makes every later pull
  // answer 304, so the file never catches up. Measured 2026-09-23, both: a refused
  // push, `uniweb refresh`, and a push that quietly put back a heading another writer
  // had replaced. When a merge could not run, nothing of this pull is recorded as
  // taken, and the next pull fetches it again.
  const unavailable = mergeReport?.unavailable || []
  if (unavailable.length) {
    note("! Not recorded as taken — a merge could not run, so those files keep yours.")
    note('  Pushing them is refused until a pull merges them; fix git, then `uniweb pull --merge` again.')
  } else {
    for (const lane of [content, folderLane]) {
      if (!lane || lane.notModified || lane.refused) continue
      mergeBaseVersions(siteDir, client.origin, lane.versions)
      mergeItemBaseVersions(siteDir, client.origin, lane.itemVersions)
    }
    // Persist the ETags so the next pull is conditional (304 when unchanged).
    writePullCache(siteDir, { content: etagContent, folder: etagFolder })
  }

  success(
    `Pulled — ${pages} page(s), ${sections} section(s), ${records} record(s)` +
      (deleted ? `, ${deleted} deleted` : '')
  )
  // Unresolved conflicts are a non-zero exit, the way a conflicted `git merge` is.
  // The pull itself worked; there is work left for a human. This is what makes a
  // chained `uniweb pull --merge && uniweb push` safe by construction — without it,
  // the obvious one-liner pushes conflict markers into live content.
  const conflicts = mergeReport?.conflicted?.length ?? 0
  return { exitCode: conflicts ? 1 : 0, merge: mergeReport }
}
