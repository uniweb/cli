/**
 * The page folders a site mounts from a repository of their own, and where each one stands.
 *
 * A site takes a folder of pages from elsewhere with `paths: { pages/<segment>: <dir> }`, and a
 * build or a push reads that folder as it is on disk. When the folder is its own git repository
 * (a submodule of the site's, or a clone beside it), nothing else keeps it current. A `git pull`
 * of the site moves a submodule's recorded commit and leaves its checkout where it was. A
 * `uniweb pull` never writes into a mount (`uwx/page-files.js`), so after a teammate pushes
 * newer docs, a pull here takes nothing and the next push puts the older ones back. So `status`
 * says where each one stands, `refresh` takes its latest, and a push or publish stops before
 * sending one that is not current (`backend/mounts-before-sending.js`).
 *
 * ⭐ ITS LATEST IS THE TIP OF THE BRANCH IT FOLLOWS: for a submodule, the branch `.gitmodules`
 * names for it (git's own `submodule.<name>.branch`), else its remote's default branch
 * [Diego, 2026-11-04: "I imagine that it means the remote's default branch"]; for a clone on a
 * branch, that branch's upstream.
 *
 * ⭐ WHAT IS COMPARED IS THE MOUNTED FOLDER. A mount can be one folder of a larger repository
 * (`external/tool/docs`), so a commit that leaves the folder as it was is nothing to take.
 *
 * ⛔ NOTHING HERE WAITS ON A PERSON. A remote is asked under `quietGitEnv` and a time limit, as
 * `remoteMoved` asks the site's own; one that does not answer is said, never waited on.
 */

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import yaml from 'js-yaml'
import { repoOf } from './sync-point.js'
import { quietGitEnv, upstreamOf } from './git.js'

