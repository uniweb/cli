/**
 * Byte formatting for refusal messages.
 *
 * Lives on its own because TWO lanes now print a storage refusal — the asset plan
 * (`backend/site-media.js`) and the site create (`backend/site-sync.js`) — and the
 * numbers must read identically in both. A second copy would drift in units or
 * rounding, and a user comparing "you have 1.1 GiB" against "this needs 100 MB"
 * cannot tell a real gap from a formatting difference.
 */

const KIB = 1024

/**
 * `1073741824` → `1 GiB`. Returns null for anything that is not a usable byte
 * count, so a refusal that omits an extra prints nothing rather than `undefined`.
 * @param {unknown} n
 * @returns {string|null}
 */
export function humanBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  if (n < KIB) return `${n} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let v = n / KIB
  let i = 0
  while (v >= KIB && i < units.length - 1) {
    v /= KIB
    i++
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
