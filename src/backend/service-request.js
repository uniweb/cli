/**
 * The services request — is the file ASKING for something, or just carrying an
 * old answer?
 *
 * ## The defect this exists to close
 *
 * `$services` / `$secrets` are Sections of the site-content document, so they ride
 * inside **every** push — the block is emitted whenever the key exists in
 * `site.yml`. Editing one paragraph on one page therefore re-sends the whole
 * request block.
 *
 * ⛔ And the backend REPLACES what it is sent: a row anchors by its natural key and
 * is updated in place (`SectionScope::DeclaredOnly`; backend's
 * `uuidless_records_anchor_by_natural_key_and_keep_the_stored_uuid`, written
 * against this emitter's shape). So a re-send is not a harmless echo — it
 * **overwrites the stored request**, including a decision the owner made in the
 * app, which is where the consent workflow's publish happens.
 *
 * ⭐ Under the model the file follows — *"the services in `site.yml` are a request,
 * never a tracking of what is running"* [Diego, 2026-09-05] — **re-sending an
 * unchanged block is making a request nobody made.** You ask by CHANGING the file.
 *
 * ⚠️ It was mostly inert until 2026-09-08: `enabled` was honoured for `api` alone,
 * so a stale re-send of the other names overwrote rows nothing read. That stopped
 * being true the same day, and `api` was never inert — an `enabled: false` on it
 * with a live plan schedules a paid service to end.
 *
 * ## What "changed" is measured against
 *
 * The last block we are known to have sent, recorded in **`deploy.yml`** — a
 * COMMITTED project file that travels with a clone.
 *
 * ⛔ Deliberately NOT `.uniweb/sync-cache.json`, which is the obvious place and the
 * wrong one: it is gitignored, per-clone and deletable, so a teammate's fresh clone
 * has no base at all — and this workflow is multi-machine by construction (consent
 * in a browser, publish from the app). A base that vanishes turns this gate into
 * either the original defect or a silently dropped request.
 *
 * ## ⛔ A HASH, never the block
 *
 * `$secrets` carries secret material, and `$services[].config` is opaque and
 * per-service — anything may be in it. `deploy.yml` is committed, so recording
 * either verbatim would write them into git. Equality is all this gate needs;
 * *what* differs is a question for the backend's own copy of the request, not for
 * a mirror of our own.
 *
 * @module
 */

import { createHash } from 'node:crypto'

/**
 * A stable fingerprint of one declared block, or `null` when the key is absent.
 *
 * ⭐ `null` (absent) and the hash of `[]` are DIFFERENT, and must stay so: absent
 * means *"I am not telling you about this"* and `[]` is an explicit clear. This
 * function only has to preserve that distinction — the destructive difference
 * between them is the backend's.
 *
 * Rows are ordered by their serialized form and object keys sorted, so reordering
 * rows or keys in the file is not a change. It is not a request to move a line.
 *
 * @param {*} declared - the raw `site.yml::$services` / `$secrets` value
 * @returns {string|null} 16 hex chars, or null when undeclared
 */
export function fingerprintDeclaration(declared) {
  if (declared === undefined || declared === null) return null
  const canonical = Array.isArray(declared)
    ? declared.map(stableString).sort()
    : [stableString(declared)]
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 16)
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
 * Both blocks' fingerprints, in the shape `deploy.yml::lastDeploy.<target>` keeps
 * them. Keys are omitted rather than set to null, so an undeclared block leaves no
 * trace in the file.
 *
 * @param {object} siteYml
 * @returns {{servicesRequest?: string, secretsRequest?: string}}
 */
export function fingerprintRequest(siteYml) {
  const out = {}
  const services = fingerprintDeclaration(siteYml?.$services)
  if (services) out.servicesRequest = services
  const secrets = fingerprintDeclaration(siteYml?.$secrets)
  if (secrets) out.secretsRequest = secrets
  // ⭐ The language selection is a request too, and it is the one that moves a
  // PRICE — the line is billed on how many languages go out. Banking it is what
  // lets a later edit read as "the owner asked for another language" rather than
  // as a value that was always there.
  const langs = fingerprintDeclaration(siteYml?.publishLanguages)
  if (langs) out.publishLanguagesRequest = langs
  return out
}

/**
 * Should this push DECLARE the request blocks?
 *
 * ⛔ **Absence of a record means YES.** Three reasons, and the third is the one
 * that decides it:
 *
 *   1. It is the behaviour every CLI has had, so nothing regresses.
 *   2. A project may legitimately have no `deploy.yml` (never published, or
 *      `autoSave: off`), and that is not evidence about the request.
 *   3. ⭐ Failing the other way DROPS A REAL REQUEST IN SILENCE. Between the two
 *      failure directions, sending an unchanged block writes back what is usually
 *      already there, while withholding a changed one leaves an owner's edit with
 *      no effect and nothing said. The loud failure is the better one.
 *
 * @param {object} siteYml - the parsed site.yml
 * @param {object|null} lastDeploy - `deploy.yml::lastDeploy.<target>`, or null
 * @returns {{declare: boolean, reason: 'no-record'|'changed'|'unchanged'|'undeclared'}}
 */
