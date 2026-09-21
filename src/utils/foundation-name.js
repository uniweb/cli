/**
 * Giving a foundation its name — `name` in `main.js`'s default export.
 *
 * The rule itself (main.js `name`, else package.json `name`; `src` and `foundation`
 * refused) is `@uniweb/build`'s `foundation-name.js`, shared by the build, `register`
 * and `push`. This module only WRITES the name: the scaffold at `create` / `add`, and
 * `register` when it asks for one.
 *
 * ⛔ NO `@uniweb/build` IMPORT, AND NO IMPORT OF main.js. `uniweb create` runs before
 * any project exists: `@uniweb/build` is an optional peer that may not be installed,
 * and main.js's own imports may not be either. Hence text scans rather than a load,
 * and the one duplicated fact below, pinned to the build's list by
 * `test/foundation-name.test.js`. What a foundation IS named is always read by the
 * build (`readFoundationName`); these only decide where to write.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, basename, dirname } from 'node:path'

// The folders a foundation's code lives in — never a foundation's name
// (`@uniweb/build`'s FORBIDDEN_FOUNDATION_NAMES; the test keeps them equal).
export const SCAFFOLD_FOLDER_NAMES = new Set(['src', 'foundation'])

// Written above the name wherever the CLI adds one — the scaffold's main.js
// template says the same.
const NAME_COMMENT = '// What this foundation registers as — @<org>/<name> — and what sites pin.'

/**
 * A name made from free text — a project's name, a folder's — in the form a
 * foundation name takes: lowercase letters, digits and inner hyphens.
 * `My Site` → `my-site`. Null when nothing usable is left, or when what is left
 * names a folder rather than a foundation.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeFoundationName(raw) {
  const name = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@[^/]*\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return name && !SCAFFOLD_FOLDER_NAMES.has(name) ? name : null
}

/**
 * A name to offer a foundation that has none of its own: its folder's — or, for
 * the `src/` and `foundation/` a scaffold makes, its project's folder. Null when
 * neither makes one.
 *
 * @param {string} foundationDir
 * @returns {string|null}
 */
export function suggestFoundationName(foundationDir) {
  const dir = resolve(foundationDir)
  return (
    normalizeFoundationName(basename(dir)) ||
    normalizeFoundationName(basename(dirname(dir)))
  )
}

/**
 * Whether `main.js`'s default export names the foundation — a `name` key at the
 * export's own level, not one nested in `props` or `vars`.
 *
 * A scan, not a parse (see the module note): it skips strings and comments and
 * counts brackets, which is all an object literal of declarations needs. A name
 * that arrives by a spread is invisible to it — the build's read is the truth.
 *
 * @param {string} text - main.js source
 * @returns {boolean}
 */
export function mainNamesFoundation(text) {
  const opening = /export\s+default\s*\{/.exec(text)
  if (!opening) return false
  let depth = 1
  let atKey = true // just after the opening brace, or a comma at the top level
  for (let i = opening.index + opening[0].length; i < text.length && depth > 0; i++) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i)
      if (i < 0) break
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1
      if (i <= 0) break
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1
      if (depth === 1 && atKey && text.slice(i + 1, j) === 'name' && /^\s*:/.test(text.slice(j + 1))) {
        return true
      }
      i = j
      atKey = false
    } else if ('{[('.includes(c)) {
      depth++
      atKey = false
    } else if ('}])'.includes(c)) {
      depth--
    } else if (depth === 1 && c === ',') {
      atKey = true
    } else if (depth === 1 && atKey && /[A-Za-z_$]/.test(c)) {
      const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))[0]
      // `name: 'x'`, or the shorthand `{ name }`
      if (word === 'name' && /^\s*[:,}]/.test(text.slice(i + word.length))) return true
      i += word.length - 1
      atKey = false
    } else if (!/\s/.test(c)) {
      atKey = false
    }
  }
  return false
}

/**
 * Write `name` into a foundation's `main.js`.
 *
 * With `replace`, the one `name: '<replace>'` literal is rewritten — the case where
 * main.js already names the foundation, with a name that cannot register. Without
 * it, `name` becomes the default export's first key. A missing main.js is created.
 *
 * ⚠️ A text edit, not a parse: it handles `export default { … }` — every scaffold
 * and every template — and says so otherwise rather than guessing.
 *
 * @param {string} mainFile
 * @param {string} name - already a valid foundation name
 * @param {{ replace?: string|null }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function writeFoundationName(mainFile, name, { replace = null } = {}) {
  const line = `${NAME_COMMENT}\n  name: '${name}',`
  if (!existsSync(mainFile)) {
    writeFileSync(mainFile, `export default {\n  ${line}\n}\n`)
    return { ok: true }
  }
  const text = readFileSync(mainFile, 'utf8')

  if (replace !== null) {
    const literal = new RegExp(
      `(\\bname\\s*:\\s*)(['"\`])${replace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\2`,
      'g'
    )
    const hits = text.match(literal) || []
    if (hits.length !== 1) {
      return {
        ok: false,
        reason: `main.js does not name the foundation "${replace}" in exactly one place`
      }
    }
    writeFileSync(mainFile, text.replace(literal, `$1'${name}'`))
    return { ok: true }
  }

  const opening = /export\s+default\s*\{/.exec(text)
  if (!opening) {
    return { ok: false, reason: 'main.js has no `export default { … }` to add a name to' }
  }
  // The name leads the export — on lines of its own, so a multi-line export keeps
  // its first line and gains a blank one between.
  const at = opening.index + opening[0].length
  writeFileSync(mainFile, `${text.slice(0, at)}\n  ${line}\n${text.slice(at)}`)
  return { ok: true }
}

/**
 * Give a freshly scaffolded foundation its name, unless its main.js already has one.
 *
 * Called after template content is applied, because a template's own main.js
 * replaces the scaffolded one — and with it the name the scaffold wrote.
 *
 * @param {string} foundationDir - the scaffolded package (flat layout: main.js at its root)
 * @param {string|null} name
 */
export function ensureFoundationName(foundationDir, name) {
  if (!name) return
  const mainFile = join(foundationDir, 'main.js')
  if (existsSync(mainFile) && mainNamesFoundation(readFileSync(mainFile, 'utf8'))) return
  writeFoundationName(mainFile, name)
}
