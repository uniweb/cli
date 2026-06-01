/**
 * Dep-free readers for the refs the backend populates on a site-content document.
 *
 * Kept free of `@uniweb/build` so it's importable from BOTH `clone` (global, runs
 * before a project exists) and `pull` (project-local) — the same constraint that
 * keeps utils/placement.js dependency-free.
 *
 * The site-content `$`-document carries, on its `info` brief, refs the backend fills
 * in when it wires a site: `foundation` (the foundation ref) and `folder` (the site's
 * `@uniweb/folder` uuid, alongside `foundation_schema`). These readers are tolerant —
 * a backend field rename should degrade, not crash — and are the single adjust-point
 * if the wire field names settle differently.
 */

/**
 * The site's foundation ref — a URL or our `@ns/name@ver`. Written verbatim into
 * site.yml; the runtime loads it as a federated module.
 */
export function extractFoundationRef(info = {}, document = {}) {
  return info?.foundation ?? info?.foundation_name ?? document?.foundation ?? null
}

/**
 * The site's `@uniweb/folder` uuid — its live runtime data source.
 *
 * The `@uniweb/folder` is not a literal folder: it's a prepared query over (symlinked)
 * content entities, surfaced to CMS users as a "folder" so they have a mental model.
 * It's the live counterpart of the cheap file-based `collections/`, served at runtime
 * via the gateway route (`…/gateway/{uuid}/`, reached through the worker's `/_uw/`
 * proxy after deploy). The same uuid doubles as the sync-lane identity.
 *
 * Canonical wire field: `gateway` — a uuid ref the backend populates like
 * `foundation_schema` (alternates `gateway_folder`/`folder` are accepted as fallbacks
 * so a rename degrades rather than breaks).
 * Tolerant of a bare uuid or a wrapped `{ $uuid | uuid | entity }` ref, plus a few
 * alternate field names so a backend rename degrades rather than breaks. Returns null
 * when the site has no gateway folder (no dynamic data), which callers treat as
 * pages-only.
 */
export function extractFolderUuid(info = {}, document = {}) {
  const candidates = [
    info?.gateway,
    info?.gateway_folder,
    info?.folder,
    info?.site_folder,
    info?.folder_uuid,
    document?.gateway,
    document?.gateway_folder,
    document?.folder,
  ]
  for (const c of candidates) {
    const u = refToUuid(c)
    if (u) return u
  }
  return null
}

function refToUuid(v) {
  if (!v) return null
  if (typeof v === 'string') return v
  if (typeof v === 'object') return v.$uuid || v.uuid || v.entity || null
  return null
}
