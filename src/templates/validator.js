/**
 * Template validation — reads template.json and finds the content directories
 *
 * ⛔ Two things this used to do are retired [2026-10-08]:
 *   - `compatible` (alias `uniweb`), a CLI version range a template declared. It
 *     was checked only when a caller passed the CLI's version, and none ever
 *     did. An official template now comes from the release its CLI was
 *     published with (resolver.js), so it cannot be newer than that CLI.
 *   - Unwrapping the layout of the v0.7 releases (`foundation/src/foundation.js`).
 *     The official templates are flat, and a CLI only downloads its own release.
 */

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

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
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD'
}

/**
 * Validate a template directory structure and metadata
 *
 * @param {string} templateRoot - Path to the template root (contains template.json)
 * @returns {Object} Parsed and validated template metadata
 */
export async function validateTemplate(templateRoot) {
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
          ...(pkg.foundation ? { foundation: pkg.foundation } : {})
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
