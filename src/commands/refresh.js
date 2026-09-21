/**
 * uniweb refresh — catch up with everything outside your working copy.
 *
 * A developer on a synced site has TWO independent external sources, and nothing
 * in the tool used to connect them:
 *
 *   - the git remote — teammates' commits;
 *   - the backend    — content authors' edits, made in the app.
 *
 * Someone who runs only `git pull` silently misses every app edit; someone who
 * runs only `uniweb pull` misses their teammates. The person most likely to be
 * caught out is exactly the one starting their day believing they are current.
 * This is the one command for that: run it in the morning, or before a milestone.
 *
 * READ-ONLY, and that is the load-bearing decision. It never pushes. Because it
 * cannot ship anything, it can be run reflexively without weighing consequences —
 * which is the whole point of a start-of-day command. A version that also pushed
 * would be one you had to think about first, and so one people would stop running.
 *
 * Order is deliberate: git first, then the backend. The three-way merge's common
 * ancestor is the COMMITTED version of each file, so taking teammates' commits
 * first makes that ancestor fresher and the merge more accurate. And if git itself
 * conflicts, refresh stops there — one source of conflict at a time.
 *
 * Exits NON-ZERO when a merge left conflicts, the way a conflicted `git merge`
 * does. That is what makes `uniweb refresh && uniweb push` correct by
 * construction: without it, the obvious one-liner ships conflict markers into live
 * content. If a `sync` verb is ever wanted, it is that chain.
 *
 * Usage:
 *   uniweb refresh                 git pull, then merge the backend's content
 *   uniweb refresh --no-git        skip the git remote; backend only
 *   uniweb refresh --no-backend    skip the backend; git only
 *   uniweb refresh --backend <url> Override the backend origin
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { resolveSiteDir } from './deploy.js'
import {
  isGitRepo,
  hasRemote,
  pullRemote,
  headProvenance
} from '../utils/git.js'
import { probeUnpushed } from '../backend/site-sync.js'
import { resolveBackendOrigin } from '../backend/client.js'
import { readBackendState } from '@uniweb/build/uwx'
import { checkFlags } from '../utils/flag-guard.js'

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

// A site is backend-synced once it has an identity to pull by — on THIS backend,
// from sync.json. It read `site.yml::$uuid`, so after step 4 refresh treated every
// project as unsynced and skipped the backend half of its check.
//
// ⛔ `backend` is the one the delegated pull will use: the backend the user is logged in
// to. (For part of 2026-09-21, `refresh --backend X` checked one backend's sync state and
// pulled from another; the flag is gone from the backend verbs since.)
function siteContentUuid(siteDir, backend) {
  try {
    return readBackendState(siteDir, backend).site?.uuid || null
  } catch {
    return null
  }
}

/**
 * @param {string[]} args
 * @param {object} [deps] - injectable seams for testing, mirroring pull.js:
 *   `resolveSiteDir`, and `pull` (so the backend step can be driven without a
 *   network or a real backend).
 */
export async function refresh(args = [], deps = {}) {
  // An unrecognized flag is invisible to a literal scan, so it silently keeps the
  // default — and for `--backend` the default can be production. This verb never
  // sent data anywhere, which is why it went unguarded; but it DELEGATES to `pull`,
  // and a mistyped `--backend` is not forwarded, so the pull runs against whatever
  // the origin ladder resolves instead of the backend the user named.
  //
  // `sync` validates the UNION of both halves and forwards raw argv, so a legal
  // `uniweb sync --force` would be rejected here. It passes `skipFlagCheck`.
  if (!deps.skipFlagCheck) {
    const bad = checkFlags('refresh', args)
    if (bad) {
      say.err(bad.message)
      return { exitCode: 2 }
    }
  }
  const skipGit = args.includes('--no-git')
  const skipBackend = args.includes('--no-backend')
  const resolveSite = deps.resolveSiteDir || resolveSiteDir
  const siteDir = await resolveSite(args, 'refresh')

  // Which sources this run actually consulted. Reported at the end, because
  // "up to date" is a different claim from "up to date with the two things I
  // happened to be able to check" — and the second is all we can ever honestly
  // say. Silently skipping a source is how someone concludes they are current
  // when they are not.
  const consulted = []
  const skipped = []
  let conflicts = 0

  // ── 1. the git remote ─────────────────────────────────────────────────────
  if (skipGit) {
    skipped.push('git (--no-git)')
  } else if (!isGitRepo(siteDir)) {
    skipped.push('git (not a repository)')
  } else if (!hasRemote(siteDir)) {
    skipped.push('git (no remote configured)')
  } else {
    say.info('Pulling from the git remote…')
    const r = pullRemote(siteDir)
    if (!r.ok) {
      say.err('git pull failed — resolve this before continuing.')
      for (const line of r.message.split('\n').slice(0, 6)) say.dim(line)
      // Deliberately stop. Layering the backend's content on top of an unresolved
      // git state gives the user two independent conflicts at once, and no clear
      // order to address them in.
      return { exitCode: 1 }
    }
    say.dim(
      r.changed
        ? 'Took new commits from the remote.'
        : 'Already up to date with the remote.'
    )
    consulted.push('git')
  }

  // ── 2. the backend ────────────────────────────────────────────────────────
  // The backend the delegated pull talks to — the one you are logged in to
  // (resolveBackendOrigin). Everything below asks about THAT one.
  const backend = resolveBackendOrigin()
  if (skipBackend) {
    skipped.push('backend (--no-backend)')
  } else if (!siteContentUuid(siteDir, backend)) {
    skipped.push('backend (this site has never been synced)')
  } else {
    say.info("Merging the backend's content…")
    const pull = deps.pull || (await import('./pull.js')).pull
    // `--merge` rather than a plain pull: an author editing a different part of the
    // same section is not a conflict, and should not be presented as one.
    // Nothing of refresh's own argv is forwarded: the pull goes to the backend you are
    // logged in to, as refresh does, and authenticates the same way.
    const res = await pull(['--merge'])
    conflicts = res?.merge?.conflicted?.length ?? 0
    if (res?.exitCode && !conflicts) {
      // Failed for a reason other than conflicts — say so plainly rather than
      // reporting a clean refresh over a lane that never ran.
      say.err('Could not merge the backend content.')
      return { exitCode: res.exitCode }
    }
    consulted.push('backend')
  }

  // ── 3. where that leaves you ──────────────────────────────────────────────
  console.log('')
  if (consulted.length) say.dim(`Checked: ${consulted.join(', ')}`)
  for (const s of skipped) say.dim(`Skipped: ${s}`)

  const git = headProvenance(siteDir)
  if (git)
    say.dim(
      `Commit : ${git.sha.slice(0, 8)}${git.dirty ? ' (working tree has changes)' : ''}`
    )

  // What is still yours to send. The point of a milestone check is knowing both
  // directions, not just that you took what was waiting.
  if (!skipBackend && siteContentUuid(siteDir, backend)) {
    try {
      // Whose asset ids the comparison reads — see status.js. Offline, so the
      // origin is resolved rather than taken from a client.
      const probe = await probeUnpushed(siteDir, { backend })
      if (probe.changed)
        say.dim(
          `Unpushed: ${probe.changed} entit${probe.changed === 1 ? 'y' : 'ies'} changed locally`
        )
    } catch {
      /* the probe is a courtesy; never fail a refresh over it */
    }
  }

  console.log('')
  if (conflicts) {
    say.err(
      `${conflicts} file(s) need you to resolve conflicts before pushing.`
    )
    return { exitCode: 1 }
  }
  say.ok('Up to date.')
  return { exitCode: 0 }
}

export default refresh
