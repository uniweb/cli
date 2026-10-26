/**
 * uniweb status — what to know before working on a site, and what to run about it.
 *
 * ⭐ THE ONE QUESTION AN AGENT ASKS IN A PROJECT OTHERS EDIT. Authors change a synced site in
 * the app at any time, teammates push to git, and Uniweb releases often — and nothing else
 * in the CLI says so before a command is refused. So status checks each of them, and ends
 * with the steps to take, in an order that works when followed from the top
 * (`utils/status-next.js`):
 *
 *   git      conflicts, a merge waiting, the site's content and the project's other files
 *            not committed, the git remote
 *   app      the session, the site, what changed on the backend since this copy last
 *            synced, what is not pushed, whether the draft is live, who has the site open,
 *            the foundation
 *   uniweb   a newer release
 *   health   doctor's findings
 *   dev      the dev server
 *
 * ⛔ READ-ONLY, AND IT NEVER PROMPTS. It signs nobody in — with no session it says how — and
 * writes nothing a later command reads as taken: no ETag, version, hash or sync point
 * (`probePull`, `backend/app-changes.js`). It writes the user-level npm cache `update` and
 * `--version` keep, and — for a foundation named by catalog ref — the registered version's
 * section types a pull keeps, which never change. A check it could not make is `unknown`,
 * never `ok`.
 *
 * ⛔ THE GUARDS ARE THE VERBS' OWN. Where status says a push would be refused, it says so
 * from the function the push calls (`unsettledFiles`, `uncommittedContent`, `untakenBase`),
 * so the two cannot drift.
 *
 * ⭐ AN UPDATE IS NOT AN ALARM [Diego, 2026-10-26]: "most 'breaking' changes don't break a
 * project, so we don't want to worry agents unnecessarily." A newer release is named with
 * the one way to take it, the same for every release; none is called breaking.
 *
 * Usage:
 *   uniweb status              every check
 *   uniweb status --offline    only what this machine knows — no request at all
 *   uniweb status --json       one JSON document (`schema: 1`)
 *   --org @x / --personal      the workspace to ask the backend in, for this command only
 *
 * ⛔ Until 2026-10-26 a bare status was offline, `--remote` asked the backend, and `--json`
 * was `{ synced, uuid, foundation, changed, unchanged, remote }`. `--remote` is refused now
 * (`utils/flag-guard.js`).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import yaml from 'js-yaml'

import {
  probeUnpushed,
  readItemUuids,
  readSiteWorkspace,
  sentRoots,
  uncommittedContent,
  unitFilesOf,
  unsettledFiles,
  untakenBase
} from '../backend/site-sync.js'
import { describeWorkspace, resolveWorkspace, SOURCE_LABEL } from '../backend/workspace.js'
import { BackendClient, resolveBackendOrigin } from '../backend/client.js'
import { readAppChanges } from '../backend/app-changes.js'
import { probePull } from './pull.js'
import { readOrgFlag } from '../utils/args.js'
import { listSyncedBackends, readBackendState } from '@uniweb/build/uwx'
import { resolveLocalFoundation, foundationScopedName } from '../backend/foundation-bring-along.js'
import { computeFoundationDigest } from '../utils/code-upload.js'
import { compareSemverPrecedence } from '../utils/semver-precedence.js'
import { checkFlags } from '../utils/flag-guard.js'
import { isExpired, readRegistryAuth } from '../utils/registry-auth.js'
import {
  filesDifferFrom,
  ignoringRepo,
  isAncestor,
  mergeInProgress,
  readSyncPoint,
  repoOf,
  unmergedPaths
} from '../utils/sync-point.js'
import { aheadBehind, remoteMoved, upstreamOf } from '../utils/git.js'
import { getLatestVersion, isBehind } from '../utils/update-check.js'
import { syncedElsewhere } from '../utils/site-identity.js'
import { DEFAULT_BACKEND_ORIGIN } from '../utils/config.js'
import { classifyPackage, findSites, findWorkspaceRoot, isWorkspaceRoot } from '../utils/workspace.js'
import { getCliVersion } from '../versions.js'
import { planNext } from '../utils/status-next.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m'
}

/** What the document's version says: a reader keyed on it never reads another shape. */
export const STATUS_SCHEMA = 1

// What an item that this copy has not synced is called — by its Section on the site.
const ITEM_KIND = { pages: 'a page', page_sections: 'a section', layout_sections: 'a layout section' }

/**
 * Who has the site open in the app right now, and on what — the status's `editors`
 * (backend, since 2026-10-13), as lines a developer can follow up on. Each tab's item is
 * named by the file it is in this copy, and by its kind and route when this copy has not
 * synced it (`fileByItemUuid`).
 *
 * ⛔ Two ways not to read it. `changed_at` is the item's last change by ANYONE — this
 * author, another, a push — so it says when the item last changed, never what this
 * person did. And it is presence, not a lock: nothing refuses or warns a push over it.
 *
 * @param {object[]} editors - `[{ person: { uuid, handle, brief }, tabs: [{ page, item }] }]`
 * @param {object} [opts]
 * @param {(uuid: string) => string|null} [opts.fileOf] - an item's file in this copy
 * @param {number} [opts.now] - for "3 min ago"
 * @returns {{ person: string, tabs: string[] }[]} a tab with nothing open is left out
 */
export function describeEditors(editors, { fileOf = () => null, now = Date.now() } = {}) {
  return editors.map((editor) => ({
    person: personLabel(editor?.person),
    tabs: (editor?.tabs || []).map((tab) => tabLabel(tab, fileOf, now)).filter(Boolean)
  }))
}

function personLabel(person) {
  const name = person?.brief?.display_name
  const handle = person?.handle ? `@${person.handle}` : null
  if (name && handle) return `${name} (${handle})`
  return name || handle || `someone (${person?.uuid || 'unnamed'})`
}

function tabLabel(tab, fileOf, now) {
  const item = tab?.item
  if (!item?.uuid) return null
  const route = tab.page?.route || null
  const file = fileOf(item.uuid)
  const what = file
    ? `${file}${route ? ` (${route})` : ''}`
    : `${ITEM_KIND[item.section] || 'an item'} not in this copy${route ? ` (${route})` : ''}`
  const when = sinceLabel(item.changed_at, now)
  return when ? `${what} · changed ${when}` : what
}

function sinceLabel(iso, now) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const min = Math.floor(Math.max(0, now - t) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/**
 * An item's file in this copy, from its uuid: `sync.json` keeps each unit's uuid on
 * `backend` by its path (`items`, banked from every push and pull), and `unitFilesOf`
 * finds the file the author keeps it in (`1-hero.md` for `hero.md`). Null for an item
 * this copy has not synced — one added in the app since its last pull.
 */
export function fileByItemUuid(siteDir, backend) {
  const unitOf = new Map(
    Object.entries(readItemUuids(siteDir, backend)).map(([unit, uuid]) => [String(uuid).toLowerCase(), unit])
  )
  return (uuid) => {
    const unit = unitOf.get(String(uuid).toLowerCase())
    return unit ? (unitFilesOf(siteDir, unit)[0] ?? unit) : null
  }
}

// ─── reading the project ────────────────────────────────────────────────────

function readSiteYml(siteDir) {
  const p = join(siteDir, 'site.yml')
  if (!existsSync(p)) return {}
  try {
    return yaml.load(readFileSync(p, 'utf8')) || {}
  } catch {
    return {}
  }
}

/**
 * The site this status is about — never asked for: a status prompts for nothing. A site
 * folder is its own; a workspace with one site, that one; with several, none, and the
 * caller names them.
 */
async function findSite(cwd) {
  if ((await classifyPackage(cwd)) === 'site') return { siteDir: cwd }
  const root = findWorkspaceRoot(cwd)
  if (!root) return { none: true }
  const sites = await findSites(root)
  if (sites.length === 1) return { siteDir: resolve(root, sites[0]) }
  return sites.length ? { several: sites, root } : { none: true, root }
}

/**
 * The `uniweb` this project runs: the copy installed in it, else the version its
 * `package.json` names, else this CLI's own.
 */
function projectUniweb(siteDir) {
  const root = findWorkspaceRoot(siteDir) || siteDir
  try {
    const v = JSON.parse(readFileSync(join(root, 'node_modules', 'uniweb', 'package.json'), 'utf8')).version
    if (typeof v === 'string') return v
  } catch {
    // not installed
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const spec = pkg.devDependencies?.uniweb || pkg.dependencies?.uniweb
    const m = typeof spec === 'string' ? spec.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/) : null
    if (m) return m[0]
  } catch {
    // no package.json
  }
  return getCliVersion()
}

function foundationRef(siteYml) {
  const f = siteYml.foundation
  if (!f) return null
  return typeof f === 'string' ? f : f.ref || null
}

// A versioned registry ref `@org/name@1.2.3` → its scoped name and pinned version.
function splitFoundationRef(fnd) {
  if (!fnd || fnd[0] !== '@') return { scope: null, version: null }
  const at = fnd.lastIndexOf('@')
  return at > 0 ? { scope: fnd.slice(0, at), version: fnd.slice(at + 1) } : { scope: null, version: null }
}

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ─── the checks ─────────────────────────────────────────────────────────────

/**
 * The project's files that git holds changes to and that are not the site's content — a
 * dependency update, the foundation's source, `deploy.yml`, `AGENTS.md` — relative to the
 * site, as every file list here is. The project is the workspace the site is in, or the site
 * without one; a folder in it that is a workspace of its own is a project of its own.
 *
 * ⭐ A PUSH SENDS ONLY THE CONTENT, SO NOTHING STOPS FOR THESE. A teammate builds what git
 * holds, and a push or publish releases a changed foundation from the files as they are: left
 * uncommitted, an update or a foundation change is in this copy only, and in a release no
 * commit holds. ⛔ Until 2026-10-26 status said "Nothing to do" over an `uniweb update` it
 * had not seen committed.
 *
 * @returns {string[]|null} null when git could not be asked
 */
