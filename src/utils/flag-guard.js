/**
 * Reject unrecognized flags on the backend verbs.
 *
 * Every one of these commands can send data to, or authenticate against, a remote
 * host — and the CLI resolves flags by scanning argv for a literal, so a flag it
 * does not recognize does not fail: it *disappears*, and the thing it was meant to
 * change silently keeps its default.
 *
 * Tolerable for a cosmetic flag; dangerous for any flag that aims the command or picks
 * its identity. This turns that class into one sentence.
 *
 * ⛔ **`--backend` and `--token` are NOT flags of these verbs** *(2026-09-21)*. Every
 * backend verb goes to the backend you are logged in to, with that login's session:
 * switching and signing in are `uniweb login` (`--backend`, `--token`), and a script
 * aims one process with UNIWEB_REGISTER_URL + UNIWEB_TOKEN. Both flags predate
 * per-backend sessions. Passed now, each is an unknown flag — and this guard is what
 * makes that a loud error, with a pointer to the login, instead of a command that
 * quietly runs against wherever and as whoever you happen to be. `--backend` stays on
 * `forget`, where it SELECTS which backend's records to remove.
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
 * Flags a verb inherits by importing `commands/deploy.js` for `resolveSiteDir`.
 * Inert on these verbs, and listed rather than filtered:
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
    '--all', '--as-org', '--org', '--dry-run', '--force',
    '--foundation', '--output', '-o', '--personal',
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
    '--as-org', '--org', '--dry-run', '--force', '--foundation',
    '--personal',
    // read in utils/conformance.js, backend/site-sync.js, and
    // backend/foundation-bring-along.js — none appear in publish.js
    '--no-validate', '--yes', '--no-verify', '--no-release', ...VIA_DEPLOY
  ],
  pull: [
    '--content-only', '--dry-run', '--force', '--merge',
    '--no-assets',
    '--no-records', '--no-delete', '--no-prune',
    // via backend/site-sync.js (the owner resolver) and utils/conformance.js
    '--yes', '--org', '--as-org', '--no-validate', ...VIA_DEPLOY
  ],
  clone: [
    '--content-only', '--no-assets', '--no-records', '--path',
    '--project', '--org', '--as-org'
  ],
  register: [
    '--dry-run', '--json', '--output', '-o',
    '--schema-only', '--scope', '--org', '--as-org'
  ],
  /**
   * `forget` = remove one backend's records (`--backend <url>`), or everything a
   * copied project inherited (`--all`). One of the two is required — the verb refuses
   * without it — and they exclude each other. `--non-interactive` reaches it through
   * resolveSiteDir in a workspace of several sites.
   */
  forget: ['--backend', '--all'],
  status: [
    '--json', '--remote', '--dry-run',
    '--force', '--no-verify', '--no-validate', '--yes', '--org', '--as-org',
    // inert here, reachable through the bring-along module status imports for
    // `resolveLocalFoundation` — listed per the over-approximation note above
    '--no-release', ...VIA_DEPLOY
  ],
  /**
   * `refresh` = `git pull`, then a DELEGATED `pull --merge`.
   *
   * It forwards nothing of its own argv to that pull — it builds `['--merge']`
   * itself. So pull's own flags (`--merge`, `--force`, `--no-delete`, `--no-prune`,
   * `--content-only`, …) are NOT reachable from a `refresh` argv and
   * are deliberately absent here. ⚠️ `--force` especially: `refresh` is read-only by
   * design, and forwarding it would ask pull to DISCARD local work.
   *
   * The trailing group is inert on this verb but reachable through the
   * `resolveSiteDir` / `probeUnpushed` imports — listed rather than filtered, per
   * the VIA_DEPLOY note above, and required by `flag-guard-coverage.test.js`.
   */
  refresh: [
    '--no-backend', '--no-git',
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
/**
 * Read in the verbs' import graphs, and deliberately NOT accepted by them.
 *
 * `--token` is read by `runRegistryLogin` (utils/registry-auth.js) for
 * `uniweb login --token <bearer>`, which seeds and STORES a session. The verbs reach
 * that function through `ensureRegistryAuth`, which strips `--token` from their argv
 * first — so a static walk sees the read, and no verb can honour it.
 * `flag-guard-coverage.test.js` subtracts this list; add to it only with the same
 * proof: a read no verb's argv can reach.
 */
export const LOGIN_ONLY = ['--token']

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
  // ⭐ `--backend` and `--token` are not typos on these verbs — they are RETIRED
  // (2026-09-21), and the useful answer is what replaced them, not "run --help".
  if (flag === '--backend') {
    return {
      flag,
      suggestion: null,
      message: [
        `\`uniweb ${verb}\` has no \`--backend\`: it goes to the backend you are logged in to.`,
        '  Switch with: uniweb login --backend <url>',
        '  (A script can aim one process with UNIWEB_REGISTER_URL instead.)'
      ].join('\n')
    }
  }
  if (flag === '--token') {
    return {
      flag,
      suggestion: null,
      message: [
        `\`uniweb ${verb}\` has no \`--token\`: it uses the session of the backend you are logged in to.`,
        '  Sign in with a token: uniweb login --backend <url> --token <bearer>',
        '  (A script can authenticate one process with UNIWEB_TOKEN instead.)'
      ].join('\n')
    }
  }
  const suggestion = didYouMean(flag, all)
  const lines = [`Unknown flag \`${flag}\` for \`uniweb ${verb}\`.`]
  if (suggestion) lines.push(`  Did you mean \`${suggestion}\`?`)
  lines.push(`  Run \`uniweb ${verb} --help\` for the accepted flags.`)
  return { flag, suggestion, message: lines.join('\n') }
}
