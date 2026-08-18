/**
 * uniweb publish — the smart Uniweb-hosting flagship (shipping-model.md §3).
 *
 * `uniweb login && uniweb publish` is meant to be the most ergonomic command in
 * the tool: run it, and it does the right thing — talks to the backend,
 * understands the project, and makes the site live on Uniweb hosting (synced +
 * dynamically served). It:
 *
 *   1. resolves WHICH site (your location, or the workspace's one site; multiple
 *      → prompt);
 *   2. BRINGS THE FOUNDATION ALONG — if the site's local foundation changed
 *      since its last release, releases the new version first (or asks); a
 *      published registry ref needs nothing (§4, foundation-bring-along.js);
 *   3. SYNCS — builds the site data (link mode), uploads media + the static-data
 *      ball, and pushes content (the same two-lane sync `uniweb push` uses);
 *   4. SETTLES PAYMENT when the backend says go-live needs it — opens a browser
 *      to uniweb.app, waits, continues (provider-agnostic; payment-handoff.js);
 *   5. GOES LIVE — POST /dev/site/publish/{uuid}.
 *
 * Distinct from `uniweb deploy` (third-party hosts) and `uniweb register`
 * (foundation code → catalog). For a self-contained artifact, see `uniweb export`.
 *
 * Backend: BackendClient. Origin from --backend/--registry > UNIWEB_REGISTER_URL
 * > default. Auth: --token > UNIWEB_TOKEN > `uniweb login` session.
 *
 * Usage:
 *   uniweb publish                 Bring the foundation along, sync, and go live
 *   uniweb publish --dry-run       Resolve everything; POST nothing
 *   uniweb publish --yes           Skip confirmations (CI); never block on a prompt
 *   uniweb publish --force         Overwrite upstream app-side edits (drop the push gate)
 *   uniweb publish --org @org      Publish under @org (alias: --as-org). Only the
 *                                  FIRST publish of a site reads it — that create is
 *                                  what decides which org owns the site and whose
 *                                  storage its assets are charged to. It is then
 *                                  recorded as `site.yml::$org` and replayed, so it
 *                                  never has to be re-typed.
 *   uniweb publish --personal      Own the new site personally, deliberately. Sends
 *                                  NO `as_org` — byte-identical to the wire before
 *                                  the owner prompt existed. First publish only.
 *   uniweb publish --no-save       Skip the deploy.yml lastDeploy auto-save
 *   uniweb publish --backend <url> Override the backend origin
 *   uniweb publish --token <bearer> Auth bearer (skips `uniweb login`)
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import yaml from 'js-yaml'

import {
  loadDeployYml,
  resolveTarget,
  recordLastDeploy,
  assembleDataBall,
  collectBallAssets,
  rewriteBallAssets
} from '@uniweb/build/site'
import { emitSyncPackages } from '@uniweb/build/uwx'
import { isSiteRelativeExtensionUrl } from '@uniweb/build'
import { resolveDefaultLocale } from '@uniweb/core/locale-config'

import { BackendClient } from '../backend/client.js'
import { resolveSiteDir, resolveSiteBackend } from './deploy.js'
import { warnIfContentDoesNotConform } from '../utils/conformance.js'
import { readFlagValue, readOrgFlag } from '../utils/args.js'
import { checkFlags } from '../utils/flag-guard.js'
import { isNonInteractive } from '../utils/interactive.js'
import { headProvenance } from '../utils/git.js'
import {
  makeModelResolver,
  readSyncCache,
  readBaseVersions,
  readItemBaseVersions,
  ensureItemUuids,
  ensureSiteExists,
  clearRemoteSyncStateIfUnbound,
  pushSyncPackages,
  resolveSiteOrgForCreate
} from '../backend/site-sync.js'
import { uploadDataBundle } from '../backend/data-bundle.js'
import { uploadSiteMedia, describeAssetRefusal } from '../backend/site-media.js'
import { updateAssetMap, ASSET_MAP_FILE } from '@uniweb/build/uwx'
import {
  bringFoundationAlong,
  bringExtensionsAlong
} from '../backend/foundation-bring-along.js'
import { settlePaymentIfNeeded } from '../backend/payment-handoff.js'
import { reportSchemalessCollections } from '../utils/schemaless-report.js'
import { uploadDataFiles } from '../backend/data-files.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`)
}

// Minimal yes/no prompt. Returns `defaultYes` on an empty answer.
async function confirm(question, defaultYes = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const a = (
      await rl.question(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `)
    )
      .trim()
      .toLowerCase()
    if (!a) return defaultYes
    return a === 'y' || a === 'yes'
  } finally {
    rl.close()
  }
}

// Origin-relative serve path → clickable absolute URL (self-serve default).
function absolutizeServeUrl(origin, url) {
  if (!url || typeof url !== 'string') return null
  if (/^https?:\/\//.test(url)) return url
  return `${origin.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}

function readSiteYml(path) {
  if (!existsSync(path)) return {}
  try {
    const parsed = yaml.load(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// Languages from the BUILT site-content.json (config.languages) — the authority
// after a build. Three accepted shapes: 'en', { value, label }, { code, label }.
function languagesFromContent(siteContent) {
  const langs = siteContent?.config?.languages
  if (!Array.isArray(langs) || langs.length === 0) return ['en']
  return langs
    .map((l) => (typeof l === 'string' ? l : l?.value || l?.code))
    .filter(Boolean)
}

// Languages from site.yml — used only for the dry-run summary (no build yet).
function languagesFromSiteYml(siteYml) {
  // Legacy `lang:` still honored between defaultLanguage and the shared
  // `defaultLanguage || languages[0] || 'en'` rule.
  const def =
    siteYml.defaultLanguage || siteYml.lang || resolveDefaultLocale(siteYml)
  const locales = siteYml.i18n?.locales || siteYml.languages
  if (!Array.isArray(locales) || locales.length === 0) return null
  const norm = locales
    .map((l) => (typeof l === 'string' ? l : l?.value || l?.code))
    .filter(Boolean)
  return [def, ...norm.filter((l) => l !== def)]
}

// Persist deploy.yml lastDeploy memory (skipped on --no-save / autoSave 'off').
async function persistLastDeploy(siteDir, opts) {
  if (opts.autoSave === 'off') return
  try {
    const result = await recordLastDeploy(siteDir, opts)
    if (result?.created)
      say.dim(`Wrote deploy.yml (target: ${opts.targetName})`)
  } catch (err) {
    // The publish itself succeeded — never fail the whole command on a
    // memo-write error. Surface it so the user can fix the file.
    say.dim(`Could not update deploy.yml: ${err.message}`)
  }
}

export async function publish(args = []) {
  // See utils/flag-guard.js — an unrecognized flag is invisible to a literal
  // scan, and for --backend the silent default can be production.
  const bad = checkFlags('publish', args)
  if (bad) {
    say.err(bad.message)
    return { exitCode: 2 }
  }
  const dryRun = args.includes('--dry-run')
  const noSave = args.includes('--no-save')
  const foundationDir = readFlagValue(args, '--foundation') // optional local foundation for Model schemas

  const siteDir = await resolveSiteDir(args, 'publish')

  // Advisory only — warns and ships. See utils/conformance.js for why this
  // is not a gate.
  await warnIfContentDoesNotConform(siteDir, { args })
  const siteYml = readSiteYml(join(siteDir, 'site.yml'))
  // The site's deploy.yml-bound backend (where it was published) feeds the
  // resolution ladder below an explicit --backend / UNIWEB_REGISTER_URL.
  const siteBackend = await resolveSiteBackend(siteDir)

  const client = new BackendClient({
    originFlag:
      readFlagValue(args, '--backend') || readFlagValue(args, '--registry'),
    siteBackend,
    token: readFlagValue(args, '--token') || undefined,
    args,
    command: 'Publishing'
  })

  // WHO will own this site, if this publish is the one that creates it. Resolved
  // up front: `ensureSiteExists` below is the create, and it must not be reached
  // with the question still open. An already-created site resolves to null without
  // asking — its ownership was settled once and cannot be changed from here.
  const org = await resolveSiteOrgForCreate({
    client,
    siteDir,
    args,
    flag: readOrgFlag(args),
    personal: args.includes('--personal'),
    offline: dryRun
  })
  if (org.refused) {
    say.err('Refusing to create this site without naming an owner.')
    say.dim(org.reason)
    return { exitCode: 2 }
  }
  const asOrg = org.asOrg

  // Capability handshake (cached). Publish ends in a go-live, so the publish
  // lane must be offered.
  const config = await client.discover()
  if (config?.delivery && config.delivery.publish === false) {
    say.err(
      `Backend at ${client.origin} does not offer the publish lane (delivery.publish=false).`
    )
    return { exitCode: 1 }
  }

  // Runtime: an explicit site.yml::runtime pin wins; else the highest installed;
  // else fail closed (better than serving a site with no runtime). A dry-run is
  // a pure preview, so it only WARNS — it stays useful with no backend reachable.
  const installed = Array.isArray(config?.runtime?.installed)
    ? config.runtime.installed
    : []
  if (
    siteYml.runtime &&
    installed.length &&
    !installed.includes(siteYml.runtime)
  ) {
    // ⚠️ Leads with REMOVING the pin, deliberately. A site ships no JS, so it
    // has no basis for holding a runtime version, and `runtime:` is an
    // operator-level override that is no longer part of the documented
    // authoring surface. This message used to say "pin one of these in
    // site.yml" — which pushed a reader deeper into a mechanism they should
    // not be using, and named a key the docs no longer describe. Keep the
    // installed list (it is the actionable part when a pin IS intended), but
    // do not restore pin-first phrasing.
    say.err(
      `Runtime ${siteYml.runtime} (pinned in site.yml) is not installed on the backend.`
    )
    say.dim(
      `Remove the \`runtime:\` pin and the backend chooses — a site ships no code, so it has no reason to hold one.`
    )
    say.dim(
      `Installed: ${installed.join(', ') || '(none)'} — or pin one of those, or have ${siteYml.runtime} installed.`
    )
    if (!dryRun) return { exitCode: 1 }
  }
  // An explicit pin is sent; NOTHING is synthesized when site.yml is silent.
  //
  // This used to fall back to the highest version the backend reported
  // installed. That is the producer guessing at a fact the control plane owns —
  // and once propagation moves sites, actively wrong: a walk advances a site to
  // X, and the next publish would restate a *different* version the producer
  // computed locally, silently undoing it.
  //
  // The deeper reason, upstream of ownership: a link-mode site is CODELESS. It
  // ships no JS, so it has nothing that binds to a runtime version and cannot
  // break when the runtime moves. Asking it to name one is not a hard question,
  // it is a malformed one. The party that binds is the FOUNDATION, whose build
  // externalizes react / react-dom / jsx-runtime / @uniweb/core — which is why
  // the compatibility floor rides on the foundation (`info.runtime`, set by
  // `register`) and not here. See
  // the site/foundation/runtime model, § "who gets to say
  // whether a site accepts a newer runtime".
  //
  // Silence is therefore not a request to change the runtime, and the backend
  // resolves it: an explicit pin → the site's CURRENT resolved runtime →
  // UNIWEBD_DEFAULT_RUNTIME → (self-serve) highest installed.
  //
  // ⚠️ THAT LAST SENTENCE IS A CLAIM ABOUT ANOTHER LANE, and it was FALSE when it
  // was first written here — `/dev/site/publish` required `?runtime=` with no
  // fallback at all, so an unpinned publish 400'd and no scaffolded project could
  // publish. It read as true because the `/api` lane did have the fallback, and
  // the backend's own doc justified the omission with "the CLI always pins from
  // site.yml" — which was equally false, since no template ships a `runtime:` key.
  // Two complementary assumptions, each load-bearing for the other lane, neither
  // ever checked. Found by driving the CLI against a live backend, which is the
  // only vantage point from which either assumption is visible.
  // ✅ Now the shipped contract, agreed with the backend and verified end to end
  // with the workaround removed (2026-08-16). Re-verify against the backend
  // rather than trusting this comment if it starts mattering again.
  //
  // ⚠️ Do NOT reintroduce a local fallback. Sending our own guess when the site
  // did not ask is what makes an unpinned republish regress. (The pinned path is
  // unaffected — an explicit pin is still validated fail-closed above, and the
  // backend refuses a backward move unless forced.)
  const runtimeVersion = siteYml.runtime || null

  // deploy.yml target (the Uniweb hosting memory). No --target on publish — it
  // always targets Uniweb hosting; resolveTarget gives us the target name +
  // autoSave for the lastDeploy memo.
  let resolved
  try {
    const deployYml = await loadDeployYml(siteDir)
    // No --target on publish — it always targets Uniweb hosting; resolveTarget
    // returns the uniweb default (fromFile:false) when there's no deploy.yml, so
    // persistLastDeploy scaffolds the file as the "where it's deployed" record.
    resolved = resolveTarget(deployYml, null)
  } catch {
    // Malformed/ambiguous deploy.yml — don't block the publish on the memo.
    resolved = {
      targetName: 'production',
      host: 'uniweb',
      config: {},
      autoSave: 'lastDeploy',
      fromFile: false
    }
  }
  const autoSave = noSave ? 'off' : resolved.autoSave || 'lastDeploy'

  // A SITE-RELATIVE extension URL cannot work on Uniweb hosting: the published
  // site ships no JS, so nothing serves that path. The request falls through to
  // the SPA shell and returns 200 with `text/html`, which `import()` then fails
  // to parse — and `loadExtensions` uses Promise.allSettled, so nothing throws
  // and every section the extension provides silently renders "Component not
  // found". A 200-with-HTML is strictly worse to debug than a 404 (the same
  // shape that forced the `/data/` carve-out at the edge), so fail here, at the
  // author's screen, rather than at a visitor's.
  //
  // `export` / `deploy --host` are unaffected — there the site serves its own
  // files and a relative URL is exactly right.
  const relativeExtensions = (
    Array.isArray(siteYml.extensions) ? siteYml.extensions : []
  )
    .map((e) => (e && typeof e === 'object' ? e.url || e.ref || e.name : e))
    .filter((d) => isSiteRelativeExtensionUrl(d))
  if (relativeExtensions.length) {
    say.err(
      `Site-relative extension URL${relativeExtensions.length > 1 ? 's' : ''} cannot be served by Uniweb hosting: ${relativeExtensions.join(', ')}`
    )
    say.dim(
      'A published site ships no JS, so nothing serves that path. An extension is a foundation —'
    )
    say.dim(
      'register it (`uniweb register` in the extension directory) and reference it by name or'
    )
    say.dim(
      '`@org/name@version` in site.yml::extensions, the same way the primary foundation is declared.'
    )
    say.dim(
      'Site-relative URLs keep working with `uniweb export` and `uniweb deploy --host=<adapter>`.'
    )
    return { exitCode: 1 }
  }

  if (dryRun) {
    say.info('Dry run — would bring the foundation along, sync, and go live:')
    say.dim(`Backend     : ${client.origin}`)
    say.dim(
      `Runtime     : ${runtimeVersion || '(not pinned — the backend keeps this site on its current runtime)'}`
    )
    say.dim(
      `site_uuid   : ${siteYml.$uuid || '(none — the site is created before anything uploads)'}`
    )
    const langs = languagesFromSiteYml(siteYml)
    if (langs) say.dim(`Languages   : ${langs.join(', ')}`)
    await bringFoundationAlong({
      client,
      siteDir,
      siteYml,
      args,
      say,
      confirm,
      cliBin: process.argv[1],
      dryRun: true
    })
    await bringExtensionsAlong({
      client,
      siteDir,
      siteYml,
      args,
      say,
      confirm,
      cliBin: process.argv[1],
      dryRun: true
    })
    await settlePaymentIfNeeded({
      client,
      uuid: siteYml.$uuid || null,
      args,
      say,
      dryRun: true
    })
    return { exitCode: 0 }
  }

  // 1. Bring the foundation along — release the local foundation if its code
  //    changed (or isn't registered). Never ship a site pointing at stale code.
  let fnd
  try {
    fnd = await bringFoundationAlong({
      client,
      siteDir,
      siteYml,
      args,
      say,
      confirm,
      cliBin: process.argv[1]
    })
  } catch (err) {
    say.err(`Foundation release failed: ${err.message}`)
    say.dim('Fix the foundation, then re-run `uniweb publish`.')
    return { exitCode: 1 }
  }

  // 1b. Same for the site's LOCAL extensions. An extension is a foundation, so
  //     it gets the same freshness guarantee — otherwise a site could go live
  //     against stale extension code with nothing noticing.
  let ext
  try {
    ext = await bringExtensionsAlong({
      client,
      siteDir,
      siteYml,
      args,
      say,
      confirm,
      cliBin: process.argv[1]
    })
  } catch (err) {
    say.err(`Extension release failed: ${err.message}`)
    say.dim('Fix the extension, then re-run `uniweb publish`.')
    return { exitCode: 1 }
  }
  if (!ext.proceed) return { exitCode: 1 }
  if (!fnd.proceed) return { exitCode: 0 }

  // 2. Build the site data (link mode): dist/site-content.json (+ per-locale),
  //    dist/data/*, dist/_search/*, dist/assets/*. Spawn the SAME CLI binary so
  //    the inner build can't resolve to a different installed version.
  say.info('Building site…')
  console.log('')
  execSync(`node ${JSON.stringify(process.argv[1])} build --link`, {
    cwd: siteDir,
    stdio: 'inherit',
    env: process.env
  })
  console.log('')

  const distDir = join(siteDir, 'dist')
  const contentPath = join(distDir, 'site-content.json')
  if (!existsSync(contentPath)) {
    say.err('Build did not produce dist/site-content.json')
    return { exitCode: 1 }
  }

  // Non-local @std/registry Model schemas resolve through the backend (same as push).
  const resolveModel = makeModelResolver({ client, offline: false })

  // 3. Partition collections by schema presence (a first emit reads `schemaless`
  //    — collections with no data schema, delivered statically via the ball).
  let probe
  try {
    probe = await emitSyncPackages(siteDir, {
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel
    })
  } catch (err) {
    say.err(`Could not build the sync package: ${err.message}`)
    return { exitCode: 1 }
  }
  const schemalessNames = (probe.schemaless || []).map((col) => col.name)
  // A product decision the author is usually making unknowingly — say it at warn
  // level, not dim among everything else. See the helper for what the old
  // message got wrong.
  reportSchemalessCollections(probe.schemaless, say)
  const localAssets = probe.localAssets || []

  // 3a. A clone with no `$uuid` is bound to no backend site, so every cached map
  //     that describes one is stale — including after the documented "clear
  //     `$uuid` to re-publish as a new site" recovery. Must run BEFORE the create,
  //     which mints a uuid and would make the clone look bound.
  const droppedState = clearRemoteSyncStateIfUnbound(siteDir)
  if (droppedState.length) {
    say.dim(
      `Cleared stale sync state from a previous site (${droppedState.join(', ')}).`
    )
  }

  // 3b. Make sure the SITE EXISTS before a single byte is uploaded.
  //
  //     Uploaded bytes are metered against an owning entity and reclaimed by
  //     deleting it. Uploading before the site exists therefore produces bytes
  //     that are charged and can never be freed — there is nothing to delete —
  //     so a repeatedly-failing first publish would burn quota with no recovery
  //     short of support. Creating the site first makes the artifact of a failed
  //     publish an EMPTY SITE instead: it costs nothing to keep and the owner can
  //     clear it. A no-op once `$uuid` is set, so only a first publish pays.
  //
  //     This ordering is load-bearing, not incidental — the asset plan requires an
  //     owner. A test asserts the create precedes the upload.
  const site = await ensureSiteExists({
    client,
    siteDir,
    name: siteYml.name,
    foundation: fnd.ref || siteYml.foundation,
    asOrg,
    note: (m) => say.dim(m)
  })
  if (!site.uuid) {
    say.err(`Could not create the site on the backend: ${site.reason}`)
    say.dim('Nothing was uploaded and nothing was charged.')
    return { exitCode: 1 }
  }

  // 4. Assemble the static-data ball (schema-less data + search index) BEFORE
  //    uploading, since its records can carry local media too.
  let ball = await assembleDataBall(distDir, schemalessNames)
  const ballAssets = collectBallAssets(ball)

  // 4b. Upload ALL local media (entity refs + ball refs) on one asset lane →
  //     the ref→serveUrl map; rewrite the entity content AND the ball with it.
  let assetRewrite = null
  let assetIds = null
  const mediaRefs = [...new Set([...localAssets, ...ballAssets])]
  if (mediaRefs.length) {
    say.info('Uploading media…')
    try {
      const { map, ids, failed } = await uploadSiteMedia(
        client,
        siteDir,
        mediaRefs,
        {
          siteUuid: site.uuid,
          onProgress: (m) => say.dim(`  ${m}`),
          warn: (m) => say.dim(`! ${m}`)
        }
      )
      // A ref whose bytes did not land must NOT be published: the content would go
      // out still pointing at the local path, so the site ships a broken image and
      // the only trace is a warning nobody reads. A missing FILE is different —
      // already broken before us, warned above, and not worth blocking a publish.
      if (failed.length) {
        say.err(`${failed.length} asset(s) failed to upload — not publishing.`)
        for (const f of failed) say.dim(`  ${f.path} (HTTP ${f.status})`)
        return { exitCode: 1 }
      }
      if (Object.keys(map).length) assetRewrite = map
      if (Object.keys(ids).length) assetIds = ids
      // Identity into the COMMITTED map — see backend/asset-map.js. Merge, not
      // replace: this publish carries only the refs its content touched.
      const rec = updateAssetMap(siteDir, ids)
      if (rec.written) {
        say.dim(
          `${ASSET_MAP_FILE}   : ${rec.added.length} added, ${rec.changed.length} changed — commit it`
        )
      }
      if (ballAssets.length) ball = rewriteBallAssets(ball, map)
      say.dim(
        `Media          : ${Object.keys(map).length}/${mediaRefs.length} ref(s) → serve URL`
      )
    } catch (err) {
      // A typed plan refusal gets its own account (quota, per-file cap, plan caps);
      // anything else falls through to the raw message. Nothing has been pushed at
      // this point, so either way the site is untouched.
      const refusal = describeAssetRefusal(err)
      if (refusal) {
        say.err(refusal.headline)
        for (const line of refusal.notes) say.dim(line)
      } else {
        say.err(`Media upload failed: ${err.message}`)
      }
      return { exitCode: 1 }
    }
  }

  // 4c. Upload the (media-rewritten) ball → its content-addressed serve URL.
  let dataBundle
  if (ball) {
    say.info('Uploading data bundle…')
    try {
      dataBundle = await uploadDataBundle(client, ball, {
        siteUuid: site.uuid,
        onProgress: (m) => say.dim(`  ${m}`)
      })
    } catch (err) {
      // The ball rides the same asset lane, so it hits the same typed refusals.
      const refusal = describeAssetRefusal(err)
      if (refusal) {
        say.err(refusal.headline)
        for (const line of refusal.notes) say.dim(line)
      } else {
        say.err(`Data bundle upload failed: ${err.message}`)
      }
      return { exitCode: 1 }
    }
    // ⛔ This read `ball.search` until 2026-08-18 and THREW — `Object.keys(undefined)`
    // is a TypeError, and it sits outside the try above, so it crashed the publish
    // AFTER the bytes were uploaded. `@uniweb/build` removed the ball's `search`
    // key on 2026-08-01 (be84ed2, "stop producing a search index on the synced
    // lane"); this line was last touched 2026-06-24 and never followed.
    //
    // ⚠️ A cross-repo producer/consumer break: the shape is `@uniweb/build`'s and
    // the reader is here, so neither repo's tests could see it. Pinned now by
    // `test/data-ball-shape.test.js`, which reads the real ball rather than a
    // fixture — a fixture would have been written from the same assumption.
    //
    // 📌 It went unreported for 17 days, which is its own finding: the schema-less
    // publish path has no users to break.
    say.dim(`Data bundle    : ${Object.keys(ball.data).length} file(s)`)
  }

  // 4d. Upload the SAME files individually → `info.data`, the successor to the
  //     ball. Ships alongside it for one release round: a released CLI still
  //     sending only a ball must keep working, and no deployment count bounds
  //     the set of CLIs already installed. See backend/data-files.js.
  let dataFiles
  if (ball) {
    say.info('Uploading data files…')
    try {
      dataFiles = await uploadDataFiles(client, ball, {
        siteUuid: site.uuid,
        onProgress: (m) => say.dim(`  ${m}`)
      })
    } catch (err) {
      const refusal = describeAssetRefusal(err)
      if (refusal) {
        say.err(refusal.headline)
        for (const line of refusal.notes) say.dim(line)
      } else {
        say.err(`Data files upload failed: ${err.message}`)
      }
      return { exitCode: 1 }
    }
    if (dataFiles) {
      say.dim(`Data files     : ${Object.keys(dataFiles).length} object(s) → serve URL`)
    }
  }

  // 5. Push the site (content + folder) over the send-only-changed cache —
  //    the SAME two-lane submission `uniweb push` uses — stamping
  //    info.data_bundle and rewriting local media refs to backend serve URLs.
  const priorHashes = readSyncCache(siteDir)
  // publish rides the same gated push as `uniweb push`: if an app author has
  // edited since this clone last synced, the push is refused rather than
  // overwriting them, and nothing goes live. `--force` drops the precondition.
  const baseVersions = args.includes('--force')
    ? null
    : readBaseVersions(siteDir)
  // Per-item identity, recovered from the backend when this clone has never seen it.
  // Without it the backend re-mints every page and section row (see readItemUuids).
  const itemUuids = await ensureItemUuids({
    client,
    siteDir,
    note: (m) => say.dim(m)
  })
  // Stamp deploy-derived info on the site-content entity: the data-bundle URL,
  // and the PINNED foundation ref (`@scope/name@version`) from the bring-along.
  // Delivery is version-pinned end-to-end (the gateway serves a foundation only
  // by a concrete version — collab framework-backend-5c3e), so pinning the
  // released version on the wire is required when site.yml uses an unversioned
  // local ref; injectInfo overrides info.foundation. A registry/URL ref → fnd.ref
  // is null → the site.yml ref is forwarded verbatim (already pinned).
  const injectInfo = {
    // Both, deliberately, for one release round. A consumer that reads neither
    // sees today's publish unchanged; one that reads `data` needs no ball.
    ...(dataBundle ? { data_bundle: dataBundle } : {}),
    ...(dataFiles ? { data: dataFiles } : {}),
    ...(fnd.ref ? { foundation: fnd.ref } : {})
  }
  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, {
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel,
      priorHashes,
      itemUuids,
      ...(baseVersions
        ? { baseVersions, itemBaseVersions: readItemBaseVersions(siteDir) }
        : {}),
      ...(Object.keys(injectInfo).length ? { injectInfo } : {}),
      ...(Object.keys(ext.pins).length
        ? { injectExtensions: ext.pins }
        : {}),
      ...(assetRewrite ? { assetRewrite } : {}),
      ...(assetIds ? { assetIds } : {})
    })
  } catch (err) {
    say.err(`Could not build the sync package: ${err.message}`)
    return { exitCode: 1 }
  }
  for (const w of pkg.warnings) say.dim(`! ${w}`)
  const report = {
    info: (m) => say.info(m),
    note: (m) => say.dim(m),
    error: (m) => say.err(m),
    dim: (s) => `${c.dim}${s}${c.reset}`
  }
  const pushResult = await pushSyncPackages({
    client,
    siteDir,
    pkg,
    asOrg,
    report
  })
  if (pushResult.exitCode !== 0) return { exitCode: pushResult.exitCode }
  const siteUuid = pushResult.boundSiteUuid
  if (!siteUuid) {
    say.err('Push did not yield a site uuid — cannot go live.')
    return { exitCode: 1 }
  }

  // 6. Payment gate — the backend says whether go-live needs payment. Settles
  //    via a browser handoff to uniweb.app; degrades to "proceed" when the
  //    backend exposes no payment route. The draft is already synced, so a
  //    decline leaves a recoverable state (re-run after paying).
  const pay = await settlePaymentIfNeeded({ client, uuid: siteUuid, args, say })
  if (!pay.proceed) {
    say.info(
      'Site synced as a draft but not made live. Re-run `uniweb publish` once payment is complete.'
    )
    return { exitCode: 0 }
  }

  // 7. Go live — make the just-pushed composite live (its current backend state).
  const siteContent = JSON.parse(await readFile(contentPath, 'utf8'))
  const languages = languagesFromContent(siteContent)
  say.info(`Publishing to ${c.dim}${client.origin}${c.reset} …`)
  let pubRes
  try {
    pubRes = await client.publishSite(siteUuid, {
      runtimeVersion,
      ...(languages ? { languages } : {})
    })
  } catch (err) {
    say.err(`Could not reach the backend at ${client.origin}: ${err.message}`)
    say.dim('Set the origin with --backend <url> or UNIWEB_REGISTER_URL.')
    return { exitCode: 1 }
  }
  if (!pubRes.ok) {
    say.err(`Publish rejected: HTTP ${pubRes.status} ${pubRes.statusText}`)
    if (pubRes.status === 401 || pubRes.status === 403) {
      say.dim(
        "Credentials weren't accepted — run `uniweb login` (or pass --token <bearer>)."
      )
    }
    const body = await pubRes.text().catch(() => '')
    if (body) say.dim(body.slice(0, 800))
    return { exitCode: 1 }
  }
  let result
  try {
    result = await pubRes.json()
  } catch {
    result = {}
  }
  const serveUrl = absolutizeServeUrl(client.origin, result.url)

  // 8. Persist deploy.yml memory — a record of what went live (and so a re-run
  //    reuses the resolved target without re-asking). One identity:
  //    site.yml::$uuid. `released` records whether this publish shipped a new
  //    foundation version (the bring-along, §4).
  // Record the ref that actually went live: the pinned `@scope/name@version`
  // from the bring-along when present, else the site.yml ref verbatim.
  const gitAt = headProvenance(siteDir)
  const siteYmlRef =
    typeof siteYml.foundation === 'string'
      ? siteYml.foundation
      : siteYml.foundation?.ref || null
  const recordedRef = fnd.ref || siteYmlRef
  await persistLastDeploy(siteDir, {
    targetName: resolved.targetName,
    // First publish scaffolds deploy.yml with the backend recorded on the
    // target, binding the site to where it went live (uniweb.app, or a B2B
    // backend). resolveSiteBackend reads it back on later publishes.
    targetConfig: resolved.fromFile
      ? null
      : { host: 'uniweb', backend: client.origin },
    autoSave,
    lastDeploy: {
      at: new Date().toISOString(),
      host: 'uniweb',
      // What was actually shipped. A version number can't answer that — two
      // publishes of "0.1.0" are not the same content — and after the fact the
      // working tree has moved on. `dirty` matters as much as the sha: it says the
      // publish did NOT correspond to any commit, so the sha alone would mislead.
      ...(gitAt ? { git: gitAt } : {}),
      backend: client.origin,
      siteUuid,
      url: serveUrl,
      foundation: {
        ...(recordedRef ? { ref: recordedRef } : {}),
        released: fnd.released
      },
      // Only when the site pinned one. An unpinned site's runtime is resolved by
      // the backend and can move under propagation, so recording a value here
      // would be a snapshot that silently goes stale — and `deploy.yml` is a
      // record of what this publish did, not a cache of backend state.
      ...(runtimeVersion ? { runtime: runtimeVersion } : {}),
      locales: Array.isArray(result.locales) ? result.locales : languages
    }
  })

  console.log('')
  say.ok(
    `Published ${c.bold}${siteUuid}${c.reset}${result.status ? ` (${result.status})` : ''}`
  )
  if (serveUrl) console.log(`  ${c.cyan}${serveUrl}${c.reset}`)
  if (result.deploy_uuid) say.dim(`deploy: ${result.deploy_uuid}`)
  return { exitCode: 0 }
}

export default publish
