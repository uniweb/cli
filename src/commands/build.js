/**
 * Build Command
 *
 * Builds foundations with schema generation.
 *
 * Usage:
 *   uniweb build                    # Build current directory
 *   uniweb build --target foundation # Explicitly build as foundation
 *   uniweb build --target site       # Explicitly build as site
 *   uniweb build --prerender         # Build site + pre-render to static HTML (SSG)
 */

import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

// Import build utilities from @uniweb/build
import {
  generateEntryPoint,
  buildSchema,
  discoverComponents,
  processAllPreviews,
} from '@uniweb/build'

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
 */
function detectProjectType(projectDir) {
  const srcDir = join(projectDir, 'src')
  const componentsDir = join(srcDir, 'components')
  const pagesDir = join(projectDir, 'pages')

  // Foundation: has src/components/ with component folders containing meta.js
  if (existsSync(componentsDir)) {
    return 'foundation'
  }

  // Site: has pages/ directory
  if (existsSync(pagesDir)) {
    return 'site'
  }

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
 * Build a foundation
 */
async function buildFoundation(projectDir, options = {}) {
  const srcDir = join(projectDir, 'src')
  const distDir = join(projectDir, 'dist')

  info('Building foundation...')

  // 1. Discover components
  log('')
  info('Discovering components...')
  const components = await discoverComponents(srcDir)
  const componentNames = Object.keys(components)

  if (componentNames.length === 0) {
    error('No components found with meta.js files')
    error('Make sure components are in src/components/[Name]/ with a meta.js file')
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
  await runCommand('npx', ['vite', 'build'], projectDir)

  success('Vite build complete')

  // 4. Generate schema.json
  log('')
  info('Generating schema.json...')
  let schema = await buildSchema(srcDir)

  await mkdir(distDir, { recursive: true })

  // 5. Process preview images
  log('')
  info('Processing preview images...')
  const isProduction = process.env.NODE_ENV === 'production' || !process.env.NODE_ENV
  const { schema: updatedSchema, totalImages } = await processAllPreviews(
    srcDir,
    distDir,
    schema,
    isProduction
  )
  schema = updatedSchema

  if (totalImages > 0) {
    success(`Processed ${totalImages} preview image${totalImages > 1 ? 's' : ''} (converted to webp)`)
  } else {
    log(`  ${colors.dim}No preview images found${colors.reset}`)
  }

  // 6. Write schema.json
  const schemaPath = join(distDir, 'schema.json')
  await writeFile(schemaPath, JSON.stringify(schema, null, 2), 'utf-8')

  success(`Generated schema.json with ${componentNames.length} components`)

  // Summary
  log('')
  log(`${colors.green}${colors.bright}Build complete!${colors.reset}`)
  log('')
  log(`Output:`)
  log(`  ${colors.dim}dist/foundation.js${colors.reset}    - Bundled components`)
  log(`  ${colors.dim}dist/assets/style.css${colors.reset} - Compiled CSS`)
  log(`  ${colors.dim}dist/schema.json${colors.reset}      - Component schemas`)
  if (totalImages > 0) {
    log(`  ${colors.dim}dist/assets/[component]/${colors.reset} - Preview images`)
  }
}

/**
 * Load site configuration from site.yml
 */
async function loadSiteConfig(projectDir) {
  const siteYmlPath = join(projectDir, 'site.yml')
  if (!existsSync(siteYmlPath)) return {}

  const { readFile } = await import('node:fs/promises')
  const yaml = await import('js-yaml')
  const content = await readFile(siteYmlPath, 'utf-8')
  return yaml.load(content) || {}
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
  const config = siteConfig || await loadSiteConfig(projectDir)

  const localesDir = config.i18n?.localesDir || 'locales'
  const localesPath = join(projectDir, localesDir)

  // Resolve locales (undefined/'*' → all available, array → specific)
  const { resolveLocales } = await import('@uniweb/build/i18n')
  const locales = await resolveLocales(config.i18n?.locales, localesPath)

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
        /<script id="__SITE_CONTENT__"[^>]*>[\s\S]*?<\/script>/,
        `<script id="__SITE_CONTENT__" type="application/json">${localeContent}</script>`
      )
    }

    await writeFile(join(localeDir, 'index.html'), localeHtml)
  }
}

/**
 * Build a site
 */
async function buildSite(projectDir, options = {}) {
  const { prerender = false, foundationDir, siteConfig = null } = options

  info('Building site...')

  // Run vite build for sites
  await runCommand('npx', ['vite', 'build'], projectDir)

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
    } catch (err) {
      error(`i18n build failed: ${err.message}`)
      if (process.env.DEBUG) {
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
        foundationDir: foundationDir || join(projectDir, '..', 'foundation'),
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
      if (process.env.DEBUG) {
        console.error(err.stack)
      }
      process.exit(1)
    }
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

  // Check for --foundation-dir flag (for prerendering)
  let foundationDir = null
  const foundationDirIndex = args.indexOf('--foundation-dir')
  if (foundationDirIndex !== -1 && args[foundationDirIndex + 1]) {
    foundationDir = resolve(args[foundationDirIndex + 1])
  }

  // Auto-detect project type if not specified
  if (!targetType) {
    targetType = detectProjectType(projectDir)

    if (!targetType) {
      error('Could not detect project type')
      log('Use --target foundation or --target site')
      process.exit(1)
    }

    info(`Detected project type: ${targetType}`)
  }

  // Validate prerender flags are only used with site target
  if ((prerenderFlag || noPrerenderFlag) && targetType !== 'site') {
    error('--prerender/--no-prerender can only be used with site builds')
    process.exit(1)
  }

  // Run appropriate build
  try {
    if (targetType === 'foundation') {
      await buildFoundation(projectDir)
    } else {
      // For sites, read config to determine prerender default
      const siteConfig = await loadSiteConfig(projectDir)
      const configPrerender = siteConfig.build?.prerender === true

      // CLI flags override config: --prerender forces on, --no-prerender forces off
      let prerender = configPrerender
      if (prerenderFlag) prerender = true
      if (noPrerenderFlag) prerender = false

      await buildSite(projectDir, { prerender, foundationDir, siteConfig })
    }
  } catch (err) {
    error(err.message)
    process.exit(1)
  }
}

export default build
