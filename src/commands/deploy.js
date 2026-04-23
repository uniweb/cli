/**
 * Deploy Command
 *
 * Deploys a built site to Uniweb hosting. Phase 1 — link-mode, content + theme
 * + locales only (no binary assets yet).
 *
 * Flow:
 *   1. Read site.yml → { site.id?, site.handle?, foundation, runtime? }.
 *   2. Resolve runtime (default: GET /api/runtime/latest from the Worker).
 *   3. ensureAuth() → bearer CLI JWT from ~/.uniweb/auth.json.
 *   4. Build `dist/` if missing.
 *   5. Load dist/site-content.json → extract `languages` for the capability
 *      preview.
 *   6. Start an ephemeral loopback listener for the browser-callback path.
 *   7. POST PHP /cli-deploy.php?action=authorize with { siteId?, foundation,
 *      runtimeVersion, languages, callbackUrl }.
 *   8. Branch:
 *        - publishToken returned → fast path.
 *        - needsReview:true + reviewUrl → open browser, wait for callback,
 *          consume { publishToken, siteId, handle }.
 *   9. POST Worker /api/publish/validate to confirm foundation + runtime
 *      exist and the token's namespace claim matches.
 *  10. POST Worker /api/publish/process with the full payload.
 *  11. On first-deploy create flow: write site.id + site.handle back into
 *      site.yml so subsequent deploys fast-path.
 *
 * Usage:
 *   uniweb deploy                          Normal deploy (browser may open on first deploy)
 *   uniweb deploy --skip-build             Don't rebuild even if dist/ is stale
 *   uniweb deploy --dry-run                Resolve everything but skip the Worker POST
 *
 * See kb/platform/plans/cli-site-deploy-decisions.md for the full design.
 */

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'
import yaml from 'js-yaml'

import { ensureAuth } from '../utils/auth.js'
import { getBackendUrl, getRegistryUrl } from '../utils/config.js'
import {
  findWorkspaceRoot,
  findSites,
  classifyPackage,
  promptSelect,
} from '../utils/workspace.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'

const REVIEW_TIMEOUT_MS = 15 * 60 * 1000 // 15 min — matches PHP session TTL

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

// ─── Main ───────────────────────────────────────────────────

