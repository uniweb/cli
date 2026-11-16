/**
 * `uniweb promote` — a site's Promote, on the backend you are logged in to: getting it found,
 * posts and ads on social networks and search engines, and what they brought.
 *
 *   uniweb promote status [--json]          the site's Promote on one screen, and what needs a person
 *   uniweb promote check <step> [--json]    check one getting-found step (`sitemap`, say)
 *   uniweb promote connect <network>        the address where a person connects an account
 *   uniweb promote post <file>              make a post's draft, or update the one the file names
 *   uniweb promote campaign <file>          the same for a campaign, its ad groups and ads
 *   uniweb promote show <id> [--json]       one post or campaign, as a draft holds it
 *   uniweb promote delete <id>              delete a post, a campaign, an ad group or an ad
 *   uniweb promote send <post> [--at <time> | --now]   post it now, or at a time
 *   uniweb promote unschedule <post>        a scheduled post a draft again, its time kept
 *   uniweb promote start | resume <campaign> [--yes]  spend: say what, ask, then start
 *   uniweb promote pause <campaign>         pause it wherever it runs
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
 * ⭐ AN AGENT SENDS AND SPENDS FOR ITS PERSON [Diego, 2026-11-16: "agents represent their users"].
 * `start` and `resume` say what they will spend and ask at a terminal; `--yes` answers for an
 * agent its person has agreed with, and without either they refuse rather than spend unseen.
 *
 * Auth: the session of the backend you are logged in to (`uniweb login`) / UNIWEB_TOKEN.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { mintUuidV7 } from '@uniweb/build/uwx'
import { BackendClient, WorkspaceMismatchError, describeWorkspace } from '../backend/client.js'
import { resolveWorkspace } from '../backend/workspace.js'
import {
  YAML_READ,
  campaignDeliveries,
  connectionOf,
  conversionNotes,
  campaignOf,
  campaignShape,
  checkDraft,
  deliveryOf,
  fileWithFields,
  fileWithIdentity,
  findItem,
  formatOf,
  idMatches,
  indexPromotion,
  isAddress,
  kindOf,
  pageRoute,
  parseDraft,
  picturesOf,
  planCampaign,
  planPost,
  postMarkdown,
  postShape,
  resolvePage,
  shapeYaml,
  shortIds,
  sitePages,
  splitFrontmatter,
  versionOf,
  viaResolver,
  wentOut
} from '../backend/promote-drafts.js'
import { checkFlags } from '../utils/flag-guard.js'
import { confirm, isNonInteractive } from '../utils/interactive.js'
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
  '  status                  The site\'s Promote: getting found, networks, posts, campaigns,',
  '                          and what needs a person',
  '  check <step>            Check one getting-found step, e.g. uniweb promote check sitemap',
  '  connect <network>       The address where a person connects an account at a network',
  '  post <file>             Make a post\'s draft (Markdown, YAML or JSON), or update the one',
  '                          the file names; the file gets its id and version back',
  '  campaign <file>         The same for a campaign (YAML or JSON), its ad groups and ads',
  '  show <id>               One post or campaign, as a draft holds it',
  '  delete <id>             Delete a post, a campaign, an ad group or an ad',
  '  send <post>             Post it now, or at its send_at; --at <time> sets the time,',
  '                          --now sends it now whatever its time',
  '  unschedule <post>       A scheduled post a draft again, its time kept',
  '  start <campaign>        Start it in its ad accounts — it says what it will spend and',
  '                          asks; --yes answers for you',
  '  resume <campaign>       Resume it where it was paused, the same way',
  '  pause <campaign>        Pause it wherever it runs',
  '',
  '--json gives any command\'s answer as JSON. An <id> is the one a command shows, a file',
  'a draft was written from, or a campaign\'s name.',
  'The site is the one this project is synced to, or --site <uuid>.',
  'The workspace is --org @x or --personal, else the one chosen at login.'
].join('\n')

/** A site-content uuid, loosely: enough to tell one from anything else. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Flags that take a value, so the value is not read as an argument. */
const VALUED = new Set(['--org', '--site', '--at'])

