/**
 * AGENTS.md version stamp utilities
 *
 * The stamp is an HTML comment on the first line: <!-- uniweb-agents v0.8.32 -->
 * Used by `doctor` (freshness check) and `update` (regeneration).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCliVersion } from '../versions.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const STAMP_PATTERN = /^<!-- uniweb-agents v([\d.]+) -->/

/**
 * Read the version stamp from an AGENTS.md file
 * @param {string} filePath - Absolute path to AGENTS.md
 * @returns {string|null} Version string or null if no stamp
 */
export function readAgentsVersion(filePath) {
  if (!existsSync(filePath)) return null
  try {
    const firstLine = readFileSync(filePath, 'utf8').split('\n')[0]
    const match = firstLine.match(STAMP_PATTERN)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Generate AGENTS.md content with version stamp
 * @returns {string} Full AGENTS.md content with stamp
 */
export function generateAgentsContent() {
  const partialsDir = join(__dirname, '..', '..', 'partials')
  const agentsContent = readFileSync(join(partialsDir, 'agents.md'), 'utf8')
  return `<!-- uniweb-agents v${getCliVersion()} -->\n${agentsContent}\n`
}
