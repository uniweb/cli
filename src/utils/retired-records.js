/**
 * The records this copy's pushes took out of the site's folder — moved to another data schema, or
 * their files deleted — which the backend keeps, in no folder, until someone deletes them
 * (`sync.json` `retired`, banked by `retireUnplaced` in `backend/site-sync.js`).
 *
 * ⭐ RULED 2026-11-04 [Diego]: the CLI deletes them, asking first with a count, rather than leaving
 * the cleanup to the app — agents do most of the work through the CLI. The backend's route keeps a
 * record that a folder outside the call still places (another site's), and names it.
 *
 * ⭐ ASKED WHEN THE SITE IS PUBLISHED, ONCE IT IS LIVE. Until then the live site is the one
 * published with the folder that placed them, so a delete right after a push could take records
 * off a page visitors still see. `push` only says they are waiting (`noteRetiredRecords`).
 *
 * As emptying the folder does, it asks first, and `--yes` is the way past the question. With no
 * terminal and no `--yes`, it keeps them and says how to finish. A person who declines keeps them,
 * and is not asked again.
 */

import { readBackendState, setBackendMap } from '@uniweb/build/uwx'
import { confirm, isNonInteractive } from './interactive.js'

/** "2 records (of @std/project)", or by schema: "3 records (2 of @std/project, 1 of @acme/x)". */
function describeRetired(retired) {
  const bySchema = new Map()
  for (const schema of Object.values(retired)) bySchema.set(schema, (bySchema.get(schema) || 0) + 1)
  const n = Object.keys(retired).length
  const groups = [...bySchema].map(([schema, k]) => (bySchema.size === 1 ? `of ${schema}` : `${k} of ${schema}`))
  return `${n === 1 ? '1 record' : `${n} records`} (${groups.join(', ')})`
}

/**
 * After a push: say which records the backend keeps that this copy's pushes took out of the folder.
 *
 * @returns {number} how many
 */
export function noteRetiredRecords({ siteDir, backend, note }) {
  const retired = readBackendState(siteDir, backend).retired || {}
  if (!Object.keys(retired).length) return 0
  note(
    `${describeRetired(retired)} taken out of the site's folder stay on the backend, where no site serves them. ` +
      '`uniweb publish` offers to delete them once the site is live.'
  )
  return Object.keys(retired).length
}

/**
 * After a publish has gone live: offer to delete the retired records, and delete them on a yes.
 *
 * @param {object} params
 * @param {object} params.client - a `BackendClient` on the site's backend, in its workspace
 * @param {string} params.siteDir
 * @param {string[]} params.args - the command's arguments (`--yes`, `--non-interactive`)
 * @param {{ ok: Function, dim: Function, warn: Function }} params.say
 * @param {(question: string, defaultYes: boolean) => Promise<boolean>} [params.ask]
 * @returns {Promise<{ deleted: number, kept: number, asked: boolean }>}
 */
export async function settleRetiredRecords({ client, siteDir, args = [], say, ask = confirm }) {
  const retired = readBackendState(siteDir, client.origin).retired || {}
  const uuids = Object.keys(retired)
  if (!uuids.length) return { deleted: 0, kept: 0, asked: false }
  const what = describeRetired(retired)
  const forget = (done) =>
    setBackendMap(siteDir, client.origin, 'retired', Object.fromEntries(Object.entries(retired).filter(([u]) => !done.includes(u))))

  if (!args.includes('--yes')) {
    if (isNonInteractive(args)) {
      say.dim(
        `! ${what} that pushes took out of the site's folder stay on the backend, where no site serves them. ` +
          'To delete them, publish again with --yes, or from a terminal and answer.'
      )
      return { deleted: 0, kept: uuids.length, asked: false }
    }
    const yes = await ask(
      `Delete ${what} that pushes took out of the site's folder from ${client.origin}? A record another site's folder places is kept.`,
      false
    )
    if (!yes) {
      forget(uuids)
      say.dim('Kept them on the backend, where no site serves them. They are not asked about again.')
      return { deleted: 0, kept: uuids.length, asked: true }
    }
  }

  let res
  try {
    res = await client.deleteEntities({ uuids, placed: 'keep' })
  } catch (err) {
    say.warn(`Could not delete them: ${err?.message || err}. They stay on the backend; the next publish asks again.`)
    return { deleted: 0, kept: uuids.length, asked: true }
  }
  if (res.status === 404) {
    // A backend older than its delete route: they wait for one that has it.
    say.dim(`! ${client.origin} cannot delete records from the CLI yet, so they stay, where no site serves them.`)
    return { deleted: 0, kept: uuids.length, asked: true }
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // Refused whole (a record this account may not administer, or one outside the workspace):
    // nothing was deleted, and asking again would be refused again.
    say.warn(
      `${client.origin} did not delete them: HTTP ${res.status}${body?.detail ? ` — ${body.detail}` : ''}. ` +
        'They stay on the backend, where no site serves them; delete them in the app if they should go.'
    )
    forget(uuids)
    return { deleted: 0, kept: uuids.length, asked: true }
  }
  const deleted = Array.isArray(body?.deleted) ? body.deleted : []
  const kept = Array.isArray(body?.kept) ? body.kept : []
  if (deleted.length) say.ok(`Deleted ${deleted.length === 1 ? '1 record' : `${deleted.length} records`} from the backend.`)
  if (kept.length) {
    say.dim(`Kept ${kept.length === 1 ? '1 record' : `${kept.length} records`}: another site's folder still places ${kept.length === 1 ? 'it' : 'them'}.`)
  }
  // Every uuid is settled: deleted, kept for another folder, or naming nothing any more.
  forget(uuids)
  return { deleted: deleted.length, kept: kept.length, asked: true }
}
