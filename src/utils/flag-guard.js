/**
 * Reject unrecognized flags on the backend verbs.
 *
 * Every one of these commands can send data to, or authenticate against, a remote
 * host — and the CLI resolves flags by scanning argv for a literal, so a flag it
 * does not recognize does not fail: it *disappears*, and the thing it was meant to
 * change silently keeps its default.
 *
 * That is tolerable for a cosmetic flag and dangerous for these two:
 *
 *   --backend   mistyped ⇒ the origin ladder falls through to the session origin,
 *               ~/.uniweb/config.json, and finally https://uniweb.app. A command
 *               aimed at a local backend can reach production.
 *   --token     mistyped ⇒ falls back to the stored session, so the request is
 *               made as whoever is logged in rather than whoever was intended.
 *
 * Neither produces an error today; both produce a plausible success against the
 * wrong host. This turns that class into one sentence.
 *
 * ⚠️ A wrong rejection is worse than a missed one — it breaks an invocation that
 * works — so the per-command lists must be complete, INCLUDING flags read by
 * helpers rather than by the command file itself. Two live examples: `--no-validate`
 * is consumed inside `utils/conformance.js`, and `--yes` inside
 * `backend/foundation-bring-along.js`. Grepping only the command's own source
 * misses both. When you add a flag anywhere on one of these paths, add it here.
 */

import { findUnknownFlags, didYouMean } from './args.js'

/** Accepted by every command, wherever they are actually consumed. */
const GLOBAL = ['--non-interactive', '--help', '-h']

/**
 * Login-method flags. Any verb that can hit an unauthenticated backend may fall
 * into `ensureRegistryAuth`, which hands `args` to the login picker — so these are
 * genuinely reachable from all of them, not just from `uniweb login`.
 */
const AUTH = ['--browser', '--password', '--token-paste']

/**
 * Flags a verb inherits by importing `commands/deploy.js` for `resolveSiteDir` /
 * `resolveSiteBackend`. Inert on these verbs, and listed rather than filtered:
 * accepting a flag that does nothing is exactly the pre-guard behaviour, while
 * rejecting one that works is a broken command. The guard's job is catching
 * `--backed`, not policing inert-but-valid spellings.
 */
const VIA_DEPLOY = ['--target', '--host', '--no-save']

/**
 * Per-verb flag sets. Derived by scanning each command for dash-literals AND the
 * helpers it calls — not from the help text, which has drifted from the parser in
 * both directions (`--as-org` was implemented and undocumented; `--yes` is
 * documented on `publish` and consumed two files away).
 */
const VERBS = {
  push: [
    '--all', '--as-org', '--org', '--backend', '--dry-run', '--force',
    '--foundation', '--output', '-o', '--personal', '--registry', '--token',
    // read in utils/conformance.js and backend/site-sync.js respectively —
    // neither appears in push.js
    '--no-validate', '--yes',
    // via backend/foundation-bring-along.js, which push runs since 2026-08-19 —
    // one of the three flags that skip its prompts. Found by
    // flag-guard-coverage.test.js the moment push gained the import, which is
    // exactly the hand-enumeration failure that test exists to catch.
    '--no-verify',
    // ship content against the already-released code, releasing nothing
    '--no-release', ...VIA_DEPLOY
  ],
  publish: [
    '--as-org', '--org', '--backend', '--dry-run', '--force', '--foundation',
    '--personal', '--registry', '--token',
    // read in utils/conformance.js, backend/site-sync.js, and
    // backend/foundation-bring-along.js — none appear in publish.js
    '--no-validate', '--yes', '--no-verify', '--no-release', ...VIA_DEPLOY
  ],
  pull: [
    '--backend', '--content-only', '--dry-run', '--force', '--merge',
    '--no-assets',
    '--no-records', '--no-delete', '--no-prune', '--registry', '--token',
    // via backend/site-sync.js (the owner resolver) and utils/conformance.js
    '--yes', '--org', '--as-org', '--no-validate', ...VIA_DEPLOY
  ],
  clone: [
    '--backend', '--content-only', '--no-assets', '--no-records', '--path',
    '--project', '--registry', '--token', '--org', '--as-org'
  ],
  register: [
    '--backend', '--dry-run', '--json', '--output', '-o', '--registry',
    '--schema-only', '--scope', '--token', '--org', '--as-org'
  ],
  status: [
    '--backend', '--json', '--registry', '--remote', '--token', '--dry-run',
    '--force', '--no-verify', '--no-validate', '--yes', '--org', '--as-org',
    // inert here, reachable through the bring-along module status imports for
    // `resolveLocalFoundation` — listed per the over-approximation note above
    '--no-release', ...VIA_DEPLOY
  ],
  /**
   * `refresh` = `git pull`, then a DELEGATED `pull --merge`.
   *
   * It forwards exactly three flags to that pull — `--backend` / `--registry` /
   * `--token`, via its own `collectPassthrough` — and constructs the rest of the
   * argv itself. So pull's own flags (`--merge`, `--force`, `--no-delete`,
   * `--no-prune`, `--content-only`, …) are NOT reachable from a `refresh` argv and
   * are deliberately absent here. ⚠️ `--force` especially: `refresh` is read-only by
   * design, and forwarding it would ask pull to DISCARD local work.
   *
   * The trailing group is inert on this verb but reachable through the
   * `resolveSiteDir` / `probeUnpushed` imports — listed rather than filtered, per
   * the VIA_DEPLOY note above, and required by `flag-guard-coverage.test.js`.
   */
  refresh: [
    '--backend', '--no-backend', '--no-git', '--registry', '--token',
    '--as-org', '--org', '--dry-run', '--no-validate', '--yes', ...VIA_DEPLOY
  ]
}

