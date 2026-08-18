/**
 * Static collection data — one uploaded object per file.
 *
 * The successor to the "data ball" (`backend/data-bundle.js`), which merges the
 * same files into a single JSON asset the consumer must fetch, parse and fan
 * out. This uploads each `dist/data/**` file as its own content-addressed asset
 * on the SAME plan call, and returns the `{ relpath → serve URL }` map that
 * rides as `info.data`.
 *
 * ⭐ **Why one object per file is the correct shape rather than merely tidier.**
 * The ball was the only aggregate the CLI produced — media, foundation code and
 * the runtime all plan a file list and PUT per file — and nothing in the code
 * or the docs ever justified the bundling. Downstream, the reader's static arm
 * is a plain object GET on the verbatim tail, one object per path; nothing
 * there unbundles. So per-path objects are the shape that arm already assumed,
 * and merging them created the need for the unwrap that had to undo it.
 *
 * ⛔ **The map has to exist; the upload cannot replace it.** Assets are GLOBAL
 * and content-addressed — identical bytes dedup ACROSS sites — so the relation
 * from a site's path to an object is many-to-one, and `path` on the plan is a
 * per-request bookkeeping key that is not persisted. *Which paths this site
 * serves* is a property of the site, not of the bytes, so it must live on
 * site-content. (Established with the backend lane, 2026-08-18.)
 *
 * ⚠️ **Ships ALONGSIDE the ball for one release round, deliberately.** A
 * released CLI that still sends a ball to a consumer which dropped ball
 * handling breaks that deploy, and no deployment count bounds the set of CLIs
 * already installed. Overlap costs one redundant field for one round; a clean
 * swap costs the same *unless* that set is non-empty, in which case it costs a
 * failure nobody can observe. Same price, one of them safe under uncertainty.
 * Do not remove the ball here without checking `data-ball-retirement.md`.
 */

import { createHash } from 'node:crypto'
import { DATA_DIR } from '@uniweb/core'

/**
 * Upload each of the ball's per-path entries as its own asset.
 *
 * @param {object} client - BackendClient (uploadSiteAssets)
 * @param {{ data: Record<string, unknown> }|null} ball - the media-rewritten ball
 * @param {{ siteUuid?: string|null, onProgress?: (m: string) => void }} [opts]
 * @returns {Promise<Record<string, string>|null>} `{ "<relpath>": "<serve_url>" }`,
 *   or null when there is nothing to deliver.
 */
export async function uploadDataFiles(
  client,
  ball,
  { siteUuid = null, onProgress } = {}
) {
  const entries = Object.entries(ball?.data || {})
  if (!entries.length) return null

  // One plan call for the whole set: the per-request file cap counts a plan, so
  // splitting would evade rather than respect it. If the set ever exceeds the
  // cap the refusal is the correct outcome and the cap is the thing to fix.
  const files = entries.map(([relPath, value]) => {
    const bytes = Buffer.from(JSON.stringify(value))
    return {
      // The REAL relpath, not a bookkeeping name. It is still only a per-request
      // key on this lane — the consumer cannot recover a serve path from it (see
      // the header) — but a self-describing plan beats an invented one, and it
      // retires the `data-bundle/base.json` placeholder for these files.
      path: `${DATA_DIR}/${relPath}`,
      content_type: 'application/json',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      localUrl: `/${DATA_DIR}/${relPath}`,
      bytes
    }
  })

  const result = await client.uploadSiteAssets({ files, siteUuid, onProgress })
  if (result.failed?.length) {
    const f = result.failed[0]
    throw new Error(`data-files upload failed: HTTP ${f.status} ${f.detail}`)
  }

  const map = {}
  for (const [relPath] of entries) {
    const entry = result.assetsByLocalUrl[`/${DATA_DIR}/${relPath}`]
    // Absent is an error, not a cue to invent a location: an unaddressable file
    // must stop the publish rather than ship a URL nobody claimed. `serve_url`
    // is contractually on every plan entry, so a miss is a real defect.
    if (!entry?.serveUrl) {
      throw new Error(`data-files: no serve_url for ${DATA_DIR}/${relPath}`)
    }
    // Read verbatim, never composed — where a host serves an object is its own
    // business, and a producer that reconstructs the path is both coupled to it
    // and wrong wherever a delivery tier mints the URL instead.
    map[relPath] = entry.serveUrl
  }
  return map
}
