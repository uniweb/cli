/**
 * The project's SYNC SCOPE — reading and asserting `site.yml::$backend`.
 *
 * A project that has synced holds backend-minted identity on **four** surfaces:
 *
 *   · `site.yml::$uuid`               the site-content entity
 *   · every collection record `$uuid` in its own source file (the pull-side match key)
 *   · `assets.json`                   local asset path → content-addressed id
 *   · `.uniweb/sync-cache.json`       item uuids, hashes, base versions
 *
 * All four are meaningless against a different backend, and none of them says which
 * backend it came from. `$backend` is the one fact that scopes all of them — which is
 * why a mismatch is a **stop**, not a fallback: it does not mean "we guessed the wrong
 * default", it means the entire stored surface is foreign.
 *
 * ⛔ **`$backend` is absent for the default backend, deliberately.** The 98% case keeps a
 * clean `site.yml`, and an absent value reads as the default — correct both for a project
 * written before this key existed and for one synced against the default. That inference
 * is monotone: it is never worse than the pre-`$backend` behaviour, which recorded nothing
 * at all.
 *
 * ⚠️ **Reads `site.yml` only, not the legacy `site.yaml`.** That matches every existing
 * identity reader AND all three writers (`writeSiteEntityUuid`, `writeSiteOrg`,
 * `clone.js`'s `seedYamlUuid`), so this module is consistent with what is on disk. It is
 * also a KNOWN GAP, not an oversight: five other readers do accept `site.yaml`, and
 * `upsertYamlScalar` creates a file when missing — so on a `site.yaml` project the writers
 * produce a phantom `site.yml` holding nothing but identity. Closing that is its own change,
 * and it has to move the readers and the writers together or it makes the split worse.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { DEFAULT_BACKEND_ORIGIN } from './config.js'

// ⛔ NO STATIC `@uniweb/build` IMPORT IN THIS FILE — it is an OPTIONAL PEER, and this
// module is reachable from the CLI's startup graph (`index.js` imports `clone` eagerly,
// and `clone` imports this). A static import here makes `uniweb --version` die with
// ERR_MODULE_NOT_FOUND on a global install that has no build package:
//
//   $ npm i -g uniweb && uniweb --version
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@uniweb/build'
//
// `test/smoke-startup.test.js` catches this structurally — and did, on the commit that
// introduced this file. The writer below therefore imports lazily, which also keeps the
// cost off every startup that never writes. Command modules may import build statically;
// anything a `utils/` leaf pulls in cannot.

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
 * The project's identity trio, read from `site.yml`. Every field is independently
 * optional — a project may be unsynced (no `uuid`), on the default backend (no
 * `backend`), or personally owned (no `org`).
 *
 * ⚠️ This is NOT yet the single accessor for `$uuid`. Nine other places still read it
 * directly; they are correct as they stand and were deliberately left alone when the
 * scope check was centralized here (a per-read accessor was solving a coupling problem
 * that one guard solves better). Consolidating them is separable cleanup.
 *
 * @param {string} siteDir
 * @returns {{ uuid: string|null, backend: string|null, org: string|null }}
 */
export function readSiteIdentity(siteDir) {
  const path = join(siteDir, 'site.yml')
  if (!existsSync(path)) return { uuid: null, backend: null, org: null }
  let y
  try {
    y = yaml.load(readFileSync(path, 'utf8'))
  } catch {
    // Unreadable or malformed — report "nothing recorded" rather than throwing. Every
    // caller here is a guard or a default; none of them should be the reason a command
    // dies, and a malformed site.yml has its own, better error elsewhere.
    return { uuid: null, backend: null, org: null }
  }
  if (!y || typeof y !== 'object') return { uuid: null, backend: null, org: null }
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    uuid: str(y.$uuid),
    backend: normalizeOrigin(y.$backend),
    org: str(y.$org)
  }
}

/**
 * The backend this project is bound to, with the default filled in.
 *
 * Use this rather than `readSiteIdentity().backend` wherever an absent value means the
 * default — which is everywhere except a "was it recorded?" question.
 *
 * ⛔ **NOT for the origin ladder.** `resolveBackendOrigin`'s `siteScope` tier must receive
 * the RAW `readSiteIdentity().backend`, which is null when nothing was recorded. Handing
 * it this defaulted value would make the tier fire for EVERY project, and since it sits
 * above the session it would shadow `uniweb login --backend <local>` on any project
 * without `$backend` — i.e. break local development for the 98% that never record one.
 * "Absent means the default" is the right rule for a comparison and the wrong one for a
 * precedence chain, where absent has to mean "defer to the next tier".
 *
 * @param {string} siteDir
 * @returns {string} a bare origin
 */
export function resolveSiteScope(siteDir) {
  return readSiteIdentity(siteDir).backend || DEFAULT_BACKEND_ORIGIN
}

/**
 * Record the sync scope on a site that has just been created or seeded.
 *
 * A no-op for the default backend (see the ⛔ above) and a no-op when the value is
 * already what we would write, so a re-push never dirties `git status`.
 *
 * @param {string} siteDir
 * @param {string} origin - the backend the site was just created on
 * @param {object} [deps]
 * @param {() => Promise<object>} [deps.loadUwx] - injected module loader. Exists so the
 *        two failure branches below can be TESTED: both are about which `@uniweb/build`
 *        happens to be on disk, which a test cannot otherwise vary — and the too-old
 *        branch is precisely the one that used to fail silently.
 * @returns {Promise<string|null>} the origin recorded, or null when nothing was written
 */