export async function deploy(args = []) {
  const skipBuild = args.includes('--skip-build')
  const dryRun = args.includes('--dry-run')

  const siteDir = await resolveSiteDir(args)
  const backendUrl = getBackendUrl()
  const workerUrl = getRegistryUrl()

  // Read site.yml — declares the foundation (required) and optionally the
  // site.id / site.handle from prior deploys.
  const siteYmlPath = join(siteDir, 'site.yml')
  const siteYml = await readSiteYml(siteYmlPath)
  const foundation = siteYml.foundation
  if (!foundation) {
    say.err('site.yml is missing `foundation`.')
    say.dim('Add a line like:  foundation: \'@uniweb/docs-foundation@0.1.20\'')
    process.exit(1)
  }

  // Runtime defaults to "latest" resolved at authorize time.
  let runtimeVersion = siteYml.runtime
  if (!runtimeVersion) {
    runtimeVersion = await fetchLatestRuntime(workerUrl)
    if (!runtimeVersion) {
      say.err('Could not resolve a runtime version (no runtime: in site.yml, /api/runtime/latest failed).')
      process.exit(1)
    }
    say.dim(`Runtime: ${runtimeVersion} (latest; pin via \`runtime:\` in site.yml)`)
  }

  const cliToken = await ensureAuth({ command: 'Deploying' })

  // Ensure dist/ is present. Phase 1 just uses site-content.json — binary
  // assets under dist/assets/* aren't uploaded yet.
  const distDir = join(siteDir, 'dist')
  const contentPath = join(distDir, 'site-content.json')
  if (!existsSync(contentPath)) {
    if (skipBuild) {
      say.err('No build found and --skip-build passed. Run `uniweb build` first.')
      process.exit(1)
    }
    say.warn('No build found. Building site…')
    console.log('')
    execSync('npx uniweb build', { cwd: siteDir, stdio: 'inherit' })
    console.log('')
    if (!existsSync(contentPath)) {
      say.err('Build did not produce dist/site-content.json')
      process.exit(1)
    }
  }

  // Read site-content.json — we need `languages` for the capability preview
  // and the whole object for the publish payload.
  const siteContent = JSON.parse(await readFile(contentPath, 'utf8'))
  const languages = extractLanguages(siteContent)
  const defaultLanguage = siteContent?.config?.defaultLanguage || languages[0] || 'en'
  const theme = await readTheme(siteDir, siteContent)

  if (dryRun) {
    say.info('Dry run — showing what would be deployed:')
    say.dim(`Site dir       : ${siteDir}`)
    say.dim(`site.id        : ${siteYml.site?.id || '(none — would use create flow)'}`)
    say.dim(`Foundation     : ${foundation}`)
    say.dim(`Runtime        : ${runtimeVersion}`)
    say.dim(`Languages      : ${languages.join(', ')}`)
    say.dim(`Default locale : ${defaultLanguage}`)
    say.dim(`Backend (PHP)  : ${backendUrl}`)
    say.dim(`Worker         : ${workerUrl}`)
    return
  }

  // Spin up the loopback listener eagerly — we need its callback URL for the
  // authorize request even on the fast path (PHP may always return
  // needsReview=true on first deploy / billing drift in future phases).
  const loopback = await startLoopback()

  let publishToken, siteIdResolved, handleResolved, publishUrl, validateUrl
  try {
    say.info('Requesting deploy authorization…')
    const authRes = await callAuthorize({
      backendUrl,
      cliToken,
      body: {
        siteId: siteYml.site?.id || '',
        foundation,
        runtimeVersion,
        languages,
        callbackUrl: loopback.callbackUrl,
      },
    })

    if (authRes.needsReview) {
      say.info(`Opening browser for ${authRes.intent === 'create' ? 'site creation' : 'review'}…`)
      say.dim(authRes.reviewUrl)
      await openBrowser(authRes.reviewUrl)
      console.log('')
      console.log(`${c.dim}Awaiting authorization in your browser…${c.reset}`)
      console.log(`${c.dim}(Will time out after ${REVIEW_TIMEOUT_MS / 60000} minutes)${c.reset}`)
      console.log('')

      const cb = await loopback.waitForCallback(REVIEW_TIMEOUT_MS)
      if (!cb || !cb.publishToken) {
        say.err('Browser authorization timed out or was denied.')
        process.exit(1)
      }
      publishToken = cb.publishToken
      siteIdResolved = cb.siteId
      handleResolved = cb.handle
      // Review path: Worker URLs are implicit (we derive them from config).
      publishUrl = `${workerUrl}/api/publish/process`
      validateUrl = `${workerUrl}/api/publish/validate`
    } else {
      publishToken = authRes.publishToken
      siteIdResolved = authRes.siteId
      handleResolved = authRes.handle
      publishUrl = authRes.publishUrl
      validateUrl = authRes.validateUrl
    }
  } finally {
    loopback.close()
  }

  // Pre-flight against the Worker. Surfaces "foundation not published" /
  // "runtime not found" / namespace mismatch BEFORE we ship content.
  say.info('Validating foundation + runtime…')
  const validation = await callValidate({
    url: validateUrl,
    token: publishToken,
    body: { foundation, runtimeVersion },
  })
  if (!validation.valid) {
    say.err('Pre-flight validation failed:')
    for (const issue of validation.issues || []) {
      console.log(`    ${c.red}${issue.code}${c.reset}: ${issue.message}`)
      if (issue.fix) console.log(`      ${c.dim}${issue.fix}${c.reset}`)
    }
    process.exit(1)
  }

  say.info('Publishing…')
  const publishPayload = {
    foundation,
    runtimeVersion,
    theme,
    languages,
    defaultLanguage,
    // Phase 1 single-locale wraps the content under the active locale. Multi-
    // locale CLI deploy needs per-locale collection (deferred — see plan §6).
    locales: { [defaultLanguage]: siteContent },
  }
  await callPublish({ url: publishUrl, token: publishToken, body: publishPayload })

  // Write site.id / site.handle back to site.yml so next `uniweb deploy`
  // fast-paths. Only touches the file on first deploy (or when the handle
  // drifted server-side).
  if (siteIdResolved && !siteYml.site?.id) {
    await writeSiteBinding(siteYmlPath, siteYml, { id: siteIdResolved, handle: handleResolved })
    say.dim(`Linked site.yml to site.id=${siteIdResolved}`)
  } else if (siteIdResolved && handleResolved && siteYml.site?.handle !== handleResolved) {
    await writeSiteBinding(siteYmlPath, siteYml, { id: siteIdResolved, handle: handleResolved })
    say.dim(`Updated site.yml handle → ${handleResolved}`)
  }

  console.log('')
  say.ok(`Deployed ${c.bold}${handleResolved || siteIdResolved || 'site'}${c.reset}`)
  if (handleResolved) {
    console.log(`  ${c.cyan}https://${handleResolved}.uniweb.website/${c.reset}`)
  }
}

