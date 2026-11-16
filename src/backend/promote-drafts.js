/**
 * Drafts for `uniweb promote`: a post or a campaign as an agent writes it in a file, and the batch
 * that makes the backend's copy say it.
 *
 * ⭐ THE BACKEND HOLDS THE ONLY COPY, AND A FILE IS ONE CLIENT'S DRAFT OF IT. A draft names what it
 * was read at: each unit's `id` and `version`. A unit is an item with the parts of its body — a post
 * and its parts, an ad and its parts, a campaign, an ad group — so its version covers them together.
 * A unit changed since (in the app, or by another run) is refused, never written over: whoever wrote
 * last reads it again (`uniweb promote show`), as the app's own editor does on a stale write.
 *
 * ⭐ NOTHING IS DELETED BY LEAVING IT OUT. An ad group or an ad the file doesn't hold is kept, since
 * it may be the person's, added in the app after the agent read the campaign; `uniweb promote
 * delete` deletes. A post's or an ad's parts are its body, read at its version, so the body the file
 * gives is the body it gets.
 *
 * ⭐ THE CLI TRANSLATES ONLY WHAT THE FILES NAME DIFFERENTLY: a page by its route, an account by its
 * network, a picture by its file. Every other field is the backend's, carried as it reads, so a field
 * the Model adds reaches the agent with no CLI release, and an update carries back what it doesn't
 * edit (an update replaces the item's data).
 *
 * Pure: the command reads, uploads and writes; this module decides.
 */

import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import {
  buildRouteOf,
  documentSourceLocale,
  editYamlText,
  pageRefIndex,
  setYamlKeyFirst
} from '@uniweb/build/uwx'

/** How the build reads YAML: no implicit timestamp, so `starts: 2026-12-01` stays the text written. */
export const YAML_READ = Object.freeze({ schema: yaml.CORE_SCHEMA.extend({ implicit: [yaml.types.merge] }) })
/** How it is written: one line per value, and a string that reads as another type quoted. */
const YAML_WRITE = Object.freeze({ lineWidth: -1, quotingType: "'", noRefs: true })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// ── The promotion, indexed ─────────────────────────────────────────────────────────

/** The sections a command names an item in, and what it calls each. */
const KINDS = {
  posts: 'post',
  campaigns: 'campaign',
  'campaigns/ad_groups': 'ad group',
  'campaigns/ad_groups/ads': 'ad',
  networks: 'account'
}

/**
 * A promotion as the backend read it (`{ uuid, items }`), indexed: each item by uuid, and the
 * items of a section under a parent, in the order the read gives them.
 *
 * @param {{ uuid?: string, items?: object[] } | null} promotion
 */
export function indexPromotion(promotion) {
  const items = Array.isArray(promotion?.items) ? promotion.items.filter((i) => i && typeof i.uuid === 'string') : []
  const byUuid = new Map(items.map((i) => [i.uuid, i]))
  return {
    uuid: promotion?.uuid ?? null,
    items,
    byUuid,
    top: (section) => items.filter((i) => i.section === section),
    children: (section, parent) => items.filter((i) => i.section === section && i.parent === parent),
    child: (section, parent) => items.find((i) => i.section === section && i.parent === parent) ?? null
  }
}

/** What a command calls an item: `post`, `campaign`, `ad group`, `ad`, `account`, or null. */
export function kindOf(item) {
  return KINDS[item?.section] ?? null
}

/** The items a unit's version covers: the item, and the parts of its body where it has them. */
export function unitItems(index, item) {
  if (item?.section === 'posts') return [item, ...index.children('posts/parts', item.uuid)]
  if (item?.section === 'campaigns/ad_groups/ads') return [item, ...index.children('campaigns/ad_groups/ads/parts', item.uuid)]
  return item ? [item] : []
}

/**
 * A unit's version: the same while none of its items is made, changed or removed. Backend's own
 * children (a delivery) are not in it, as they never stale a draft in the app either. It leads with
 * a letter, so YAML reads it back as the same string.
 */
export function unitVersion(items) {
  const lines = items.filter(Boolean).map((i) => `${i.uuid}@${i.updated_at ?? ''}`).sort()
  return `v${createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12)}`
}

export function versionOf(index, item) {
  return unitVersion(unitItems(index, item))
}

/**
 * Short ids, as git shortens a hash: the shortest END of each uuid, at least `min` characters,
 * that no other uuid ends with. The end, since a uuid made by the backend leads with the time it
 * was made, so two made in the same minute share their first characters.
 *
 * @param {string[]} uuids
 * @returns {Map<string, string>}
 */
export function shortIds(uuids, min = 4) {
  const hex = [...new Set(uuids.filter(Boolean))].map((u) => [u, String(u).replace(/-/g, '').toLowerCase()])
  const out = new Map()
  for (const [u, h] of hex) {
    let n = Math.min(min, h.length)
    while (n < h.length && hex.some(([v, g]) => v !== u && g.endsWith(h.slice(-n)))) n++
    out.set(u, h.slice(-n))
  }
  return out
}

/** Whether `ref` names `uuid`: the whole of it, or its end. */
export function idMatches(uuid, ref) {
  if (typeof uuid !== 'string' || typeof ref !== 'string' || !ref) return false
  const want = ref.replace(/-/g, '').toLowerCase()
  return uuid.toLowerCase() === ref.toLowerCase() || (want.length >= 2 && uuid.replace(/-/g, '').toLowerCase().endsWith(want))
}

