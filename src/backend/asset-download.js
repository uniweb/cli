/**
 * Fetch the asset bytes a site project does not have locally.
 *
 * `pull` and `clone` bring content down; this brings the media with it, so a
 * teammate who clones gets a project that renders instead of one full of images
 * pointing at a host they may not even be able to reach.
 *
 * ## Where an asset lands, and why there are two answers
 *
 * - **The map knows it** (`assets.json`) — the file goes back to the path its
 *   author wrote. That is the whole reason the map is committed: a fresh clone
 *   restores `public/images/hero.png`, not a hash.
 * - **The map does not know it** — this project has never held these bytes:
 *   authored in the app, or pushed from a machine whose map entry has not
 *   arrived. There is no local path to guess, so it lands at a **generic,
 *   content-addressed** one (`/assets/{id}.{ext}`) and the map gains the entry.
 *   From then on it is a known asset like any other.
 *
 * ## ⛔ The URL is READ from the content, never composed
 *
 * Identity rides beside the reference (`sync-package.js` stamps `assetId` next
 * to the serve URL), so the address is already on the node. Composing one would
 * mean holding the host's route layout — the coupling deleting `buildAssetUrl`
 * removed from this CLI, and the reason `assets.json` stores no URL either. An
 * id with no URL beside it is skipped, not guessed at.
 *
 * ## ⛔ A failed download is a WARNING, never a failed pull
 *
 * The content still carries the URL, so a site whose bytes did not arrive still
 * renders — from the host, as it did before. Making the pull fail would turn a
 * degraded outcome into no outcome, and the degraded one is genuinely usable.
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ASSET_SLOTS } from '@uniweb/semantic-parser'
import { readAssetMap, updateAssetMap } from '@uniweb/build/uwx'

/**
 * Collect every `{ id, ext, url }` an entity document references.
 *
 * Reads the same shape `rewriteEntityAssets` writes — identity on the object
 * carrying the reference — so a ProseMirror image node's attrs and a section
 * background's media object are both found by one walk.
 */
export function collectAssetRefs(document) {
  const found = new Map() // id → { id, ext, url }
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    for (const slot of ASSET_SLOTS) {
      const id = typeof node[slot.id] === 'string' ? node[slot.id] : null
      if (!id || found.has(id)) continue
      const url = slot.urls
        .map((k) => (typeof node[k] === 'string' ? node[k] : null))
        .find(Boolean)
      found.set(id, { id, ext: node[slot.ext] || '', url })
    }
    for (const v of Object.values(node)) visit(v)
  }
  visit(document)
  return [...found.values()]
}

/** Where a site-root ref lives on disk. `resolveAssetPath` looks in public/ first. */
const diskPathFor = (siteDir, ref) => join(siteDir, 'public', ref)

/** The generic landing path for an asset this project has never held. */
export const genericRefFor = (id, ext) => `/assets/${id}${ext ? `.${ext}` : ''}`

/**
 * Download the assets `document` references that are not already on disk.
 *
 * @param {object} opts
 * @param {object} opts.document  - the site-content document (not mutated)
 * @param {string} opts.siteDir   - the site root
 * @param {string} opts.origin    - backend origin, to resolve an origin-relative URL
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(m: string) => void} [opts.onProgress]
 * @param {(m: string) => void} [opts.warn]
 * @returns {Promise<{ downloaded: string[], present: string[], failed: string[], skipped: string[] }>}
 */
export async function downloadMissingAssets({
  document,
  siteDir,
  origin,
  fetchImpl,
  onProgress = () => {},
  warn = () => {}
}) {
  const doFetch = fetchImpl || ((u) => globalThis.fetch(u))
  const refs = collectAssetRefs(document)
  const out = { downloaded: [], present: [], failed: [], skipped: [] }
  if (!refs.length) return out

  const map = readAssetMap(siteDir)
  const byId = new Map()
  for (const [ref, v] of Object.entries(map)) if (v?.id) byId.set(v.id, ref)

  const learned = {}

  for (const { id, ext, url } of refs) {
    const known = byId.get(id)
    const ref = known || genericRefFor(id, ext)
    const disk = diskPathFor(siteDir, ref)

    if (existsSync(disk)) {
      out.present.push(ref)
      // Still record identity for a generic ref we already hold but never mapped.
      if (!known) learned[ref] = { id, ext }
      continue
    }
    if (!url) {
      // Identity with no address beside it. Composing one would mean holding the
      // host's route layout; skipping is the honest answer.
      warn(`asset ${id}: no URL in content to fetch from (skipped)`)
      out.skipped.push(ref)
      continue
    }

    try {
      const res = await doFetch(new URL(url, origin).href)
      if (!res.ok) {
        warn(`asset ${id}: HTTP ${res.status} (kept the URL in content)`)
        out.failed.push(ref)
        continue
      }
      const bytes = Buffer.from(await res.arrayBuffer())
      mkdirSync(dirname(disk), { recursive: true })
      writeFileSync(disk, bytes)
      onProgress(`↓ ${ref}`)
      out.downloaded.push(ref)
      if (!known) learned[ref] = { id, ext }
    } catch (err) {
      warn(`asset ${id}: ${err.message} (kept the URL in content)`)
      out.failed.push(ref)
    }
  }

  // Newly-landed assets become known ones, so the next pull restores them to
  // this path rather than fetching them again to a second location.
  if (Object.keys(learned).length) updateAssetMap(siteDir, learned)
  return out
}
