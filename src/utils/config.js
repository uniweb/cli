/**
 * Workspace Config Management
 *
 * Read/write pnpm-workspace.yaml and root package.json, plus URL config
 * for the platform backend / registry. Used by both `create` and `add`
 * commands.
 *
 * This module is on the CLI's startup path (statically imported by
 * `commands/login.js`, which is loaded by `src/index.js`). It MUST NOT
 * import any optional peer dependency — most importantly `@uniweb/build`,
 * which is absent in `npx uniweb create` scratch dirs and global
 * installs. Workspace package discovery (which does need `@uniweb/build`)
 * lives in `./discover.js` and is loaded only by commands that already
 * require a project context.
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { filterCmd } from './pm.js'
import { writeJsonPreservingStyleAsync } from './json-file.js'
import { loggedInOriginOf, readSessionFileSync } from './session-file.js'
import {
  WORKSPACE_FILE,
  readWorkspacePatterns,
  patternsCover,
  editWorkspaceFilePackages,
  renderWorkspaceFile
} from './workspace-packages.js'

// ── Backend origin ─────────────────────────────────────────────

/**
 * Read ~/.uniweb/config.json for a persistent backend-origin override (e.g.
 * `{ "registryApiUrl": "http://localhost:8081" }`) — consumed by
 * getRegistryApiBaseUrl() below.
 *
 * @returns {{ registryApiUrl?: string }}
 */
let _cliConfig = undefined
function readCliConfig() {
  if (_cliConfig !== undefined) return _cliConfig

  try {
    const configPath = join(homedir(), '.uniweb', 'config.json')
    if (existsSync(configPath)) {
      _cliConfig = JSON.parse(readFileSync(configPath, 'utf8'))
      return _cliConfig
    }
  } catch {
    // ignore
  }

  _cliConfig = {}
  return _cliConfig
}

/**
 * The origin the LAST `uniweb login` authenticated against — persisted on the
 * session record so subsequent verbs default to the backend you logged into
 * (no backend flag per command). Sync read; null when there's no session or it
 * carries no origin (older sessions). Read directly (not via registry-auth.js)
 * to keep this module off the optional-peer / import-cycle path.
 * @returns {string|null}
 */
/**
 * **The backend the user is logged in to** — the one session's backend — or null.
 *
 * ⛔ This read `~/.uniweb/registry-auth.json`'s top-level `origin` itself until
 * 2026-09-21: the v1 shape. The file had become one session per backend, which has no
 * such field, so this answered null for every new login and the session tier below
 * silently fell through to the default backend. It reads through the file's one reader
 * now (utils/session-file.js).
 *
 * @returns {string|null}
 */
export function loggedInOrigin() {
  return loggedInOriginOf(readSessionFileSync(DEFAULT_BACKEND_ORIGIN))
}