function otherUncommitted(siteDir, repo) {
  const root = findWorkspaceRoot(siteDir) || siteDir
  // Only the repository's part of it: a workspace above the repository's top is read from there.
  const scope = relative(repo.top, root).startsWith('..') ? repo.top : root
  let out
  try {
    out = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=normal', '--', scope], {
      cwd: repo.top,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024
    })
  } catch {
    return null
  }
  const parts = out.split('\0').filter(Boolean)
  const paths = []
  for (let i = 0; i < parts.length; i++) {
    paths.push(parts[i].slice(3))
    if (/[RC]/.test(parts[i].slice(0, 2))) paths.push(parts[++i]) // a rename's source follows it
  }
  const content = sentRoots(siteDir).map((r) => join(siteDir, r))
  const isContent = (abs) => content.some((r) => abs === r || abs.startsWith(r + sep))
  const isDir = (p) => {
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  }
  // A folder from the file up to the project's root that is a workspace of its own.
  const inOwnProject = (abs) => {
    for (let d = isDir(abs) ? abs : dirname(abs); d !== scope && d.startsWith(scope + sep); d = dirname(d)) {
      if (isWorkspaceRoot(d)) return true
    }
    return false
  }
  return [...new Set(paths)]
    .map((p) => join(repo.top, p.replace(/\/$/, '')))
    .filter((abs) => !isContent(abs) && !inOwnProject(abs))
    .map((abs) => relative(siteDir, abs) || '.')
}

/**
 * Git: conflicts, a merge waiting, what is not committed, and the git remote.
 * @returns {Promise<{ checks: object[], proposals: object[], localFiles: string[]|null }>}
 */
async function gitChecks(siteDir, { offline, origin }) {
  const checks = []
  const proposals = []
  const repo = repoOf(siteDir)
  if (!repo) {
    const ignored = Boolean(ignoringRepo(siteDir))
    checks.push({
      id: 'git.repo',
      state: 'skipped',
      summary: ignored
        ? 'The git repository around this folder ignores it, so a pull here takes the backend\'s version over your files, asking first.'
        : 'Not a git repository, so a pull here takes the backend\'s version over your files, asking first.'
    })
    return { checks, proposals, localFiles: null, repo: false }
  }
  checks.push({ id: 'git.repo', state: 'ok', summary: `In the git repository at ${repo.top}.`, quiet: true })

  if (unsettledFiles(siteDir)) {
    const files = unmergedPaths(repo).filter((p) => !repo.prefix || p.startsWith(repo.prefix))
    checks.push({
      id: 'git.conflicts',
      state: 'blocking',
      summary: `${count(files.length, 'file')} here ${files.length === 1 ? 'is' : 'are'} in conflict.`,
      files,
      blocks: ['push', 'publish', 'pull', 'refresh']
    })
    proposals.push({ step: 'conflicts', command: null, why: `settle the conflict markers in ${count(files.length, 'file')}, then \`git add\` each` })
  } else {
    checks.push({ id: 'git.conflicts', state: 'ok', summary: 'Nothing in conflict.', quiet: true })
  }

  const merging = mergeInProgress(repo)
  checks.push(
    merging
      ? { id: 'git.merge', state: 'blocking', summary: 'A merge is waiting for its commit.', blocks: ['push', 'publish', 'pull', 'refresh'] }
      : { id: 'git.merge', state: 'ok', summary: 'No merge in progress.', quiet: true }
  )
  if (merging) proposals.push({ step: 'merge', command: 'git commit', why: 'finish the merge in progress' })

  const uncommitted = merging ? null : uncommittedContent(siteDir, { verb: 'push' })
  const n = uncommitted?.paths.length || 0
  checks.push(
    uncommitted
      ? {
          id: 'git.uncommitted',
          state: 'attention',
          summary: repo.head
            ? `${n} of the site's files ${n === 1 ? 'is' : 'are'} not committed — in git a push sends what is committed.`
            : 'This repository has no commit yet — in git a push sends what is committed.',
          files: uncommitted.paths,
          blocks: ['push', 'publish']
        }
      : { id: 'git.uncommitted', state: 'ok', summary: "The site's content is committed." }
  )

  // What else in the project is not committed — a merge holds it until its commit, and a
  // repository with no commit yet has said so above.
  const others = merging || !repo.head ? null : otherUncommitted(siteDir, repo)
  if (others?.length) {
    const n = others.length
    const fnd = resolveLocalFoundation(siteDir, readSiteYml(siteDir))
    const ofFoundation = fnd && others.some((f) => {
      const abs = resolve(siteDir, f)
      return abs === fnd.dir || abs.startsWith(fnd.dir + sep)
    })
    checks.push({
      id: 'git.other',
      state: 'attention',
      summary: `${count(n, 'other file')} here ${n === 1 ? 'is' : 'are'} not committed — a push sends only the site's content, and your team builds what git holds.`,
      files: others,
      lines: ofFoundation ? ["The foundation's files are among them: when a push or publish releases it, it is built from these files as they are, so commit them first."] : []
    })
    proposals.push({ step: 'commit', command: null, why: `commit the ${count(n, 'other file')} here: \`git add\` ${n === 1 ? 'it' : 'them'}, then \`git commit -m "<what changed>"\``, ask: true })
  } else if (others) {
    checks.push({ id: 'git.other', state: 'ok', summary: 'Nothing else here is uncommitted.', quiet: true })
  }

  // What this copy changed since its last sync, file by file — while its branch holds the
  // sync point that sync recorded.
  let localFiles = null
  const point = readSyncPoint(siteDir, origin)
  if (repo.head && point && isAncestor(repo, point)) localFiles = filesDifferFrom(repo, point, sentRoots(siteDir))

  const upstream = upstreamOf(siteDir)
  if (!upstream) {
    checks.push({ id: 'git.remote', state: 'skipped', summary: 'No upstream branch to compare with.' })
  } else {
    const counts = aheadBehind(siteDir) || { ahead: 0, behind: 0 }
    let moved = null
    let asked = false
    if (offline) {
      moved = counts.behind > 0
    } else {
      const answer = await remoteMoved(siteDir)
      if (answer) {
        moved = answer.moved
        asked = true
      }
    }
    const parts = []
    if (moved) parts.push(`${upstream.remote} has commits this branch does not${asked ? '' : ' (as of the last fetch)'}.`)
    if (counts.ahead) parts.push(`${count(counts.ahead, 'commit')} here ${counts.ahead === 1 ? 'is' : 'are'} not on ${upstream.tracking}.`)
    if (moved === null) {
      checks.push({
        id: 'git.remote',
        state: 'unknown',
        summary: `Could not ask ${upstream.remote} for new commits — no network, or it needs a sign-in.`,
        lines: parts,
        detail: { ...counts, upstream: upstream.tracking }
      })
    } else {
      checks.push({
        id: 'git.remote',
        state: parts.length ? 'attention' : 'ok',
        summary: parts.length ? parts.join(' ') : `Up to date with ${upstream.tracking}${asked ? '' : ' (as of the last fetch)'}.`,
        detail: { ...counts, upstream: upstream.tracking }
      })
    }
    if (moved) proposals.push({ step: 'refresh', command: 'npx uniweb refresh', why: "take your teammates' commits" })
    if (counts.ahead) proposals.push({ step: 'gitpush', command: 'git push', why: `share ${count(counts.ahead, 'commit')} with your team`, ask: true })
  }
  return { checks, proposals, localFiles, uncommitted: Boolean(uncommitted), merging, repo: Boolean(repo.head) }
}

/**
 * The session for `origin`, read and never asked for: UNIWEB_TOKEN, else the stored one.
 * @returns {Promise<{ token: string, handle: string|null } | { expired: true } | null>}
 */
async function sessionFor(origin) {
  if (process.env.UNIWEB_TOKEN) return { token: process.env.UNIWEB_TOKEN, handle: null }
  const stored = await readRegistryAuth(origin)
  if (!stored?.token) return null
  if (isExpired(stored)) return { expired: true }
  return { token: stored.token, handle: stored.handle || stored.username || null }
}

/**
 * The sign-in an agent runs: on this backend — a bare login goes to the default one — and in
 * the workspace the site was created in, when this copy knows it.
 */
function loginCommand(siteDir, origin, uuid) {
  const server = origin === DEFAULT_BACKEND_ORIGIN ? '' : ` --server ${origin}`
  if (!uuid) return `npx uniweb login --browser${server}`
  const ws = readSiteWorkspace(siteDir, origin)
  return `npx uniweb login --browser${server} ${ws ? `--org ${ws}` : '--personal'}`
}

/** Unit paths → the files the author keeps them in, as a pull writes them back. */
function filesOfUnits(siteDir, units) {
  return units.map((u) => (u === 'site.yml' ? 'site.yml' : unitFilesOf(siteDir, u)[0] ?? u))
}

/**
 * The app: what the backend holds of this site, against this copy.
 * @returns {Promise<{ checks: object[], proposals: object[], backend: object }>}
 */
