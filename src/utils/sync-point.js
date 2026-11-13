/**
 * Sync points — the site as the backend had it, kept as commits.
 *
 * ⭐ THE COMMON ANCESTOR OF A PULL'S MERGE IS A COMMIT. A three-way merge is only as good
 * as its ancestor, and the ancestor of a pull is the last state of the site this history
 * shares with the backend. Kept as a commit it travels with the history — a teammate, a
 * fresh clone, CI all have it — and git merges against it whole: what was added, deleted
 * or renamed on either side, not just what changed in a file both sides hold.
 *
 * A sync point is one of:
 *   · a commit a PULL made — the backend's content written onto the last sync point's
 *     tree, marked by the trailers below, and merged into the branch, so it is shared;
 *   · the commit a PUSH was made from — what the backend then holds — or one a push found
 *     nothing to send from. This copy keeps it (`backend-cache.json`, `syncPoint`), and the
 *     backend can name it on a pull (`x-uniweb-source`, `backend/client.js`), for every
 *     copy that has it.
 *
 * ⚖️ THE NEWEST ONE IS THE BASE; an older one is not simply less precise. Both the files and
 * the backend's content descend from any of them, but between an older one and the
 * newest, both sides hold the same changes — and where one side then changed a hunk back,
 * the older base already reads the old text, so the change-back looks like no change and
 * the merge silently takes the other side. ⛔ Until 2026-10-17 this said "an older one
 * costs conflicts, never content". So no known base is dropped (`madeOnto`), and the
 * backend naming its source is a matter of correctness, not only of fewer conflicts.
 *
 * ⛔ Until 2026-10-17 the ancestor was a per-machine list of the files this copy's last pull
 * wrote, by hash, found again in history by content — and HEAD where the list had no
 * entry. Committed work outside the list was lost: a teammate's new section pruned, a
 * committed record edit overwritten, a fresh clone's committed work reverted, and the
 * committed half of a file edited again since reverted (`test/pull-merge-base.test.js`).
 *
 * Dependency-free: `clone` uses it before a project's packages are installed.
 */

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, dirname, posix, sep } from 'node:path'

export const SYNC_TRAILER = 'Uniweb-Sync'
export const SITE_TRAILER = 'Uniweb-Site'
/**
 * Names the tree of each of a site's roots outside its folder — a mounted folder elsewhere in the
 * repository — in a sync point: `Uniweb-Root: <path>:<tree>`, the path from the repository's top.
 */
export const ROOT_TRAILER = 'Uniweb-Root'
/** Marks the commit a push makes of what it wrote back: `Uniweb-Recorded: <origin> <site>`. */
export const RECORDED_TRAILER = 'Uniweb-Recorded'

const MAX_BUFFER = 1024 * 1024 * 1024

function git(cwd, args, { env, input } = {}) {
  return execFileSync('git', args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    input,
    maxBuffer: MAX_BUFFER,
    stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe']
  })
}
const gitText = (cwd, args, opts) => git(cwd, args, opts).toString('utf8')

/** git's own words when a command fails — what it printed, not our paraphrase. */
export function gitError(err) {
  const said = [err?.stderr, err?.stdout].map((b) => (b ? String(b).trim() : '')).filter(Boolean)
  return said.join('\n') || err?.message || 'git failed'
}

/**
 * The repository that holds a site — its top level, the site's path in it, the git
 * directory and HEAD (null on a branch with no commits) — or null when none does.
 *
 * ⭐ HOLDS: the site's folder is inside a work tree, and that repository does not ignore
 * it. A repository can never hold the history of a folder it ignores — a harness's
 * scratch projects, a sandbox — so a site there is outside git, as if no repository were
 * around it. One committed there anyway (`git add -f`) is held: git does not count a
 * folder with tracked content as ignored.
 *
 * ⛔ Until 2026-10-17 any enclosing work tree counted. In a folder it ignores, a pull
 * failed on git's "paths are ignored", a push recorded that repository's HEAD as its sync
 * point, and `refresh` ran `git pull` on it.
 */
export function repoOf(siteDir) {
  let top, prefix, gitDir
  try {
    top = gitText(siteDir, ['rev-parse', '--show-toplevel']).trim()
    prefix = gitText(siteDir, ['rev-parse', '--show-prefix']).trim()
    gitDir = gitText(siteDir, ['rev-parse', '--absolute-git-dir']).trim()
  } catch {
    return null
  }
  if (!top) return null
  if (prefix && ignoredHere(siteDir)) return null
  let head = null
  try {
    head = gitText(top, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']).trim() || null
  } catch {
    head = null
  }
  return { top, prefix, path: prefix ? prefix.replace(/\/$/, '') : '.', gitDir, head }
}

/**
 * The top of the repository around `dir` when that repository ignores it — and so holds none
 * of it — or null. For what is said to a person: "not in a repository" is not what they see
 * when one is right there.
 */
export function ignoringRepo(dir) {
  try {
    const top = gitText(dir, ['rev-parse', '--show-toplevel']).trim()
    const prefix = gitText(dir, ['rev-parse', '--show-prefix']).trim()
    return top && prefix && ignoredHere(dir) ? top : null
  } catch {
    return null
  }
}

/** Does the repository around `dir` ignore it? `git check-ignore` exits 0 for yes, 1 for no. */
function ignoredHere(dir) {
  try {
    git(dir, ['check-ignore', '-q', '.'])
    return true
  } catch {
    return false
  }
}

/** Is `ancestor` in the history of `of` — or `of` itself? */
export function isAncestor(repo, ancestor, of = 'HEAD') {
  try {
    git(repo.top, ['merge-base', '--is-ancestor', ancestor, of])
    return true
  } catch {
    return false
  }
}

function isCommit(repo, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(sha)) return false
  try {
    git(repo.top, ['cat-file', '-e', `${sha}^{commit}`])
    return true
  } catch {
    return false
  }
}

/** The tree of the site's directory in a commit or tree, or null. */
export function siteTreeIn(repo, rev) {
  return repo.path === '.' ? objectAt(repo, `${rev}^{tree}`) : objectAt(repo, `${rev}:${repo.path}`)
}

// What `spec` names — a tree, a file's blob — or null.
function objectAt(repo, spec) {
  try {
    return gitText(repo.top, ['rev-parse', '--verify', '-q', spec]).trim() || null
  } catch {
    return null
  }
}

