/**
 * argv parsing helpers shared across CLI commands.
 */

/**
 * Read `--flag value` from argv. Accepts both `--flag value` and
 * `--flag=value`.
 *
 * Returns:
 *   - undefined when the flag is absent
 *   - null when the flag is present without a value (last arg, next is
 *     another flag, or `--flag=` empty form)
 *   - string when the flag carries a value
 *
 * The three-state return lets callers distinguish "not given" (e.g.,
 * fall back to a default) from "given but empty" (e.g., trigger an
 * interactive prompt).
 *
 * @param {string[]} args
 * @param {string} name — Including the leading dashes, e.g. '--host'.
 * @returns {string | null | undefined}
 */
/**
 * The org a site is created under. `--org` is the documented spelling; `--as-org`
 * is a working alias.
 *
 * `--as-org` mirrors the wire (`?as_org=`) and names an *acting capacity* — the
 * request is made as a member of that org, membership-gated. That is accurate, and
 * it is also not the name anyone reaches for: asked in one day, the backend's docs
 * said `--as-unit` and a second reader said `--org`; nobody produced `--as-org`.
 * Since the flag's main job is answering *who owns this site*, `--org` is the name
 * that matches the question, and the alias costs one `||` (the same shape
 * `--backend` already uses).
 *
 * `||`, not `??`, on purpose: a valueless `--org` falls through to `--as-org`
 * rather than shadowing it.
 *
 * @param {string[]} args
 * @returns {string|null|undefined}
 */
export function readOrgFlag(args) {
  return readFlagValue(args, '--org') || readFlagValue(args, '--as-org')
}

/**
 * Every `--flag` / `-f` token in `args` that `known` does not list.
 *
 * The CLI reads flags by scanning argv for a literal, so an unrecognized flag is
 * not an error — it is *invisible*, and whatever it was meant to change silently
 * keeps its default. The sharp case is `--backend`: mistype it and the origin
 * ladder falls through to the session, the saved config, or `https://uniweb.app`,
 * so a command aimed at localhost can reach production. `--token` degrades the
 * same way, to a stored session belonging to someone else.
 *
 * Scanning rules, chosen to avoid false positives (a wrong rejection is worse than
 * a missed one — it breaks a working command):
 *  - only tokens beginning with `-` are candidates; a VALUE is never one unless it
 *    itself looks like a flag, which `readFlagValue` already refuses to consume;
 *  - `--flag=value` is checked on the name half;
 *  - a bare `--` ends flag scanning, the POSIX convention;
 *  - a lone `-` is a value (stdin), not a flag.
 *
 * @param {string[]} args
 * @param {string[]} known - every flag this command accepts, with dashes
 * @returns {string[]} the unrecognized tokens, in order, deduped
 */
export function findUnknownFlags(args, known) {
  const set = new Set(known)
  const out = []
  for (const raw of args) {
    if (raw === '--') break
    if (raw === '-' || !raw.startsWith('-')) continue
    const name = raw.split('=')[0]
    if (set.has(name) || out.includes(name)) continue
    out.push(name)
  }
  return out
}

/** Levenshtein distance, small and iterative — used only for a suggestion. */
function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      diag = tmp
    }
  }
  return prev[b.length]
}

/**
 * The closest known flag to `flag`, or null when nothing is close enough.
 * The threshold scales with length so `--org` → `--as-org` is offered while two
 * unrelated short flags are not.
 * @param {string} flag
 * @param {string[]} known
 * @returns {string|null}
 */
export function didYouMean(flag, known) {
  let best = null
  let bestD = Infinity
  for (const k of known) {
    const d = editDistance(flag, k)
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  const limit = Math.max(2, Math.floor(flag.length / 3))
  return best && bestD <= limit ? best : null
}

export function readFlagValue(args, name) {
  const eqPrefix = name + '='
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      const next = args[i + 1]
      if (next === undefined || next.startsWith('--')) return null
      return next
    }
    if (args[i].startsWith(eqPrefix)) {
      const v = args[i].slice(eqPrefix.length)
      return v === '' ? null : v
    }
  }
  return undefined
}
