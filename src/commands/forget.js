/**
 * `uniweb forget` — remove what this project recorded about where it has synced and
 * deployed. Local files only; nothing on any backend changes.
 *
 *   uniweb forget --backend <url>   one backend
 *   uniweb forget --all             everything — for a COPY that is to become a new project
 *
 * ## `--backend <url>`
 *
 *   - that backend's section of `sync.json` — the site uuid, the record map, asset
 *     ids, provisioned services and the rest of what it minted;
 *   - that backend's section of `.uniweb/backend-cache.json`;
 *   - the `deploys:` records in `deploy.yml` that name it. ⭐ Its TARGETS stay: a
 *     target is where you chose to ship, not something the backend told us, and the
 *     next publish there simply creates a new site.
 *
 * Every other backend is untouched, which is only possible because all three are
 * keyed by backend.
 *
 * ## `--all`
 *
 * A copied project carries the original's `sync.json`, so its first push updates the
 * ORIGINAL's site — the copy sends uuids that are the original's. `--all` deletes
 * `sync.json`, `.uniweb/backend-cache.json` and `deploy.yml`, after which the copy's
 * next push creates a new site.
 *
 * ⭐ **`deploy.yml` goes whole, targets included** *[Diego, 2026-09-21]*. Its targets
 * name the original's destinations — its Pages project, its bucket, its domain — so a
 * deploy from the copy would overwrite the original there. The copy's first deploy
 * writes a fresh one.
 *
 * ## What neither form touches
 *
 * ⛔ **Record files.** A record's `$uuid` is its OWN id, not any backend's. It is
 * written once, on the record's first push anywhere, and never changes after;
 * removing it would delete the record's identity, which is not what forgetting a
 * backend means. A copy keeps them too: they never reach a backend again once the
 * map that pointed them at the original's entities is gone. *[Diego, 2026-09-20.]*
 *
 * ⛔ **Any backend.** Every site still exists where it was. Deleting one is a
 * different operation, on the backend's side.
 *
 * ## Why it exists
 *
 * Two jobs. A script pushes a template site to a short-lived dev server and then
 * removes the traces of it without discarding the rest of the project (`--backend`)
 * — which is also why traceless publish was dropped: push and pull leave traces too.
 * And someone duplicates a project to start a new site from it (`--all`).
 *
 * ⚠️ **No default target.** Forgetting a backend you still use means its next push
 * creates a second site there, so the verb makes you name it — `--backend` is
 * required even when the project has synced with only one.
 */

import { readFlagValue } from '../utils/args.js'
import { checkFlags } from '../utils/flag-guard.js'
import { resolveSiteDir } from './deploy.js'
import { forgetBackendCache, forgetAllBackendCaches } from '../backend/site-sync.js'
import { clearBackend, forgetSyncStore, readBackendState } from '@uniweb/build/uwx'
import { forgetDeploys, forgetDeployYml } from '@uniweb/build/site'
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
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`)
}

/** "a", "a and b", "a, b and c" */
function listed(items) {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * @param {string[]} args
 * @returns {Promise<{ exitCode: number, forgot?: string[], removed?: string[] }>}
 */
export async function forget(args = []) {
  const badFlag = checkFlags('forget', args)
  if (badFlag) {
    say.err(badFlag.message)
    return { exitCode: 2 }
  }

  const all = args.includes('--all')
  const flag = readFlagValue(args, '--backend')
  if (all && flag) {
    say.err('Use --backend <url> or --all, not both.')
    return { exitCode: 2 }
  }

  const siteDir = await resolveSiteDir(args, 'forget')
  const known = syncedBackends(siteDir)

  if (all) return forgetAll(siteDir)

  if (!flag) {
    say.err('Name what to forget: uniweb forget --backend <url>')
    if (known.length) {
      say.dim(`This project has synced with: ${known.join(', ')}`)
    } else {
      say.dim('This project has not synced with any backend.')
    }
    say.dim('For a copied project that should become a new one: uniweb forget --all')
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
  let deploys = []
  try {
    deploys = await forgetDeploys(siteDir, origin)
    if (deploys.length) removed.push('deploy.yml')
  } catch (err) {
    // Not a stop: the identity above is already forgotten, and a deploy.yml that does
    // not parse fails every deploy on its own. Rewriting a file we could not read
    // would be the one thing worse than leaving it.
    say.warn(`${err.message} — its deploy records were left as they are.`)
  }

  // Idempotent on purpose: a script calls this after every run, and a second call
  // (or a call for a backend the push never reached) is not an error.
  if (!removed.length) {
    say.info(`Nothing recorded for ${origin} — nothing to forget.`)
    if (known.length) say.dim(`This project has synced with: ${known.join(', ')}`)
    return { exitCode: 0, forgot: [origin], removed }
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
  if (deploys.length) {
    say.dim(`deploy records: ${deploys.join(', ')} (the targets stay)`)
  }
  say.dim(`removed from ${listed(removed)}`)
  say.dim('The site still exists on that backend; this removed only what this project recorded.')

  return { exitCode: 0, forgot: [origin], removed }
}

/** `--all`: the three files, whole. */
async function forgetAll(siteDir) {
  const origins = forgetSyncStore(siteDir)
  const cache = forgetAllBackendCaches(siteDir)
  const targets = await forgetDeployYml(siteDir)

  const removed = []
  if (origins) removed.push('sync.json')
  if (targets) removed.push('deploy.yml')
  if (cache) removed.push('.uniweb/backend-cache.json')

  if (!removed.length) {
    say.info('Nothing recorded — this project has not synced or deployed anywhere.')
    return { exitCode: 0, forgot: [], removed }
  }

  say.ok('Forgot every backend and deploy target')
  if (origins?.length) say.dim(`backends: ${origins.join(', ')}`)
  if (targets?.length) say.dim(`deploy targets: ${targets.join(', ')}`)
  say.dim(`removed ${listed(removed)}`)
  say.dim('Its next push creates a new site. Every existing site is untouched.')
  // ⛔ The mistake this cannot prevent: running it in the ORIGINAL. That project's
  // next push would then mint a second site on every backend. Both files are
  // committed, so the way back is one command — say it now, while it is cheap.
  say.dim('If this was the original rather than a copy, restore sync.json and deploy.yml from git.')

  return { exitCode: 0, forgot: origins || [], removed }
}
