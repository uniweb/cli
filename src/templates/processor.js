/**
 * Template processor - handles file copying and Handlebars substitution
 */

import fs from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Handlebars from 'handlebars'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Cache for compiled templates
const templateCache = new Map()

// Track if partials have been registered
let partialsRegistered = false

// Store for version data (set by registerVersions)
let versionData = {}

// Default fallback version when a package version is unknown
const DEFAULT_FALLBACK_VERSION = '^0.1.0'

/**
 * Register version data for the {{version}} helper
 *
 * @param {Object} versions - Map of package names to version specs
 */
export function registerVersions(versions) {
  versionData = versions || {}
}

/**
 * Register Handlebars partials from the partials directory
 * Partials are available as {{> partial-name}} in templates
 */
function registerPartials() {
  if (partialsRegistered) return

  const partialsDir = path.join(__dirname, '..', '..', 'partials')

  if (!existsSync(partialsDir)) {
    partialsRegistered = true
    return
  }

  try {
    const files = readdirSync(partialsDir)

    for (const file of files) {
      if (file.endsWith('.hbs') || file.endsWith('.md')) {
        const partialName = file.replace(/\.(hbs|md)$/, '')
        const partialPath = path.join(partialsDir, file)
        const partialContent = readFileSync(partialPath, 'utf8')

        Handlebars.registerPartial(partialName, partialContent)
      }
    }

    partialsRegistered = true
  } catch (err) {
    console.warn('Warning: Could not register partials:', err.message)
    partialsRegistered = true
  }
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
  // Ensure partials are registered before first template load
  registerPartials()

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
  } else if (isTextFile) {
    // Process text files for simple variable replacements
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
 * @param {Function} options.onWarning - Warning callback
 * @param {Function} options.onProgress - Progress callback
 */
export async function copyTemplateDirectory(sourcePath, targetPath, data, options = {}) {
  const { onWarning, onProgress, skip } = options

  await fs.mkdir(targetPath, { recursive: true })
  const entries = await fs.readdir(sourcePath, { withFileTypes: true })

  for (const entry of entries) {
    const sourceName = entry.name

    if (entry.isDirectory()) {
      const sourceFullPath = path.join(sourcePath, sourceName)
      // Rename _prefix directories to .prefix (e.g., _vscode → .vscode)
      // This allows dotfile directories to be committed without being gitignored
      const targetName = sourceName.startsWith('_') && !sourceName.startsWith('__')
        ? `.${sourceName.slice(1)}`
        : sourceName
      const targetFullPath = path.join(targetPath, targetName)

      await copyTemplateDirectory(sourceFullPath, targetFullPath, data, { onWarning, onProgress, skip })
    } else {
      // Skip template.json as it's metadata for the template, not for the output
      if (sourceName === 'template.json') {
        continue
      }

      // Determine the output filename (strip .hbs extension) for skip check
      const outputName = sourceName.endsWith('.hbs') ? sourceName.slice(0, -4) : sourceName
      if (skip?.includes(outputName)) {
        continue
      }

      // Remove .hbs extension for target filename
      const targetName = sourceName.endsWith('.hbs')
        ? sourceName.slice(0, -4)
        : sourceName

      const sourceFullPath = path.join(sourcePath, sourceName)
      const targetFullPath = path.join(targetPath, targetName)

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
