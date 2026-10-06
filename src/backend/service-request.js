/**
 * The requests a push or publish carries — what the owner asks for, and whether it
 * is new.
 *
 * Two of them, kept by two mechanisms:
 *
 *   - ⭐ **The services** — `site.yml::services`, a map by service name *[Diego,
 *     2026-10-06]*. Sent as the site's own list with the owner's CHANGED asks applied,
 *     decided per service by comparing the file, the site now and the record of the
 *     last agreement in `sync.json` (`settleServices`; spec:
 *     kb/framework/reference/site-services-request.md).
 *   - **The language selection** — `site.yml::publishLanguages` — told apart from the
 *     status quo by a fingerprint banked in `deploy.yml` (`reconcile`, `bankLanguages`).
 *
 * ⭐ The model both follow — *"the services in `site.yml` are a request, never a
 * tracking of what is running"* [Diego, 2026-09-05]. You ask by CHANGING the file. An
 * unchanged ask is not re-sent: the backend REPLACES the services it is sent, so a
 * re-send would overwrite a decision the owner made in the app since.
 *
 * ⛔ *From 2026-09-20 to 2026-10-06 the services lived only in `sync.json`, which
 * nobody edits, so a CLI user could ask for nothing; and this module compared them by
 * a fingerprint in `deploy.yml`, which could not tell who moved.*
 *
 * @module
 */

import { createHash } from 'node:crypto'
import {
  readServicesRequest,
  takeServices,
  mergeServiceRows,
  reconcileServices,
  recordAfter,
  readBackendState,
  updateBackendState,
  writeSiteConfig
} from '@uniweb/build/uwx'

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

/** One service, as an owner reads it: `on`, `off`, `on (grade: pro)`. */
function describeService(row) {
  if (!row || typeof row !== 'object') return 'nothing set'
  const state = row.enabled === false ? 'off' : 'on'
  const settings =
    row.config && typeof row.config === 'object' ? Object.entries(row.config) : []
  if (!settings.length) return state
  const shown = settings
    .map(([k, v]) => `${k}: ${v !== null && typeof v === 'object' ? '…' : String(v)}`)
    .join(', ')
  return `${state} (${shown})`
}

/**
 * The file's entry, as its owner reads it — `off — your own at <address>` for a
 * service the site brings itself (which asks the host to leave its own off).
 */
function describeEntry(entry, ask) {
  const own =
    typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object' && typeof entry.endpoint === 'string'
        ? entry.endpoint
        : null
  return own ? `off — your own at ${own}` : describeService(ask)
}

const rowNamed = (rows, name) =>
  Array.isArray(rows) ? rows.find((r) => r && typeof r === 'object' && r.name === name) : undefined

/**
 * Decide what a push or publish sends of `site.yml::services` — and, once it has
 * succeeded, what the project records.
 *
 * Per service the file names, three states are compared: the file, the site now
 * (`status.services`), and the record of the last agreement (this backend's entry in
 * `sync.json`). What the owner changed is sent; what the site changed is kept, and
 * offered into `site.yml`; where both changed, the owner is asked. The list sent is the
 * site's own, with only the changed asks applied (`mergeServiceRows`) — so every other
 * service and setting the site holds is sent as it is stored.
 *
 * ⛔ An open decision — an offer declined, a conflict not resolved, or no terminal to
 * ask at — is never sent, and the record keeps the earlier agreement for it, so the
 * next run still sees the site's change rather than reading it as the file's.
 *
 * @param {object} p
 * @param {object} p.client - the backend client (`origin`, `siteStatus`)
 * @param {string} p.siteDir
 * @param {object} p.siteYml - parsed; updated in place when the owner takes the site's services
 * @param {object|null} [p.status] - the site's status, when the caller has just read it
 * @param {boolean} [p.offline] - read nothing from the backend (`--dry-run`, `-o`)
 * @param {boolean} [p.interactive] - whether the owner can be asked
 * @param {(message: string, initial?: boolean) => Promise<boolean>} p.confirm
 * @param {{ info: Function, warn: Function, dim: Function, ok: Function }} p.say
 * @returns {Promise<{ emit: object, after: () => void }>} `emit` — options for the
 *   producer; `after` — call once the push succeeded (or had nothing to send)
 */
