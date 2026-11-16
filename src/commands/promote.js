/**
 * `uniweb promote` — a site's Promote, on the backend you are logged in to: getting it found,
 * posts and ads on social networks and search engines, and what they brought.
 *
 *   uniweb promote status [--json]       the site's Promote on one screen, and what needs a person
 *   uniweb promote check <step> [--json] check one getting-found step (`sitemap`, say)
 *   uniweb promote connect <network>     the address where a person connects an account
 *
 * The site is the one this project is synced to on that backend, or `--site <uuid>`. The
 * workspace is `--org @x` or `--personal`, else the login's — as for every site request.
 *
 * ⭐ THE CLI IS A SECOND CLIENT OF THE SITE'S PROMOTE, BESIDE THE APP, AND KEEPS NO COPY OF IT.
 * The backend holds the only one. Each command reads it fresh, and a write names the version of
 * each item it read (`if_unmodified_since`), so a change made in the app since is refused, never
 * written over. Nothing is synced, so there is nothing in the project to fall out of step.
 *
 * ⭐ AN ACCOUNT IS CONNECTED BY ITS PERSON, IN A BROWSER. `connect` hands over the network's
 * consent page; the tokens it yields stay with the backend and never pass through the CLI.
 *
 * Auth: the session of the backend you are logged in to (`uniweb login`) / UNIWEB_TOKEN.
 */

import { BackendClient, WorkspaceMismatchError, describeWorkspace } from '../backend/client.js'
import { resolveWorkspace } from '../backend/workspace.js'
import { checkFlags } from '../utils/flag-guard.js'
import { isNonInteractive } from '../utils/interactive.js'
import { readSiteIdentity } from '../utils/site-identity.js'
import { projectSiteDir } from './site.js'

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
  'uniweb promote <command>',
  '  status [--json]         The site\'s Promote: getting found, networks, posts, campaigns,',
  '                          and what needs a person',
  '  check <step> [--json]   Check one getting-found step, e.g. uniweb promote check sitemap',
  '  connect <network>       The address where a person connects an account at a network',
  '',
  'The site is the one this project is synced to, or --site <uuid>.',
  'The workspace is --org @x or --personal, else the one chosen at login.'
].join('\n')

/** A site-content uuid, loosely: enough to tell one from anything else. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Flags that take a value, so the value is not read as an argument. */
const VALUED = new Set(['--org', '--site'])

/** The arguments that are not flags, skipping the values of the flags that take one. */
function positionals(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (VALUED.has(a)) {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    out.push(a)
  }
  return out
}

/** The value of `--name <value>`, or undefined. */
function flagValue(args, name) {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : undefined
}

/** A client on the backend you are logged in to, working in the command's workspace. */
async function open(args, command) {
  const client = new BackendClient({ args, command })
  const ws = await resolveWorkspace({ client, args })
  if (ws.refused) return { refused: ws.reason }
  client.setWorkspace(ws.workspace, { source: ws.source })
  return { client, workspace: ws.workspace }
}

/**
 * The site a command acts on: `--site <uuid>`, else this project's site on the backend the
 * client goes to. Null, with the reason said, when there is neither.
 */