/**
 * The item a command names: a uuid or its end, or a campaign by its name.
 *
 * @returns {{ item: object } | { none: true } | { many: object[] }}
 */
export function findItem(index, ref, { kinds = ['post', 'campaign', 'ad group', 'ad'] } = {}) {
  const pool = index.items.filter((i) => kinds.includes(kindOf(i)))
  const exact = pool.find((i) => i.uuid.toLowerCase() === String(ref).toLowerCase())
  if (exact) return { item: exact }
  const byEnd = pool.filter((i) => idMatches(i.uuid, String(ref)))
  const byName = kinds.includes('campaign')
    ? pool.filter((i) => i.section === 'campaigns' && typeof i.data?.name === 'string' && i.data.name.toLowerCase() === String(ref).toLowerCase())
    : []
  const found = [...new Set([...byEnd, ...byName])]
  if (found.length === 1) return { item: found[0] }
  return found.length ? { many: found } : { none: true }
}

/** The campaign an ad group or an ad belongs to, or the campaign itself. */
export function campaignOf(index, item) {
  let at = item
  while (at && at.section !== 'campaigns') at = index.byUuid.get(at.parent)
  return at ?? null
}

/** A post's or an ad's state: its delivery's status, or `draft` while it has none. */
export function deliveryOf(index, item) {
  if (item?.section === 'posts') return index.child('posts/delivery', item.uuid)?.data ?? null
  if (item?.section === 'campaigns/ad_groups/ads') return index.child('campaigns/ad_groups/ads/delivery', item.uuid)?.data ?? null
  return null
}

/** A campaign's deliveries, one per ad account it has been started in. */
export function campaignDeliveries(index, campaign) {
  return index.children('campaigns/delivery', campaign.uuid).map((d) => d.data).filter(Boolean)
}

/** A post went out, so it is not edited: published, or with a network's review. */
export function wentOut(delivery) {
  return ['published', 'review', 'refused'].includes(delivery?.status)
}

// ── The input ──────────────────────────────────────────────────────────────────────

const FRONT = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/
const PART_BREAK = /^---[ \t]*$/
const PICTURE_LINE = /^!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)$/

/** The keys of each unit that are its structure rather than its fields. */
const STRUCTURE = {
  post: ['id', 'version', 'text', 'pictures', 'parts'],
  campaign: ['id', 'version', 'ad_groups'],
  'ad group': ['id', 'version', 'ads'],
  ad: ['id', 'version', 'text', 'pictures', 'parts']
}
/** Backend's, read and never written: what `status --json` or `show --json` carry beside a draft. */
const BACKENDS = ['delivery', 'deliveries', 'reading', 'state', 'started', 'spend', 'uuid', 'updated_at', 'tag', 'short']

/** The format of an input: by its file's extension, else by what it holds. */
export function formatOf(file, text) {
  const ext = /\.([a-z]+)$/i.exec(file || '')?.[1]?.toLowerCase()
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'yml' || ext === 'yaml') return 'yaml'
  if (ext === 'json') return 'json'
  const t = String(text ?? '').trimStart()
  if (t.startsWith('{')) return 'json'
  return FRONT.test(String(text ?? '')) ? 'markdown' : 'yaml'
}

/** A Markdown file's frontmatter and body. */
export function splitFrontmatter(text) {
  const m = FRONT.exec(text)
  if (!m) return { front: null, body: text }
  return { front: m[1] ?? '', body: text.slice(m[0].length) }
}

/** A post's parts from a Markdown body: a `---` line between parts, a picture alone on its line. */
function partsFromBody(body) {
  const parts = []
  let lines = []
  const flush = () => {
    const pictures = []
    const text = []
    for (const line of lines) {
      const picture = PICTURE_LINE.exec(line.trim())
      if (picture) pictures.push(picture[1])
      else text.push(line)
    }
    const words = text.join('\n').trim()
    if (words || pictures.length) parts.push({ text: words, pictures })
    lines = []
  }
  for (const line of String(body).split(/\r?\n/)) {
    if (PART_BREAK.test(line)) flush()
    else lines.push(line)
  }
  flush()
  return parts
}

function fieldsOf(obj, kind) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!STRUCTURE[kind].includes(k) && !BACKENDS.includes(k)) out[k] = v
  }
  return out
}

function partOf(p, where) {
  if (typeof p === 'string') return { part: { text: p.trimEnd(), pictures: [] } }
  if (!isPlainObject(p)) return { error: `${where}: a part is { text, pictures }` }
  const text = p.text == null ? '' : p.text
  if (typeof text !== 'string') return { error: `${where}: \`text\` is text` }
  let pictures = p.pictures == null ? [] : p.pictures
  if (typeof pictures === 'string') pictures = [pictures]
  if (!Array.isArray(pictures) || pictures.some((x) => typeof x !== 'string' || !x)) {
    return { error: `${where}: \`pictures\` is a list of files or addresses` }
  }
  return { part: { text: text.trimEnd(), pictures } }
}

/** A unit's parts from an object: `text` and `pictures` for one, `parts` for several, null for none given. */
function partsOf(obj, where) {
  const hasParts = obj.parts !== undefined
  const hasOne = obj.text !== undefined || obj.pictures !== undefined
  if (hasParts && hasOne) return { error: `${where}: give its words as \`text\` and \`pictures\`, or as \`parts\`, not both` }
  if (hasParts) {
    if (!Array.isArray(obj.parts)) return { error: `${where}: \`parts\` is a list of { text, pictures }` }
    const parts = []
    for (const [i, p] of obj.parts.entries()) {
      const one = partOf(p, `${where}, part ${i + 1}`)
      if (one.error) return one
      parts.push(one.part)
    }
    return { parts }
  }
  if (hasOne) {
    const one = partOf(obj, where)
    return one.error ? one : { parts: [one.part] }
  }
  return { parts: null }
}

