// The workspace's packages — read as pnpm reads them, and written without touching
// anything else in the file.
//
// A workspace lists its packages as folder patterns: `packages:` in
// pnpm-workspace.yaml, or `workspaces` in package.json for npm and yarn. Every
// command that asks which packages a workspace holds — discovery, the workspace
// build, `update`'s survey, `dev`, `doctor` — asks here, and every command that adds
// or moves one edits the list through here.
//
// Patterns are read as pnpm reads them: `*`, `?` and `[...]` within one folder name,
// `**` for any depth, `{a,b}` for alternatives, and a leading `!` to exclude what the
// other patterns match. A folder a wildcard finds counts when it holds a package.json,
// as pnpm counts it — so `**` never sweeps in a `pages/` or `dist/` folder — and a
// wildcard never enters `node_modules` or a dot-folder. A folder listed by its own path
// counts if it exists: listing it says it is one, and a command that reads content only
// (`validate`) works on a folder with no manifest yet. Any other syntax is refused by
// name, never read as a path.
//
// ⛔ Until 2026-10-13 the CLI had two readers, each a partial copy of glob syntax:
// one read `x/*`, `*/x` and plain paths (discovery, the workspace build), the other
// only `x/*` and plain paths (`update`). `*/sites/*` matched nothing in either while
// pnpm read it, and `update` could not see the `*/src` that `add project` writes — it
// reported a stale foundation as aligned. And three writers (`add`, `rename`,
// `doctor --fix`) rewrote the file from its `packages` alone, deleting its comments
// and every other key, `onlyBuiltDependencies` and `allowBuilds` among them.
//
// Node built-ins, js-yaml and Handlebars only: the CLI's startup path reaches this
// module (`utils/workspace.js`), before any project is installed. ⭐ The reading half is
// `./workspace-patterns.js`, mirrored byte for byte in `@uniweb/build`, which reads the same
// rule; this module keeps the writing and re-exports the reading.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import Handlebars from 'handlebars'
import { WORKSPACE_FILE, strings } from './workspace-patterns.js'

export {
  WORKSPACE_FILE,
  readWorkspacePatterns,
  workspacePackages,
  resolveWorkspacePackages,
  patternsCover,
} from './workspace-patterns.js'

const TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates',
  'workspace',
  `${WORKSPACE_FILE}.hbs`
)

// ─── Writing ────────────────────────────────────────────────────────────────

/**
 * A new pnpm-workspace.yaml listing `entries`, made from the workspace template —
 * as `uniweb create` makes it, build settings included.
 *
 * @param {string[]} entries
 * @returns {string}
 */
export function renderWorkspaceFile(entries) {
  return Handlebars.compile(readFileSync(TEMPLATE, 'utf8'))({ workspaceGlobs: entries })
}

/**
 * pnpm-workspace.yaml's text with its `packages:` list changed by `edit`, and nothing
 * else: comments, every other key and the layout stay as they were. `edit` may append
 * entries or replace entries in place.
 *
 * The result is proven before it is returned — parsed again, it must hold the new
 * list and every other key unchanged. Null when it does not, or when the list is not
 * one this can edit in place: the caller says so rather than rewrite the file.
 *
 * @param {string} text
 * @param {(list: string[]) => string[]} edit
 * @returns {string|null}
 */
export function editWorkspaceFilePackages(text, edit) {
  let before
  try {
    before = yaml.load(text) ?? {}
  } catch {
    return null
  }
  if (typeof before !== 'object' || Array.isArray(before)) return null
  const current = strings(before.packages)
  const next = edit([...current])
  const out = rewriteList(text, current, next)
  if (out == null) return null

  let after
  try {
    after = yaml.load(out) ?? {}
  } catch {
    return null
  }
  if (!sameValue(strings(after.packages), next)) return null
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key !== 'packages' && !sameValue(before[key], after[key])) return null
  }
  return out
}

// ─── The `packages:` list, as text ──────────────────────────────────────────

/**
 * Apply `current` → `next` to the text of the `packages:` list: entries appended at
 * its end, entries replaced on their own lines. Null for any other change, or a list
 * written in a shape this does not edit (a flow list over several lines, an entry
 * over several lines).
 */
function rewriteList(text, current, next) {
  const appended = next.length >= current.length && current.every((v, i) => v === next[i])
  const replaced = next.length === current.length
  if (!appended && !replaced) return null

  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const key = lines.findIndex((l) => /^packages\s*:/.test(l))

  // No `packages:` key yet — the list goes first, the rest of the file after it.
  if (key < 0) {
    if (!appended) return null
    const items = next.map((v) => `  - ${formatEntry(v, '"')}`)
    return ['packages:', ...items, '', text].join(eol)
  }

  const inline = lines[key].slice(lines[key].indexOf(':') + 1)
  if (inline.trim() && !inline.trim().startsWith('#')) {
    // A flow list on the key's own line: `packages: ["a", "b"]`.
    const m = /^(\s*)\[(.*)\](\s*(#.*)?)$/.exec(inline)
    if (!m) return null
    lines[key] = `packages:${m[1]}[${next.map((v) => formatEntry(v, '"')).join(', ')}]${m[3]}`
    return lines.join(eol)
  }

  // A block list: the `- ` lines that follow, until the next key.
  const items = []
  for (let i = key + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^\s*(#.*)?$/.test(l)) continue
    if (/^\s*-(\s|$)/.test(l)) items.push(i)
    else if (/^\s/.test(l)) return null // an entry over several lines
    else break
  }
  if (items.length !== current.length) return null

  for (let p = 0; p < current.length; p++) {
    if (next[p] === current[p]) continue
    const parts = splitItem(lines[items[p]])
    if (!parts) return null
    lines[items[p]] = `${parts.indent}- ${formatEntry(next[p], parts.quote)}${parts.tail}`
  }
  if (next.length > current.length) {
    const last = items.length ? splitItem(lines[items[items.length - 1]]) : null
    const indent = last ? last.indent : '  '
    const quote = last ? last.quote : '"'
    const added = next.slice(current.length).map((v) => `${indent}- ${formatEntry(v, quote)}`)
    lines.splice((items.length ? items[items.length - 1] : key) + 1, 0, ...added)
  }
  return lines.join(eol)
}

/** A list line's indent, its value's quote style, and what follows the value. */
function splitItem(line) {
  const m = /^(\s*)-\s+(.*)$/.exec(line)
  if (!m) return null
  const [, indent, rest] = m
  const q = rest[0]
  if (q === '"' || q === "'") {
    let i = 1
    for (; i < rest.length; i++) {
      if (q === '"' && rest[i] === '\\') i++
      else if (rest[i] === q) {
        if (q === "'" && rest[i + 1] === "'") i++
        else break
      }
    }
    if (i >= rest.length) return null
    return { indent, quote: q, tail: rest.slice(i + 1) }
  }
  const hash = rest.search(/\s#/)
  return { indent, quote: '', tail: hash < 0 ? '' : rest.slice(hash) }
}

/** An entry as YAML, in the list's quote style — quoted whenever a bare one could misread. */
function formatEntry(value, quote) {
  if (quote === "'") return `'${value.replace(/'/g, "''")}'`
  if (quote === '' && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(value)) return value
  return JSON.stringify(value)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