async function appChecks(siteDir, siteYml, { offline, args, git }) {
  const checks = []
  const proposals = []
  const origin = resolveBackendOrigin()
  const uuid = readBackendState(siteDir, origin).site?.uuid || null
  const backend = { origin, workspace: null }

  // ── What this machine knows ──
  const base = git.merging ? null : untakenBase(siteDir, origin)
  if (base) {
    checks.push({
      id: 'app.base',
      state: 'blocking',
      // ⛔ Not "does not hold what this copy last took" for a copy that took nothing here — a fresh
      // copy, or a project brought from another repository, whose sync points stayed there.
      summary: base.never
        ? 'This copy has not taken the site from the backend yet: a push waits until a pull has merged its content.'
        : base.headline.replace(/^Not pushed — /, '').replace(/^./, (ch) => ch.toUpperCase()),
      blocks: ['push', 'publish']
    })
    proposals.push({ step: 'pull', command: 'npx uniweb pull', why: "merge the backend's content with yours" })
  }

  // What this copy holds that the backend lacks: by file, from the sync point, in git; else
  // the send-only-changed probe a push runs, which counts entities.
  let unpushedFiles = null
  let unpushed = false
  if (!uuid) {
    const elsewhere = process.env.UNIWEB_SERVER ? null : syncedElsewhere(siteDir, origin)
    checks.push(
      elsewhere
        ? {
            id: 'app.site',
            state: 'attention',
            summary: `This project's site is on ${elsewhere.join(', ')}, not on ${origin}, where you are signed in.`,
            lines: [`To work with it there: npx uniweb login --server ${elsewhere[0]}`]
          }
        : { id: 'app.unpushed', state: 'skipped', summary: `Not in the app on ${origin} yet — \`npx uniweb push\` puts it there.` }
    )
  } else if (git.localFiles) {
    unpushedFiles = git.localFiles
    unpushed = unpushedFiles.length > 0
    checks.push(
      unpushed
        ? {
            id: 'app.unpushed',
            state: 'attention',
            summary: `${count(unpushedFiles.length, 'file')} here ${unpushedFiles.length === 1 ? 'holds' : 'hold'} changes the backend does not have yet.`,
            files: unpushedFiles
          }
        : { id: 'app.unpushed', state: 'ok', summary: 'Nothing waiting to be pushed.' }
    )
  } else if (base?.never && git.repo) {
    // ⛔ A copy that took nothing here has no record of what it last sent, so every entity would
    // count as unsent — "holds changes" is a guess, and a push step before the pull it needs.
    checks.push({
      id: 'app.unpushed',
      state: 'unknown',
      summary: "What this copy holds that the backend lacks is known once a pull has merged the site's content here."
    })
  } else {
    try {
      const probe = await probeUnpushed(siteDir, { backend: origin })
      unpushed = probe.changed > 0
      checks.push({
        id: 'app.unpushed',
        state: unpushed ? 'attention' : 'ok',
        summary: unpushed ? 'This copy holds changes the backend does not have yet.' : 'Nothing waiting to be pushed.',
        detail: { entities: probe.changed, unchanged: probe.unchanged }
      })
    } catch (err) {
      checks.push({ id: 'app.unpushed', state: 'unknown', summary: `Could not tell what is not pushed: ${err.message}` })
    }
  }
  if (uuid && (unpushed || git.uncommitted)) {
    proposals.push({
      step: 'push',
      command: git.uncommitted ? 'npx uniweb push --commit -m "<what you changed>"' : 'npx uniweb push',
      why: git.uncommitted ? 'commit your changes and send them to the app' : 'send your changes to the app'
    })
  }

  if (offline) {
    checks.push({ id: 'app.session', state: 'skipped', summary: 'The backend was not asked (--offline).' })
    return { checks, proposals, backend }
  }

  // ── What the backend says ──
  const session = await sessionFor(origin)
  if (!session || session.expired) {
    if (!uuid) {
      checks.push({ id: 'app.session', state: 'skipped', summary: `Not signed in to ${origin} — needed to bring the site into the app.` })
    } else {
      checks.push({
        id: 'app.session',
        state: 'unknown',
        summary: session?.expired
          ? `The session on ${origin} has expired, so nothing there was checked.`
          : `Not signed in to ${origin}, so nothing there was checked.`
      })
      proposals.push({ step: 'login', command: loginCommand(siteDir, origin, uuid), why: `sign in, so the backend can be checked` })
    }
    return { checks, proposals, backend }
  }

  const client = new BackendClient({ token: session.token, args, command: 'Status' })
  const ws = await resolveWorkspace({ client, args }).catch((err) => ({ refused: true, reason: err.message }))
  if (ws.refused) {
    checks.push({
      id: 'app.session',
      state: 'blocking',
      summary: `Signed in to ${origin}, with no workspace chosen.`,
      lines: String(ws.reason || '').split('\n').map((l) => l.trim()).filter(Boolean),
      blocks: ['push', 'publish', 'pull']
    })
    proposals.push({
      step: 'login',
      command: uuid && readSiteWorkspace(siteDir, origin) ? `npx uniweb login --org ${readSiteWorkspace(siteDir, origin)}` : null,
      why: 'choose the workspace to work in — the person decides which',
      ask: true
    })
    return { checks, proposals, backend }
  }
  client.setWorkspace(ws.workspace, { source: ws.source })
  backend.workspace = ws.workspace
  checks.push({
    id: 'app.session',
    state: 'ok',
    summary: `Signed in to ${origin}${session.handle ? ` as @${String(session.handle).replace(/^@/, '')}` : ''}, working in ${describeWorkspace(ws.workspace)} (${SOURCE_LABEL[ws.source] || ws.source}).`
  })

  // ⭐ WHAT CHANGED ON THE BACKEND, AS A PULL WOULD TAKE IT. In a repository, the pull itself,
  // stopped before it takes anything (`probePull`): the files it would change, translations
  // and records included — with no sync point in this history, the files that differ, which way
  // unknown (`noBaseChanges`). Outside git, the backend's units against this copy's last sync
  // (`backend/app-changes.js`).
  const readChanges = async () => {
    if (git.repo) {
      const org = readOrgFlag(args)
      const probed = await probePull([...(org ? ['--org', org] : []), ...(args.includes('--personal') ? ['--personal'] : [])], {
        resolveSiteDir: async () => siteDir,
        getToken: async () => session.token
      })
      if (probed) return { probe: probed }
    }
    return readAppChanges({ client, siteDir, siteUuid: uuid })
  }
  const [state, changes, foundation] = await Promise.all([
    uuid ? client.siteState(uuid) : null,
    uuid ? readChanges().catch((err) => ({ error: err })) : null,
    foundationCheck(siteDir, siteYml, client).catch(() => null)
  ])

  if (state) {
    // ⭐ `site_state` is the backend's word on this site — `live`, `gone` or `unknown` —
    // for a script that decides on it: `gone` only when the backend says it holds no such
    // site, never for a failure to reach it (`client.siteState`).
    const detail = { site_state: state.state }
    if (state.status === 401) {
      checks.push({ id: 'app.site', state: 'unknown', summary: `${origin} did not accept the session — sign in again.`, detail })
      proposals.push({ step: 'login', command: loginCommand(siteDir, origin, uuid), why: 'sign in again' })
    } else if (state.state === 'gone') {
      checks.push({
        id: 'app.site',
        state: 'blocking',
        summary: `${origin} has no site ${uuid} — it was deleted there, or the backend was rebuilt.`,
        lines: [`To push this as a new site: npx uniweb forget --server ${origin}, then npx uniweb push.`],
        blocks: ['push', 'publish', 'pull'],
        detail
      })
    } else if (state.state === 'live' && state.status === 409) {
      checks.push({
        id: 'app.site',
        state: 'blocking',
        summary: 'The site is kept in another workspace.',
        lines: state.detail ? [state.detail] : [],
        blocks: ['push', 'publish', 'pull'],
        detail: { ...detail, workspace: state.workspace ?? null }
      })
      if (state.workspace) proposals.push({ step: 'login', command: `npx uniweb login --org ${state.workspace}`, why: `work in ${state.workspace}, where the site is`, ask: true })
    } else if (state.state === 'live') {
      checks.push({ id: 'app.site', state: 'ok', summary: `The site is in the app on ${origin}.`, quiet: true, detail })
    } else {
      checks.push({ id: 'app.site', state: 'unknown', summary: `Could not tell whether ${origin} holds this site${state.detail ? ` (${state.detail})` : ''}.`, detail })
    }
  }

  // A site kept in another workspace refuses every read of it from this one.
  const elsewhere = state?.state === 'live' && state.status === 409
  if (changes) checks.push(...changeChecks(siteDir, changes, unpushedFiles, proposals, { elsewhere }))

  const site = state?.site
  if (site) {
    // ⭐ WHERE THE SITE IS LIVE IS THE BACKEND'S TO SAY, never deploy.yml's: a receipt is
    // what this copy published, and a publish from the app or another copy does not move it.
    // ⛔ `last_published_url` outlives an unpublish (`client.siteStatus`), so it is said as
    // where the site WAS live when it is not live now — never as where it is.
    const url = typeof site.last_published_url === 'string' && site.last_published_url ? site.last_published_url : null
    const when = site.last_published_at ? sinceLabel(site.last_published_at, Date.now()) : null
    const at = `${url ? ` at ${url}` : ''}${when ? `, published ${when}` : ''}`
    const detail = {
      published: Boolean(site.published),
      url,
      published_at: site.last_published_at ?? null,
      draft_dirty: Boolean(site.draft_dirty),
      foundation: site.last_published_foundation ?? null,
      runtime: site.last_published_runtime ?? null
    }
    if (!site.published) {
      checks.push({
        id: 'app.live',
        state: 'attention',
        summary: `On ${cloudName(origin)}, not live yet.`,
        lines: url ? [`It was live at ${url} before.`] : [],
        detail
      })
      proposals.push({ step: 'publish', command: 'npx uniweb publish', why: 'take the site live — the person decides, and it may ask for payment', ask: true })
    } else if (site.draft_dirty) {
      checks.push({ id: 'app.live', state: 'attention', summary: `Live on ${cloudName(origin)}${at} — the app holds changes that are not live yet.`, detail })
      proposals.push({ step: 'publish', command: 'npx uniweb publish', why: 'make those changes live — the person decides', ask: true })
    } else {
      checks.push({ id: 'app.live', state: 'ok', summary: `Live on ${cloudName(origin)}${at}, with the latest content.`, detail })
    }
    // An array is the backend's answer, `[]` included; no key is a backend that does not
    // say, and then neither do we.
    if (Array.isArray(site.editors)) {
      const people = describeEditors(site.editors, { fileOf: fileByItemUuid(siteDir, origin) })
      // One person is named once, in the summary; several, on each of their tabs.
      const who = (p) => (people.length === 1 ? '' : `${p.person}: `)
      checks.push(
        people.length
          ? {
              id: 'app.editors',
              state: 'attention',
              summary: `Open in the app now: ${people.map((p) => p.person).join(', ')}.`,
              lines: people.flatMap((p) => (p.tabs.length ? p.tabs.map((t) => `${who(p)}${t}`) : [`${who(p)}nothing open`])),
              detail: { editors: site.editors }
            }
          : { id: 'app.editors', state: 'ok', summary: 'Nobody has the site open in the app.', detail: { editors: [] } }
      )
    }
  }
  if (foundation) checks.push(foundation)
  return { checks, proposals, backend, site: site ?? null }
}

