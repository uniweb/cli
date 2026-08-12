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
 * Per-verb flag sets. Derived by scanning each command for dash-literals AND the
 * helpers it calls — not from the help text, which has drifted from the parser in
 * both directions (`--as-org` was implemented and undocumented; `--yes` is
 * documented on `publish` and consumed two files away).
 */
export const VERB_FLAGS = {
  push: [
    '--all', '--as-org', '--org', '--backend', '--dry-run', '--force',
    '--foundation', '--output', '-o', '--personal', '--registry', '--token',
    '--no-validate'
  ],
  publish: [
    '--as-org', '--org', '--backend', '--dry-run', '--force', '--foundation',
    '--no-save', '--personal', '--registry', '--token', '--no-validate', '--yes'
  ],
  pull: [
    '--backend', '--content-only', '--dry-run', '--force', '--merge',
    '--no-collections', '--no-delete', '--no-prune', '--registry', '--token'
  ],
  clone: [
    '--backend', '--content-only', '--no-collections', '--path', '--project',
    '--registry', '--token'
  ],
  register: [
    '--backend', '--dry-run', '--json', '--output', '-o', '--registry',
    '--schema-only', '--scope', '--token'
  ],
  status: ['--backend', '--json', '--registry', '--remote', '--token']
}

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