/**
 * The site's roots outside its folder, each by its path from the repository's top: a mounted folder
 * elsewhere in the repository (`utils/site-roots.js`). None for a site that is the whole repository.
 */
function outsideRoots(repo, roots = []) {
  if (!repo.prefix) return []
  return [...new Set(roots.map((r) => underTop(repo, r)))].filter((f) => !`${f}/`.startsWith(repo.prefix))
}

/** What of the repository a pull merges into, as pathspecs: the site's folder, and each root outside it. */
function siteScope(repo, roots = []) {
  return repo.prefix ? [repo.prefix, ...outsideRoots(repo, roots)] : []
}

/** The paths in conflict here, whatever left them — a merge, or a stash put back over one. */
export function unmergedPaths(repo) {
  try {
    return zlist(git(repo.top, ['diff', '--name-only', '-z', '--diff-filter=U']))
  } catch {
    return []
  }
}

/** Is a merge waiting for its commit here? */
export function mergeInProgress(repo) {
  try {
    git(repo.top, ['rev-parse', '--verify', '-q', 'MERGE_HEAD'])
    return true
  } catch {
    return false
  }
}

function trailersOf(body) {
  const out = {}
  for (const line of String(body).split('\n')) {
    let m = line.match(/^Uniweb-Sync: (\S+) (\S+)\s*$/)
    if (m) {
      out.origin = m[1]
      out.siteUuid = m[2]
      continue
    }
    m = line.match(/^Uniweb-Site: (.+):([0-9a-f]{40,64})\s*$/)
    if (m) {
      out.path = m[1]
      out.tree = m[2]
      continue
    }
    m = line.match(/^Uniweb-Root: (.+):([0-9a-f]{40,64})\s*$/)
    if (m) (out.roots ||= []).push({ path: m[1], tree: m[2] })
  }
  return out
}

/**
 * The newest commit a pull made for this site on this backend that HEAD's history
 * holds — and that still holds what that pull wrote. ⛔ A rebase or a cherry-pick copies
 * the trailers onto a commit whose tree is no longer the backend's, so each one is
 * checked against the site tree it names.
 */
export function historySyncPoint(repo, { origin, siteUuid }) {
  if (!repo?.head) return null
  let out
  try {
    out = gitText(repo.top, [
      'log',
      '--fixed-strings',
      `--grep=${SYNC_TRAILER}: ${origin} ${siteUuid}`,
      '--format=%H%x1f%B%x1e',
      'HEAD'
    ])
  } catch {
    return null
  }
  for (const record of out.split('\x1e')) {
    const [sha = '', body = ''] = record.replace(/^\s+/, '').split('\x1f')
    if (!/^[0-9a-f]{40,64}$/.test(sha)) continue
    if (marks(repo, sha, body, { origin, siteUuid })) return sha
  }
  return null
}

// Does this commit's message mark it a sync point of this site and backend — and does it
// still hold the site tree its trailer names, and the tree of each root outside the site's folder?
// ⭐ A rebase copies the trailers onto a commit that holds whatever came before it: a teammate's edit
// to a mounted folder outside the site's, rebased under it, would leave the site's tree as it was, and
// a base that read as the backend's would hold that edit — which the next pull's merge then undid.
function marks(repo, sha, body, { origin, siteUuid }) {
  const t = trailersOf(body)
  if (t.origin !== origin || t.siteUuid !== siteUuid || t.path !== repo.path) return false
  return siteTreeIn(repo, sha) === t.tree && (t.roots || []).every((r) => objectAt(repo, `${sha}:${r.path}`) === r.tree)
}

/**
 * The commits a sync point HEAD does not hold still vouches for: the one it was made onto
 * — its first parent — and that one's, for as long as each is a sync point of this site
 * HEAD does not hold either.
 *
 * ⛔ A merge abandoned (`git merge --abort`) leaves this copy's sync point out of the
 * history, while the commit it was made onto is still there — and still a state the
 * backend's content descends from. Until 2026-10-17 it was forgotten with the merge, and
 * the next pull built on an older sync point, or on none: measured against a real
 * backend, it conflicted on a section nobody had touched since the commit last pushed from.
 */
export function madeOnto(repo, sha, { origin, siteUuid }) {
  const out = []
  let at = sha
  for (let n = 0; n < 16 && isCommit(repo, at) && !isAncestor(repo, at); n++) {
    let body
    try {
      body = gitText(repo.top, ['log', '-1', '--format=%B', at])
    } catch {
      break
    }
    if (!marks(repo, at, body, { origin, siteUuid })) break
    let parent = null
    try {
      parent = gitText(repo.top, ['rev-parse', '--verify', '-q', `${at}^1`]).trim() || null
    } catch {
      // Made onto nothing — a history with no sync point.
    }
    if (!parent) break
    out.push(parent)
    at = parent
  }
  return out
}

/**
 * Can a pull merge from this commit? HEAD's history holds it, and it holds the site where the
 * site is now.
 *
 * ⛔ A BASE IS READ AT THE SITE'S CURRENT PATH (`openStandIn`), so a commit from before the site's
 * folder moved reads as an empty site, and every file as new on both sides. Until 2026-10-31 such
 * a commit was a base like any other: a plain pull after a move gave 98 conflicts and 126 other
 * changes across four sites that had changed nothing, and a wrong file name beside each section
 * it could not place. With no base, a pull finds that the files already say what the backend
 * holds, and records where the site is now.
 */
function canBeBase(repo, sha) {
  return isCommit(repo, sha) && isAncestor(repo, sha) && Boolean(siteTreeIn(repo, sha))
}

/**
 * The path this site last synced at, when it is somewhere else now: what the newest sync point
 * of this site and backend names, or null. For saying why a pull has no base.
 */
export function movedFrom(repo, { origin, siteUuid }) {
  if (!repo?.head) return null
  try {
    const body = gitText(repo.top, ['log', '-1', '--fixed-strings', `--grep=${SYNC_TRAILER}: ${origin} ${siteUuid}`, '--format=%B', 'HEAD'])
    const { path } = trailersOf(body)
    return path && path !== repo.path ? path : null
  } catch {
    return null
  }
}

/**
 * The base a pull merges from: the newest of the candidates HEAD descends from that can be one
 * (`canBeBase`). One that descends from all the others is the newest; with none, the most
 * recently committed.
 *
 * ⚖️ Any of them is a state both sides descend from, but only the newest such state — the
 * commit the backend's content last came from — merges exactly. An older one costs a
 * conflict wherever one side changed what the other changed after it, and it silently
 * undoes a change made after it and then changed BACK on one side: the base already
 * reads the old text, so the change-back looks like no change at all. ⛔ Until
 * 2026-10-17 this said an older base "costs precision at worst".
 */