export async function settleServices({
  client,
  siteDir,
  siteYml,
  status,
  offline = false,
  interactive = false,
  confirm,
  say
}) {
  const nothing = { emit: {}, after: () => {} }
  const asks = readServicesRequest(siteYml?.services, { warn: (m) => say.warn(m) })
  if (!asks) return nothing

  const state = readBackendState(siteDir, client.origin)
  const record = Array.isArray(state.services) ? state.services : undefined
  const siteUuid = state.site?.uuid || null
  let read = status
  if (read === undefined && !offline && siteUuid) read = await client.siteStatus(siteUuid)
  const stored = Array.isArray(read?.services) ? read.services : undefined

  const decision = reconcileServices({ asks, record, stored, siteKnown: Boolean(siteUuid) })
  if (decision.unreadable) {
    say.warn("site.yml asks for services, but this project has no record of your site's and could not read them, so none were sent.")
    say.dim('  Run `uniweb pull` to take them, then push again.')
    return nothing
  }

  const askFor = (name) => asks.find((a) => a.name === name)
  const entryFor = (name) => siteYml?.services?.[name]
  const send = [...decision.send]
  let offered = [...decision.adopt]
  const open = []

  // ⛔ BOTH MOVED: only the owner can rank two of their own decisions. Not a stop — the
  // content they asked to push is a separate thing — and never a guess.
  if (decision.conflict.length) {
    say.warn(
      record
        ? "Your site's services and site.yml both changed since your last sync:"
        : 'site.yml asks for services your site has set differently:'
    )
    for (const name of decision.conflict) {
      say.dim(`  ${name}: site.yml asks ${describeEntry(entryFor(name), askFor(name))} — your site has ${describeService(rowNamed(stored, name))}`)
    }
    if (!interactive) {
      say.dim("  Left as your site has them — run without --non-interactive to choose.")
      open.push(...decision.conflict)
    } else if (await confirm('Use the services in site.yml?', false)) {
      send.push(...decision.conflict)
    } else {
      // Declining to send is not yet a decision to take the site's: offered below.
      offered = [...offered, ...decision.conflict]
    }
  }

  // The site moved and the file did not: the file is behind. Offered, never done — a
  // push changes `site.yml` only when the owner says so.
  if (offered.length) {
    say.info("Your site's services changed since your last sync:")
    for (const name of offered) {
      say.dim(`  ${name}: your site has ${describeService(rowNamed(stored, name))} — site.yml says ${describeEntry(entryFor(name), askFor(name))}`)
    }
    if (interactive && (await confirm('Update site.yml to match?', false))) {
      const services = takeServices(siteYml.services, stored, offered)
      writeSiteConfig(siteDir, { services })
      if (services) siteYml.services = services
      else delete siteYml.services
      say.ok('site.yml updated.')
    } else {
      open.push(...offered)
    }
  }

  if (send.length) {
    say.info(`Asking for: ${send.map((n) => `${n} ${describeEntry(entryFor(n), askFor(n))}`).join(', ')}`)
  }

  // The list to send: the site's rows with the changed asks applied. With the site
  // unreadable and nothing changed, nothing is sent — the record may be stale, and
  // sending it would be asking for what the site may have moved away from.
  const base = stored ?? record ?? (siteUuid ? undefined : [])
  if (!stored && !send.length) {
    return {
      emit: { declareServices: false },
      after: () => {}
    }
  }
  const rows = mergeServiceRows(base, asks.filter((a) => send.includes(a.name)))
  return {
    emit: { serviceRows: rows },
    after: () => {
      const next = recordAfter({ record, agreed: rows, open })
      if (next) updateBackendState(siteDir, client.origin, { services: next })
    }
  }
}
