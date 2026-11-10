/**
 * The records this copy's pushes took out of the site's folder — moved to another data schema, or
 * their files deleted — which the backend keeps, in no folder, until someone deletes them
 * (`sync.json` `retired`, banked by `retireUnplaced` in `backend/site-sync.js`).
 *
 * ⭐ RULED 2026-11-04 [Diego]: the CLI deletes them, asking first with a count, rather than leaving
 * the cleanup to the app — agents do most of the work through the CLI. The backend's route keeps a
 * record that a folder outside the call still places (another site's), and names it.
 *
 * ⭐ ASKED AT THE END OF EVERY PUSH, and of a publish, which pushes. A published site reads its
 * records from its folder as the folder stands, with no snapshot taken at publish, so the push has
 * already taken them off the live site [backend, 2026-11-04 — `backend/docs/delivery-orientation.md`:
 * "Adding a blog post updates the live site with no republish"]. ⛔ Until then this asked only at
 * publish, "because until then the live site still has the folder that placed them", which is not
 * how that wire behaves. ⛔ And until 2026-11-10 only a push that sent something asked, so the line
 * a push without a terminal prints, "push again with --yes", did nothing when nothing else had
 * changed: that push stopped at "Nothing to push" first (measured on the playground).
 *
 * As emptying the folder does, it asks first, and `--yes` is the way past the question. With no
 * terminal and no `--yes`, it keeps them and says how to finish. A person who declines keeps them,
 * and is not asked again.
 *
 * ⭐ A RECORD ANOTHER SITE'S FOLDER STILL PLACES IS KEPT, AND DELETED ONCE NONE DOES. A site that
 * mounts this site's records (`site.yml` `paths:`) places them by reference, so a record whose file
 * this site deleted is still on that site until that site pushes again. The backend keeps it then,
 * and this copy holds the choice to delete it (`sync.json` `deleting`): each later push asks the
 * backend again, with no question, and it goes once nothing places it. ⛔ Until 2026-11-10 a kept
 * record was dropped from the list, and once the other site's push stopped placing it, it stayed on
 * the backend in no folder, where nothing offered to delete it (measured on the playground). The
 * messages said those records stay "where no site serves them", which a mounting site contradicted.
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

const records = (n) => (n === 1 ? '1 record' : `${n} records`)

/**
 * The records this copy chose to delete that the backend kept, asked about again: no question, since
 * the choice was made. Those the backend deletes, or that name nothing any more, leave the list.
 */
async function finishDeleting({ client, siteDir, say }) {
  const pending = readBackendState(siteDir, client.origin).deleting || {}
  const uuids = Object.keys(pending)
  if (!uuids.length) return 0
  let res
  try {
    res = await client.deleteEntities({ uuids, placed: 'keep' })
  } catch {
    return 0 // the next push asks again
  }
  // A backend older than its delete route: they wait for one that has it.
  if (res.status === 404) return 0
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // Refused whole, which asking again would be too: the app is where they go now.
    say.warn(
      `${client.origin} did not delete ${records(uuids.length)} this copy is deleting: HTTP ${res.status}` +
        `${body?.detail ? ` — ${body.detail}` : ''}. Delete ${uuids.length === 1 ? 'it' : 'them'} in the app if ${uuids.length === 1 ? 'it' : 'they'} should go.`
    )
    setBackendMap(siteDir, client.origin, 'deleting', {})
    return 0
  }
  const deleted = Array.isArray(body?.deleted) ? body.deleted : []
  const kept = new Set(Array.isArray(body?.kept) ? body.kept : [])
  if (deleted.length) say.ok(`Deleted ${records(deleted.length)} that another site's folder no longer places.`)
  setBackendMap(siteDir, client.origin, 'deleting', Object.fromEntries(uuids.filter((u) => kept.has(u)).map((u) => [u, pending[u]])))
  return deleted.length
}

/**
 * After a push, or a publish: offer to delete the retired records, and delete them on a yes; and
 * finish deleting those another site's folder placed when they were asked about.
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
  const finished = await finishDeleting({ client, siteDir, say })
  const retired = readBackendState(siteDir, client.origin).retired || {}
  const uuids = Object.keys(retired)
  if (!uuids.length) return { deleted: finished, kept: 0, asked: false }
  const what = describeRetired(retired)
  const one = uuids.length === 1
  const forget = (done) =>
    setBackendMap(siteDir, client.origin, 'retired', Object.fromEntries(Object.entries(retired).filter(([u]) => !done.includes(u))))

  if (!args.includes('--yes')) {
    if (isNonInteractive(args)) {
      say.dim(
        `! ${what} that pushes took out of the site's folder ${one ? 'stays' : 'stay'} on the backend. ` +
          'To delete them, push again with --yes, or from a terminal and answer. ' +
          "A record another site's folder still places is kept until none does."
      )
      return { deleted: finished, kept: uuids.length, asked: false }
    }
    const yes = await ask(
      `Delete ${what} that pushes took out of the site's folder from ${client.origin}? A record another site's folder places is kept until none does.`,
      false
    )
    if (!yes) {
      forget(uuids)
      say.dim('Kept them on the backend. They are not asked about again.')
      return { deleted: finished, kept: uuids.length, asked: true }
    }
  }

  let res
  try {
    res = await client.deleteEntities({ uuids, placed: 'keep' })
  } catch (err) {
    say.warn(`Could not delete them: ${err?.message || err}. They stay on the backend; the next push asks again.`)
    return { deleted: finished, kept: uuids.length, asked: true }
  }
  if (res.status === 404) {
    // A backend older than its delete route: they wait for one that has it.
    say.dim(`! ${client.origin} cannot delete records from the CLI yet, so they stay on the backend.`)
    return { deleted: finished, kept: uuids.length, asked: true }
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // Refused whole (a record this account may not administer, or one outside the workspace):
    // nothing was deleted, and asking again would be refused again.
    say.warn(
      `${client.origin} did not delete them: HTTP ${res.status}${body?.detail ? ` — ${body.detail}` : ''}. ` +
        'They stay on the backend; delete them in the app if they should go.'
    )
    forget(uuids)
    return { deleted: finished, kept: uuids.length, asked: true }
  }
  const deleted = Array.isArray(body?.deleted) ? body.deleted : []
  const kept = (Array.isArray(body?.kept) ? body.kept : []).filter((u) => retired[u])
  if (deleted.length) say.ok(`Deleted ${records(deleted.length)} from the backend.`)
  if (kept.length) {
    // Chosen for deletion, and kept for another site's folder: deleted at a later push, once none
    // places it (`finishDeleting`).
    const pending = readBackendState(siteDir, client.origin).deleting || {}
    setBackendMap(siteDir, client.origin, 'deleting', { ...pending, ...Object.fromEntries(kept.map((u) => [u, retired[u]])) })
    const it = kept.length === 1 ? 'it' : 'them'
    say.dim(`Kept ${records(kept.length)}: another site's folder still places ${it}. A later push deletes ${it} once none does.`)
  }
  // Every uuid is settled: deleted, held to delete once no folder places it, or naming nothing any more.
  forget(uuids)
  return { deleted: finished + deleted.length, kept: kept.length, asked: true }
}
