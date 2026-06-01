/**
 * Dep-free reader for the foundation ref the backend populates on a site-content
 * document.
 *
 * Kept free of `@uniweb/build` so it's importable from `clone` (global, runs before a
 * project exists) — the same constraint that keeps utils/placement.js dependency-free.
 *
 * The site-content `$`-document carries, on its `info` brief, the `foundation` ref the
 * backend fills in when it wires a site. The reader is tolerant — a backend field
 * rename should degrade, not crash — and is the single adjust-point if the wire field
 * name settles differently. (The site's `@uniweb/folder` is NOT read here: the backend
 * resolves it from the site-content uuid, so the framework never holds a folder uuid.)
 */

/**
 * The site's foundation ref — a URL or our `@ns/name@ver`. Written verbatim into
 * site.yml; the runtime loads it as a federated module.
 */
export function extractFoundationRef(info = {}, document = {}) {
  return info?.foundation ?? info?.foundation_name ?? document?.foundation ?? null
}
