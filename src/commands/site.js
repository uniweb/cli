/**
 * `uniweb site` — the sites in a workspace, on the backend you are logged in to.
 *
 *   uniweb site list [--json]                   each site's name, uuid, and whether it is live
 *   uniweb site unpublish [<site-uuid>] [--yes]  take a site offline; its content stays
 *   uniweb site delete [<site-uuid>] [--yes]     delete a site — final, no restore
 *
 * Without a uuid, `unpublish` and `delete` act on the site this project is synced to on
 * that backend. The workspace is the command's (`--org @x` / `--personal`), else the
 * login's — as for every site request.
 *
 * ⭐ A live site is not deleted: the backend refuses while it is published, so `delete`
 * says to unpublish it first, and anything else still active (a plan, a domain, stored
 * form messages) is named in the backend's own words and resolved in the app. A delete
 * of the project's own site also drops the project's record of it, as `uniweb forget`
 * does, so its next push creates a new site.
 *
 * ⛔ Both write verbs ask first, and `--yes` is the only way past the question. Without
 * a terminal they refuse rather than print what they would have done: a script that
 * reads exit 0 as "deleted" must not be told 0 for nothing.
 *
 * Auth: the session of the backend you are logged in to (`uniweb login`) / UNIWEB_TOKEN.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { BackendClient, WorkspaceMismatchError, describeWorkspace } from '../backend/client.js'
import { resolveWorkspace } from '../backend/workspace.js'
import { checkFlags } from '../utils/flag-guard.js'
import { confirm, isNonInteractive } from '../utils/interactive.js'
import { readSiteIdentity } from '../utils/site-identity.js'
import { findSites, findWorkspaceRoot } from '../utils/workspace.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
}
// As in every verb: errors on stderr, the rest on stdout — and under `--json` nothing but
// the JSON on stdout.
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`)
}

const USAGE = [
  'uniweb site <command>',
  '  list [--json]                    The sites in the workspace: name, uuid, whether live',
  '  unpublish [<site-uuid>] [--yes]   Take a site offline (its content stays)',
  '  delete [<site-uuid>] [--yes]      Delete a site — final',
  '',
  'Without a uuid, unpublish and delete act on the site this project is synced to.',
  'The workspace is --org @x or --personal, else the one chosen at login.'
].join('\n')

/** A site-content uuid, loosely: enough to tell one from a site's name. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The arguments that are not flags — skipping `--org`'s value. */
function positionals(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--org') {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    out.push(a)
  }
  return out
}

/**
 * The site directory this command runs in — the site itself (it holds `site.yml`), or a
 * workspace's only site. ⛔ Never a stop: outside a project — or from an install without
 * `@uniweb/build`, which finding a workspace's sites may load — there is simply none.
 */
async function projectSiteDir() {
  try {
    const cwd = process.cwd()
    if (existsSync(join(cwd, 'site.yml'))) return { dir: cwd }
    const root = findWorkspaceRoot(cwd)
    if (!root) return {}
    const sites = await findSites(root)
    if (sites.length === 1) return { dir: resolve(root, sites[0]) }
    return sites.length > 1 ? { many: sites } : {}
  } catch {
    return {}
  }
}

/** A client on the backend you are logged in to, working in the command's workspace. */
async function connect(args, command) {
  const client = new BackendClient({ args, command })
  const ws = await resolveWorkspace({ client, args })
  if (ws.refused) return { refused: ws.reason }
  client.setWorkspace(ws.workspace, { source: ws.source })
  return { client, workspace: ws.workspace }
}

/** Every site in the workspace, page by page. */
async function allSites(client) {
  const limit = 1000
  const sites = []
  for (let offset = 0; ; offset += limit) {
    const res = await client.listSites({ limit, offset })
    if (!res.ok) throw new Error(`Could not list the sites: HTTP ${res.status} ${res.statusText}`)
    const page = (await res.json().catch(() => null))?.sites
    if (!Array.isArray(page)) throw new Error('Could not list the sites: the backend sent no list.')
    sites.push(...page)
    if (page.length < limit) return sites
  }
}