/** The arguments that are not flags, skipping the values of the flags that take one. */
function positionals(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (VALUED.has(a)) {
      i++
      continue
    }
    // A lone `-` is stdin, a value rather than a flag.
    if (a.startsWith('-') && a !== '-') continue
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

/**
 * A reason the backend gave — a delivery's, or a refusal's — in words. One the CLI has no words
 * for yet is shown as it is, so a reason can ship before the CLI has a sentence for it; `--json`
 * gives the codes.
 */
const REASONS = {
  no_network: 'the account it goes out through is no longer chosen for the site',
  no_connection: 'no account is connected for it',
  site_not_published: 'the site is not published yet — publish it first',
  no_page: 'it links to no page of the site',
  page_gone: 'the page it links to was removed from the site',
  page_not_published: 'the page it links to is not published in its language yet — publish the site again',
  connection_stopped: 'its account stopped: whoever connected it left the workspace, and an admin hands it on, in the app',
  connection_gone: 'its account was disconnected',
  connection_needs_reconnect: 'its account needs reconnecting, by its person, in the app',
  connection_not_permitted: 'whoever scheduled it may no longer post through its account',
  network_not_offered: 'this backend does not offer that network',
  network_refused: 'the network refused it',
  promote_off: 'the site has no Promote: it comes with the site\'s Analytics, which the person turns on in the app',
  feature_not_subscribed: 'Promote comes with the site\'s Analytics, which this site does not have yet. The person turns it on in the app'
}

export function reasonWords(code) {
  return REASONS[code] ?? code
}

/** A network's review of an ad, in words: `in_review` → `in review`. */
const reviewWords = (code) => String(code).replace(/_/g, ' ')

/**
 * What the backend said about a refused request, in words, and its own beside them.
 *
 * @param {Response} res
 * @param {{ site: string, origin: string, what: string, index?: object }} ctx - `what` completes
 *   "You may not …"; `index` names a campaign a refusal names by uuid
 */
async function sayRefusal(res, { site, origin, what, index = null, notFound = null }) {
  const body = await res.clone().json().catch(() => null)
  const reason = typeof body?.reason === 'string' ? body.reason : null
  const own = [reason, body?.detail ?? body?.message ?? body?.title].filter((x) => typeof x === 'string' && x).join(': ')
  if (res.status === 401) {
    say.err(`Your session on ${origin} is not accepted — sign in again: uniweb login`)
  } else if (res.status === 402) {
    say.err(`${REASONS.feature_not_subscribed}.`)
  } else if (res.status === 403 && body?.op === 'admin') {
    say.err(`Only an admin of the site may ${what}. What is written stays, for one of them to do it.`)
  } else if (res.status === 403 && body?.op === 'edit' && body?.target) {
    say.err(`The account it goes out through is not shared with you for that. Use one you can use, or ask whoever connected it to share it.`)
  } else if (res.status === 403) {
    say.err(`You may not ${what} on this site${body?.op ? ` (it takes ${body.op})` : ''}.`)
  } else if (res.status === 404) {
    say.err(notFound ?? `${origin} has no site ${site}, or no longer has what was named — \`uniweb promote status\` shows what it has.`)
  } else if (res.status === 409 && reason === 'campaign_started') {
    const name = index?.byUuid.get(body?.campaign)?.data?.name
    say.err(
      `${name ? `“${name}”` : 'The campaign'} has started in an ad account, and what runs there is fixed, so the write is refused — nothing changed. ` +
        'Add an ad account to its `via`, or draft a new campaign.'
    )
  } else if (res.status === 409) {
    say.err(`Refused, nothing changed: what was named changed since it was read — in the app, or by another run${own ? ` (${own})` : ''}. Read it again: uniweb promote show <id>`)
  } else {
    say.err(`The backend refused: HTTP ${res.status}${own ? ` — ${own}` : ''}`)
  }
}

/** A 404 on reading a site's Promote: no such site there, or a backend without these routes. */
const notOffered = (origin, site) => `${origin} has no site ${site}, or does not offer Promote to this CLI yet.`

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
    await sayRefusal(res, { site, origin: client.origin, what: 'read Promote', notFound: notOffered(client.origin, site) })
    return { exitCode: 1 }
  }
  const promotion = (await res.json().catch(() => null))?.promotion ?? null
  const view = readView(promotion)
  const connections = connectionsRes?.ok ? (await connectionsRes.json().catch(() => null))?.connections ?? [] : null
  // Each post and campaign by the id the other commands take.
  const ids = shortIds((promotion?.items ?? []).map((i) => i?.uuid))
  for (const x of [...view.posts, ...view.campaigns]) x.short = ids.get(x.uuid)

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
    const via = connectionOf(n.connection)
    const k = byUuid.get(via.uuid)
    const account = n.target?.name || via.name || k?.card?.name || via.handle || k?.card?.handle || 'no account chosen'
    const known = k?.card?.state ?? via.state
    const state = known && known !== 'connected' ? ` ${c.yellow}(${known})${c.reset}` : ''
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
  // What can still be acted on, each by its id: a draft, a scheduled post, one that failed.
  for (const p of posts.filter((x) => x.state !== 'published' && x.state !== 'review')) {
    const first = String(p.parts?.[0]?.text ?? '').replace(/\s+/g, ' ').trim()
    const words = first ? `“${first.length > 40 ? `${first.slice(0, 39)}…` : first}”` : '(no words yet)'
    const when = p.state === 'scheduled' && p.send_at ? ` ${p.send_at}` : ''
    const why = p.state === 'failed' && p.delivery?.reason ? ` — ${reasonWords(p.delivery.reason)}` : ''
    console.log(`${' '.repeat(17)}${c.cyan}${p.short ?? p.uuid}${c.reset} ${p.state}${when} ${words}${why}`)
  }
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
    console.log(`  ${head}${c.cyan}${x.short ?? x.uuid}${c.reset} ${x.name ?? x.uuid}: ${x.state}${spent}`)
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
 * ⭐ A STEP IS NAMED BY ITS TOKEN (`sitemap`), AND THE BACKEND KEEPS ONE ITEM FOR IT: the check
 * finds the step's item, or makes it on its first check, so neither client makes one to check it,
 * and a second is refused. A step the backend cannot check is `400`, with nothing made.
 */
