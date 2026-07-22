/**
 * Version resolution utility
 *
 * Produces npm-compatible version specs for every `@uniweb/*` package the
 * scaffolder might reference when materializing a new project. The caller
 * (templates/processor.js via the `{{version}}` Handlebars helper) never
 * needs to know whether the CLI is running locally from a pnpm workspace
 * or as an npm-installed binary — both code paths feed through here.
 *
 * ## How versions are resolved
 *
 * 1. Start from the CLI's own `package.json` dependencies. When the CLI
 *    was installed via npm, pnpm has already resolved every `workspace:*`
 *    spec into a concrete version like `^0.9.1`, so this step is
 *    usually enough.
 * 2. For any dep that is still `workspace:*` (i.e. the CLI is running
 *    *from* the pnpm workspace — local dev, sandbox script, tests), fall
 *    back to reading the real `package.json` of each sibling package
 *    under `framework/<name>/` and using `^<that version>`. This is the
 *    path that keeps local sandboxes and templates aligned with whatever
 *    was last bumped in the monorepo.
 * 3. Scan `framework/*` to catch any additional `@uniweb/*` package that
 *    wasn't explicitly listed as a CLI dep (press, loom, scholar, etc.).
 *    New packages get picked up by the scaffolder automatically.
 *
 * The previous implementation shipped a hardcoded fallback table and
 * nothing kept it in sync with reality — see the audit note in
 * `framework/CLAUDE.md` under "Publishing". Every workspace-based scaffold
 * silently pinned against years-old versions. That table is gone. If this
 * function ever fails to resolve a package, it returns `^0.0.0` rather
 * than a stale best-guess, so the breakage is loud.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Cache for resolved versions
let resolvedVersions = null

/**
 * The React major the framework standardizes on.
 *
 * React 19 changed the element marker symbol, so mixing React 18 and 19
 * across the foundation ↔ runtime SSR boundary breaks rendering. The whole
 * toolchain therefore pins a single major. This is the one place that value
 * lives: scaffolded `package.json` files reference it through the
 * `{{version "react"}}` / `{{version "react-dom"}}` template helpers instead
 * of hardcoding a range.
 */
export const REACT_VERSION = '^19.0.0'

/**
 * Default pnpm major for generated CI, used only when the project does not
 * say which pnpm it uses (see `resolveCiPnpmVersion`).
 *
 * **Tracks the current stable major.** `pnpm@latest` is 11.x, so a developer
 * running `npm i -g pnpm` today gets 11 — and CI should run what they run.
 * Both of pnpm 11's install-time policies are handled:
 *
 *   - Build-script approval. pnpm 11 renamed `onlyBuiltDependencies` (list)
 *     to `allowBuilds` (map) and ignores the old name, so an unprepared
 *     project fails with `ERR_PNPM_IGNORED_BUILDS`. The workspace template
 *     emits both spellings, so scaffolds install on either major.
 *   - Minimum release age. pnpm 11 refuses dependencies published in the
 *     last 24 hours. Installing locally with pnpm 11 auto-collects the
 *     needed `minimumReleaseAgeExclude` entries into `pnpm-workspace.yaml`,
 *     and CI then honours them — verified end to end.
 *
 * **The one combination that breaks is installing locally with pnpm 10 while
 * CI runs 11**: pnpm 10 never writes those exclude entries, so CI rejects any
 * dependency in the lockfile published within the last day — including
 * unrelated transitive ones. A project still on pnpm 10 should say so with
 * `"packageManager": "pnpm@10.x.y"`, which `resolveCiPnpmVersion` honours and
 * which pins CI to match. `uniweb add ci` prints the resolved toolchain so
 * that choice is visible rather than silent.
 *
 * A bare major installs the latest patch of that major at CI run time. Before
 * bumping this, check the new major's release notes for install-time policy
 * changes, and update `PNPM_MIN_NODE` in the same commit.
 */
export const PNPM_VERSION = '11'

