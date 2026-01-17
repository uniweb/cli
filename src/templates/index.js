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

// Try to import from @uniweb/templates if available
let templatesPackage = null
try {
  templatesPackage = await import('@uniweb/templates')
} catch {
  // @uniweb/templates not installed - official templates won't be available locally
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
 * Resolve an official template from @uniweb/templates
 */
async function resolveOfficialTemplate(name, options = {}) {
  const { onProgress } = options

  if (!templatesPackage) {
    throw new Error(
      `Official template "${name}" requires @uniweb/templates package.\n` +
      `Install it with: npm install @uniweb/templates`
    )
  }

  if (!templatesPackage.hasTemplate(name)) {
    const available = await templatesPackage.listBuiltinTemplates()
    const names = available.map(t => t.id).join(', ')
    throw new Error(
      `Official template "${name}" not found.\n` +
      `Available templates: ${names || 'none'}`
    )
  }

  const templatePath = templatesPackage.getTemplatePath(name)

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
 * Apply an external template to a target directory
 *
 * @param {Object} resolved - Resolved template from resolveTemplate()
 * @param {string} targetPath - Target directory
 * @param {Object} data - Template variables
 * @param {Object} options - Apply options
 */
export async function applyExternalTemplate(resolved, targetPath, data, options = {}) {
  const { variant, onProgress, onWarning } = options

  if (!templatesPackage) {
    throw new Error(
      'External template application requires @uniweb/templates package.\n' +
      'Install it with: npm install @uniweb/templates'
    )
  }

  try {
    const metadata = await templatesPackage.applyTemplate(
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

  // Official templates from @uniweb/templates
  if (templatesPackage) {
    try {
      const official = await templatesPackage.listBuiltinTemplates()
      for (const t of official) {
        templates.push({
          type: 'official',
          id: t.id,
          name: t.name,
          description: t.description,
        })
      }
    } catch {
      // Ignore errors listing official templates
    }
  }

  return templates
}

// Re-export for convenience
export { parseTemplateId, getTemplateDisplayName, BUILTIN_TEMPLATES, OFFICIAL_TEMPLATES }