export function newestBase(repo, candidates) {
  const shas = [...new Set(candidates.filter(Boolean))].filter((s) => canBeBase(repo, s))
  if (shas.length <= 1) return shas[0] || null
  const newest = shas.find((s) => shas.every((o) => o === s || isAncestor(repo, o, s)))
  if (newest) return newest
  try {
    return gitText(repo.top, ['rev-list', '--no-walk', ...shas]).split('\n')[0].trim() || shas[0]
  } catch {
    return shas[0]
  }
}

/**
 * The base a pull merges from, given the bases this copy knows of itself and what the backend
 * names for each lane it answered (`x-uniweb-source`).
 *
 * ⭐ THIS COPY'S OWN BASES ARE EXACT BY CONSTRUCTION — a pull's commit, the commit a push was
 * made from once every lane landed, one a push found nothing to send from — and are never
 * second-guessed here.
 *
 * ⛔ ONE MERGE TAKES ONE BASE FOR EVERY LANE, and what the backend names is exact for its own
 * lane only. Lanes are compared by what a push sends: `unsent` (`utils/site-roots.js::unsentPaths`)
 * names the files it never does, a translation tool's list among them. A commit one lane names that is newer than another lane's, with that lane's files
 * different, would read what that lane lacks — a push of it the backend refused while it took the
 * other — as the backend's removal, and the merge would drop it. So it is not a base. A lane is
 * held to the commit it names, read through the commit its push made of what it wrote back
 * (`recordedAfter`), and a lane that names none to the newest base this copy knows.
 *
 * ⛔ Until 2026-10-19 (cli 713f62d, uniweb 1.13.0) every candidate was held to that, this copy's
 * own included, and a lane to the commit it names alone. A first push writes each new record's
 * `$uuid` back, so the records differed from the commit the folder lane names in every commit after
 * it, and each was dropped: a pull merged from the site's first push, measured by flows against a
 * real backend — a reverted change came back (A18), a re-wrap and six pushed edits conflicted.
 */
export function baseFor(repo, { known = [], lanes = [], origin, siteUuid, unsent = [] }) {
  const held = (s) => Boolean(s) && canBeBase(repo, s)
  const fallback = newestBase(repo, known)
  const refs = lanes.map(({ source, roots }) => ({
    roots,
    ref: held(source) ? recordedAfter(repo, source, { origin, siteUuid }) || source : fallback
  }))
  const named = lanes.flatMap(({ source }) => (held(source) ? [source, recordedAfter(repo, source, { origin, siteUuid })] : []))
  const taken = named.filter(Boolean).filter((s) =>
    refs.every(({ ref, roots }) => Boolean(ref) && (s === ref || isAncestor(repo, s, ref) || !differsIn(repo, ref, s, roots, unsent)))
  )
  return newestBase(repo, [...known, ...taken])
}

/**
 * The commit a push made of what it wrote back, after being made from `sha` — its first parent,
 * marked with the push's backend and site — when HEAD's history holds it; else null.
 */
export function recordedAfter(repo, sha, { origin, siteUuid }) {
  if (!sha || !origin || !siteUuid) return null
  let out
  try {
    out = gitText(repo.top, ['log', '--fixed-strings', `--grep=${RECORDED_TRAILER}: ${origin} ${siteUuid}`, '--format=%H %P', 'HEAD'])
  } catch {
    return null
  }
  for (const line of out.split('\n')) {
    const [commit, first] = line.trim().split(' ')
    if (commit && first && (first === sha || first.startsWith(sha))) return commit
  }
  return null
}

/**
 * The pathspecs for the roots, from the repository's top, with the files a push never sends left out
 * (`unsent`, paths from the site, `*` for one directory).
 */
function pathspecs(repo, roots, unsent = []) {
  return [...roots.map((r) => underTop(repo, r)), ...unsent.map((u) => `:(exclude,glob)${underTop(repo, u)}`)]
}

/** Does the content under `roots` differ between two commits? Anything but "no" counts as yes. */
function differsIn(repo, a, b, roots, unsent = []) {
  try {
    git(repo.top, ['diff', '--quiet', a, b, '--', ...pathspecs(repo, roots, unsent)])
    return false
  } catch {
    return true
  }
}

/**
 * The commit a writable mount's submodule merges from: the one the site's base records for it, where
 * the submodule's checkout holds it; else the one that commit was made onto, where the checkout holds
 * that and the recorded commit changed only the mounted folders — a pull's own commit, which a squash
 * merge upstream drops and whose parent it keeps; else none, and the merge is of unrelated histories.
 *
 * @param {object} repo - the site's `repoOf`
 * @param {string|null} siteBase - the commit the site merges from
 * @param {{ at: string, sub: object, roots: string[] }} n - the submodule's path from the site
 *   repository's top, its `repoOf`, and the mounted folders in it
 * @returns {string|null}
 */
export function nestedBase(repo, siteBase, { at, sub, roots }) {
  if (!siteBase || !sub?.head) return null
  const recorded = objectAt(repo, `${siteBase}:${posix.normalize(at)}`)
  if (!recorded) return null
  const holds = (sha) => isCommit(sub, sha) && isAncestor(sub, sha)
  if (holds(recorded)) return recorded
  if (!isCommit(sub, recorded)) return null
  const parent = objectAt(sub, `${recorded}^1`)
  if (!parent || !holds(parent)) return null
  try {
    git(sub.top, ['diff', '--quiet', parent, recorded, '--', '.', ...roots.map((r) => `:(exclude)${r}`)])
    return parent
  } catch {
    return null // it changed more than the mounted folders: not a pull's
  }
}

// ── the stand-in ────────────────────────────────────────────────────────────