/** The name a backend's hosting goes by: Uniweb Cloud on the default backend, its origin elsewhere. */
const cloudName = (origin) => (origin === DEFAULT_BACKEND_ORIGIN ? 'Uniweb Cloud' : origin)

const CHANGE = { A: 'added', M: 'changed', D: 'removed' }

/** `app.changes`: what moved on the backend, and where it meets what moved here. */
function changeChecks(siteDir, changes, unpushedFiles, proposals, { elsewhere = false } = {}) {
  // ⭐ A REFUSAL IS SAID ONCE. `app.site` says where the site is kept and how to work there;
  // the reads here are refused for that reason. ⛔ Until 2026-10-26 this repeated the refusal.
  const unread = { id: 'app.changes', state: 'unknown', summary: 'Could not tell what changed on the backend while the site is kept in another workspace.' }
  if (changes.error) {
    if (elsewhere) return [unread]
    return [{ id: 'app.changes', state: 'unknown', summary: `Could not read the site from the backend: ${changes.error.message}` }]
  }
  if (changes.probe) return probedChanges(changes.probe, unpushedFiles, proposals)
  const { content, records } = changes
  const unknown = [content, records].filter((l) => l.state === 'unknown')
  const files = [
    ...filesOfUnits(siteDir, [...content.changed, ...content.removed]),
    ...content.added.map((u) => `${u} (new)`)
  ]
  const lines = []
  if (content.outsideUnits) lines.push("the site's settings — its services, languages or queries")
  if (records.changed.length) lines.push(`records changed: ${records.changed.join(', ')}`)
  if (records.added.length) lines.push(`records added: ${records.added.join(', ')}`)
  if (records.removed) lines.push(`${count(records.removed, 'record')} removed`)
  if (records.folder) lines.push('the records\' sub-folders (folder.yml)')
  const moved = files.length + lines.length
  if (!moved) {
    if (unknown.length && elsewhere) return [unread]
    // Each reason without its own full stop: the sentence ends once.
    const reasons = [...new Set(unknown.map((l) => String(l.detail).replace(/\.+$/, '')))]
    return [
      unknown.length
        ? { id: 'app.changes', state: 'unknown', summary: `Could not tell what changed on the backend: ${reasons.join('; ')}.` }
        : { id: 'app.changes', state: 'ok', summary: 'Nothing changed on the backend since this copy last synced.', detail: { source: 'units' } }
    ]
  }
  // Where the backend's changes meet this copy's: a push of those is refused until a pull
  // merges them — `diffSiteUnits`' "changed on both sides".
  const overlap = unpushedFiles?.length ? files.filter((f) => unpushedFiles.includes(f)) : []
  const n = files.length + content.outsideUnits + records.changed.length + records.added.length + records.removed + records.folder
  proposals.push({ step: 'pull', command: 'npx uniweb pull', why: `take the ${count(n, 'change')} made on the backend` })
  return [
    {
      id: 'app.changes',
      state: overlap.length ? 'blocking' : 'attention',
      summary:
        `${count(n, 'change')} on the backend since this copy last synced — in the app, or pushed from another copy.` +
        (overlap.length ? ` You changed ${count(overlap.length, 'of those files', 'of those files')} here too.` : ''),
      files,
      lines,
      ...(overlap.length ? { blocks: ['push', 'publish'] } : {}),
      detail: {
        source: 'units',
        content: { state: content.state, changed: content.changed, added: content.added, removed: content.removed, outsideUnits: content.outsideUnits },
        records: { state: records.state, changed: records.changed, added: records.added, removed: records.removed, folder: records.folder },
        ...(overlap.length ? { overlap } : {}),
        ...(unknown.length ? { unknown: unknown.map((l) => l.detail) } : {})
      }
    }
  ]
}

/**
 * `app.changes` from the pull's own answer (`probePull`): the files it would change, each
 * as the pull would write it.
 */
function probedChanges({ files: list, recordsNotPlaced, noBase }, unpushedFiles, proposals) {
  if (noBase) return noBaseChanges(list, recordsNotPlaced)
  if (!list.length) {
    return [{ id: 'app.changes', state: 'ok', summary: 'Nothing changed on the backend since this copy last synced.', detail: { source: 'pull', files: [] } }]
  }
  const paths = list.map(([, p]) => p)
  const files = list.map(([s, p]) => (s === 'A' ? `${p} (new)` : s === 'D' ? `${p} (removed)` : p))
  // Where the backend's changes meet this copy's: the pull merges them, and a push of those
  // before it is refused.
  const overlap = unpushedFiles?.length ? paths.filter((p) => unpushedFiles.includes(p)) : []
  const n = list.length
  proposals.push({ step: 'pull', command: 'npx uniweb pull', why: `take the ${count(n, 'file')} changed on the backend` })
  return [
    {
      id: 'app.changes',
      state: overlap.length ? 'blocking' : 'attention',
      summary:
        `${count(n, 'file')} changed on the backend since this copy last synced — in the app, or pushed from another copy.` +
        (overlap.length ? ` You changed ${count(overlap.length, 'of those files', 'of those files')} here too.` : ''),
      files,
      lines: recordsNotPlaced ? ['Some records could not be placed in files — `npx uniweb pull` says which, and why.'] : [],
      ...(overlap.length ? { blocks: ['push', 'publish'] } : {}),
      detail: {
        source: 'pull',
        files: list.map(([s, p]) => ({ path: p, change: CHANGE[s] || s })),
        ...(overlap.length ? { overlap } : {})
      }
    }
  ]
}

/**
 * `app.changes` for a copy whose history shares no commit with the site's content — a project
 * brought into another repository, whose sync points stayed in the old one. What differs is
 * said, which way unknown: the first pull makes each such file a conflict, yours against the
 * backend's, and records where the two meet; one that says what the backend holds, written
 * another way, it leaves alone, and it is not listed (`keepWhatMeansTheSame`, `commands/pull.js`).
 * The pull itself is `app.base`'s step.
 */
function noBaseChanges(list, recordsNotPlaced) {
  const differ = list.filter(([s]) => s === 'M').map(([, p]) => p)
  const added = list.filter(([s]) => s === 'A').map(([, p]) => p)
  const lines = []
  if (added.length) lines.push(`${count(added.length, 'file')} only the backend has — the pull adds ${added.length === 1 ? 'it' : 'them'}.`)
  if (recordsNotPlaced) lines.push('Some records could not be placed in files — `npx uniweb pull` says which, and why.')
  return [
    {
      id: 'app.changes',
      state: 'attention',
      summary: differ.length
        ? `This copy shares no history with the site's content on the backend — brought from another repository, most likely. ${count(differ.length, 'file')} here ${differ.length === 1 ? 'says' : 'say'} something else, and the first pull makes ${differ.length === 1 ? 'it a conflict' : 'each a conflict'} to settle, yours against the backend's.`
        : "This copy shares no history with the site's content on the backend, and its files say what the site holds: the first pull records where they meet, with nothing to settle.",
      files: differ,
      lines,
      detail: { source: 'pull', noBase: true, files: list.map(([s, p]) => ({ path: p, change: CHANGE[s] || s })) }
    }
  ]
}

/**
 * `app.foundation`: the local foundation against its registered version — what the next
 * push or publish does with it (`backend/foundation-bring-along.js`).
 */
async function foundationCheck(siteDir, siteYml, client) {
  const fnd = foundationRef(siteYml)
  const { scope: fndScope, version: fndVersion } = splitFoundationRef(fnd)
  const local = resolveLocalFoundation(siteDir, siteYml)
  const name = (local && (await foundationScopedName(local.dir))) || fndScope
  if (!name) return null
  const latest = await client.readFoundationLatest(name)
  if (!latest?.latest_version) return null
  if (local?.dir) {
    const digest = latest.digest ? computeFoundationDigest(join(local.dir, 'dist')) : null
    if (!digest) return null // not built, or the registry keeps no digest: nothing to compare
    if (digest === latest.digest) return { id: 'app.foundation', state: 'ok', summary: 'The foundation matches its registered version.' }
    if (compareSemverPrecedence(local.version, latest.latest_version) === -1) {
      return {
        id: 'app.foundation',
        state: 'blocking',
        summary: `The registry holds foundation ${latest.latest_version}, newer than your ${local.version} — a push or publish stops until you pull that change, or pass --bump to release yours above it.`,
        blocks: ['push', 'publish']
      }
    }
    return { id: 'app.foundation', state: 'attention', summary: "The foundation's code changed since it was registered — the next push or publish releases it as the next version." }
  }
  if (fndVersion && latest.latest_version !== fndVersion) {
    return { id: 'app.foundation', state: 'attention', summary: `A newer version of the foundation (${latest.latest_version}) is registered than the site pins (${fndVersion}).` }
  }
  return { id: 'app.foundation', state: 'ok', summary: `The site pins the latest version of its foundation (${fndVersion}).` }
}

