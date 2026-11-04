/**
 * Git awareness for the sync verbs.
 *
 * The CLI's file-based workflow is for people who keep their content in git, so
 * git is the right place to look before doing something destructive to the working
 * tree — rather than building a merge engine to solve a problem the user's VCS
 * already solves better.
 *
 * DETECTED, NEVER REQUIRED. A project may legitimately have no repo, and — more
 * commonly — may live *inside* a larger one: `uniweb create` skips `git init` when a
 * repository already holds it ("common for monorepos/workspaces"), and whole scopes of
 * real projects are versioned by a parent repo rather than being repo roots
 * themselves. So the question is never "is this directory a git root" but "does a
 * repository HOLD this path": is it inside a work tree, in a folder that repository
 * does not ignore. One rule answers it, `repoOf` in `utils/sync-point.js`. Outside
 * one a pull checks out, asking first; in one it merges.
 *
 * ⛔ Until 2026-10-17 this said "is this path tracked by some repo" while the check
 * was `git rev-parse --is-inside-work-tree` alone. That reads as if a folder the
 * repository ignores were outside it, and it was not: a harness's ignored scratch
 * project counted as inside the harness, so `refresh` ran `git pull` on the harness.
 */

import { execFile, execFileSync } from 'node:child_process'
import { repoOf } from './sync-point.js'

// The roots a pull writes into and a push sends from are the build's to say, mounts included: they
// moved to `utils/site-roots.js` on 2026-11-04, which may import `@uniweb/build` — this module may not,
// since the CLI's entry loads it.

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
}

/**
 * Does a repository hold `dir` — is it inside a work tree, in a folder that repository
 * does not ignore (`repoOf`)? False when git is absent, outside any work tree, in an
 * ignored folder, or on any error — the caller treats them all the same way.
 */
export function isGitRepo(dir) {
  return Boolean(repoOf(dir))
}

/**
 * Would the repository that holds `dir` ignore `path` (relative to `dir`)? True or false —
 * or null when no repository holds `dir` (`repoOf`) or git cannot say.
 *
 * Asked of git, never read from a `.gitignore`: the rule may sit in a parent's file (a
 * workspace root naming `site/public/data/`), be spelled with or without its slashes, or
 * come from `.git/info/exclude`, and git reads them all. `--no-index` asks about the rules
 * alone, so a file committed despite them does not read as unignored, and `path` need not
 * exist.
 */
export function ignoredByRepo(dir, path) {
  if (!repoOf(dir)) return null
  try {
    git(['check-ignore', '-q', '--no-index', path], dir)
    return true
  } catch (err) {
    return err?.status === 1 ? false : null
  }
}

/** Does this repo have a remote configured to pull from? */
export function hasRemote(dir) {
  try {
    return git(['remote'], dir).trim().length > 0
  } catch {
    return false
  }
}

/**
 * `git pull`, merging — bring in teammates' commits.
 *
 * ⭐ A MERGE, NOT A REBASE. A pull of the backend's content merges a sync point into the
 * branch (`utils/sync-point.js`), and a rebase would replay that commit onto another
 * base — no longer the backend's content, and no longer a base for the next merge. So the
 * branch is merged with its remote too, whatever `pull.rebase` says, with uncommitted
 * work stashed and put back (`--autostash`). A conflict is git's, settled with git's
 * vocabulary; refresh reports it and steps back.
 *
 * ⛔ Until 2026-10-17 this was `--ff-only`, which refused once a pull had made a merge
 * commit the remote did not have.
 *
 * @returns {{ ok: boolean, conflicts?: boolean, changed: boolean, message: string }}
 */
