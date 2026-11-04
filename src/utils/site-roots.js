/**
 * The places a push sends a site's content from and a pull merges it into, each relative to the site.
 *
 * ⭐ ONE ANSWER, the build's (`siteContentRoots`, `@uniweb/build/uwx`): the site's config, its
 * translations, its pages, layout and records where `paths:` puts them, its media, and each mounted
 * page folder. A mount the site's own repository holds is one of the site's roots like any other —
 * committed with it, sent from it, merged into it. A mount that is a repository of its own is held to
 * its commits by `backend/mounts-before-sending.js`, and one in no repository has none to be held to
 * (`mountHolding`, `utils/mounted-repositories.js`).
 *
 * ⛔ Until 2026-11-04 the CLI kept a list of its own (`siteContentRoots` in `utils/git.js`) that named
 * no mount: a push sent a same-repository mount's uncommitted edits and named HEAD as what it sent,
 * while `uniweb status` counted that folder among what waits to be pushed.
 *
 * Project-local: it imports `@uniweb/build`, which a global `uniweb` may lack, so nothing the CLI's
 * entry loads statically imports this.
 */
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import yaml from 'js-yaml'
import { siteContentRoots } from '@uniweb/build/uwx'
import { mountHolding } from './mounted-repositories.js'
import { repoOf } from './sync-point.js'

function readSiteYml(siteDir) {
  try {
    return yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8')) || {}
  } catch {
    return {} // no or unreadable site.yml — the defaults are right
  }
}

const rootsOf = (siteDir) => siteContentRoots(siteDir, readSiteYml(siteDir))

/**
 * The site's roots: its own, and each mount its repository holds. `media: false` leaves out
 * `public/`, for what a pull writes over outside git.
 *
 * @param {string} siteDir
 * @param {{ media?: boolean }} [opts]
 * @returns {string[]}
 */
export function siteRoots(siteDir, { media = true } = {}) {
  return rootsOf(siteDir)
    .filter((r) => (r.kind === 'media' ? media : r.kind !== 'mount' || mountHolding(siteDir, r.abs).kind === 'site'))
    .map((r) => r.path)
}

/** What a push sends from the files: the site's roots, its media among them. */
export const sentRoots = (siteDir) => siteRoots(siteDir)

/**
 * What each lane of a push carries, as roots: the folder lane the records — their files, and their
 * translations — and the content lane everything else a pull writes, media (`public/`) and the
 * mounts the site's repository holds included. ⚠️ `locales` stays whole on the content side, record
 * translations with it: a root too many there costs a less precise base, never a wrong one.
 */
export function laneRoots(siteDir) {
  const records = rootsOf(siteDir).find((r) => r.kind === 'records').path
  return {
    content: siteRoots(siteDir).filter((r) => r !== records),
    records: [records, 'locales/records'],
  }
}

/**
 * The submodules that hold a mounted folder, each by its path relative to the site: the commit the
 * site's repository records for one is the site's to commit, and `uniweb status` reads a pin that
 * moved as a change waiting. ⭐ The submodule's own path, not the mounted folder's — a folder inside
 * one is no path of the site's repository (`unipress/docs` is in the `unipress` submodule).
 */
export function submoduleMountRoots(siteDir) {
  const repo = repoOf(siteDir)
  if (!repo) return []
  const out = new Set()
  for (const r of rootsOf(siteDir)) {
    if (r.kind !== 'mount') continue
    const held = mountHolding(siteDir, r.abs)
    if (held.kind !== 'submodule') continue
    out.add(posix.relative(repo.prefix.replace(/\/$/, '') || '.', held.submodule.path) || '.')
  }
  return [...out]
}
