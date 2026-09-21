// ⛔ THE ONE PLACE AN ORDINARY ACT IS DESTRUCTIVE.
//
// A push sends the site's records folder whole, and it REPLACES the backend's. A site
// with no records directory sends none and leaves the backend's alone; a records
// directory that holds no records sends an EMPTY folder, and the backend removes what
// is there. The asymmetry is well-shaped — the safe state is the ABSENCE of the
// directory, so a site whose records live only on the backend is never emptied by a
// push of its pages — and it leaves exactly one sharp edge: a directory emptied by
// accident, or kept with only a placeholder (`records/.gitkeep`), and pushed.
//
// ⭐ THE CLI DOES THE ASKING. Never make "empty" mean "missing" to dodge this: that
// would delete a capability to avoid writing a prompt.
//
// ⛔ Until 2026-09-21 both states were `records.yml`'s — missing and empty — because
// that file listed the records. The directory holds them now (`@uniweb/build`'s
// `sendsFolder` decides what a push sends, and this asks about exactly its empty case).
//
// The count comes from the placement identity a previous push banked — what WE
// last saw the folder hold. It needs no network call, and it is the right source:
// a site that has never pushed has nothing to lose and is never asked.

import { readEntityPool } from '@uniweb/build/uwx'
import { readFolderItemUuids } from '../backend/site-sync.js'
import { confirm, isNonInteractive, getCliPrefix } from './interactive.js'

/**
 * Leaf placements in a banked path→uuid map.
 *
 * A branch's path is a prefix of every path beneath it, so anything that is a
 * prefix of another key is a folder rather than a record. Counting raw keys would
 * report a two-record site inside one folder as three things to lose.
 */
export function countPlacedRecords(pathToUuid) {
  const paths = Object.keys(pathToUuid || {})
  return paths.filter((p) => !paths.some((q) => q !== p && q.startsWith(`${p}/`))).length
}

/**
 * Stop an empty records directory from silently emptying the backend's folder.
 *
 * @param {object} params
 * @param {string} params.siteDir
 * @param {string} params.backend - whose placements to count; they are minted per backend
 * @param {string[]} params.args - the verb's argv, for --yes / non-interactive
 * @param {(m: string) => void} params.warn - the CALLER's reporter. Each verb owns
 *        its own output style; a second copy here would drift from all of them.
 * @param {(m: string) => void} params.note
 * @returns {Promise<{ ok: boolean, count: number }>} `ok: false` means abort
 */
export async function guardEmptyRecords({ siteDir, backend, args = [], warn, note }) {
  const pool = await readEntityPool(siteDir)
  // Only a directory that is there and holds nothing at all — no records, and no
  // files that fail to be records — sends the empty folder.
  if (!pool.exists || pool.entities.length > 0 || pool.errors.length > 0) return { ok: true, count: 0 }

  const count = countPlacedRecords(readFolderItemUuids(siteDir, backend))
  // Nothing banked ⇒ nothing this push can remove. A first push of an empty
  // folder is a legitimate (if odd) thing to do, and asking about it would train
  // people to type y.
  if (count === 0) return { ok: true, count: 0 }

  warn(
    `${pool.dir}/ holds no records, and this push would REMOVE ${count} record${count === 1 ? '' : 's'} ` +
      `from the site's folder on the backend.`
  )
  note(
    `An empty ${pool.dir}/ means "the folder holds nothing" — it is not the same as having no ` +
      `${pool.dir}/ at all, which leaves the backend's folder alone. If you did not mean to remove ` +
      `them, put the files back (or pull) before pushing.`
  )

  // ⚠️ `--yes` ONLY. `-y` is not a flag this CLI has anywhere, and adding one here
  // would have been caught by `flag-guard-coverage.test.js` — which it was.
  if (args.includes('--yes')) return { ok: true, count }
  if (isNonInteractive(args)) {
    warn(`Refusing to remove ${count} record${count === 1 ? '' : 's'} without confirmation.`)
    note(`Re-run with --yes if that is what you want: ${getCliPrefix()} push --yes`)
    return { ok: false, count }
  }

  const yes = await confirm(`Remove ${count} record${count === 1 ? '' : 's'} from the site's folder?`, false)
  return { ok: yes, count }
}
