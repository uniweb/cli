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
  return (
    (spec || '')
      .replace(/^[\^~>=<\s]+/, '')
      .trim()
      .split(/\s+/)[0] || ''
  )
}

/**
 * How far a bump moves, in the terms our versioning actually uses.
 *
 * ⭐ **In 0.x the MINOR slot is the breaking one, and it is the only channel we
 * have.** `scripts/framework/publish.js` derives a package's bump from its own
 * commits: a breaking marker means minor, everything else patch. So
 * `^0.14.1 → ^0.16.0` is two breaking releases and `^0.15.0 → ^0.15.2` is not —
 * and until 2026-09-02 `update` printed both as `behind`, in the same colour,
 * and `--yes` applied them without a word.
 *
 * That is the one signal the version scheme exists to send, discarded by the
 * command we tell every project to run — `AGENTS.md` ships that instruction
 * into every scaffold. The `flows` lane crossed `@uniweb/core` `^0.14.1 →
 * ^0.15.0` this way and learned it afterwards, from a changelog.
 *
 * @param {string} from - the currently declared range or version
 * @param {string} to   - the version the matrix carries
 * @returns {'patch'|'minor'|'major'|'none'}
 */
export function bumpClass(from, to) {
  const [aMaj = 0, aMin = 0, aPat = 0] = stripVersionRange(from).split('.').map(Number)
  const [bMaj = 0, bMin = 0, bPat = 0] = stripVersionRange(to).split('.').map(Number)
  if (bMaj !== aMaj) return 'major'
  if (bMin !== aMin) return 'minor'
  if (bPat !== aPat) return 'patch'
  return 'none'
}

/**
 * Is this crossing one a consumer must act on?
 *
 * A major always is. A minor is **when the major is 0**, because that is where
 * our scheme puts breaking changes — and npm agrees, which is the check that
 * makes this more than our own convention: `^0.14.1` admits `0.14.x` and
 * refuses `0.15.0`, so the range itself already treats the slot as a wall.
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function isBreakingBump(from, to) {
  const cls = bumpClass(from, to)
  if (cls === 'major') return true
  if (cls !== 'minor') return false
  return Number(stripVersionRange(to).split('.')[0]) === 0
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
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch {
      continue
    }

    for (const sectionName of [
      'dependencies',
      'devDependencies',
      'peerDependencies'
    ]) {
      const section = pkg[sectionName]
      if (!section) continue
      for (const [name, current] of Object.entries(section)) {
        if (!(name.startsWith('@uniweb/') || name === 'uniweb')) continue
        const target = targets[name]
        if (!target) continue
        const cmp = compareSemver(target, current)
        let status
        if (cmp > 0) {
          status = 'behind'
          anyDrift = true
        } else if (cmp < 0) {
          status = 'ahead'
          anyAhead = true
        } else {
          status = 'aligned'
        }
        rows.push({
          relDir: relDir || '(root)',
          section: sectionName,
          name,
          current,
          target,
          status,
          // Classified here rather than at print time so every consumer of a
          // survey row gets the same answer — the report, the summary, and any
          // gate a caller applies.
          bump: status === 'behind' ? bumpClass(current, target) : 'none',
          breaking: status === 'behind' && isBreakingBump(current, target)
        })
      }
    }
  }

  return { targets, rows, anyDrift, anyAhead }
}