async function list(args) {
  const json = args.includes('--json')
  const conn = await connect(args, 'Listing sites')
  if (conn.refused) {
    say.err(conn.refused)
    return { exitCode: 2 }
  }
  const { client, workspace } = conn
  const sites = await allSites(client)
  const rows = sites.map((s) => ({
    uuid: s.uuid,
    name: s.name ?? null,
    status: s.deployment?.status ?? null,
    published: s.deployment?.status === 'published',
    url: s.deployment?.published_url ?? null,
    updated_at: s.updated_at ?? null
  }))
  if (json) {
    console.log(JSON.stringify({ backend: client.origin, workspace: workspace ?? null, sites: rows }))
    return { exitCode: 0 }
  }
  if (!rows.length) {
    say.info(`No sites in ${describeWorkspace(workspace)} on ${client.origin}.`)
    return { exitCode: 0 }
  }
  console.log(`${c.bold}Sites in ${describeWorkspace(workspace)}${c.reset} ${c.dim}on ${client.origin}${c.reset}`)
  for (const r of rows) {
    const state = r.published ? `${c.green}published${c.reset}` : `${c.dim}${r.status ?? 'never published'}${c.reset}`
    const name = r.name ?? `${c.dim}(no name)${c.reset}`
    console.log(`  ${name}  ${c.dim}${r.uuid}${c.reset}  ${state}${r.published && r.url ? `  ${r.url}` : ''}`)
  }
  return { exitCode: 0 }
}

/**
 * The site a write verb acts on: the uuid given, else this project's site on the
 * backend the client goes to. Null, with the reason said, when there is neither.
 */
async function targetSite(args, client, verb) {
  const [, given] = positionals(args)
  if (given) {
    if (!UUID.test(given)) {
      say.err(`\`${given}\` is not a site uuid.`)
      say.dim('`uniweb site list` shows each site with its uuid.')
      return null
    }
    const project = await projectSiteDir()
    const mine = project.dir ? readSiteIdentity(project.dir, client.origin).uuid : null
    return { uuid: given, siteDir: mine === given ? project.dir : null }
  }
  const project = await projectSiteDir()
  if (project.many) {
    say.err(`This workspace has ${project.many.length} sites — name one: uniweb site ${verb} <site-uuid>, or run it inside the site.`)
    return null
  }
  const uuid = project.dir ? readSiteIdentity(project.dir, client.origin).uuid : null
  if (!uuid) {
    say.err(
      project.dir
        ? `This project has no site on ${client.origin} — name one: uniweb site ${verb} <site-uuid>`
        : `No site named, and this is not a Uniweb project — name one: uniweb site ${verb} <site-uuid>`
    )
    say.dim('`uniweb site list` shows each site with its uuid.')
    return null
  }
  return { uuid, siteDir: project.dir }
}

/** The site's row in the workspace's list, or null when the workspace does not list it. */
async function findSite(client, uuid) {
  try {
    return (await allSites(client)).find((s) => s.uuid === uuid) ?? null
  } catch {
    return null
  }
}

/**
 * Ask, unless `--yes`. The exit code when the answer is not yes: 0 for a person who
 * declined, 2 where nobody could be asked — so a script never reads 0 for nothing done.
 */
async function confirmed(args, question, verb) {
  if (args.includes('--yes')) return { yes: true }
  if (isNonInteractive(args)) {
    say.err(`\`uniweb site ${verb}\` asks before it acts — pass --yes to confirm it here.`)
    return { yes: false, exitCode: 2 }
  }
  if (await confirm(question, false)) return { yes: true }
  say.info('Cancelled — nothing changed.')
  return { yes: false, exitCode: 0 }
}

/** What the backend said about a refused write, in its own words where it gave them. */
async function sayRefusal(res, { uuid, verb, origin }) {
  const body = await res.json().catch(() => null)
  if (res.status === 409 && Array.isArray(body?.blockers) && body.blockers.length) {
    say.err(`The site cannot be deleted yet:`)
    for (const b of body.blockers) {
      // ⭐ `detail` is written for the site's owner; the set of blockers is open, so an
      // unknown one is shown by its detail, never dropped.
      console.error(`  • ${b.detail || b.resource}`)
      if (b.resource === 'published') console.error(`    ${c.dim}→ uniweb site unpublish ${uuid}${c.reset}`)
    }
    if (body.blockers.some((b) => b.resource !== 'published')) {
      say.dim('Anything else listed is resolved in the app.')
    }
    return
  }
  if (res.status === 401) {
    say.err(`Your session on ${origin} is not accepted — sign in again: uniweb login`)
  } else if (res.status === 403) {
    say.err(`You may not ${verb} this site — only its owner or an admin of its workspace can.`)
  } else if (res.status === 404) {
    say.err(`${origin} has no site ${uuid}.`)
  } else {
    say.err(`The backend refused: HTTP ${res.status}${body?.detail ? ` — ${body.detail}` : ''}`)
  }
}

