/**
 * `dist/publish.json` receipt — shared shape used by `publish` and `deploy`.
 *
 * The receipt is a per-checkout cache of the last publish; it lets the
 * deploy verb decide whether a workspace-local foundation needs republishing
 * without a network round-trip on the happy path. It's gitignored, so it
 * never travels with the source — fresh clones, CI runs, and teammates all
 * start with no cache. Both verbs refill the cache lazily by reading the
 * registry's index when the local file is missing.
 *
 * See `kb/framework/build/workspace-ergonomics.md` for the full rationale.
 */

/**
 * Compose the canonical six-field receipt body. All callers MUST go through
 * this helper so the runbook's pp-10 schema check stays meaningful.
 *
 * @param {Object} params
 * @param {string|null} params.gitSha
 * @param {boolean} params.gitDirty
 * @param {string} params.url
 * @param {string} params.publishedAt
 * @param {string} params.classification    'propagate' | 'silent'
 * @returns {Object}
 */
export function composeReceipt({ gitSha, gitDirty, url, publishedAt, classification }) {
  return {
    schemaVersion: 1,
    publishedFromGitSha: gitSha,
    publishedFromGitDirty: gitDirty,
    url,
    publishedAt,
    classification,
  }
}

/**
 * Resolve the canonical receipt URL given (in priority order):
 *   1. A `publishResult.url` from a fresh upload — server-rendered, handles
 *      empty-scope rewrites the CLI can't synthesize.
 *   2. An `existingEntry.url` recorded by a previous publish (refill path).
 *   3. A synthesized canonical form — `file://` for local registries,
 *      `<apiUrl>/foundations/<name>@<version>/foundation.js` for remote.
 *      The remote form mirrors the path the worker returns in `publishResult.url`,
 *      which keeps the receipt's URL parseable by the regex in
 *      `deploy.js::deriveLocalFoundationRef` even when the registry's index
 *      entry doesn't carry an explicit `url` field. (Unicloud's index entries
 *      don't; uniweb-edge's index entries don't either — both rely on the
 *      response shape, not the index shape.)
 *
 * Path-shaped candidates (e.g. `/foundations/...`) are joined with the
 * registry's `apiUrl` so the receipt always carries an absolute URL.
 */
export function deriveReceiptUrl({ publishResult, existingEntry, registry, name, version, isLocal }) {
  const candidate = publishResult?.url || existingEntry?.url
  if (candidate) {
    if (candidate.startsWith('http') || candidate.startsWith('file://')) return candidate
    if (registry?.apiUrl) return new URL(candidate, registry.apiUrl).toString()
  }
  if (isLocal) return `file://${registry.getPackagePath(name, version)}/`
  return `${registry.apiUrl.replace(/\/$/, '')}/foundations/${name}@${version}/foundation.js`
}

/**
 * Build a receipt from an existing registry version entry, used to refill a
 * missing `dist/publish.json` from server-of-record state. Returns null if
 * the entry doesn't carry enough provenance to make the receipt useful for
 * staleness checks (the only field that strictly must be present is
 * `publishedFromGitSha` — without it, the deploy verb can't compare against
 * HEAD, and refilling would just re-trigger the auto-publish next run).
 */
export function receiptFromRegistryEntry({ existingEntry, registry, name, version, isLocal, isPropagateDefault }) {
  if (!existingEntry || !existingEntry.publishedFromGitSha) return null
  return composeReceipt({
    gitSha: existingEntry.publishedFromGitSha,
    gitDirty: existingEntry.publishedFromGitDirty ?? false,
    url: deriveReceiptUrl({ existingEntry, registry, name, version, isLocal }),
    publishedAt: existingEntry.publishedAt || new Date().toISOString(),
    classification: existingEntry.classification || (isPropagateDefault ? 'propagate' : 'silent'),
  })
}

/**
 * Split `@ns/name@ver`, `~user/name@ver`, or `name@ver` into name + version.
 * Returns null on any shape we don't recognize.
 */
export function splitRegistryRef(ref) {
  if (typeof ref !== 'string') return null
  const m = /^(@[^/]+\/[^@]+|~[^/]+\/[^@]+|[^@]+)@(.+)$/.exec(ref)
  return m ? { name: m[1], version: m[2] } : null
}
