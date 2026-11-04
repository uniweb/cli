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
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import yaml from 'js-yaml'
import { siteContentRoots } from '@uniweb/build/uwx'
import { mountEntriesOf } from '@uniweb/build/site'
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

/**
 * ⭐ WHETHER A PULL WRITES THE APP'S EDITS INTO EACH MOUNT — no setting, but where its folder is
 * [Diego, 2026-11-04: "I don't think it should default to false and I don't even know if it should
 * exist. Ignoring incoming changes and then submitting the unmodified version may be wrong"]:
 * - `writable`: a folder the site's own repository holds, whose files are among the site's roots; or a
 *   folder in a submodule of it (`submodules`), merged in the submodule's own history, git's own pairing
 *   of the two; or, for a site in no repository, a folder inside the site's own. Written like the
 *   site's own pages.
 * - `held`: one a pull cannot merge into, with why — `own`, a repository the site's does not record, a
 *   clone beside it; `none`, a folder no repository holds, or one ignores, or outside the folder of a
 *   site in none; `unchecked`, a submodule not checked out. Its app edits are neither written nor
 *   undone: the copy holds the version it last agreed on (`agreedVersions`, `commands/pull.js`).
 * - `refused`: a mount written as an object, the form `writable` was set in, which the build refuses
 *   too. The pull stops on it.
 * ⛔ Until 2026-11-04 a mount was written only where the site marked it `writable: true`, and the next
 * push undid every app edit to any other.
 *
 * @param {string} siteDir
 * @returns {{ writable: string[], held: Array<{ segment: string, path: string, why: 'own'|'none'|'unchecked' }>,
 *   refused: Array<{ segment: string, path: string|null }>,
 *   submodules: Array<{ segment: string, at: string, root: string, repo: object }> }} `submodules`: each
 *   mount in one, with the submodule's path from the site repository's top, the mounted folder's path
 *   in it, and its `repoOf`
 */
export function writableMounts(siteDir) {
  const repo = repoOf(siteDir)
  const writable = []
  const held = []
  const refused = []
  const submodules = []
  for (const [segment, folder] of mountEntriesOf(readSiteYml(siteDir).paths)) {
    if (typeof folder !== 'string' || !folder) {
      refused.push({ segment, path: typeof folder?.path === 'string' ? folder.path : null })
      continue
    }
    const abs = resolve(siteDir, folder)
    let why = null
    if (repo) {
      const holding = mountHolding(siteDir, abs)
      if (holding.kind === 'submodule') {
        const top = join(repo.top, holding.submodule.path)
        const sub = repoOf(top)
        if (!sub?.head) why = 'unchecked'
        else submodules.push({ segment, at: holding.submodule.path, root: relative(realOf(top), realOf(abs)).split(sep).join('/') || '.', repo: sub })
      } else if (holding.kind !== 'site') why = holding.kind
    } else {
      const rel = relative(siteDir, abs)
      if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${posix.sep}`) || rel.startsWith('..\\')) why = 'none'
    }
    if (why) held.push({ segment, path: folder, why })
    else writable.push(segment)
  }
  return { writable, held, refused, submodules }
}

const realOf = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** What stops a pull on a mount written as an object, and what replaced it. */
export function refusedMountLines({ segment, path }) {
  return [
    `pages/${segment} in site.yml's paths: is an object. A mount is its folder: \`pages/${segment}: ${path ?? '../docs'}\`.`,
    "  `writable` is retired: a pull writes the app's edits into a mounted folder wherever it can merge them, a folder of the site's repository or of a submodule, and holds them where it cannot."
  ]
}

/** What to tell a person about a mount whose app edits a pull holds, and what lets a pull write them. */
export function heldMountLines({ segment, path, why }) {
  const what =
    why === 'unchecked'
      ? 'a submodule that is not checked out'
      : why === 'own'
        ? "a repository of its own, which the site's repository does not record"
        : "a folder no history of the site's holds"
  const settle =
    why === 'unchecked'
      ? 'Check it out (`git submodule update --init`), then pull to take them.'
      : why === 'own'
        ? "To have a pull write them, make it a submodule of the site's repository."
        : "To have a pull write them, make it part of the site's repository, or a submodule of it."
  return [
    `pages/${segment} comes from ${path}, ${what}, so a pull cannot merge into it: the app's edits to its pages are held — kept on the backend, not written here, and not undone by a push while their files are unchanged.`,
    `  ${settle}`
  ]
}
