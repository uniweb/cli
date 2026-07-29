/**
 * uniweb sync — catch up, then share. `refresh` followed by `push`.
 *
 * The two halves already exist and already carry the safety:
 *
 *   - `refresh` takes teammates' commits and merges the backend's content, and
 *     exits NON-ZERO when a merge left conflicts;
 *   - `push` refuses when the backend has moved under you, and never overwrites
 *     an author's work blind.
 *
 * So this verb adds no guarantees of its own — it composes two commands that
 * already hold them. That is deliberate: a safety check you can only get by
 * remembering to type `sync` is not a safety check, which is why the gate lives in
 * `push` and the conflict stop lives in `refresh`. Anyone typing
 * `uniweb refresh && uniweb push` gets the identical behaviour, and the exit codes
 * are what make that chain correct rather than anything here.
 *
 * A THIN COMPOSITION, not a reimplementation. Both halves are called, never
 * re-created. The `deploy`/`publish` split is the cautionary tale: two paths that
 * did nearly the same thing drifted until one of them was quietly wrong.
 *
 * WHY IT STOPS ON CONFLICTS. Pushing after an unresolved merge would put conflict
 * markers into content authors see. `refresh` reports them and exits non-zero; this
 * stops there and says what is left to do.
 *
 * WHAT IT DOES NOT DO: publish. Sync brings the local copy and the backend DRAFT
 * into agreement; going live stays a separate, deliberate act (`uniweb publish`).
 * That separation is what keeps an unintended sync recoverable — the worst case is
 * work-in-progress visible to authors in the app, not shipped to visitors.
 *
 * Reach for `refresh` when you only want to catch up — it cannot ship anything, so
 * it is the one to run reflexively. Reach for `sync` when you also mean to share.
 *
 * Usage:
 *   uniweb sync                    refresh, then push
 *   uniweb sync --no-git           skip the git remote half of the refresh
 *   uniweb sync --force            forwarded to push (overwrite upstream changes)
 *   uniweb sync --backend <url>    override the backend origin
 */

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
}
const say = {
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`)
}

/**
 * @param {string[]} args
 * @param {object} [deps] - injectable seams for testing: `refresh`, `push`.
 */
export async function sync(args = [], deps = {}) {
  const refresh = deps.refresh || (await import('./refresh.js')).refresh
  const push = deps.push || (await import('./push.js')).push

  // `--force` means "overwrite upstream" and belongs to the push half only. Passing
  // it to the refresh would ask pull to DISCARD the local work this command exists
  // to send — the same word meaning opposite things on the two halves.
  const refreshArgs = args.filter((a) => a !== '--force')

  const r = await refresh(refreshArgs)
  if (r?.exitCode) {
    // refresh already explained itself — conflicts, or a git failure. Adding a
    // second summary here would just bury it.
    say.dim('Not pushing while that is unresolved.')
    return { exitCode: r.exitCode }
  }

  console.log('')
  say.info('Pushing your changes…')
  const p = await push(args)
  return { exitCode: p?.exitCode ?? 0 }
}

export default sync
