/**
 * What `uniweb dev` asks the backend before previewing a site whose foundation is a catalog ref —
 * every clone.
 *
 * Such a site has no build of its foundation, and a build does not turn a ref into a URL: where a
 * version is served is the backend's to say. So the dev server is handed the backend's answer, read
 * for it here through the site — the route push and pull read the version's section types from
 * (`client.readRegisteredFoundation`) — and passed on in `UNIWEB_PREVIEW` (`@uniweb/build/site`'s
 * `preview.js` has the contract). The backend it names is also where the site's kept media URLs are
 * fetched from.
 *
 * ⛔ Nothing here is kept. The answer lives as long as the dev server: `site.yml` keeps the ref, and
 * no file a push or pull reads gets the URL — the round trip never sees it.
 *
 * ⚠️ It may not be known. Whether a backend tells the CLI where a version is served is the backend's
 * to decide, and may change, so an answer without a location is an ordinary outcome: the preview
 * says so and does not start. Nothing else reads it — push, pull and publish work without it.
 */
import { readBackendState, parseCatalogRef } from '@uniweb/build/uwx'
import { BackendClient } from './client.js'
import { resolveWorkspace } from './workspace.js'
import { readDeclaredFoundation } from '../utils/install-integrity.js'
import { syncedBackends } from '../utils/site-identity.js'

/**
 * What the dev server of `siteDir` is handed, when its foundation is a catalog ref.
 *
 * @param {object} p
 * @param {string} p.siteDir
 * @param {string[]} [p.args]
 * @param {BackendClient} [p.client] - injected in tests
 * @returns {Promise<null
 *   | { preview: { backend: string, foundation: { ref: string, url: string, cssUrl: string|null } } }
 *   | { refused: string[] }>}
 *   null when there is nothing to ask — the foundation is not a catalog ref
 */
export async function readSitePreview({ siteDir, args = [], client = null }) {
  const ref = readDeclaredFoundation(siteDir)
  if (!parseCatalogRef(ref)) return null

  client = client || new BackendClient({ args, command: 'Previewing' })
  const uuid = readBackendState(siteDir, client.origin).site?.uuid
  if (!uuid) {
    const known = syncedBackends(siteDir)
    return {
      refused: [
        `This site's foundation is ${ref}, and the backend the site is on says where that version is served.`,
        known.length
          ? `The site is on ${known.join(', ')} — not on ${client.origin}, the backend you are logged in to. To preview it: uniweb login --backend <url>`
          : `The site is on no backend yet: \`uniweb push\` puts it on ${client.origin}.`
      ]
    }
  }

  const ws = await resolveWorkspace({ client, args })
  if (ws.refused) return { refused: ['A preview reads the site in one workspace, and none is chosen.', ws.reason] }
  client.setWorkspace(ws.workspace, { source: ws.source })

  const reply = await client.readRegisteredFoundation(uuid, ref)
  const url = typeof reply?.module_url === 'string' && reply.module_url ? reply.module_url : null
  if (!url) {
    return {
      refused: [
        reply
          ? `${client.origin} did not say where ${ref} is served, so this site cannot be previewed here.`
          : `Could not read ${ref} through this site on ${client.origin}, so this site cannot be previewed here.`,
        'Push, pull and publish do not need it.'
      ]
    }
  }
  return {
    preview: {
      backend: client.origin,
      foundation: { ref, url, cssUrl: typeof reply.css_url === 'string' && reply.css_url ? reply.css_url : null }
    }
  }
}