/**
 * A stand-in for the repository, where the backend's content is written onto a commit's
 * tree without touching the working tree.
 *
 * ⭐ It mirrors the repository by LINKS — the foundation, a workspace extension, the
 * installed packages, anything resolved by relative path, resolves as in the project —
 * except the site's content `roots`, which are real directories filled from `rev`, and the
 * site's `sync.json` and `.uniweb/`, which are copies (written there, and taken back by the
 * caller). The stand-in lives outside the project.
 *
 * ⭐ AND WHAT IS AROUND THE REPOSITORY, `above` directories up: the repository stands that deep,
 * under directories named as its parents, each holding links to what is beside it there. So a path
 * leading out of the repository, a records or pages mount in a repository beside it, resolves as in
 * the project too. With `above` 0 the stand-in is the repository's alone. ⛔ Until 2026-11-10 it
 * always was: such a path resolved under the temporary folder, which stopped every pull of a site
 * mounting another repository's records ("not a directory here").
 *
 * ⛔ CLOSE IT. `close()` unlinks every link it made before removing the rest — a recursive
 * remove that followed one would delete the project's own files.
 *
 * ⚖️ What is written under the roots where the repository ignores it — media in a folder
 * kept out of git — is in no commit, so no merge brings it. `placeIgnored()` copies it
 * into the project, where the project lacks it.
 *
 * ⭐ A ROOT IN A REPOSITORY OF ITS OWN — a writable mount in a submodule of the site's (`nested`) — is
 * filled from that repository at its own base, and committed in its own history, as the person who
 * pulls, with no hooks and no site named: the site's tree holds only the submodule's commit, which
 * `commit()` sets to the one it made there.
 *
 * @param {object} repo - `repoOf`
 * @param {object} opts
 * @param {string[]} opts.roots - the site's content roots, relative to the site
 * @param {string|null} opts.rev - the commit whose content the roots are filled from;
 *   null for none
 * @param {Array<{ repo: object, at: string, roots: string[], rev: string|null, parent: string|null }>} [opts.nested] -
 *   each submodule a writable mount is in: its `repoOf`, its path from the site repository's top,
 *   the mounted folders in it (relative to its own top), the commit they are filled from, and the
 *   one a commit of them is made onto (null: none, an unrelated history)
 * @param {number} [opts.above] - how many directories above the repository's top to mirror: as far
 *   as the site's relative paths climb (`levelsAboveRepository`, `utils/site-roots.js`)
 * @returns {{ siteDir: string, commit: Function, changes: Function, placeIgnored: Function, close: Function }}
 */
