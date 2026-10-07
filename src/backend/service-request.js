/**
 * The requests a push or publish carries — what the owner asks for, and whether it
 * is new.
 *
 * Two of them, kept by two mechanisms:
 *
 *   - ⭐ **The services** — `site.yml::services`, a map by service name *[Diego,
 *     2026-10-06]*. A push STATES them — the file's, and off for each held one it no
 *     longer lists — and the backend decides per service from the versions sent
 *     (`statedServices`, `@uniweb/build/uwx`; spec:
 *     kb/framework/reference/site-services-request.md). All this module does for them
 *     is say what the file asks that will not be sent (`announceServices`).
 *   - **The language selection** — `site.yml::publishLanguages` — told apart from the
 *     status quo by a fingerprint banked in `deploy.yml` (`reconcile`, `bankLanguages`).
 *
 * ⭐ The model both follow — *"the services in `site.yml` are a request, never a
 * tracking of what is running"* [Diego, 2026-09-05]. You ask by CHANGING the file.
 *
 * ⛔ *From 2026-09-20 to 2026-10-06 the services lived only in `sync.json`, which
 * nobody edits, so a CLI user could ask for nothing; this module then compared them by
 * a fingerprint in `deploy.yml`, which could not tell who moved; and until 2026-10-07
 * it read the site's services before every push and settled each against a record in
 * `sync.json` (`settleServices`), because the backend replaced the list it was sent.*
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readServicesRequest, unreadableServices } from '@uniweb/build/uwx'

/**
 * A stable fingerprint of one declared value, or `null` when the key is absent.
 *
 * ⭐ `null` (absent) and the hash of `[]` are DIFFERENT, and must stay so: for the
 * language selection, no key means "every declared language" and `[]` means none.
 *
 * List entries are ordered by their serialized form and object keys sorted, so
 * reordering them in the file is not a change.
 *
 * @param {*} declared
 * @returns {string|null} 16 hex chars, or null when undeclared
 */
export function fingerprintDeclaration(declared) {
  if (declared === undefined || declared === null) return null
  const canonical = Array.isArray(declared)
    ? declared.map(stableString).sort()
    : [stableString(declared)]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16)
}

/** Absent, or an empty list — a stored value that asks for nothing. */
function isNothing(value) {
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0)
}

/** Deterministic JSON: object keys sorted at every depth, arrays left in order. */
function stableString(value) {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v
  )
}

/**
 * A two-way request field, reconciled against what the site has stored.
 *
 * `site.yml::publishLanguages` is the owner's ASK, pushed up, projected back on pull,
 * and stored on the other side where something else may move it.
 *
 * ⛔ A BASE IS NEEDED EVEN WHERE NOTHING ELSE WRITES THE FIELD. Overwriting is not the
 * only thing a base is for — without one, a value that has always been in the file
 * is indistinguishable from one the owner just typed, so the CLI cannot tell an
 * intentional change from the status quo. For languages that difference is money:
 * the count is priced, so a new language is a charge, and saying so before sending
 * requires knowing it is new.
 *
 * @param {*} localValue - the file's declaration
 * @param {*} remoteValue - what the site has stored
 * @param {string|null} baseFingerprint - what we last agreed on
 * @returns {{action: 'none'|'adopt'|'send'|'conflict', local: string|null, remote: string|null}}
 */
export function reconcile(localValue, remoteValue, baseFingerprint) {
  const local = fingerprintDeclaration(localValue)
  const remote = fingerprintDeclaration(remoteValue)
  const base = baseFingerprint || null

  if (local === remote) return { action: 'none', local, remote }
  // ⛔ A FILE THAT DECLARES NOTHING ASKS NOTHING, so it is never one side of a conflict.
  // With nothing stored either there is nothing to do; with something stored, the file
  // is merely behind.
  if (local === null) return { action: isNothing(remoteValue) ? 'none' : 'adopt', local, remote }
  if (!base) return { action: 'conflict', local, remote }

  const localMoved = local !== base
  const remoteMoved = remote !== base
  if (!localMoved && remoteMoved) return { action: 'adopt', local, remote }
  if (localMoved && !remoteMoved) return { action: 'send', local, remote }
  return { action: 'conflict', local, remote }
}

/**
 * What a publish records in `deploy.yml` about the language selection: its
 * fingerprint, on EVERY publish — it rides the content push, so what went live is
 * what was agreed.
 *
 * ⛔ A FINGERPRINT, never the list: `deploy.yml` records what a publish did, and the
 * selection itself is in `site.yml`.
 *
 * @param {object} siteYml
 * @returns {{publishLanguagesRequest?: string}}
 */
