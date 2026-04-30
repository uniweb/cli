/**
 * Internal env-var helpers.
 *
 * UNIWEB_* env vars are escape hatches for developers, operators, and the
 * platform test team — not user-facing settings. Documented in
 * `framework/cli/docs/env-vars.md`. Anything truly user-facing should be a
 * flag, not an env var.
 */

/**
 * Parse a boolean-shaped env var. Returns true for "1", "true", "yes" (any
 * case); false otherwise (including unset, empty, or any other string).
 *
 * @param {string} name - Env var name (e.g., "UNIWEB_SKIP_BUILD").
 * @returns {boolean}
 */
export function parseBoolEnv(name) {
  const raw = process.env[name]
  if (!raw) return false
  const v = String(raw).trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
