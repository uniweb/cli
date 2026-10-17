/**
 * The record of what a pull wrote into a site project — outside git.
 *
 * ## What it is for
 *
 * Outside git, `uniweb pull` rewrites the files under its roots from the backend, and
 * nothing stands behind them — so it asks before it does, unless nothing there is the
 * author's. That needs one distinction: **a file the author edited** versus **a file a
 * previous pull wrote and nobody has touched since**. Without it the question comes
 * every time — pull rewrites the tree, so the next pull sees its own output as the
 * author's — and an unattended pull refuses over files nobody touched, which teaches
 * people to reach for `--force`, the destructive option.
 *
 * So each write is recorded with a content hash, and a path whose hash still matches is
 * not the author's work.
 *
 * ⛔ In a repository there is no such record: a pull merges, from a sync point
 * (`utils/sync-point.js`). Until 2026-10-17 this record was also a merge's ancestor —
 * the version each file last synced at, found again in the repository by its hash — and
 * committed work outside it was lost; and `clone` recorded its scaffold here, before a
 * delegated pull that now takes the backend's version with `--force`.
 *
 * Nothing here imports `@uniweb/build`, and nothing here may start to.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, relative } from 'node:path'

/** Where the record lives — gitignored, beside the other per-site caches. */
export function writtenCachePath(siteDir) {
  return join(siteDir, '.uniweb', 'pull-written.json')
}

/**
 * @param {string} siteDir
 * @returns {{files: Record<string,string>, deleted: string[]}}
 */
export function readWritten(siteDir) {
  try {
    const o = JSON.parse(readFileSync(writtenCachePath(siteDir), 'utf8'))
    return {
      files: o && typeof o.files === 'object' ? o.files : {},
      deleted: Array.isArray(o?.deleted) ? o.deleted : []
    }
  } catch {
    return { files: {}, deleted: [] }
  }
}

/**
 * Record files as machine-written, by absolute path.
 *
 * MERGE, don't replace. A conditional pull that 304s writes nothing, and a
 * partial pull writes only some lanes — in both cases the previous record is
 * still "the last thing written there". Replacing would forget those paths and
 * the next pull would see them as the user's work again, which is the false alarm
 * this cache exists to prevent. A stale entry for a file that no longer exists is
 * harmless: the hash read fails and it counts as a local change.
 *
 * @param {string} siteDir
 * @param {string[]} absPaths - files just written
 * @param {string[]} [deletedAbs] - files just pruned
 */
export function recordWritten(siteDir, absPaths, deletedAbs = []) {
  const prior = readWritten(siteDir)
  const files = prior.files
  for (const abs of absPaths) {
    try {
      files[relative(siteDir, abs)] = createHash('sha256')
        .update(readFileSync(abs))
        .digest('hex')
    } catch {
      /* deleted or unreadable — nothing to remember */
    }
  }
  // Pull PRUNES too, and a deletion is a dirty path git reports just like an edit.
  // Without recording them, pull's own pruning reads as the user having deleted
  // files — the same false alarm as its writes, arriving by the other door.
  const deleted = [
    ...new Set([...prior.deleted, ...deletedAbs.map((a) => relative(siteDir, a))])
  ]
  try {
    mkdirSync(dirname(writtenCachePath(siteDir)), { recursive: true })
    writeFileSync(
      writtenCachePath(siteDir),
      JSON.stringify({ version: 1, files, deleted }, null, 2) + '\n'
    )
  } catch {
    /* best-effort: losing it only costs a spurious refusal */
  }
}

/**
 * Is this dirty path just machine output nobody has touched?
 *
 * The hash comparison is what keeps the guard honest: a scaffolded or pulled file
 * the user then EDITED no longer matches, so it counts as their work and the
 * refusal stands.
 *
 * @param {string} siteDir
 * @param {string} relPath
 * @param {{files: Record<string,string>, deleted: string[]}} written
 * @returns {boolean}
 */
export function isPullOutput(siteDir, relPath, written) {
  let exists = true
  let hash = null
  try {
    hash = createHash('sha256')
      .update(readFileSync(join(siteDir, relPath)))
      .digest('hex')
  } catch {
    exists = false
  }
  // Absent because pull pruned it — not because the user deleted it.
  if (!exists) return written.deleted.includes(relPath)
  return written.files[relPath] === hash
}