export function openStandIn(repo, { roots, rev, nested = [], above = 0 }) {
  // ⭐ A root is named relative to the site and held by the repository, so one outside the site's
  // folder — a mounted folder elsewhere in the repository — is filled and committed like the rest.
  // One outside the repository is in no commit of it. ⛔ Until 2026-11-04 every root leading out of
  // the site's folder was refused, so a mount was left out of the merge, linked to the working tree.
  const full = roots.map((r) => underTop(repo, r))
  roots.forEach((r, i) => {
    if (r.startsWith('/') || full[i] === '..' || full[i].startsWith('../')) {
      throw new Error(`the content root \`${r}\` is outside the site's repository, so a pull cannot merge it`)
    }
  })
  const base = mkdtempSync(join(tmpdir(), 'uniweb-stand-in-'))
  // The directories above the repository the stand-in mirrors, nearest first, each with the name of
  // the one below it on the way down; `base` stands for the farthest, and the repository's own stand-in
  // is named as it is, under them.
  const around = []
  for (let real = repo.top; around.length < above && dirname(real) !== real; real = dirname(real)) {
    around.push({ dir: dirname(real), child: basename(real) })
  }
  let root = base
  for (let k = around.length - 1; k >= 0; k--) {
    around[k].stand = root
    root = join(root, around[k].child)
  }
  const indexDir = mkdtempSync(join(tmpdir(), 'uniweb-stand-in-index-'))
  const env = { GIT_INDEX_FILE: join(indexDir, 'index') }
  const at = (args, opts = {}) =>
    git(repo.top, ['--git-dir', repo.gitDir, '--work-tree', root, ...args], { ...opts, env: { ...env, ...(opts.env || {}) } })
  // Each submodule's folders, with its own index; its git run against its part of the stand-in.
  const subs = nested.map((n, i) => {
    const where = posix.normalize(n.at)
    if (where === '.' || where === '..' || where.startsWith('../') || where.startsWith('/')) {
      throw new Error(`the submodule \`${n.at}\` is not inside the site's repository`)
    }
    const own = n.roots.map((r) => posix.normalize(r))
    return { ...n, at: where, roots: own, full: own.map((r) => posix.normalize(`${where}/${r}`)), index: join(indexDir, `nested-${i}`) }
  })
  const nestedFull = new Set(subs.flatMap((n) => n.full))
  const inSub = (n, args, opts = {}) =>
    git(n.repo.top, ['--git-dir', n.repo.gitDir, '--work-tree', join(root, n.at), ...args], {
      ...opts,
      env: { GIT_INDEX_FILE: n.index, ...(opts.env || {}) }
    })
  const links = []
  const close = () => {
    for (const l of links.reverse()) {
      try {
        unlinkSync(l)
      } catch {
        /* already gone */
      }
    }
    rmSync(base, { recursive: true, force: true })
    rmSync(indexDir, { recursive: true, force: true })
  }

  try {
    const sitePrefix = repo.prefix // '' or 'site/'
    const fullSet = new Set(full)
    const sitePath = sitePrefix.replace(/\/$/, '')
    const inSite = (name) => (sitePath ? `${sitePath}/${name}` : name)
    const mustBeReal = (rel) =>
      (sitePath && (sitePath === rel || sitePath.startsWith(`${rel}/`))) ||
      full.some((f) => f.startsWith(`${rel}/`)) ||
      subs.some((n) => n.at === rel || n.full.some((f) => f.startsWith(`${rel}/`)))

    const link = (real, stand, name) => {
      let dir = false
      try {
        dir = statSync(real).isDirectory()
      } catch {
        return // a dangling link resolves nothing in the project either
      }
      // ⛔ git reads neither through a link (2.32+), so a linked one would stage what the
      // project ignores, and drop its attributes.
      if (!dir && (name === '.gitignore' || name === '.gitattributes')) {
        copyFileSync(real, stand)
        return
      }
      try {
        symlinkSync(real, stand, dir ? 'junction' : 'file')
        links.push(stand)
      } catch (err) {
        // A file link needs a privilege some systems withhold; a copy reads the same.
        if (dir) throw err
        copyFileSync(real, stand)
      }
    }
    const mirror = (realDir, standDir, rel) => {
      mkdirSync(standDir, { recursive: true })
      for (const name of readdirSync(realDir)) {
        const r = rel ? `${rel}/${name}` : name
        const real = join(realDir, name)
        const stand = join(standDir, name)
        if (!rel && name === '.git') continue
        if (fullSet.has(r)) continue // filled from `rev`, below
        // A submodule's own folders are filled from its base, below, and its `.git` is no file of the site's.
        if (nestedFull.has(r)) continue
        if (name === '.git' && subs.some((n) => n.at === rel)) continue
        if (r === inSite('.uniweb')) {
          // This copy's own state, for the projection to read and write — taken back by the
          // caller. Not the rename index: it names paths in the working tree, not in `rev`.
          cpSync(real, stand, {
            recursive: true,
            filter: (src) => src !== join(real, 'pull-index.json')
          })
          continue
        }
        if (r === inSite('sync.json')) {
          copyFileSync(real, stand)
          continue
        }
        let st
        try {
          st = lstatSync(real)
        } catch {
          continue
        }
        if (mustBeReal(r)) {
          // ⛔ The way to a content root is never a link: the roots are written, and a
          // write through a link lands in the project.
          if (!st.isDirectory()) throw new Error(`\`${r}\` is a link, so a pull cannot merge the site in place`)
          mirror(real, stand, r)
        } else link(real, stand, name)
      }
    }
    // What is beside the repository, and beside each directory above it, as far up as `around` goes.
    const realBase = realpathSync(base)
    for (const { dir, child, stand } of around) {
      mkdirSync(stand, { recursive: true })
      let names = []
      try {
        names = readdirSync(dir)
      } catch {
        continue // unreadable: nothing resolves through it in the project either
      }
      for (const name of names) {
        if (name === child) continue
        let target
        try {
          target = realpathSync(join(dir, name))
        } catch {
          continue
        }
        // ⛔ Never the stand-in itself, nor a folder holding it: a link back into it is a loop.
        if (target === realBase || realBase.startsWith(`${target}${sep}`)) continue
        try {
          link(join(dir, name), join(stand, name), name)
        } catch {
          // One the system will not link (macOS refuses a protected folder, `TemporaryItems`) is left
          // out: only a path through it would miss it, as every such path did before.
        }
      }
    }
    mirror(repo.top, root, '')
    if (sitePath) mkdirSync(join(root, sitePath), { recursive: true })

    // The roots, as `rev` has them.
    if (rev) at(['read-tree', rev])
    else at(['read-tree', '--empty'])
    const present = rev
      ? gitText(repo.top, ['ls-tree', '--name-only', '-z', '--full-tree', rev, '--', ...full], {})
          .split('\0')
          .filter(Boolean)
      : []
    if (present.length) at(['checkout', rev, '--', ...present])

    // Each submodule's folders, as its own base has them.
    for (const n of subs) {
      mkdirSync(join(root, n.at), { recursive: true })
      inSub(n, n.rev ? ['read-tree', n.rev] : ['read-tree', '--empty'])
      n.present = n.rev
        ? zlist(git(n.repo.top, ['--git-dir', n.repo.gitDir, 'ls-tree', '--name-only', '-z', '--full-tree', n.rev, '--', ...n.roots]))
        : []
      if (n.present.length) inSub(n, ['checkout', n.rev, '--', ...n.present])
    }

    const siteDir = sitePath ? join(root, sitePath) : root

    /**
     * Commit the roots as the stand-in now holds them, onto `rev`'s tree — or report that
     * they are what `rev` holds (`always` commits them anyway, to mark a history that has
     * no sync point yet).
     * `nested`, for each submodule: the commit made of its folders (null where they are its base's), and
     * the files it changed there.
     * @returns {{ commit: string|null, tree: string, siteTree: string|null, nested: Array<{ at: string, repo: object, roots: string[], commit: string|null, files: string[] }> }}
     */
    const commit = ({ parent, subject, origin, siteUuid, always = false }) => {
      // ⭐ Each submodule's folders first, in its own history: the site's commit records what it made.
      const made = subs.map((n) => {
        const staged = heldIn((a, o) => inSub(n, a, o), n.roots.filter((r) => n.present.includes(r) || existsSync(join(root, n.at, r))))
        if (staged.length) inSub(n, ['add', '-A', '--', ...staged])
        const tree = inSub(n, ['write-tree']).toString('utf8').trim()
        const before = n.rev ? gitText(n.repo.top, ['rev-parse', `${n.rev}^{tree}`]).trim() : null
        if (tree === before) return { at: n.at, repo: n.repo, roots: n.roots, commit: null, files: [] }
        const files = n.rev ? zlist(inSub(n, ['diff', '--cached', '--name-only', '-z', '--no-renames', n.rev, '--', ...n.roots])) : zlist(inSub(n, ['ls-files', '-z']))
        // ⭐ As the person who pulls — the repository's own identity, which `commit-tree` reads — with no
        // hooks, and a message that names the files and no site: the folder may be shared by several.
        const message = `Edits made in the app\n\n${files.slice(0, 40).map((p) => `- ${p}`).join('\n')}${files.length > 40 ? `\n- … and ${files.length - 40} more` : ''}\n`
        const sha = gitText(n.repo.top, ['--git-dir', n.repo.gitDir, 'commit-tree', '--no-gpg-sign', tree, ...(n.parent ? ['-p', n.parent] : []), '-F', '-'], { input: message }).trim()
        at(['update-index', '--add', '--cacheinfo', `160000,${sha},${n.at}`])
        return { at: n.at, repo: n.repo, roots: n.roots, commit: sha, files }
      })
      const staged = held(full.filter((f) => present.includes(f) || existsSync(join(root, f))))
      if (staged.length) at(['add', '-A', '--', ...staged])
      const tree = at(['write-tree']).toString('utf8').trim()
      const before = rev ? gitText(repo.top, ['rev-parse', `${rev}^{tree}`]).trim() : null
      const siteTree = siteTreeIn(repo, tree)
      if (tree === before && !always) return { commit: null, tree, siteTree, nested: made }
      const host = (() => {
        try {
          return new URL(origin).host
        } catch {
          return 'backend'
        }
      })()
      // ⭐ And the tree of each root outside the site's folder, and the commit of each submodule there (`marks`).
      const outsideSubs = subs.map((n) => n.at).filter((p) => repo.prefix && !`${p}/`.startsWith(repo.prefix))
      const outside = [...outsideRoots(repo, roots), ...outsideSubs]
        .map((p) => [p, objectAt(repo, `${tree}:${p}`)])
        .filter(([, t]) => t)
        .map(([p, t]) => `${ROOT_TRAILER}: ${p}:${t}\n`)
        .join('')
      const message = `${subject}\n\n${SYNC_TRAILER}: ${origin} ${siteUuid}\n${SITE_TRAILER}: ${repo.path}:${siteTree}\n${outside}`
      const who = {
        GIT_AUTHOR_NAME: 'uniweb',
        GIT_AUTHOR_EMAIL: `sync@${host}`,
        GIT_COMMITTER_NAME: 'uniweb',
        GIT_COMMITTER_EMAIL: `sync@${host}`
      }
      const sha = gitText(repo.top, ['commit-tree', '--no-gpg-sign', tree, ...(parent ? ['-p', parent] : []), '-F', '-'], {
        env: who,
        input: message
      }).trim()
      return { commit: sha, tree, siteTree, nested: made }
    }

    /**
     * Copy into the project what the stand-in holds under the roots where the repository
     * ignores it, wherever the project lacks it. ⛔ Never over a file the project has:
     * with no history there, nothing tells its version from the author's work.
     * @returns {string[]} the paths placed, relative to the site
     */
    const placeIgnored = () => {
      const placed = []
      const place = (from, to, named) => {
        if (occupied(to)) return
        mkdirSync(dirname(to), { recursive: true })
        copyFileSync(from, to)
        placed.push(named)
      }
      const roots = full.filter((f) => existsSync(join(root, f)))
      if (roots.length) {
        for (const p of zlist(at(['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...roots]))) {
          place(join(root, p), join(repo.top, p), siteRelative(repo, p))
        }
      }
      for (const n of subs) {
        const own = n.roots.filter((r) => existsSync(join(root, n.at, r)))
        if (!own.length) continue
        for (const p of zlist(inSub(n, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...own]))) {
          place(join(root, n.at, p), join(n.repo.top, p), siteRelative(repo, posix.join(n.at, p)))
        }
      }
      return placed
    }

    /**
     * What is written under the roots that `rev` does not hold so — each `[status, path]`,
     * status `A`, `M` or `D`, the path relative to the site. Asked of the stand-in's own
     * index, which holds `rev`: nothing is staged, committed or written to the repository.
     * What the repository ignores is no change, as for `commit`.
     * @returns {Array<[string, string]>}
     */
    const changes = () => {
      const site = (p) => siteRelative(repo, p)
      const out = []
      const listed = (run, roots, named) => {
        if (!roots.length) return
        const tracked = zlist(run(['diff', '--name-status', '-z', '--no-renames', '--', ...roots]))
        for (let i = 0; i + 1 < tracked.length; i += 2) out.push([tracked[i], named(tracked[i + 1])])
        for (const p of zlist(run(['ls-files', '--others', '--exclude-standard', '-z', '--', ...roots]))) out.push(['A', named(p)])
      }
      listed(at, full.filter((f) => present.includes(f) || existsSync(join(root, f))), site)
      for (const n of subs) {
        listed((a) => inSub(n, a), n.roots.filter((r) => n.present.includes(r) || existsSync(join(root, n.at, r))), (p) => site(posix.join(n.at, p)))
      }
      return out.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    }

    // The roots git can hold here. ⛔ One the repository ignores whole is not named to
    // `git add`, which refuses an ignored path; what is written under it is placed instead.
    const heldIn = (run, paths) => {
      if (!paths.length) return paths
      let ignored = []
      try {
        ignored = zlist(run(['check-ignore', '-z', '--stdin'], { input: `${paths.join('\0')}\0` }))
      } catch (err) {
        if (err?.status !== 1) throw err // 1: none of them is ignored
      }
      return paths.filter((p) => !ignored.includes(p))
    }
    const held = (paths) => heldIn(at, paths)

    return { siteDir, commit, changes, placeIgnored, close }
  } catch (err) {
    close()
    throw err
  }
}

// ── merging ─────────────────────────────────────────────────────────────────

const zlist = (buf) => buf.toString('utf8').split('\0').filter(Boolean)
// Something is at `path` — a dangling link included, which `existsSync` reads as nothing.
const occupied = (path) => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Files not under git that the merge would write over: their paths, each with whether the
 * file already holds what `commit` has there.
 */
function untrackedInTheWay(repo, commit, roots = []) {
  const added = zlist(git(repo.top, ['diff', '--name-only', '-z', '--diff-filter=A', 'HEAD', commit, '--', ...siteScope(repo, roots)]))
  const out = []
  for (const p of added) {
    const abs = join(repo.top, p)
    if (!existsSync(abs)) continue
    try {
      git(repo.top, ['ls-files', '--error-unmatch', '--', p])
      continue // in the index: the merge's own business
    } catch {
      /* untracked */
    }
    let same = false
    try {
      same = readFileSync(abs).equals(git(repo.top, ['cat-file', 'blob', `${commit}:${p}`]))
    } catch {
      same = false
    }
    out.push({ path: p, same })
  }
  return out
}

/**
 * What would stop a merge of `commit` here, before it is made — `{ ok: false, reason, paths? }` — or
 * null. A pull asks it of every repository it merges into before it merges into any: one that cannot
 * take its merge leaves every other as it was.
 */
export function mergeStopper(repo, commit, { roots = [] } = {}) {
  if (mergeInProgress(repo)) return { ok: false, reason: 'merge-in-progress' }
  // Conflicts already here are not this merge's: git would refuse it, and they would read as its own.
  const unsettled = unmergedPaths(repo)
  if (unsettled.length) return { ok: false, reason: 'unmerged', paths: unsettled }
  const blocking = untrackedInTheWay(repo, commit, roots).filter((u) => !u.same).map((u) => u.path)
  if (blocking.length) return { ok: false, reason: 'untracked', paths: blocking }
  return null
}

/**
 * Merge a sync point into HEAD: git's three-way merge, against git's merge base — the sync
 * point's parent, which HEAD descends from. Uncommitted work is stashed and put back when
 * the merge is done (`--autostash`); a conflict leaves git's own state for a person to
 * settle, as any merge does.
 *
 * `roots`, the site's roots, so what is in the way is looked for in each one outside its folder too.
 *
 * @returns {{ ok: true, conflicted: string[] } | { ok: false, reason: string, paths?: string[] }}
 */
export function mergeSyncPoint(repo, commit, { message, roots = [] }) {
  const stopped = mergeStopper(repo, commit, { roots })
  if (stopped) return stopped
  const inTheWay = untrackedInTheWay(repo, commit, roots)
  // One that already holds what the merge writes there is made way for — and only once the
  // merge is going ahead, or it would be gone with nothing put back.
  for (const u of inTheWay) rmSync(join(repo.top, u.path))
  try {
    git(repo.top, ['merge', '--autostash', '--no-edit', '--no-verify', '--allow-unrelated-histories', '-m', message, commit])
    // ⛔ THE MERGE IS MADE, AND IT MAY STILL HAVE LEFT CONFLICTS. `--autostash` exits 0 when
    // the uncommitted work it set aside cannot be put back over what the merge brought: the
    // files then hold conflict markers, unmerged, and git keeps that work in the stash too.
    // Until 2026-10-17 that read as a clean merge — a pull that exited 0 over the markers,
    // so `uniweb pull && uniweb push` would send them.
    const unstashed = unmergedPaths(repo)
    return { ok: true, conflicted: unstashed, stashKept: unstashed.length > 0 }
  } catch (err) {
    const conflicted = zlist(git(repo.top, ['diff', '--name-only', '-z', '--diff-filter=U']))
    if (conflicted.length) return { ok: true, conflicted }
    return { ok: false, reason: 'git', detail: gitError(err) }
  }
}

/**
 * ⭐ RECORD EACH SUBMODULE'S MERGE AS THE SITE'S PIN, once both are merged. The site's sync point
 * records the commit a pull made in the submodule; the checkout may hold a commit past it — the
 * merge of that commit with the submodule's own — which is what the site's files now hold:
 * - where the site's merge left the submodule in conflict, as git does when both sides moved its pin,
 *   the submodule's merge is the resolution, and the site's merge is made once nothing else conflicts;
 * - where the site's merge was made, a checkout past the commit it records is committed, on its own.
 * A submodule whose own merge left conflicts is left to the person, with the site's pin as it is.
 *
 * @param {object} repo - the site's `repoOf`
 * @param {Array<{ at: string, repo: object, conflicted: string[] }>} merged
 * @param {{ message: (at: string, head: string) => string }} opts
 * @returns {{ pins: Array<{ at: string, head: string|null, committed: string|null, left: boolean }>, concluded: boolean, error: string|null }}
 */
export function recordNestedPins(repo, merged, { message }) {
  const pins = []
  let error = null
  const unmerged = new Set(unmergedPaths(repo))
  for (const m of merged) {
    const head = objectAt(m.repo, 'HEAD')
    if (m.conflicted.length || !head) {
      pins.push({ at: m.at, head, committed: null, left: true })
      continue
    }
    if (unmerged.has(m.at)) {
      try {
        git(repo.top, ['add', '--', m.at])
      } catch (err) {
        error = gitError(err)
      }
    }
    pins.push({ at: m.at, head, committed: null, left: false })
  }
  let concluded = false
  if (!error && mergeInProgress(repo) && !unmergedPaths(repo).length && pins.every((p) => !p.left)) {
    try {
      git(repo.top, ['commit', '--no-edit', '--no-verify', '-q'])
      concluded = true
    } catch (err) {
      error = gitError(err)
    }
  }
  if (!error && !mergeInProgress(repo)) {
    for (const p of pins.filter((x) => !x.left)) {
      if (objectAt(repo, `HEAD:${p.at}`) === p.head) continue
      try {
        git(repo.top, ['commit', '-q', '--no-verify', '-m', message(p.at, p.head), '--', p.at])
        p.committed = objectAt(repo, 'HEAD')
      } catch (err) {
        error = gitError(err)
      }
    }
  }
  return { pins, concluded, error }
}

/**
 * Take a sync point's roots whole — `pull --force`. Local changes under them are dropped
 * and the branch gets a commit holding the sync point's content, with the sync point as a
 * parent, so a later pull merges from it. Files outside the roots are left as they are.
 *
 * @returns {{ ok: true } | { ok: false, reason: string, detail?: string }}
 */
export function takeSyncPoint(repo, commit, { roots, message }) {
  if (mergeInProgress(repo)) return { ok: false, reason: 'merge-in-progress' }
  const full = roots.map((r) => underTop(repo, r))
  try {
    const tracked = zlist(git(repo.top, ['ls-tree', '--name-only', '-z', '--full-tree', 'HEAD', '--', ...full]))
    if (tracked.length) git(repo.top, ['checkout', 'HEAD', '--', ...tracked])
    for (const u of untrackedInTheWay(repo, commit, roots)) rmSync(join(repo.top, u.path))
    const tree = gitText(repo.top, ['rev-parse', `${commit}^{tree}`]).trim()
    const merged = gitText(repo.top, ['commit-tree', tree, '-p', 'HEAD', '-p', commit, '-F', '-'], { input: `${message}\n` }).trim()
    git(repo.top, ['read-tree', '-m', '-u', 'HEAD', merged])
    git(repo.top, ['update-ref', '-m', message, 'HEAD', merged])
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: 'git', detail: gitError(err) }
  }
}

/**
 * What a pull changed in the files, under the site: `[status, path]` pairs — what the
 * merge, or the take, moved from `from` (HEAD before it), less what the files already
 * held as it left them. `files` is the files before it (`snapshotFiles`). `staged` reads a
 * merge stopped on conflicts from the index; `skip` leaves out the paths in conflict,
 * which are reported as conflicts.
 *
 * ⛔ Until 2026-10-17 a pull listed the backend's content against the base, as "changes
 * from the backend": a file a push had already written into the files read as one, so
 * did a person's own edit when there was no base — and `--force` said it "took" a change
 * where it undid their edit.
 */
export function changedInFiles(repo, { from, files, staged = false, skip = [], roots = [] }) {
  // The site's folder, and each of its roots outside it: a mounted folder a pull writes into.
  const scope = ['--', ...siteScope(repo, roots)]
  try {
    const parts = zlist(git(repo.top, ['diff', '--name-status', '-z', ...(staged ? ['--cached', from] : [from, 'HEAD']), ...scope]))
    const moved = []
    for (let i = 0; i < parts.length; ) {
      const status = parts[i++]
      const path = parts[i++]
      moved.push(/^[RC]/.test(status) ? [status[0], parts[i++]] : [status, path])
    }
    // What the files already held as the merge left it is no change to them.
    const differs = new Set(
      zlist(git(repo.top, ['diff', '--name-only', '-z', '--no-renames', ...(staged ? ['--cached', files] : [files, 'HEAD']), ...scope]))
    )
    return moved
      .filter(([s, p]) => s !== 'U' && !skip.includes(p) && differs.has(p))
      .map(([s, p]) => [s, siteRelative(repo, p)])
  } catch {
    return []
  }
}

/**
 * The files as they are, as a commit to compare against — what is tracked, committed or
 * not (`git stash create`, which touches neither the files nor any ref); HEAD when nothing
 * is uncommitted.
 */
export function snapshotFiles(repo) {
  try {
    return (
      gitText(repo.top, ['stash', 'create'], {
        env: { GIT_AUTHOR_NAME: 'uniweb', GIT_AUTHOR_EMAIL: 'sync@uniweb', GIT_COMMITTER_NAME: 'uniweb', GIT_COMMITTER_EMAIL: 'sync@uniweb' }
      }).trim() || repo.head
    )
  } catch {
    return repo.head
  }
}

/**
 * Does HEAD hold the site's content as the files do — nothing staged, changed or untracked
 * under the roots? (What the repository ignores is no change.)
 */
export function contentCommitted(repo, roots) {
  return uncommittedPaths(repo, roots)?.length === 0
}

/**
 * The files under the roots that HEAD does not hold as they are — staged, changed, deleted
 * or untracked, and both sides of a rename — relative to the site; null when git cannot
 * say. What the repository ignores is no change.
 */
export function uncommittedPaths(repo, roots) {
  let parts
  try {
    parts = zlist(git(repo.top, ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...roots.map((r) => underTop(repo, r))]))
  } catch {
    return null
  }
  const out = []
  for (let i = 0; i < parts.length; i++) {
    out.push(parts[i].slice(3))
    if (/[RC]/.test(parts[i].slice(0, 2))) out.push(parts[++i]) // a rename's source follows it
  }
  return [...new Set(out.map((p) => siteRelative(repo, p)))]
}

