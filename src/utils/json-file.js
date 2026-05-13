/**
 * Style-preserving JSON file writes.
 *
 * The CLI rewrites `package.json` in several places (`update`, `doctor`,
 * `rename`, `add`). A naive `JSON.stringify(obj, null, 2)` reflows the
 * *entire* file whenever the project happened to use tabs or 4-space
 * indentation — turning a one-key version bump into a hundred-line diff
 * (and a needless merge-conflict surface). `framework/CLAUDE.md` calls
 * this out as an anti-pattern for human commits; the tooling shouldn't do
 * it either. These helpers detect the file's existing indentation and
 * trailing-newline convention and preserve both.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

/**
 * Detect the indentation unit a JSON source string uses.
 * @param {string} src
 * @returns {number|string} A space count, or '\t' for tab-indented files.
 *   Defaults to 2 when the file has no indented lines (e.g. `{}`).
 */
export function detectJsonIndent(src) {
  const m = src.match(/\n([ \t]+)\S/)
  if (!m) return 2
  const lead = m[1]
  if (lead.includes('\t')) return '\t'
  return lead.length
}

/**
 * Serialize `obj` to JSON using the indentation and trailing-newline
 * convention of `originalSrc` (or of the file currently at `filePath`).
 * @param {object} obj
 * @param {string} originalSrc - The file's current text.
 * @returns {string}
 */
export function stringifyJsonLike(obj, originalSrc) {
  const indent = detectJsonIndent(originalSrc)
  const body = JSON.stringify(obj, null, indent)
  return originalSrc.endsWith('\n') ? body + '\n' : body
}

/**
 * Write `obj` to `filePath` as JSON, preserving the file's existing
 * indentation and trailing-newline convention. Pass `originalSrc` when
 * the caller already has the file contents in hand (avoids a re-read);
 * otherwise the file is read to sniff its style.
 * @param {string} filePath
 * @param {object} obj
 * @param {string|null} [originalSrc]
 */
export function writeJsonPreservingStyle(filePath, obj, originalSrc = null) {
  const src = originalSrc ?? readFileSync(filePath, 'utf8')
  writeFileSync(filePath, stringifyJsonLike(obj, src))
}

/**
 * Async counterpart to {@link writeJsonPreservingStyle}, for the CLI's
 * many `node:fs/promises`-based call sites.
 * @param {string} filePath
 * @param {object} obj
 * @param {string|null} [originalSrc]
 */
export async function writeJsonPreservingStyleAsync(filePath, obj, originalSrc = null) {
  const src = originalSrc ?? await readFile(filePath, 'utf8')
  await writeFile(filePath, stringifyJsonLike(obj, src))
}