/**
 * Minimum Node major each supported pnpm major will run on, from that
 * release's own `engines.node`.
 *
 * pnpm 11 declares `>=22.13` and imports `node:sqlite`, which does not exist
 * before Node 22 — pairing it with Node 20 fails at `pnpm install` with
 * `ERR_UNKNOWN_BUILTIN_MODULE` before the build is attempted. That was the
 * default until 2026-07-21, because the CI node major came from the
 * project's `engines.node` and the workspace template declares `>=20.19`.
 *
 * Verify with `npm view pnpm@<major> engines` when adding an entry.
 */
export const PNPM_MIN_NODE = { '10': 18, '11': 22 }

/**
 * Resolve the pnpm major a generated CI workflow should install.
 *
 * Observed, not assumed, in this order:
 *
 *   1. `packageManager` in package.json — the project stating explicitly
 *      which pnpm it is developed and locked against. Honour it.
 *   2. What actually installed the project, from
 *      `node_modules/.modules.yaml` (`detectInstalledPnpmVersion`). A record
 *      of fact: the developer running `add ci` is the developer who ran
 *      `pnpm install`, and `add ci` refuses to run before install, so this
 *      is normally present.
 *   3. `PNPM_VERSION` — a last resort that should rarely apply.
 *
 * There is deliberately no inference from *how the CLI was invoked*. The
 * documented way to scaffold is `npm create uniweb`, commonly followed by
 * `pnpm install`, so the invoking manager says nothing about the project's.
 * Writing a `packageManager` field at scaffold time was considered and
 * rejected for the same reason — it would guess intent and, being enforced
 * by corepack, would be a hard pin rather than a hint.
 *
 * `pnpm-lock.yaml`'s `lockfileVersion` is NOT usable here: pnpm 10 and 11
 * both write `9.0`, so it cannot distinguish them. Checked, not assumed.
 *
 * @param {object|null} rootPkg — the workspace root's parsed package.json.
 * @param {string|null} [installedMajor] — from `detectInstalledPnpmVersion`.
 * @returns {string} pnpm major, as a string for YAML interpolation.
 */
export function resolveCiPnpmVersion(rootPkg, installedMajor = null) {
  const declared = rootPkg?.packageManager
  const match = typeof declared === 'string' ? declared.match(/^pnpm@(\d+)/) : null
  if (match) return match[1]
  if (installedMajor) return String(installedMajor)
  return PNPM_VERSION
}

/**
 * Resolve the Node major a generated CI workflow should install.
 *
 * Respects the project's own floor (`engines.node`) but never drops below
 * what the pinned package manager needs. The project's declared minimum is a
 * *lower* bound on what its code needs, not a ceiling — running CI on a newer
 * Node is fine; running it on one the package manager refuses to start on is
 * not.
 *
 * @param {string|null|undefined} enginesNode — the project's `engines.node`.
 * @param {'pnpm'|'npm'|'yarn'} packageManager
 * @param {string} [pnpmVersion] — the resolved pnpm major, when pnpm.
 * @param {string} [fallback='20'] — used when engines.node is absent/unparseable.
 * @returns {string} Node major, as a string for YAML interpolation.
 */
export function resolveCiNodeVersion(enginesNode, packageManager, pnpmVersion = PNPM_VERSION, fallback = '20') {
  const match = enginesNode ? String(enginesNode).match(/(\d+)/) : null
  const declared = match ? Number(match[1]) : Number(fallback)
  const floor = packageManager === 'pnpm' ? (PNPM_MIN_NODE[pnpmVersion] ?? 0) : 0
  return String(Math.max(declared, floor))
}

/**
 * Get the CLI's own package.json
 */
function getCliPackageJson() {
  const packagePath = join(__dirname, '..', 'package.json')
  return JSON.parse(readFileSync(packagePath, 'utf8'))
}

/**
 * Get the CLI's own version
 *
 * @returns {string} CLI version (e.g., "0.8.32")
 */
export function getCliVersion() {
  return getCliPackageJson().version
}

/**
 * Locate the framework/ directory on disk. When the CLI is running from
 * the pnpm workspace, this resolves to `<workspace>/framework/`. When the
 * CLI is installed from npm, this directory won't exist — callers must
 * handle that (return null) so the function doesn't pretend to know more
 * than it does.
 */