/**
 * The project's record of a site it no longer has — what `uniweb forget` removes for one
 * backend. Loaded here, not at the top: it needs `@uniweb/build`, which a command run
 * outside a project does not have.
 */
async function forgetDeletedSite(siteDir, origin) {
  try {
    const { clearBackend } = await import('@uniweb/build/uwx')
    const { forgetBackendCache } = await import('../backend/site-sync.js')
    const { forgetDeploys } = await import('@uniweb/build/site')
    clearBackend(siteDir, origin)
    forgetBackendCache(siteDir, origin)
    await forgetDeploys(siteDir, origin)
    return true
  } catch {
    return false
  }
}

async function unpublish(args) {
  const conn = await connect(args, 'Unpublishing a site')
  if (conn.refused) {
    say.err(conn.refused)
    return { exitCode: 2 }
  }
  const { client } = conn
  const target = await targetSite(args, client, 'unpublish')
  if (!target) return { exitCode: 2 }
  const site = await findSite(client, target.uuid)
  const label = site?.name ? `“${site.name}” (${target.uuid})` : target.uuid
  const url = site?.deployment?.published_url
  const ok = await confirmed(
    args,
    `Unpublish ${label} on ${client.origin}?${url ? ` Visitors get nothing at ${url} until it is published again.` : ''}`,
    'unpublish'
  )
  if (!ok.yes) return { exitCode: ok.exitCode }

  const res = await client.unpublishSite(target.uuid)
  if (!res.ok) {
    await sayRefusal(res, { uuid: target.uuid, verb: 'unpublish', origin: client.origin })
    return { exitCode: 1 }
  }
  const body = await res.json().catch(() => null)
  if (body?.was_published === false) {
    say.info(`${label} was not published — nothing to take down.`)
  } else {
    say.ok(`Unpublished ${label}. Its content stays; \`uniweb publish\` puts it back online.`)
  }
  return { exitCode: 0 }
}

async function remove(args) {
  const conn = await connect(args, 'Deleting a site')
  if (conn.refused) {
    say.err(conn.refused)
    return { exitCode: 2 }
  }
  const { client, workspace } = conn
  const target = await targetSite(args, client, 'delete')
  if (!target) return { exitCode: 2 }
  const site = await findSite(client, target.uuid)
  const label = site?.name ? `“${site.name}” (${target.uuid})` : target.uuid
  if (site?.deployment?.status === 'published') {
    say.err(`${label} is published — unpublish it first: uniweb site unpublish ${target.uuid}`)
    return { exitCode: 1 }
  }
  const ok = await confirmed(
    args,
    `Delete ${label} on ${client.origin}, in ${describeWorkspace(workspace)}? ` +
      'Its pages, settings and snapshots go with it, and it cannot be undone. Records it pushed stay in the workspace.',
    'delete'
  )
  if (!ok.yes) return { exitCode: ok.exitCode }

  const res = await client.deleteSite(target.uuid)
  if (!res.ok) {
    await sayRefusal(res, { uuid: target.uuid, verb: 'delete', origin: client.origin })
    return { exitCode: 1 }
  }
  say.ok(`Deleted ${label}.`)
  if (target.siteDir) {
    if (await forgetDeletedSite(target.siteDir, client.origin)) {
      say.dim(`This project no longer records a site on ${client.origin}; its next push creates a new one.`)
    } else {
      say.dim(`This project still records it — run \`uniweb forget --backend ${client.origin}\` in it.`)
    }
  }
  return { exitCode: 0 }
}

export async function site(args = []) {
  const badFlag = checkFlags('site', args)
  if (badFlag) {
    say.err(badFlag.message)
    return { exitCode: 2 }
  }
  const sub = args[0]
  try {
    if (sub === 'list') return await list(args)
    if (sub === 'unpublish') return await unpublish(args)
    if (sub === 'delete') return await remove(args)
  } catch (err) {
    say.err(err instanceof WorkspaceMismatchError ? err.message : err?.message || String(err))
    return { exitCode: 1 }
  }
  if (sub) {
    say.err(`Unknown command: uniweb site ${sub}`)
    console.error(USAGE)
    return { exitCode: 2 }
  }
  console.log(USAGE)
  return { exitCode: 0 }
}

export default site
