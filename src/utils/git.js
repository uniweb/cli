/**
 * Git awareness for the sync verbs.
 *
 * The CLI's file-based workflow is for people who keep their content in git, so
 * git is the right place to look before doing something destructive to the working
 * tree — rather than building a merge engine to solve a problem the user's VCS
 * already solves better.
 *
 * DETECTED, NEVER REQUIRED. A project may legitimately have no repo, and — more
 * commonly — may live *inside* a larger one: `uniweb create` already skips
 * `git init` when it finds itself inside a work tree ("common for
 * monorepos/workspaces"), and whole scopes of real projects are versioned by a
 * parent repo rather than being repo roots themselves. So the question is never
 * "is this directory a git root" but "is this path tracked by some repo", which is
 * the question git itself answers. Callers degrade to an explicit confirmation
 * when the answer is no; sync already requires an account, and a second hard
 * dependency for a safety net we can provide anyway is a bad trade.
 */

import { execFileSync } from 'node:child_process'

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

/**
 * Is `dir` inside a git work tree? False when git is absent, when the path isn't
 * tracked, or on any error — the caller treats all three the same way.
 */
export function isGitRepo(dir) {
  try {
    return git(['rev-parse', '--is-inside-work-tree'], dir).trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Uncommitted work under `relPaths`, relative to `dir`.
 *
 * Counts modified, staged, deleted AND untracked files. Untracked matters as much
 * as modified here: a section file that exists only locally is not on the backend,
 * so a pruning pull deletes it — losing work that was never committed anywhere.
 *
 * @returns {string[]|null} repo-relative-ish paths as git reports them, or `null`
 *   when this isn't a git work tree (distinct from `[]`, which means "clean").
 */
export function uncommittedUnder(dir, relPaths) {
  if (!isGitRepo(dir)) return null
  try {
    const out = git(['status', '--porcelain', '--untracked-files=all', '--', ...relPaths], dir)
    return out
      .split('\n')
      .filter(Boolean)
      // porcelain v1: XY<space>path, and a rename is "orig -> new".
      .map((line) => line.slice(3).trim())
      .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1] : p))
      .filter(Boolean)
  } catch {
    // A path git doesn't know (e.g. none of the roots exist yet) is not an error
    // worth failing a pull over.
    return []
  }
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