/** `uniweb.version`: a newer Uniweb, named the same way for every release. */
async function versionCheck(siteDir, { offline }) {
  const runs = projectUniweb(siteDir)
  if (offline) return { checks: [{ id: 'uniweb.version', state: 'skipped', summary: `This project runs Uniweb ${runs}; npm was not asked (--offline).` }], proposals: [] }
  const latest = await getLatestVersion({ allowNetwork: true, timeoutMs: 2000, maxAgeMs: 60 * 60 * 1000 })
  if (!latest) return { checks: [{ id: 'uniweb.version', state: 'unknown', summary: `This project runs Uniweb ${runs}; npm did not answer, so a newer release is not known.` }], proposals: [] }
  if (!isBehind(runs, latest)) {
    return { checks: [{ id: 'uniweb.version', state: 'ok', summary: `Uniweb ${runs}, the latest.`, detail: { runs, latest } }], proposals: [] }
  }
  return {
    checks: [{ id: 'uniweb.version', state: 'attention', summary: `Uniweb ${latest} is out; this project runs ${runs}.`, detail: { runs, latest } }],
    proposals: [{ step: 'update', latest: true, command: 'npx uniweb@latest update', why: 'bring the project and its AGENTS.md up to date — then build, and look at the pages' }]
  }
}

// Doctor's findings `uniweb update` answers: the project's dependencies, or its AGENTS.md,
// behind the CLI it runs.
const UPDATE_FINDINGS = new Set(['deps-behind-cli', 'agents-md-missing', 'agents-md-unstamped', 'agents-md-outdated'])

/**
 * `health.doctor`: doctor's findings, read without printing them.
 *
 * ⚠️ doctor measures the project against the CLI that RUNS it. Run by a newer CLI than the
 * project's (`npx uniweb@latest status`), its dependency and AGENTS.md findings are against
 * that newer one — which the project's own `uniweb update` does not know — so the step that
 * answers them is the newer CLI's.
 */
async function doctorCheck(siteDir) {
  try {
    const { doctor } = await import('./doctor.js')
    const res = await doctor([], { quiet: true })
    const open = (res.issues || []).filter((i) => !i.fixed && (i.type === 'error' || i.type === 'warn'))
    if (!open.length) return { checks: [{ id: 'health.doctor', state: 'ok', summary: 'doctor: every check passes.' }], proposals: [] }
    const ids = [...new Set(open.map((i) => i.id).filter(Boolean))]
    const parts = [res.errors && count(res.errors, 'error'), res.warnings && count(res.warnings, 'warning')].filter(Boolean)
    const proposals = []
    if (open.some((i) => UPDATE_FINDINGS.has(i.id))) {
      const newer = isBehind(projectUniweb(siteDir), getCliVersion())
      proposals.push(
        newer
          ? { step: 'update', latest: true, command: 'npx uniweb@latest update', why: 'bring the project and its AGENTS.md up to date — then build, and look at the pages' }
          : { step: 'update', command: 'npx uniweb update', why: "align the dependencies and AGENTS.md with this project's Uniweb" }
      )
    }
    const rest = open.filter((i) => !UPDATE_FINDINGS.has(i.id))
    if (rest.length) proposals.push({ step: 'doctor', command: 'npx uniweb doctor', why: `read its ${count(rest.length, 'finding')} — \`--fix\` repairs what it can` })
    return {
      checks: [
        {
          id: 'health.doctor',
          state: 'attention',
          summary: `doctor: ${parts.join(', ')}${ids.length ? ` (${ids.join(', ')})` : ''}.`,
          detail: { errors: res.errors, warnings: res.warnings, issues: open.map(({ id, type, message }) => ({ id: id ?? null, type, message })) }
        }
      ],
      proposals
    }
  } catch (err) {
    return { checks: [{ id: 'health.doctor', state: 'unknown', summary: `doctor did not finish: ${err.message}` }], proposals: [] }
  }
}

/**
 * `dev.server`: the site's dev server, confirmed by asking it — and the command that starts it
 * for this site. In a workspace with several, a bare `uniweb dev` starts the first one found
 * (`commands/dev.js`), which may not be this one.
 */
async function devCheck(siteDir, { offline, sites = [] }) {
  const root = findWorkspaceRoot(siteDir) || siteDir
  const mine = sites.find((s) => resolve(root, s.path) === resolve(siteDir))
  const first = sites[0]
  const command = sites.length > 1 && mine && first !== mine ? `npx uniweb dev ${mine.name}` : 'npx uniweb dev'
  const note = command === 'npx uniweb dev' ? '' : ` (a bare \`uniweb dev\` starts ${first.name})`
  if (offline) return { id: 'dev.server', state: 'skipped', summary: `The dev server was not asked (--offline); \`${command}\` starts it${note}.`, detail: { command } }
  try {
    const { runningDevServer } = await import('@uniweb/build/site')
    const running = await runningDevServer(siteDir, { timeout: 1000 })
    return running
      ? { id: 'dev.server', state: 'ok', summary: `The dev server is running at ${running.url}.`, detail: { url: running.url, command } }
      : { id: 'dev.server', state: 'skipped', summary: `The dev server is not running — \`${command}\` starts it${note}.`, detail: { command } }
  } catch (err) {
    return { id: 'dev.server', state: 'unknown', summary: `Could not ask the dev server: ${err.message}`, detail: { command } }
  }
}

// ─── the project ────────────────────────────────────────────────────────────

/**
 * The workspace, as its wiring says: the sites and foundations its globs hold, by the build's
 * classifier (`utils/discover.js`), and the globs themselves.
 *
 * ⛔ NO LAYOUT NAME. "Single", "segregated" and the rest are conventions — the globs and the
 * wiring are the truth — and a name guessed from folders is wrong where a workspace mixes them.
 */
async function workspaceFacts(root) {
  const [{ discoverSites, discoverFoundations }, { readWorkspaceConfig }, { isExtensionPackage }] = await Promise.all([
    import('../utils/discover.js'),
    import('../utils/config.js'),
    import('@uniweb/build')
  ])
  const [sites, packages, config] = await Promise.all([
    discoverSites(root),
    discoverFoundations(root),
    readWorkspaceConfig(root).catch(() => ({ packages: [] }))
  ])
  const extension = (f) => {
    try {
      return isExtensionPackage(join(root, f.path))
    } catch {
      return false
    }
  }
  return {
    root,
    patterns: Array.isArray(config.packages) ? config.packages : [],
    sites,
    foundations: packages.filter((f) => !extension(f)),
    extensions: packages.filter(extension)
  }
}