/** A site file's bytes as `rev` holds it — `path` relative to the site — or null when it holds none. */
export function fileAt(repo, rev, path) {
  try {
    return git(repo.top, ['cat-file', 'blob', `${rev}:${repo.prefix}${path}`])
  } catch {
    return null
  }
}

/**
 * The files under the roots that differ from what `rev` holds there — changed, deleted, or
 * new and not ignored — relative to the site, one outside it (a mounted folder's) included. `unsent`:
 * files a push never sends (`unsentPaths`), which no backend can lack.
 */
export function filesDifferFrom(repo, rev, roots, unsent = []) {
  const full = pathspecs(repo, roots, unsent)
  try {
    const changed = zlist(git(repo.top, ['diff', '--name-only', '-z', '--no-renames', rev, '--', ...full]))
    const added = zlist(git(repo.top, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...full]))
    return [...new Set([...changed, ...added].map((p) => posix.relative(repo.prefix, p)))]
  } catch {
    return []
  }
}

/**
 * Commit what the files hold under the roots — added, changed, deleted or renamed — and
 * nothing else that is staged. With `identity` it is uniweb's commit, made as a pull's merge
 * is: no hooks, unsigned. Without it, the person's own, as their `git commit` makes it.
 *
 * ⛔ Staged by ROOT, committed by NAME: `git add` refuses a path that is on neither the disk
 * nor the index — a rename's source — and the commit takes exactly what was staged.
 *
 * @returns {{ commit: string, paths: string[] } | null} null when there was nothing to commit
 */