function identityOf(obj, where) {
  const id = obj.id == null ? null : obj.id
  const version = obj.version == null ? null : obj.version
  if (id !== null && typeof id !== 'string') return { error: `${where}: \`id\` is the id the CLI wrote` }
  if (version !== null && typeof version !== 'string') return { error: `${where}: \`version\` is the version the CLI wrote` }
  if (id && !version) return { error: `${where}: it names \`id\` without the \`version\` it was read at — start from \`uniweb promote show ${id}\`` }
  return { id, version }
}

function adOf(obj, where) {
  if (!isPlainObject(obj)) return { error: `${where}: an ad is a map of its fields` }
  const ident = identityOf(obj, where)
  if (ident.error) return ident
  const parts = partsOf(obj, where)
  if (parts.error) return parts
  return { ad: { ...ident, fields: fieldsOf(obj, 'ad'), parts: parts.parts } }
}

function adGroupOf(obj, where) {
  if (!isPlainObject(obj)) return { error: `${where}: an ad group is a map of its fields` }
  const ident = identityOf(obj, where)
  if (ident.error) return ident
  let ads = null
  if (obj.ads !== undefined) {
    if (!Array.isArray(obj.ads)) return { error: `${where}: \`ads\` is a list` }
    ads = []
    for (const [i, a] of obj.ads.entries()) {
      const one = adOf(a, `${where}, ad ${i + 1}`)
      if (one.error) return one
      ads.push(one.ad)
    }
  }
  return { group: { ...ident, fields: fieldsOf(obj, 'ad group'), ads } }
}

/**
 * A draft from its text.
 *
 * A post is Markdown — its frontmatter its fields, its body its text, a `---` line between the
 * parts of a thread, a picture alone on its line — or YAML or JSON, with `text` and `pictures`, or
 * `parts`. A campaign is YAML or JSON, its `ad_groups` and their `ads` nested in it.
 *
 * @param {string} text
 * @param {{ format: 'markdown'|'yaml'|'json', kind: 'post'|'campaign' }} opts
 * @returns {{ draft: object } | { error: string }}
 */
export function parseDraft(text, { format, kind }) {
  let obj
  let body = null
  if (format === 'markdown') {
    if (kind !== 'post') return { error: 'A campaign is YAML or JSON, with its ad groups and their ads nested in it.' }
    const split = splitFrontmatter(text)
    try {
      obj = split.front === null ? {} : (yaml.load(split.front, YAML_READ) ?? {})
    } catch (err) {
      return { error: `Its frontmatter is not YAML: ${err.message.split('\n')[0]}` }
    }
    body = split.body
  } else {
    try {
      obj = format === 'json' ? JSON.parse(text) : (yaml.load(text, YAML_READ) ?? {})
    } catch (err) {
      return { error: `It is not ${format === 'json' ? 'JSON' : 'YAML'}: ${err.message.split('\n')[0]}` }
    }
  }
  if (!isPlainObject(obj)) return { error: `A ${kind} is a map of its fields.` }

  const ident = identityOf(obj, `The ${kind}`)
  if (ident.error) return ident
  if (kind === 'post') {
    let parts
    const bodyParts = body === null ? [] : partsFromBody(body)
    if (bodyParts.length) {
      if (obj.text !== undefined || obj.parts !== undefined || obj.pictures !== undefined) {
        return { error: 'Its words are its body: leave `text`, `pictures` and `parts` out of the frontmatter.' }
      }
      parts = bodyParts
    } else {
      const given = partsOf(obj, 'The post')
      if (given.error) return given
      parts = given.parts
    }
    return { draft: { kind, ...ident, fields: fieldsOf(obj, 'post'), parts } }
  }

  let adGroups = null
  if (obj.ad_groups !== undefined) {
    if (!Array.isArray(obj.ad_groups)) return { error: '`ad_groups` is a list' }
    adGroups = []
    for (const [i, g] of obj.ad_groups.entries()) {
      const one = adGroupOf(g, `Ad group ${i + 1}`)
      if (one.error) return one
      adGroups.push(one.group)
    }
  }
  return { draft: { kind, ...ident, fields: fieldsOf(obj, 'campaign'), adGroups } }
}

/** Every picture a draft names, as written: the files among them are uploaded before it is written. */
export function picturesOf(draft) {
  const out = []
  const take = (parts) => {
    for (const p of parts ?? []) out.push(...p.pictures)
  }
  take(draft.parts)
  for (const g of draft.adGroups ?? []) for (const a of g.ads ?? []) take(a.parts)
  return [...new Set(out)]
}

/** Whether a picture is an address already, kept as written, rather than a file to upload. */
export function isAddress(picture) {
  return /^https?:\/\//i.test(picture)
}

// ── Pages, by their routes on the site as pushed ───────────────────────────────────

/**
 * The site's pages, from its document as the backend holds it: each page's item uuid, its stable
 * id and its route, by the build's rule (`buildRouteOf`), indexed as a `page:` link is read.
 *
 * @param {object} doc - the site's `@uniweb/site-content` document
 */