function getFrameworkRoot() {
  const candidate = join(__dirname, '..', '..')
  try {
    if (statSync(candidate).isDirectory()) {
      return candidate
    }
  } catch {}
  return null
}

/**
 * Read the current on-disk version of a specific `@uniweb/*` package by
 * looking up `framework/<last-segment>/package.json`. Returns the version
 * string verbatim (e.g. `0.7.11`), or null if the package isn't present
 * on disk (i.e. the CLI is running from npm, not from the workspace).
 *
 * Returns the version *exact*, not as a caret range, to match the shape
 * published-CLI direct deps take after pnpm resolves `workspace:*` at
 * publish time. Both modes converge on identical specs in
 * `getResolvedVersions()`, so `uniweb update` and the scaffolder produce
 * the same `package.json` whether the CLI ran from npm or from this
 * monorepo.
 */
function readWorkspaceVersion(packageName) {
  const root = getFrameworkRoot()
  if (!root) return null
  const shortName = packageName.startsWith('@uniweb/')
    ? packageName.slice('@uniweb/'.length)
    : packageName
  const pkgPath = join(root, shortName, 'package.json')
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (pkg.name === packageName && pkg.version) {
      return pkg.version
    }
  } catch {}
  return null
}

/**
 * Load the vendored framework index file (see
 * `./framework-index.json`). The index is a snapshot of the framework
 * state taken at CLI publish time — every `@uniweb/*` package name,
 * version, path, and inter-package dep edges, plus the template list.
 *
 * The snapshot is the only way a published CLI (running from
 * `node_modules/uniweb/…`, with no workspace on disk) can resolve
 * versions for packages it doesn't directly import (press, loom,
 * scholar, etc.). Without it, Handlebars helpers like
 * `{{version "@uniweb/press"}}` fall through to a bogus default.
 *
 * Returns null if the file doesn't exist, is unparseable, or has a
 * schema version we don't understand. Callers treat null as "no
 * snapshot available" and fall back to their next source.
 */
function loadFrameworkIndex() {
  const indexPath = join(__dirname, 'framework-index.json')
  try {
    const raw = readFileSync(indexPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && parsed.schemaVersion === 1 && parsed.packages) {
      return parsed
    }
  } catch {}
  return null
}

/**
 * Pull `@uniweb/*` package versions out of the framework index's
 * `packages` field and format them as caret ranges. Used as the
 * published-CLI fallback source after the CLI's own deps and the live
 * workspace walk both come up empty.
 */
function readIndexPackages() {
  const index = loadFrameworkIndex()
  if (!index) return {}
  const result = {}
  for (const [name, entry] of Object.entries(index.packages)) {
    if (entry && entry.version) {
      result[name] = `^${entry.version}`
    }
  }
  return result
}

/**
 * Enumerate every `@uniweb/*` package under `framework/*` and return a
 * map of `{ name: '^version' }`. Used to seed the resolved-versions
 * cache so that packages not explicitly listed in the CLI's own deps
 * (press, loom, scholar, schemas, etc.) still have a version available
 * to templates that reference them.
 *
 * Works only in the monorepo. Published CLIs fall through to the
 * framework-index snapshot via readIndexPackages() instead.
 */
function discoverWorkspacePackages() {
  const root = getFrameworkRoot()
  if (!root) return {}
  const found = {}
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return {}
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    const pkgPath = join(root, entry.name, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg.name && pkg.version && pkg.name.startsWith('@uniweb/')) {
        found[pkg.name] = `^${pkg.version}`
      }
    } catch {}
  }
  return found
}

/**
 * Resolve a single version spec to something npm can install. A concrete
 * spec like `^0.9.0` passes through untouched; `workspace:*` is replaced
 * by the on-disk version of the named package; anything still unresolved
 * returns null so the caller can fall back.
 */
function resolveVersionSpec(spec, packageName) {
  if (!spec) return null
  if (spec.startsWith('workspace:')) {
    return readWorkspaceVersion(packageName)
  }
  return spec
}

