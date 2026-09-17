/**
 * SemVer 2.0.0 precedence — how a registry orders a foundation's versions.
 *
 * A pre-release sorts below its release (`1.0.0-rc.1` < `1.0.0`), and build
 * metadata carries no order (`1.2.0+b` equals `1.2.0`).
 *
 * ⚖️ Not `compareSemver` in `dep-survey.js`: that one reads dependency specs
 * (`^1.2.3`) for `uniweb update` and compares major.minor.patch only. This one
 * is strict — anything that is not a SemVer version is `null`, never a guess.
 */

// The regex published with the SemVer 2.0.0 specification (semver.org, §FAQ).
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/**
 * @param {unknown} version
 * @returns {{ major: number, minor: number, patch: number, pre: string[] }|null}
 */
export function parseSemver(version) {
  if (typeof version !== 'string') return null
  const m = SEMVER.exec(version)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] }
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1|null} how `a` sorts against `b`; null when either is not SemVer
 */
export function compareSemverPrecedence(a, b) {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) return null
  for (const part of ['major', 'minor', 'patch']) {
    if (x[part] !== y[part]) return x[part] > y[part] ? 1 : -1
  }
  // A version with a pre-release sorts below the same version without one.
  if (!x.pre.length || !y.pre.length) {
    return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pNum = /^\d+$/.test(p)
    const qNum = /^\d+$/.test(q)
    // Numeric identifiers compare numerically and sort below alphanumeric ones.
    if (pNum && qNum) return BigInt(p) > BigInt(q) ? 1 : -1
    if (pNum !== qNum) return pNum ? -1 : 1
    return p > q ? 1 : -1
  }
  return 0
}