export function commitRoots(repo, roots, { message, identity = null }) {
  const full = roots.map((r) => underTop(repo, r))
  const present = full.filter((p) => existsSync(join(repo.top, p)) || zlist(git(repo.top, ['ls-files', '-z', '--', p])).length)
  let addable = present
  if (present.length) {
    try {
      const ignored = zlist(git(repo.top, ['check-ignore', '-z', '--stdin'], { input: `${present.join('\0')}\0` }))
      addable = present.filter((p) => !ignored.includes(p))
    } catch (err) {
      if (err?.status !== 1) throw err // 1: none of them is ignored
    }
  }
  if (addable.length) git(repo.top, ['--literal-pathspecs', 'add', '-A', '--', ...addable])
  const staged = zlist(git(repo.top, ['diff', '--cached', '--name-only', '-z', '--no-renames', '--', ...full]))
  if (!staged.length) return null
  git(
    repo.top,
    ['--literal-pathspecs', 'commit', '-q', ...(identity ? ['--no-verify', '--no-gpg-sign'] : []), '-m', message, '--pathspec-from-file=-', '--pathspec-file-nul'],
    { input: `${staged.join('\0')}\0`, ...(identity ? { env: identity } : {}) }
  )
  return { commit: gitText(repo.top, ['rev-parse', 'HEAD']).trim(), paths: staged.map((p) => siteRelative(repo, p)) }
}