export function sitePages(doc) {
  const language = documentSourceLocale(doc)
  const list = []
  const walk = (records, parentRoute) => {
    for (const record of records || []) {
      if (!isPlainObject(record)) continue
      const route = buildRouteOf(record, parentRoute, language)
      list.push({
        uuid: typeof record.$uuid === 'string' ? record.$uuid : null,
        id: typeof record.stable_id === 'string' && record.stable_id ? record.stable_id : null,
        route,
        dynamic: record.is_dynamic === true
      })
      walk(record.$children, route)
    }
  }
  walk(doc?.pages, '/')
  return { language, list, index: pageRefIndex(list), byUuid: new Map(list.filter((p) => p.uuid).map((p) => [p.uuid, p])) }
}

/**
 * The page item a draft's `page` names: a route (`/holiday`), a `page:` link (`page:holiday`,
 * `page:/holiday`), or the page's item uuid as the backend stores it.
 *
 * @returns {{ uuid: string|null, route?: string } | { error: string }}
 */
export function resolvePage(raw, pages, where = 'The draft') {
  if (raw === null || raw === undefined || raw === '') return { uuid: null }
  if (typeof raw !== 'string') return { error: `${where}: \`page\` is the page's route, such as /holiday` }
  if (UUID.test(raw)) return { uuid: raw, route: pages?.byUuid.get(raw)?.route }
  const target = raw.startsWith('page:') ? raw.slice('page:'.length) : raw
  if (target.includes('#')) return { error: `${where}: a post or an ad links to a page, not to a place on it — \`page: ${raw.split('#')[0]}\`` }
  const page = pages?.index.resolve(target)
  if (!page?.uuid) {
    return { error: `${where}: the site as pushed has no page ${raw}. Push it first (uniweb push), or name a page it has.` }
  }
  if (page.dynamic) {
    return { error: `${where}: ${page.route} is a template for many pages, and a post or an ad links to one page.` }
  }
  return { uuid: page.uuid, route: page.route }
}

/** A page's route for a file: `/holiday`, or the uuid as stored when the site no longer has it. */
export function pageRoute(uuid, pages) {
  if (!uuid) return null
  return pages?.byUuid.get(uuid)?.route ?? uuid
}

// ── Accounts: a draft's `via` ──────────────────────────────────────────────────────

/**
 * A `networks` item's connection, as a read gives it: an entity reference, `{ model, entity, brief }`,
 * the connection's uuid its `entity` and its card's words in its `brief` — or the uuid alone, as a
 * write gives it.
 *
 * @returns {{ uuid: string|null, name: string|null, handle: string|null, state: string|null }}
 */
export function connectionOf(value) {
  if (typeof value === 'string') return { uuid: value, name: null, handle: null, state: null }
  if (!isPlainObject(value)) return { uuid: null, name: null, handle: null, state: null }
  const brief = isPlainObject(value.brief) ? value.brief : {}
  return {
    uuid: typeof value.entity === 'string' ? value.entity : typeof value.uuid === 'string' ? value.uuid : null,
    name: brief.name ?? null,
    handle: brief.handle ?? null,
    state: brief.state ?? null
  }
}

/**
 * Resolves a draft's `via` to the site's `networks` item for that network and use — and, where the
 * site has none, makes one in the same batch, as the app does the first time a site uses a network,
 * through the one account of that network the caller can use.
 *
 * `via` is a network (`x`), `{ network, connection }` to choose among the caller's accounts there,
 * or a `networks` item's id.
 *
 * @param {{ networks: object[], connections: object[]|null, mint: () => string }} ctx
 */
