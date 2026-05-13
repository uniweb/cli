/**
 * Workspace `@uniweb/*` dependency survey.
 *
 * Compares the `@uniweb/*` + `uniweb` versions *declared* in every
 * package.json across a workspace against the running CLI's bundled
 * version matrix (`getResolvedVersions`). Shared by `uniweb update`
 * (which fixes the drift) and `uniweb doctor` (which only reports it) so
 * the two never disagree about what "out of date" means.
 *
 * Comparison is on declared specs, not installed (node_modules) versions
 * — that's what's committed and what `git diff` will show after a fix.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getResolvedVersions } from '../versions.js'
import { getWorkspacePackages } from './workspace.js'

/**
 * Strip a leading semver range operator (^, ~, >=, <, …) so two specs can
 * be compared by their underlying version. Range expressions like
 * ">=0.5 <0.7" aren't fully parsed — the first version-shaped token wins.
 * Sufficient for `@uniweb/*` deps, which use `^x.y.z` / `x.y.z`.
 * @param {string} spec
 * @returns {string}
 */
export function stripVersionRange(spec) {
  return (spec || '').replace(/^[\^~>=<\s]+/, '').trim().split(/\s+/)[0] || ''
}

/**
 * Compare two version specs (range prefix tolerated). Returns 1 / -1 / 0.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const pa = stripVersionRange(a).split('.').map(Number)
  const pb = stripVersionRange(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

/**
 * @typedef {object} DepRow
 * @property {string} relDir   Workspace-relative dir, or '(root)'.
 * @property {string} section  'dependencies' | 'devDependencies' | 'peerDependencies'
 * @property {string} name     Package name (e.g. '@uniweb/core' or 'uniweb').
 * @property {string} current  The spec declared in package.json.
 * @property {string} target   The spec the running CLI's matrix wants.
 * @property {'aligned'|'behind'|'ahead'} status  current vs target.
 */

/**
 * Survey a workspace's declared `@uniweb/*` + `uniweb` deps against the
 * running CLI's bundled matrix.
 *
 * @param {string} workspaceDir Absolute path to the workspace root.
 * @returns {Promise<{ targets: Record<string,string>, rows: DepRow[], anyDrift: boolean, anyAhead: boolean }>}
 *   `anyDrift` — at least one dep lags the matrix. `anyAhead` — at least
 *   one dep is newer than the matrix.
 */
export async function surveyWorkspaceDeps(workspaceDir) {
  const targets = getResolvedVersions()
  const packages = await getWorkspacePackages(workspaceDir)
  const dirs = ['', ...packages]
  const rows = []
  let anyDrift = false
  let anyAhead = false

  for (const relDir of dirs) {
    const pkgDir = relDir ? join(workspaceDir, relDir) : workspaceDir
    const pkgPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgPath)) continue
    let pkg
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { continue }

    for (const sectionName of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const section = pkg[sectionName]
      if (!section) continue
      for (const [name, current] of Object.entries(section)) {
        if (!(name.startsWith('@uniweb/') || name === 'uniweb')) continue
        const target = targets[name]
        if (!target) continue
        const cmp = compareSemver(target, current)
        let status
        if (cmp > 0) { status = 'behind'; anyDrift = true }
        else if (cmp < 0) { status = 'ahead'; anyAhead = true }
        else { status = 'aligned' }
        rows.push({ relDir: relDir || '(root)', section: sectionName, name, current, target, status })
      }
    }
  }

  return { targets, rows, anyDrift, anyAhead }
}
