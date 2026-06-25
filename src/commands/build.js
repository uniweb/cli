/**
 * Build Command
 *
 * Builds foundations with schema generation, or sites.
 *
 * Two site build pipelines are available, but they're INTERNAL vocabulary
 * after Phase 2 of the CLI ergonomics overhaul. Users see `uniweb publish`
 * (Uniweb hosting — runtime-linked), `uniweb deploy --host` (third-party host)
 * and `uniweb export` (self-contained bundle); the build command itself just
 * dispatches to whichever pipeline the caller requested.
 *
 *   --bundle (internal; called by `uniweb deploy --host` / `uniweb export`)
 *     Full vite + post-vite pipeline. Produces a static-host JS bundle
 *     (`dist/index.html`, `dist/entry.js`, `_importmap/*`, `_pages/*` for
 *     split mode, sitemap/robots/search-index, prerendered HTML when
 *     configured). Foundation is loaded by URL when site.yml's foundation
 *     is a registry ref; statically inlined when it's a workspace-local
 *     ref (the self-contained case).
 *
 *   --link (internal; called by `uniweb publish`)
 *     Data-only pipeline. No vite. Emits ONLY what Uniweb hosting
 *     needs: `dist/site-content.json` (with full sections),
 *     `dist/<lang>/site-content.json` per non-default locale,
 *     `dist/data/*.json` (collections), and `dist/assets/<media>` (images,
 *     fonts, video posters). The backend stitches runtime + foundation per
 *     request — the site's JS bundle would be dead weight.
 *
 * Bare `uniweb build` for a site defaults to --bundle (the historical
 * behavior). This is mostly useful for inspecting the build output during
 * development; for shipping, use `uniweb publish` (Uniweb hosting) or
 * `uniweb deploy --host` / `uniweb export` (third-party / self-contained).
 *
 * Usage:
 *   uniweb build                    # Build current directory (sites default to --bundle)
 *   uniweb build --target foundation # Explicitly build as foundation
 *   uniweb build --target site       # Explicitly build as site
 *   uniweb build --prerender         # Force pre-rendering
 *   uniweb build --no-prerender      # Skip pre-rendering
 *   uniweb build --host <name>       # Pick the host adapter for this build's
 *                                      postBuild step (e.g. cloudflare-pages,
 *                                      s3-cloudfront, github-pages,
 *                                      generic-static). Default: cloudflare-pages.
 *
 * Internal flags:
 *   --link              # Data-only pipeline (Uniweb hosting; called by `uniweb publish`)
 *   --bundle            # Full vite pipeline (third-party / self-contained; deploy --host / export)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, dirname, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

// Import build utilities from @uniweb/build
import {
  generateEntryPoint,
  discoverComponents,
  resolveFoundationSrcPath,
  classifyPackage,
  isExtensionPackage,
} from '@uniweb/build'
import { readSiteConfig } from '@uniweb/build/site'
import { readWorkspaceConfig, resolveGlob } from '../utils/config.js'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

function log(message) {
  console.log(message)
}

function success(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

function error(message) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

function info(message) {
  console.log(`${colors.cyan}→${colors.reset} ${message}`)
}

/**
 * Detect project type based on directory contents
 *
 * Detection priority:
 * 1. foundation.js → foundation
 * 2. site.yml → site
 * 3. src/components/ → foundation (fallback)
 * 4. pages/ → site (fallback)
 * 5. pnpm-workspace.yaml or package.json workspaces → workspace
 */
