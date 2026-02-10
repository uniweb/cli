/**
 * uniweb inspect — Show parsed content shape of markdown files.
 *
 * Usage:
 *   uniweb inspect pages/home/hero.md          Single section
 *   uniweb inspect pages/home/                 All sections in a page folder
 *   uniweb inspect pages/home/hero.md --raw    ProseMirror AST instead of flat shape
 *   uniweb inspect pages/home/ --full          Include empty fields (matches runtime)
 *   uniweb inspect pages/home/ --sequence      Include sequence array
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, extname, basename } from 'node:path'
import yaml from 'js-yaml'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
}

/**
 * Parse CLI arguments for inspect command
 */
function parseArgs(args) {
  const flags = {
    target: null,
    raw: false,
    full: false,
    sequence: false,
    help: false,
  }

  for (const arg of args) {
    if (arg === '--raw') flags.raw = true
    else if (arg === '--full') flags.full = true
    else if (arg === '--sequence') flags.sequence = true
    else if (arg === '--help' || arg === '-h') flags.help = true
    else if (!arg.startsWith('-')) flags.target = arg
  }

  return flags
}

/**
 * Dynamically import content-reader and semantic-parser.
 * These are transitive deps of @uniweb/build, available in any project workspace.
 */
async function loadDependencies() {
  try {
    const [contentReader, semanticParser] = await Promise.all([
      import('@uniweb/content-reader'),
      import('@uniweb/semantic-parser'),
    ])
    return {
      markdownToProseMirror: contentReader.markdownToProseMirror,
      parseContent: semanticParser.parseContent,
    }
  } catch {
    console.error(`${colors.red}✗${colors.reset} Could not load @uniweb/content-reader or @uniweb/semantic-parser.`)
    console.error(`  These packages must be installed in the workspace (they come with @uniweb/build).`)
    process.exit(1)
  }
}

/**
 * Extract frontmatter and markdown body from a section file.
 * Exact match of content-collector lines 634-639.
 */
function extractFrontmatter(content) {
  let frontMatter = {}
  let markdown = content

  if (content.trim().startsWith('---')) {
    const parts = content.split('---\n')
    if (parts.length >= 3) {
      try {
        frontMatter = yaml.load(parts[1]) || {}
      } catch (err) {
        console.warn(`${colors.yellow}Warning: YAML parse error: ${err.message}${colors.reset}`)
        frontMatter = {}
      }
      markdown = parts.slice(2).join('---\n')
    }
  }

  return { frontMatter, markdown }
}

/**
 * Split frontmatter into reserved keys and custom params.
 * Exact match of content-collector line 642.
 */
function splitParams(frontMatter) {
  const { type, component, preset, input, props, fetch, data, id, background, theme, ...params } = frontMatter
  return {
    type: type || component || null,
    preset: preset || null,
    reserved: { data, id, background, theme, input },
    params,
  }
}

/**
 * Extract inset references from a ProseMirror document.
 * Exact match of content-collector lines 192-218.
 *
 * @param {object} doc - ProseMirror document (mutated in place)
 * @returns {Array} Array of { refId, type, params, description }
 */
function extractInsets(doc) {
  if (!doc?.content || !Array.isArray(doc.content)) return []

  const insets = []
  let refIndex = 0

  for (let i = 0; i < doc.content.length; i++) {
    const node = doc.content[i]
    if (node.type === 'inset_ref') {
      const { component, alt, ...params } = node.attrs || {}
      const refId = `inset_${refIndex++}`
      insets.push({
        refId,
        type: component,
        params: Object.keys(params).length > 0 ? params : {},
        description: alt || null,
      })
      // Replace in-place with placeholder
      doc.content[i] = {
        type: 'inset_placeholder',
        attrs: { refId },
      }
    }
  }

  return insets
}

/**
 * Guarantee item has flat content structure.
 * Keep in sync with @uniweb/runtime/src/prepare-props.js
 */
function guaranteeItemStructure(item) {
  return {
    title: item.title || '',
    pretitle: item.pretitle || '',
    subtitle: item.subtitle || '',
    paragraphs: item.paragraphs || [],
    links: item.links || [],
    images: item.images || [],
    lists: item.lists || [],
    icons: item.icons || [],
    videos: item.videos || [],
    buttons: item.buttons || [],
    data: item.data || {},
    cards: item.cards || [],
    documents: item.documents || [],
    forms: item.forms || [],
    quotes: item.quotes || [],
    headings: item.headings || [],
  }
}

/**
 * Guarantee content structure exists.
 * Keep in sync with @uniweb/runtime/src/prepare-props.js
 */
