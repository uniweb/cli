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
 * The site's `@uniweb/folder` uuid (the dynamic facet's container). Assumed wire
 * field: `folder` — a uuid ref the backend populates like `foundation_schema`.
 * Tolerant of a bare uuid string or a wrapped ref (`{ $uuid | uuid | entity }`), and
 * of a couple of alternate field names. Returns null when the site has no folder yet
 * (a site with no collections), which callers treat as pages-only.
 */
export function extractFolderUuid(info = {}, document = {}) {
  const candidates = [
    info?.folder,
    info?.site_folder,
    info?.folder_uuid,
    info?.folderUuid,
    document?.folder,
    document?.folder_uuid,
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
