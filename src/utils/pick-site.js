/**
 * Which site a command means, in a workspace of several.
 *
 * ⭐ ONE RULE, for every verb that works on a site. A name says which, and with none the folder
 * you stand in does: inside a site, that site; elsewhere, the one site in the nearest folder that
 * holds any, so `marketing/` and `marketing/src/` both mean `marketing/site`. A folder holding
 * several says nothing, and the workspace root is never that folder: from there, each verb does
 * what it does with no answer (`dev` the first site, a push asks).
 *
 * ⛔ Until 2026-10-31 only `snapshot` looked. `uniweb dev` inside `marketing/site` served the
 * workspace's first site, and a push from `docs/` asked which site, or stopped when nothing
 * could ask.
 *
 * Dependency-free, like what is reached before a project's packages are installed.
 */

import { dirname, isAbsolute, join, relative, sep } from 'node:path'

/** Is `path` the folder `dir`, or inside it? */
const within = (dir, path) => {
  const rel = relative(dir, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * The site a working directory means, or null when it says nothing.
 *
 * @param {string[]} paths - the workspace's sites, relative to its root
 * @param {string} rootDir - the workspace root
 * @param {string} cwd - the working directory
 * @returns {string|null} one of `paths`
 */
export function siteAround(paths, rootDir, cwd) {
  const inside = paths.find((p) => within(join(rootDir, p), cwd))
  if (inside) return inside
  for (let dir = cwd; dir !== rootDir && within(rootDir, dir); dir = dirname(dir)) {
    const held = paths.filter((p) => within(dir, join(rootDir, p)))
    if (held.length === 1) return held[0]
    if (held.length > 1) return null
  }
  return null
}

/**
 * The site a name means: a package's name, a site's folder, or a folder holding exactly one site
 * (a project's name, `marketing` for `marketing/site`). Null when it means none.
 *
 * @param {Array<{name: string, path: string}>} sites
 * @param {string} name
 */
export function siteNamed(sites, name) {
  const exact = sites.find((s) => s.name === name) || sites.find((s) => s.path === name)
  if (exact) return exact
  const folder = name.replace(/\/+$/, '')
  const held = sites.filter((s) => s.path === folder || s.path.startsWith(`${folder}/`))
  return held.length === 1 ? held[0] : null
}

/**
 * The site a command applies to: named, else the one the working directory means, else the only
 * one. With several and nothing to say which, the first, marked `ambiguous`, for the caller to say so.
 *
 * @param {Array<{name: string, path: string}>} sites
 * @param {string} rootDir
 * @param {{ requested?: string|null, cwd: string }} opts
 * @returns {{ site: {name: string, path: string}|null, ambiguous?: boolean }}
 */
export function pickSite(sites, rootDir, { requested, cwd }) {
  if (requested) return { site: siteNamed(sites, requested) }
  const here = siteAround(sites.map((s) => s.path), rootDir, cwd)
  if (here) return { site: sites.find((s) => s.path === here) }
  return { site: sites[0] ?? null, ambiguous: sites.length > 1 }
}