function guaranteeContentStructure(parsedContent) {
  const content = parsedContent || {}

  return {
    title: content.title || '',
    pretitle: content.pretitle || '',
    subtitle: content.subtitle || '',
    alignment: content.alignment || null,
    paragraphs: content.paragraphs || [],
    links: content.links || [],
    images: content.images || [],
    lists: content.lists || [],
    icons: content.icons || [],
    videos: content.videos || [],
    insets: content.insets || [],
    buttons: content.buttons || [],
    data: content.data || {},
    cards: content.cards || [],
    documents: content.documents || [],
    forms: content.forms || [],
    quotes: content.quotes || [],
    headings: content.headings || [],
    items: (content.items || []).map(guaranteeItemStructure),
    sequence: content.sequence || [],
    raw: content.raw,
  }
}

/**
 * Remove empty fields from content for clean output.
 */
function removeEmptyFields(obj) {
  const result = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'raw') continue // Always skip raw ProseMirror in clean output
    if (value === null || value === undefined) continue
    if (value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue

    // Recursively clean items
    if (key === 'items' && Array.isArray(value)) {
      result[key] = value.map(item => removeEmptyFields(item))
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Process a single markdown file and return its parsed shape.
 */
function processFile(fileContent, fileName, deps, options) {
  const { raw, full, sequence } = options
  const { markdownToProseMirror, parseContent } = deps

  const { frontMatter, markdown } = extractFrontmatter(fileContent)
  const { type, preset, reserved, params } = splitParams(frontMatter)

  // Parse markdown to ProseMirror
  const doc = markdownToProseMirror(markdown)

  // Extract insets (mutates doc)
  const insets = extractInsets(doc)

  // Build result
  const result = {}

  if (type) result.type = type
  if (preset) result.preset = preset

  // Include non-empty reserved fields
  for (const [key, value] of Object.entries(reserved)) {
    if (value !== undefined && value !== null) result[key] = value
  }

  // Include params if any
  if (Object.keys(params).length > 0) result.params = params

  // Check if file is a child section
  if (basename(fileName).startsWith('@')) {
    result.child = true
  }

  if (raw) {
    // Raw mode: return ProseMirror AST
    result.prosemirror = doc
    if (insets.length > 0) result.insets = insets
    return result
  }

  // Parse to flat content shape
  const parsed = parseContent(doc)

  // Apply guarantees
  let content = guaranteeContentStructure(parsed)

  if (!full) {
    content = removeEmptyFields(content)
  } else {
    // In full mode, still remove raw
    delete content.raw
  }

  if (!sequence) {
    delete content.sequence
  }

  result.content = content

  if (insets.length > 0) result.insets = insets

  return result
}

/**
 * Natural sort comparator for filenames (handles numeric prefixes).
 */
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Main inspect entry point.
 */
export async function inspect(args) {
  const flags = parseArgs(args)

  if (flags.help || !flags.target) {
    console.log(`
Usage: uniweb inspect <path> [options]

Inspect the parsed content shape of a markdown file or page folder.

Arguments:
  <path>        Path to a .md file or a page folder

Options:
  --raw         Show ProseMirror AST instead of flat content shape
  --full        Include empty fields (matches runtime guarantees)
  --sequence    Include sequence array (document-order elements)
  -h, --help    Show this help
`)
    return
  }

  const target = resolve(process.cwd(), flags.target)
  const deps = await loadDependencies()

  let stat
  try {
    stat = statSync(target)
  } catch {
    console.error(`${colors.red}✗${colors.reset} Not found: ${flags.target}`)
    process.exit(1)
  }

  const options = { raw: flags.raw, full: flags.full, sequence: flags.sequence }

  if (stat.isFile()) {
    if (extname(target) !== '.md') {
      console.error(`${colors.red}✗${colors.reset} Expected a .md file: ${flags.target}`)
      process.exit(1)
    }
    const content = readFileSync(target, 'utf8')
    const result = processFile(content, basename(target), deps, options)
    console.log(JSON.stringify(result, null, 2))
  } else if (stat.isDirectory()) {
    const files = readdirSync(target)
      .filter(f => extname(f) === '.md' && !f.startsWith('_') && f !== 'README.md')
      .sort(naturalSort)

    if (files.length === 0) {
      console.error(`${colors.yellow}No .md files found in: ${flags.target}${colors.reset}`)
      return
    }

    const results = files.map(file => {
      const content = readFileSync(resolve(target, file), 'utf8')
      const result = processFile(content, file, deps, options)
      result._file = file
      return result
    })

    console.log(JSON.stringify(results, null, 2))
  }
}
