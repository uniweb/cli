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
// module (`utils/workspace.js`), before any project is installed.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import Handlebars from 'handlebars'

export const WORKSPACE_FILE = 'pnpm-workspace.yaml'

const TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates',
  'workspace',
  `${WORKSPACE_FILE}.hbs`
)

// ─── Reading ────────────────────────────────────────────────────────────────

/**
 * The package patterns a workspace declares, and the file they are read from:
 * pnpm-workspace.yaml when the workspace has one, else package.json's `workspaces`.
 *
 * @param {string} rootDir
 * @returns {{ source: string|null, patterns: string[] }}
 */
export function readWorkspacePatterns(rootDir) {
  const ymlPath = join(rootDir, WORKSPACE_FILE)
  if (existsSync(ymlPath)) {
    const doc = yaml.load(readFileSync(ymlPath, 'utf8'))
    return { source: WORKSPACE_FILE, patterns: strings(doc?.packages) }
  }
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
    if (Array.isArray(pkg.workspaces)) return { source: 'package.json', patterns: strings(pkg.workspaces) }
  } catch {
    // No package.json, or not JSON — a workspace with no packages declared.
  }
  return { source: null, patterns: [] }
}

/**
 * The workspace's packages: the folders its patterns name.
 *
 * @param {string} rootDir
 * @returns {string[]} see {@link resolveWorkspacePackages}
 */
export function workspacePackages(rootDir) {
  return resolveWorkspacePackages(rootDir, readWorkspacePatterns(rootDir).patterns)
}

/**
 * The folders `patterns` name under `rootDir`, as workspace-relative paths in `/`
 * form, each once, in the order of the first pattern that names it — alphabetical
 * within a pattern. A folder a wildcard finds counts only when it holds a
 * package.json; one a pattern names by its own path counts if it exists.
 *
 * @param {string} rootDir
 * @param {string[]} patterns
 * @returns {string[]}
 */
export function resolveWorkspacePackages(rootDir, patterns) {
  const { include, exclude } = parsePatterns(patterns)
  const seen = new Set()
  const out = []
  for (const pattern of include) {
    const byWildcard = pattern.some((segment) => segment === '**' || hasMagic(segment))
    for (const rel of expand(rootDir, pattern, [], 0, [])) {
      // The root is the workspace itself, never one of its packages.
      if (!rel || seen.has(rel)) continue
      if (byWildcard && !existsSync(join(rootDir, rel, 'package.json'))) continue
      if (exclude.some((ex) => matches(ex, rel.split('/')))) continue
      seen.add(rel)
      out.push(rel)
    }
  }
  return out
}

/**
 * Do `patterns` cover the folder at `relPath` — would it be one of the workspace's
 * packages? Answered from the patterns alone, so it holds for a folder about to be
 * created.
 *
 * @param {string[]} patterns
 * @param {string} relPath - workspace-relative
 * @returns {boolean}
 */
export function patternsCover(patterns, relPath) {
  const path = normalizePath(relPath)
  if (!path) return false
  const segments = path.split('/')
  const { include, exclude } = parsePatterns(patterns)
  return (
    include.some((p) => matches(p, segments)) &&
    !exclude.some((p) => matches(p, segments))
  )
}

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

// ─── Patterns ───────────────────────────────────────────────────────────────

// `@(…)`, `+(…)`, `!(…)`, `*(…)`, `?(…)` — extended globs, which this does not read.
const EXTGLOB = /[@+!*?]\(/
const warned = new Set()

/** Positive and negative patterns as folder-name lists, `{a,b}` expanded. */
function parsePatterns(patterns) {
  const include = []
  const exclude = []
  for (const raw of strings(patterns)) {
    let pattern = raw.trim()
    const negated = pattern.startsWith('!')
    if (negated) pattern = pattern.slice(1)
    if (EXTGLOB.test(pattern)) {
      if (!warned.has(raw)) {
        warned.add(raw)
        process.stderr.write(
          `⚠ uniweb does not read the workspace pattern "${raw}" (extended glob syntax) — ` +
            `list the folders it stands for instead.\n`
        )
      }
      continue
    }
    for (const one of expandBraces(pattern)) {
      const path = normalizePath(one)
      if (path) (negated ? exclude : include).push(path.split('/'))
    }
  }
  return { include, exclude }
}

/** `a/{b,c}/d` → `a/b/d`, `a/c/d`; nested lists expand innermost first. */
function expandBraces(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern)
  if (!m) return [pattern]
  const options = m[1].split(',')
  // `{x}` lists nothing to choose between: a literal brace, as in pnpm.
  if (options.length < 2) return [pattern]
  const head = pattern.slice(0, m.index)
  const tail = pattern.slice(m.index + m[0].length)
  return options.flatMap((o) => expandBraces(head + o + tail))
}

