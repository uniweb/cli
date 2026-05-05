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