export function decideDeclaration(siteYml, lastDeploy) {
  const now = fingerprintRequest(siteYml)
  if (!now.servicesRequest && !now.secretsRequest) {
    // Nothing in the file to send. The gate is moot; say so rather than
    // reporting "unchanged", which would imply a comparison happened.
    return { declare: true, reason: 'undeclared' }
  }
  if (!lastDeploy || typeof lastDeploy !== 'object') {
    return { declare: true, reason: 'no-record' }
  }
  const same =
    now.servicesRequest === (lastDeploy.servicesRequest || undefined) &&
    now.secretsRequest === (lastDeploy.secretsRequest || undefined)
  return same
    ? { declare: false, reason: 'unchanged' }
    : { declare: true, reason: 'changed' }
}

/**
 * The four-way reconcile, once the backend's own copy of the request is in hand.
 *
 * ⭐ THIS SUPERSEDES `decideDeclaration` WHERE THE STATUS READ SUCCEEDS. That one
 * compares the file to our MEMORY of what we last sent, which leaves a window: a
 * request changed in the app between a `uniweb pull` and the next publish reads as
 * unchanged-from-nothing. Comparing to the backend's own rows closes it, because
 * the base stops being something we have to remember correctly.
 *
 * ⛔ It still needs the banked fingerprint. Local and remote differing says the two
 * disagree; it does not say WHO MOVED. Only the last agreed state does, and that is
 * the difference between "the app decided, adopt it" and "you edited, send it".
 *
 * ## The four outcomes
 *
 * | local | remote | |
 * |---|---|---|
 * | unchanged | unchanged | `none` — nobody asked anything |
 * | unchanged | **moved** | `adopt` — the app decided; the file is merely behind |
 * | **edited** | unchanged | `send` — a real request |
 * | **edited** | **moved** | `conflict` — ⛔ two intents, and only the owner ranks them |
 *
 * ⛔ `conflict` never guesses and never sends. A last-write-wins on a field that
 * schedules a paid service to end is not a tie-break, it is a coin toss with the
 * owner's money.
 *
 * ⚖️ No base ⇒ we cannot tell `adopt` from `conflict`, so we fall back to the
 * conservative reading of a difference: if the two differ, `conflict`; if they
 * agree, `none`. That withholds rather than sends, which is safe HERE — unlike
 * `decideDeclaration`, nothing is silently dropped, because a conflict is reported.
 *
 * @param {object} siteYml
 * @param {*} remoteServices - the status read's `services` rows, or undefined
 * @param {object|null} lastDeploy - the banked base
 * @returns {{action:'none'|'adopt'|'send'|'conflict', local:string|null, remote:string|null}}
 */
export function reconcileRequest(siteYml, remoteServices, lastDeploy) {
  return reconcile(siteYml?.$services, remoteServices, lastDeploy?.servicesRequest)
}

/**
 * The same reconcile over any two-way request field.
 *
 * ⭐ `$services` was the first, not the only one. `site.yml::publishLanguages` is
 * the same shape — the owner's ASK, pushed up, projected back on pull, and stored
 * on the other side where something else may move it.
 *
 * ⛔ AND A BASE IS NEEDED EVEN WHERE NOTHING ELSE WRITES THE FIELD. That was the
 * reasoning that nearly left languages out: "nobody overwrites it, so there is no
 * hazard." Overwriting is not the only thing a base is for — without one, a value
 * that has always been in the file is indistinguishable from one the owner just
 * typed, so the CLI cannot tell an intentional change from the status quo. For
 * languages that difference is money: the count is priced, so a new language is a
 * charge, and saying so before sending requires knowing it is new.
 *
 * @param {*} localValue - the file's declaration
 * @param {*} remoteValue - what the site has stored
 * @param {string|null} baseFingerprint - what we last agreed on
 */
export function reconcile(localValue, remoteValue, baseFingerprint) {
  const local = fingerprintDeclaration(localValue)
  const remote = fingerprintDeclaration(remoteValue)
  const base = baseFingerprint || null

  if (local === remote) return { action: 'none', local, remote }
  if (!base) return { action: 'conflict', local, remote }

  const localMoved = local !== base
  const remoteMoved = remote !== base
  if (!localMoved && remoteMoved) return { action: 'adopt', local, remote }
  if (localMoved && !remoteMoved) return { action: 'send', local, remote }
  return { action: 'conflict', local, remote }
}
