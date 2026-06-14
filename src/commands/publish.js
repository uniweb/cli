/**
 * uniweb publish — make a SYNCED site's current backend state live (CMS publish).
 *
 * Three "publish-ish" verbs, three jobs — don't conflate them:
 *   - `uniweb deploy`   hosts the CLI's FILE-BUILT payload (POST /dev/deploy).
 *   - `uniweb publish`  publishes a SITE that already lives on the backend as a
 *     `@uniweb/site-content` entity (synced via `uniweb push`) — POST /dev/site/publish.
 *   - `uniweb register` registers a FOUNDATION (+ the data schemas it renders).
 *     (Foundation publishing used to be `uniweb publish`; it is now `register`.)
 *
 * `publish` makes the site's CURRENT backend state live — including edits made
 * through the app since the last push. It does NOT push local files (run
 * `uniweb push` first if you want your local edits live, then `publish`). The two
 * are deliberately separate steps, mirroring the directional sync primitives.
 *
 * `{uuid}` is the site-content uuid (`site.yml::$uuid`, written by `uniweb push`).
 * A site that was never pushed 404s — push it first, or use `uniweb deploy` for a
 * file-only site.
 *
 * (Was `uniweb release` during the rollout; `release` remains a deprecated alias.)
 *
 * Usage:
 *   uniweb publish                       Publish the synced site's current state
 *   uniweb publish --backend <url>       Override the backend origin
 *   uniweb publish --token <bearer>      Auth bearer (skips `uniweb login`)
 *   uniweb publish --dry-run             Resolve everything; POST nothing
 *
 * Backend: BackendClient → POST /dev/site/publish/{uuid}. Origin from
 *   --backend/--registry > UNIWEB_REGISTER_URL > default. Auth: --token >
 *   UNIWEB_TOKEN > `uniweb login`.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { BackendClient } from '../backend/client.js'
import { resolveSiteDir } from './deploy.js'
import { readFlagValue } from '../utils/args.js'

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

// Highest installed runtime from the backend's /dev/config list (numeric-aware
// sort). Mirrors deploy.js's resolver. Null when the list is empty.
function pickHighestRuntime(installed) {
  if (!Array.isArray(installed) || installed.length === 0) return null
  return [...installed].sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }))[0]
}

// Origin-relative serve path → clickable absolute URL (self-serve default).
function absolutizeServeUrl(origin, url) {
  if (!url || typeof url !== 'string') return null
  if (/^https?:\/\//.test(url)) return url
  return `${origin.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}

// Locale set from site.yml — source/default first, then declared locales.
// Tolerant of the shapes site.yml uses (i18n.locales, languages[]). Null when
// single-locale, so the body omits `languages` and the backend defaults.
function extractLanguages(siteYml) {
  const def = siteYml.defaultLanguage || siteYml.lang || 'en'
  const locales = siteYml.i18n?.locales || siteYml.languages
  if (!Array.isArray(locales) || locales.length === 0) return null
  const norm = locales.map((l) => (typeof l === 'string' ? l : l?.value || l?.code)).filter(Boolean)
  return [def, ...norm.filter((l) => l !== def)]
}

export async function publish(args = []) {
  const dryRun = args.includes('--dry-run')
  const siteDir = await resolveSiteDir(args, 'publish')

  // The site-content uuid lives in site.yml::$uuid (written by `uniweb push`).
  // No uuid → the site was never synced; publish has nothing to make live.
  const siteYmlPath = join(siteDir, 'site.yml')
  let siteYml = {}
  if (existsSync(siteYmlPath)) {
    try {
      siteYml = yaml.load(await readFile(siteYmlPath, 'utf8')) || {}
    } catch {
      siteYml = {}
    }
  }
  const uuid = siteYml.$uuid
  if (!uuid) {
    say.err('This site has no $uuid in site.yml — it was never synced to the backend.')
    say.dim('Run `uniweb push` first (publish makes the synced site live), or use `uniweb deploy` for a file-only site.')
    return { exitCode: 1 }
  }

  const client = new BackendClient({
    originFlag: readFlagValue(args, '--backend') || readFlagValue(args, '--registry'),
    token: readFlagValue(args, '--token') || undefined,
    args,
    command: 'Publishing',
  })

  // Discover + resolve the runtime exactly like deploy: explicit site.yml::runtime,
  // else the highest installed (the /dev/config source). Fail closed otherwise.
  const config = await client.discover()
  if (config?.delivery && config.delivery.publish === false) {
    say.err(`Backend at ${client.origin} does not offer the publish lane (delivery.publish=false).`)
    return { exitCode: 1 }
  }
  const installed = Array.isArray(config?.runtime?.installed) ? config.runtime.installed : []
  if (siteYml.runtime && installed.length && !installed.includes(siteYml.runtime)) {
    say.err(`Runtime ${siteYml.runtime} (from site.yml) is not installed on the backend.`)
    say.dim(`Installed: ${installed.join(', ') || '(none)'} — pin one of these in site.yml (\`runtime:\`), or have it installed on the backend.`)
    return { exitCode: 1 }
  }
  const runtimeVersion = siteYml.runtime || pickHighestRuntime(installed)
  if (!runtimeVersion) {
    say.err('Could not resolve a runtime version.')
    say.dim('Pin one with `runtime:` in site.yml, or install one on the backend so /dev/config reports it.')
    return { exitCode: 1 }
  }

  const languages = extractLanguages(siteYml)

  if (dryRun) {
    say.info('Dry run — would publish the synced site (its current backend state):')
    say.dim(`Backend     : ${client.origin}`)
    say.dim(`Site uuid   : ${uuid}`)
    say.dim(`Runtime     : ${runtimeVersion}${siteYml.runtime ? '' : ' (highest installed)'}`)
    if (languages) say.dim(`Languages   : ${languages.join(', ')}`)
    return { exitCode: 0 }
  }

  say.info(`Publishing the synced site to ${c.dim}${client.origin}${c.reset} …`)
  say.dim('Publishes the CURRENT backend state (incl. app-side edits) — run `uniweb push` first to include local edits.')
  let res
  try {
    res = await client.publishSite(uuid, { runtimeVersion, ...(languages ? { languages } : {}) })
  } catch (err) {
    say.err(`Could not reach the backend at ${client.origin}: ${err.message}`)
    say.dim('Set the origin with --backend <url> or UNIWEB_REGISTER_URL.')
    return { exitCode: 1 }
  }
  if (!res.ok) {
    if (res.status === 404) {
      say.err(`Site ${uuid} not found on the backend (404).`)
      say.dim('Sync it first with `uniweb push`, or use `uniweb deploy` for a file-only site.')
      return { exitCode: 1 }
    }
    say.err(`Publish rejected: HTTP ${res.status} ${res.statusText}`)
    if (res.status === 401 || res.status === 403) {
      say.dim("Credentials weren't accepted — run `uniweb login` (or pass --token <bearer>).")
    }
    const body = await res.text().catch(() => '')
    if (body) say.dim(body.slice(0, 800))
    return { exitCode: 1 }
  }
  let result
  try {
    result = await res.json()
  } catch {
    result = {}
  }

  const serveUrl = absolutizeServeUrl(client.origin, result.url)
  console.log('')
  say.ok(`Published ${c.bold}${uuid}${c.reset}${result.status ? ` (${result.status})` : ''}`)
  if (serveUrl) console.log(`  ${c.cyan}${serveUrl}${c.reset}`)
  if (result.deploy_uuid) say.dim(`deploy: ${result.deploy_uuid}`)
  return { exitCode: 0 }
}

// `release` was the rollout name; keep it as a deprecated alias so existing
// scripts keep working (the router prints a one-line deprecation note).
export const release = publish

export default publish
