/**
 * Is this project a copy of another one in the same workspace?
 *
 * A plain directory copy carries `sync.json`, so the copy holds the ORIGINAL's site
 * on every backend the original synced with — and its first push updates that site.
 * `uniweb forget --all` in the copy is the fix. This is how the CLI notices a copy in
 * which nobody ran it, before the push goes out.
 *
 * ## The signal, and why it is exact
 *
 * **Two directories in one workspace holding the same site uuid on the same
 * backend.** Every create mints a new site, so two directories can only name one site
 * if one got it from the other. Whichever of them pushes, the other is a stale copy
 * of the same site waiting to overwrite it — so refusing is right from both sides.
 *
 * ## Why only within a workspace
 *
 * A teammate's clone holds the same site too, and legitimately: it IS the same
 * project. A clone is a separate checkout, so it is never scanned. The price is the
 * case this cannot see: a copy placed outside the workspace is byte-for-byte a clone,
 * and nothing on disk tells them apart.
 *
 * ## Where it looks
 *
 * The workspace root and two levels below it — where sites live (`site/`, `sites/*`)
 * and where a copy usually lands — plus this site's own siblings, for a site deeper
 * than that. Dot-directories, `node_modules` and `dist` are skipped, and the walk is
 * bounded, so a workspace root found somewhere unexpected costs a few milliseconds,
 * not a disk scan.
 */

import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { findWorkspaceRoot } from './workspace.js'
import { normalizeOrigin, readSiteIdentity } from './site-identity.js'

const SKIP = new Set(['node_modules', 'dist'])
const MAX_ENTRIES = 5000

const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

const within = (dir, root) => {
  const rel = relative(root, dir)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/** Directories holding a `sync.json`, `depth` levels below `dir` at most. */
function collect(dir, depth, out, budget) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (--budget.left < 0) return
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue
    const child = join(dir, entry.name)
    if (existsSync(join(child, 'sync.json'))) out.add(child)
    if (depth > 1) collect(child, depth - 1, out, budget)
  }
}

/**
 * The other directories in this workspace that hold this site's site on `origin`.
 *
 * @param {string} siteDir
 * @param {string} origin - the backend a push is about to go to
 * @returns {string[]} absolute paths, sorted; `[]` when the site has no identity on
 *   that backend yet (its push will create one), or it is in no workspace
 */
export function findSiteCopies(siteDir, origin) {
  const key = normalizeOrigin(origin)
  const mine = key ? readSiteIdentity(siteDir, key).uuid : null
  if (!mine) return []
  const root = findWorkspaceRoot(siteDir)
  if (!root) return []

  const candidates = new Set()
  const budget = { left: MAX_ENTRIES }
  if (existsSync(join(root, 'sync.json'))) candidates.add(root)
  collect(root, 2, candidates, budget)
  const parent = dirname(siteDir)
  if (real(siteDir) !== real(root) && within(parent, root)) collect(parent, 1, candidates, budget)

  const self = real(siteDir)
  const found = []
  for (const dir of candidates) {
    if (real(dir) === self) continue
    if (readSiteIdentity(dir, key).uuid === mine) found.push(dir)
  }
  return found.sort()
}

/**
 * What to tell the person, as a headline and detail lines — each verb prints them
 * with its own reporter.
 *
 * ⚖️ It cannot say WHICH directory is the copy: the two are identical, which is the
 * whole problem. The person knows, because they made it.
 *
 * @param {string[]} copies - from findSiteCopies
 * @param {string} origin
 * @param {'push'|'publish'} verb
 */
export function describeSiteCopies(copies, origin, verb) {
  const here = (dir) => relative(process.cwd(), dir) || '.'
  return {
    headline: `Another project in this workspace holds the same site on ${origin}:`,
    lines: [
      ...copies.map((dir) => `  ${here(dir)}`),
      `One of them is a copy of the other, so a ${verb} from either one updates that site.`,
      'In the copy, run:  uniweb forget --all',
      `The copy then ${verb === 'publish' ? 'publishes' : 'pushes'} as a new site. The original needs nothing.`
    ]
  }
}