function detectProjectType(projectDir) {
  // Workspace check FIRST. A workspace root often co-exists with leaf-
  // package signals (the `src/` foundation lives inside it), so asking
  // the leaf classifier about a workspace root could yield 'foundation'
  // by coincidence. Workspace markers (pnpm-workspace.yaml, or
  // package.json::workspaces) are unambiguous.
  if (existsSync(join(projectDir, 'pnpm-workspace.yaml'))) {
    return 'workspace'
  }

  const packageJsonPath = join(projectDir, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      if (packageJson.workspaces) {
        return 'workspace'
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Foundation vs site: delegate to the canonical classifier in @uniweb/build.
  const kind = classifyPackage(projectDir)
  if (kind) return kind

  return null
}

/**
 * Run a command and return a promise
 */
function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with exit code ${code}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Resolve the project's local Vite binary.
 *
 * We intentionally do NOT fall back to `npx vite`: npx resolves through npm's
 * global cache, which may hold a stale Vite version (e.g. Vite 5 ignores
 * lib.fileName for CSS and always emits style.css). Using the project's local
 * Vite guarantees the version declared in package.json is the one that runs.
 *
 * @param {string} projectDir
 * @returns {string} Absolute path to the vite CLI entry
 */
function resolveLocalVite(projectDir) {
  const require = createRequire(join(projectDir, 'package.json'))
  let pkgJsonPath
  try {
    pkgJsonPath = require.resolve('vite/package.json')
  } catch {
    throw new Error(
      `Vite is not installed in ${projectDir}.\n` +
      `Run \`pnpm install\` (or npm/yarn install) in the project before building.`
    )
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.vite
  if (!binRel) {
    throw new Error(`Could not find vite bin entry in ${pkgJsonPath}`)
  }
  return join(dirname(pkgJsonPath), binRel)
}

/**
 * Run the project's local Vite with the given args.
 * @param {string} projectDir
 * @param {string[]} args - e.g. ['build']
 */
async function runLocalVite(projectDir, args) {
  const viteBin = resolveLocalVite(projectDir)
  await runCommand(process.execPath, [viteBin, ...args], projectDir)
}

/**
 * Build a foundation
 */
async function buildFoundation(projectDir, options = {}) {
  const srcDir = resolveFoundationSrcPath(projectDir)

  info('Building foundation...')

  // 1. Discover components
  log('')
  info('Discovering components...')
  const components = await discoverComponents(srcDir)
  const componentNames = Object.keys(components)

  if (componentNames.length === 0) {
    error('No components found with meta.js files')
    error(`Make sure components are in ${srcDir}/components/[Name]/ with a meta.js file`)
    process.exit(1)
  }

  success(`Found ${componentNames.length} components: ${componentNames.join(', ')}`)

  // 2. Generate entry point
  log('')
  info('Generating entry point...')
  const entryPath = join(srcDir, '_entry.generated.js')
  await generateEntryPoint(srcDir, entryPath)
  success('Generated _entry.generated.js')

  // 3. Build with Vite
  log('')
  info('Running Vite build...')

  // Check if vite.config.js uses the generated entry
  // For now, just run the standard vite build
  await runLocalVite(projectDir, ['build'])

  // Vite's foundation plugin generates dist/meta/schema.json
  // and processes preview images during the build.

  success('Vite build complete')

  // Summary
  log('')
  log(`${colors.green}${colors.bright}Build complete!${colors.reset}`)

  log('')
  log(`${colors.bright}Share with clients:${colors.reset}`)
  log(`  ${colors.bright}uniweb publish${colors.reset}              Register your foundation (one-time setup)`)
  log(`  ${colors.bright}uniweb handoff <email>${colors.reset}      Hand off a site to a client`)
}

/**
 * Ensure a local foundation's `dist/entry.js` is current.
 *
 * Bundle mode reads a local foundation from disk (vite imports it, prerender
 * loads dist/entry.js for SSG), so the foundation must be built and current.
 * Otherwise the verb fails with "Foundation not found at .../dist/entry.js" or
 * silently ships stale artifacts. (Link mode does NOT read the built foundation
 * — it forwards only the `foundation:` ref to the backend and ships no
 * foundation code — so buildSiteLink does not call this.)
 *
 * `buildWorkspace()` already cascades when invoked from a workspace root,
 * but verbs invoked from a site directory (`uniweb build` in `sites/x/`,
 * `uniweb deploy`, `uniweb export`) used to skip the cascade and rely on
 * the user having pre-built the foundation. That broke fresh checkouts
 * where the foundation has never been built locally.
 *
 * This helper is idempotent: when the workspace-root cascade has already
 * run, the freshness check sees a current `dist/entry.js` and returns
 * without rebuilding. So calling it inside `buildSite()` does not
 * double-build under `buildWorkspace()`.
 *
 * Freshness rule: a built artifact (`dist/entry.js` or the legacy
 * `dist/foundation.js`) exists AND its mtime is >= the newest mtime of
 * any tracked source file. Tracked sources: every file under
 * `<foundation>/src/`, plus root-level `package.json`, `foundation.js`,
 * `meta.js` (the structural files that drive entry generation and
 * schema). Build outputs and node_modules are skipped.
 *
 * Both artifact names are accepted because the foundation build emitter
 * was renamed `dist/foundation.js → dist/entry.js` in `@uniweb/build`
 * v0.14.3. A foundation built with an older @uniweb/build still produces
 * the legacy name; we don't want the cascade to keep rebuilding such a
 * foundation forever just because the new name is missing.
 */
async function ensureFoundationFresh(foundationDir, label = 'foundation') {
  const distArtifact = findFoundationDistArtifact(foundationDir)

  if (!distArtifact) {
    info(`Local ${label} not built yet — building ${basename(foundationDir)} first`)
    log('')
    await buildFoundation(foundationDir)
    log('')
    return { built: true, reason: 'missing' }
  }

  const distMtime = statSync(distArtifact).mtimeMs
  const stale = isFoundationSourceNewerThan(foundationDir, distMtime)

  if (stale) {
    info(`Local ${label} sources changed — rebuilding ${basename(foundationDir)}`)
    log('')
    await buildFoundation(foundationDir)
    log('')
    return { built: true, reason: 'stale' }
  }

  return { built: false, reason: 'fresh' }
}

/**
 * Locate the foundation's built entry artifact. Returns the path of the
 * first match, or null when neither file exists. Prefers the current
 * name (`dist/entry.js`) over the legacy one (`dist/foundation.js`).
 */
function findFoundationDistArtifact(foundationDir) {
  for (const name of ['entry.js', 'foundation.js']) {
    const p = join(foundationDir, 'dist', name)
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Returns true if any tracked foundation source file has an mtime newer
 * than `referenceMtime`. Walks `<foundationDir>/src/` recursively (skipping
 * dotfiles, node_modules, and dist). Also stats the root structural files.
 */
function isFoundationSourceNewerThan(foundationDir, referenceMtime) {
  const rootFiles = ['package.json', 'foundation.js', 'meta.js']
  for (const f of rootFiles) {
    const p = join(foundationDir, f)
    if (existsSync(p) && statSync(p).mtimeMs > referenceMtime) return true
  }

  const srcDir = join(foundationDir, 'src')
  if (!existsSync(srcDir)) return false

  const stack = [srcDir]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!e.isFile()) continue
      try {
        if (statSync(full).mtimeMs > referenceMtime) return true
      } catch { /* ignore */ }
    }
  }

  return false
}

/**
 * Load site i18n configuration
 *
 * Resolves locales from config:
 * - undefined → all available locales (from locales/*.json)
 * - '*' → explicitly all available locales
 * - ['es', 'fr'] → only those specific locales
 */
async function loadI18nConfig(projectDir, siteConfig = null) {
  const config = siteConfig || readSiteConfig(projectDir)

  const localesDir = config.i18n?.localesDir || 'locales'
  const localesPath = join(projectDir, localesDir)

  // Resolve locales (undefined/'*' → all available, array → specific)
  const { resolveLocales } = await import('@uniweb/build/i18n')
  const locales = await resolveLocales(config.languages, localesPath)

  if (locales.length === 0) return null

  return {
    defaultLocale: config.defaultLanguage || 'en',
    locales,
    localesDir,
  }
}

/**
 * Build localized content for all configured locales
 */
async function buildLocalizedContent(projectDir, i18nConfig) {
  const { buildLocalizedContent } = await import('@uniweb/build/i18n')

  const outputs = await buildLocalizedContent(projectDir, {
    localesDir: i18nConfig.localesDir,
    locales: i18nConfig.locales,
    outputDir: join(projectDir, 'dist'),
    fallbackToSource: true,
  })

  return outputs
}

/**
 * Generate index.html for each locale with hreflang tags
 */
async function generateLocalizedHtml(projectDir, i18nConfig) {
  const { readFile, writeFile, mkdir, copyFile } = await import('node:fs/promises')
  const distDir = join(projectDir, 'dist')
  const baseHtmlPath = join(distDir, 'index.html')

  if (!existsSync(baseHtmlPath)) {
    return
  }

  let baseHtml = await readFile(baseHtmlPath, 'utf-8')

  // Build hreflang tags
  const hreflangTags = i18nConfig.locales.map(locale =>
    `<link rel="alternate" hreflang="${locale}" href="/${locale}/" />`
  ).join('\n    ')

  const defaultHreflang = `<link rel="alternate" hreflang="x-default" href="/" />`
  const allHreflangTags = `${hreflangTags}\n    ${defaultHreflang}`

  // Add hreflang to base HTML (for default locale)
  if (!baseHtml.includes('hreflang')) {
    baseHtml = baseHtml.replace('</head>', `    ${allHreflangTags}\n  </head>`)
    await writeFile(baseHtmlPath, baseHtml)
  }

  // Generate index.html for each locale
  for (const locale of i18nConfig.locales) {
    const localeDir = join(distDir, locale)
    await mkdir(localeDir, { recursive: true })

    // Read locale-specific site-content.json
    const localeContentPath = join(localeDir, 'site-content.json')
    let localeHtml = baseHtml

    // Update html lang attribute
    localeHtml = localeHtml.replace(/<html[^>]*lang="[^"]*"/, `<html lang="${locale}"`)
    if (!localeHtml.includes('lang=')) {
      localeHtml = localeHtml.replace('<html', `<html lang="${locale}"`)
    }

    // Update script src for locale-specific content if inlined
    if (existsSync(localeContentPath)) {
      const localeContent = await readFile(localeContentPath, 'utf-8')
      // Replace the inlined content if present
      localeHtml = localeHtml.replace(
        /<script[^>]*id="__SITE_CONTENT__"[^>]*>[\s\S]*?<\/script>/,
        `<script type="application/json" id="__SITE_CONTENT__">${localeContent}</script>`
      )
    }

    await writeFile(join(localeDir, 'index.html'), localeHtml)
  }
}

/**
 * Resolve foundation directory based on site config and project structure
 *
 * Priority:
 * 1. Read site's package.json to find foundation dependency path (most reliable)
 * 2. Check foundations/{name} for multi-site projects
 * 3. Check ../foundation for single-site projects
 * 4. Check ../{name} as fallback
 */
function resolveFoundationDir(projectDir, siteConfig) {
  const foundationName = siteConfig?.foundation

  // First, try to resolve from site's package.json dependencies
  // This is the most reliable method as it matches how Vite resolves imports
  if (foundationName) {
    const pkgPath = join(projectDir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        const depValue = deps[foundationName]

        // Check for file: protocol (local dependency)
        if (depValue && depValue.startsWith('file:')) {
          const relativePath = depValue.slice(5) // Remove 'file:' prefix
          const resolvedPath = join(projectDir, relativePath)
          if (existsSync(resolvedPath)) {
            return resolvedPath
          }
        }
      } catch {
        // Ignore JSON parse errors, fall through to other methods
      }
    }
  }

  // Check if we're in a multi-site structure (site is under sites/)
  const parentDir = join(projectDir, '..')
  const grandParentDir = join(projectDir, '..', '..')
  const isMultiSite = parentDir.endsWith('/sites') || parentDir.endsWith('\\sites')

  if (isMultiSite && foundationName) {
    // Multi-site: look for foundations/{name}
    const multiFoundationDir = join(grandParentDir, 'foundations', foundationName)
    if (existsSync(multiFoundationDir)) {
      return multiFoundationDir
    }
  }

  // Single site: ../foundation
  const singleFoundationDir = join(projectDir, '..', 'foundation')
  if (existsSync(singleFoundationDir)) {
    return singleFoundationDir
  }

  // Fallback: try to find by foundation name in parent
  if (foundationName) {
    const namedFoundationDir = join(parentDir, foundationName)
    if (existsSync(namedFoundationDir)) {
      return namedFoundationDir
    }
  }

  // Ultimate fallback
  return singleFoundationDir
}

/**
 * Build a site in link mode — data only, no vite.
 *
 * Emits exactly what `uniweb publish` ships to Uniweb hosting:
 *   dist/site-content.json (full sections inlined)
 *   dist/<lang>/site-content.json per non-default locale
 *   dist/data/<collection>.json (+ per-record files for `deferred:`)
 *   dist/assets/<media> (processed images, video posters, PDF thumbnails)
 *
 * Does NOT emit HTML, JS, CSS, source maps, _importmap chunks, or
 * static-host extras (sitemap, robots, search-index, _pages/*) — none
 * of these are consumed on the link-mode deploy path. The worker
 * generates HTML at request time and re-derives split-content per-page
 * files from the full payload it receives.
 *
 * The `buildLocalizedContent` step is the same call bundle mode makes
 * post-vite, so multi-locale sites get identical per-locale outputs in
 * either mode. Collection translation (`buildLocalizedCollections`)
 * also runs here so deploy ships translated collection JSONs.
 *
 * Bug surfaced + fixed by routing deploy through this path: the bundle
 * pipeline's prerender step rewrites `dist/site-content.json` into a
 * lightweight manifest (sections stripped) when split-content is active,
 * and deploy was reading that stripped version, causing the worker to
 * mis-detect split and serve blank pages. Link mode skips prerender
 * entirely; `dist/site-content.json` keeps full sections; the worker
 * splits correctly.
 */
async function buildSiteLink(projectDir, options = {}) {
  const { siteConfig = null } = options

  info('Building site (link mode)...')

  const { buildSiteData } = await import('@uniweb/build/site')
  const distDir = join(projectDir, 'dist')

  // Resolve the local foundation path so collectSiteContent can pick up
  // theme variable defaults from `foundation.js::theme.vars`. When the
  // foundation is purely a registry ref (no local sibling), this stays
  // null and theme defaults come from theme.yml only.
  const foundationDir = await resolveFoundationDirForSite(projectDir, siteConfig).catch(() => null)

  // Link mode does NOT (re)build the foundation. It reads only the
  // foundation's SOURCE config (foundation.js::theme.vars, passed as
  // foundationPath below) for theme defaults, and ships NO foundation code —
  // the backend serves the foundation from the registry by the `foundation:`
  // ref. (Bundle mode is the one that needs a current dist/entry.js — see
  // buildSite — so the ensureFoundationFresh cascade lives there, not here.)

  await buildSiteData({
    siteRoot: projectDir,
    distDir,
    foundationPath: foundationDir,
    assets: siteConfig?.build?.assets || {},
  })
  success(`Wrote ${join('dist', 'site-content.json')}`)

  // Per-locale variants — same call bundle mode makes post-vite. Both
  // modes produce identical `dist/<lang>/site-content.json` outputs so
  // the deploy CLI walks the same path shape regardless of mode.
  const i18nConfig = await loadI18nConfig(projectDir, siteConfig)
  if (i18nConfig && i18nConfig.locales.length > 0) {
    log('')
    info(`Building localized content for: ${i18nConfig.locales.join(', ')}`)
    try {
      const outputs = await buildLocalizedContent(projectDir, i18nConfig)
      success(`Generated ${Object.keys(outputs).length} locale(s)`)
      for (const [locale] of Object.entries(outputs)) {
        log(`  ${colors.dim}dist/${locale}/site-content.json${colors.reset}`)
      }

      // Collection translations — optional; don't fail the build if
      // missing. Bundle mode does the same.
      try {
        const { buildLocalizedCollections } = await import('@uniweb/build/i18n')
        const collectionOutputs = await buildLocalizedCollections(projectDir, {
          locales: i18nConfig.locales,
          outputDir: distDir,
          collectionsLocalesDir: join(projectDir, i18nConfig.localesDir, 'collections'),
        })
        const collectionCount = Object.values(collectionOutputs).reduce(
          (sum, localeOutputs) => sum + Object.keys(localeOutputs).length,
          0
        )
        if (collectionCount > 0) {
          success(`Translated collections for ${Object.keys(collectionOutputs).length} locale(s)`)
        }
      } catch (err) {
        if (process.env.UNIWEB_DEBUG) console.error('Collection translation:', err.message)
      }
    } catch (err) {
      error(`i18n build failed: ${err.message}`)
      if (process.env.UNIWEB_DEBUG) console.error(err.stack)
      log(`${colors.yellow}Continuing without localized content${colors.reset}`)
    }
  }

  log('')
  log(`${colors.green}${colors.bright}Build complete (link mode)${colors.reset}`)
}

/**
 * Best-effort resolution of the local foundation directory for a site,
 * used by `buildSiteLink` to pass `foundationPath` to the data pipeline.
 *
 * Mirrors a subset of `@uniweb/build`'s `detectFoundationType` semantics:
 * when the site declares `foundation: <name>` and a sibling/file: dep
 * resolves to a local foundation, return its path. When the foundation
 * is a registry ref or URL, return null (data pipeline still works
 * without a local foundation; theme defaults just come from theme.yml).
 */
async function resolveFoundationDirForSite(siteDir, siteConfig) {
  const cfg = siteConfig || readSiteConfig(siteDir)
  const foundation = cfg?.foundation
  if (!foundation || typeof foundation !== 'string') return null
  // Registry ref or URL — no local foundation.
  if (/^@[a-z0-9_-]+\/[a-z0-9_-]+@/.test(foundation)) return null
  if (foundation.startsWith('http://') || foundation.startsWith('https://')) return null

  // Workspace sibling.
  const sibling = resolve(siteDir, '..', foundation)
  if (existsSync(sibling)) return sibling

  // file: dep declared in package.json.
  try {
    const pkg = JSON.parse(readFileSync(join(siteDir, 'package.json'), 'utf-8'))
    const dep = pkg.dependencies?.[foundation]
    if (typeof dep === 'string' && dep.startsWith('file:')) {
      const filePath = resolve(siteDir, dep.slice(5))
      if (existsSync(filePath)) return filePath
    }
  } catch { /* no package.json or malformed — fall through */ }

  return null
}

/**
 * Build a site
 */
async function buildSite(projectDir, options = {}) {
  const { prerender = false, foundationDir, siteConfig = null, host = null } = options

  info('Building site...')

  // Cascade: bundle mode imports the foundation through vite, and (when
  // prerender is on) loads dist/entry.js for SSG. A local foundation must
  // therefore be current. Idempotent under buildWorkspace() — when the
  // workspace cascade has already built it, the freshness check no-ops.
  if (foundationDir) await ensureFoundationFresh(foundationDir)

  // Run vite build for sites
  await runLocalVite(projectDir, ['build'])

  success('Site build complete')

  // Check for i18n configuration
  const i18nConfig = await loadI18nConfig(projectDir, siteConfig)

  if (i18nConfig && i18nConfig.locales.length > 0) {
    log('')
    info(`Building localized content for: ${i18nConfig.locales.join(', ')}`)

    try {
      // Generate locale-specific site-content.json
      const outputs = await buildLocalizedContent(projectDir, i18nConfig)

      // Generate locale-specific index.html files
      await generateLocalizedHtml(projectDir, i18nConfig)

      success(`Generated ${Object.keys(outputs).length} locale(s)`)

      for (const [locale, path] of Object.entries(outputs)) {
        log(`  ${colors.dim}dist/${locale}/site-content.json${colors.reset}`)
      }

      // Translate collections if they exist
      try {
        const { buildLocalizedCollections } = await import('@uniweb/build/i18n')

        const collectionOutputs = await buildLocalizedCollections(projectDir, {
          locales: i18nConfig.locales,
          outputDir: join(projectDir, 'dist'),
          collectionsLocalesDir: join(projectDir, i18nConfig.localesDir, 'collections')
        })

        // Count collections translated
        const collectionCount = Object.values(collectionOutputs).reduce(
          (sum, localeOutputs) => sum + Object.keys(localeOutputs).length, 0
        )

        if (collectionCount > 0) {
          success(`Translated collections for ${Object.keys(collectionOutputs).length} locale(s)`)
        }
      } catch (err) {
        // Collection translation is optional, don't fail build
        if (process.env.UNIWEB_DEBUG) {
          console.error('Collection translation:', err.message)
        }
      }
    } catch (err) {
      error(`i18n build failed: ${err.message}`)
      if (process.env.UNIWEB_DEBUG) {
        console.error(err.stack)
      }
      // Don't fail the build, just warn
      log(`${colors.yellow}Continuing without localized content${colors.reset}`)
    }
  }

  // Pre-render if requested
  if (prerender) {
    log('')
    info('Pre-rendering pages to static HTML (SSG)...')

    try {
      const { prerenderSite } = await import('@uniweb/build/prerender')

      const result = await prerenderSite(projectDir, {
        foundationDir: foundationDir || resolveFoundationDir(projectDir, siteConfig),
        host,
        onProgress: (msg) => log(`  ${colors.dim}${msg}${colors.reset}`)
      })

      success(`Pre-rendered ${result.pages} page${result.pages !== 1 ? 's' : ''} to static HTML`)

      // Summary
      log('')
      log(`${colors.green}${colors.bright}SSG Build complete!${colors.reset}`)
      log('')
      log(`Output:`)
      for (const file of result.files) {
        const relativePath = file.replace(projectDir + '/', '')
        log(`  ${colors.dim}${relativePath}${colors.reset}`)
      }
    } catch (err) {
      error(`Pre-rendering failed: ${err.message}`)

      // Provide helpful guidance for common errors
      if (err.message.includes('Foundation not found')) {
        log('')
        log(`${colors.yellow}This usually means:${colors.reset}`)
        log(`  1. The foundation hasn't been built yet (run foundation build first)`)
        log(`  2. The foundation name in site.yml doesn't match your setup`)
        log('')
        log(`${colors.dim}Check that:${colors.reset}`)
        log(`  • site.yml 'foundation:' matches the package name in your foundation's package.json`)
        log(`  • site's package.json has a dependency pointing to the correct foundation path`)
        log(`  • The foundation's dist/entry.js exists (build the foundation first)`)
      }

      if (process.env.UNIWEB_DEBUG) {
        console.error(err.stack)
      }
      process.exit(1)
    }
  }

  showNextSteps(false, true)
}

/**
 * Check if a directory is a foundation
 */
function isFoundation(dir) {
  return classifyPackage(dir) === 'foundation'
}

/**
 * Check if a foundation directory declares extension: true in its
 * authored declarations file (main.js or legacy foundation.js).
 */
function isExtensionDir(dir) {
  return isExtensionPackage(dir)
}

/**
 * Check if a directory is a site
 */
function isSite(dir) {
  return classifyPackage(dir) === 'site'
}

/**
 * Discover workspace packages based on workspace config (pnpm-workspace.yaml globs)
 */
async function discoverWorkspacePackages(workspaceDir) {
  const foundations = []
  const extensions = []
  const sites = []

  const { packages } = await readWorkspaceConfig(workspaceDir)

  for (const pattern of packages) {
    const dirs = await resolveGlob(workspaceDir, pattern)
    for (const dir of dirs) {
      const fullPath = join(workspaceDir, dir)
      const name = dir.split('/').pop()

      if (isFoundation(fullPath)) {
        if (isExtensionDir(fullPath)) {
          extensions.push({ name, path: fullPath })
        } else {
          foundations.push({ name, path: fullPath })
        }
      } else if (isSite(fullPath)) {
        sites.push({ name, path: fullPath })
      }
    }
  }

  return { foundations, extensions, sites }
}

/**
 * Build all packages in a workspace
 */
async function buildWorkspace(workspaceDir, options = {}) {
  const { prerenderFlag, noPrerenderFlag, host = null } = options

  log(`${colors.cyan}${colors.bright}Building workspace...${colors.reset}`)
  log('')

  const { foundations, extensions, sites } = await discoverWorkspacePackages(workspaceDir)

  if (foundations.length === 0 && extensions.length === 0 && sites.length === 0) {
    error('No foundations, extensions, or sites found in workspace')
    log('')
    log('Expected structure (matching pnpm-workspace.yaml globs):')
    log('  foundation/       or  foundations/*/')
    log('  site/             or  sites/*/')
    log('  */foundation      +  */site          (co-located)')
    log('  extensions/*/')
    process.exit(1)
  }

  // Build foundations first (sites depend on them)
  for (const foundation of foundations) {
    log(`${colors.bright}[${foundation.name}]${colors.reset}`)
    await buildFoundation(foundation.path)
    log('')
  }

  // Build extensions (they are foundations, but logged distinctly)
  for (const extension of extensions) {
    const label = isExtensionDir(extension.path) ? 'extension' : 'foundation'
    log(`${colors.bright}[${extension.name}]${colors.reset} ${colors.dim}(${label})${colors.reset}`)
    await buildFoundation(extension.path)
    log('')
  }

  // Build sites
  for (const site of sites) {
    log(`${colors.bright}[${site.name}]${colors.reset}`)

    const siteConfig = readSiteConfig(site.path)
    const configPrerender = siteConfig.build?.prerender === true

    let prerender = configPrerender
    if (prerenderFlag) prerender = true
    if (noPrerenderFlag) prerender = false

    // Resolve foundation directory for this site
    const foundationDir = resolveFoundationDir(site.path, siteConfig)

    await buildSite(site.path, { prerender, foundationDir, siteConfig, host })
    log('')
  }

  // Summary
  const totalBuilt = foundations.length + extensions.length + sites.length
  const parts = []
  if (foundations.length > 0) parts.push(`${foundations.length} foundation(s)`)
  if (extensions.length > 0) parts.push(`${extensions.length} extension(s)`)
  if (sites.length > 0) parts.push(`${sites.length} site(s)`)

  log(`${colors.green}${colors.bright}Workspace build complete!${colors.reset}`)
  log('')
  log(`Built ${parts.join(', ')}`)

  showNextSteps(foundations.length > 0, sites.length > 0)
}

/**
 * Show next-step hints after workspace build
 */
function showNextSteps(hasFoundations, hasSites) {
  if (hasFoundations) {
    log('')
    log(`${colors.bright}Share with clients:${colors.reset}`)
    log(`  ${colors.bright}uniweb register${colors.reset}             Release your foundation to the catalog (alias: uniweb release)`)
    log(`  ${colors.bright}uniweb handoff <email>${colors.reset}      Hand off a site to a client`)
  }
  if (hasSites) {
    log('')
    log(`${colors.bright}Ship a site:${colors.reset}`)
    log(`  ${colors.bright}uniweb publish${colors.reset}            Uniweb hosting (brings the foundation along)`)
    log(`  ${colors.bright}uniweb deploy --host${colors.reset}=…    Third-party host`)
    log(`  Or upload ${colors.cyan}dist/${colors.reset} (\`uniweb export\`) to any static host`)
  }
}

/**
 * Main build command handler
 */
export async function build(args = []) {
  const projectDir = process.cwd()

  // Parse arguments
  let targetType = null
  const targetIndex = args.indexOf('--target')
  if (targetIndex !== -1 && args[targetIndex + 1]) {
    targetType = args[targetIndex + 1]
    if (!['foundation', 'site'].includes(targetType)) {
      error(`Invalid target: ${targetType}`)
      log('Valid targets: foundation, site')
      process.exit(1)
    }
  }

  // Check for --prerender / --no-prerender flags
  const prerenderFlag = args.includes('--prerender')
  const noPrerenderFlag = args.includes('--no-prerender')

  // Internal flags — called by `uniweb publish` (always --link) and
  // `uniweb deploy --host` / `uniweb export` (always --bundle). After Phase 2
  // of the CLI ergonomics overhaul, users don't see these flags directly; they
  // pick the verb (publish vs deploy vs export) and the corresponding
  // pipeline runs. Bare `uniweb build` for a site defaults to --bundle
  // (mostly used during development to inspect the vite output).
  const linkFlag = args.includes('--link')
  const bundleFlag = args.includes('--bundle')
  if (linkFlag && bundleFlag) {
    error('Cannot pass both --link and --bundle (they select different build pipelines)')
    process.exit(1)
  }

  // Check for --foundation-dir flag (for prerendering)
  let foundationDir = null
  const foundationDirIndex = args.indexOf('--foundation-dir')
  if (foundationDirIndex !== -1 && args[foundationDirIndex + 1]) {
    foundationDir = resolve(args[foundationDirIndex + 1])
  }

  // --host names the host adapter for this build's prerender step.
  // Default = 'cloudflare-pages' (resolved inside prerender.js, via the
  // registry). Build does not read deploy.yml; that is the deploy
  // orchestrator's job.
  //
  // `--host` with no value → interactive picker (errors in CI / non-TTY).
  const { readFlagValue } = await import('../utils/args.js')
  const hostFlag = readFlagValue(args, '--host')
  let host = null
  if (hostFlag === null) {
    const { promptForHost } = await import('../utils/host-prompt.js')
    try {
      host = await promptForHost({ args })
    } catch (err) {
      error(err.message)
      process.exit(1)
    }
  } else if (typeof hostFlag === 'string') {
    host = hostFlag
  }

  // Auto-detect project type if not specified
  if (!targetType) {
    targetType = detectProjectType(projectDir)

    if (!targetType) {
      error('Could not detect project type')
      log('Use --target foundation or --target site, or run from workspace root')
      process.exit(1)
    }

    if (targetType !== 'workspace') {
      info(`Detected project type: ${targetType}`)
    }
  }

  // Validate prerender flags are only used with site/workspace target
  if ((prerenderFlag || noPrerenderFlag) && targetType === 'foundation') {
    error('--prerender/--no-prerender can only be used with site or workspace builds')
    process.exit(1)
  }

  // Validate --link / --bundle are only used with site target.
  // (Foundation builds have no equivalent split — they always produce
  // dist/entry.js + schema.json regardless of how a downstream
  // site consumes the result.)
  if ((linkFlag || bundleFlag) && targetType === 'foundation') {
    error('--link and --bundle apply to site builds only')
    process.exit(1)
  }

  // Run appropriate build
  try {
    if (targetType === 'workspace') {
      await buildWorkspace(projectDir, { prerenderFlag, noPrerenderFlag, host })
    } else if (targetType === 'foundation') {
      await buildFoundation(projectDir)
    } else {
      // For sites, read config to determine prerender default
      const siteConfig = readSiteConfig(projectDir)

      // Link mode: data-only pipeline, no vite. The deployed Uniweb-edge
      // site never consumes the JS bundle, so we skip producing it.
      // Worker generates HTML at request time using its own runtime +
      // the foundation served from the registry. See
      // `framework/build/src/site/build-site-data.js` for what gets
      // emitted (and what doesn't).
      if (linkFlag) {
        if (prerenderFlag) {
          error('--prerender does not apply to link mode (no static HTML is produced)')
          process.exit(1)
        }
        await buildSiteLink(projectDir, { siteConfig })
        return
      }

      // Bundle mode (default for sites, or explicit --bundle).
      const configPrerender = siteConfig.build?.prerender === true

      // CLI flags override config: --prerender forces on, --no-prerender forces off
      let prerender = configPrerender
      if (prerenderFlag) prerender = true
      if (noPrerenderFlag) prerender = false

      // If `--foundation-dir` wasn't passed, resolve the local foundation
      // from site.yml + package.json. Required so buildSite() can cascade
      // to the local foundation when the user runs `uniweb build` from a
      // site dir on a fresh checkout where dist/ doesn't exist yet.
      const resolvedFoundationDir =
        foundationDir
        || (await resolveFoundationDirForSite(projectDir, siteConfig).catch(() => null))

      await buildSite(projectDir, {
        prerender,
        foundationDir: resolvedFoundationDir,
        siteConfig,
        host,
      })
    }
  } catch (err) {
    error(err.message)
    process.exit(1)
  }
}

export default build
