/**
 * In-place edits to a YAML file a person wrote (`site.yml`), for a command that
 * must change one value and leave everything else as it was: comments, key
 * order, blank lines, quoting, a flow list written on one line.
 *
 * ⛔ Never load a hand-written file and dump it back. js-yaml's `dump` drops every
 * comment and re-flows lists and long strings — `scaffold.js` records what that
 * did to the templates whose comments are the point of them.
 *
 * ⭐ Every edit is VERIFIED: the edited text must parse to exactly the old data
 * with that one value changed. A value written in a form the line-level edit
 * cannot reach (a block scalar, an entry split across lines) returns null
 * rather than a guess, so the caller can refuse before it changes anything.
 */

import { isDeepStrictEqual } from 'node:util'
import yaml from 'js-yaml'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A scalar as written after `key: `, quoted only when YAML needs it (`@scope/name` does). */
const scalar = (value) => yaml.dump(value, { lineWidth: -1 }).trim()

/**
 * Where a trailing ` # comment` begins in the text after `key:`, outside quotes,
 * including the whitespace before it. -1 when the line has none.
 */
function commentStart(rest) {
  let quote = null
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '#' && i > 0 && /\s/.test(rest[i - 1])) {
      let start = i
      while (start > 0 && /\s/.test(rest[start - 1])) start--
      return start
    }
  }
  return -1
}

/** The edited text when it parses to `expected`, else null. */
function verified(after, expected) {
  try {
    return isDeepStrictEqual(yaml.load(after) ?? {}, expected) ? after : null
  } catch {
    return null
  }
}

function load(text) {
  try {
    const data = yaml.load(text) ?? {}
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

/**
 * Set a top-level, one-line scalar `key` to `value`, keeping the line's inline
 * comment and every other line as it was.
 *
 * @param {string} text - the file's contents
 * @param {string} key - a top-level key, e.g. `foundation`
 * @param {string} value
 * @returns {string|null} the new contents, or null when the edit cannot be made in place
 */
export function setTopLevelScalar(text, key, value) {
  const data = load(text)
  if (!data) return null
  const match = new RegExp(`^${escapeRegex(key)}:([^\\n]*)$`, 'm').exec(text)
  if (!match) return null
  const at = commentStart(match[1])
  const comment = at === -1 ? '' : match[1].slice(at)
  const line = `${key}: ${scalar(value)}${comment}`
  const after = text.slice(0, match.index) + line + text.slice(match.index + match[0].length)
  return verified(after, { ...data, [key]: value })
}

/**
 * Replace entries of a top-level list `key` — each `from` value becomes its `to`
 * — wherever an entry is written on a line of its own or inside a one-line flow
 * list, plain or quoted. A value that only CONTAINS `from` is left alone, and so
 * is a comment line.
 *
 * @param {string} text - the file's contents
 * @param {string} key - a top-level list key, e.g. `extensions`
 * @param {Map<string, string>} replacements - old entry → new entry
 * @returns {string|null} the new contents, or null when the edit cannot be made in place
 */
export function replaceInTopLevelList(text, key, replacements) {
  const data = load(text)
  if (!data || !Array.isArray(data[key])) return null
  const expected = { ...data, [key]: data[key].map((v) => (replacements.has(v) ? replacements.get(v) : v)) }

  const after = text
    .split('\n')
    .map((line) => {
      if (/^\s*#/.test(line)) return line
      for (const [from, to] of replacements) {
        const f = escapeRegex(from)
        line = line
          .replace(new RegExp(`'${f}'`, 'g'), () => `'${to.replace(/'/g, "''")}'`)
          .replace(new RegExp(`"${f}"`, 'g'), () => JSON.stringify(to))
          .replace(new RegExp(`(^|[\\s\\[,])${f}(?=$|[\\s,\\]])`, 'g'), (_, lead) => lead + to)
      }
      return line
    })
    .join('\n')
  return verified(after, expected)
}
