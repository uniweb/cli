// ⛔ THE ONE PLACE AN ORDINARY ACT IS DESTRUCTIVE.
//
// `records.yml` is the sync control, and `missing` and `empty` deliberately mean
// different things: missing leaves the server's folder untouched, empty says the
// folder holds nothing and the backend removes what is there. The asymmetry is
// well-shaped — the safe state is the ABSENCE of a file, so a live folder cannot
// be wiped by deleting one, and the destructive act requires affirmatively
// creating one.
//
// ⚠️ WHICH LEAVES EXACTLY ONE SHARP EDGE: a PLACEHOLDER. Someone creates an empty
// `records.yml` intending to fill it in, pushes, and the live folder empties.
// That is plausible and it is the only path where a normal act destroys content.
//
// ⭐ THE FORMAT STAYS HONEST AND THE CLI DOES THE ASKING. Never make "empty" mean
// "missing" to dodge this: that would delete a capability to avoid writing a
// prompt.
//
// The count comes from the placement identity a previous push banked — what WE
// last saw the folder hold. It needs no network call, and it is the right source:
// a site that has never pushed has nothing to lose and is never asked.

import { readRecordsConfig, FOLDER_EMPTY } from '@uniweb/build/uwx'
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
 * Stop an empty `records.yml` from silently emptying a live folder.
 *
 * @param {object} params
 * @param {string} params.siteDir
 * @param {string[]} params.args - the verb's argv, for --yes / non-interactive
 * @param {(m: string) => void} params.warn - the CALLER's reporter. Each verb owns
 *        its own output style; a second copy here would drift from all of them.
 * @param {(m: string) => void} params.note
 * @returns {Promise<{ ok: boolean, count: number }>} `ok: false` means abort
 */
export async function guardEmptyRecords({ siteDir, args = [], warn, note }) {
  const cfg = await readRecordsConfig(siteDir)
  if (cfg.state !== FOLDER_EMPTY) return { ok: true, count: 0 }

  const count = countPlacedRecords(readFolderItemUuids(siteDir))
  // Nothing banked ⇒ nothing this push can remove. A first push of an empty
  // folder is a legitimate (if odd) thing to do, and asking about it would train
  // people to type y.
  if (count === 0) return { ok: true, count: 0 }

  warn(
    `records.yml is empty, and this push would REMOVE ${count} record${count === 1 ? '' : 's'} ` +
      `from the live folder.`
  )
  note(
    'An empty records.yml means "the folder holds nothing" — it is not the same as ' +
      'having no records.yml, which leaves the live folder alone. If you meant to ' +
      'start listing records, delete the file until you have.'
  )

  // ⚠️ `--yes` ONLY. `-y` is not a flag this CLI has anywhere, and adding one here
  // would have been caught by `flag-guard-coverage.test.js` — which it was.
  if (args.includes('--yes')) return { ok: true, count }
  if (isNonInteractive(args)) {
    warn(`Refusing to remove ${count} record${count === 1 ? '' : 's'} without confirmation.`)
    note(`Re-run with --yes if that is what you want: ${getCliPrefix()} push --yes`)
    return { ok: false, count }
  }

  const yes = await confirm(`Remove ${count} record${count === 1 ? '' : 's'} from the live folder?`, false)
  return { ok: yes, count }
}