async function check(args) {
  const json = args.includes('--json')
  const step = positionals(args)[1]
  if (!step) {
    say.err('Name the step or the page: uniweb promote check sitemap, or uniweb promote check /holiday')
    return { exitCode: 2 }
  }
  if (step.startsWith('/') || step.startsWith('page:/')) return checkLanding(args, step.replace(/^page:/, ''))
  const at = await begin(args, 'Checking a getting-found step', `check ${step}`)
  if (!at.client) return at
  const { client, site } = at

  const checked = await client.checkPromotionStep(site, step)
  if (!checked.ok) {
    if (checked.status === 400) {
      say.err(`The backend cannot check \`${step}\` yet. The person does that step at the service, and marks it in the app.`)
      return { exitCode: 1 }
    }
    await sayRefusal(checked, { site, origin: client.origin, what: 'check a step', notFound: notOffered(client.origin, site) })
    return { exitCode: 1 }
  }
  const reading = (await checked.json().catch(() => null))?.reading ?? null
  if (json) {
    console.log(JSON.stringify({ backend: client.origin, site, step, reading }))
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

// ── a landing page: check <route> ──────────────────────────────────────────────────

/** The site's directory, when the site a command acts on is this project's; else null. */
async function siteFilesFor(site, origin) {
  const project = await projectSiteDir().catch(() => null)
  if (!project?.dir) return null
  if (site && readSiteIdentity(project.dir, origin).uuid !== site) return null
  return project.dir
}

function readSiteYml(dir) {
  for (const name of ['site.yml', 'site.yaml']) {
    const path = join(dir, name)
    if (!existsSync(path)) continue
    try {
      return yaml.load(readFileSync(path, 'utf8'), YAML_READ) ?? null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Notes on the pages a post or an ad lands on, from the site's files — each page's card, by
 * doctor's rules for one page — and on what the site reports for a network to hear. Each is a
 * note, never a gate: whoever sends or starts decides, with the notes in front of them.
 *
 * @param {string} dir - the site's directory
 * @param {string[]} routes
 * @param {{ networks?: string[]|null, goal?: string|null, quiet?: boolean }} [opts]
 * @returns {Promise<{ issues: object[], notes: object[] }>}
 */
async function landingNotes(dir, routes, { networks = null, goal = null, quiet = false } = {}) {
  const { checkLinkPreviews } = await import('./doctor.js')
  const issues = []
  const consoleLog = console.log
  if (quiet) console.log = () => {}
  try {
    for (const route of routes) {
      const before = issues.length
      if (!quiet) console.log(`${c.bold}${route}${c.reset}${c.dim}, as a landing page, from the site's files:${c.reset}`)
      await checkLinkPreviews({ sitePath: dir, siteName: basename(dir), issues, route })
      if (!quiet && issues.length === before) say.ok('its card has an image and a description')
    }
  } finally {
    console.log = consoleLog
  }
  const notes = conversionNotes(readSiteYml(dir), { networks, goal })
  if (!quiet) for (const n of notes) (n.ok ? say.ok : say.warn)(n.text)
  return { issues, notes }
}

/**
 * `uniweb promote check <route>` — a page as a landing page, from the site's files, on any site:
 * one Uniweb hosts or a static one. Its card, by doctor's rules for one page, and what the site
 * reports for a network to hear. It needs no backend.
 */
async function checkLanding(args, route) {
  const json = args.includes('--json')
  const project = await projectSiteDir().catch(() => ({}))
  if (project?.many) {
    say.err(`This workspace has ${project.many.length} sites — run it inside the one the page is in.`)
    return { exitCode: 2 }
  }
  if (!project?.dir) {
    say.err('Run it in the site\'s project: a landing page is checked in its files.')
    return { exitCode: 2 }
  }
  const found = await landingNotes(project.dir, [route], { goal: 'conversions', quiet: json })
  const unknown = found.issues.some((i) => i.id === 'page-unknown')
  if (json) console.log(JSON.stringify({ route, issues: found.issues, notes: found.notes }))
  return { exitCode: unknown ? 1 : 0 }
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

// ── shared by the commands below ───────────────────────────────────────────────────

/** The client and the site a command acts on — or its exit code, the reason said. */
async function begin(args, command, verb) {
  const conn = await open(args, command)
  if (conn.refused) {
    say.err(conn.refused)
    return { exitCode: 2 }
  }
  const site = await targetSite(args, conn.client, verb)
  if (!site) return { exitCode: 2 }
  return { client: conn.client, workspace: conn.workspace, site }
}

/** The site's Promote, read fresh and indexed — or null, the refusal said. */
async function readIndex(client, site) {
  const res = await client.readPromotion(site)
  if (!res.ok) {
    await sayRefusal(res, { site, origin: client.origin, what: 'read Promote', notFound: notOffered(client.origin, site) })
    return null
  }
  return indexPromotion((await res.json().catch(() => null))?.promotion ?? null)
}

/** The site's pages as pushed — null when it has none there, or they could not be read. */
async function readPages(client, site) {
  try {
    const res = await client.pullSiteContent(site)
    if (!res?.ok) return null
    const { entityDocFromUwx } = await import('../backend/site-sync.js')
    const doc = entityDocFromUwx(Buffer.from(await res.arrayBuffer()))
    return doc ? sitePages(doc) : null
  } catch {
    return null
  }
}

/** The caller's connections — null when they could not be listed. */
async function listedConnections(client) {
  const res = await client.listConnections().catch(() => null)
  return res?.ok ? ((await res.json().catch(() => null))?.connections ?? []) : null
}

/** An item's name in a line: a post's first words, a campaign's or an ad group's name, an ad's headline. */
function labelOf(index, item) {
  const words = (text) => {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim()
    return t.length > 48 ? `${t.slice(0, 47)}…` : t
  }
  if (item.section === 'posts') {
    const first = index.children('posts/parts', item.uuid)[0]?.data?.text
    return first ? `“${words(first)}”` : '(no words yet)'
  }
  if (item.section === 'campaigns/ad_groups/ads') {
    const headline = item.data?.headlines?.[0] ?? index.children('campaigns/ad_groups/ads/parts', item.uuid)[0]?.data?.text
    return headline ? `“${words(headline)}”` : '(no words yet)'
  }
  return item.data?.name ? `“${item.data.name}”` : '(no name)'
}

/** A `networks` item as a person reads it: `facebook “Maple Bakery Ads”`. */
function accountName(index, uuid, connections) {
  const n = index.byUuid.get(uuid)
  if (!n) return `account ${uuid}`
  const via = connectionOf(n.data?.connection)
  const k = (connections ?? []).find((c) => c.uuid === via.uuid)
  const name = n.data?.target?.name || via.name || k?.card?.name || via.handle || k?.card?.handle
  return `${n.data?.network ?? '?'}${name ? ` “${name}”` : ''}`
}

/** The file a command names, when it names one: its path, text and format. */
function draftFile(arg) {
  const path = resolve(arg)
  if (!existsSync(path) || !statSync(path).isFile()) return null
  const text = readFileSync(path, 'utf8')
  return { path, text, format: formatOf(path, text) }
}

/** The id in a file a draft was written from, else null. */
function idInFile(text, format) {
  try {
    if (format === 'json') return JSON.parse(text)?.id ?? null
    const src = format === 'markdown' ? splitFrontmatter(text).front : text
    const obj = src ? yaml.load(src, YAML_READ) : null
    return typeof obj?.id === 'string' ? obj.id : null
  } catch {
    return null
  }
}

/**
 * The item a command names — by the id a command shows, a campaign's name, or the file a draft
 * was written from — or null, with what it matched said.
 */
function pick(index, arg, kinds) {
  let ref = arg
  const path = resolve(arg)
  if (existsSync(path) && statSync(path).isFile()) {
    const text = readFileSync(path, 'utf8')
    ref = idInFile(text, formatOf(path, text))
    if (!ref) {
      say.err(`${arg} holds no id yet — write it first: uniweb promote ${kinds.includes('post') ? 'post' : 'campaign'} ${arg}`)
      return null
    }
  }
  const found = findItem(index, ref, { kinds })
  if (found.item) return found.item
  const ids = shortIds(index.items.map((i) => i.uuid))
  if (found.many) {
    say.err(`\`${ref}\` names ${found.many.length} things — give more of its id:`)
    for (const i of found.many) say.dim(`${ids.get(i.uuid)}  ${kindOf(i)} ${labelOf(index, i)}`)
    return null
  }
  say.err(`This site's Promote has no ${kinds.join(' or ')} \`${ref}\` — \`uniweb promote status\` lists what it has.`)
  return null
}

/** Whether `--at`'s value is a time with its offset, as the backend takes one. */
function isTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
}

const sameInstant = (a, b) => typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b)

/** An amount as money reads: `10.00` for the `10` YAML reads `10.00` as; a string as written. */
const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : String(v))

/** Amounts summed in cents, kept as the decimal text a network reads: `15.00`; null when none is given. */
function sumAmounts(values) {
  let cents = 0
  let any = false
  for (const v of values) {
    const n = Math.round(Number(v) * 100)
    if (v === null || v === undefined || v === '' || !Number.isFinite(n)) continue
    cents += n
    any = true
  }
  return any ? (cents / 100).toFixed(2) : null
}

// ── drafts: post, campaign, show, delete ───────────────────────────────────────────

/** A draft's text, from the file a command names or from stdin for `-`. */
function readInput(args, kind) {
  const file = positionals(args)[1]
  if (!file) return { error: `Name the draft: uniweb promote ${kind} <file>, or - to read it from stdin` }
  if (file === '-') {
    try {
      return { file: null, shown: 'stdin', text: readFileSync(0, 'utf8'), dir: process.cwd() }
    } catch (err) {
      return { error: `Could not read stdin: ${err.message}` }
    }
  }
  const path = resolve(file)
  if (!existsSync(path) || !statSync(path).isFile()) return { error: `No file ${file}.` }
  return { file: path, shown: file, text: readFileSync(path, 'utf8'), dir: dirname(path) }
}

/**
 * A draft in the backend's terms: `via` as the site's `networks` item (made in the same write
 * where the site has none for that network), `page` as the page's item, an ad's account one of its
 * campaign's. Pictures stay as written until they are uploaded.
 */
function translateDraft(draft, { index, pages, connections }) {
  const errors = []
  const out = structuredClone(draft)
  const via = viaResolver({ networks: index.top('networks'), connections, mint: mintUuidV7 })
  const page = (raw, where) => {
    if (raw && !pages) {
      errors.push(`${where} links to a page, and the site has no content pushed here yet — push it first (uniweb push).`)
      return undefined
    }
    const r = resolvePage(raw, pages, where)
    if (r.error) errors.push(r.error)
    return r.error ? undefined : r.uuid
  }

  if (draft.kind === 'post') {
    if (draft.fields.via !== undefined || !draft.id) {
      const r = via.resolve(draft.fields.via, 'posts', 'The post')
      if (r.error) errors.push(r.error)
      else out.fields.via = r.uuid
    }
    if (draft.fields.page !== undefined) out.fields.page = page(draft.fields.page, 'The post')
    return { draft: out, creates: via.creates(), errors }
  }

  let campaignVia
  if (draft.fields.via !== undefined) {
    const list = draft.fields.via === null ? [] : Array.isArray(draft.fields.via) ? draft.fields.via : [draft.fields.via]
    const uuids = []
    list.forEach((raw, i) => {
      const r = via.resolve(raw, 'ads', list.length > 1 ? `The campaign's account ${i + 1}` : 'The campaign')
      if (r.error) errors.push(r.error)
      else uuids.push(r.uuid)
    })
    out.fields.via = [...new Set(uuids)]
    campaignVia = out.fields.via
  } else {
    const stored = draft.id ? index.byUuid.get(draft.id) : null
    campaignVia = Array.isArray(stored?.data?.via) ? stored.data.via : []
  }
  const made = () => via.creates()
  const accounts = campaignVia.map((u) => index.byUuid.get(u) ?? made().find((op) => op.uuid === u) ?? { uuid: u, data: {} })

  for (const [i, g] of (draft.adGroups ?? []).entries()) {
    for (const [j, a] of (g.ads ?? []).entries()) {
      const where = `Ad ${j + 1} of ad group ${i + 1}`
      const ad = out.adGroups[i].ads[j]
      if (a.fields.via !== undefined && a.fields.via !== null) {
        const raw = a.fields.via
        const want = typeof raw === 'object' ? raw : { network: raw }
        const matches = accounts.filter((n) =>
          typeof raw === 'string' && idMatches(n.uuid, raw)
            ? true
            : n.data?.network === want.network && (!want.connection || idMatches(n.data?.connection, String(want.connection)))
        )
        if (matches.length === 1) ad.fields.via = matches[0].uuid
        else if (!matches.length) errors.push(`${where} goes through ${typeof raw === 'string' ? raw : want.network}, and the campaign does not run there — add it to the campaign's \`via\`.`)
        else errors.push(`${where}: the campaign runs in ${matches.length} ${want.network} accounts — name the ad's by its id.`)
      } else if (!a.id) {
        if (accounts.length === 1) ad.fields.via = accounts[0].uuid
        else if (accounts.length > 1) errors.push(`${where}: the campaign runs in ${accounts.length} ad accounts — name the one the ad runs in, \`via:\`.`)
      }
      if (a.fields.page !== undefined) ad.fields.page = page(a.fields.page, where)
    }
  }
  return { draft: out, creates: via.creates(), errors }
}

/**
 * Upload the pictures a draft names as files, each as one of the site's own and kept in its
 * format, as the app uploads a post's picture. An address is kept as written.
 *
 * @returns {Promise<{ map: Map<string,string> } | { error: string }>} picture as written → its address
 */
async function uploadPictures(client, site, pictures, dir) {
  const map = new Map()
  const located = []
  const used = new Set()
  for (const p of pictures) {
    if (isAddress(p)) continue
    const path = isAbsolute(p) ? p : resolve(dir, p)
    if (!existsSync(path) || !statSync(path).isFile()) {
      // An address on the backend's own origin, as a read gives one back, is kept.
      if (p.startsWith('/')) continue
      return { error: `No picture ${p} (looked for ${path}).` }
    }
    // The name the upload is planned under: the file's own, never where it sits on this machine.
    let name = basename(path)
    for (let n = 2; used.has(name); n++) name = `${n}-${basename(path)}`
    used.add(name)
    located.push({ picture: p, ref: `/promote/${name}`, path })
  }
  if (!located.length) return { map }
  const { uploadSiteMedia, describeAssetRefusal } = await import('../backend/site-media.js')
  const refs = located.map(({ ref, path }) => ({ ref, path }))
  const keepFormat = new Set(located.map((l) => l.ref))
  let result
  try {
    // Charged to the site, which this command read: its owner exists before the bytes do.
    result = await uploadSiteMedia(client, process.cwd(), refs, { siteUuid: site, keepFormat, warn: (m) => say.warn(m) })
  } catch (err) {
    const lines = describeAssetRefusal?.(err)
    return { error: Array.isArray(lines) && lines.length ? lines.join('\n') : `The pictures could not be uploaded: ${err.message}` }
  }
  for (const l of located) {
    const address = result.map?.[l.ref]
    if (!address) return { error: `The picture ${l.picture} could not be uploaded${result.failed?.length ? ` (HTTP ${result.failed[0].status})` : ''}.` }
    map.set(l.picture, address)
  }
  return { map }
}

/** Each picture as written replaced by its address. */
function withPictures(draft, map) {
  const swap = (parts) => {
    for (const p of parts ?? []) p.pictures = p.pictures.map((x) => map.get(x) ?? x)
  }
  swap(draft.parts)
  for (const g of draft.adGroups ?? []) for (const a of g.ads ?? []) swap(a.parts)
}

/** The index after a write, from the write's own answer, for when it cannot be read again. */
function indexAfterWrite(index, ops, results) {
  const items = new Map(index.items.map((i) => [i.uuid, { ...i }]))
  ops.forEach((op, n) => {
    const at = results?.[n]?.updated_at ?? null
    if (op.kind === 'delete') items.delete(op.uuid)
    else if (op.kind === 'update') items.set(op.uuid, { ...items.get(op.uuid), data: op.data, updated_at: at })
    else items.set(op.uuid, { uuid: op.uuid, section: op.section, ...(op.parent ? { parent: op.parent } : {}), data: op.data, updated_at: at })
  })
  return indexPromotion({ uuid: index.uuid, items: [...items.values()] })
}

/**
 * `uniweb promote post <file>` and `campaign <file>` — make a draft, or update the one the file
 * names, and write its ids and versions back into the file.
 */
async function writeDraft(args, kind) {
  const json = args.includes('--json')
  const input = readInput(args, kind)
  if (input.error) {
    say.err(input.error)
    return { exitCode: 2 }
  }
  const format = formatOf(input.file, input.text)
  const parsed = parseDraft(input.text, { format, kind })
  if (parsed.error) {
    say.err(parsed.error)
    return { exitCode: 2 }
  }
  const draft = parsed.draft

  const at = await begin(args, kind === 'post' ? 'Writing a post' : 'Writing a campaign', kind)
  if (!at.client) return at
  const { client, site } = at
  const index = await readIndex(client, site)
  if (!index) return { exitCode: 1 }
  const problems = checkDraft(index, draft)
  if (problems.length) {
    for (const p of problems) say.err(p)
    return { exitCode: 1 }
  }

  const [pages, connections] = await Promise.all([readPages(client, site), listedConnections(client)])
  const translated = translateDraft(draft, { index, pages, connections })
  if (translated.errors.length) {
    for (const e of translated.errors) say.err(e)
    return { exitCode: 2 }
  }
  const pictures = await uploadPictures(client, site, picturesOf(draft), input.dir)
  if (pictures.error) {
    say.err(pictures.error)
    return { exitCode: 1 }
  }
  withPictures(translated.draft, pictures.map)

  const plan = (kind === 'post' ? planPost : planCampaign)(index, translated.draft, { mint: mintUuidV7, language: pages?.language })
  const ops = [...translated.creates, ...plan.ops]
  const wasScheduled = kind === 'post' && deliveryOf(index, index.byUuid.get(plan.uuid))?.status === 'scheduled'

  let after = index
  if (ops.length) {
    const res = await client.writePromotionItems(site, ops)
    if (!res.ok) {
      await sayRefusal(res, { site, origin: client.origin, what: `write this site's ${kind}s`, index })
      return { exitCode: 1 }
    }
    const written = await res.json().catch(() => null)
    after = (await readIndex(client, site).catch(() => null)) ?? indexAfterWrite(index, ops, written?.results)
  }

  // The file keeps what it was written at, so the next run updates the same draft.
  const version = (uuid) => {
    const item = after.byUuid.get(uuid)
    return item ? versionOf(after, item) : null
  }
  let fileNote = null
  if (input.file) {
    const next = fileWithIdentity(input.text, { format, kind }, { uuid: plan.uuid, groups: plan.groups }, version)
    if (!next) fileNote = `Could not write the ids into ${input.shown} — its next run would make another draft. Add \`id: ${plan.uuid}\` and \`version: ${version(plan.uuid)}\` to it.`
    else if (next.text !== input.text) {
      writeFileSync(input.file, next.text)
      if (next.whole) fileNote = `Wrote ${input.shown} again whole, with its ids: its layout could not be kept.`
    }
  }

  const ids = shortIds(after.items.map((i) => i.uuid))
  const item = after.byUuid.get(plan.uuid)
  const id = ids.get(plan.uuid) ?? plan.uuid
  if (json) {
    console.log(JSON.stringify({
      backend: client.origin,
      site,
      kind,
      id: plan.uuid,
      short: id,
      version: version(plan.uuid),
      made: !draft.id,
      writes: ops.length,
      file: input.file ? input.shown : null,
      kept: (plan.kept ?? []).map((k) => ({ ...k, short: ids.get(k.uuid) }))
    }))
    return { exitCode: 0 }
  }

  if (!ops.length) {
    say.ok(`Nothing to change: ${kind} ${id} already says what ${input.shown} says.`)
  } else if (kind === 'post') {
    const via = after.byUuid.get(item?.data?.via)
    const route = pageRoute(item?.data?.page, pages)
    say.ok(
      `${draft.id ? 'Updated' : 'Drafted'} post ${id}${via ? ` on ${via.data?.network}` : ''}` +
        `${route ? `, linking to ${route}` : ', linking to no page'}${item?.data?.language ? ` (${item.data.language})` : ''}.`
    )
    if (wasScheduled && deliveryOf(after, item)?.status !== 'scheduled') {
      say.warn(`It was scheduled, and a change makes it a draft again, its time kept: uniweb promote send ${id} schedules it again.`)
    }
  } else {
    const groups = after.children('campaigns/ad_groups', plan.uuid)
    const ads = groups.flatMap((g) => after.children('campaigns/ad_groups/ads', g.uuid))
    const accounts = (Array.isArray(item?.data?.via) ? item.data.via : []).map((u) => accountName(after, u, connections))
    say.ok(
      `${draft.id ? 'Updated' : 'Drafted'} campaign ${labelOf(after, item)} (${id}): ${groups.length} ad group${groups.length === 1 ? '' : 's'}, ` +
        `${ads.length} ad${ads.length === 1 ? '' : 's'}, ${accounts.length ? `in ${accounts.join(', ')}` : 'in no ad account yet'}.`
    )
    for (const k of plan.kept) {
      say.info(`Kept, not in your file: ${k.kind} ${k.name ? `“${k.name}” ` : ''}(${ids.get(k.uuid)}). \`uniweb promote delete ${ids.get(k.uuid)}\` deletes it.`)
    }
  }
  if (fileNote) say.warn(fileNote)
  else if (!input.file && ops.length) say.dim(`From stdin, so no file keeps its ids: give your next draft of it \`id: ${plan.uuid}\` and \`version: ${version(plan.uuid)}\`.`)
  // The pages it lands on, checked in the site's files where this project holds them.
  const landing = landingOf(after, item, pages)
  const dir = landing.routes.length ? await siteFilesFor(site, client.origin) : null
  if (dir) {
    console.log()
    await landingNotes(dir, landing.routes, { networks: landing.networks, goal: landing.goal })
  }
  if (kind === 'post' && wentOut(deliveryOf(after, item)) === false) {
    const sendAt = item?.data?.send_at
    if (deliveryOf(after, item)?.status === 'scheduled') say.dim(`Scheduled for ${sendAt}: \`uniweb promote unschedule ${id}\` makes it a draft again`)
    else say.dim(sendAt ? `Send it at its time, ${sendAt}: uniweb promote send ${id}` : `Send it: uniweb promote send ${id} [--at <time>]`)
  } else if (kind === 'campaign') {
    say.dim(`Start it: uniweb promote start ${id} — it says what it will spend, and asks first`)
  }
  return { exitCode: 0 }
}

/** The routes a post or a campaign lands on, the networks it goes out on, and a campaign's goal. */
function landingOf(index, item, pages) {
  if (!item) return { routes: [], networks: [], goal: null }
  const networkOf = (uuid) => index.byUuid.get(uuid)?.data?.network
  if (item.section === 'posts') {
    const route = pages?.byUuid.get(item.data?.page)?.route
    return { routes: route ? [route] : [], networks: [networkOf(item.data?.via)].filter(Boolean), goal: null }
  }
  const ads = index.children('campaigns/ad_groups', item.uuid).flatMap((g) => index.children('campaigns/ad_groups/ads', g.uuid))
  const routes = [...new Set(ads.map((a) => pages?.byUuid.get(a.data?.page)?.route).filter(Boolean))]
  const via = Array.isArray(item.data?.via) ? item.data.via : []
  return { routes, networks: [...new Set(via.map(networkOf).filter(Boolean))], goal: item.data?.goal ?? null }
}

/** What a post or a campaign is doing, in lines: its state, and each delivery's. */
function stateLines(index, target, connections) {
  const ids = shortIds(index.items.map((i) => i.uuid))
  const lines = []
  if (target.section === 'posts') {
    const d = deliveryOf(index, target)
    const state = d?.status ?? 'draft'
    lines.push(`Post ${ids.get(target.uuid)}: ${state}${d?.status === 'scheduled' && target.data?.send_at ? ` for ${target.data.send_at}` : ''}${d?.sent_at ? ` at ${d.sent_at}` : ''}`)
    if (d?.network_url) lines.push(`  on the network: ${d.network_url}`)
    if (d?.link) lines.push(`  it links to: ${d.link}`)
    if (d?.reason) lines.push(`  ${reasonWords(d.reason)}${d.detail ? ` — ${d.detail}` : ''}`)
    return lines
  }
  const deliveries = campaignDeliveries(index, target)
  const state = deliveries.length ? [...new Set(deliveries.map((d) => d.status))].join(', ') : 'draft'
  lines.push(`Campaign ${ids.get(target.uuid)} ${labelOf(index, target)}: ${state}${target.data?.tag ? ` (tag ${target.data.tag})` : ''}`)
  for (const d of deliveries) {
    lines.push(`  ${accountName(index, d.via, connections)}: ${d.status}${d.review ? `, the network's review: ${reviewWords(d.review)}` : ''}${d.currency ? `, in ${d.currency}` : ''}${d.reason ? ` — ${reasonWords(d.reason)}` : ''}${d.detail ? ` (${d.detail})` : ''}`)
  }
  for (const g of index.children('campaigns/ad_groups', target.uuid)) {
    for (const a of index.children('campaigns/ad_groups/ads', g.uuid)) {
      const d = deliveryOf(index, a)
      if (d) lines.push(`  ad ${ids.get(a.uuid)} ${labelOf(index, a)}: ${d.status}${d.reason ? ` — ${reasonWords(d.reason)}` : ''}${d.network_url ? ` ${d.network_url}` : ''}`)
    }
  }
  return lines
}

/**
 * `uniweb promote show <id>` — one post or campaign as a draft holds it, so it round-trips: a
 * post as Markdown, a campaign as YAML. What it is doing goes to stderr, so `show <id> > file`
 * keeps the draft alone.
 */
async function show(args) {
  const json = args.includes('--json')
  const arg = positionals(args)[1]
  if (!arg) {
    say.err('Name it: uniweb promote show <id>')
    return { exitCode: 2 }
  }
  const at = await begin(args, 'Reading the site\'s Promote', `show ${arg}`)
  if (!at.client) return at
  const { client, site } = at
  const index = await readIndex(client, site)
  if (!index) return { exitCode: 1 }
  const item = pick(index, arg, ['post', 'campaign', 'ad group', 'ad'])
  if (!item) return { exitCode: 2 }
  const target = item.section === 'posts' ? item : campaignOf(index, item)
  const [pages, connections] = await Promise.all([readPages(client, site), listedConnections(client)])
  const shape = target.section === 'posts' ? postShape(index, target, pages) : campaignShape(index, target, pages)
  if (json) {
    const ids = shortIds(index.items.map((i) => i.uuid))
    console.log(JSON.stringify({
      backend: client.origin,
      site,
      kind: kindOf(target),
      short: ids.get(target.uuid),
      draft: shape,
      ...(target.section === 'posts'
        ? { delivery: deliveryOf(index, target) }
        : {
            tag: target.data?.tag ?? null,
            deliveries: campaignDeliveries(index, target),
            ads: index.children('campaigns/ad_groups', target.uuid).flatMap((g) =>
              index.children('campaigns/ad_groups/ads', g.uuid).map((a) => ({ id: a.uuid, short: ids.get(a.uuid), delivery: deliveryOf(index, a) }))
            )
          })
    }))
    return { exitCode: 0 }
  }
  for (const line of stateLines(index, target, connections)) console.error(`${c.dim}${line}${c.reset}`)
  const text = target.section === 'posts' ? (postMarkdown(shape) ?? shapeYaml(shape)) : shapeYaml(shape)
  console.log(text.replace(/\n$/, ''))
  return { exitCode: 0 }
}

/** `uniweb promote delete <id>` — a post, a campaign, an ad group or an ad. */
async function deleteItem(args) {
  const json = args.includes('--json')
  const arg = positionals(args)[1]
  if (!arg) {
    say.err('Name it: uniweb promote delete <id>')
    return { exitCode: 2 }
  }
  const at = await begin(args, 'Deleting a draft', `delete ${arg}`)
  if (!at.client) return at
  const { client, site } = at
  const index = await readIndex(client, site)
  if (!index) return { exitCode: 1 }
  const item = pick(index, arg, ['post', 'campaign', 'ad group', 'ad'])
  if (!item) return { exitCode: 2 }
  const ids = shortIds(index.items.map((i) => i.uuid))
  const what = `${kindOf(item)} ${labelOf(index, item)} (${ids.get(item.uuid)})`
  if (item.section === 'posts' && wentOut(deliveryOf(index, item))) {
    say.err(`The ${what} went out: deleting its record here would not take it off the network, and it is the site's history. It stays.`)
    return { exitCode: 2 }
  }
  const res = await client.writePromotionItems(site, [{ kind: 'delete', uuid: item.uuid, if_unmodified_since: item.updated_at }])
  if (!res.ok) {
    await sayRefusal(res, { site, origin: client.origin, what: 'delete it', index })
    return { exitCode: 1 }
  }
  if (json) console.log(JSON.stringify({ backend: client.origin, site, kind: kindOf(item), id: item.uuid, deleted: true }))
  else say.ok(`Deleted the ${what}.`)
  return { exitCode: 0 }
}

// ── going out: send, unschedule, start, resume, pause ─────────────────────────────

/** A post's delivery, said: where it went out, when it will, or why it didn't. */
function sayDelivery(index, post, delivery, id) {
  const network = index.byUuid.get(post.data?.via)?.data?.network ?? 'its network'
  if (delivery?.status === 'published') {
    say.ok(`Posted ${id} on ${network}${delivery.network_url ? `: ${delivery.network_url}` : ''}`)
    if (delivery.link) say.dim(`It links to ${delivery.link}`)
    return 0
  }
  if (delivery?.status === 'scheduled') {
    say.ok(`Scheduled ${id} on ${network} for ${post.data?.send_at ?? 'its time'}. It goes out then as it stands, under your name.`)
    return 0
  }
  if (delivery?.status === 'failed' || delivery?.status === 'refused') {
    say.err(`Not posted: ${reasonWords(delivery.reason)}${delivery.detail ? ` — ${delivery.detail}` : ''}`)
    return 1
  }
  say.warn(`The backend answered ${delivery?.status ?? 'no delivery'} for ${id}.`)
  return 0
}

/**
 * `uniweb promote send <post> [--at <time> | --now]` — post it now, or at a time.
 *
 * ⭐ A POST WITH A TIME GOES OUT AT ITS TIME. Its `send_at` is the draft's own field, so `send`
 * schedules a post that holds one and posts one that holds none; `--at` sets the time first, and
 * `--now` posts it now whatever its time.
 */
async function send(args) {
  const json = args.includes('--json')
  const arg = positionals(args)[1]
  const now = args.includes('--now')
  const atGiven = args.includes('--at')
  const time = flagValue(args, '--at')
  if (!arg) {
    say.err('Name the post: uniweb promote send <post> [--at <time> | --now]')
    return { exitCode: 2 }
  }
  if (now && atGiven) {
    say.err('`--now` and `--at` each say when — give one.')
    return { exitCode: 2 }
  }
  if (atGiven && !isTime(time)) {
    say.err('`--at` takes a time with its offset, such as 2026-11-24T09:00-05:00.')
    return { exitCode: 2 }
  }
  if (atGiven && Date.parse(time) <= Date.now()) {
    say.err(`\`--at ${time}\` has passed: give a time ahead, or send it now with --now.`)
    return { exitCode: 2 }
  }
  const at = await begin(args, 'Sending a post', `send ${arg}`)
  if (!at.client) return at
  const { client, site } = at
  const index = await readIndex(client, site)
  if (!index) return { exitCode: 1 }
  const post = pick(index, arg, ['post'])
  if (!post) return { exitCode: 2 }
  const id = shortIds(index.items.map((i) => i.uuid)).get(post.uuid)
  const before = deliveryOf(index, post)
  const out = (delivery, exitCode) => {
    if (json) console.log(JSON.stringify({ backend: client.origin, site, id: post.uuid, short: id, delivery }))
    return { exitCode }
  }
  if (wentOut(before)) {
    if (!json) say.warn(`Post ${id} went out already${before.network_url ? `: ${before.network_url}` : ''}. A new post is a new draft.`)
    return out(before, 0)
  }

  const when = now ? null : atGiven ? time : (post.data?.send_at ?? null)
  if (when && !atGiven && Date.parse(when) <= Date.now()) {
    say.err(`Post ${id} holds send_at ${when}, which has passed: send it now with --now, or at another time with --at <time>.`)
    return { exitCode: 2 }
  }
  let res
  let moved = false
  if (when) {
    if (before?.status === 'scheduled' && sameInstant(post.data?.send_at, when)) {
      if (!json) say.ok(`Post ${id} is scheduled for ${post.data.send_at} already.`)
      return out(before, 0)
    }
    if (!sameInstant(post.data?.send_at, when)) {
      // The time is the post's own field, written first. A write makes a scheduled post a draft again.
      const wrote = await client.writePromotionItems(site, [
        { kind: 'update', uuid: post.uuid, data: { ...post.data, send_at: when }, if_unmodified_since: post.updated_at }
      ])
      if (!wrote.ok) {
        await sayRefusal(wrote, { site, origin: client.origin, what: 'set its time', index })
        return { exitCode: 1 }
      }
      post.data = { ...post.data, send_at: when }
      moved = true
    }
    res = await client.postAction(site, post.uuid, 'schedule')
  } else {
    res = await client.postAction(site, post.uuid, 'publish')
  }
  if (!res.ok) {
    await sayRefusal(res, { site, origin: client.origin, what: 'send posts', index })
    return { exitCode: 1 }
  }
  const delivery = (await res.json().catch(() => null))?.delivery ?? null
  // A file the post was drafted in keeps its new time and version, so its next run is not stale.
  const file = moved ? draftFile(arg) : null
  if (file) {
    const after = await readIndex(client, site).catch(() => null)
    const item = after?.byUuid.get(post.uuid)
    const next = item ? fileWithFields(file.text, file.format, { send_at: when, version: versionOf(after, item) }) : null
    if (next) writeFileSync(file.path, next)
    else if (!json) say.warn(`Could not write its new time into ${arg}: run \`uniweb promote show ${id} > ${arg}\` before you edit it again.`)
  }
  if (json) return out(delivery, delivery?.status === 'failed' || delivery?.status === 'refused' ? 1 : 0)
  return { exitCode: sayDelivery(index, post, delivery, id) }
}

/** `uniweb promote unschedule <post>` — a scheduled post a draft again, its time kept. */
async function unschedule(args) {
  const json = args.includes('--json')
  const arg = positionals(args)[1]
  if (!arg) {
    say.err('Name the post: uniweb promote unschedule <post>')
    return { exitCode: 2 }
  }
  const at = await begin(args, 'Unscheduling a post', `unschedule ${arg}`)
  if (!at.client) return at
  const { client, site } = at
  const index = await readIndex(client, site)
  if (!index) return { exitCode: 1 }
  const post = pick(index, arg, ['post'])
  if (!post) return { exitCode: 2 }
  const id = shortIds(index.items.map((i) => i.uuid)).get(post.uuid)
  const before = deliveryOf(index, post)
  if (before?.status !== 'scheduled') {
    if (json) console.log(JSON.stringify({ backend: client.origin, site, id: post.uuid, short: id, delivery: before }))
    else say.info(`Post ${id} is not scheduled (${before?.status ?? 'a draft'}): nothing to do.`)
    return { exitCode: 0 }
  }
  const res = await client.postAction(site, post.uuid, 'unschedule')
  if (!res.ok) {
    await sayRefusal(res, { site, origin: client.origin, what: 'unschedule posts', index })
    return { exitCode: 1 }
  }
  const delivery = (await res.json().catch(() => null))?.delivery ?? null
  if (json) console.log(JSON.stringify({ backend: client.origin, site, id: post.uuid, short: id, delivery }))
  else say.ok(`Post ${id} is a draft again, its time kept (${post.data?.send_at ?? 'none'}): uniweb promote send ${id} schedules it again.`)
  return { exitCode: 0 }
}

/**
 * What starting (or resuming) a campaign in these ad accounts will spend, as far as the draft
 * says: its dates, and per account the ad groups whose ads run there, with their daily budgets
 * and the most that comes to. The currency is the account's, which the network knows.
 */
function spendSummary(index, campaign, accounts, { connections, pages }) {
  const starts = campaign.data?.starts ?? null
  const ends = campaign.data?.ends ?? null
  const days = starts && ends ? Math.round((Date.parse(ends) - Date.parse(starts)) / 86400000) + 1 : null
  return {
    name: campaign.data?.name ?? null,
    starts,
    ends,
    days: Number.isFinite(days) && days > 0 ? days : null,
    accounts: accounts.map((via) => {
      const groups = index
        .children('campaigns/ad_groups', campaign.uuid)
        .map((g) => ({ g, ads: index.children('campaigns/ad_groups/ads', g.uuid).filter((a) => a.data?.via === via) }))
        .filter((x) => x.ads.length)
      const daily = sumAmounts(groups.map((x) => x.g.data?.daily_budget))
      const total = daily !== null && Number.isFinite(days) && days > 0 ? (Math.round(Number(daily) * 100) * days / 100).toFixed(2) : null
      return {
        via,
        account: accountName(index, via, connections),
        groups: groups.map((x) => ({ name: x.g.data?.name ?? null, daily_budget: x.g.data?.daily_budget ?? null, ads: x.ads.length })),
        daily,
        upTo: total,
        pages: [...new Set(groups.flatMap((x) => x.ads.map((a) => pageRoute(a.data?.page, pages) ?? '(no page)')))]
      }
    })
  }
}

function printSummary(summary, act) {
  const dates = summary.starts || summary.ends
    ? `${summary.starts ?? 'now'} – ${summary.ends ?? 'until paused'}${summary.days ? `, ${summary.days} day${summary.days === 1 ? '' : 's'}` : ''}`
    : 'no dates: it runs from now until paused'
  console.log(`${act === 'start' ? 'Starting' : 'Resuming'} “${summary.name ?? '?'}”, ${dates}, in the owner's ad account${summary.accounts.length === 1 ? '' : 's'}:`)
  for (const a of summary.accounts) {
    if (!a.groups.length) {
      console.log(`  ${a.account}: no ad runs there yet`)
      continue
    }
    const budgets = a.groups.map((g) => (g.daily_budget == null ? 'no daily budget' : money(g.daily_budget))).join(' + ')
    console.log(`  ${a.account}: ${a.groups.length} ad group${a.groups.length === 1 ? '' : 's'}, ${budgets} a day in the account's currency${a.upTo ? ` — up to ${a.upTo}` : summary.ends ? '' : ', until paused'}`)
    const ads = a.groups.reduce((n, g) => n + g.ads, 0)
    console.log(`    ${ads} ad${ads === 1 ? '' : 's'}, linking to ${a.pages.join(', ')}`)
  }
}

/** A campaign's deliveries, said: where it runs, where it waits, and why. */
function sayDeliveries(index, deliveries, connections, act) {
  let running = 0
  for (const d of deliveries) {
    const account = accountName(index, d.via, connections)
    if (d.status === 'active') {
      running++
      say.ok(`Running in ${account}${d.review ? `, the network's review: ${reviewWords(d.review)}` : ''}${d.currency ? `, spending in ${d.currency}` : ''}`)
    } else if (d.status === 'paused') {
      say.ok(`Paused in ${account}${d.reason ? ` — ${reasonWords(d.reason)}` : ''}`)
    } else {
      say.warn(`${d.status === 'attention' ? 'Not running' : d.status} in ${account}${d.reason ? `: ${reasonWords(d.reason)}` : ''}${d.detail ? ` — ${d.detail}` : ''}`)
    }
  }
  if (act === 'start' && running) say.dim('What runs in an account is fixed there now: a change is a new ad account in its `via`, or a new campaign.')
  return deliveries.length && !running && act !== 'pause' ? 1 : 0
}

/**
 * `uniweb promote start | resume <campaign> [--yes]` — spend in the owner's ad accounts.
 *
 * ⭐ IT SAYS WHAT IT WILL SPEND, THEN ASKS [Diego, 2026-11-16: "if you thing we need confirmation,
 * it can be done, with `--yes` as a way to skip it"]. At a terminal it asks; `--yes` answers, as an
 * agent passes it once its person has agreed; with neither it refuses rather than spend unseen.
 */
async function spend(args, act) {
  const json = args.includes('--json')
  const arg = positionals(args)[1]
  if (!arg) {
    say.err(`Name the campaign: uniweb promote ${act} <campaign> [--yes]`)
    return { exitCode: 2 }
  }
  const at = await begin(args, act === 'start' ? 'Starting a campaign' : 'Resuming a campaign', `${act} ${arg}`)
  if (!at.client) return at
  const { client, site } = at
  const index = await readIndex(client, site)
  if (!index) return { exitCode: 1 }
  const campaign = pick(index, arg, ['campaign'])
  if (!campaign) return { exitCode: 2 }
  const deliveries = campaignDeliveries(index, campaign)
  const via = Array.isArray(campaign.data?.via) ? campaign.data.via : []
  const accounts =
    act === 'start'
      ? via.filter((u) => !deliveries.some((d) => d.via === u && d.external_id))
      : deliveries.filter((d) => d.external_id && d.status === 'paused').map((d) => d.via)
  const name = labelOf(index, campaign)
  if (!accounts.length) {
    const why =
      act === 'resume'
        ? `${name} is paused nowhere.`
        : via.length
          ? `${name} runs in every ad account of its \`via\` already.`
          : `${name} names no ad account yet — give it one in its \`via\`: uniweb promote campaign <file>`
    if (json) console.log(JSON.stringify({ backend: client.origin, site, id: campaign.uuid, act, accounts: [], deliveries }))
    else say.info(why)
    return { exitCode: act === 'start' && !via.length ? 2 : 0 }
  }
  const [connections, pages] = await Promise.all([listedConnections(client), readPages(client, site)])
  const summary = spendSummary(index, campaign, accounts, { connections, pages })
  if (!json) printSummary(summary, act)
  // What the campaign's pages show and what its networks will hear, before anything is spent.
  const landing = landingOf(index, campaign, pages)
  const dir = !json && landing.routes.length ? await siteFilesFor(site, client.origin) : null
  if (dir) await landingNotes(dir, landing.routes, { networks: landing.networks, goal: landing.goal })

  if (!args.includes('--yes')) {
    if (json || isNonInteractive(args)) {
      say.err(`\`uniweb promote ${act}\` spends in the owner's ad accounts, so it asks first — pass --yes once your person has agreed to what it will spend.`)
      return { exitCode: 2 }
    }
    if (!(await confirm(`${act === 'start' ? 'Start' : 'Resume'} it?`, false))) {
      say.info(`Cancelled — nothing ${act === 'start' ? 'started' : 'resumed'}.`)
      return { exitCode: 0 }
    }
  }
  const res = await client.campaignAction(site, campaign.uuid, act)
  if (!res.ok) {
    await sayRefusal(res, { site, origin: client.origin, what: `${act} campaigns`, index })
    return { exitCode: 1 }
  }
  const answered = (await res.json().catch(() => null))?.deliveries ?? []
  if (json) {
    console.log(JSON.stringify({ backend: client.origin, site, id: campaign.uuid, act, summary, deliveries: answered }))
    return { exitCode: answered.length && !answered.some((d) => d.status === 'active') ? 1 : 0 }
  }
  return { exitCode: sayDeliveries(index, answered, connections, act) }
}

/** `uniweb promote pause <campaign>` — wherever it runs. It stops the spending and asks nothing. */
async function pause(args) {
  const json = args.includes('--json')
  const arg = positionals(args)[1]
  if (!arg) {
    say.err('Name the campaign: uniweb promote pause <campaign>')
    return { exitCode: 2 }
  }
  const at = await begin(args, 'Pausing a campaign', `pause ${arg}`)
  if (!at.client) return at
  const { client, site } = at
  const index = await readIndex(client, site)
  if (!index) return { exitCode: 1 }
  const campaign = pick(index, arg, ['campaign'])
  if (!campaign) return { exitCode: 2 }
  if (!campaignDeliveries(index, campaign).some((d) => d.external_id && d.status !== 'paused')) {
    if (json) console.log(JSON.stringify({ backend: client.origin, site, id: campaign.uuid, act: 'pause', deliveries: campaignDeliveries(index, campaign) }))
    else say.info(`${labelOf(index, campaign)} runs nowhere: nothing to pause.`)
    return { exitCode: 0 }
  }
  const res = await client.campaignAction(site, campaign.uuid, 'pause')
  if (!res.ok) {
    await sayRefusal(res, { site, origin: client.origin, what: 'pause campaigns', index })
    return { exitCode: 1 }
  }
  const answered = (await res.json().catch(() => null))?.deliveries ?? []
  if (json) {
    console.log(JSON.stringify({ backend: client.origin, site, id: campaign.uuid, act: 'pause', deliveries: answered }))
    return { exitCode: 0 }
  }
  const connections = await listedConnections(client)
  return { exitCode: sayDeliveries(index, answered, connections, 'pause') }
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
    if (sub === 'post' || sub === 'campaign') return await writeDraft(args, sub)
    if (sub === 'show') return await show(args)
    if (sub === 'delete') return await deleteItem(args)
    if (sub === 'send') return await send(args)
    if (sub === 'unschedule') return await unschedule(args)
    if (sub === 'start' || sub === 'resume') return await spend(args, sub)
    if (sub === 'pause') return await pause(args)
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
