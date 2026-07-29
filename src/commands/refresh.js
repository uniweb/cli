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

// Forward a flag AND its value to the delegated verb. `--backend http://x` is two
// argv entries, so a naive filter passes the flag and drops the URL — leaving the
// delegated pull pointed at the default backend while the user believes they
// overrode it. `--backend=http://x` is one entry and passes through as-is.
function collectPassthrough(args, names) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const name = names.find((n) => a === n || a.startsWith(`${n}=`))
    if (!name) continue
    out.push(a)
    if (a === name && args[i + 1] && !args[i + 1].startsWith('-'))
      out.push(args[++i])
  }
  return out
}

// A site is backend-synced once it has an identity to pull by.
function siteContentUuid(siteDir) {
  try {
    const y = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))
    return typeof y?.$uuid === 'string' ? y.$uuid : null
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
  if (skipBackend) {
    skipped.push('backend (--no-backend)')
  } else if (!siteContentUuid(siteDir)) {
    skipped.push('backend (this site has never been synced)')
  } else {
    say.info("Merging the backend's content…")
    const pull = deps.pull || (await import('./pull.js')).pull
    // `--merge` rather than a plain pull: an author editing a different part of the
    // same section is not a conflict, and should not be presented as one.
    const passthrough = collectPassthrough(args, [
      '--backend',
      '--registry',
      '--token'
    ])
    const res = await pull(['--merge', ...passthrough])
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
  if (!skipBackend && siteContentUuid(siteDir)) {
    try {
      const probe = await probeUnpushed(siteDir)
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