export function viaResolver({ networks, connections, mint }) {
  const made = new Map()
  const all = () => [...networks, ...[...made.values()].map((op) => ({ uuid: op.uuid, data: op.data }))]
  const connectionIds = shortIds((connections ?? []).map((k) => k?.uuid))
  const describe = (k) => `${connectionIds.get(k.uuid) ?? k.uuid} (“${k.card?.name || k.card?.handle || k.uuid}”${k.card?.state && k.card.state !== 'connected' ? `, ${k.card.state}` : ''})`

  function make(network, connection, use, where) {
    if (connections === null) return { error: `${where}: the site has no ${use} account on ${network} yet, and your connections could not be listed.` }
    const reach = connections.filter((k) => k?.card?.network === network)
    let chosen
    if (connection) {
      const named = reach.filter((k) => idMatches(k.uuid, connection))
      if (named.length !== 1) {
        return { error: `${where}: you reach no ${network} account ${connection}${reach.length ? ` — you reach ${reach.map(describe).join(', ')}` : ''}.` }
      }
      chosen = named[0]
    } else {
      const usable = reach.filter((k) => k.card?.state === 'connected')
      if (usable.length > 1) {
        return { error: `${where}: you reach ${usable.length} accounts on ${network} — choose one: \`via: { network: ${network}, connection: <id> }\`, from ${usable.map(describe).join(', ')}.` }
      }
      if (!usable.length && !reach.length) {
        return { error: `${where}: no ${network} account is connected that you can use. The person connects one: uniweb promote connect ${network}`, connect: network }
      }
      chosen = usable[0] ?? reach[0]
    }
    if (chosen.card?.state !== 'connected') {
      return {
        error: chosen.card?.state === 'stopped'
          ? `${where}: the ${network} account ${describe(chosen)} stopped: its person left the workspace. An admin hands it on, in the app.`
          : `${where}: the ${network} account ${describe(chosen)} needs reconnecting, by its person, in the app.`
      }
    }
    const key = `${use}\u0000${network}\u0000${chosen.uuid}`
    if (!made.has(key)) made.set(key, { kind: 'create', section: 'networks', uuid: mint(), data: { network, use, connection: chosen.uuid } })
    return { uuid: made.get(key).uuid }
  }

  function resolve(raw, use, where) {
    if (raw === undefined || raw === null || raw === '') return { error: `${where}: name the network it goes out on — \`via: x\`, say` }
    const ofUse = all().filter((n) => n.data?.use === use)
    if (typeof raw === 'string') {
      const byId = ofUse.filter((n) => idMatches(n.uuid, raw))
      if (byId.length === 1) return { uuid: byId[0].uuid }
      const same = ofUse.filter((n) => n.data?.network === raw)
      if (same.length === 1) return { uuid: same[0].uuid }
      if (same.length > 1) {
        const ids = shortIds(networks.map((n) => n.uuid))
        const named = (n) => n.data?.target?.name ?? connectionOf(n.data?.connection).name ?? '?'
        return { error: `${where}: the site goes out on ${raw} through ${same.length} accounts — name one by its id: ${same.map((n) => `${ids.get(n.uuid) ?? n.uuid} (“${named(n)}”)`).join(', ')}.` }
      }
      return make(raw, null, use, where)
    }
    if (isPlainObject(raw) && typeof raw.network === 'string' && raw.network) {
      const connection = raw.connection == null ? null : String(raw.connection)
      if (!connection) return resolve(raw.network, use, where)
      const same = ofUse.filter((n) => n.data?.network === raw.network && idMatches(connectionOf(n.data?.connection).uuid, connection))
      if (same.length === 1) return { uuid: same[0].uuid }
      return make(raw.network, connection, use, where)
    }
    return { error: `${where}: \`via\` is a network, such as x, or { network, connection }` }
  }

  return { resolve, creates: () => [...made.values()] }
}

/**
 * A `networks` item's name in a file: its network, where the site has one item of that use there,
 * else its uuid.
 */
export function viaName(index, uuid) {
  const item = index.byUuid.get(uuid)
  if (!item || item.section !== 'networks') return uuid
  const same = index.top('networks').filter((n) => n.data?.use === item.data?.use && n.data?.network === item.data?.network)
  return same.length === 1 && item.data?.network ? item.data.network : uuid
}

// ── The write ──────────────────────────────────────────────────────────────────────

/** Two data values the same, whatever their key order. */
export function sameData(a, b) {
  const norm = (v) =>
    Array.isArray(v)
      ? v.map(norm)
      : isPlainObject(v)
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]))
        : v
  return JSON.stringify(norm(a ?? {})) === JSON.stringify(norm(b ?? {}))
}

/** An item's data: what it holds, with the fields the draft gives over it, and a `null` removing one. */
function merged(stored, fields) {
  const out = { ...(stored ?? {}) }
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    if (v === null) delete out[k]
    else out[k] = v
  }
  return out
}

function partData(stored, part) {
  const out = { ...(stored ?? {}) }
  if (part.text) out.text = part.text
  else delete out.text
  if (part.pictures.length) out.pictures = part.pictures
  else delete out.pictures
  return out
}

/** A body's parts, by position: each changed one updated, a new one added last, one past the end removed. */
function partOps(section, stored, parent, parts, mint) {
  if (parts === null) return []
  const ops = []
  for (let i = 0; i < Math.max(stored.length, parts.length); i++) {
    const s = stored[i]
    const p = parts[i]
    if (s && p) {
      const data = partData(s.data, p)
      if (!sameData(s.data, data)) ops.push({ kind: 'update', uuid: s.uuid, data, if_unmodified_since: s.updated_at })
    } else if (p) {
      ops.push({ kind: 'create', section, parent, uuid: mint(), data: partData(null, p), position: 'last' })
    } else {
      ops.push({ kind: 'delete', uuid: s.uuid, if_unmodified_since: s.updated_at })
    }
  }
  return ops
}

/**
 * Whether the units a draft names are still as it read them, and are its to write: each `id` an
 * item of the right kind, where the draft holds it, at its `version`; and a post not gone out.
 *
 * @returns {string[]} what refuses it, in words; empty when it may be written
 */
export function checkDraft(index, draft) {
  const problems = []
  const stale = (what, item) =>
    `${what} changed since your copy — in the app, or by another run. \`uniweb promote show ${shortIds(index.items.map((i) => i.uuid)).get(item.uuid) ?? item.uuid}\` prints it as it stands now; take your changes into that.`
  const unit = (want, d, what, parent) => {
    if (!d.id) return null
    const item = index.byUuid.get(d.id)
    if (!item || item.section !== want || (parent !== undefined && item.parent !== parent)) {
      problems.push(
        item && item.section === want
          ? `${what} ${d.id} is not in the ${want === 'campaigns/ad_groups' ? 'campaign' : 'ad group'} it is under in your file — it moves in the app.`
          : `${what} ${d.id} is not on this site — removed in the app? Drop its \`id\` and \`version\` to make it again.`
      )
      return null
    }
    if (versionOf(index, item) !== d.version) problems.push(stale(what, item))
    return item
  }
  if (draft.kind === 'post') {
    const post = unit('posts', draft, 'The post')
    if (post && wentOut(deliveryOf(index, post))) {
      problems.push('The post went out, so it isn\'t edited. Draft a new one: drop `id` and `version` from the file.')
    }
    return problems
  }
  const campaign = unit('campaigns', draft, 'The campaign')
  for (const [i, g] of (draft.adGroups ?? []).entries()) {
    const what = `Ad group ${i + 1}`
    let group = null
    if (g.id) {
      if (!draft.id) {
        problems.push(`${what} names an id, and the campaign none: a new campaign's ad groups are new too.`)
        continue
      }
      if (!campaign) continue
      group = unit('campaigns/ad_groups', g, what, campaign.uuid)
      if (!group) continue
    }
    for (const [j, a] of (g.ads ?? []).entries()) {
      if (!a.id) continue
      const adWhat = `Ad ${j + 1} of ad group ${i + 1}`
      if (!group) problems.push(`${adWhat} names an id, and its ad group none: a new ad group's ads are new too.`)
      else unit('campaigns/ad_groups/ads', a, adWhat, group.uuid)
    }
  }
  return problems
}