// ─── site.yml ──────────────────────────────────────────────

async function readSiteYml(path) {
  if (!existsSync(path)) return {}
  try {
    const parsed = yaml.load(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    say.err(`Could not parse ${path}: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Write site.id + site.handle back to site.yml, preserving other fields.
 *
 * Note: this is not a full YAML-preserving write — comments and exact
 * formatting are NOT preserved. js-yaml's `dump` re-emits the document.
 * Acceptable for now; the Phase 1 plan doesn't promise comment preservation.
 */
async function writeSiteBinding(path, current, binding) {
  const next = {
    ...current,
    site: { ...(current.site || {}), id: binding.id, handle: binding.handle },
  }
  const dumped = yaml.dump(next, { lineWidth: 120, noRefs: true, quotingType: "'" })
  await writeFile(path, dumped)
}

// ─── Resolve site dir + runtime ────────────────────────────

async function resolveSiteDir(args) {
  const cwd = process.cwd()
  const prefix = getCliPrefix()

  const type = await classifyPackage(cwd)
  if (type === 'site') return cwd

  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const sites = await findSites(workspaceRoot)
    if (sites.length === 1) return resolve(workspaceRoot, sites[0])
    if (sites.length > 1) {
      if (isNonInteractive(args)) {
        say.err('Multiple sites found. Specify which one to deploy.')
        console.log('')
        for (const s of sites) {
          console.log(`  ${c.cyan}cd ${s} && ${prefix} deploy${c.reset}`)
        }
        process.exit(1)
      }
      const choice = await promptSelect('Which site?', sites)
      if (!choice) {
        console.log('\nDeploy cancelled.')
        process.exit(0)
      }
      return resolve(workspaceRoot, choice)
    }
  }

  say.err('No site found in this workspace.')
  say.dim('`deploy` publishes a built Uniweb site to the hosting platform.')
  process.exit(1)
}

async function fetchLatestRuntime(workerUrl) {
  try {
    const res = await fetch(`${workerUrl}/api/runtime/latest`)
    if (!res.ok) return null
    const body = await res.json()
    return body.version || null
  } catch {
    return null
  }
}

// ─── Content helpers ───────────────────────────────────────

function extractLanguages(siteContent) {
  const langs = siteContent?.config?.languages
  if (!Array.isArray(langs) || langs.length === 0) return ['en']
  // Editor-shape `[{ value, label }]` vs plain `[string]`.
  return langs.map((l) => (typeof l === 'string' ? l : l?.value)).filter(Boolean)
}

/**
 * Resolve theme config.
 *
 * The build pipeline does not (today) emit a separate theme.json, so we read
 * the developer-authored theme.yml from the site root. The Worker's
 * `buildTheme()` tolerates an empty config — sites with no theme.yml still
 * publish, they just get default tokens.
 */
async function readTheme(siteDir, siteContent) {
  const themePath = join(siteDir, 'theme.yml')
  if (existsSync(themePath)) {
    try {
      const parsed = yaml.load(await readFile(themePath, 'utf8'))
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // fall through to site-content.json fallback
    }
  }
  // site-content sometimes carries a `theme` key produced by collectors.
  if (siteContent?.theme && typeof siteContent.theme === 'object') {
    return siteContent.theme
  }
  return {}
}

// ─── HTTP calls ────────────────────────────────────────────

async function callAuthorize({ backendUrl, cliToken, body }) {
  // PHP's BaseController reads the `action` from the JSON body (not the query
  // string) when Content-Type: application/json. Every PHP POST needs to embed
  // `action` in the payload.
  const url = `${backendUrl}/cli-deploy.php`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cliToken}`,
    },
    body: JSON.stringify({ action: 'authorize', ...body }),
  })

  let parsed
  try {
    parsed = await res.json()
  } catch {
    say.err(`Authorize returned non-JSON (HTTP ${res.status})`)
    process.exit(1)
  }

  if (!res.ok) {
    const msg = parsed?.error || `HTTP ${res.status}`
    say.err(`Authorize failed: ${msg}`)
    process.exit(1)
  }

  // The controller returns `data` wrapped by BaseController — unwrap if so.
  return parsed.data ?? parsed
}

