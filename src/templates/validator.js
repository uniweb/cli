/**
 * Template validation - checks template.json and compatibility
 */

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Simple semver satisfaction check
 * Supports: >=x.y.z, ^x.y.z, ~x.y.z, x.y.z, x.y.x, *, latest
 */
export function satisfiesVersion(version, range) {
  if (!range || range === '*' || range === 'latest') {
    return true
  }

  const parseVersion = (v) => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)/)
    if (!match) return null
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10)
    }
  }

  const current = parseVersion(version)
  if (!current) return true // Can't parse, assume compatible

  // Handle different range formats
  if (range.startsWith('>=')) {
    const min = parseVersion(range.slice(2))
    if (!min) return true
    if (current.major > min.major) return true
    if (current.major < min.major) return false
    if (current.minor > min.minor) return true
    if (current.minor < min.minor) return false
    return current.patch >= min.patch
  }

  if (range.startsWith('^')) {
    // ^x.y.z means >=x.y.z and <(x+1).0.0
    const min = parseVersion(range.slice(1))
    if (!min) return true
    if (current.major !== min.major) return current.major > min.major && min.major === 0
    if (current.minor > min.minor) return true
    if (current.minor < min.minor) return false
    return current.patch >= min.patch
  }

  if (range.startsWith('~')) {
    // ~x.y.z means >=x.y.z and <x.(y+1).0
    const min = parseVersion(range.slice(1))
    if (!min) return true
    if (current.major !== min.major) return false
    if (current.minor !== min.minor) return false
    return current.patch >= min.patch
  }

  // Exact version or x.y.x pattern
  if (range.includes('x')) {
    const parts = range.split('.')
    const min = parseVersion(range.replace(/x/g, '0'))
    if (!min) return true
    if (parts[0] !== 'x' && current.major !== min.major) return false
    if (parts[1] !== 'x' && current.minor !== min.minor) return false
    return true
  }

  // Exact match
  const exact = parseVersion(range)
  if (!exact) return true
  return current.major === exact.major &&
         current.minor === exact.minor &&
         current.patch === exact.patch
}

/**
 * Validation error with structured details
 */
export class ValidationError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'ValidationError'
    this.code = code
    this.details = details
  }
}

export const ErrorCodes = {
  MISSING_TEMPLATE_JSON: 'MISSING_TEMPLATE_JSON',
  INVALID_TEMPLATE_JSON: 'INVALID_TEMPLATE_JSON',
  MISSING_CONTENT_DIR: 'MISSING_CONTENT_DIR',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
}

/**
 * Validate a template directory structure and metadata
 *
 * @param {string} templateRoot - Path to the template root (contains template.json)
 * @param {Object} options - Validation options
 * @param {string} options.uniwebVersion - Current Uniweb version to check compatibility
 * @returns {Object} Parsed and validated template metadata
 */
export async function validateTemplate(templateRoot, options = {}) {
  const { uniwebVersion } = options

  // Check for template.json
  const metadataPath = path.join(templateRoot, 'template.json')
  if (!existsSync(metadataPath)) {
    throw new ValidationError(
      `Missing template.json in ${templateRoot}`,
      ErrorCodes.MISSING_TEMPLATE_JSON,
      { path: templateRoot }
    )
  }

  // Parse template.json
  let metadata
  try {
    const content = await fs.readFile(metadataPath, 'utf8')
    metadata = JSON.parse(content)
  } catch (err) {
    throw new ValidationError(
      `Invalid template.json: ${err.message}`,
      ErrorCodes.INVALID_TEMPLATE_JSON,
      { path: metadataPath, error: err.message }
    )
  }

  // Check required fields
  if (!metadata.name) {
    throw new ValidationError(
      'template.json missing required field: name',
      ErrorCodes.MISSING_REQUIRED_FIELD,
      { field: 'name' }
    )
  }

  // Check version compatibility (support both `compatible` and `uniweb` fields)
  const versionRange = metadata.compatible || metadata.uniweb
  if (uniwebVersion && versionRange) {
    if (!satisfiesVersion(uniwebVersion, versionRange)) {
      throw new ValidationError(
        `Template requires Uniweb ${versionRange}, but current version is ${uniwebVersion}`,
        ErrorCodes.VERSION_MISMATCH,
        { required: versionRange, current: uniwebVersion }
      )
    }
  }

  // Format 2: content template — foundation/ and/or site/ directories alongside template.json
  const contentDirs = resolveContentDirs(templateRoot, metadata)

  if (contentDirs.length === 0) {
    throw new ValidationError(
      `No content directories found in ${templateRoot}. Templates need foundation/ and/or site/ directories alongside template.json.`,
      ErrorCodes.MISSING_CONTENT_DIR,
      { path: templateRoot }
    )
  }

  return {
    ...metadata,
    format: 2,
    contentDirs,
    metadataPath
  }
}

/**
 * Resolve content directories from a format 2 template
 *
 * @param {string} templateRoot - Root of the template (contains template.json)
 * @param {Object} metadata - Parsed template.json
 * @returns {Array<Object>} Content directories: [{ type, name, dir, foundation? }]
 */
export function resolveContentDirs(templateRoot, metadata) {
  const dirs = []

  if (metadata.packages) {
    // Multi-package template: iterate declared packages
    for (const pkg of metadata.packages) {
      const dir = path.join(templateRoot, pkg.name)
      if (existsSync(dir)) {
        dirs.push({
          type: pkg.type,
          name: pkg.name,
          dir,
          ...(pkg.foundation ? { foundation: pkg.foundation } : {}),
        })
      }
    }
  } else {
    // Standard template: look for foundation/ and site/
    const foundationDir = path.join(templateRoot, 'foundation')
    if (existsSync(foundationDir)) {
      dirs.push({ type: 'foundation', name: 'foundation', dir: foundationDir })
    }

    const siteDir = path.join(templateRoot, 'site')
    if (existsSync(siteDir)) {
      dirs.push({ type: 'site', name: 'site', dir: siteDir })
    }
  }

  return dirs
}

/**
 * Get list of available templates in a templates directory
 *
 * @param {string} templatesDir - Path to directory containing templates
 * @returns {Array<Object>} List of template metadata
 */
export async function listTemplates(templatesDir) {
  if (!existsSync(templatesDir)) {
    return []
  }

  const entries = await fs.readdir(templatesDir, { withFileTypes: true })
  const templates = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const templatePath = path.join(templatesDir, entry.name)
    const metadataPath = path.join(templatePath, 'template.json')

    if (existsSync(metadataPath)) {
      try {
        const content = await fs.readFile(metadataPath, 'utf8')
        const metadata = JSON.parse(content)
        templates.push({
          id: entry.name,
          ...metadata,
          path: templatePath
        })
      } catch {
        // Skip invalid templates
      }
    }
  }

  return templates
}
