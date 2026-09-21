/**
 * `uniweb forget --backend <url>` — remove everything this project recorded about
 * one backend, and nothing else.
 *
 * ## What it removes
 *
 *   - that backend's section of `sync.json` — the site uuid, the record map, asset
 *     ids, provisioned services and the rest of what it minted;
 *   - that backend's section of `.uniweb/backend-cache.json`.
 *
 * Every other backend is untouched, which is only possible because both files are
 * keyed by backend origin.
 *
 * ## What it deliberately does NOT touch
 *
 * ⛔ **Record files.** A record's `$uuid` is its OWN id, not any backend's (plan §6).
 * It is written once, on the record's first push anywhere, and never changes after;
 * removing it would delete the record's identity, which is not what forgetting a
 * backend means. *[Diego, 2026-09-20.]*
 *
 * ⛔ **The backend.** The site still exists there. This removes local records only —
 * deleting the site on the backend is a different operation, on the backend's side.
 *
 * ## Why it exists
 *
 * A script can push a template site to a short-lived dev server and then remove the
 * traces of it, without discarding the rest of the project. *[Diego, 2026-09-20 —
 * which is also why traceless publish was dropped: push and pull leave traces too,
 * so a publish-only flag could never have been the whole answer.]*
 *
 * ⚠️ `--backend` is REQUIRED even when the project has synced with only one backend.
 * Forgetting a backend you still use means its next push creates a second site
 * there. For a removal, naming the target is the right amount of friction.
 */

import { readFlagValue } from '../utils/args.js'
import { checkFlags } from '../utils/flag-guard.js'
import { resolveSiteDir } from './deploy.js'
import { forgetBackendCache } from '../backend/site-sync.js'
import { clearBackend, readBackendState } from '@uniweb/build/uwx'
import { syncedBackends, normalizeOrigin } from '../utils/site-identity.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`)
}

/**
 * @param {string[]} args
 * @returns {Promise<{ exitCode: number, forgot?: string, removed?: string[] }>}
 */
export async function forget(args = []) {
  const badFlag = checkFlags('forget', args)
  if (badFlag) {
    say.err(badFlag.message)
    return { exitCode: 2 }
  }

  const siteDir = await resolveSiteDir(args, 'forget')
  const known = syncedBackends(siteDir)
  const flag = readFlagValue(args, '--backend')

  if (!flag) {
    say.err('Name the backend to forget: uniweb forget --backend <url>')
    if (known.length) {
      say.dim(`This project has synced with: ${known.join(', ')}`)
    } else {
      say.dim('This project has not synced with any backend — there is nothing to forget.')
    }
    return { exitCode: 2 }
  }

  const origin = normalizeOrigin(flag)
  if (!origin) {
    say.err(`Not a URL: ${flag}`)
    return { exitCode: 2 }
  }

  // Read before removing, so the report can say what the section held.
  const state = readBackendState(siteDir, origin)
  const removed = []
  if (clearBackend(siteDir, origin)) removed.push('sync.json')
  if (forgetBackendCache(siteDir, origin)) removed.push('.uniweb/backend-cache.json')

  // Idempotent on purpose: a script calls this after every run, and a second call
  // (or a call for a backend the push never reached) is not an error.
  if (!removed.length) {
    say.info(`Nothing recorded for ${origin} — nothing to forget.`)
    if (known.length) say.dim(`This project has synced with: ${known.join(', ')}`)
    return { exitCode: 0, forgot: origin, removed }
  }

  say.ok(`Forgot ${c.bold}${origin}${c.reset}`)
  if (state.site?.uuid) say.dim(`site ${state.site.uuid}`)
  const counts = [
    ['records', state.records],
    ['assets', state.assets]
  ]
    .map(([name, map]) => [name, map ? Object.keys(map).length : 0])
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${n} ${name}`)
  if (counts.length) say.dim(counts.join(' · '))
  say.dim(`removed from ${removed.join(' and ')}`)
  say.dim('The site still exists on that backend; this removed only what this project recorded.')

  return { exitCode: 0, forgot: origin, removed }
}
