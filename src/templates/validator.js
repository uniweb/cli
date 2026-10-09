/**
 * Template validation — reads template.json and finds the content directories
 *
 * ⛔ Two things this used to do are retired [2026-10-08]:
 *   - `compatible` (alias `uniweb`), a CLI version range a template declared. It
 *     was checked only when a caller passed the CLI's version, and none ever
 *     did. An official template now comes from the release its CLI was
 *     published with (resolver.js), so it cannot be newer than that CLI.
 *   - Unwrapping a package folder that keeps its code under `src/` — the layout of
 *     the v0.7 releases (`foundation/src/foundation.js`). Such a folder is now
 *     REFUSED, naming the fix (validateTemplate). ⛔ The unwrap went in 0.88.0
 *     with a note that the official templates were flat, but its condition was any
 *     `src/main.js` too, and `extensions/effects/` still relied on it: 0.88.0
 *     copied that folder nested, and every project made from `extensions` failed
 *     to build, saying only that it found no section types. The template is flat
 *     since templates 0.18.6.
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
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  NESTED_PACKAGE_CODE: 'NESTED_PACKAGE_CODE'
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

  // A foundation or extension folder is copied over the package the CLI
  // scaffolds, as it is. Code kept under src/ would land beside the scaffold's
  // own empty sections/, and the project would fail to build saying only that it
  // found no section types — so it stops here, saying what to move.
  for (const { type, name, dir } of contentDirs) {
    if (type !== 'foundation' && type !== 'extension') continue
    if (['main.js', 'foundation.js'].some((file) => existsSync(path.join(dir, 'src', file)))) {
      throw new ValidationError(
        `The template's ${name}/ keeps its code in ${name}/src/, a layout this CLI does not scaffold. ` +
          `A foundation or extension folder holds main.js, sections/ and styles.css at its root: ` +
          `move ${name}/src/'s contents up into ${name}/.`,
        ErrorCodes.NESTED_PACKAGE_CODE,
        { dir }
      )
    }
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
