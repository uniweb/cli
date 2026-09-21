/**
 * The project's backend-minted identity — read from `sync.json`, never from `site.yml`.
 *
 * ⭐ **`site.yml` holds nothing a backend minted, as of 2026-09-20.** It carried
 * `$uuid`, `$org` and `$backend`; all three moved to
 * `sync.json::backends.<origin>.site`, keyed by the backend that minted them.
 * Spec: `kb/framework/reference/sync-json.md`. Why:
 * `kb/framework/plans/backend-scoped-project-state.md`.
 *
 * ## ⛔ What is GONE, and why nothing replaces it
 *
 * `assertSiteBackendScope` refused a command whose resolved origin disagreed with
 * the project's recorded `$backend`. It existed because ONE `$uuid` sat in
 * `site.yml` with no way to say which backend it was for, so it could be read
 * against the wrong one and sent there.
 *
 * ⭐ **Keyed by origin that is unrepresentable.** A command for backend B reads B's
 * section and finds B's ids or nothing at all. There is no configuration in which
 * A's identity reaches B, so there is no mismatch to detect, no stop to print, and
 * no accepted false positive to live with. The guard is not replaced; the shape it
 * guarded against stopped existing.
 *
 * `recordSiteBackend` and `$backend` went with it: the store's KEY is the scope.
 *
 * ## ⛔ NO STATIC `@uniweb/build` IMPORT
 *
 * This module is reachable from the CLI's startup graph, and `@uniweb/build` is an
 * OPTIONAL PEER — a static import makes `uniweb --version` die with
 * ERR_MODULE_NOT_FOUND on a global install (`test/smoke-startup.test.js` catches it).
 *
 * ⭐ **`sync.json` is plain JSON, so reading it needs no parser and no dependency.**
 * That is the whole reason the format is JSON rather than YAML: `site.yml`'s
 * equivalent needed a hand-rolled dependency-free fallback WRITER to survive the
 * same constraint. Writes go through `@uniweb/build/uwx`'s store, which is the one
 * implementation; this file only reads.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { DEFAULT_BACKEND_ORIGIN } from './config.js'

/** A bare origin with no trailing slash, or null when unparseable. */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * `sync.json`'s backends map, or `{}`. Read-only, dependency-free — see the header.
 *
 * ⚠️ A second READER of a format whose writer lives in `@uniweb/build`. Deliberate,
 * and bounded: it parses one object and normalizes its keys. The shape it assumes is
 * exactly what `sync-store.js` writes, and `test/two-backends.test.js` drives both.
 */
function readBackends(siteDir) {
  const p = join(siteDir, 'sync.json')
  if (!existsSync(p)) return {}
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    const backends = parsed?.backends
    if (!backends || typeof backends !== 'object' || Array.isArray(backends)) return {}
    const out = {}
    for (const [origin, state] of Object.entries(backends)) {
      const key = normalizeOrigin(origin)
      if (key && state && typeof state === 'object') out[key] = state
    }
    return out
  } catch {
    return {}
  }
}

/**
 * The identity this project holds for ONE backend.
 *
 * @param {string} siteDir
 * @param {string} origin
 * @returns {{ uuid: string|null, org: string|null }}
 */
export function readSiteIdentity(siteDir, origin) {
  const key = normalizeOrigin(origin)
  const site = key ? readBackends(siteDir)[key]?.site : null
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return { uuid: str(site?.uuid), org: str(site?.org) }
}

/** Every backend this project has synced with, sorted. */
export function syncedBackends(siteDir) {
  return Object.keys(readBackends(siteDir)).sort()
}

/**
 * The backend a bare site verb should target, from what this project has synced
 * with — the tier that replaced `site.yml::$backend` in the origin ladder.
 *
 * ⭐ **Exactly one synced backend answers; several do not.** This is the same rule
 * `login` uses for "the known single host": the 98% never choose, and ambiguity is
 * refused rather than guessed. With several, the caller falls through to
 * `deploy.yml`'s default target and then to the session.
 *
 * ⛔ **Returns null rather than a default when nothing is synced.** "Absent means
 * the default" is right for a comparison and wrong in a precedence chain, where
 * absent has to mean "defer to the next tier" — feeding a defaulted value here
 * would shadow `uniweb login --backend <local>` on every unsynced project.
 *
 * @param {string} siteDir
 * @returns {string|null}
 */
export function resolveSyncedBackend(siteDir) {
  const all = syncedBackends(siteDir)
  return all.length === 1 ? all[0] : null
}

/**
 * What to tell someone whose project has synced with several backends and who named
 * none — the ambiguity `resolveSyncedBackend` declines to guess at.
 *
 * @returns {string|null} a message, or null when there is no ambiguity
 */
export function describeBackendAmbiguity(siteDir) {
  const all = syncedBackends(siteDir)
  if (all.length < 2) return null
  return (
    `This project has synced with ${all.length} backends: ${all.join(', ')}.\n` +
    '  Name one with --backend <url>, or set a default target in deploy.yml.'
  )
}

/**
 * The single backend of the site project `startDir` sits in — for `login`, which is
 * not a site verb and resolves no site directory of its own.
 *
 * ⭐ **Conservative by construction: it answers only when there is exactly ONE
 * candidate site AND that site has synced with exactly one backend.** A workspace of
 * several sites has no single answer, and a confident guess aimed at the wrong one
 * is worse than saying nothing.
 *
 * @param {string} startDir
 * @returns {{ siteDir: string, backend: string }|null}
 */
export function findNearbySiteBackend(startDir) {
  const answer = (dir) => {
    const backend = resolveSyncedBackend(dir)
    return backend ? { siteDir: dir, backend } : null
  }

  // 1. Walk UP for the site we are standing in or under. Bounded: a `site.yml` more
  //    than a few levels above is not "the project you are in", it is a coincidence.
  let dir = startDir
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, 'site.yml'))) return answer(dir)
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }

  // 2. Standing AT a project root, the site is one level down — `site/` in the
  //    default layout, or a lone entry under `sites/`. Two or more is a workspace,
  //    which is exactly the ambiguity above.
  const candidates = []
  if (existsSync(join(startDir, 'site', 'site.yml'))) candidates.push(join(startDir, 'site'))
  const sitesDir = join(startDir, 'sites')
  if (existsSync(sitesDir)) {
    let entries = []
    try {
      entries = readdirSync(sitesDir, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const d = join(sitesDir, e.name)
      if (existsSync(join(d, 'site.yml'))) candidates.push(d)
    }
  }
  if (candidates.length !== 1) return null
  return answer(candidates[0])
}

export { DEFAULT_BACKEND_ORIGIN }