function workspaceLine(ws) {
  const { sites, foundations, extensions, patterns } = ws
  if (sites.length === 1 && foundations.length === 1 && !extensions.length) {
    return `One site and one foundation in this workspace: ${sites[0].path}/ and ${foundations[0].path}/.`
  }
  const parts = [count(sites.length, 'site'), count(foundations.length, 'foundation')]
  if (extensions.length) parts.push(count(extensions.length, 'extension'))
  const from = patterns.length ? `, from ${list(patterns)}` : ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)} in this workspace${from}.`
}

/**
 * A site's foundation, as the build finds it — the one resolver (`detectFoundationType`), so
 * what status names is what the build would build. A catalog ref, which a build refuses, is
 * named as one.
 */
async function foundationOf(siteDir, siteYml, root) {
  const declared = siteYml?.foundation
  if (!declared) return { kind: 'none' }
  const name = typeof declared === 'string' ? declared : declared.ref || declared.name || declared.url || null
  const [{ detectFoundationType }, { parseCatalogRef }] = await Promise.all([import('@uniweb/build'), import('@uniweb/build/uwx')])
  if (parseCatalogRef(name)) return { kind: 'catalog', name, ref: name }
  try {
    const found = detectFoundationType(declared, siteDir)
    if (found.type === 'local') return { kind: 'local', name: found.name, path: relative(root, found.path) || '.', abs: resolve(found.path) }
    return { kind: 'url', name, url: found.url }
  } catch (err) {
    return { kind: 'unresolved', name, error: String(err?.message || err).split('\n')[0] }
  }
}

/** A site's extensions, each where it is found: a folder here, the catalog, or a URL. */
async function extensionsOf(siteDir, siteYml, root) {
  const declared = Array.isArray(siteYml?.extensions) ? siteYml.extensions : []
  if (!declared.length) return []
  const [{ findSiteExtension, extensionNameOf }, { parseCatalogRef }] = await Promise.all([import('@uniweb/build'), import('@uniweb/build/uwx')])
  return declared.map((entry) => {
    const value = entry && typeof entry === 'object' ? entry.url || entry.ref || entry.name : entry
    if (typeof value !== 'string' || !value) return { value: String(value), kind: 'unresolved' }
    if (parseCatalogRef(value)) return { value, kind: 'catalog' }
    if (/^https?:\/\//.test(value)) return { value, kind: 'url' }
    // A site-relative URL names an extension by its first segment; a bare name is that name.
    const name = value.startsWith('/') ? extensionNameOf(value, siteYml.base)?.name : value
    const dir = name ? findSiteExtension(name, siteDir) : null
    return dir ? { value, kind: 'local', name, path: relative(root, dir) || '.' } : { value, kind: 'unresolved', name: name ?? null }
  })
}

/**
 * `project.*`: where this site sits — the workspace's sites and foundations, the foundation it
 * is built with and what else uses it, its extensions, pages it takes from outside its folder,
 * and the languages it is written in. All from files: no request.
 */
async function projectChecks(siteDir, siteYml) {
  const inWorkspace = Boolean(findWorkspaceRoot(siteDir))
  const root = findWorkspaceRoot(siteDir) || siteDir
  const ws = await workspaceFacts(root)
  const checks = []
  checks.push({
    id: 'project.workspace',
    state: 'ok',
    summary: inWorkspace ? workspaceLine(ws) : 'This site is on its own, in no workspace.',
    detail: { patterns: ws.patterns, sites: ws.sites, foundations: ws.foundations, extensions: ws.extensions }
  })

  // ⭐ The foundation, and what a change to it reaches: every site that resolves to the same one.
  const fnd = await foundationOf(siteDir, siteYml, root)
  const here = resolve(siteDir)
  const sharedWith = []
  if (fnd.kind === 'local') {
    for (const s of ws.sites) {
      const dir = resolve(root, s.path)
      if (dir === here) continue
      const other = await foundationOf(dir, readSiteYml(dir), root)
      if (other.kind === 'local' && other.abs === fnd.abs) sharedWith.push(s.path)
    }
  }
  const extensions = await extensionsOf(siteDir, siteYml, root)
  let summary
  let state = 'ok'
  if (fnd.kind === 'local') {
    summary =
      `Foundation ${fnd.name}, in ${fnd.path}/ — its source is here` +
      (sharedWith.length
        ? `, and ${sharedWith.length === 1 ? 'another site uses' : `${sharedWith.length} other sites use`} it too: ${sharedWith.join(', ')} — a change to a section type changes ${sharedWith.length === 1 ? 'it' : 'them'} as well.`
        : ws.sites.length > 1 ? '; no other site here uses it.' : '.')
  } else if (fnd.kind === 'catalog') {
    summary = `Foundation ${fnd.ref}, from the catalog — its source is not in this workspace; work within the section types it offers.`
  } else if (fnd.kind === 'url') {
    summary = `Foundation loaded from ${fnd.url} — its source is not in this workspace; work within the section types it offers.`
  } else if (fnd.kind === 'unresolved') {
    state = 'attention'
    summary = `site.yml names the foundation \`${fnd.name}\`, which does not resolve: ${fnd.error}`
  } else {
    state = 'attention'
    summary = 'site.yml names no foundation.'
  }
  const extensionLines = extensions.map((e) =>
    e.kind === 'local'
      ? `Extension ${e.name}, in ${e.path}/ — its source is here.`
      : e.kind === 'catalog'
        ? `Extension ${e.value}, from the catalog — its source is not in this workspace.`
        : e.kind === 'url'
          ? `Extension loaded from ${e.value} — its source is not in this workspace.`
          : `Extension \`${e.value}\` names ${e.name ? `\`${e.name}\`, which no folder here holds` : 'nothing this site can find'}.`
  )
  if (extensions.some((e) => e.kind === 'unresolved')) state = 'attention'
  checks.push({
    id: 'project.foundation',
    state,
    summary,
    lines: extensionLines,
    detail: {
      kind: fnd.kind,
      name: fnd.name ?? null,
      path: fnd.path ?? null,
      url: fnd.url ?? null,
      editable: fnd.kind === 'local',
      sharedWith,
      extensions: extensions.map(({ value, kind, name, path }) => ({ value, kind, name: name ?? null, path: path ?? null }))
    }
  })

  // ⭐ Pages from outside the site's folder (`paths:` mounts, by the build's own rule): a pull
  // never writes them (`uwx/git-authored.js`), and one in its own repository is edited there.
  const { mountEntriesOf } = await import('@uniweb/build/site')
  const siteRepo = repoOf(siteDir)?.top ?? null
  const mounts = mountEntriesOf(siteYml?.paths).map(([segment, dir]) => {
    const abs = resolve(siteDir, String(dir))
    const exists = existsSync(abs)
    const top = exists ? repoOf(abs)?.top ?? null : null
    const repository = !exists ? null : !top ? 'none' : top === siteRepo ? 'same' : 'other'
    return { segment, dir: String(dir), exists, repository }
  })
  const mountLine = (m) =>
    !m.exists
      ? `pages/${m.segment} names ${m.dir}, which does not exist.`
      : m.repository === 'other'
        ? `pages/${m.segment} comes from ${m.dir}, its own git repository — edits there are commits in it.`
        : `pages/${m.segment} comes from ${m.dir}, outside the site's folder.`
  checks.push(
    mounts.length
      ? {
          id: 'project.mounts',
          state: mounts.some((m) => !m.exists) ? 'attention' : 'ok',
          summary: mounts.length === 1 ? mountLine(mounts[0]) : `${count(mounts.length, 'page folder')} come from outside the site's folder.`,
          lines: [
            ...(mounts.length === 1 ? [] : mounts.map(mountLine)),
            'An edit made in the app to those pages does not come back on a pull, and the next push replaces it with the files.'
          ],
          detail: { mounts }
        }
      : { id: 'project.mounts', state: 'skipped', summary: "All the site's pages are in its own folder.", quiet: true, detail: { mounts: [] } }
  )

  // The languages, by core's own rules: the one the files are written in, and the rest.
  const { normalizeLanguageList, resolveDefaultLocale, isWildcardLanguages } = await import('@uniweb/core/locale-config')
  const source = resolveDefaultLocale(siteYml || {})
  const wildcard = isWildcardLanguages(siteYml?.languages)
  const translations = normalizeLanguageList(siteYml?.languages).filter((code) => code !== source && code !== '*')
  checks.push(
    translations.length || wildcard
      ? {
          id: 'project.languages',
          state: 'ok',
          summary:
            `Written in ${source}, and translated into ${wildcard ? 'every language in locales/' : translations.join(', ')} — ` +
            `a text you change in ${source} needs translating again.`,
          lines: ['After a change: build, then `npx uniweb i18n sync`, and `npx uniweb i18n status` lists what is left.'],
          detail: { source, translations, wildcard }
        }
      : { id: 'project.languages', state: 'ok', summary: `One language: ${source}.`, detail: { source, translations: [], wildcard: false } }
  )
  return { checks, ws }
}

// ─── where the site is hosted ───────────────────────────────────────────────

/** A host adapter's name as people know it (`S3 + CloudFront`), or its id. */
async function hostTitle(host) {
  try {
    const { getAdapter } = await import('@uniweb/build/hosts')
    return getAdapter(host)?.display?.title || host
  } catch {
    return host
  }
}

/**
 * The CI workflow `uniweb add ci` writes for `host`, when it deploys this site: its file,
 * and the branches whose pushes run it. A workspace with several sites deploys one per
 * workflow, which names that site's build output.
 */
function ciWorkflow(repo, host) {
  const rel = `.github/workflows/deploy-${host}.yml`
  let text
  try {
    text = readFileSync(join(repo.top, rel), 'utf8')
  } catch {
    return null
  }
  if (repo.path !== '.' && !text.includes(`${repo.path}/dist`)) return null
  let branches = []
  try {
    const doc = yaml.load(text)
    branches = (doc?.on ?? doc?.[true])?.push?.branches ?? []
  } catch {
    // unreadable: the branches are not known
  }
  return { file: rel, branches: Array.isArray(branches) && branches.length ? branches.map(String) : [] }
}