async function callValidate({ url, token, body }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let err = `HTTP ${res.status}`
    try {
      const j = await res.json()
      err = j.error || err
    } catch {}
    say.err(`Validate failed: ${err}`)
    process.exit(1)
  }
  return res.json()
}

async function callPublish({ url, token, body }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let err = `HTTP ${res.status}`
    try {
      const j = await res.json()
      err = j.error || err
    } catch {}
    say.err(`Publish failed: ${err}`)
    process.exit(1)
  }
  return res.json()
}

// ─── Loopback listener (review path) ───────────────────────

/**
 * Start an HTTP server on a random loopback port to receive the publish
 * token from the browser. The server accepts ONE request to /callback; after
 * that it's closed.
 *
 * Same shape as `login.js::browserLogin`, but POST-accepting since the web
 * app POSTs JSON (not a redirect with query params like CliAuthController).
 */
async function startLoopback() {
  return new Promise((resolveReady) => {
    let resolveCallback
    const callbackPromise = new Promise((r) => { resolveCallback = r })

    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost')
      if (u.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      // CORS preflight — the web app POSTs JSON cross-origin, so browsers
      // send an OPTIONS preflight first. Respond with permissive CORS headers.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '3600',
        })
        res.end()
        return
      }

      // Accept POST (web app posts JSON) or GET (browser redirect with params)
      if (req.method === 'POST') {
        let buf = ''
        req.on('data', (chunk) => (buf += chunk))
        req.on('end', () => {
          let payload = {}
          try { payload = JSON.parse(buf) } catch {}
          respondSuccess(res)
          resolveCallback(payload)
        })
        return
      }
      if (req.method === 'GET') {
        const publishToken = u.searchParams.get('token')
        const siteId = u.searchParams.get('siteId')
        const handle = u.searchParams.get('handle')
        if (!publishToken) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<h2>Missing token</h2>')
          return
        }
        respondSuccess(res)
        resolveCallback({ publishToken, siteId, handle })
        return
      }
      res.writeHead(405)
      res.end('Method not allowed')
    })

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolveReady({
        callbackUrl: `http://127.0.0.1:${port}/callback`,
        waitForCallback: (timeoutMs) => Promise.race([
          callbackPromise,
          new Promise((r) => setTimeout(() => r(null), timeoutMs)),
        ]),
        close: () => { try { server.close() } catch {} },
      })
    })
  })
}

function respondSuccess(res) {
  // CORS preflight + actual response, since the web app POSTs cross-origin.
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(
    '<html><body style="font-family:system-ui;text-align:center;padding:60px">' +
    '<h2 style="color:#16a34a">Deploy authorized</h2>' +
    '<p>You can close this window and return to your terminal.</p>' +
    '</body></html>'
  )
}

async function openBrowser(url) {
  try {
    const { exec } = await import('node:child_process')
    const cmd = process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`
    return new Promise((r) => exec(cmd, (err) => r(!err)))
  } catch {
    return false
  }
}

export default deploy
