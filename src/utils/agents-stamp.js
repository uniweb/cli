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

/**
 * ⭐ THE ONE PART OF AGENTS.md A PROJECT KEEPS: its project-notes blocks. `update` rewrites the
 * file from this CLI's partial, so a note written anywhere else in it is lost on the next version.
 * A block runs from a `<!-- project-notes:start -->` line to a `<!-- project-notes:end -->` line,
 * and is carried over verbatim, at the end of the new file. ⛔ Until 2026-10-01 nothing was kept.
 *
 * A marker is a line of its own, outside a code fence — so the partial can name the markers in a
 * sentence without its own text being taken for a block.
 */
export const PROJECT_NOTES_START = '<!-- project-notes:start -->'
export const PROJECT_NOTES_END = '<!-- project-notes:end -->'

const MARKER_LINE = /^<!--\s*project-notes:(start|end)\s*-->$/
const FENCE_LINE = /^(`{3,}|~{3,})/

/**
 * The project-notes blocks of an AGENTS.md, in order, each from its start line to its end line.
 *
 * @param {string} text
 * @returns {{ blocks: string[] } | { error: string }} an error when the markers do not pair up —
 *   where a block ends would be a guess, and a wrong one loses notes
 */
export function readProjectNotes(text) {
  const blocks = []
  let block = null
  let fence = null
  let lineNumber = 0
  for (const line of String(text ?? '').split(/(?<=\n)/)) {
    lineNumber++
    const trimmed = line.trim()
    const fenceMark = trimmed.match(FENCE_LINE)?.[1]
    if (fenceMark && (!fence || fenceMark.startsWith(fence))) fence = fence ? null : fenceMark
    const marker = !fence && !fenceMark ? trimmed.match(MARKER_LINE)?.[1] : null

    if (marker === 'start') {
      if (block) return { error: `a second ${PROJECT_NOTES_START} on line ${lineNumber}, before the first one's ${PROJECT_NOTES_END}` }
      block = [line]
    } else if (marker === 'end') {
      if (!block) return { error: `${PROJECT_NOTES_END} on line ${lineNumber} has no ${PROJECT_NOTES_START} before it` }
      block.push(line)
      blocks.push(block.join('').replace(/\s+$/, ''))
      block = null
    } else if (block) {
      block.push(line)
    }
  }
  if (block) return { error: `${PROJECT_NOTES_START} has no ${PROJECT_NOTES_END} after it` }
  return { blocks }
}

/**
 * AGENTS.md as `update` writes it: this CLI's partial, stamped, and the project-notes blocks of the
 * file it replaces after it.
 *
 * @param {string|null} existing - the current AGENTS.md, or null when there is none
 * @returns {{ content: string, kept: number } | { error: string }}
 */
export function refreshAgentsContent(existing) {
  const fresh = generateAgentsContent()
  if (existing == null) return { content: fresh, kept: 0 }
  const notes = readProjectNotes(existing)
  if (notes.error) return notes
  if (!notes.blocks.length) return { content: fresh, kept: 0 }
  return {
    content: `${fresh.replace(/\s+$/, '')}\n\n${notes.blocks.join('\n\n')}\n`,
    kept: notes.blocks.length,
  }
}
