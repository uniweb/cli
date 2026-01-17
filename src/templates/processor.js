/**
 * Template processor - handles file copying and Handlebars substitution
 */

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import Handlebars from 'handlebars'

// Cache for compiled templates
const templateCache = new Map()

// Store for version data (set by registerVersions)
let versionData = {}

// Track missing versions during processing
const missingVersions = new Set()

// Default fallback version when a package version is unknown
const DEFAULT_FALLBACK_VERSION = '^0.1.0'

/**
 * Register version data for the {{version}} helper
 *
 * @param {Object} versions - Map of package names to version specs
 */
export function registerVersions(versions) {
  versionData = versions || {}
  missingVersions.clear()
}

/**
 * Get the list of missing versions encountered during processing
 *
 * @returns {string[]} Array of package names that were missing versions
 */
export function getMissingVersions() {
  return [...missingVersions]
}

/**
 * Clear the missing versions set
 */
export function clearMissingVersions() {
  missingVersions.clear()
}

/**
 * Handlebars helper to get a package version
 * Usage: {{version "@uniweb/build"}} or {{version "build"}}
 */
Handlebars.registerHelper('version', function(packageName) {
  // Try exact match first
  if (versionData[packageName]) {
    return versionData[packageName]
  }

  // Try with @uniweb/ prefix
  if (!packageName.startsWith('@') && versionData[`@uniweb/${packageName}`]) {
    return versionData[`@uniweb/${packageName}`]
  }

  // Track the missing version and return a fallback
  missingVersions.add(packageName)
  return DEFAULT_FALLBACK_VERSION
})

// Text file extensions that should be processed for variables
const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.yml', '.yaml', '.md', '.mdx',
  '.html', '.htm', '.css', '.scss', '.less',
  '.txt', '.xml', '.svg', '.vue', '.astro'
])

/**
 * Check if string contains unresolved Handlebars placeholders
 */
function findUnresolvedPlaceholders(content) {
  const patterns = [
    /\{\{([^#/}>][^}]*)\}\}/g, // {{variable}} - not blocks or partials
  ]

  const unresolved = []
  for (const pattern of patterns) {
    const matches = content.matchAll(pattern)
    for (const match of matches) {
      const varName = match[1].trim()
      // Skip helpers and expressions with spaces (likely intentional)
      if (!varName.includes(' ')) {
        unresolved.push(varName)
      }
    }
  }
  return [...new Set(unresolved)]
}

/**
 * Load and compile a Handlebars template with caching
 */
async function loadTemplate(templatePath) {
  if (templateCache.has(templatePath)) {
    return templateCache.get(templatePath)
  }

  const template = await fs.readFile(templatePath, 'utf8')
  const compiled = Handlebars.compile(template)
  templateCache.set(templatePath, compiled)
  return compiled
}

/**
 * Process a single file - either copy or apply Handlebars
 */
async function processFile(sourcePath, targetPath, data, options = {}) {
  const isHbs = sourcePath.endsWith('.hbs')
  const ext = path.extname(isHbs ? sourcePath.slice(0, -4) : sourcePath)
  const isTextFile = TEXT_EXTENSIONS.has(ext)

  if (isHbs) {
    // Process Handlebars template
    const template = await loadTemplate(sourcePath)
    const content = template(data)

    // Check for unresolved placeholders
    const unresolved = findUnresolvedPlaceholders(content)
    if (unresolved.length > 0 && options.onWarning) {
      options.onWarning(`Unresolved placeholders in ${path.basename(targetPath)}: ${unresolved.join(', ')}`)
    }

    await fs.writeFile(targetPath, content)
  } else if (isTextFile && options.processAllText) {
    // Optionally process non-hbs text files for simple replacements
    let content = await fs.readFile(sourcePath, 'utf8')
    // Simple {{var}} replacement without full Handlebars
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        content = content.replaceAll(`{{${key}}}`, value)
      }
    }
    await fs.writeFile(targetPath, content)
  } else {
    // Binary or non-template file - just copy
    await fs.copyFile(sourcePath, targetPath)
  }
}

/**
 * Copy a directory structure recursively, processing templates
 *
 * @param {string} sourcePath - Source template directory
 * @param {string} targetPath - Destination directory
 * @param {Object} data - Template variables
 * @param {Object} options - Processing options
 * @param {string|null} options.variant - Template variant to use
 * @param {Function} options.onWarning - Warning callback
 * @param {Function} options.onProgress - Progress callback
 */
export async function copyTemplateDirectory(sourcePath, targetPath, data, options = {}) {
  const { variant = null, onWarning, onProgress } = options

  await fs.mkdir(targetPath, { recursive: true })
  const entries = await fs.readdir(sourcePath, { withFileTypes: true })

  // Build a set of base names that have variant-specific directories
  const variantBases = new Set()
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const variantMatch = entry.name.match(/^(.+)\.([^.]+)$/)
      if (variantMatch) {
        variantBases.add(variantMatch[1]) // e.g., 'foundation' from 'foundation.tailwind4'
      }
    }
  }

  for (const entry of entries) {
    const sourceName = entry.name

    // Check if this is a variant-specific item (e.g., "dir.variant")
    const variantMatch = entry.isDirectory()
      ? sourceName.match(/^(.+)\.([^.]+)$/)
      : null

    if (entry.isDirectory()) {
      if (variantMatch) {
        const [, baseName, dirVariant] = variantMatch

        // When no variant is specified, skip all variant directories
        if (!variant) {
          continue
        }

        // When variant is specified, skip directories that don't match
        if (dirVariant !== variant) {
          continue
        }

        // Use the base name without variant suffix for the target
        const sourceFullPath = path.join(sourcePath, sourceName)
        const targetFullPath = path.join(targetPath, baseName)

        await copyTemplateDirectory(sourceFullPath, targetFullPath, data, options)
      } else {
        // Regular directory - skip if a variant override exists and we're using that variant
        if (variant && variantBases.has(sourceName)) {
          // Skip this directory because a variant-specific version exists
          continue
        }

        const sourceFullPath = path.join(sourcePath, sourceName)
        const targetFullPath = path.join(targetPath, sourceName)

        await copyTemplateDirectory(sourceFullPath, targetFullPath, data, options)
      }
    } else {
      // File processing
      // Remove .hbs extension for target filename
      const targetName = sourceName.endsWith('.hbs')
        ? sourceName.slice(0, -4)
        : sourceName

      const sourceFullPath = path.join(sourcePath, sourceName)
      const targetFullPath = path.join(targetPath, targetName)

      // Skip if target already exists (don't overwrite)
      if (existsSync(targetFullPath)) {
        if (onWarning) {
          onWarning(`Skipping ${targetFullPath} - file already exists`)
        }
        continue
      }

      if (onProgress) {
        onProgress(`Creating ${targetName}`)
      }

      await processFile(sourceFullPath, targetFullPath, data, { onWarning })
    }
  }
}

/**
 * Clear the template cache
 */
export function clearCache() {
  templateCache.clear()
}