/** The commits since `sha` that changed the site's files — null when this branch does not hold `sha`. */
function siteCommitsSince(repo, sha, siteDir) {
  try {
    if (!isAncestor(repo, sha)) return null
    const roots = sentRoots(siteDir).map((r) => `${repo.prefix}${r}`)
    const out = execFileSync('git', ['rev-list', '--count', `${sha}..HEAD`, '--', ...roots], {
      cwd: repo.top,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return Number(out.trim())
  } catch {
    return null
  }
}

/**
 * `hosting.deploys`: where else the site is deployed — `deploy.yml`'s targets on hosts that
 * are not a backend — each by CI on every push, or by hand, and how far behind a
 * hand-deployed one is.
 *
 * ⛔ FROM THIS COPY'S FILES ONLY. A host's own state is not asked, and a receipt
 * (`deploys:`) says what this copy deployed — never what another copy, or a CI run, did.
 */
async function deployChecks(siteDir) {
  let deployYml
  try {
    const { loadDeployYml } = await import('@uniweb/build/site')
    deployYml = await loadDeployYml(siteDir)
  } catch (err) {
    return { checks: [{ id: 'hosting.deploys', state: 'unknown', summary: `deploy.yml could not be read: ${err.message}` }], proposals: [], targets: [] }
  }
  const all = deployYml?.targets && typeof deployYml.targets === 'object' ? deployYml.targets : {}
  const names = Object.keys(all)
  const defaultName = deployYml?.default ?? (names.length === 1 ? names[0] : null)
  const elsewhere = Object.entries(all).filter(([, t]) => t && typeof t === 'object' && t.host && t.host !== 'uniweb')
  if (!elsewhere.length) {
    return { checks: [{ id: 'hosting.deploys', state: 'skipped', summary: 'Deployed to no host but a backend.', quiet: true }], proposals: [], targets: [] }
  }
  const repo = repoOf(siteDir)
  const proposals = []
  const targets = []
  const lines = []
  let attention = false
  for (const [name, t] of elsewhere) {
    const title = await hostTitle(t.host)
    const ci = repo?.head ? ciWorkflow(repo, t.host) : null
    const receipt = deployYml.deploys?.[name] || null
    const retired = !receipt && deployYml.lastDeploy?.[name] ? deployYml.lastDeploy[name] : null
    const behind = receipt?.git?.sha && repo?.head ? siteCommitsSince(repo, receipt.git.sha, siteDir) : null
    const when = receipt?.at ? sinceLabel(receipt.at, Date.now()) : null
    let how
    if (ci) {
      how = `deployed by CI on every push${ci.branches.length ? ` to ${ci.branches.join(' or ')}` : ''} (${ci.file})`
    } else if (receipt) {
      how =
        `deployed by hand, last ${when ?? 'at an unknown time'}${receipt.url ? ` to ${receipt.url}` : ''}` +
        (behind > 0 ? ` — the site changed in ${count(behind, 'commit')} since` : behind === 0 ? ', and the site has not changed since' : '')
      if (behind > 0) {
        attention = true
        proposals.push({ step: 'deploy', command: `npx uniweb deploy --target ${name}`, why: `update ${title}, ${count(behind, 'commit')} behind`, ask: true })
      }
    } else if (retired) {
      attention = true
      how = `its last deploy (${String(retired.at ?? '').slice(0, 10) || 'undated'}) is under \`lastDeploy:\`, which nothing reads — \`npx uniweb doctor --fix deploy-yml-retired-key\` moves it`
    } else {
      how = 'never deployed from this copy'
    }
    lines.push(`${title} — target \`${name}\`${name === defaultName ? ', the one a bare `uniweb deploy` uses' : ''}: ${how}`)
    targets.push({
      name,
      host: t.host,
      title,
      default: name === defaultName,
      deployed: Boolean(ci || receipt || retired),
      ci: ci ? { file: ci.file, branches: ci.branches } : null,
      last: receipt ? { at: receipt.at ?? null, sha: receipt.git?.sha ?? null, url: receipt.url ?? null } : null,
      behind,
      ...(retired ? { retired: true } : {})
    })
  }
  // ⭐ A TARGET IS A DESTINATION, NOT A DEPLOY. Only CI or a receipt says the site went there;
  // a target with neither is named as what it is. ⛔ Until 2026-10-26 every target was "Also
  // deployed to", and the status opened with it — on a project copied from a repository whose
  // CI deployed it, after the site had moved to Uniweb Cloud.
  const deployed = targets.filter((t) => t.deployed)
  const never = targets.filter((t) => !t.deployed)
  const parts = []
  if (deployed.length) parts.push(`Also deployed to ${deployed.map((t) => t.title).join(' and ')}.`)
  if (never.length) {
    parts.push(`deploy.yml names ${never.map((t) => t.title).join(' and ')}, never deployed from this copy.`)
    attention = true
    lines.push(
      'A target never deployed from here is a host the site has not gone to yet, or one it left — when it left, remove the target from deploy.yml, and `default:` when it names it.'
    )
  }
  return {
    checks: [
      {
        id: 'hosting.deploys',
        state: attention ? 'attention' : 'ok',
        summary: parts.join(' '),
        lines,
        detail: { targets }
      }
    ],
    proposals,
    targets
  }
}

/**
 * `hosting.workflows`: GitHub Actions workflows between this site and the top of its
 * repository — a project's own `.github/workflows` — which GitHub never runs: it runs the
 * repository's top-level workflows alone, so these are files, not CI.
 *
 * ⭐ A project copied into another repository brings its `.github/` along (`uniweb add ci`
 * writes one). Measured 2026-10-26 on a repository of client projects: a site that had moved to
 * Uniweb Cloud still carried the GitHub Pages workflow that used to deploy it.
 */
function workflowsCheck(siteDir) {
  const repo = repoOf(siteDir)
  if (!repo) return null
  const found = []
  for (let d = siteDir; d !== repo.top && d.startsWith(repo.top + sep); d = dirname(d)) {
    const dir = join(d, '.github', 'workflows')
    let names
    try {
      names = readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))
    } catch {
      continue
    }
    for (const n of names.sort()) found.push(relative(siteDir, join(dir, n)))
  }
  if (!found.length) return { id: 'hosting.workflows', state: 'ok', summary: 'No workflow here that GitHub would not run.', quiet: true }
  const n = found.length
  return {
    id: 'hosting.workflows',
    state: 'attention',
    summary: `${count(n, 'workflow')} here never ${n === 1 ? 'runs' : 'run'}: GitHub runs workflows only from the top of the repository, ${relative(siteDir, join(repo.top, '.github', 'workflows'))}.`,
    files: found,
    lines: ['Most likely left from the repository this project came from. When the site no longer deploys that way, the folder can go — ask the person first.']
  }
}

const list = (names) => names.map((n) => `\`${n}\``).join(', ')

/**
 * `app.services`: what `site.yml` asks for, beside what the backend holds — the request it
 * stored, and what the last publish delivered (`last_published_services`). Comparing the
 * file with those is how to tell it is stale, by the backend's own contract.
 *
 * ⛔ A request is never said as what the site has: what is live is the backend's to say.
 */
async function servicesCheck({ siteDir, siteYml, site }) {
  const { readServicesRequest } = await import('@uniweb/build/uwx')
  const { foundationSupports, serviceNotes } = await import('../backend/service-request.js')
  // ⚠️ Two shapes, as the backend sends them (measured 2026-10-26 on uniweb.app): the stored
  // request is rows (`{ name, enabled? }`), what the last publish delivered is names. A reader
  // of rows alone reads every live service as none.
  const on = (entries) =>
    (Array.isArray(entries) ? entries : [])
      .map((e) => (typeof e === 'string' ? e : e && typeof e.name === 'string' && e.enabled !== false ? e.name : null))
      .filter(Boolean)
  const asks = readServicesRequest(siteYml.services) || []
  const asked = on(asks)
  const lines = serviceNotes({ siteYml, supports: await foundationSupports(siteDir, siteYml) })
  const proposals = []
  if (!site) {
    return {
      checks: [
        {
          id: 'app.services',
          state: lines.length ? 'attention' : 'ok',
          summary: asked.length ? `site.yml asks for ${list(asked)}.` : 'site.yml asks for no services.',
          lines,
          detail: { asked, requested: null, live: null }
        }
      ],
      proposals
    }
  }
  const live = on(site.last_published_services)
  const requested = on(site.services)
  const waiting = requested.filter((n) => !live.includes(n))
  if (waiting.length && site.published) {
    lines.push(`Requested, not live yet: ${list(waiting)} — publishing makes ${waiting.length === 1 ? 'it' : 'them'} live, and may ask for payment.`)
    proposals.push({ step: 'publish', command: 'npx uniweb publish', why: 'make those changes live — the person decides', ask: true })
  }
  const unsent = asked.filter((n) => !requested.includes(n))
  if (unsent.length) lines.push(`site.yml asks for ${list(unsent)}, which the backend does not hold yet — the next push sends the request.`)
  const offHere = asks.filter((a) => a.enabled === false && live.includes(a.name)).map((a) => a.name)
  if (offHere.length) {
    lines.push(`site.yml turns off ${list(offHere)}, which the live site has — a request the owner settles; a paid service stays on until its subscription changes.`)
  }
  return {
    checks: [
      {
        id: 'app.services',
        state: lines.length ? 'attention' : 'ok',
        summary: live.length ? `Services on the live site: ${list(live)}.` : site.published ? 'No services on the live site.' : 'No services live — the site is not.',
        lines,
        detail: { asked, requested, live }
      }
    ],
    proposals
  }
}

/** What the site is, in one line: where it is synced, and where it is live. */
function summaryLine({ name, synced, live, targets, origin }) {
  const parts = [synced.length ? `synced with ${synced.join(' and ')}` : 'not synced with a backend']
  if (live?.published) parts.push(`live on ${cloudName(origin)}${live.url ? ` at ${live.url}` : ''}`)
  else if (live) parts.push(`not live on ${cloudName(origin)} yet`)
  const deployed = targets.filter((t) => t.deployed)
  if (deployed.length) parts.push(`${live?.published ? 'also deployed' : 'deployed'} to ${deployed.map((t) => t.title).join(' and ')}`)
  else if (!synced.length) parts.push('not hosted anywhere yet')
  return `${name} — ${parts.join(' · ')}`
}

// ─── the command ────────────────────────────────────────────────────────────

const GROUPS = [
  ['project', 'Project'],
  ['git', 'Git'],
  ['app', 'App'],
  ['hosting', 'Hosting'],
  ['uniweb', 'Uniweb'],
  ['health', 'Health'],
  ['dev', 'Dev server']
]

// Where a check is shown: where the site is live, and what it serves, are its hosting —
// `app.live` and `app.services` kept their ids, which the document had before the group.
const groupOf = (id) => (id === 'app.live' || id === 'app.services' || id.startsWith('hosting.') ? 'hosting' : id.split('.')[0])

const ICON = {
  ok: `${c.green}✓${c.reset}`,
  attention: `${c.cyan}→${c.reset}`,
  blocking: `${c.red}✗${c.reset}`,
  unknown: `${c.yellow}?${c.reset}`,
  skipped: `${c.dim}·${c.reset}`
}