/**
 * The batch that makes the backend's post say what the draft says, its fields already in the
 * backend's terms (`via` and `page` as item uuids, pictures as addresses).
 *
 * @returns {{ ops: object[], uuid: string }}
 */
export function planPost(index, draft, { mint, language }) {
  const stored = draft.id ? index.byUuid.get(draft.id) : null
  const uuid = stored?.uuid ?? mint()
  const data = merged(stored?.data, draft.fields)
  if (!stored && data.language == null && language) data.language = language
  const ops = []
  if (!stored) ops.push({ kind: 'create', section: 'posts', uuid, data })
  else if (!sameData(stored.data, data)) ops.push({ kind: 'update', uuid, data, if_unmodified_since: stored.updated_at })
  ops.push(...partOps('posts/parts', stored ? index.children('posts/parts', uuid) : [], uuid, draft.parts, mint))
  return { ops, uuid }
}

/**
 * The batch for a campaign, with its ad groups and ads: each named one updated where it changed,
 * each new one made, and each the file leaves out kept and reported (`kept`).
 *
 * @returns {{ ops: object[], uuid: string, groups: Array<{ uuid: string, ads: string[] }>, kept: object[] }}
 */
export function planCampaign(index, draft, { mint, language }) {
  const stored = draft.id ? index.byUuid.get(draft.id) : null
  const uuid = stored?.uuid ?? mint()
  const ops = []
  const data = merged(stored?.data, draft.fields)
  if (!stored) ops.push({ kind: 'create', section: 'campaigns', uuid, data })
  else if (!sameData(stored.data, data)) ops.push({ kind: 'update', uuid, data, if_unmodified_since: stored.updated_at })

  const groups = []
  const kept = []
  if (draft.adGroups !== null) {
    const storedGroups = stored ? index.children('campaigns/ad_groups', uuid) : []
    const named = new Set()
    for (const g of draft.adGroups) {
      const sg = g.id ? storedGroups.find((x) => x.uuid === g.id) : null
      const gUuid = sg?.uuid ?? mint()
      named.add(gUuid)
      const gData = merged(sg?.data, g.fields)
      if (!sg) ops.push({ kind: 'create', section: 'campaigns/ad_groups', parent: uuid, uuid: gUuid, data: gData, position: 'last' })
      else if (!sameData(sg.data, gData)) ops.push({ kind: 'update', uuid: gUuid, data: gData, if_unmodified_since: sg.updated_at })
      const ads = []
      if (g.ads !== null) {
        const storedAds = sg ? index.children('campaigns/ad_groups/ads', gUuid) : []
        const namedAds = new Set()
        for (const a of g.ads) {
          const sa = a.id ? storedAds.find((x) => x.uuid === a.id) : null
          const aUuid = sa?.uuid ?? mint()
          namedAds.add(aUuid)
          ads.push(aUuid)
          const aData = merged(sa?.data, a.fields)
          if (!sa && aData.language == null && language) aData.language = language
          if (!sa) ops.push({ kind: 'create', section: 'campaigns/ad_groups/ads', parent: gUuid, uuid: aUuid, data: aData, position: 'last' })
          else if (!sameData(sa.data, aData)) ops.push({ kind: 'update', uuid: aUuid, data: aData, if_unmodified_since: sa.updated_at })
          ops.push(...partOps('campaigns/ad_groups/ads/parts', sa ? index.children('campaigns/ad_groups/ads/parts', aUuid) : [], aUuid, a.parts, mint))
        }
        for (const sa of storedAds) if (!namedAds.has(sa.uuid)) kept.push({ kind: 'ad', uuid: sa.uuid, name: sa.data?.headlines?.[0] ?? null, group: sg?.data?.name ?? null })
      }
      groups.push({ uuid: gUuid, ads })
    }
    for (const sg of storedGroups) if (!named.has(sg.uuid)) kept.push({ kind: 'ad group', uuid: sg.uuid, name: sg.data?.name ?? null })
  }
  return { ops, uuid, groups, kept }
}

// ── What `show` prints, and the ids a write leaves in the file ────────────────────

const POST_ORDER = ['via', 'language', 'page', 'send_at']
const CAMPAIGN_ORDER = ['name', 'goal', 'devices', 'starts', 'ends', 'via']
const GROUP_ORDER = ['name', 'daily_budget']
const AD_ORDER = ['via', 'language', 'page', 'headlines', 'descriptions']
const NOT_SHOWN = ['tag']

