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

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_BACKEND_ORIGIN } from './config.js'

/** A bare origin with no trailing slash, or null when unparseable. */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    // http(s) only — `localhost:8080` parses as a scheme with the origin "null".
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
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
 * The backends this project HAS synced with, when `origin` is not one of them — or null.
 *
 * Every backend verb goes to the backend the user is logged in to *[Diego, 2026-09-21]*,
 * so it can land where this project has no site while it has one elsewhere. A push
 * there CREATES a second site rather than updating the one the project knows, and the
 * owner question it asks does not say why — this is what lets the verb say it first.
 *
 * @param {string} siteDir
 * @param {string} origin - where the verb resolved to
 * @returns {string[]|null}
 */
export function syncedElsewhere(siteDir, origin) {
  const key = normalizeOrigin(origin)
  const known = syncedBackends(siteDir)
  if (!key || !known.length || known.includes(key)) return null
  return known
}

/**
 * The heads-up for `syncedElsewhere`, as lines — each verb prints them with its own
 * reporter. Only worth saying when the verb was not TOLD where to go: a `--backend` the
 * user typed is already a decision.
 *
 * ⚖️ Worded for where the verb GOES, not for why: it is the logged-in backend, or — logged
 * in nowhere — the default one, where the login it is about to ask for will be.
 *
 * @param {string[]} known
 * @param {string} origin
 * @param {'push'|'publish'} verb
 */
export function describeSyncedElsewhere(known, origin, verb) {
  const where = known.length === 1 ? `site is on ${known[0]}` : `sites are on ${known.join(', ')}`
  return [
    `This project's ${where} — not on ${origin}, where this ${verb} goes.`,
    `It creates a new site there. To ${verb} to ${known.length === 1 ? 'that one' : 'one of those'} instead: uniweb login --backend <url>`
  ]
}

export { DEFAULT_BACKEND_ORIGIN }
