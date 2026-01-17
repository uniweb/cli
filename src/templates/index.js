/**
 * Template resolution and application for the CLI
 */

import { rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseTemplateId, getTemplateDisplayName, BUILTIN_TEMPLATES, OFFICIAL_TEMPLATES } from './resolver.js'
import { fetchNpmTemplate } from './fetchers/npm.js'
import { fetchGitHubTemplate } from './fetchers/github.js'
import { validateTemplate } from './validator.js'
import {
  copyTemplateDirectory,
  registerVersions,
  getMissingVersions,
  clearMissingVersions
} from './processor.js'

// Path to bundled official templates (when @uniweb/templates is installed)
// This will be replaced by GitHub releases fetching in Phase 2
let officialTemplatesDir = null
try {
  const templatesPackage = await import('@uniweb/templates')
  officialTemplatesDir = templatesPackage.getTemplatesDirectory()
} catch {
  // @uniweb/templates not installed - official templates will need to be fetched
}

/**
 * Resolve a template identifier and return the template path
 *
 * @param {string} identifier - Template identifier
 * @param {Object} options - Resolution options
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} { type, path, metadata, cleanup }
 */
export async function resolveTemplate(identifier, options = {}) {
  const { onProgress } = options
  const parsed = parseTemplateId(identifier)

  switch (parsed.type) {
    case 'builtin':
      return {
        type: 'builtin',
        name: parsed.name,
        // Built-in templates are handled programmatically by the CLI
        // No path or cleanup needed
      }

    case 'official':
      return resolveOfficialTemplate(parsed.name, options)

    case 'npm':
      return resolveNpmTemplate(parsed.package, options)

    case 'github':
      return resolveGitHubTemplate(parsed, options)

    default:
      throw new Error(`Unknown template type: ${parsed.type}`)
  }
}

/**
 * Resolve an official template
 * Currently uses bundled templates from @uniweb/templates
 * Will be updated in Phase 2 to fetch from GitHub releases
 */
async function resolveOfficialTemplate(name, options = {}) {
  const { onProgress } = options

  if (!officialTemplatesDir) {
    throw new Error(
      `Official template "${name}" requires @uniweb/templates package.\n` +
      `Install it with: npm install @uniweb/templates`
    )
  }

  const templatePath = join(officialTemplatesDir, name)
  if (!existsSync(join(templatePath, 'template.json'))) {
    throw new Error(
      `Official template "${name}" not found.`
    )
  }

  onProgress?.(`Using official template: ${name}`)

  return {
    type: 'official',
    name,
    path: templatePath,
    cleanup: async () => {}, // Nothing to clean up
  }
}

/**
 * Resolve a template from npm
 */
async function resolveNpmTemplate(packageName, options = {}) {
  const { onProgress } = options

  onProgress?.(`Resolving npm template: ${packageName}`)

  const { tempDir, version, metadata } = await fetchNpmTemplate(packageName, { onProgress })

  return {
    type: 'npm',
    package: packageName,
    version,
    path: tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/**
 * Resolve a template from GitHub
 */
async function resolveGitHubTemplate(parsed, options = {}) {
  const { onProgress } = options
  const { owner, repo, ref } = parsed

  onProgress?.(`Resolving GitHub template: ${owner}/${repo}`)

  const { tempDir } = await fetchGitHubTemplate(owner, repo, { ref, onProgress })

  return {
    type: 'github',
    owner,
    repo,
    ref,
    path: tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/**
 * Apply a template to a target directory
 *
 * @param {string} templatePath - Path to the template root (contains template.json)
 * @param {string} targetPath - Destination directory for the scaffolded project
 * @param {Object} data - Template variables
 * @param {Object} options - Apply options
 * @param {string} options.variant - Template variant to use
 * @param {string} options.uniwebVersion - Current Uniweb version for compatibility check
 * @param {Function} options.onWarning - Warning callback
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Template metadata
 */
export async function applyTemplate(templatePath, targetPath, data = {}, options = {}) {
  const { uniwebVersion, variant, onWarning, onProgress } = options

  // Validate the template
  const metadata = await validateTemplate(templatePath, { uniwebVersion })

  // Register versions for the {{version}} helper
  if (data.versions) {
    registerVersions(data.versions)
  }

  // Apply default variables
  const templateData = {
    year: new Date().getFullYear(),
    ...data
  }

  // Copy template files
  await copyTemplateDirectory(
    metadata.templateDir,
    targetPath,
    templateData,
    { variant, onWarning, onProgress }
  )

  // Check for missing versions and warn
  const missingVersions = getMissingVersions()
  if (missingVersions.length > 0 && onWarning) {
    onWarning(`Missing version data for packages: ${missingVersions.join(', ')}. Using fallback version.`)
  }
  clearMissingVersions()

  return metadata
}

/**
 * Apply an external template to a target directory
 *
 * @param {Object} resolved - Resolved template from resolveTemplate()
 * @param {string} targetPath - Target directory
 * @param {Object} data - Template variables
 * @param {Object} options - Apply options
 */
export async function applyExternalTemplate(resolved, targetPath, data, options = {}) {
  const { variant, onProgress, onWarning } = options

  try {
    const metadata = await applyTemplate(
      resolved.path,
      targetPath,
      data,
      { variant, onProgress, onWarning }
    )

    return metadata
  } finally {
    // Clean up temp directory if there is one
    if (resolved.cleanup) {
      await resolved.cleanup()
    }
  }
}

/**
 * List all available templates
 */
export async function listAvailableTemplates() {
  const templates = []

  // Built-in templates
  for (const name of BUILTIN_TEMPLATES) {
    templates.push({
      type: 'builtin',
      id: name,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      description: name === 'single'
        ? 'One site + one foundation'
        : 'Multiple sites and foundations',
    })
  }

  // Official templates - read from bundled templates if available
  if (officialTemplatesDir) {
    for (const name of OFFICIAL_TEMPLATES) {
      const templatePath = join(officialTemplatesDir, name, 'template.json')
      if (existsSync(templatePath)) {
        try {
          const { default: fs } = await import('node:fs/promises')
          const content = await fs.readFile(templatePath, 'utf8')
          const metadata = JSON.parse(content)
          templates.push({
            type: 'official',
            id: name,
            name: metadata.name || name,
            description: metadata.description || '',
          })
        } catch {
          // Skip if can't read
        }
      }
    }
  }

  return templates
}

// Re-export for convenience
export { parseTemplateId, getTemplateDisplayName, BUILTIN_TEMPLATES, OFFICIAL_TEMPLATES }