/**
 * `sync` is `refresh` + `push`, forwarding RAW argv to both halves — so its
 * accepted set is exactly the UNION of theirs. Derived, never hand-written.
 *
 * Hand-writing it would rot the moment either half gained a flag, and it would rot
 * in the expensive direction: `uniweb sync --no-git` and `uniweb sync --force` are
 * both documented in `sync.js`, and a union that forgot either would reject a
 * working command.
 *
 * ⭐ The union is also WHY `sync` checks and the two halves skip (`skipFlagCheck`,
 * see `sync.js`). Each half's set is a strict subset of this one, so letting them
 * re-check would have `push` reject `--no-git` and `refresh` reject `--force` —
 * both legal on `sync`. Validating once, against the union, at the only layer that
 * knows both halves are in play, is what makes the composite safe.
 */
VERBS.sync = [...new Set([...VERBS.refresh, ...VERBS.push])]

/**
 * The accepted set per verb: its own flags, plus the login-method flags every
 * backend verb can reach, plus the globals.
 *
 * Derived from each verb's IMPORT GRAPH, not from its own source and not from the
 * help text — `test/flag-guard-coverage.test.js` walks that graph and fails if a
 * verb can honour a flag this list omits. Deliberately an over-approximation: a
 * flag accepted here but inert costs nothing (it was ignored before the guard
 * existed), while one rejected here breaks a working command.
 */
export const VERB_FLAGS = Object.fromEntries(
  Object.entries(VERBS).map(([verb, flags]) => [
    verb,
    [...new Set([...flags, ...AUTH])]
  ])
)

/**
 * Check `args` against the verb's accepted set. Returns null when everything is
 * recognized, or a ready-to-print message naming the first offender (plus a
 * suggestion when one is close).
 *
 * Reports ONE flag rather than all of them: the first is usually the cause, and a
 * list invites skimming past the suggestion, which is the actionable half.
 *
 * @param {string} verb - a key of VERB_FLAGS
 * @param {string[]} args - the argv slice for this command
 * @returns {{ flag: string, message: string, suggestion: string|null }|null}
 */
export function checkFlags(verb, args = []) {
  const known = VERB_FLAGS[verb]
  if (!known) return null
  const all = [...known, ...GLOBAL]
  const unknown = findUnknownFlags(args, all)
  if (!unknown.length) return null

  const flag = unknown[0]
  const suggestion = didYouMean(flag, all)
  const lines = [`Unknown flag \`${flag}\` for \`uniweb ${verb}\`.`]
  if (suggestion) lines.push(`  Did you mean \`${suggestion}\`?`)
  lines.push(`  Run \`uniweb ${verb} --help\` for the accepted flags.`)
  return { flag, suggestion, message: lines.join('\n') }
}
