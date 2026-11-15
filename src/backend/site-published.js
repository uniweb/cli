/**
 * What `uniweb dev --published` reads before serving a working copy against the site as published.
 *
 * A published site's services — its own `backend`, its `records`, its forms — are answered by its
 * host, at addresses the host chooses and states in the page it serves. So this asks the backend you
 * are logged in to where the site is published (its status, the address `uniweb status` shows),
 * reads the published page, and takes the host's services block from the data the page boots from
 * (`__DATA__`, `content.config.services`). The dev server is handed it in `UNIWEB_PUBLISHED`
 * (`@uniweb/build/site`'s `published.js` has the contract) and answers each service by forwarding
 * to it.
 *
 * ⭐ Read, never composed: the addresses are the ones the published page carries, so whatever
 * serves the site — on this machine or not — is what the working copy talks to.
 *
 * ⛔ Nothing here is kept. The answer lives as long as the dev server, and no file a push, pull or
 * build reads gets an address from it.
 */
import { gunzipSync } from 'node:zlib'
import { readBackendState } from '@uniweb/build/uwx'
import { BackendClient } from './client.js'
import { resolveWorkspace } from './workspace.js'
import { liveAddress } from './live-address.js'
import { syncedBackends } from '../utils/site-identity.js'

/**
 * What the dev server of `siteDir` is handed under `--published`.
 *
 * @param {object} p
 * @param {string} p.siteDir
 * @param {string[]} [p.args]
 * @param {BackendClient} [p.client] - injected in tests
 * @param {typeof fetch} [p.fetchPage] - injected in tests
 * @returns {Promise<{ published: { site: string, backend: string, base: string|null, services: object } }
 *   | { refused: string[] }>}
 */
export async function readSitePublished({ siteDir, args = [], client = null, fetchPage = globalThis.fetch }) {
  client = client || new BackendClient({ args, command: 'Testing against' })
  const uuid = readBackendState(siteDir, client.origin).site?.uuid
  if (!uuid) {
    const known = syncedBackends(siteDir)
    return {
      refused: [
        '`--published` serves this copy against the site as published from the backend you are logged in to, and the site is not on it.',
        known.length
          ? `The site is on ${known.join(', ')}, not on ${client.origin}. To use it: uniweb login --server <url>`
          : `Publish it there first: uniweb publish`
      ]
    }
  }

  const ws = await resolveWorkspace({ client, args })
  if (ws.refused) return { refused: ['`--published` reads the site in one workspace, and none is chosen.', ws.reason] }
  client.setWorkspace(ws.workspace, { source: ws.source })

  let status
  try {
    status = await client.siteStatus(uuid)
  } catch (err) {
    return { refused: [err.message] }
  }
  if (!status) return { refused: [`Could not read this site's status on ${client.origin}, so its published address is unknown.`] }
  const address = liveAddress(status.visitor_url, status.last_published_url)
  if (status.published === false || !address) {
    return { refused: ['This site is not published, so it has no published services to test against.', 'Publish it first: uniweb publish'] }
  }

  let page
  try {
    page = await readPublishedPage(address, fetchPage)
  } catch (err) {
    return { refused: [`Could not read the site as published at ${address}: ${err.message}`] }
  }
  const config = page.data?.content?.config
  const services = config?.services
  if (!services || typeof services !== 'object' || Array.isArray(services)) {
    return {
      refused: [
        `The site as published at ${page.url} offers no services, so there is nothing to test against.`,
        'Without --published, uniweb dev answers them itself.'
      ]
    }
  }
  return {
    published: {
      site: page.url,
      backend: client.origin,
      base: typeof config.base === 'string' ? config.base : null,
      services
    }
  }
}

/**
 * The published page at `address`, and the data it boots from.
 *
 * @param {string} address
 * @param {typeof fetch} fetchPage
 * @returns {Promise<{ url: string, data: object }>} `url` is the page's address after redirects,
 *   which its own relative addresses are read against
 */
async function readPublishedPage(address, fetchPage) {
  const res = await fetchPage(address, { headers: { accept: 'text/html' }, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = readDataScript(await res.text())
  if (!data) throw new Error('the page carries no site data (`__DATA__`)')
  return { url: res.url || address, data }
}

/**
 * The boot data a host writes into a page's shell — `<script id="__DATA__">`, as JSON, or as
 * base64 gzip when its type says so (the runtime's `decodeData` reads both).
 *
 * @param {string} html
 * @returns {object|null}
 */
export function readDataScript(html) {
  for (const [, attributes, text] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bid\s*=\s*["']__DATA__["']/i.test(attributes)) continue
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? 'application/json'
    const body = text.trim()
    return type === 'application/json'
      ? JSON.parse(body)
      : JSON.parse(gunzipSync(Buffer.from(body, 'base64')).toString('utf8'))
  }
  return null
}

/**
 * Whether an address is on this machine — what decides if `uniweb dev --published` warns that
 * the data it works with is real.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isOnThisMachine(address) {
  try {
    const { hostname } = new URL(address)
    return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}