// A path relative to the site, as git names it from the repository's top: one outside the site's folder
// comes out as `../docs/intro.md`.
const siteRelative = (repo, p) => posix.relative(repo.prefix.replace(/\/$/, '') || '.', p) || '.'

// A path relative to the site, as the repository names it. `../src/main.js` comes out as `src/main.js`.
const underTop = (repo, p) => posix.normalize(`${repo.prefix}${p}`)

// ── this copy's own sync point ──────────────────────────────────────────────

const cachePath = (siteDir) => join(siteDir, '.uniweb', 'backend-cache.json')
const cacheKey = (origin) => {
  try {
    const u = new URL(origin)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * The commit whose content the versions this copy holds for a backend describe — the
 * one its last pull merged, or its last push was made from — or null.
 */
export function readSyncPoint(siteDir, origin) {
  const key = cacheKey(origin)
  if (!key) return null
  try {
    const file = JSON.parse(readFileSync(cachePath(siteDir), 'utf8'))
    const v = file?.backends?.[key]?.syncPoint
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

/** Record it — beside the versions it describes, in `.uniweb/backend-cache.json`. */
export function writeSyncPoint(siteDir, origin, sha) {
  const key = cacheKey(origin)
  if (!key) return
  const p = cachePath(siteDir)
  let file = { backends: {} }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    if (parsed?.backends && typeof parsed.backends === 'object') file = parsed
  } catch {
    /* none yet */
  }
  file.backends[key] = { ...(file.backends[key] || {}), syncPoint: sha }
  const sorted = {}
  for (const k of Object.keys(file.backends).sort()) sorted[k] = file.backends[k]
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ version: 1, backends: sorted }, null, 2) + '\n')
}
