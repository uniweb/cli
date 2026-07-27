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
 * (back-filled into their source files). site-content items carry a per-item `$uuid`
 * too, stamped at emit from the identity cache rather than from author files — without
 * it the backend reads every record as new and recreates every page and section row.
 * Push-only, and gated on the backend's per-entity `version`
 * (see "Pushes are GATED by default" below); `--force` restores last-push-wins.
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
 *   uniweb push --force                  Overwrite upstream changes (drop the staleness gate)
 *
 * Pushes are GATED by default: each entity carries the backend `version` this clone
 * last saw (a top-level `base_version` on the manifest entry), and the backend refuses the whole package
 * atomically — before any write — if its stored version has moved. That prevents a
 * developer who hasn't pulled from silently destroying an app author's edits (the
 * backend's reconcile deletes items absent from the package, so an author's NEW page
 * would be hard-deleted). `--force` omits the token and restores last-push-wins.
 *
 * Backend: via BackendClient (the content + folder sync lanes). Origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default.
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 *
 * The two-lane SUBMISSION (POST both lanes, back-fill uuids, persist the
 * send-only-changed cache) lives in `../backend/site-sync.js` so `uniweb publish`
 * (the composite path) reuses the exact same logic. This command owns flag parsing,
 * the emit, and the `-o`/`--dry-run` preview.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emitSyncPackages } from '@uniweb/build/uwx'
import { uploadSiteMedia, isStorageRefusal } from '../backend/site-media.js'
import { BackendClient } from '../backend/client.js'
import { resolveSiteDir, resolveSiteBackend } from './deploy.js'
import {
  makeModelResolver,
  readSyncCache,
  readBaseVersions,
  readItemBaseVersions,
  readItemUuids,
  ensureItemUuids,
  pushSyncPackages,
} from '../backend/site-sync.js'

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
  // --force drops the optimistic-concurrency precondition, making the push
  // unconditional (the backend then falls back to its `collision` policy). It is
  // deliberately NOT "send collision=force": when a base_version is present the
  // backend consults it and never looks at `collision`, so forcing has to mean
  // OMITTING the token — the HTTP If-Match idiom.
  const force = args.includes('--force')

  const siteDir = await resolveSiteDir(args, 'push')
  const siteBackend = await resolveSiteBackend(siteDir)
  // One front door. The bearer is resolved lazily on first need (a non-local Model
  // read during the build, or the submit). Offline emit (--dry-run / -o) is fully
  // offline: it never submits, and its Model resolver never reads from the backend
  // (the `offline` flag below), so it never authenticates — even when a collection
  // references a Model the local foundation doesn't define.
  const client = new BackendClient({
    originFlag: flagValue(args, '--backend') || flagValue(args, '--registry'),
    siteBackend,
    token: tokenFlag,
    args,
    command: 'Syncing',
  })

  // Build BOTH directional packages (the producer side). Each carries its own
  // `index` — the per-entity source-file map for back-fill, correlated by submission
  // position. Non-local Models are fetched from the registry on demand. `priorHashes`
  // (the .uniweb push-cache) drives "send only changed" across both lanes; --all bypasses.
  const priorHashes = readSyncCache(siteDir)
  // Per-item identity, without which the backend reads every record as new and
  // recreates every page and section row.
  //
  // An offline preview (`-o` / `--dry-run`) still stamps from the CACHE — that is a
  // local file read, so it stays offline, and it keeps the emitted `.uwx` faithful
  // to what a real push would send. Only the network RECOVERY is skipped, so a
  // preview never reaches the backend. (Emitting `{}` here instead would make the
  // preview quietly unrepresentative, which is the one thing `-o` exists to avoid.)
  // Local media rides the SAME asset lane `publish` uses, and it rides it FIRST.
  //
  // Push is the collaboration verb: a teammate opens the site in the visual app
  // right after it. Content that still points at `/images/hero.png` — bytes the
  // backend never received — shows them a broken image, which is precisely what
  // push exists to avoid. `publish` uploaded and rewrote; push dropped
  // `localAssets` on the floor.
  //
  // Ordering is deliberate: BEFORE `ensureItemUuids`, which mints uuids on the
  // backend. A refusal here then leaves nothing minted and nothing submitted.
  //
  // The probe emit runs WITHOUT `priorHashes`, so it surfaces every local ref
  // rather than only the changed ones. That is not waste — the lane is
  // content-addressed with a `present` skip-list, so unchanged bytes are a no-op
  // PUT. It is also what makes the storage rule fall out of the mechanism instead
  // of needing a special case: a content-only push presents the same plan as last
  // time, every file is already present, zero new bytes are requested, and no
  // quota check can refuse it. Only a push that genuinely ADDS bytes can be
  // blocked.
  //
  // It also has to be this emit that carries `assetRewrite` below: the push cache
  // stores hashes of the REWRITTEN content, so the emit compared against it must
  // rewrite too, or every entity reads as changed forever.
  let assetRewrite = null
  if (!output && !dryRun) {
    let mediaRefs = []
    try {
      const probe = await emitSyncPackages(siteDir, {
        ...(foundationDir ? { foundationDir } : {}),
        resolveModel: makeModelResolver({ client, offline: false }),
      })
      mediaRefs = probe.localAssets || []
    } catch (err) {
      error(`Could not scan the site for local media: ${err.message}`)
      return { exitCode: 2 }
    }
    if (mediaRefs.length) {
      info('Uploading media…')
      try {
        const { map, failed } = await uploadSiteMedia(client, siteDir, mediaRefs, {
          onProgress: (m) => note(`  ${m}`),
          warn: (m) => note(`! ${m}`),
        })
        // Bytes that did not land must not be pushed around: the content would go
        // up still naming the local path, so the teammate sees the broken image
        // this whole change exists to prevent, and the only trace is a warning. A
        // missing FILE is a different thing — already broken before us, warned by
        // the uploader, and not worth blocking a push over.
        if (failed.length) {
          error(`${failed.length} asset(s) failed to upload — nothing was pushed.`)
          for (const f of failed) note(`  ${f.path} (HTTP ${f.status})`)
          return { exitCode: 1 }
        }
        if (Object.keys(map).length) assetRewrite = map
        note(`${Object.keys(map).length}/${mediaRefs.length} media ref(s) → serve URL`)
      } catch (err) {
        if (isStorageRefusal(err)) {
          error('Storage quota reached — this push adds media that does not fit.')
          note('  A push that changes only content costs no storage and still works.')
          note('  Remove or shrink the new assets, or raise the plan limit, then re-run.')
          note(`  ${err.message}`)
          return { exitCode: 1 }
        }
        error(`Media upload failed: ${err.message}`)
        return { exitCode: 1 }
      }
    }
  }

  const itemUuids = (output || dryRun)
    ? readItemUuids(siteDir)
    : await ensureItemUuids({ client, siteDir, note })
  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, {
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel: makeModelResolver({ client, offline: Boolean(output) || dryRun }),
      priorHashes,
      sendAll,
      itemUuids,
      // Both grains are dropped together by --force: one flag, one meaning,
      // no partial-force mode.
      ...(force ? {} : { baseVersions: readBaseVersions(siteDir), itemBaseVersions: readItemBaseVersions(siteDir) }),
      ...(assetRewrite ? { assetRewrite } : {}),
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
  // cache. Shared with `uniweb publish` via ../backend/site-sync.js.
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