/** `./a//b/` → `a/b`; `\` becomes `/`; `.` and `` are the root. */
function normalizePath(path) {
  let s = String(path).replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  while (s.startsWith('./')) s = s.slice(2)
  s = s.replace(/^\/+/, '').replace(/\/+$/, '')
  return s === '.' ? '' : s
}

const hasMagic = (segment) => /[*?[]/.test(segment)

/** Can a wildcard step into this folder? Never `node_modules`, never a dot-folder. */
const wildcardMayEnter = (name) => !name.startsWith('.') && name !== 'node_modules'

const regexCache = new Map()

/** One folder-name pattern as a regex: `*`, `?` and `[...]`, everything else literal. */
function segmentRegex(segment) {
  let re = regexCache.get(segment)
  if (re) return re
  let src = ''
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]
    if (c === '*') src += '[^/]*'
    else if (c === '?') src += '[^/]'
    else if (c === '[' && segment.indexOf(']', i + 2) > i) {
      const end = segment.indexOf(']', i + 2)
      let body = segment.slice(i + 1, end).replace(/\\/g, '\\\\')
      if (body.startsWith('!')) body = `^${body.slice(1)}`
      src += `[${body}]`
      i = end
    } else src += c.replace(/[.+^$(){}|\\[\]]/g, '\\$&')
  }
  re = new RegExp(`^${src}$`)
  regexCache.set(segment, re)
  return re
}

function segmentMatches(segment, name) {
  if (!hasMagic(segment)) return segment === name
  // A wildcard does not match a dot-folder unless the pattern spells the dot.
  if (name.startsWith('.') && !segment.startsWith('.')) return false
  if (name === 'node_modules') return false
  return segmentRegex(segment).test(name)
}

/** Does the folder-name list `path` match the pattern `pattern`? `**` is any depth. */
function matches(pattern, path, i = 0, j = 0) {
  if (i === pattern.length) return j === path.length
  if (pattern[i] === '**') {
    for (let k = j; k <= path.length; k++) {
      if (k > j && !wildcardMayEnter(path[k - 1])) break
      if (matches(pattern, path, i + 1, k)) return true
    }
    return false
  }
  if (j === path.length || !segmentMatches(pattern[i], path[j])) return false
  return matches(pattern, path, i + 1, j + 1)
}

/** The folders under `rootDir` that `pattern` names, found on disk. */
function expand(rootDir, pattern, base, i, out) {
  if (i === pattern.length) {
    out.push(base.join('/'))
    return out
  }
  const segment = pattern[i]
  const here = join(rootDir, ...base)
  if (segment === '**') {
    expand(rootDir, pattern, base, i + 1, out)
    // Real folders only: a symlink back up the tree would never end.
    for (const name of subfolders(here, { followLinks: false })) {
      if (wildcardMayEnter(name)) expand(rootDir, pattern, [...base, name], i, out)
    }
    return out
  }
  if (!hasMagic(segment)) {
    if (segment === '.') return expand(rootDir, pattern, base, i + 1, out)
    if (isFolder(join(here, segment))) expand(rootDir, pattern, [...base, segment], i + 1, out)
    return out
  }
  for (const name of subfolders(here)) {
    if (segmentMatches(segment, name)) expand(rootDir, pattern, [...base, name], i + 1, out)
  }
  return out
}

function subfolders(dir, { followLinks = true } = {}) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(
      (e) => e.isDirectory() || (followLinks && e.isSymbolicLink() && isFolder(join(dir, e.name)))
    )
    .map((e) => e.name)
    .sort()
}

function isFolder(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
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

function strings(list) {
  return Array.isArray(list) ? list.filter((v) => typeof v === 'string') : []
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