/**
 * Get resolved versions for @uniweb/* packages.
 *
 * Priority (highest first):
 *
 *   1. A concrete version spec already in the CLI's own `package.json`
 *      (the state after an npm publish: `workspace:*` is resolved by
 *      pnpm to a real version).
 *   2. Live workspace walk — every `@uniweb/*` package found under
 *      `framework/*` at CLI invocation time. This is the path that
 *      matters for local dev: a freshly-added package becomes
 *      reachable from every locally-run CLI without republishing.
 *   3. Framework index snapshot — `./framework-index.json`, written by
 *      the publish pipeline's pre-publish hook. This is the path that
 *      matters for published CLIs: the monorepo isn't on disk, so the
 *      snapshot is how the CLI knows about packages it doesn't import
 *      directly (press, loom, scholar, schemas, …).
 *
 * The return shape is stable across all paths: a map of package names
 * to npm-compatible version specs, plus the CLI's own version under
 * the key `uniweb`.
 *
 * @returns {Object} Map of package names to version specs
 */
export function getResolvedVersions() {
  if (resolvedVersions) return resolvedVersions

  const pkg = getCliPackageJson()
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }

  // Seed from the CLI's own deps (the authoritative set when installed from npm).
  const result = {}
  for (const [name, spec] of Object.entries(deps)) {
    if (!name.startsWith('@uniweb/')) continue
    const resolved = resolveVersionSpec(spec, name)
    if (resolved) result[name] = resolved
  }

  // Layer in the live workspace walk. Overrides nothing (dev versions
  // are fresher than anything in the CLI's own deps), but fills in
  // packages the CLI doesn't reference directly.
  const discovered = discoverWorkspacePackages()
  for (const [name, version] of Object.entries(discovered)) {
    if (!result[name]) result[name] = version
  }

  // Final fallback: the vendored framework index snapshot. Only hits
  // when the workspace walk came up empty for a package (published
  // CLI running outside the monorepo). The snapshot is refreshed at
  // publish time, so its view of the world is current as of the CLI's
  // own publish.
  const indexed = readIndexPackages()
  for (const [name, version] of Object.entries(indexed)) {
    if (!result[name]) result[name] = version
  }

  // CLI itself. Caret on the current version — templates referencing
  // `{{version "uniweb"}}` pick up whatever patch/minor ships in the
  // same publish cycle as the template.
  result['uniweb'] = `^${pkg.version}`

  resolvedVersions = result
  return resolvedVersions
}

/**
 * Get a specific package version
 *
 * @param {string} packageName - Package name (e.g., "@uniweb/build")
 * @returns {string} Version spec (e.g., "^0.1.4")
 */
export function getVersion(packageName) {
  const versions = getResolvedVersions()
  return versions[packageName] || null
}

/**
 * Get all versions as a flat object for template data
 *
 * @returns {Object} Versions keyed by simplified names
 */
export function getVersionsForTemplates() {
  const versions = getResolvedVersions()

  return {
    // Full package names
    ...versions,

    // React pinned to the framework's official major (single source: REACT_VERSION above).
    react: REACT_VERSION,
    'react-dom': REACT_VERSION,

    // Simplified names for templates (e.g., {{versions.build}})
    build: versions['@uniweb/build'],
    runtime: versions['@uniweb/runtime'],
    core: versions['@uniweb/core'],
    kit: versions['@uniweb/kit'],
    templates: versions['@uniweb/templates'],
    cli: versions['uniweb'],
  }
}

/**
 * Update @uniweb/* versions in a package.json object
 *
 * @param {Object} pkg - Package.json object
 * @returns {Object} Updated package.json object
 */
export function updatePackageVersions(pkg) {
  const versions = getResolvedVersions()

  const updateDeps = (deps) => {
    if (!deps) return deps
    const updated = { ...deps }
    for (const [name, version] of Object.entries(updated)) {
      if (name.startsWith('@uniweb/') || name === 'uniweb') {
        if (versions[name]) {
          updated[name] = versions[name]
        }
      }
    }
    return updated
  }

  return {
    ...pkg,
    dependencies: updateDeps(pkg.dependencies),
    devDependencies: updateDeps(pkg.devDependencies),
    peerDependencies: updateDeps(pkg.peerDependencies),
  }
}