export function pullRemote(dir) {
  const before = (() => {
    try {
      return git(['rev-parse', 'HEAD'], dir).trim()
    } catch {
      return null
    }
  })()
  try {
    const out = execFileSync('git', ['pull', '--no-rebase', '--no-edit', '--autostash'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const after = (() => {
      try {
        return git(['rev-parse', 'HEAD'], dir).trim()
      } catch {
        return null
      }
    })()
    // ⛔ `--autostash` exits 0 when the uncommitted work it set aside cannot be put back over
    // what the pull brought: the files hold conflict markers and git keeps that work in the
    // stash as well. That is not a clean pull — refresh must stop before the backend's
    // content lands on top of it. *(Read as clean until 2026-10-17.)*
    const unmerged = git(['diff', '--name-only', '--diff-filter=U'], dir).trim()
    if (unmerged) {
      return {
        ok: false,
        conflicts: true,
        changed: Boolean(before && after && before !== after),
        message: [
          'Your uncommitted changes overlap the commits git pull brought.',
          'Settle the markers and `git add` each file, then `git stash drop` — git kept those changes in the stash as well:',
          ...unmerged.split('\n').map((p) => `  ${p}`)
        ].join('\n')
      }
    }
    return {
      ok: true,
      changed: Boolean(before && after && before !== after),
      message: out.trim()
    }
  } catch (err) {
    const msg = [err?.stderr, err?.stdout]
      .map((b) => (b ? String(b) : ''))
      .join('\n')
      .trim()
    return { ok: false, changed: false, message: msg || 'git pull failed' }
  }
}

/**
 * The branch HEAD is on and the one it tracks — `{ branch, remote, merge, tracking }`
 * (`main`, `origin`, `refs/heads/main`, `origin/main`) — or null: no branch, or no upstream.
 */
export function upstreamOf(dir) {
  try {
    const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], dir).trim()
    if (!branch) return null
    const remote = git(['config', '--get', `branch.${branch}.remote`], dir).trim()
    const merge = git(['config', '--get', `branch.${branch}.merge`], dir).trim()
    const tracking = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], dir).trim()
    return remote && merge && tracking ? { branch, remote, merge, tracking } : null
  } catch {
    return null
  }
}

/**
 * The commits HEAD has that its upstream lacks (`ahead`), and the reverse (`behind`) — as of
 * the last fetch, which is all a repository knows without asking its remote. Null with no
 * upstream.
 */
export function aheadBehind(dir) {
  try {
    const [behind, ahead] = git(['rev-list', '--left-right', '--count', '@{u}...HEAD'], dir)
      .trim()
      .split(/\s+/)
      .map(Number)
    return Number.isInteger(ahead) && Number.isInteger(behind) ? { ahead, behind } : null
  } catch {
    return null
  }
}

/**
 * The environment for a git call that asks a remote and must never wait on a person.
 *
 * ⛔ IT NEVER PROMPTS. A credential prompt would hang a command run by an agent, so: no
 * terminal prompt (`GIT_TERMINAL_PROMPT=0`), no credential manager window
 * (`GCM_INTERACTIVE=never`), ssh in batch mode with a connect timeout — added to the ssh
 * command the person configured, never instead of it. The caller bounds the call itself.
 */
export function quietGitEnv(dir, timeoutMs = 5000) {
  let ssh = process.env.GIT_SSH_COMMAND || ''
  try {
    ssh ||= git(['config', '--get', 'core.sshCommand'], dir).trim()
  } catch {
    // not configured
  }
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_SSH_COMMAND: `${ssh || 'ssh'} -o BatchMode=yes -o ConnectTimeout=${Math.ceil(timeoutMs / 1000)}`
  }
}

/**
 * Does the git remote hold commits HEAD does not — teammates' work since the last fetch?
 * Asked with `git ls-remote`, which fetches nothing and writes nothing, so a read-only
 * command can ask it — without a prompt, and bounded (`quietGitEnv`).
 *
 * @param {string} dir
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ moved: boolean, upstream: object } | null>} null when there is no
 *   upstream, or the remote did not answer in time
 */
export async function remoteMoved(dir, { timeoutMs = 5000 } = {}) {
  const upstream = upstreamOf(dir)
  if (!upstream) return null
  const env = quietGitEnv(dir, timeoutMs)
  let out
  try {
    out = await new Promise((resolve, reject) => {
      execFile('git', ['ls-remote', '--', upstream.remote, upstream.merge], { cwd: dir, env, timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) =>
        err ? reject(err) : resolve(stdout)
      )
    })
  } catch {
    return null
  }
  const head = String(out)
    .split('\n')
    .map((line) => line.split('\t'))
    .find(([, ref]) => ref === upstream.merge)?.[0]
  if (!head) return null
  // A head HEAD already holds — fetched earlier, or HEAD's own — is nothing new.
  let held = false
  try {
    git(['merge-base', '--is-ancestor', head, 'HEAD'], dir)
    held = true
  } catch {
    held = false
  }
  return { moved: !held, upstream }
}

/**
 * Provenance for a deploy record: `{ sha, dirty }`, or null outside a repo.
 * Answers "what is actually live?" later, which a version number cannot.
 */
export function headProvenance(dir) {
  if (!isGitRepo(dir)) return null
  try {
    const sha = git(['rev-parse', 'HEAD'], dir).trim()
    const dirty = git(['status', '--porcelain'], dir).trim().length > 0
    return { sha, dirty }
  } catch {
    return null // a repo with no commits yet
  }
}