const run = (cwd, args, opts = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

function text(cwd, args, opts) {
  try {
    return run(cwd, args, opts).trim()
  } catch {
    return null
  }
}

/** The same call, bounded and asking nothing of a person: for a remote. */
function remoteCall(cwd, args, timeoutMs) {
  return new Promise((done, fail) =>
    execFile('git', args, { cwd, env: quietGitEnv(cwd, timeoutMs), timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) =>
      err ? fail(err) : done(String(stdout))
    )
  )
}

/** true, false, or null when git cannot say (a commit it does not hold). */
function ancestor(cwd, a, b) {
  try {
    run(cwd, ['merge-base', '--is-ancestor', a, b])
    return true
  } catch (err) {
    return err?.status === 1 ? false : null
  }
}

const holds = (cwd, sha) => text(cwd, ['cat-file', '-e', `${sha}^{commit}`]) !== null

/**
 * ⛔ A SHALLOW CLONE CANNOT SAY TWO COMMITS ARE UNRELATED. It holds a branch's recent commits cut
 * off from their past (`shallow = true` in `.gitmodules`, or a CI checkout), so a commit it holds
 * can look as if it were on no line with the one checked out. Read as "diverged", that sent a
 * mount that was only behind to be settled by hand. A fetch of the rest settles it
 * (`takeLatest`); until then it is taken as behind (measured 2026-11-04).
 */
const isShallow = (cwd) => text(cwd, ['rev-parse', '--is-shallow-repository']) === 'true'

/** Does the mounted folder read the same at both commits? null when git cannot say. */
function sameFolder(cwd, a, b, prefix) {
  try {
    run(cwd, ['diff', '--quiet', a, b, '--', prefix || '.'])
    return true
  } catch (err) {
    return err?.status === 1 ? false : null
  }
}

const slash = (p) => p.split(sep).join('/')
export const short = (sha) => (sha ? sha.slice(0, 7) : '')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What git said when it failed, or the fallback. */
function gitError(err, fallback) {
  const said = [err?.stderr, err?.stdout].map((b) => (b ? String(b).trim() : '')).filter(Boolean).join('\n')
  return said || err?.message || fallback
}

/** `github.com/uniweb/docs`, for the ways a remote's address is written; anything else as it is. */
export function remoteLabel(url) {
  if (!url) return null
  const s = String(url).trim()
  const scp = s.match(/^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/)
  if (scp) return `${scp[1]}/${scp[2]}`
  try {
    const u = new URL(s)
    if (!/^(https?|ssh|git):$/.test(u.protocol)) return s
    return `${u.host}${u.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '')}`
  } catch {
    return s
  }
}

/** The submodule of the site's repository holding `abs` — `{ path, recorded }` — or null. */
function submoduleHolding(siteTop, abs) {
  const rel = slash(relative(siteTop, abs))
  if (!rel || rel === '..' || rel.startsWith('../')) return null
  const candidates = []
  for (let p = rel; p; p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') candidates.push(p)
  const out = text(siteTop, ['ls-tree', '-z', 'HEAD', '--', ...candidates])
  if (!out) return null
  for (const entry of out.split('\0')) {
    const m = entry.match(/^160000 commit ([0-9a-f]+)\t(.+)$/)
    if (m && candidates.includes(m[2])) return { path: m[2], recorded: m[1] }
  }
  return null
}

/**
 * Which repository holds a mounted folder, as `mountedRepositories` tells them apart:
 * - `site`: the site's own repository holds its files — they are the site's roots (`utils/site-roots.js`);
 * - `submodule`: a submodule of the site's repository holds it, `submodule` naming which;
 * - `own`: a repository the site's does not record — a clone beside the site;
 * - `none`: no repository holds it, or the site is in none.
 *
 * @param {string} siteDir
 * @param {string} abs - the mounted folder
 * @returns {{ kind: 'site'|'submodule'|'own'|'none', submodule?: { path: string, recorded: string } }}
 */
export function mountHolding(siteDir, abs) {
  const site = repoOf(siteDir)
  if (!site) return { kind: 'none' }
  const sub = site.head ? submoduleHolding(site.top, realOf(abs)) : null
  if (sub) return { kind: 'submodule', submodule: sub }
  const own = existsSync(abs) ? repoOf(abs) : null
  if (!own) return { kind: 'none' }
  return { kind: own.top === site.top ? 'site' : 'own' }
}

// git names a repository's top by its real path, and a mount may be reached through a link (a
// temporary folder on macOS is): compared as written, it would read as outside the repository.
function realOf(abs) {
  try {
    return realpathSync(abs)
  } catch {
    return abs // not there: compared as written
  }
}

/** The submodule's name in `.gitmodules`, and the branch it is told to follow there. */
function gitmodulesEntry(siteTop, path) {
  const out = text(siteTop, ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'])
  for (const line of (out || '').split('\n')) {
    const at = line.indexOf(' ')
    if (at === -1 || line.slice(at + 1) !== path) continue
    const name = line.slice('submodule.'.length, at - '.path'.length)
    let branch = text(siteTop, ['config', '-f', '.gitmodules', '--get', `submodule.${name}.branch`]) || null
    // `.` is git's "the branch the superproject is on".
    if (branch === '.') branch = text(siteTop, ['symbolic-ref', '--short', '-q', 'HEAD']) || null
    return { name, branch }
  }
  return { name: null, branch: null }
}

/** The remote a checkout takes from: its branch's upstream, else `origin`, else its only one. */
function remoteOf(top) {
  const up = upstreamOf(top)
  if (up) return { name: up.remote, branch: up.merge.replace(/^refs\/heads\//, ''), upstream: true }
  const names = (text(top, ['remote']) || '').split('\n').filter(Boolean)
  const name = names.includes('origin') ? 'origin' : names[0]
  return name ? { name, branch: null, upstream: false } : null
}

/**
 * Each page folder the site mounts that is a repository of its own, with what this machine
 * knows of it: nothing is asked of a remote (`askRemote` does that).
 *
 * @returns {Promise<Array<{
 *   segment: string, dir: string, abs: string, siteTop: string|null, top: string|null,
 *   prefix: string, head: string|null, edits: string[],
 *   submodule: { path: string, recorded: string, name: string|null } | null,
 *   pin: 'same'|'behind'|'ahead'|'diverged'|'missing'|null,
 *   follows: { remote: string, branch: string|null, upstream: boolean, label: string|null } | null
 * }>>} `pin` compares a submodule's checkout with the commit the site's repository records,
 *   and is null for a clone the site's repository does not record.
 */
export async function mountedRepositories(siteDir) {
  let paths = null
  try {
    paths = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))?.paths ?? null
  } catch {
    return []
  }
  const { mountEntriesOf } = await import('@uniweb/build/site')
  const entries = mountEntriesOf(paths)
  if (!entries.length) return []
  const site = repoOf(siteDir)
  const out = []
  for (const [segment, dir] of entries) {
    const abs = resolve(siteDir, String(dir))
    // ⭐ The one classification `mountHolding` gives — a submodule's mount among them.
    const sub = site?.head ? submoduleHolding(site.top, realOf(abs)) : null
    const own = existsSync(abs) ? repoOf(abs) : null
    // A submodule never checked out is an empty folder of the site's own repository.
    const top = own && own.top !== site?.top ? own.top : null
    // In the site's own repository, or in none: the site's own git says all there is.
    if (!sub && !top) continue
    const prefix = slash(relative(top ?? join(site.top, sub.path), realOf(abs)))
    const head = top ? text(top, ['rev-parse', 'HEAD']) : null
    let edits = []
    if (top) {
      try {
        edits = run(top, ['status', '--porcelain', '--', prefix || '.']).split('\n').filter(Boolean)
      } catch {
        edits = []
      }
    }
    const entry = sub ? gitmodulesEntry(site.top, sub.path) : null
    let pin = null
    if (sub) {
      if (!top || !head) pin = 'missing'
      else if (head === sub.recorded) pin = 'same'
      else if (!holds(top, sub.recorded)) pin = 'behind'
      else if (sameFolder(top, head, sub.recorded, prefix)) pin = 'same'
      else if (ancestor(top, head, sub.recorded)) pin = 'behind'
      else if (ancestor(top, sub.recorded, head)) pin = 'ahead'
      else pin = isShallow(top) ? 'behind' : 'diverged'
    }
    const remote = top ? remoteOf(top) : null
    const follows = remote
      ? {
          remote: remote.name,
          // A submodule follows what `.gitmodules` says, whatever branch its checkout is on.
          branch: sub ? entry.branch : remote.upstream ? remote.branch : null,
          upstream: !sub && remote.upstream,
          label: remoteLabel(text(top, ['remote', 'get-url', remote.name])) ?? remote.name
        }
      : null
    out.push({
      segment,
      dir: String(dir),
      abs,
      siteTop: site?.top ?? null,
      top,
      prefix,
      head,
      edits,
      submodule: sub ? { path: sub.path, recorded: sub.recorded, name: entry.name } : null,
      pin,
      follows
    })
  }
  return out
}

/**
 * The tip of the branch a mount follows, asked of its remote with `git ls-remote`, which fetches
 * nothing and writes nothing: `{ branch, tip }`, or null when it has no remote or no answer came.
 */
export async function askRemote(m, { timeoutMs = 5000 } = {}) {
  if (!m.top || !m.follows) return null
  const { remote, branch } = m.follows
  let out
  try {
    out = await remoteCall(
      m.top,
      branch ? ['ls-remote', '--', remote, `refs/heads/${branch}`] : ['ls-remote', '--symref', '--', remote, 'HEAD'],
      timeoutMs
    )
  } catch {
    return null
  }
  const lines = out.split('\n').map((line) => line.split('\t'))
  if (branch) {
    const tip = lines.find(([, ref]) => ref === `refs/heads/${branch}`)?.[0]
    return tip ? { branch, tip } : null
  }
  const symref = lines.find(([a, ref]) => a.startsWith('ref: ') && ref === 'HEAD')
  const tip = lines.find(([a, ref]) => a && !a.startsWith('ref: ') && ref === 'HEAD')?.[0]
  return tip ? { branch: symref ? symref[0].replace(/^ref: refs\/heads\//, '') : null, tip } : null
}

/**
 * Where a mount's checkout stands against the tip its remote answered:
 * - `current`: at it, or the mounted folder reads the same there;
 * - `newer`: the remote has commits that change the folder, and the checkout is on their line;
 * - `ahead`: the checkout has commits the remote lacks;
 * - `diverged`: each has commits the other lacks;
 * - `unheld`: the tip is not here yet, so only a fetch can say whether it changes the folder.
 */
export function standing(m, tip) {
  if (!m.head || !tip) return null
  if (tip === m.head) return 'current'
  if (!holds(m.top, tip)) return 'unheld'
  if (ancestor(m.top, tip, m.head)) return 'ahead'
  if (sameFolder(m.top, m.head, tip, m.prefix)) return 'current'
  if (ancestor(m.top, m.head, tip)) return 'newer'
  return isShallow(m.top) ? 'newer' : 'diverged'
}

/** Fetch a branch's tip into the mount's repository: objects and a remote-tracking ref, never its checkout. */
export async function fetchTip(m, branch, { timeoutMs = 60_000 } = {}) {
  if (!m.top || !m.follows || !branch) return false
  try {
    await remoteCall(m.top, ['fetch', '--quiet', m.follows.remote, `refs/heads/${branch}`], timeoutMs)
    return true
  } catch {
    return false
  }
}

/** The site's folder as its repository names it, for a commit message: `uniweb-io/site`, or `.`. */
function siteName(siteDir) {
  const repo = repoOf(siteDir)
  return repo?.path ?? '.'
}

/**
 * Bring one mount to its latest. A submodule goes first to the commit the site's repository
 * records (checked out if it never was), then to the tip of the branch it follows, with that pin
 * committed on its own; a clone on a branch is fast-forwarded to its upstream. Never over
 * uncommitted changes in it, never backwards, and never from a commit the branch does not
 * contain, which is a pin put somewhere else on purpose.
 *
 * ⭐ `merge`: a mount a pull writes into (`writable: true`) takes its latest as the site takes its own,
 * by merging, since the pull's commits there are its own work: a checkout that has them and a branch
 * that moved on have each moved, and the merge of the two is its latest. Never a rebase, which would
 * replay a pull's commit onto another one while the site's sync point still names it.
 *
 * @param {string} siteDir
 * @param {object} m - from `mountedRepositories`
 * @param {{ merge?: boolean }} [opts]
 * @returns {Promise<{ from: string|null, to: string|null, branch: string|null, commits: number|null,
 *   committed: string|null, left: string|null, kind: 'edits'|'no-remote'|'no-answer'|'ahead'|'off-branch'|'conflict'|null,
 *   error: string|null }>} `left` says why it stayed where it was, and `kind` names that reason;
 *   `error`, what failed
 */
export async function takeLatest(siteDir, m, { merge = false } = {}) {
  const r = { from: m.head, to: m.head, branch: null, commits: null, committed: null, left: null, kind: null, error: null }
  if (m.edits.length) return { ...r, left: `it has ${plural(m.edits.length, 'uncommitted change')}`, kind: 'edits' }
  let cur = m
  if (m.submodule && (m.pin === 'missing' || m.pin === 'behind')) {
    try {
      run(m.siteTop, ['submodule', 'update', '--init', '--', m.submodule.path], {
        env: quietGitEnv(m.siteTop, 120_000),
        timeout: 120_000
      })
    } catch (err) {
      return { ...r, error: gitError(err, 'git submodule update failed') }
    }
    cur = (await mountedRepositories(siteDir)).find((x) => x.segment === m.segment) ?? m
    r.to = cur.head
  }
  if (!cur.top || !cur.follows) return { ...r, left: 'it has no remote to take from', kind: 'no-remote' }
  const answer = await askRemote(cur)
  const label = cur.follows.label
  if (!answer) return { ...r, left: `${label} did not answer`, kind: 'no-answer' }
  r.branch = answer.branch
  if (answer.tip === cur.head) return r
  if (!holds(cur.top, answer.tip) && !(await fetchTip(cur, answer.branch))) {
    return { ...r, error: `could not fetch ${answer.branch ?? 'its branch'} from ${label}` }
  }
  if (ancestor(cur.top, answer.tip, cur.head)) return { ...r, left: `it has commits ${label} does not`, kind: 'ahead' }
  let contained = ancestor(cur.top, cur.head, answer.tip)
  // ⭐ A shallow clone holds the branch's recent commits cut off from their past, so the branch
  // can look as if it does not contain the checkout. Only that past can say.
  if (contained !== true && isShallow(cur.top)) {
    try {
      await remoteCall(cur.top, ['fetch', '--quiet', '--unshallow', cur.follows.remote], 300_000)
    } catch (err) {
      return { ...r, error: gitError(err, `could not fetch the history of ${label}`) }
    }
    contained = ancestor(cur.top, cur.head, answer.tip)
  }
  if (contained !== true && !merge) return { ...r, left: `${short(cur.head)} is not on ${answer.branch ?? 'its branch'}`, kind: 'off-branch' }
  try {
    if (contained !== true) {
      // Each has moved: the checkout's commits — a pull's among them — merged with the branch's.
      try {
        run(cur.top, ['merge', '--no-edit', '--no-verify', '--quiet', '-m', `Merge ${answer.branch ?? 'the latest'} of ${label}`, answer.tip])
      } catch {
        return { ...r, left: `its merge with ${answer.branch ?? 'its branch'} of ${label} has conflicts: settle them there and commit, then record it here`, kind: 'conflict' }
      }
    } else if (cur.follows.upstream) run(cur.top, ['merge', '--ff-only', '--quiet', answer.tip])
    else run(cur.top, ['checkout', '--quiet', '--detach', answer.tip])
  } catch (err) {
    return { ...r, error: gitError(err, 'git could not move it') }
  }
  const tip = contained === true ? answer.tip : text(cur.top, ['rev-parse', 'HEAD'])
  r.to = tip
  const n = Number(text(cur.top, ['rev-list', '--count', `${cur.head}..${answer.tip}`]))
  r.commits = Number.isInteger(n) ? n : null
  if (cur.submodule) {
    const message = `${siteName(siteDir)}: pages/${cur.segment} from ${cur.submodule.path} at ${short(tip)}, ${contained === true ? 'the latest' : 'merged with the latest'} of ${label}`
    try {
      run(cur.siteTop, ['commit', '-q', '-m', message, '--', cur.submodule.path])
      r.committed = text(cur.siteTop, ['rev-parse', 'HEAD'])
    } catch (err) {
      r.error = `it moved, and its new pin is not committed: ${gitError(err, 'git commit failed')}`
    }
  }
  return r
}

/**
 * Commit a submodule's checkout as its pin, on its own: what a push sends from the folder is then
 * what the site's commit records. `{ commit }`, or `{ error }`.
 */
export function commitPin(siteDir, m) {
  const message = `${siteName(siteDir)}: pages/${m.segment} from ${m.submodule.path} at ${short(m.head)}`
  try {
    run(m.siteTop, ['commit', '-q', '-m', message, '--', m.submodule.path])
    return { commit: text(m.siteTop, ['rev-parse', 'HEAD']) }
  } catch (err) {
    return { error: gitError(err, 'git commit failed') }
  }
}

/**
 * A line for each mount `refresh` would bring forward: not checked out, behind the commit the
 * site's repository records, or behind the branch it follows. For a verb that has just left
 * mounted pages as their files hold them (`pull`), where the person would otherwise read that
 * as current.
 */
export async function behindLines(siteDir) {
  const out = []
  for (const m of await mountedRepositories(siteDir)) {
    const name = mountName(m)
    if (m.pin === 'missing' || m.pin === 'behind') {
      out.push(`${name} is behind the commit this repository records: \`npx uniweb refresh\` takes it.`)
      continue
    }
    if (!m.follows || m.edits.length) continue
    const answer = await askRemote(m)
    const s = answer ? standing(m, answer.tip) : null
    if (s === 'newer' || s === 'unheld') out.push(`${name}: ${m.follows.label} has newer commits, which \`npx uniweb refresh\` takes.`)
  }
  return out
}

/** `pages/docs ← external/docs`: the mount, by the path its repository goes by. */
export function mountName(m) {
  return `pages/${m.segment} ← ${m.submodule?.path ?? m.dir}`
}

/** One line for what `takeLatest` did. */
export function describeTaken(m, r) {
  const name = mountName(m)
  if (r.error) return `${name}: ${r.error}`
  if (r.left) return `${name}: left at ${short(r.to)}, since ${r.left}.`
  if (r.from === r.to) return `${name}: at the latest of ${m.follows?.label ?? 'its remote'}${r.branch ? ` (${r.branch})` : ''}.`
  const moved = `${short(r.from) || 'not checked out'} → ${short(r.to)}${r.commits != null ? ` (${plural(r.commits, 'commit')})` : ''}`
  return `${name}: ${moved}${r.committed ? `, committed as ${short(r.committed)}` : ''}.`
}
