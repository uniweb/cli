/**
 * Template resolution and application for the CLI
 */

import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

import { parseTemplateId, getTemplateDisplayName, BUILTIN_TEMPLATES, OFFICIAL_TEMPLATES } from './resolver.js'
import { fetchNpmTemplate } from './fetchers/npm.js'
import { fetchGitHubTemplate } from './fetchers/github.js'
import { fetchOfficialTemplate, listOfficialTemplates } from './fetchers/release.js'
import { validateTemplate } from './validator.js'
import {
  copyTemplateDirectory,
  registerVersions,
  getMissingVersions,
  clearMissingVersions
} from './processor.js'

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

    case 'local':
      return resolveLocalTemplate(parsed.path, options)

    default:
      throw new Error(`Unknown template type: ${parsed.type}`)
  }
}

/**
 * Resolve an official template from GitHub releases
 */
async function resolveOfficialTemplate(name, options = {}) {
  const { onProgress } = options

  const { tempDir, baseTempDir, version } = await fetchOfficialTemplate(name, { onProgress })

  onProgress?.(`Using official template: ${name} (${version})`)

  return {
    type: 'official',
    name,
    version,
    path: tempDir,
    cleanup: async () => {
      // Clean up the base temp directory (parent of the template)
      await rm(baseTempDir, { recursive: true, force: true }).catch(() => {})
    },
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
 * Resolve a local template from a filesystem path
 */
async function resolveLocalTemplate(templatePath, options = {}) {
  const { onProgress } = options

  // Expand ~ to home directory
  let resolvedPath = templatePath.startsWith('~')
    ? templatePath.replace(/^~/, homedir())
    : templatePath

  // Resolve to absolute path
  resolvedPath = resolve(resolvedPath)

  if (!existsSync(resolvedPath)) {
    throw new Error(`Local template not found: ${resolvedPath}`)
  }

  onProgress?.(`Using local template: ${resolvedPath}`)

  // Read template.json for name
  const metaPath = join(resolvedPath, 'template.json')
  let name = templatePath
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
      name = meta.name || templatePath
    } catch {
      // Use path as name if template.json can't be parsed
    }
  }

  return {
    type: 'local',
    name,
    path: resolvedPath,
    cleanup: null,
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

  // Official templates from GitHub releases
  try {
    const official = await listOfficialTemplates()
    for (const t of official) {
      templates.push({
        type: 'official',
        id: t.id,
        name: t.name || t.id,
        description: t.description || '',
      })
    }
  } catch {
    // Ignore errors - templates just won't be listed
  }

  return templates
}

// Re-export for convenience
export { parseTemplateId, getTemplateDisplayName, BUILTIN_TEMPLATES, OFFICIAL_TEMPLATES }