export function bankLanguages(siteYml) {
  const langs = fingerprintDeclaration(siteYml?.publishLanguages)
  return langs ? { publishLanguagesRequest: langs } : {}
}

/**
 * The services the site's foundation says it renders — the build's `_self.supports`, else
 * `package.json::uniweb.supports` — or null when that is unknown: no local foundation, or
 * one that declares nothing. ⛔ Absent is UNKNOWN, never "none".
 *
 * @param {string} siteDir
 * @param {object} siteYml - parsed
 * @returns {Promise<string[]|null>}
 */
export async function foundationSupports(siteDir, siteYml) {
  try {
    if (!siteYml?.foundation) return null
    const { detectFoundationType } = await import('@uniweb/build')
    const found = detectFoundationType(siteYml.foundation, siteDir)
    if (found?.type !== 'local' || !found.path) return null
    const built = join(found.path, 'dist', 'meta', 'schema.json')
    if (existsSync(built)) {
      const derived = JSON.parse(readFileSync(built, 'utf8'))?._self?.supports
      if (Array.isArray(derived)) return derived
    }
    const declared = JSON.parse(readFileSync(join(found.path, 'package.json'), 'utf8'))?.uniweb?.supports
    return Array.isArray(declared) ? declared : null
  } catch {
    return null
  }
}

const names = (list) => list.map((n) => `\`${n}\``).join(', ')

/**
 * Say what `site.yml::services` asks that will not be sent as written — a credential,
 * an entry that is not one, a `backend` address — and where it and the foundation disagree,
 * before a push or publish sends the rest. What a push sends is the producer's
 * (`statedServices`), from the same file.
 *
 * ⭐ The foundation INFORMS and never decides [Diego, 2026-10-07]: a service the file turns
 * on that the foundation does not say it renders is said; so is one it renders that the
 * file does not mention, since every service is off unless the site asks for it. An
 * explicit `false` is a decision, and quiets the second. `tracking` is in neither — a
 * foundation may not claim it, since it renders nothing — and `records` is left to
 * publish, which knows whether the pages show any (`recordsNotAsked`).
 *
 * @param {object} p
 * @param {object} p.siteYml - parsed
 * @param {{ warn: Function }} p.say
 * @param {string[]|null} [p.supports] - from `foundationSupports`; null = unknown
 */
export function announceServices({ siteYml, say, supports = null }) {
  // An entry the push cannot read stops the package build next, which says what to write
  // (`refuseUnreadableServices`). Nothing to add before it — and what this would say, read
  // past that entry, is wrong: `search: yes` was "site.yml turns on `search`" (F14).
  if (unreadableServices(siteYml?.services).length) return
  const asks = readServicesRequest(siteYml?.services, { warn: (m) => say.warn(m) }) || []
  if (!Array.isArray(supports)) return
  const ignored = new Set(['tracking', 'records'])
  const has = (ask) => ask.enabled !== false || typeof ask.config?.endpoint === 'string'
  const unrendered = asks.filter((a) => has(a) && !ignored.has(a.name) && !supports.includes(a.name)).map((a) => a.name)
  if (unrendered.length) {
    say.warn(`site.yml turns on ${names(unrendered)}, which your foundation does not say it renders (\`uniweb.supports\`).`)
  }
  const mentioned = new Set(asks.map((a) => a.name))
  const unasked = supports.filter((n) => !ignored.has(n) && !mentioned.has(n))
  if (unasked.length) {
    say.warn(
      `Your foundation renders ${names(unasked)}, which site.yml does not ask for — a service is off ` +
        `unless the site asks for it. Add ${unasked.length === 1 ? 'it' : 'them'} under \`services:\`, or set ` +
        `${unasked.length === 1 ? 'it' : 'each'} to \`false\` if that is what you mean.`
    )
  }
}

/**
 * The publish warning for `records`: the site's pages show records live, and `site.yml`
 * does not ask for the service that delivers them on a published site [Diego, 2026-10-07:
 * "When records is off and the site is published with us, there is no meant to be a fall
 * back at all"]. Syncing records does not depend on it, so push and pull say nothing.
 *
 * @param {object} p
 * @param {object} p.siteYml - parsed
 * @param {string[]} p.shown - from the package (`recordsShown`)
 * @returns {string|null} the warning, or null
 */
export function recordsNotAsked({ siteYml, shown }) {
  if (!Array.isArray(shown) || !shown.length) return null
  const records = (readServicesRequest(siteYml?.services) || []).find((a) => a.name === 'records')
  if (records && records.enabled !== false) return null
  return (
    `Your pages show records from ${names(shown)}, but site.yml does not ask for \`records\` — ` +
    'a published site delivers them only with it on. Add `records: true` under `services:`.'
  )
}
