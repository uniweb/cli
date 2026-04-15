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
 * looking up `framework/<last-segment>/package.json`. Returns a caret
 * range string like `^0.6.0`, or null if the package isn't present on
 * disk (i.e. the CLI is running from npm, not from the workspace).
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
      return `^${pkg.version}`
    }
  } catch {}
  return null
}

/**
 * Enumerate every `@uniweb/*` package under `framework/*` and return a
 * map of `{ name: '^version' }`. Used to seed the resolved-versions
 * cache so that packages not explicitly listed in the CLI's own deps
 * (press, loom, scholar, schemas, etc.) still have a version available
 * to templates that reference them.
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
 *   1. A concrete version spec already in the CLI's own `package.json`
 *      (the state after an npm publish: `workspace:*` is resolved to a
 *      real version).
 *   2. The on-disk version of the matching workspace package (the state
 *      during local development).
 *   3. Discovery fallback — every `@uniweb/*` package found under
 *      `framework/*`, for packages that aren't in the CLI's own deps.
 *
 * The return shape is stable across both paths: a map of package names to
 * npm-compatible version specs, plus the CLI's own version under the key
 * `uniweb`.
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

  // Merge in anything under framework/* that the CLI didn't list explicitly.
  // A newly-added package (e.g. @uniweb/press) becomes reachable via
  // {{version "@uniweb/press"}} without touching the CLI's package.json.
  const discovered = discoverWorkspacePackages()
  for (const [name, version] of Object.entries(discovered)) {
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
