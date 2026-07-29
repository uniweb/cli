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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

/**
 * The files and directories `uniweb pull` writes into.
 *
 * ONE definition, shared by the guard that blocks a pull and the message that
 * tells someone how to recover from a refused push — a second copy would drift,
 * and a stale list here means either a guard that misses or advice that is wrong.
 * `paths:` can relocate the content roots, so the local site.yml is consulted
 * rather than assuming the defaults.
 */
export function siteContentRoots(siteDir) {
  const roots = new Set([
    'site.yml',
    'theme.yml',
    'head.html',
    'collections.yml',
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
  roots.add(paths.collections || 'collections')
  return [...roots]
}

/** Is there uncommitted work where a pull would write? False outside a repo. */
export function hasUncommittedContent(siteDir) {
  const dirty = uncommittedUnder(siteDir, siteContentRoots(siteDir))
  return Array.isArray(dirty) && dirty.length > 0
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
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
    const out = git(
      ['status', '--porcelain', '--untracked-files=all', '--', ...relPaths],
      dir
    )
    return (
      out
        .split('\n')
        .filter(Boolean)
        // porcelain v1: XY<space>path, and a rename is "orig -> new".
        .map((line) => line.slice(3).trim())
        .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1] : p))
        .filter(Boolean)
    )
  } catch {
    // A path git doesn't know (e.g. none of the roots exist yet) is not an error
    // worth failing a pull over.
    return []
  }
}

/**
 * A file's committed content — the COMMON ANCESTOR for a three-way merge.
 *
 * This is the input a merge needs and the backend cannot supply: it keeps no
 * per-version item content, and retaining some so it could feed a merge running on
 * the client would put a permanent second write on its hottest table. It doesn't
 * have to. `uniweb pull` writes the backend's content into these files, so the
 * committed version IS the state both sides diverged from — the ancestor was always
 * on this side, in the tool that already knows how to merge.
 *
 * @returns {Buffer|null} null when the path isn't in HEAD (a file added locally and
 *   never committed has no ancestor, so there is nothing to merge against).
 */
export function showAtHead(dir, relPath) {
  try {
    return execFileSync('git', ['show', `HEAD:${relPath}`], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024
    })
  } catch {
    return null
  }
}

/**
 * Three-way merge, in place: `minePath` is rewritten with the merged result.
 *
 * Delegates to `git merge-file`, which is the same machinery git uses for a merge —
 * text that only one side touched is taken silently, and only genuine overlaps get
 * conflict markers. Building our own would be a worse version of a solved problem.
 *
 * @returns {{ merged: boolean, conflicted: boolean }} `merged:false` means the merge
 *   could not be attempted at all, which is different from attempting it and finding
 *   conflicts — the caller must not conflate them.
 */
export function mergeFile(dir, minePath, basePath, theirsPath, labels = {}) {
  try {
    execFileSync(
      'git',
      [
        'merge-file',
        '-L',
        labels.mine || 'yours (local)',
        '-L',
        labels.base || 'common ancestor',
        '-L',
        labels.theirs || 'theirs (backend)',
        minePath,
        basePath,
        theirsPath
      ],
      { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] }
    )
    return { merged: true, conflicted: false }
  } catch (err) {
    // A positive status is the CONFLICT COUNT and the file still holds a valid
    // merge with markers. Anything else (git missing, unreadable input) means no
    // merge happened and the caller must fall back rather than trust the file.
    if (typeof err?.status === 'number' && err.status > 0 && err.status < 128) {
      return { merged: true, conflicted: true }
    }
    return { merged: false, conflicted: false }
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
 * `git pull --ff-only` — bring in teammates' commits.
 *
 * Fast-forward only, deliberately. A refresh should never silently create a merge
 * commit or drop the user into a rebase they didn't ask for; if the branches have
 * genuinely diverged, that is a git problem the user should handle in git, with
 * git's own vocabulary. We report and step back.
 *
 * @returns {{ ok: boolean, changed: boolean, message: string }}
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
    const out = execFileSync('git', ['pull', '--ff-only'], {
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
