/**
 * Workspace Detection Utilities
 *
 * Detects workspace structure (pnpm-workspace.yaml or package.json workspaces)
 * and classifies packages as foundations or sites.
 * Used by commands to auto-detect targets when run from workspace root.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { workspacePackages } from './workspace-packages.js'

// `classifyPackage` from @uniweb/build is loaded lazily — this module
// is statically imported by index.js (for `findWorkspaceRoot`), and a
// top-level @uniweb/build import would crash `npx uniweb@latest create`
// before any command runs (the npx scratch dir has only the CLI's
// declared deps; @uniweb/build comes from a project's node_modules).
let _classifyPackageSync = null
async function getClassifier() {
  if (!_classifyPackageSync) {
    const mod = await import('@uniweb/build')
    _classifyPackageSync = mod.classifyPackage
  }
  return _classifyPackageSync
}

/**
 * Check if a directory is a workspace root.
 * Recognizes pnpm-workspace.yaml or package.json with workspaces field.
 * @param {string} dir - Directory to check
 * @returns {boolean}
 */
function hasWorkspaceConfig(dir) {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true
  const pkgPath = join(dir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (Array.isArray(pkg.workspaces)) return true
    } catch {
      // ignore
    }
  }
  return false
}

/**
 * Find workspace root by looking for pnpm-workspace.yaml or package.json workspaces
 * @param {string} startDir - Directory to start searching from
 * @returns {string|null} - Workspace root path or null
 */
export function findWorkspaceRoot(startDir = process.cwd()) {
  let dir = startDir
  while (dir !== dirname(dir)) {
    if (hasWorkspaceConfig(dir)) {
      return dir
    }
    dir = dirname(dir)
  }
  return null
}

/**
 * Get workspace packages from pnpm-workspace.yaml or package.json workspaces —
 * read as pnpm reads them (`workspacePackages`, ./workspace-packages.js).
 *
 * ⛔ Until 2026-10-13 this was its own partial reader of the patterns, which saw
 * `x/*` and plain paths only: `update`, which surveys through it, could not see a
 * project's `<project>/src` package as `add project` lists it — by a pattern whose
 * first folder is a star — and reported a stale one as aligned.
 *
 * @param {string} workspaceRoot
 * @returns {Promise<string[]>} - Array of package directories (relative paths)
 */
export async function getWorkspacePackages(workspaceRoot) {
  return workspacePackages(workspaceRoot)
}

/**
 * Classify a package as foundation, site, or unknown.
 *
 * Re-exports the canonical (sync) classifier from @uniweb/build, kept
 * async-shaped here so existing call sites continue to work without an
 * await-removal sweep. New code should import directly from @uniweb/build.
 *
 * @param {string} packagePath - Full path to package directory
 * @returns {Promise<'foundation'|'site'|null>}
 */
export async function classifyPackage(packagePath) {
  const classify = await getClassifier()
  return classify(packagePath)
}

/**
 * Find all foundations in workspace
 * @param {string} workspaceRoot
 * @returns {Promise<string[]>} - Array of foundation paths (relative to workspace root)
 */
export async function findFoundations(workspaceRoot) {
  const [packages, classify] = await Promise.all([
    getWorkspacePackages(workspaceRoot),
    getClassifier()
  ])
  return packages.filter(
    (pkg) => classify(join(workspaceRoot, pkg)) === 'foundation'
  )
}

/**
 * Find all sites in workspace
 * @param {string} workspaceRoot
 * @returns {Promise<string[]>} - Array of site paths (relative to workspace root)
 */
export async function findSites(workspaceRoot) {
  const [packages, classify] = await Promise.all([
    getWorkspacePackages(workspaceRoot),
    getClassifier()
  ])
  return packages.filter((pkg) => classify(join(workspaceRoot, pkg)) === 'site')
}

/**
 * Check if current directory is the workspace root
 * @param {string} dir - Directory to check
 * @returns {boolean}
 */
export function isWorkspaceRoot(dir = process.cwd()) {
  return hasWorkspaceConfig(dir)
}

/**
 * Interactive prompt to select from multiple options.
 *
 * Accepts plain strings (title === value) or `{ title, value, description }`
 * objects. `prompts` reveals a choice's description only while that row is
 * highlighted, so put the always-visible qualifier in `title` and the
 * fuller explanation in `description`.
 *
 * @param {string} message - Prompt message
 * @param {Array<string|{title: string, value?: any, description?: string}>} choices
 * @returns {Promise<any|null>} - Selected value, or null if cancelled
 */
export async function promptSelect(message, choices) {
  const prompts = (await import('prompts')).default

  const response = await prompts({
    type: 'select',
    name: 'value',
    message,
    choices: choices.map((c) =>
      typeof c === 'string'
        ? { title: c, value: c }
        : {
            title: c.title,
            value: c.value !== undefined ? c.value : c.title,
            description: c.description
          }
    )
  })

  return response.value ?? null
}
