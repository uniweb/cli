/**
 * i18n CLI Commands
 *
 * Commands for managing site content internationalization.
 *
 * Usage:
 *   uniweb i18n extract             Extract/update translatable strings (default)
 *   uniweb i18n generate [locales]  Generate starter locale files from manifest
 *   uniweb i18n status              Show translation coverage per locale
 *   uniweb i18n --target <path>     Specify site directory explicitly
 *
 * Aliases: sync → extract, init → generate
 *
 * When run from workspace root, auto-detects sites. If multiple exist,
 * prompts for selection.
 */

import { resolve, join, dirname, basename, relative } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir, readdir, unlink, rename } from 'fs/promises'
import yaml from 'js-yaml'
import {
  isWorkspaceRoot,
  findSites,
  promptSelect,
} from '../utils/workspace.js'

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

function warn(message) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`)
}

function error(message) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

/**
 * Parse --target option from args
 */
function parseTargetOption(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' || args[i] === '-t') {
      return {
        target: args[i + 1],
        remainingArgs: [...args.slice(0, i), ...args.slice(i + 2)],
      }
    }
  }
  return { target: null, remainingArgs: args }
}

/**
 * Main i18n command handler
 * @param {string[]} args - Command arguments
 */
export async function i18n(args) {
  const subcommand = args[0]

  if (subcommand === '--help' || subcommand === '-h') {
    showHelp()
    return
  }

  // Parse --target option
  const { target, remainingArgs } = parseTargetOption(args)

  // Default to 'extract' if no subcommand (or if first arg is an option)
  const firstArg = remainingArgs[0]
  const effectiveSubcommand = !firstArg || firstArg.startsWith('-') ? 'extract' : firstArg
  const effectiveArgs = !firstArg || firstArg.startsWith('-') ? remainingArgs : remainingArgs.slice(1)

  // Find site root
  const siteRoot = await findSiteRoot(target)
  if (!siteRoot) {
    error('Could not find site root. Make sure you are in a Uniweb site directory.')
    process.exit(1)
  }

  // Load site config for locale settings
  const config = await loadSiteConfig(siteRoot)

  switch (effectiveSubcommand) {
    case 'extract':
    case 'sync':
      await runExtract(siteRoot, config, effectiveArgs)
      break
    case 'generate':
    case 'init':
      await runInit(siteRoot, config, effectiveArgs)
      break
    case 'status':
      await runStatus(siteRoot, config, effectiveArgs)
      break
    case 'audit':
      await runAudit(siteRoot, config, effectiveArgs)
      break
    // Free-form translation commands
    case 'init-freeform':
      await runInitFreeform(siteRoot, config, effectiveArgs)
      break
    case 'update-hash':
      await runUpdateHash(siteRoot, config, effectiveArgs)
      break
    case 'move':
      await runMove(siteRoot, config, effectiveArgs)
      break
    case 'rename':
      await runRename(siteRoot, config, effectiveArgs)
      break
    case 'prune':
      await runPrune(siteRoot, config, effectiveArgs)
      break
    default:
      error(`Unknown subcommand: ${effectiveSubcommand}`)
      showHelp()
      process.exit(1)
  }
}

/**
 * Find site root by looking for site.yml
 * Handles: explicit target, workspace root detection, or walking up directories
 *
 * @param {string|null} target - Explicit target path (from --target option)
 */
async function findSiteRoot(target) {
  const cwd = process.cwd()

  // If explicit target specified, use it
  if (target) {
    const targetPath = resolve(cwd, target)
    if (existsSync(join(targetPath, 'site.yml'))) {
      return targetPath
    }
    error(`Target directory does not appear to be a site: ${target}`)
    log(`${colors.dim}Sites have a site.yml file.${colors.reset}`)
    process.exit(1)
  }

  // Check if we're at workspace root
  if (isWorkspaceRoot(cwd)) {
    const sites = await findSites(cwd)

    if (sites.length === 0) {
      error('No sites found in this workspace.')
      log(`${colors.dim}Sites have @uniweb/runtime in dependencies.${colors.reset}`)
      process.exit(1)
    }

    let targetSite
    if (sites.length === 1) {
      targetSite = sites[0]
      log(`${colors.cyan}→${colors.reset} Found site: ${targetSite}`)
    } else {
      log(`${colors.dim}Multiple sites found in workspace.${colors.reset}\n`)
      targetSite = await promptSelect('Select site:', sites)
      if (!targetSite) {
        log('Cancelled.')
        process.exit(0)
      }
    }

    return resolve(cwd, targetSite)
  }

  // Walk up directories looking for site.yml
  let dir = cwd
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'site.yml'))) {
      return dir
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }

  return null
}

/**
 * Load site configuration
 *
 * Resolves locales from config:
 * - undefined → all available locales (from locales/*.json)
 * - '*' → explicitly all available locales
 * - ['es', 'fr'] → only those specific locales
 */
async function loadSiteConfig(siteRoot) {
  const configPath = join(siteRoot, 'site.yml')
  const content = await readFile(configPath, 'utf-8')
  const config = yaml.load(content) || {}

  const localesDir = config.i18n?.localesDir || 'locales'
  const localesPath = join(siteRoot, localesDir)

  // Resolve locales (undefined/'*' → all available, array → specific)
  const { resolveLocales } = await import('@uniweb/build/i18n')
  const locales = await resolveLocales(config.i18n?.locales, localesPath)

  return {
    defaultLocale: config.defaultLanguage || 'en',
    locales,
    localesDir,
    ...config.i18n,
  }
}

/**
 * Extract command - extract translatable strings from site content
 */
async function runExtract(siteRoot, config, args) {
  const verbose = args.includes('--verbose') || args.includes('-v')
  const dryRun = args.includes('--dry-run')
  const collectionsOnly = args.includes('--collections-only') || args.includes('--collections')
  const noCollections = args.includes('--no-collections')
  // --with-collections is now a no-op (collections are included by default)

  // Extract page content (unless --collections-only)
  if (!collectionsOnly) {
    log(`\n${colors.cyan}Extracting translatable content${dryRun ? ' (dry run)' : ''}...${colors.reset}\n`)

    // Check if site has been built
    const siteContentPath = join(siteRoot, 'dist', 'site-content.json')
    if (!existsSync(siteContentPath)) {
      error('Site content not found. Run "uniweb build" first.')
      process.exit(1)
    }

    try {
      // Dynamic import to avoid loading at CLI startup
      const { extractManifest, formatSyncReport } = await import('@uniweb/build/i18n')

      // Check if this is a first-time extract (no previous manifest)
      const manifestPath = join(siteRoot, config.localesDir, 'manifest.json')
      const isUpdate = existsSync(manifestPath)

      const { manifest, report } = await extractManifest(siteRoot, {
        localesDir: config.localesDir,
        siteContentPath,
        verbose,
        dryRun,
      })

      // Show results
      const unitCount = Object.keys(manifest.units).length
      success(`Extracted ${unitCount} translatable strings`)

      // Show sync report for updates (skip on first extract — everything would be "added")
      if (report && isUpdate) {
        log('')
        log(formatSyncReport(report))
      }

      if (dryRun) {
        log(`\n${colors.dim}Dry run — no files were modified.${colors.reset}`)
      } else {
        log(`\nManifest written to: ${colors.dim}${config.localesDir}/manifest.json${colors.reset}`)
      }

      if (config.locales.length === 0) {
        log(`\n${colors.dim}No translation files found in ${config.localesDir}/.`)
        log(`After translating, create locale files like ${config.localesDir}/es.json${colors.reset}`)
      }
    } catch (err) {
      error(`Extraction failed: ${err.message}`)
      if (verbose) console.error(err)
      process.exit(1)
    }
  }

  // Extract collection content (by default, skip with --no-collections)
  if (!noCollections) {
    log(`\n${colors.cyan}Extracting collection content${dryRun ? ' (dry run)' : ''}...${colors.reset}\n`)

    // Check if collections exist
    const dataDir = join(siteRoot, 'public', 'data')
    if (!existsSync(dataDir)) {
      if (collectionsOnly) {
        error('No collections found. Create collection data in public/data/.')
        process.exit(1)
      }
      log(`${colors.dim}No collections found in public/data/.${colors.reset}`)
      return
    }

    try {
      const { extractCollectionManifest, formatSyncReport } = await import('@uniweb/build/i18n')

      const collectionsManifestPath = join(siteRoot, config.localesDir, 'collections', 'manifest.json')
      const isUpdate = existsSync(collectionsManifestPath)

      const { manifest, report } = await extractCollectionManifest(siteRoot, {
        localesDir: config.localesDir,
        dryRun,
      })

      const unitCount = Object.keys(manifest.units).length
      if (unitCount > 0) {
        success(`Extracted ${unitCount} translatable strings from collections`)

        if (report && isUpdate) {
          log('')
          log(formatSyncReport(report))
        }

        if (dryRun) {
          log(`\n${colors.dim}Dry run — no files were modified.${colors.reset}`)
        } else {
          log(`\nManifest written to: ${colors.dim}${config.localesDir}/collections/manifest.json${colors.reset}`)
        }
      } else {
        log(`${colors.dim}No translatable content found in collections.${colors.reset}`)
      }
    } catch (err) {
      error(`Collection extraction failed: ${err.message}`)
      if (verbose) console.error(err)
      if (collectionsOnly) process.exit(1)
    }
  }
}

/**
 * Generate command - generate starter translation files from manifest
 *
 * Usage:
 *   uniweb i18n generate es fr     Generate specific locales
 *   uniweb i18n generate           Generate all configured locales
 *   uniweb i18n generate --empty   Use empty strings instead of source text
 *   uniweb i18n generate --force   Overwrite existing files entirely
 */
async function runInit(siteRoot, config, args) {
  const useEmpty = args.includes('--empty')
  const force = args.includes('--force')

  // Collect locale codes from positional args (skip flags)
  const positionalLocales = args.filter(a => !a.startsWith('-'))

  // Read manifest
  const localesPath = join(siteRoot, config.localesDir)
  const manifestPath = join(localesPath, 'manifest.json')

  if (!existsSync(manifestPath)) {
    error('No manifest found. Run "uniweb i18n extract" first to generate one.')
    process.exit(1)
  }

  const manifestRaw = await readFile(manifestPath, 'utf-8')
  const manifest = JSON.parse(manifestRaw)
  const units = manifest.units || {}
  const unitCount = Object.keys(units).length

  if (unitCount === 0) {
    warn('Manifest has no translatable strings. Nothing to initialize.')
    return
  }

  // Determine target locales
  let targetLocales = positionalLocales.length > 0
    ? positionalLocales
    : config.locales

  if (!targetLocales || targetLocales.length === 0) {
    error('No target locales specified.')
    log(`${colors.dim}Specify locales as arguments (e.g., "uniweb i18n generate es fr")`)
    log(`or configure them in site.yml under i18n.locales.${colors.reset}`)
    process.exit(1)
  }

  log(`\n${colors.cyan}Initializing translation files...${colors.reset}\n`)

  await mkdir(localesPath, { recursive: true })

  for (const locale of targetLocales) {
    // Skip default locale
    if (locale === config.defaultLocale) {
      warn(`Skipped ${locale} (default locale)`)
      continue
    }

    const localePath = join(localesPath, `${locale}.json`)

    if (existsSync(localePath) && !force) {
      // Merge mode: add only missing keys
      const existingRaw = await readFile(localePath, 'utf-8')
      let existing
      try {
        existing = JSON.parse(existingRaw)
      } catch {
        warn(`${locale}.json has invalid JSON, skipping (use --force to overwrite)`)
        continue
      }

      const existingKeys = new Set(Object.keys(existing))
      let added = 0

      for (const [hash, unit] of Object.entries(units)) {
        if (!existingKeys.has(hash)) {
          existing[hash] = useEmpty ? '' : unit.source
          added++
        }
      }

      if (added > 0) {
        await writeFile(localePath, JSON.stringify(existing, null, 2) + '\n')
        const alreadyCount = existingKeys.size
        success(`Updated ${locale}.json (${added} new string${added !== 1 ? 's' : ''} added, ${alreadyCount} already translated)`)
      } else {
        success(`${locale}.json already has all ${unitCount} strings`)
      }
    } else {
      // Create new file (or overwrite with --force)
      const localeData = {}

      for (const [hash, unit] of Object.entries(units)) {
        localeData[hash] = useEmpty ? '' : unit.source
      }

      await writeFile(localePath, JSON.stringify(localeData, null, 2) + '\n')
      success(`Created ${locale}.json (${unitCount} string${unitCount !== 1 ? 's' : ''})`)
    }
  }

  log(`\n${colors.dim}Next steps:`)
  log(`  1. Edit locale files to add translations`)
  log(`  2. Run 'uniweb build' to build with translations`)
  log(`  3. Run 'uniweb i18n status' to check coverage${colors.reset}`)
}

/**
 * Status command - show translation coverage
 */
async function runStatus(siteRoot, config, args) {
  const locale = args.find(a => !a.startsWith('-'))
  const showMissing = args.includes('--missing')
  const showFreeform = args.includes('--freeform')
  const outputJson = args.includes('--json')
  const byPage = args.includes('--by-page')

  // Check if manifest exists
  const localesPath = join(siteRoot, config.localesDir)
  const manifestPath = join(localesPath, 'manifest.json')
  if (!existsSync(manifestPath)) {
    error('No manifest found. Run "uniweb i18n extract" first.')
    process.exit(1)
  }

  // For --missing mode, use auditLocale which returns detailed missing info
  if (showMissing) {
    await runStatusMissing(siteRoot, config, locale, { outputJson, byPage })
    return
  }

  // For --freeform mode, show free-form translation status
  if (showFreeform) {
    await runStatusFreeform(siteRoot, config, locale, { outputJson })
    return
  }

  // Standard status mode
  if (!outputJson) {
    log(`\n${colors.cyan}Translation Status${colors.reset}\n`)
  }

  if (config.locales.length === 0) {
    if (outputJson) {
      log(JSON.stringify({ error: 'No translation files found', locales: [] }, null, 2))
    } else {
      log(`${colors.dim}No translation files found in ${config.localesDir}/.`)
      log(`Create locale files like ${config.localesDir}/es.json to add translations.${colors.reset}`)
    }
    return
  }

  try {
    const { getTranslationStatus, formatTranslationStatus } = await import('@uniweb/build/i18n')

    const localesToCheck = locale ? [locale] : config.locales

    const status = await getTranslationStatus(siteRoot, {
      localesDir: config.localesDir,
      locales: localesToCheck,
    })

    if (outputJson) {
      log(JSON.stringify(status, null, 2))
      return
    }

    log(formatTranslationStatus(status))

    // Show next steps if there are missing translations
    const hasMissing = Object.values(status.locales).some(l => l.missing > 0)
    if (hasMissing) {
      log(`\n${colors.dim}To translate missing strings, edit the locale files in ${config.localesDir}/`)
      log(`Or use: uniweb i18n status --missing --json > missing.json${colors.reset}`)
    }
  } catch (err) {
    error(`Status check failed: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Status --freeform mode - show free-form translation status
 */
