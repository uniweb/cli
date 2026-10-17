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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { repoOf } from './sync-point.js'

/**
 * The files and directories `uniweb pull` writes into.
 *
 * ONE definition, shared by the guard that stops a pull outside git and the merge a
 * pull makes in a repository, whose sync points hold exactly these (and `public/`, where
 * the media land) — a second copy would drift, and a stale list here means a guard that
 * misses or a merge that drops a file. `paths:` can relocate the content roots, so the
 * local site.yml is consulted rather than assuming the defaults.
 */
export function siteContentRoots(siteDir) {
  // ⚠️ `queries.yml` IS AT THE SITE ROOT, and that is why it must be named here.
  // Its predecessor lived at `collections/collections.yml`, so the `collections`
  // root added below already covered it and the bare `'collections.yml'` entry
  // that used to sit in this list resolved to a path no site ever had. A
  // root-level file has no directory entry standing in for it.
  //
  // The records folder's `folder.yml` is the reverse case: it lives in the records
  // directory, which is a root below, so it needs no entry. (It was `records.yml` at
  // the site root until 2026-09-21, and was listed here then.)
  const roots = new Set([
    'site.yml',
    'theme.yml',
    'head.html',
    'queries.yml',
    'locales'
  ])
  let paths = {}
  try {
    paths =
      yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))?.paths || {}
  } catch {
    /* no or unreadable site.yml — the defaults are right */
  }
  roots.add(paths.pages || 'pages')
  roots.add(paths.layout || 'layout')
  roots.add(paths.records || 'records')
  return [...roots]
}

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
