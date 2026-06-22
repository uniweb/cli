/**
 * uniweb push — push a site to the backend over its two directional lanes:
 *   - content lane → `@uniweb/site-content` (the static half: pages, sections,
 *     layout, theme, foundation ref, extensions, collection decls);
 *   - folder lane → one `@uniweb/folder` + the collection-record entities it
 *     references (the dynamic half; the `$ref` closure rides together).
 *
 * Each entity is an entity-content document (`$id` + `$model` + sections). The site
 * holds exactly one identity: `site.yml::$uuid` (the site-content entity). A first
 * push has none — it CREATEs the site (uuid-less), the backend mints + adopts it
 * and returns the new uuid, which `push` records into `site.yml`. Later pushes
 * UPDATE by that uuid. The folder lane is keyed by the SAME site-content uuid —
 * the backend owns the site's `@uniweb/folder`, so the framework never holds a
 * folder uuid. Records still round-trip their own `$uuid`
 * (back-filled into their source files). site-content is pushed wholesale (no per-item
 * uuids on the wire). Push-only, last-push-wins (`collision=force`) in v1.
 *
 * Order: content first (CREATE or UPDATE — the site must exist before its folder),
 * then the folder, keyed by the site's uuid. On a brand-new site the backend creates
 * the folder on its first folder push for that uuid.
 *
 * `uniweb login && uniweb push`. Run from a site, or a workspace with one site.
 *
 * Usage:
 *   uniweb push                          Build, push both lanes, back-fill $uuid
 *   uniweb push --as-org @org            Act as @org (membership-gated)
 *   uniweb push --dry-run                Report what would be pushed; submit nothing
 *   uniweb push -o out.uwx               Write the .uwx file(s) per lane; submit nothing
 *   uniweb push --registry <url>         Override the backend origin
 *   uniweb push --token <bearer>         Submit with this bearer; skips `uniweb login`
 *   uniweb push --foundation <dir>       Use this local foundation for the Model schema
 *   uniweb push --all                    Send every record (bypass the changed-only cache)
 *
 * Backend: via BackendClient (the content + folder sync lanes). Origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default.
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 *
 * The two-lane SUBMISSION (POST both lanes, back-fill uuids, persist the
 * send-only-changed cache) lives in `../backend/site-sync.js` so `uniweb deploy`
 * (the composite path) reuses the exact same logic. This command owns flag parsing,
 * the emit, and the `-o`/`--dry-run` preview.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emitSyncPackages } from '@uniweb/build/uwx'
import { BackendClient } from '../backend/client.js'
import { resolveSiteDir } from './deploy.js'
import { makeModelResolver, readSyncCache, pushSyncPackages } from '../backend/site-sync.js'

// Re-exported for downstream importers (pull.js, push.test.js) that read these
// helpers from this module — their canonical home is now ../backend/site-sync.js.
export { extractMintedSiteUuid, makeModelResolver } from '../backend/site-sync.js'

const colors = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[36m',
}
const log = console.log
const success = (m) => log(`${colors.green}✓${colors.reset} ${m}`)
const error = (m) => console.error(`${colors.red}✗${colors.reset} ${m}`)
const info = (m) => log(`${colors.blue}→${colors.reset} ${m}`)
const note = (m) => log(`  ${colors.dim}${m}${colors.reset}`)

function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1]
  return null
}

export async function push(args = []) {
  const dryRun = args.includes('--dry-run')
  const output = flagValue(args, '-o') || flagValue(args, '--output')
  const tokenFlag = flagValue(args, '--token')
  const asOrg = flagValue(args, '--as-org')
  const foundationDir = flagValue(args, '--foundation')
  const sendAll = args.includes('--all') // bypass the send-only-changed cache
  // One front door. The bearer is resolved lazily on first need (a non-local Model
  // read during the build, or the submit). Offline emit (--dry-run / -o) is fully
  // offline: it never submits, and its Model resolver never reads from the backend
  // (the `offline` flag below), so it never authenticates — even when a collection
  // references a Model the local foundation doesn't define.
  const client = new BackendClient({
    originFlag: flagValue(args, '--registry'),
    token: tokenFlag,
    args,
    command: 'Syncing',
  })

  const siteDir = await resolveSiteDir(args, 'push')

  // Build BOTH directional packages (the producer side). Each carries its own
  // `index` — the per-entity source-file map for back-fill, correlated by submission
  // position. Non-local Models are fetched from the registry on demand. `priorHashes`
  // (the .uniweb push-cache) drives "send only changed" across both lanes; --all bypasses.
  const priorHashes = readSyncCache(siteDir)
  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, {
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel: makeModelResolver({ client, offline: Boolean(output) || dryRun }),
      priorHashes,
      sendAll,
    })
  } catch (err) {
    error(`Could not build the sync package: ${err.message}`)
    return { exitCode: 2 }
  }
  const { siteContent, collections, siteContentUuid, warnings, skipped } = pkg
  log('')
  for (const w of warnings) note(`! ${w}`)

  const totalEntities = (siteContent?.entityCount || 0) + (collections?.entityCount || 0)

  // Nothing changed since the last push — the backend is already up to date.
  if (totalEntities === 0) {
    success(`Nothing to push — ${skipped} entit${skipped === 1 ? 'y' : 'ies'} unchanged since the last push.`)
    return { exitCode: 0 }
  }
  if (siteContent) info(`${colors.bright}site-content${colors.reset} → ${siteContent.models.join(', ')}`)
  if (collections) {
    const n = collections.entityCount
    info(`${colors.bright}collections${colors.reset} (${n} entit${n === 1 ? 'y' : 'ies'}) → ${collections.models.join(', ')}`)
  }
  if (skipped) note(`${skipped} unchanged, skipped`)

  // Preview paths — no submit, no auth. Two lanes → up to two files / two routes.
  if (output) {
    const base = output.replace(/\.uwx$/, '')
    if (siteContent) writeFileSync(resolve(`${base}.site-content.uwx`), siteContent.buffer)
    if (collections) writeFileSync(resolve(`${base}.collections.uwx`), collections.buffer)
    const lanes = [siteContent && 'site-content', collections && 'collections'].filter(Boolean)
    success(`Wrote ${lanes.join(' + ')} .uwx — not submitted`)
    return { exitCode: 0 }
  }
  if (dryRun) {
    if (siteContent) {
      const verb = siteContentUuid ? 'update' : 'create'
      info(`Dry run — would ${verb} content at ${colors.dim}${client.origin}${colors.reset}`)
    }
    if (collections) {
      info(`Dry run — would push the folder at ${colors.dim}${client.origin}${colors.reset}`)
    }
    return { exitCode: 0 }
  }

  // Submit both lanes, back-fill the minted uuids, and persist the send-only-changed
  // cache. Shared with `uniweb deploy` via ../backend/site-sync.js.
  const result = await pushSyncPackages({
    client,
    siteDir,
    pkg,
    asOrg,
    report: { info, note, error, dim: (s) => `${colors.dim}${s}${colors.reset}` },
  })
  if (result.exitCode !== 0) return { exitCode: result.exitCode }
  success(
    `Pushed ${result.finalizedTotal} entit${result.finalizedTotal === 1 ? 'y' : 'ies'}` +
      (result.wrote.length ? ` — ${result.wrote.join(', ')}` : '')
  )
  return { exitCode: 0 }
}