function render({ summary, backend, checks, next }) {
  const out = ['']
  out.push(`${c.bold}${summary}${c.reset}`)
  for (const [prefix, title] of GROUPS) {
    const group = checks.filter((k) => groupOf(k.id) === prefix && !(k.quiet && (k.state === 'ok' || k.state === 'skipped')))
    if (!group.length) continue
    out.push('')
    out.push(prefix === 'app' ? `${c.bold}${title}${c.reset} ${c.dim}— ${backend.origin}${c.reset}` : `${c.bold}${title}${c.reset}`)
    for (const k of group) {
      out.push(`  ${ICON[k.state]} ${k.state === 'skipped' ? `${c.dim}${k.summary}${c.reset}` : k.summary}`)
      const files = k.files || []
      for (const f of files.slice(0, 12)) out.push(`      ${c.dim}${f}${c.reset}`)
      if (files.length > 12) out.push(`      ${c.dim}… and ${files.length - 12} more${c.reset}`)
      for (const l of k.lines || []) out.push(`      ${c.dim}${l}${c.reset}`)
    }
  }
  out.push('')
  if (!next.length) {
    out.push(`${ICON.ok} ${c.bold}Nothing to do.${c.reset}`)
  } else {
    out.push(`${c.bold}Next${c.reset}`)
    next.forEach((s, i) => {
      const ask = s.ask ? `${c.yellow}ask the person first —${c.reset} ` : ''
      if (s.command) {
        out.push(`  ${i + 1}. ${c.cyan}${s.command}${c.reset}`)
        out.push(`     ${ask}${c.dim}${s.why}${c.reset}`)
      } else {
        out.push(`  ${i + 1}. ${ask}${s.why}`)
      }
    })
  }
  const unknown = checks.filter((k) => k.state === 'unknown').map((k) => k.id)
  if (unknown.length) {
    out.push('')
    out.push(`${c.dim}Not known: ${unknown.join(', ')} — see above.${c.reset}`)
  }
  out.push('')
  return out.join('\n')
}

/**
 * At a workspace with several sites: what each one is — synced where, deployed where, built
 * with which foundation, with pages from where, in how many languages — from its files alone,
 * and the way to one site's checks. Nothing is asked of a backend: what changed in the app is
 * a site's question.
 */
async function workspaceOverview(root, { json }) {
  const ws = await workspaceFacts(root)
  const { mountEntriesOf } = await import('@uniweb/build/site')
  const { normalizeLanguageList } = await import('@uniweb/core/locale-config')
  const sites = []
  for (const s of ws.sites) {
    const dir = resolve(root, s.path)
    const yml = readSiteYml(dir)
    const synced = listSyncedBackends(dir).filter((o) => readBackendState(dir, o).site?.uuid)
    const { targets } = await deployChecks(dir)
    const fnd = await foundationOf(dir, yml, root)
    const siteRepo = repoOf(dir)?.top ?? null
    const mounts = mountEntriesOf(yml.paths).map(([segment, d]) => {
      const abs = resolve(dir, String(d))
      const top = existsSync(abs) ? repoOf(abs)?.top ?? null : null
      return { segment, dir: String(d), repository: !existsSync(abs) ? null : !top ? 'none' : top === siteRepo ? 'same' : 'other' }
    })
    const languages = normalizeLanguageList(yml.languages)
    const parts = [synced.length ? `synced with ${synced.join(' and ')}` : 'not synced']
    const deployed = targets.filter((t) => t.deployed)
    if (deployed.length) parts.push(`deployed to ${deployed.map((t) => t.title).join(' and ')}`)
    parts.push(
      fnd.kind === 'local'
        ? `foundation ${fnd.name}`
        : fnd.kind === 'catalog' || fnd.kind === 'url'
          ? `foundation ${fnd.name}, not in this workspace`
          : `foundation ${fnd.name ? `\`${fnd.name}\`, unresolved` : 'not named'}`
    )
    for (const m of mounts) parts.push(`pages/${m.segment} from ${m.dir}${m.repository === 'other' ? ', its own repository' : ''}`)
    if (languages.length > 1) parts.push(`${languages.length} languages`)
    sites.push({
      path: s.path,
      name: s.name,
      summary: `${s.path} — ${parts.join(' · ')}`,
      synced,
      deploys: targets.map(({ name, host, title, default: isDefault, deployed: was, ci }) => ({ name, host, title, default: isDefault, deployed: was, ci })),
      foundation: { kind: fnd.kind, name: fnd.name ?? null, path: fnd.path ?? null },
      mounts,
      languages
    })
  }
  // The repository the workspace is in, as far as this machine knows — no remote is asked.
  const repo = repoOf(root)
  let git = null
  if (repo?.head) {
    let uncommitted = 0
    try {
      uncommitted = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n')
        .filter(Boolean).length
    } catch {
      uncommitted = 0
    }
    git = { uncommitted, ...(aheadBehind(root) || {}), upstream: upstreamOf(root)?.tracking ?? null }
  }
  const summary = `${basename(root)} — ${workspaceLine(ws).replace(/\.$/, '')}`
  const first = ws.sites[0]
  if (json) {
    console.log(
      JSON.stringify({
        schema: STATUS_SCHEMA,
        uniweb: getCliVersion(),
        scope: 'workspace',
        summary,
        workspace: { patterns: ws.patterns, sites: ws.sites, foundations: ws.foundations, extensions: ws.extensions },
        sites,
        git,
        checks: [],
        next: [{ command: null, why: "run `npx uniweb status` in a site's folder for its checks — what changed in the app, in git, and where it is hosted", ask: false }]
      })
    )
    return { exitCode: 0 }
  }
  const out = ['', `${c.bold}${summary}${c.reset}`, '']
  for (const s of sites) out.push(`  ${s.summary}`)
  if (git) {
    const said = [git.uncommitted ? `${count(git.uncommitted, 'file')} not committed` : 'all committed']
    if (git.upstream) said.push(git.ahead || git.behind ? `${git.ahead} ahead of, ${git.behind} behind ${git.upstream} as of the last fetch` : `level with ${git.upstream} as of the last fetch`)
    out.push('', `${c.dim}Git: ${said.join(' · ')}${c.reset}`)
  }
  out.push('', `A bare \`uniweb dev\` starts ${first.name}. For one site's checks — what changed in the app, in git, and where it is hosted — run status in its folder, for example:`)
  out.push(`  ${c.cyan}cd ${first.path} && npx uniweb status${c.reset}`, '')
  console.log(out.join('\n'))
  return { exitCode: 0 }
}

export async function status(args = []) {
  // See utils/flag-guard.js — an unrecognized flag is invisible to a literal scan.
  // Straight to stderr: this is a usage error, so it must not be mistaken for the
  // status document even under --json.
  const badFlag = checkFlags('status', args)
  if (badFlag) {
    console.error(`${c.red}✗${c.reset} ${badFlag.message}`)
    return { exitCode: 2 }
  }
  const json = args.includes('--json')
  const offline = args.includes('--offline')

  const found = await findSite(process.cwd())
  if (!found.siteDir) {
    // ⭐ A WORKSPACE OF SEVERAL SITES IS ANSWERED, not refused: what each one is, from its
    // files, and the way to one site's checks.
    if (found.several?.length) return workspaceOverview(found.root, { json })
    if (json) console.log(JSON.stringify({ schema: STATUS_SCHEMA, scope: null, error: 'no-site' }))
    else console.error(`${c.red}✗${c.reset} No Uniweb site here. Run status from a site, or a project with one site.`)
    return { exitCode: 2 }
  }
  const siteDir = found.siteDir
  const siteYml = readSiteYml(siteDir)
  const origin = resolveBackendOrigin()

  // ⭐ Under --json, stdout carries the document and nothing else: whatever a check's
  // helpers say on the way goes to stderr.
  const saved = { log: console.log, info: console.info, warn: console.warn }
  if (json) console.log = console.info = console.warn = (...a) => console.error(...a)
  let project, git, app, version, health, dev, deploys, services
  try {
    ;[project, git] = await Promise.all([projectChecks(siteDir, siteYml), gitChecks(siteDir, { offline, origin })])
    ;[app, version, health, dev, deploys] = await Promise.all([
      appChecks(siteDir, siteYml, { offline, args, git }),
      versionCheck(siteDir, { offline }),
      doctorCheck(siteDir),
      devCheck(siteDir, { offline, sites: project.ws.sites }),
      deployChecks(siteDir)
    ])
    services = await servicesCheck({ siteDir, siteYml, site: app.site })
  } finally {
    Object.assign(console, saved)
  }
  const workflows = workflowsCheck(siteDir)
  const checks = [
    ...project.checks,
    ...git.checks,
    ...app.checks,
    ...deploys.checks,
    ...(workflows ? [workflows] : []),
    ...services.checks,
    ...version.checks,
    ...health.checks,
    dev
  ]
  const next = planNext([...git.proposals, ...app.proposals, ...deploys.proposals, ...services.proposals, ...version.proposals, ...health.proposals])

  const root = findWorkspaceRoot(siteDir) || siteDir
  const site = relative(root, siteDir) || '.'
  // What the site is, before what to do about it: the backends it is synced with — every one
  // this copy holds a site on, custom servers included — and where it is live.
  const synced = listSyncedBackends(siteDir).filter((o) => readBackendState(siteDir, o).site?.uuid)
  const summary = summaryLine({
    name: typeof siteYml.name === 'string' && siteYml.name ? siteYml.name : site === '.' ? 'This site' : site,
    synced,
    live: checks.find((k) => k.id === 'app.live')?.detail ?? null,
    targets: deploys.targets,
    origin: app.backend.origin
  })
  if (json) {
    console.log(
      JSON.stringify({
        schema: STATUS_SCHEMA,
        uniweb: getCliVersion(),
        scope: 'site',
        summary,
        site,
        backend: app.backend.origin,
        workspace: app.backend.workspace,
        synced,
        offline,
        checks: checks.map(({ quiet, id, state, summary, blocks = [], ...rest }) => ({ id, state, summary, blocks, ...rest })),
        next
      })
    )
    return { exitCode: 0 }
  }
  console.log(render({ summary, backend: app.backend, checks, next }))
  return { exitCode: 0 }
}

export default status