async function targetSite(args, client, verb) {
  const given = flagValue(args, '--site')
  if (given !== undefined) {
    if (!UUID.test(given || '')) {
      say.err(`\`--site\` takes a site's uuid${given ? `, and \`${given}\` is not one` : ''}.`)
      say.dim('`uniweb site list` shows each site with its uuid.')
      return null
    }
    return given
  }
  const project = await projectSiteDir()
  if (project.many) {
    say.err(`This workspace has ${project.many.length} sites — run it inside one, or name it: uniweb promote ${verb} --site <uuid>`)
    return null
  }
  const uuid = project.dir ? readSiteIdentity(project.dir, client.origin).uuid : null
  if (!uuid) {
    say.err(
      project.dir
        ? `This project has no site on ${client.origin} yet — push it first (uniweb push), or name one: uniweb promote ${verb} --site <uuid>`
        : `No site named, and this is not a Uniweb project — name one: uniweb promote ${verb} --site <uuid>`
    )
    say.dim('`uniweb site list` shows each site with its uuid.')
    return null
  }
  return uuid
}

/** What the backend said about a refused request, in its own words where it gave them. */
async function sayRefusal(res, { site, origin, what }) {
  const body = await res.clone().json().catch(() => null)
  if (res.status === 401) {
    say.err(`Your session on ${origin} is not accepted — sign in again: uniweb login`)
  } else if (res.status === 402) {
    say.err('Promote comes with the site\'s Analytics, which this site does not have yet. The person turns it on in the app.')
  } else if (res.status === 403) {
    say.err(`You may not ${what} on this site${body?.op ? ` (it takes ${body.op})` : ''}.`)
  } else if (res.status === 404) {
    say.err(`${origin} has no site ${site}, or does not offer Promote to this CLI yet.`)
  } else {
    say.err(`The backend refused: HTTP ${res.status}${body?.reason ? ` — ${body.reason}` : ''}${body?.detail ? ` (${body.detail})` : ''}`)
  }
}

/** The networks the deployment offers to connect, as tokens; null when it does not say. */
async function offeredNetworks(client) {
  const config = await client.discover().catch(() => null)
  const list = config?.promote?.networks
  if (!Array.isArray(list)) return config && typeof config === 'object' ? [] : null
  return list.map((n) => (typeof n === 'string' ? n : n?.network ?? n?.token)).filter(Boolean)
}

// ── The promotion, read into the shape a person and an agent reason about ──────────────

/**
 * The promotion's items, grouped: the site's networks, its getting-found steps with their
 * readings, its posts with their parts and delivery, its campaigns with their deliveries, ad
 * groups and ads. Backend's fields (a delivery, a reading, a campaign's tag) are read, never
 * written.
 *
 * @param {{ uuid: string, items: object[] } | null} promotion
 */
export function readView(promotion) {
  const items = Array.isArray(promotion?.items) ? promotion.items : []
  const bySection = (section) => items.filter((i) => i.section === section)
  const childrenOf = (section, parent) => items.filter((i) => i.section === section && i.parent === parent)
  const one = (section, parent) => childrenOf(section, parent)[0] ?? null

  const networks = bySection('networks').map((i) => ({ uuid: i.uuid, updated_at: i.updated_at, ...i.data }))

  const steps = bySection('getting_found').map((i) => {
    const reading = one('getting_found/reading', i.uuid)
    return {
      uuid: i.uuid,
      updated_at: i.updated_at,
      step: i.data?.step ?? null,
      skipped: i.data?.skipped === true,
      reading: reading ? reading.data : null
    }
  })

  const posts = bySection('posts').map((i) => {
    const delivery = one('posts/delivery', i.uuid)
    return {
      uuid: i.uuid,
      updated_at: i.updated_at,
      ...i.data,
      parts: childrenOf('posts/parts', i.uuid).map((p) => ({ uuid: p.uuid, ...p.data })),
      delivery: delivery ? delivery.data : null,
      state: delivery?.data?.status ?? 'draft'
    }
  })

  const campaigns = bySection('campaigns').map((i) => {
    const deliveries = childrenOf('campaigns/delivery', i.uuid).map((d) => d.data)
    const adGroups = childrenOf('campaigns/ad_groups', i.uuid).map((g) => ({
      uuid: g.uuid,
      ...g.data,
      ads: childrenOf('campaigns/ad_groups/ads', g.uuid).map((a) => {
        const delivery = one('campaigns/ad_groups/ads/delivery', a.uuid)
        return { uuid: a.uuid, ...a.data, delivery: delivery ? delivery.data : null }
      })
    }))
    return {
      uuid: i.uuid,
      updated_at: i.updated_at,
      ...i.data,
      deliveries,
      adGroups,
      state: campaignState(deliveries),
      started: deliveries.some((d) => d?.external_id)
    }
  })

  return { uuid: promotion?.uuid ?? null, networks, steps, posts, campaigns }
}

/** One word for a campaign: `draft` until it runs anywhere, else what its deliveries say. */
function campaignState(deliveries) {
  if (!deliveries.length) return 'draft'
  const states = new Set(deliveries.map((d) => d?.status).filter(Boolean))
  if (states.has('attention')) return 'attention'
  if (states.has('active')) return 'active'
  if (states.size === 1) return [...states][0]
  return [...states].join(', ') || 'draft'
}

/** Spend rows summed per currency — `{ CAD: '16.00' }` — from the days the backend has read. */
export function sumSpend(rows) {
  const out = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.currency || r.amount == null) continue
    const cents = Math.round(Number(r.amount) * 100)
    if (!Number.isFinite(cents)) continue
    out[r.currency] = (out[r.currency] ?? 0) + cents
  }
  return Object.fromEntries(Object.entries(out).map(([cur, cents]) => [cur, (cents / 100).toFixed(2)]))
}

// ── status ─────────────────────────────────────────────────────────────────────────

async function status(args) {
  const json = args.includes('--json')
  const conn = await open(args, 'Reading the site\'s Promote')
  if (conn.refused) {
    say.err(conn.refused)
    return { exitCode: 2 }
  }
  const { client, workspace } = conn
  const site = await targetSite(args, client, 'status')
  if (!site) return { exitCode: 2 }

  const [res, connectionsRes, offered] = await Promise.all([
    client.readPromotion(site),
    client.listConnections().catch(() => null),
    offeredNetworks(client)
  ])
  if (!res.ok) {
    await sayRefusal(res, { site, origin: client.origin, what: 'read Promote' })
    return { exitCode: 1 }
  }
  const promotion = (await res.json().catch(() => null))?.promotion ?? null
  const view = readView(promotion)
  const connections = connectionsRes?.ok ? (await connectionsRes.json().catch(() => null))?.connections ?? [] : null

  // Spend, for the campaigns that run somewhere: what each network last reported.
  for (const campaign of view.campaigns.filter((x) => x.started)) {
    const spent = await client.campaignSpend(site, campaign.uuid).catch(() => null)
    const rows = spent?.ok ? (await spent.json().catch(() => null))?.spend : null
    campaign.spend = Array.isArray(rows) ? { total: sumSpend(rows), days: rows.length } : null
  }

  const needs = needsPerson(view, connections)
  if (json) {
    console.log(JSON.stringify({
      backend: client.origin,
      workspace: workspace ?? null,
      site,
      networksOffered: offered,
      connections,
      promotion: promotion ? view : null,
      needsPerson: needs
    }))
    return { exitCode: 0 }
  }

  console.log(`${c.bold}Promote${c.reset} ${c.dim}— site ${site} in ${describeWorkspace(workspace)} on ${client.origin}${c.reset}`)
  if (!promotion) {
    say.info('This site has not used Promote yet: no networks, posts or campaigns.')
  }
  printSteps(view.steps)
  printNetworks(view.networks, connections)
  printPosts(view.posts)
  printCampaigns(view.campaigns)
  if (offered !== null) {
    console.log(`  ${c.dim}Can connect here:${c.reset} ${offered.length ? offered.join(', ') : 'no network yet, on this deployment'}`)
  }
  if (needs.length) {
    console.log()
    console.log(`${c.yellow}Ask the person first:${c.reset}`)
    for (const n of needs) console.log(`  • ${n.say}`)
  }
  return { exitCode: 0 }
}

/**
 * The steps only a person can take, as status shows them: an account to reconnect or hand on,
 * and the capability to turn on. A getting-found step is not among them by itself — which steps
 * the backend can check is its own to say, so status shows each step's reading instead.
 */
function needsPerson(view, connections) {
  const needs = []
  for (const k of Array.isArray(connections) ? connections : []) {
    const state = k?.card?.state
    if (state === 'needs_reconnect' || state === 'stopped') {
      const who = k.card?.name || k.card?.handle || k.uuid
      needs.push({
        kind: 'connection',
        connection: k.uuid,
        state,
        say: state === 'stopped'
          ? `${k.card?.network ?? 'a'} connection “${who}” stopped: its person left; an admin of the workspace hands it on, in the app`
          : `${k.card?.network ?? 'a'} connection “${who}” needs reconnecting, by its person, in the app`
      })
    }
  }
  for (const p of view.posts) {
    if (p.state === 'failed' && p.delivery?.reason === 'promote_off') {
      needs.push({ kind: 'capability', post: p.uuid, say: 'a scheduled post failed because the site has no Promote: it comes with the site\'s Analytics, turned on in the app' })
      break
    }
  }
  return needs
}

function printSteps(steps) {
  if (!steps.length) {
    console.log(`  ${c.bold}Getting found${c.reset}  ${c.dim}no step checked yet — uniweb promote check sitemap${c.reset}`)
    return
  }
  steps.forEach((s, i) => {
    const head = i === 0 ? `${c.bold}Getting found${c.reset}  ` : ' '.repeat(15)
    const r = s.reading
    const what = s.skipped ? `${c.dim}skipped${c.reset}` : r ? `${r.state}${r.address ? ` — ${r.address}` : ''}${r.found && r.state !== 'done' ? ` (${foundWords(r.found)})` : ''}` : `${c.dim}not checked${c.reset}`
    console.log(`  ${head}${s.step}: ${what}`)
  })
}

function printNetworks(networks, connections) {
  if (!networks.length) {
    console.log(`  ${c.bold}Networks${c.reset}       ${c.dim}none chosen yet${c.reset}`)
    return
  }
  const byUuid = new Map((connections ?? []).map((k) => [k.uuid, k]))
  networks.forEach((n, i) => {
    const head = i === 0 ? `${c.bold}Networks${c.reset}       ` : ' '.repeat(15)
    const k = byUuid.get(n.connection)
    const account = n.target?.name || k?.card?.name || k?.card?.handle || n.connection || 'no account chosen'
    const state = k?.card?.state && k.card.state !== 'connected' ? ` ${c.yellow}(${k.card.state})${c.reset}` : ''
    console.log(`  ${head}${n.use ?? '?'} through ${n.network ?? '?'}, “${account}”${state}`)
  })
}

function printPosts(posts) {
  const count = (state) => posts.filter((p) => p.state === state).length
  const scheduled = posts
    .filter((p) => p.state === 'scheduled')
    .map((p) => p.send_at)
    .filter(Boolean)
    .sort()
  const parts = [
    `${count('draft')} draft${count('draft') === 1 ? '' : 's'}`,
    `${count('scheduled')} scheduled${scheduled[0] ? ` (next ${scheduled[0]})` : ''}`,
    `${count('published')} published`
  ]
  if (count('failed')) parts.push(`${c.red}${count('failed')} failed${c.reset}`)
  console.log(`  ${c.bold}Posts${c.reset}          ${parts.join(' · ')}`)
}

function printCampaigns(campaigns) {
  if (!campaigns.length) {
    console.log(`  ${c.bold}Campaigns${c.reset}      ${c.dim}none${c.reset}`)
    return
  }
  campaigns.forEach((x, i) => {
    const head = i === 0 ? `${c.bold}Campaigns${c.reset}      ` : ' '.repeat(15)
    const spent = x.spend?.total && Object.keys(x.spend.total).length
      ? ` · spent ${Object.entries(x.spend.total).map(([cur, amt]) => `${amt} ${cur}`).join(' + ')}`
      : ''
    console.log(`  ${head}${x.name ?? x.uuid}: ${x.state}${spent}`)
  })
}

/** A getting-found reading's code, in words; an unknown one is shown as it is. */
function foundWords(found) {
  return {
    sitemap_named: 'the site\'s robots.txt names its sitemap',
    no_sitemap: 'the site\'s robots.txt names no sitemap',
    no_robots: 'the site has no robots.txt',
    site_unreachable: 'the live site did not answer',
    no_address: 'the site has no live address yet — publish it first'
  }[found] ?? found
}

// ── check ──────────────────────────────────────────────────────────────────────────

/**
 * `uniweb promote check <step>` — check one getting-found step, and show its reading.
 *
 * ⭐ A step is named by the token the app gives it (`sitemap`). The backend checks a step named
 * by its item, so a site that has no item for the step yet gets one first — the owner's field,
 * written as the app writes it. If the backend then cannot check that step, the item made for
 * it is removed again: a check that could not run leaves nothing behind.
 */
async function check(args) {
  const json = args.includes('--json')
  const step = positionals(args)[1]
  if (!step) {
    say.err('Name the step: uniweb promote check <step>, e.g. uniweb promote check sitemap')
    return { exitCode: 2 }
  }
  const conn = await open(args, 'Checking a getting-found step')
  if (conn.refused) {
    say.err(conn.refused)
    return { exitCode: 2 }
  }
  const { client } = conn
  const site = await targetSite(args, client, `check ${step}`)
  if (!site) return { exitCode: 2 }

  const res = await client.readPromotion(site)
  if (!res.ok) {
    await sayRefusal(res, { site, origin: client.origin, what: 'read Promote' })
    return { exitCode: 1 }
  }
  const view = readView((await res.json().catch(() => null))?.promotion ?? null)
  let item = view.steps.find((s) => s.step === step) ?? null
  let made = null
  if (!item) {
    const created = await client.writePromotionItems(site, [{ kind: 'create', section: 'getting_found', data: { step } }])
    if (!created.ok) {
      await sayRefusal(created, { site, origin: client.origin, what: 'add a getting-found step' })
      return { exitCode: 1 }
    }
    const result = (await created.json().catch(() => null))?.results?.[0]
    if (!result?.uuid) {
      say.err('The backend made the step but did not say which item it is.')
      return { exitCode: 1 }
    }
    made = result
    item = { uuid: result.uuid, step }
  }

  const checked = await client.checkPromotionStep(site, item.uuid)
  if (!checked.ok) {
    if (checked.status === 400) {
      if (made) {
        await client
          .writePromotionItems(site, [{ kind: 'delete', uuid: made.uuid, if_unmodified_since: made.updated_at }])
          .catch(() => null)
      }
      say.err(`The backend cannot check \`${step}\` yet. The person does that step at the service, and marks it in the app.`)
      return { exitCode: 1 }
    }
    await sayRefusal(checked, { site, origin: client.origin, what: 'check a step' })
    return { exitCode: 1 }
  }
  const reading = (await checked.json().catch(() => null))?.reading ?? null
  if (json) {
    console.log(JSON.stringify({ backend: client.origin, site, step, uuid: item.uuid, reading }))
    return { exitCode: 0 }
  }
  if (!reading) {
    say.warn(`Checked \`${step}\`, and the backend answered no reading.`)
    return { exitCode: 0 }
  }
  const words = foundWords(reading.found)
  if (reading.state === 'done') {
    say.ok(`${step}: done — ${words}${reading.address ? `: ${reading.address}` : ''}`)
  } else {
    say.warn(`${step}: ${reading.state} — ${words}`)
    if (reading.detail) say.dim(reading.detail)
  }
  return { exitCode: 0 }
}