export async function recordSiteBackend(siteDir, origin, deps = {}) {
  const norm = normalizeOrigin(origin)
  if (!norm || norm === DEFAULT_BACKEND_ORIGIN) return null
  if (readSiteIdentity(siteDir).backend === norm) return null
  const loadUwx = deps.loadUwx || (() => import('@uniweb/build/uwx'))
  let mod
  try {
    // Lazy by necessity, not by taste — see the header.
    mod = await loadUwx()
  } catch {
    // No `@uniweb/build` at all. It is an OPTIONAL peer, so this is a supported
    // configuration and not worth a word — the scope simply goes unrecorded, which is
    // the behaviour everyone had before this key existed.
    return null
  }

  // ⚠️ PRESENT BUT TOO OLD is a different problem, and it must not look like the one
  // above. `@uniweb/build` gained `writeSiteBackend` in 0.25.3; against an older copy the
  // import SUCCEEDS and the export is `undefined`, so calling it throws a TypeError that
  // a blanket catch would swallow — leaving the scope silently unrecorded on a project
  // that will later be stopped by the guard and told to add `$backend` by hand. Since the
  // CLI declares build as a peer at a caret range, a lockfile pinned to an older patch
  // reaches exactly this state on a CLI-only upgrade. Say so once.
  if (typeof mod.writeSiteBackend !== 'function') {
    console.error(
      `\x1b[33m⚠\x1b[0m This project's @uniweb/build is too old to record which backend it syncs with — upgrade it (\`npx uniweb@latest update\`), or add \`$backend: ${norm}\` to site.yml.`
    )
    return null
  }

  try {
    mod.writeSiteBackend(siteDir, norm)
    return norm
  } catch {
    // Same rule as `recordSiteOrg`: the uuid is the load-bearing write. Losing the scope
    // note must never fail a create that already succeeded on the backend — the guard
    // degrades to the pre-`$backend` behaviour, which is what everyone had until now.
    return null
  }
}

/**
 * Refuse to act on a site whose stored identity belongs to a different backend.
 *
 * ⭐ **A stop, not a warning.** `BackendClient.token()` already carries an advisory
 * origin-mismatch guard for the SESSION (wrong bearer → a rejected request, recoverable).
 * This is the third leg and it is categorically worse: the stored surface is foreign, so
 * proceeding sends one backend's identity to another. The observed outcomes are a 404
 * whose stock advice destroys the binding, and — on the record lane — a hard refusal
 * (*"item uuids are globally unique; cross-entity move is not supported"*).
 *
 * Silent for an unsynced project (nothing stored yet ⇒ nothing to be foreign) and for a
 * project on the default backend with no explicit override.
 *
 * @param {string} siteDir
 * @param {string} origin - the backend this command resolved to
 * @returns {{ ok: true } | { ok: false, message: string, hint: string[] }}
 */
export function assertSiteBackendScope(siteDir, origin) {
  const { uuid, backend } = readSiteIdentity(siteDir)
  // Nothing minted here yet — a create is exactly what is supposed to happen next, and
  // it will record the scope itself. Checking a project with no stored identity would
  // reject the first push of every new site.
  if (!uuid) return { ok: true }

  const target = normalizeOrigin(origin)
  const bound = backend || DEFAULT_BACKEND_ORIGIN
  if (!target || target === bound) return { ok: true }

  const hint = [
    `site.yml::$uuid (${uuid}) was minted by ${bound}, and the record uuids, assets.json`,
    'and .uniweb/sync-cache.json are scoped to it too. Sending them elsewhere is refused.',
    '',
    `To work with ${bound}:  uniweb login --backend ${bound}   (or pass --backend ${bound})`,
    `To move this project to ${target}, it becomes a NEW site there — clear $uuid, $org and`,
    '$backend from site.yml and delete .uniweb/ and assets.json first.'
  ]

  // ⚠️ THE ONE FALSE POSITIVE, and it prints its own fix.
  //
  // `$backend` is omitted for the default backend, so an ABSENT value is ambiguous: it
  // means "the default" for anything written under this scheme, and "unknown" for a
  // project that synced to a non-default backend BEFORE the key existed. This branch
  // reads absent as the default, so that second project is stopped and told it belongs
  // to a backend it never used.
  //
  // Accepted deliberately rather than softened to a warning, because the alternative is
  // worse in the case that matters: warning-on-absent would leave every DEFAULT-backend
  // project — the 98% — unprotected forever, since those never record the key. Stopping
  // on a guess is only tolerable when the guess prints the one-line correction, so it
  // does. (The population at risk is also near-empty by construction: pre-`$backend`
  // projects on a non-default backend, at a moment when no such backend is running.)
  if (!backend) {
    hint.push(
      '',
      `If this project actually syncs with ${target}, nothing recorded that — say so once:`,
      `  add   $backend: ${target}   to site.yml, and this stops asking.`
    )
  }

  return {
    ok: false,
    message: `This project's stored identity belongs to ${bound}, but this command targets ${target}.`,
    hint
  }
}