function ordered(data, order, translate) {
  const out = {}
  for (const k of order) if (data?.[k] !== undefined) out[k] = translate(k, data[k])
  for (const k of Object.keys(data ?? {}).sort()) {
    if (!order.includes(k) && !NOT_SHOWN.includes(k)) out[k] = data[k]
  }
  return out
}

function bodyOf(parts) {
  const list = parts.map((p) => ({ text: p.data?.text ?? '', pictures: Array.isArray(p.data?.pictures) ? p.data.pictures : [] }))
  return list
}

function withBody(shape, parts) {
  if (parts.length === 1) {
    if (parts[0].text) shape.text = parts[0].text
    if (parts[0].pictures.length) shape.pictures = parts[0].pictures
  } else if (parts.length > 1) {
    shape.parts = parts.map((p) => ({ ...(p.text ? { text: p.text } : {}), ...(p.pictures.length ? { pictures: p.pictures } : {}) }))
  }
  return shape
}

/**
 * A post as a draft holds it — `id`, `version`, its fields with `via` and `page` named as files
 * name them, and its parts — so `show` and `post` round-trip.
 */
export function postShape(index, post, pages) {
  const translate = (k, v) => (k === 'via' ? viaName(index, v) : k === 'page' ? pageRoute(v, pages) : v)
  return {
    id: post.uuid,
    version: versionOf(index, post),
    ...ordered(post.data, POST_ORDER, translate),
    parts: bodyOf(index.children('posts/parts', post.uuid))
  }
}

/** A campaign as a draft holds it, its ad groups and their ads nested in it. */
export function campaignShape(index, campaign, pages) {
  const translate = (k, v) =>
    k === 'via' ? (Array.isArray(v) ? v.map((u) => viaName(index, u)) : viaName(index, v)) : k === 'page' ? pageRoute(v, pages) : v
  const groups = index.children('campaigns/ad_groups', campaign.uuid).map((g) => ({
    id: g.uuid,
    version: versionOf(index, g),
    ...ordered(g.data, GROUP_ORDER, translate),
    ads: index.children('campaigns/ad_groups/ads', g.uuid).map((a) =>
      withBody(
        { id: a.uuid, version: versionOf(index, a), ...ordered(a.data, AD_ORDER, translate) },
        bodyOf(index.children('campaigns/ad_groups/ads/parts', a.uuid))
      )
    )
  }))
  return { id: campaign.uuid, version: versionOf(index, campaign), ...ordered(campaign.data, CAMPAIGN_ORDER, translate), ad_groups: groups }
}

/** Whether a post's parts can be written as a Markdown body, and read back the same. */
function markdownHolds(parts) {
  return parts.every(
    (p) => !p.text.split('\n').some((line) => PART_BREAK.test(line) || PICTURE_LINE.test(line.trim())) && p.pictures.every((a) => !/[\s)]/.test(a))
  )
}

/**
 * A post's shape as a Markdown file: its fields as frontmatter, its parts as the body. Null when
 * its words would not read back the same (a line of `---` in them, say); YAML holds it then.
 */
export function postMarkdown(shape) {
  const { parts, ...front } = shape
  if (!markdownHolds(parts)) return null
  const body = parts
    .map((p) => [p.text, ...p.pictures.map((a) => `![](${a})`)].filter(Boolean).join('\n\n'))
    .join('\n\n---\n\n')
  return `---\n${yaml.dump(front, YAML_WRITE)}---\n${body ? `\n${body}\n` : ''}`
}

/** A shape as YAML, for a campaign, or a post Markdown cannot hold. */
export function shapeYaml(shape) {
  if (Array.isArray(shape.parts)) return yaml.dump(withBody(Object.fromEntries(Object.entries(shape).filter(([k]) => k !== 'parts')), shape.parts), YAML_WRITE)
  return yaml.dump(shape, YAML_WRITE)
}

/** `{ id, version, ...rest }` — the identity a sync writes leads its map. */
function leading(obj, id, version) {
  const { id: _id, version: _version, ...rest } = obj
  return { id, version, ...rest }
}

/**
 * The draft's file once a write has landed: each unit it holds names its `id` and `version`, so the
 * next run updates the same draft, and a teammate with the file updates it too. Everything else in
 * the file is left as its author wrote it where the format allows (YAML's comments, a Markdown body).
 *
 * @param {string} text - the file as it was read
 * @param {{ format: string, kind: string }} input
 * @param {{ uuid: string, groups?: Array<{ uuid: string, ads: string[] }> }} map - the units the write
 *   made or named, in the file's order
 * @param {(uuid: string) => string} version - each unit's version after the write
 * @returns {{ text: string, whole?: boolean } | null} null when the file could not be read again
 */