// ── connect ────────────────────────────────────────────────────────────────────────

/**
 * `uniweb promote connect <network>` — the address where a person connects an account.
 *
 * ⛔ THE CONSENT FINISHES ONLY IN A BROWSER SIGNED IN TO THE APP AS THE SAME PERSON. The backend
 * answers a consent once, for whoever started it, within minutes; a browser signed in as anyone
 * else, or not at all, spends it. So the command says that before the address, and an agent passes
 * the address to its person rather than opening it somewhere they are not.
 */
async function connectNetwork(args) {
  const network = positionals(args)[1]
  const conn = await open(args, 'Connecting an account')
  if (conn.refused) {
    say.err(conn.refused)
    return { exitCode: 2 }
  }
  const { client } = conn
  const offered = await offeredNetworks(client)
  if (!network) {
    say.err('Name the network: uniweb promote connect <network>')
    if (offered?.length) say.dim(`${client.origin} can connect: ${offered.join(', ')}`)
    return { exitCode: 2 }
  }
  if (offered && !offered.includes(network)) {
    say.err(
      offered.length
        ? `${client.origin} cannot connect \`${network}\` — it offers ${offered.join(', ')}.`
        : `${client.origin} cannot connect any network yet.`
    )
    return { exitCode: 2 }
  }

  const res = await client.startConnectionConsent({ network })
  if (!res.ok) {
    if (res.status === 404) {
      say.err(`${client.origin} does not offer \`${network}\`.`)
    } else {
      await sayRefusal(res, { site: '', origin: client.origin, what: 'connect an account' })
    }
    return { exitCode: 1 }
  }
  const address = (await res.json().catch(() => null))?.address
  if (!address) {
    say.err('The backend started the consent but gave no address to open.')
    return { exitCode: 1 }
  }
  say.info(`Connect ${network}, in a browser signed in to the app as you:`)
  console.log(`  ${address}`)
  say.dim('The consent finishes only there, once, and only for whoever started it — open it soon.')
  if (isNonInteractive(args)) {
    say.dim('An agent hands this address to its person, who opens it.')
  } else {
    try {
      const { openBrowser } = await import('../utils/registry-auth.js')
      await openBrowser(address)
    } catch {
      /* the address is printed; opening it is a convenience */
    }
  }
  return { exitCode: 0 }
}

// ── the command ────────────────────────────────────────────────────────────────────

export async function promote(args = []) {
  const badFlag = checkFlags('promote', args)
  if (badFlag) {
    say.err(badFlag.message)
    return { exitCode: 2 }
  }
  const sub = positionals(args)[0]
  try {
    if (sub === 'status') return await status(args)
    if (sub === 'check') return await check(args)
    if (sub === 'connect') return await connectNetwork(args)
  } catch (err) {
    say.err(err instanceof WorkspaceMismatchError ? err.message : err?.message || String(err))
    return { exitCode: 1 }
  }
  if (sub) {
    say.err(`Unknown command: uniweb promote ${sub}`)
    console.error(USAGE)
    return { exitCode: 2 }
  }
  console.log(USAGE)
  return { exitCode: 0 }
}

export default promote