/** A value's bare origin, or null when it is not a URL. */
function originOrNull(value) {
  if (!value) return null
  try {
    // ⛔ http(s) only: `new URL('localhost:8080')` PARSES — as the scheme `localhost:` —
    // and its origin is the string "null", which is truthy. A bare host:port is the
    // easy slip, and it must not become a backend.
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * **The default backend** — where a bare `uniweb login` goes, and where a backend command
 * goes when nobody is logged in (the login it asks for is then this one).
 *
 * `UNIWEB_SERVER`, else `~/.uniweb/config.json` `registryApiUrl`, else
 * https://uniweb.app. ⛔ **Never the current session** *[Diego, 2026-09-21: "the default
 * backend for login, if not specified, is uniweb.app"]* — a bare `uniweb login` means the
 * default backend, not "the one I am already on".
 *
 * @returns {string}
 */
export function getDefaultBackendOrigin() {
  return (
    originOrNull(process.env.UNIWEB_SERVER) ||
    originOrNull(readCliConfig().registryApiUrl) ||
    DEFAULT_BACKEND_ORIGIN
  )
}

/**
 * The `uniweb login` that SWITCHES the workspace on `origin` — the caller appends `--org @x`
 * or `--personal` — with `--server` unless a switch without it reaches `origin`
 * (`resolveLoginOrigin`): the backend you are logged in to, or, logged in nowhere, the
 * default backend.
 *
 * ⚠️ *Measured 2026-10-06 against a local backend, before switches acted on the session:*
 * `uniweb login --org @acme` went to https://uniweb.app and began a new login there — the
 * reason a hint about any other backend names it.
 *
 * @param {string} origin - the backend the hint is about
 * @param {string} [prefix='uniweb'] - how the user runs the CLI (`getCliPrefix`)
 * @returns {string} e.g. `uniweb login`, or `uniweb login --server http://localhost:8080`
 */
export function loginCommand(origin, prefix = 'uniweb') {
  const o = originOrNull(origin)
  const reached = originOrNull(loggedInOrigin()) || getDefaultBackendOrigin()
  return o && o !== reached ? `${prefix} login --server ${o}` : `${prefix} login`
}

/** The flags with which `uniweb login` SIGNS IN — a method, or a credential. */
const SIGN_IN_FLAGS = ['--token', '--browser', '--password', '--token-paste']

/**
 * Whether a `uniweb login` is a WORKSPACE SWITCH: `--org` or `--personal`, and nothing that
 * signs in (`SIGN_IN_FLAGS`).
 *
 * @param {string[]} [args]
 * @returns {boolean}
 */
export function isWorkspaceSwitch(args = []) {
  const names = args.map((a) => String(a).split('=')[0])
  return (
    (names.includes('--org') || names.includes('--personal')) &&
    !SIGN_IN_FLAGS.some((f) => names.includes(f))
  )
}

/**
 * The backend `uniweb login` logs in to: `--server`; else, for a workspace switch, the
 * backend you are logged in to; else the default backend.
 *
 * ⭐ A SWITCH ACTS ON YOUR SESSION *[Diego, 2026-10-06: "`uniweb login --org @x` or
 * `--personal`, with no `--backend`, should switch to the workspace on the backend you're
 * already logged in to so we can fullfil the promise 'switches without logging in again'"]*.
 * Logged in nowhere, it is a first login, and goes where any first login goes. A login that
 * signs in — a method or a credential named (`isWorkspaceSwitch`) — still goes to the
 * default backend *[Diego, 2026-09-21: "the default backend for login, if not specified, is
 * uniweb.app"]*. ⛔ Until 2026-10-06 a switch went to the default backend too, so on any
 * other backend it began a new login there, logging you out of the one you were on.
 *
 * ⛔ A mistyped `--server` is an error, never a fallback — it would log you in, and so
 * point every command, somewhere you did not name.
 *
 * @param {string|null|undefined} flag - `readFlagValue`'s answer: undefined when the
 *   flag is absent, null when it was given with no value
 * @param {string[]} [args] - the login's argv, to tell a switch from a sign-in
 * @returns {string}
 * @throws {Error} when --server was given and is not a URL
 */
export function resolveLoginOrigin(flag, args = []) {
  if (flag === undefined) {
    const session = isWorkspaceSwitch(args) ? originOrNull(loggedInOrigin()) : null
    return session || getDefaultBackendOrigin()
  }
  const origin = originOrNull(flag)
  if (!origin) throw new Error(flag ? `Not a URL: ${flag}` : '--server needs a URL')
  return origin
}

/**
 * **The backend a command talks to** — the base of every `/dev/*` route (`register`
 * POSTs to {origin}/dev/registry/register, and so on).
 *
 * `UNIWEB_SERVER` > **the backend the user is logged in to** > the default
 * (`getDefaultBackendOrigin`). ⭐ Nothing talks to a backend the user is not logged in
 * to *[Diego, 2026-09-21]*: when this falls through to the default, the command's first
 * request asks for that login — so the default is where the login goes, never a
 * backend reached without one. `resolveBackendOrigin` (backend/client.js) returns this
 * unchanged: no command takes a backend flag. ⛔ *Until 2026-10-05 this said "when no
 * `--backend` is given" and that `resolveBackendOrigin` put `--backend` on top — read as
 * a per-command flag outranking the login. The verbs lost that flag on 2026-09-21.*
 *
 * @returns {string}
 */
export function getRegistryApiBaseUrl() {
  return (
    originOrNull(process.env.UNIWEB_SERVER) ||
    originOrNull(loggedInOrigin()) ||
    getDefaultBackendOrigin()
  )
}

/**
 * The built-in backend origin — the last tier of the ladder, and the 98% case.
 *
 * Exported because several readers need the *built-in* default, not the resolved one:
 * a v1 session file with no origin stamp, `login`'s list of known backends, and a
 * deploy.yml `host: uniweb` target with no `backend:` (its documented meaning).
 * `getRegistryApiBaseUrl()` cannot give it — that function returns whatever tier won,
 * so on a machine with a session or a saved config it returns something else
 * entirely. Two copies of the literal would silently disagree exactly there.
 */
export const DEFAULT_BACKEND_ORIGIN = 'https://uniweb.app'

/**
 * Read workspace package globs.
 * Tries pnpm-workspace.yaml first, falls back to package.json workspaces.
 * The folders they name: `workspacePackages` (./workspace-packages.js).
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<{packages: string[]}>}
 */
export async function readWorkspaceConfig(rootDir) {
  return { packages: readWorkspacePatterns(rootDir).patterns }
}

/**
 * Make the folder at `relPath` a workspace package.
 *
 * Nothing is written for a folder a pattern already covers — it is a package
 * already. ⛔ Until 2026-10-13 its own path was added beside the pattern, and
 * discovery listed it twice. Otherwise `entry` — the folder itself, unless a
 * pattern is given for it — is added to each manifest that does not cover it:
 *
 * - pnpm-workspace.yaml's `packages:` list, edited in place: comments and every
 *   other key stay as they were. ⛔ Until 2026-10-13 the file was rewritten from
 *   its `packages` alone, deleting `onlyBuiltDependencies` and `allowBuilds` with
 *   the comments that explain them. A workspace without the file (a blank one, at
 *   its first `add`) gets it from the workspace template, as `create` writes it.
 * - package.json's `workspaces`, which npm and yarn read.
 *
 * @param {string} rootDir - Workspace root directory
 * @param {string} relPath - The package's folder, workspace-relative
 * @param {{ entry?: string }} [options] - `entry`: a pattern to list for it instead
 */
export async function registerWorkspacePackage(rootDir, relPath, { entry = relPath } = {}) {
  const { source, patterns } = readWorkspacePatterns(rootDir)
  const ymlPath = join(rootDir, WORKSPACE_FILE)
  if (!patternsCover(patterns, relPath)) {
    if (source === WORKSPACE_FILE) {
      const text = await readFile(ymlPath, 'utf-8')
      await writeFile(ymlPath, editedWorkspaceFile(text, (list) => [...list, entry], entry))
    } else {
      await writeFile(ymlPath, renderWorkspaceFile([...patterns, entry]))
    }
  }

  const pkg = await readRootPackageJson(rootDir)
  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : []
  if (!patternsCover(workspaces, relPath)) {
    pkg.workspaces = [...workspaces, entry]
    await writeRootPackageJson(rootDir, pkg)
  }
}

/**
 * A package folder moved from `oldPath` to `newPath`: rename its entry in each
 * manifest that lists it by path — a pattern is left as written — then register
 * the new path, in case it has moved out from under the pattern that covered it.
 *
 * @param {string} rootDir
 * @param {string} oldPath
 * @param {string} newPath
 */
export async function moveWorkspacePackage(rootDir, oldPath, newPath) {
  const { source, patterns } = readWorkspacePatterns(rootDir)
  if (source === WORKSPACE_FILE && patterns.includes(oldPath)) {
    const ymlPath = join(rootDir, WORKSPACE_FILE)
    const text = await readFile(ymlPath, 'utf-8')
    const rename = (list) => list.map((p) => (p === oldPath ? newPath : p))
    await writeFile(ymlPath, editedWorkspaceFile(text, rename, newPath))
  }
  const pkg = await readRootPackageJson(rootDir)
  if (Array.isArray(pkg.workspaces) && pkg.workspaces.includes(oldPath)) {
    pkg.workspaces = pkg.workspaces.map((p) => (p === oldPath ? newPath : p))
    await writeRootPackageJson(rootDir, pkg)
  }
  await registerWorkspacePackage(rootDir, newPath)
}

/** The edited file, or an error that says what to add by hand — the file is never rewritten. */
function editedWorkspaceFile(text, edit, entry) {
  const next = editWorkspaceFilePackages(text, edit)
  if (next == null) {
    throw new Error(
      `Could not edit the packages: list in ${WORKSPACE_FILE} in place, and it is not rewritten ` +
        `whole. Add "${entry}" to it by hand.`
    )
  }
  return next
}

/**
 * Read root package.json
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<Object>}
 */
export async function readRootPackageJson(rootDir) {
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return {}
  }
  return JSON.parse(await readFile(pkgPath, 'utf-8'))
}

/**
 * Write root package.json, preserving the file's existing indentation
 * (newly scaffolded workspaces use 2-space; we don't reflow whatever's
 * already there).
 * @param {string} rootDir - Workspace root directory
 * @param {Object} pkg - Package.json object
 */
export async function writeRootPackageJson(rootDir, pkg) {
  const pkgPath = join(rootDir, 'package.json')
  if (existsSync(pkgPath)) {
    await writeJsonPreservingStyleAsync(pkgPath, pkg)
  } else {
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }
}

/**
 * Compute root scripts based on discovered sites.
 *
 * `dev` and `build` route through the uniweb CLI verb (PM-agnostic — they
 * resolve `uniweb` from the project's local node_modules/.bin, so `pnpm
 * dev` and `npm run dev` both work without locking the scripts to one PM
 * at create-time). `preview` stays on a PM-specific filter because there
 * isn't a `uniweb preview` verb yet (the site's own `vite preview` is what
 * runs); switch it over when one ships.
 *
 * @param {Array<{name: string, path: string}>} sites - Discovered sites
 * @param {'pnpm' | 'npm'} [pm='pnpm'] - Package manager (used only for preview)
 * @returns {Object} Scripts object for package.json
 */
export function computeRootScripts(sites, pm = 'pnpm') {
  const scripts = {
    build: 'uniweb build'
  }

  if (sites.length === 0) {
    return scripts
  }

  if (sites.length === 1) {
    scripts.dev = 'uniweb dev'
    scripts.preview = filterCmd(pm, sites[0].name, 'preview')
  } else {
    // First site gets unqualified dev/preview (matches `uniweb dev`'s
    // default-to-first-site behavior).
    scripts.dev = 'uniweb dev'
    scripts.preview = filterCmd(pm, sites[0].name, 'preview')

    // Subsequent sites get qualified dev:{name}/preview:{name}
    for (let i = 1; i < sites.length; i++) {
      scripts[`dev:${sites[i].name}`] = `uniweb dev ${sites[i].name}`
      scripts[`preview:${sites[i].name}`] = filterCmd(
        pm,
        sites[i].name,
        'preview'
      )
    }
  }

  return scripts
}

/**
 * Update root scripts after adding a new site
 * @param {string} rootDir - Workspace root directory
 * @param {Array<{name: string, path: string}>} sites - All sites (including new one)
 * @param {'pnpm' | 'npm'} [pm='pnpm'] - Package manager
 */
export async function updateRootScripts(rootDir, sites, pm = 'pnpm') {
  const pkg = await readRootPackageJson(rootDir)
  const unique = sites.filter((s, i) => sites.findIndex((o) => o.path === s.path) === i)
  const newScripts = computeRootScripts(unique, pm)
  const scripts = { ...(pkg.scripts || {}) }

  // If we're adding a second site, rename existing dev/preview to dev:{firstName}
  if (unique.length === 2 && scripts.dev) {
    const firstName = unique[0].name
    // Only rename if the existing dev script references the first site's name
    if (scripts.dev.includes(firstName)) {
      scripts[`dev:${firstName}`] = scripts.dev
      scripts[`preview:${firstName}`] = scripts.preview
    }
  }

  // ⭐ The per-site scripts this CLI writes are regenerated from the sites there are
  // now, and one it wrote for a site that is gone — renamed, moved, removed — goes.
  // A script whose command is not one the CLI writes is the user's, and stays.
  // ⛔ Until 2026-10-13 they were only ever added: after `rename site blog journal`,
  // `dev:blog` still ran `uniweb dev blog`, a site that no longer existed.
  for (const [key, value] of Object.entries(scripts)) {
    if (key in newScripts) continue
    const m = /^(dev|preview):(.+)$/.exec(key)
    if (m && cliSiteScripts(m[1], m[2]).includes(value)) delete scripts[key]
  }

  pkg.scripts = { ...scripts, ...newScripts }
  await writeRootPackageJson(rootDir, pkg)
}

/** Every command this CLI has written for the `dev:<site>` / `preview:<site>` script. */
function cliSiteScripts(kind, site) {
  return kind === 'dev'
    ? [`uniweb dev ${site}`, filterCmd('pnpm', site, 'dev'), filterCmd('npm', site, 'dev')]
    : [filterCmd('pnpm', site, 'preview'), filterCmd('npm', site, 'preview')]
}