async function runStatusFreeform(siteRoot, config, locale, options = {}) {
  const { outputJson = false } = options
  const localesPath = join(siteRoot, config.localesDir)
  const freeformPath = join(localesPath, 'freeform')

  if (!existsSync(freeformPath)) {
    if (outputJson) {
      log(JSON.stringify({ error: 'No free-form translations found', locales: {} }, null, 2))
    } else {
      log(`${colors.dim}No free-form translations found in ${config.localesDir}/freeform/.${colors.reset}`)
    }
    return
  }

  if (!outputJson) {
    log(`\n${colors.cyan}Free-form Translation Status${colors.reset}\n`)
  }

  try {
    // Load site content for source hashes
    const siteContentPath = join(siteRoot, 'dist', 'site-content.json')
    if (!existsSync(siteContentPath)) {
      error('Site content not found. Run "uniweb build" first.')
      process.exit(1)
    }

    const siteContentRaw = await readFile(siteContentPath, 'utf-8')
    const siteContent = JSON.parse(siteContentRaw)

    const {
      discoverFreeformTranslations,
      buildFreeformPath,
      computeSourceHash,
      getStaleTranslations,
      getOrphanedTranslations
    } = await import('@uniweb/build/i18n')

    // Build source hashes
    const sourceHashes = {}
    const validPaths = new Set()
    for (const page of siteContent.pages || []) {
      for (const section of page.sections || []) {
        if (section.stableId && section.content) {
          const path = buildFreeformPath(section, page)
          if (path) {
            validPaths.add(path)
            sourceHashes[path] = computeSourceHash(section.content)
          }
        }
      }
    }

    // Find all locales
    const entries = await readdir(freeformPath, { withFileTypes: true })
    const locales = entries.filter(e => e.isDirectory()).map(e => e.name)
    const localesToCheck = locale ? [locale] : locales

    const results = {}

    for (const loc of localesToCheck) {
      const localeDir = join(freeformPath, loc)
      if (!existsSync(localeDir)) continue

      // Discover translations
      const discovered = await discoverFreeformTranslations(loc, localesPath)
      const allPaths = [...discovered.pages, ...discovered.pageIds, ...discovered.collections]

      // Check staleness
      const stale = await getStaleTranslations(localeDir, sourceHashes)
      const orphaned = await getOrphanedTranslations(localeDir, validPaths)

      const upToDate = allPaths.filter(p =>
        !stale.some(s => s.path === p) &&
        !orphaned.some(o => o.path === p)
      )

      results[loc] = {
        total: allPaths.length,
        upToDate: upToDate.length,
        stale: stale.map(s => ({ path: s.path, recordedDate: s.recordedDate })),
        orphaned: orphaned.map(o => ({ path: o.path, recordedDate: o.recordedDate }))
      }
    }

    if (outputJson) {
      log(JSON.stringify({ locales: results }, null, 2))
      return
    }

    // Human-readable output
    for (const [loc, info] of Object.entries(results)) {
      log(`${colors.bright}${loc}:${colors.reset}`)

      if (info.total === 0) {
        log(`  ${colors.dim}No free-form translations${colors.reset}`)
        log('')
        continue
      }

      // Group by path prefix (pages, page-ids, collections)
      if (info.stale.length > 0) {
        log(`  ${colors.yellow}Stale (source changed):${colors.reset}`)
        for (const item of info.stale) {
          log(`    ${colors.yellow}⚠${colors.reset} ${item.path} ${colors.dim}(${item.recordedDate})${colors.reset}`)
        }
      }

      if (info.orphaned.length > 0) {
        log(`  ${colors.red}Orphaned (source not found):${colors.reset}`)
        for (const item of info.orphaned) {
          log(`    ${colors.red}✗${colors.reset} ${item.path}`)
        }
      }

      log(`  ${colors.dim}Summary: ${info.upToDate} up to date, ${info.stale.length} stale, ${info.orphaned.length} orphaned${colors.reset}`)
      log('')
    }

    // Show next steps
    const hasStale = Object.values(results).some(r => r.stale.length > 0)
    const hasOrphaned = Object.values(results).some(r => r.orphaned.length > 0)

    if (hasStale) {
      log(`${colors.dim}Run 'uniweb i18n update-hash <locale> --all-stale' to update hashes after reviewing.${colors.reset}`)
    }
    if (hasOrphaned) {
      log(`${colors.dim}Run 'uniweb i18n prune --freeform' to remove orphaned translations.${colors.reset}`)
    }
  } catch (err) {
    error(`Status check failed: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Status --missing mode - show detailed missing strings
 */
async function runStatusMissing(siteRoot, config, locale, options = {}) {
  const { outputJson = false, byPage = false } = options
  const localesPath = join(siteRoot, config.localesDir)

  if (config.locales.length === 0) {
    if (outputJson) {
      log(JSON.stringify({ error: 'No translation files found', missing: [] }, null, 2))
    } else {
      log(`${colors.dim}No translation files found in ${config.localesDir}/.${colors.reset}`)
    }
    return
  }

  try {
    const { auditLocale } = await import('@uniweb/build/i18n')

    const localesToCheck = locale ? [locale] : config.locales

    // Collect missing strings from all requested locales
    const allMissing = []
    const byLocale = {}

    for (const loc of localesToCheck) {
      const result = await auditLocale(localesPath, loc)
      byLocale[loc] = {
        total: result.total,
        translated: result.valid.length,
        missing: result.missing.length,
        coverage: result.total > 0
          ? Math.round((result.valid.length / result.total) * 100)
          : 100
      }

      // Add locale info to each missing entry
      for (const entry of result.missing) {
        allMissing.push({
          locale: loc,
          ...entry
        })
      }
    }

    // JSON output
    if (outputJson) {
      const output = {
        locales: byLocale,
        missing: allMissing
      }
      log(JSON.stringify(output, null, 2))
      return
    }

    // Human-readable output
    log(`\n${colors.cyan}Missing Translations${colors.reset}\n`)

    // Show summary per locale
    for (const [loc, info] of Object.entries(byLocale)) {
      log(`${loc}: ${info.missing} missing (${info.coverage}% coverage)`)
    }

    if (allMissing.length === 0) {
      log(`\n${colors.green}All strings are translated!${colors.reset}`)
      return
    }

    log('')

    // Group by page if requested
    if (byPage) {
      const grouped = groupByPage(allMissing)
      for (const [page, entries] of Object.entries(grouped)) {
        log(`${colors.bright}${page}${colors.reset}`)
        for (const entry of entries) {
          const preview = truncateString(entry.source, 50)
          log(`  ${colors.dim}${entry.hash}${colors.reset} "${preview}"`)
        }
        log('')
      }
    } else {
      // Flat list
      for (const entry of allMissing.slice(0, 20)) {
        const preview = truncateString(entry.source, 60)
        const context = entry.contexts?.[0]
        const location = context ? `${context.page}:${context.section}` : ''
        log(`  ${colors.dim}${entry.hash}${colors.reset} "${preview}"`)
        if (location) {
          log(`    ${colors.dim}→ ${location}${colors.reset}`)
        }
      }

      if (allMissing.length > 20) {
        log(`\n  ${colors.dim}... and ${allMissing.length - 20} more${colors.reset}`)
      }
    }

    log(`\n${colors.dim}Use --json to export for translation tools.${colors.reset}`)
  } catch (err) {
    error(`Status check failed: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Group missing entries by page
 */
function groupByPage(entries) {
  const grouped = {}
  for (const entry of entries) {
    const page = entry.contexts?.[0]?.page || 'unknown'
    if (!grouped[page]) grouped[page] = []
    grouped[page].push(entry)
  }
  return grouped
}

/**
 * Truncate string for display
 */
function truncateString(str, maxLen) {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

/**
 * Audit command - find stale and missing translations
 */
async function runAudit(siteRoot, config, args) {
  const locale = args.find(a => !a.startsWith('-'))
  const clean = args.includes('--clean')
  const verbose = args.includes('--verbose') || args.includes('-v')

  log(`\n${colors.cyan}Translation Audit${colors.reset}\n`)

  // Check if manifest exists
  const localesPath = join(siteRoot, config.localesDir)
  const manifestPath = join(localesPath, 'manifest.json')
  if (!existsSync(manifestPath)) {
    error('No manifest found. Run "uniweb i18n extract" first.')
    process.exit(1)
  }

  if (config.locales.length === 0) {
    log(`${colors.dim}No translation files found in ${config.localesDir}/.`)
    log(`Create locale files like ${config.localesDir}/es.json to add translations.${colors.reset}`)
    return
  }

  try {
    const { auditLocale, cleanLocale, formatAuditReport } = await import('@uniweb/build/i18n')

    const localesToAudit = locale ? [locale] : config.locales
    const results = []

    for (const loc of localesToAudit) {
      const result = await auditLocale(localesPath, loc)
      results.push(result)
    }

    // Show report
    log(formatAuditReport(results, { verbose }))

    // Clean if requested
    if (clean) {
      log('')
      let totalRemoved = 0

      for (const result of results) {
        if (result.stale.length > 0) {
          const staleHashes = result.stale.map(s => s.hash)
          const removed = await cleanLocale(localesPath, result.locale, staleHashes)
          if (removed > 0) {
            success(`Removed ${removed} stale entries from ${result.locale}.json`)
            totalRemoved += removed
          }
        }
      }

      if (totalRemoved === 0) {
        log(`${colors.dim}No stale entries to remove.${colors.reset}`)
      }
    } else {
      // Suggest --clean if there are stale entries
      const hasStale = results.some(r => r.stale.length > 0)
      if (hasStale) {
        log(`\n${colors.dim}Run with --clean to remove stale entries.${colors.reset}`)
      }
    }
  } catch (err) {
    error(`Audit failed: ${err.message}`)
    process.exit(1)
  }
}

// ─────────────────────────────────────────────────────────────────
// Free-form Translation Commands
// ─────────────────────────────────────────────────────────────────

/**
 * Initialize a free-form translation file
 *
 * Usage:
 *   uniweb i18n init-freeform es pages/about hero
 *   uniweb i18n init-freeform es page-ids/installation intro
 *   uniweb i18n init-freeform es collections/articles getting-started
 */
async function runInitFreeform(siteRoot, config, args) {
  const locale = args[0]
  const pathType = args[1] // pages/about, page-ids/installation, collections/articles
  const sectionId = args[2] // hero, intro, getting-started

  if (!locale || !pathType || !sectionId) {
    error('Usage: uniweb i18n init-freeform <locale> <path> <section-id>')
    log(`${colors.dim}Examples:`)
    log('  uniweb i18n init-freeform es pages/about hero')
    log('  uniweb i18n init-freeform es page-ids/installation intro')
    log(`  uniweb i18n init-freeform es collections/articles getting-started${colors.reset}`)
    process.exit(1)
  }

  const localesPath = join(siteRoot, config.localesDir)
  const freeformDir = join(localesPath, 'freeform', locale)

  // Determine target file path
  const relativePath = `${pathType}/${sectionId}.md`
  const targetPath = join(freeformDir, relativePath)

  // Check if already exists
  if (existsSync(targetPath)) {
    error(`Translation already exists: ${relativePath}`)
    log(`${colors.dim}Edit it directly or use 'update-hash' after changes.${colors.reset}`)
    process.exit(1)
  }

  try {
    // Load site content to get source
    const siteContentPath = join(siteRoot, 'dist', 'site-content.json')
    if (!existsSync(siteContentPath)) {
      error('Site content not found. Run "uniweb build" first.')
      process.exit(1)
    }

    const siteContentRaw = await readFile(siteContentPath, 'utf-8')
    const siteContent = JSON.parse(siteContentRaw)

    // Find the source content
    let sourceContent = null
    let sourceHash = null

    if (pathType.startsWith('pages/') || pathType.startsWith('page-ids/')) {
      // Find section in pages
      const isPageId = pathType.startsWith('page-ids/')
      const pageIdentifier = pathType.replace(/^(pages|page-ids)\//, '')

      for (const page of siteContent.pages || []) {
        const match = isPageId
          ? page.id === pageIdentifier
          : normalizeRoute(page.route) === pageIdentifier

        if (match) {
          for (const section of page.sections || []) {
            if (section.stableId === sectionId) {
              sourceContent = section.content
              break
            }
          }
          if (sourceContent) break
        }
      }
    } else if (pathType.startsWith('collections/')) {
      // Find item in collection data
      const collectionName = pathType.replace('collections/', '')
      const dataPath = join(siteRoot, 'public', 'data', `${collectionName}.json`)

      if (existsSync(dataPath)) {
        const dataRaw = await readFile(dataPath, 'utf-8')
        const items = JSON.parse(dataRaw)

        for (const item of items) {
          if (item.slug === sectionId) {
            sourceContent = item.content
            break
          }
        }
      }
    }

    if (!sourceContent) {
      error(`Source content not found for: ${pathType}/${sectionId}`)
      process.exit(1)
    }

    // Convert ProseMirror to markdown (simplified - just extract text)
    const markdown = proseMirrorToMarkdown(sourceContent)

    // Create directory structure
    await mkdir(dirname(targetPath), { recursive: true })

    // Write translation file
    await writeFile(targetPath, markdown)

    // Record hash in manifest
    const { computeSourceHash, recordHash } = await import('@uniweb/build/i18n')
    sourceHash = computeSourceHash(sourceContent)
    await recordHash(freeformDir, relativePath, sourceHash)

    success(`Created free-form translation: ${relativePath}`)
    log(`${colors.dim}Edit the file, then run 'update-hash' when source changes.${colors.reset}`)
  } catch (err) {
    error(`Failed to initialize free-form translation: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Normalize route for comparison (remove leading/trailing slashes)
 */
function normalizeRoute(route) {
  return route.replace(/^\/|\/$/g, '')
}

/**
 * Convert ProseMirror document to markdown (simplified)
 */
function proseMirrorToMarkdown(doc) {
  if (!doc || !doc.content) return ''

  const lines = []

  for (const node of doc.content) {
    if (node.type === 'heading') {
      const level = node.attrs?.level || 1
      const prefix = '#'.repeat(level)
      const text = extractText(node)
      lines.push(`${prefix} ${text}`)
      lines.push('')
    } else if (node.type === 'paragraph') {
      const text = extractText(node)
      if (text) lines.push(text)
      lines.push('')
    } else if (node.type === 'bulletList') {
      for (const item of node.content || []) {
        const text = extractText(item)
        if (text) lines.push(`- ${text}`)
      }
      lines.push('')
    } else if (node.type === 'orderedList') {
      let num = 1
      for (const item of node.content || []) {
        const text = extractText(item)
        if (text) lines.push(`${num}. ${text}`)
        num++
      }
      lines.push('')
    } else if (node.type === 'codeBlock') {
      const lang = node.attrs?.language || ''
      const text = extractText(node)
      lines.push('```' + lang)
      lines.push(text)
      lines.push('```')
      lines.push('')
    } else if (node.type === 'blockquote') {
      const text = extractText(node)
      lines.push(`> ${text}`)
      lines.push('')
    }
  }

  return lines.join('\n').trim() + '\n'
}

/**
 * Extract text from a ProseMirror node
 */
function extractText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (!node.content) return ''
  return node.content.map(extractText).join('')
}

/**
 * Update the hash for a free-form translation
 *
 * Usage:
 *   uniweb i18n update-hash es pages/about hero
 *   uniweb i18n update-hash es --all-stale
 */
async function runUpdateHash(siteRoot, config, args) {
  const locale = args[0]
  const allStale = args.includes('--all-stale')

  if (!locale) {
    error('Usage: uniweb i18n update-hash <locale> [path] [section-id]')
    log(`${colors.dim}Or: uniweb i18n update-hash <locale> --all-stale${colors.reset}`)
    process.exit(1)
  }

  const localesPath = join(siteRoot, config.localesDir)
  const freeformDir = join(localesPath, 'freeform', locale)

  if (!existsSync(freeformDir)) {
    error(`No free-form translations found for locale: ${locale}`)
    process.exit(1)
  }

  try {
    // Load site content
    const siteContentPath = join(siteRoot, 'dist', 'site-content.json')
    if (!existsSync(siteContentPath)) {
      error('Site content not found. Run "uniweb build" first.')
      process.exit(1)
    }

    const siteContentRaw = await readFile(siteContentPath, 'utf-8')
    const siteContent = JSON.parse(siteContentRaw)

    const {
      computeSourceHash,
      updateHash,
      buildFreeformPath,
      getStaleTranslations
    } = await import('@uniweb/build/i18n')

    // Build source hashes map
    const sourceHashes = buildSourceHashMap(siteContent, buildFreeformPath, computeSourceHash)

    if (allStale) {
      // Update all stale translations
      const stale = await getStaleTranslations(freeformDir, sourceHashes)

      if (stale.length === 0) {
        log(`${colors.dim}No stale translations found.${colors.reset}`)
        return
      }

      for (const item of stale) {
        await updateHash(freeformDir, item.path, item.currentHash)
        success(`Updated hash: ${item.path}`)
      }

      log(`\nUpdated ${stale.length} translation hashes.`)
    } else {
      // Update specific translation
      const pathType = args[1]
      const sectionId = args[2]

      if (!pathType || !sectionId) {
        error('Usage: uniweb i18n update-hash <locale> <path> <section-id>')
        process.exit(1)
      }

      const relativePath = `${pathType}/${sectionId}.md`
      const currentHash = sourceHashes[relativePath]

      if (!currentHash) {
        error(`Source not found for: ${relativePath}`)
        process.exit(1)
      }

      await updateHash(freeformDir, relativePath, currentHash)
      success(`Updated hash: ${relativePath}`)
    }
  } catch (err) {
    error(`Failed to update hash: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Build a map of relative paths to source hashes
 */
function buildSourceHashMap(siteContent, buildFreeformPath, computeSourceHash) {
  const sourceHashes = {}

  for (const page of siteContent.pages || []) {
    for (const section of page.sections || []) {
      if (section.stableId && section.content) {
        const path = buildFreeformPath(section, page)
        if (path) {
          sourceHashes[path] = computeSourceHash(section.content)
        }
      }
    }
  }

  return sourceHashes
}

/**
 * Move free-form translations when pages are reorganized
 *
 * Usage:
 *   uniweb i18n move pages/docs/setup pages/getting-started
 */
async function runMove(siteRoot, config, args) {
  const oldPath = args[0]
  const newPath = args[1]

  if (!oldPath || !newPath) {
    error('Usage: uniweb i18n move <old-path> <new-path>')
    log(`${colors.dim}Example: uniweb i18n move pages/docs/setup pages/getting-started${colors.reset}`)
    process.exit(1)
  }

  const localesPath = join(siteRoot, config.localesDir)
  const freeformPath = join(localesPath, 'freeform')

  if (!existsSync(freeformPath)) {
    log(`${colors.dim}No free-form translations found.${colors.reset}`)
    return
  }

  try {
    const { renameManifestEntries } = await import('@uniweb/build/i18n')

    // Find all locales with free-form translations
    const entries = await readdir(freeformPath, { withFileTypes: true })
    const locales = entries.filter(e => e.isDirectory()).map(e => e.name)

    let totalMoved = 0

    for (const locale of locales) {
      const localeDir = join(freeformPath, locale)
      const oldDir = join(localeDir, oldPath)

      if (!existsSync(oldDir)) continue

      const newDir = join(localeDir, newPath)

      // Move all files
      const files = await discoverFiles(oldDir)
      const oldPaths = []
      const newPaths = []

      for (const file of files) {
        const relOld = relative(localeDir, file)
        const relNew = relOld.replace(oldPath, newPath)
        oldPaths.push(relOld)
        newPaths.push(relNew)

        // Create target directory
        await mkdir(dirname(join(localeDir, relNew)), { recursive: true })

        // Move file
        await rename(file, join(localeDir, relNew))
        totalMoved++
      }

      // Update manifest
      if (oldPaths.length > 0) {
        await renameManifestEntries(localeDir, oldPaths, newPaths)
      }
    }

    if (totalMoved > 0) {
      success(`Moved ${totalMoved} translation file(s) across ${locales.length} locale(s)`)
    } else {
      log(`${colors.dim}No translations found at: ${oldPath}${colors.reset}`)
    }
  } catch (err) {
    error(`Failed to move translations: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Rename free-form translation files
 *
 * Usage:
 *   uniweb i18n rename pages/about hero welcome
 */
async function runRename(siteRoot, config, args) {
  const path = args[0]
  const oldName = args[1]
  const newName = args[2]

  if (!path || !oldName || !newName) {
    error('Usage: uniweb i18n rename <path> <old-name> <new-name>')
    log(`${colors.dim}Example: uniweb i18n rename pages/about hero welcome${colors.reset}`)
    process.exit(1)
  }

  const localesPath = join(siteRoot, config.localesDir)
  const freeformPath = join(localesPath, 'freeform')

  if (!existsSync(freeformPath)) {
    log(`${colors.dim}No free-form translations found.${colors.reset}`)
    return
  }

  try {
    const { renameManifestEntries } = await import('@uniweb/build/i18n')

    // Find all locales with free-form translations
    const entries = await readdir(freeformPath, { withFileTypes: true })
    const locales = entries.filter(e => e.isDirectory()).map(e => e.name)

    let totalRenamed = 0

    for (const locale of locales) {
      const localeDir = join(freeformPath, locale)
      const oldFile = join(localeDir, path, `${oldName}.md`)
      const newFile = join(localeDir, path, `${newName}.md`)

      if (!existsSync(oldFile)) continue

      // Rename file
      await rename(oldFile, newFile)

      // Update manifest
      const oldRelPath = `${path}/${oldName}.md`
      const newRelPath = `${path}/${newName}.md`
      await renameManifestEntries(localeDir, [oldRelPath], [newRelPath])

      totalRenamed++
    }

    if (totalRenamed > 0) {
      success(`Renamed translation in ${totalRenamed} locale(s)`)
    } else {
      log(`${colors.dim}No translations found: ${path}/${oldName}.md${colors.reset}`)
    }
  } catch (err) {
    error(`Failed to rename translation: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Prune orphaned free-form translations
 *
 * Usage:
 *   uniweb i18n prune --freeform [--dry-run]
 */
async function runPrune(siteRoot, config, args) {
  const freeformMode = args.includes('--freeform')
  const dryRun = args.includes('--dry-run')

  if (!freeformMode) {
    error('Usage: uniweb i18n prune --freeform [--dry-run]')
    process.exit(1)
  }

  const localesPath = join(siteRoot, config.localesDir)
  const freeformPath = join(localesPath, 'freeform')

  if (!existsSync(freeformPath)) {
    log(`${colors.dim}No free-form translations found.${colors.reset}`)
    return
  }

  log(`\n${colors.cyan}Pruning orphaned free-form translations${dryRun ? ' (dry run)' : ''}...${colors.reset}\n`)

  try {
    // Load site content
    const siteContentPath = join(siteRoot, 'dist', 'site-content.json')
    if (!existsSync(siteContentPath)) {
      error('Site content not found. Run "uniweb build" first.')
      process.exit(1)
    }

    const siteContentRaw = await readFile(siteContentPath, 'utf-8')
    const siteContent = JSON.parse(siteContentRaw)

    const {
      buildFreeformPath,
      getOrphanedTranslations,
      removeManifestEntries,
      discoverFreeformTranslations
    } = await import('@uniweb/build/i18n')

    // Build set of valid paths
    const validPaths = new Set()
    for (const page of siteContent.pages || []) {
      for (const section of page.sections || []) {
        if (section.stableId) {
          const path = buildFreeformPath(section, page)
          if (path) validPaths.add(path)
        }
      }
    }

    // Find all locales
    const entries = await readdir(freeformPath, { withFileTypes: true })
    const locales = entries.filter(e => e.isDirectory()).map(e => e.name)

    let totalPruned = 0

    for (const locale of locales) {
      const localeDir = join(freeformPath, locale)

      // Get orphaned translations
      const orphaned = await getOrphanedTranslations(localeDir, validPaths)

      if (orphaned.length === 0) continue

      log(`${locale}:`)

      for (const item of orphaned) {
        log(`  ${colors.red}✗${colors.reset} ${item.path}`)

        if (!dryRun) {
          // Delete file
          const filePath = join(localeDir, item.path)
          if (existsSync(filePath)) {
            await unlink(filePath)
          }
        }

        totalPruned++
      }

      // Update manifest
      if (!dryRun && orphaned.length > 0) {
        const paths = orphaned.map(o => o.path)
        await removeManifestEntries(localeDir, paths)
      }
    }

    if (totalPruned > 0) {
      if (dryRun) {
        log(`\n${colors.dim}Would remove ${totalPruned} orphaned translation(s). Run without --dry-run to delete.${colors.reset}`)
      } else {
        success(`\nRemoved ${totalPruned} orphaned translation(s)`)
      }
    } else {
      log(`${colors.dim}No orphaned translations found.${colors.reset}`)
    }
  } catch (err) {
    error(`Failed to prune translations: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Recursively discover all files in a directory
 */
async function discoverFiles(dir) {
  const files = []

  if (!existsSync(dir)) return files

  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await discoverFiles(fullPath))
    } else {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Show help for i18n commands
 */
function showHelp() {
  log(`
${colors.cyan}${colors.bright}Uniweb i18n${colors.reset}

Site content internationalization commands.

${colors.bright}Usage:${colors.reset}
  uniweb i18n [command] [options]

${colors.bright}Commands:${colors.reset}
  ${colors.dim}# Hash-based (granular) translation${colors.reset}
  extract      Extract/update translatable strings (default if no command given)
  generate     Generate starter locale files from manifest keys
  status       Show translation coverage per locale
  audit        Find stale translations (no longer in manifest) and missing ones

  ${colors.dim}# Free-form (complete replacement) translation${colors.reset}
  init-freeform <locale> <path> <id>   Create free-form translation from source
  update-hash <locale> [<path> <id>]   Update hash after reviewing source changes
  move <old-path> <new-path>           Move translations when pages reorganize
  rename <path> <old-id> <new-id>      Rename translation file
  prune --freeform                     Remove orphaned free-form translations

${colors.bright}Options:${colors.reset}
  -t, --target <path>  Site directory (auto-detected if not specified)
  --verbose            Show detailed output
  --dry-run            (extract/prune) Preview changes without writing files
  --empty              (generate) Use empty strings instead of source text
  --force              (generate) Overwrite existing locale files entirely
  --clean              (audit) Remove stale entries from locale files
  --missing            (status) List all missing strings instead of summary
  --freeform           (status/prune) Include free-form translation status
  --json               (status) Output as JSON for translation tools
  --by-page            (status --missing) Group missing strings by page
  --collections-only   (extract/status/audit) Process only collections
  --no-collections     (extract/status/audit) Skip collections (pages only)
  --all-stale          (update-hash) Update all stale translations at once

${colors.bright}Configuration:${colors.reset}
  Optional site.yml settings:

    i18n:
      locales: [es, fr]          # Specific locales only (default: all available)
      locales: '*'               # Explicitly all available locales
      localesDir: locales        # Directory for translation files (default: locales)

  By default, all *.json files in locales/ are treated as translation targets.

${colors.bright}Workflow:${colors.reset}
  1. Build your site:           uniweb build
  2. Extract strings:           uniweb i18n extract
  3. Generate locale files:     uniweb i18n generate es fr
  4. Translate locale files:    Edit locales/es.json, locales/fr.json, etc.
  5. Build with translations:   uniweb build (generates locale-specific output)

${colors.bright}File Structure:${colors.reset}
  locales/
    manifest.json     Auto-generated: source strings + hashes + contexts
    es.json           Translations for Spanish (hash-based)
    fr.json           Translations for French (hash-based)
    _memory.json      Optional: translation memory for reuse
    freeform/         Free-form translations (complete content replacement)
      es/
        .manifest.json       Staleness tracking
        pages/about/hero.md  Translated content for /about page, hero section
        page-ids/install/intro.md  Translated content by page ID
        collections/articles/getting-started.md

${colors.bright}Examples:${colors.reset}
  ${colors.dim}# Hash-based workflow${colors.reset}
  uniweb i18n extract                     # Extract all translatable strings
  uniweb i18n extract --dry-run           # Preview without writing
  uniweb i18n extract --verbose           # Show extracted strings
  uniweb i18n extract --no-collections    # Pages only (skip collections)
  uniweb i18n generate es fr              # Create starter files for Spanish and French
  uniweb i18n generate --empty            # Create files with empty values (for translators)
  uniweb i18n generate --force            # Overwrite existing locale files
  uniweb i18n status                      # Show coverage for all locales
  uniweb i18n status es                   # Show coverage for Spanish only
  uniweb i18n status es --missing --json  # Export missing for AI translation
  uniweb i18n audit                       # Find stale and missing translations
  uniweb i18n audit --clean               # Remove stale entries

  ${colors.dim}# Free-form workflow (complete section replacement)${colors.reset}
  uniweb i18n init-freeform es pages/about hero
  uniweb i18n init-freeform es page-ids/installation intro
  uniweb i18n init-freeform es collections/articles getting-started
  uniweb i18n status --freeform    # Show free-form translation status
  uniweb i18n update-hash es --all-stale  # Update hashes after review
  uniweb i18n move pages/docs/setup pages/getting-started
  uniweb i18n prune --freeform --dry-run  # Preview orphan cleanup
  uniweb i18n --target site        # Specify site directory explicitly

${colors.bright}Aliases:${colors.reset}
  sync → extract   (backward-compatible)
  init → generate  (backward-compatible)

${colors.bright}Notes:${colors.reset}
  Run from a site directory to operate on that site.
  Run from workspace root to auto-detect sites (prompts if multiple).
`)
}

export default i18n