export function fileWithIdentity(text, { format, kind }, map, version) {
  const nested = (obj) => {
    if (kind !== 'campaign' || !Array.isArray(obj.ad_groups) || !map.groups) return obj
    return {
      ...obj,
      ad_groups: obj.ad_groups.map((g, i) => {
        const gm = map.groups[i]
        if (!gm || !isPlainObject(g)) return g
        const ads = Array.isArray(g.ads) ? g.ads.map((a, j) => (gm.ads[j] && isPlainObject(a) ? leading(a, gm.ads[j], version(gm.ads[j])) : a)) : g.ads
        return leading(ads === undefined ? g : { ...g, ads }, gm.uuid, version(gm.uuid))
      })
    }
  }
  if (format === 'json') {
    let obj
    try {
      obj = JSON.parse(text)
    } catch {
      return null
    }
    return { text: `${JSON.stringify(leading(nested(obj), map.uuid, version(map.uuid)), null, 2)}\n` }
  }
  const lead = (yamlText) => {
    const withVersion = setYamlKeyFirst(yamlText, 'version', version(map.uuid))
    return withVersion === null ? null : setYamlKeyFirst(withVersion, 'id', map.uuid)
  }
  if (format === 'markdown') {
    const split = splitFrontmatter(text)
    if (split.front === null) {
      return { text: `---\n${yaml.dump({ id: map.uuid, version: version(map.uuid) }, YAML_WRITE)}---\n${text}` }
    }
    const front = lead(split.front === '' ? '' : `${split.front}\n`)
    if (front === null) return null
    return { text: `---\n${front.endsWith('\n') ? front : `${front}\n`}---\n${split.body}` }
  }
  let before
  try {
    before = yaml.load(text, YAML_READ) ?? {}
  } catch {
    return null
  }
  if (!isPlainObject(before)) return null
  const after = nested(before)
  const edited = after === before ? text : editYamlText(text, before, after)
  const done = edited === null ? null : lead(edited)
  if (done !== null) return { text: done }
  return { text: yaml.dump(leading(after, map.uuid, version(map.uuid)), YAML_WRITE), whole: true }
}

// ── What a network will hear ───────────────────────────────────────────────────────

/**
 * The site's services row a network's conversions go out through: the host sends X and Meta the
 * site's conversions from its servers, each name mapped to the network's event.
 */
const CONVERSION_ROWS = { x: 'x', facebook: 'meta' }

/**
 * What a network will hear of the site's conversions, from its `site.yml`: whether the site asks
 * for tracking, the conversions it lists, and — for a campaign that optimizes for conversions —
 * whether each network it runs on has them mapped to its events. Notes, never a gate: whoever sends
 * or starts decides, with them in front of them.
 *
 * @param {object|null} siteYml
 * @param {{ networks?: string[], goal?: string|null }} [opts] - the networks a draft goes out on;
 *   with no networks, each the site maps (`services.x`, `services.meta`)
 * @returns {Array<{ ok: boolean, id: string, text: string }>}
 */
export function conversionNotes(siteYml, { networks = null, goal = null } = {}) {
  const services = isPlainObject(siteYml?.services) ? siteYml.services : {}
  const tracking = services.tracking
  const on = tracking === true || (typeof tracking === 'string' && tracking !== '') || (isPlainObject(tracking) && tracking.enabled !== false)
  if (!on) {
    return [{ ok: false, id: 'tracking-off', text: 'site.yml does not ask for `services.tracking`, so the site reports no visit or conversion for a network to hear (`uniweb guide services`)' }]
  }
  const notes = []
  const listed = isPlainObject(tracking) && Array.isArray(tracking.conversions)
    ? tracking.conversions.map((c) => c?.name).filter((n) => typeof n === 'string' && n)
    : []
  notes.push(
    listed.length
      ? { ok: true, id: 'conversions-listed', text: `the site counts the conversion${listed.length === 1 ? '' : 's'} it lists: ${listed.join(', ')}` }
      : { ok: false, id: 'conversions-none', text: 'the site lists no conversion of its own in `services.tracking.conversions`: it counts phone and email taps, and what its foundation reports' }
  )
  if (goal !== 'conversions') return notes
  const asked = networks ?? Object.keys(CONVERSION_ROWS).filter((n) => services[CONVERSION_ROWS[n]])
  for (const network of [...new Set(asked)]) {
    const row = CONVERSION_ROWS[network]
    if (!row) continue
    const events = isPlainObject(services[row]?.events) ? Object.keys(services[row].events) : []
    if (!events.length) {
      notes.push({ ok: false, id: 'network-hears-none', text: `${network} hears none of the site's conversions: \`services.${row}\` maps none to its events, so a campaign there optimizes for clicks (\`uniweb guide services\`, X and Meta)` })
    } else {
      const unheard = listed.filter((n) => !events.includes(n))
      notes.push({ ok: true, id: 'network-hears', text: `${network} hears ${events.join(', ')}${unheard.length ? ` — not ${unheard.join(', ')}` : ''}` })
    }
  }
  return notes
}

/**
 * A draft's file with top-level fields set where they stand, editing nothing else: a post's new
 * `send_at` and `version` once `send --at` has moved its time, so the file still says what the
 * backend holds. Null when the file cannot be read again.
 *
 * @param {string} text
 * @param {'markdown'|'yaml'|'json'} format
 * @param {object} fields
 * @returns {string|null}
 */
export function fileWithFields(text, format, fields) {
  if (format === 'json') {
    try {
      return `${JSON.stringify({ ...JSON.parse(text), ...fields }, null, 2)}\n`
    } catch {
      return null
    }
  }
  const edit = (yamlText) => {
    let before
    try {
      before = yaml.load(yamlText, YAML_READ) ?? {}
    } catch {
      return null
    }
    return isPlainObject(before) ? editYamlText(yamlText, before, { ...before, ...fields }) : null
  }
  if (format === 'markdown') {
    const split = splitFrontmatter(text)
    if (split.front === null) return null
    const front = edit(split.front === '' ? '' : `${split.front}\n`)
    return front === null ? null : `---\n${front.endsWith('\n') ? front : `${front}\n`}---\n${split.body}`
  }
  return edit(text)
}
