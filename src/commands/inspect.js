/**
 * uniweb inspect — Show parsed content shape of markdown files.
 *
 * Usage:
 *   uniweb inspect pages/home/hero.md          Single section
 *   uniweb inspect pages/home/                 All sections on a page, in the page's order
 *   uniweb inspect pages/home/hero.md --raw    ProseMirror AST instead of flat shape
 *   uniweb inspect pages/home/ --full          Include empty fields (matches runtime)
 *   uniweb inspect pages/home/ --sequence      Include sequence array
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, extname, basename, dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { isSectionKey, isSectionParam } from '@uniweb/schemas/section'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m'
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
    help: false
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
      import('@uniweb/semantic-parser')
    ])
    // Optional: the inset lift a Block runs (`@uniweb/core/insets`). An older
    // install without it shows the insets unlifted, as `inset_ref` nodes.
    const coreInsets = await import('@uniweb/core/insets').catch(() => null)
    return {
      markdownToProseMirror: contentReader.markdownToProseMirror,
      parseContent: semanticParser.parseContent,
      liftInsets: coreInsets?.liftInsets,
      // Optional: present from @uniweb/semantic-parser >= the staircase
      // release; older installs simply show no findings.
      lintContent: semanticParser.lintContent
    }
  } catch {
    console.error(
      `${colors.red}✗${colors.reset} Could not load @uniweb/content-reader or @uniweb/semantic-parser.`
    )
    console.error(
      `  These packages must be installed in the workspace (they come with @uniweb/build).`
    )
    process.exit(1)
  }
}

/**
 * Extract frontmatter and markdown body from a section file.
 * Exact match of content-collector lines 634-639.
 */
function extractFrontmatter(raw) {
  // A file saved on Windows: as the build reads it (`parseFrontmatter`, @uniweb/build).
  const content = raw.replace(/\r\n/g, '\n')
  let frontMatter = {}
  let markdown = content

  if (content.trim().startsWith('---')) {
    const parts = content.split('---\n')
    if (parts.length >= 3) {
      try {
        frontMatter = yaml.load(parts[1]) || {}
      } catch (err) {
        console.warn(
          `${colors.yellow}Warning: YAML parse error: ${err.message}${colors.reset}`
        )
        frontMatter = {}
      }
      markdown = parts.slice(2).join('---\n')
    }
  }

  return { frontMatter, markdown }
}

/**
 * Split a section's frontmatter as the site build does (`@uniweb/build`,
 * `content-collector.js::processMarkdownFile`), then as core builds the Block: every key but
 * `SECTION_KEYS` and `fetch` is a param, with `props:` merged in, and of those the section's own
 * settings (`SECTION_PARAMS` — `theme`, `background`, `grid`, `vars`, `fetch`, `sticky`,
 * `underHeader`) are lifted onto the Block, so the component never receives them
 * (`@uniweb/schemas/section`). So `params` is what the component receives, less its `meta.js`
 * defaults, which need the foundation; `reserved` is every other key written.
 *
 * ⛔ Until 2026-11-11 this kept its own list, said to match the build exactly, which had drifted:
 * `hidden`, `query`, `grid`, `vars`, `sticky` and `underHeader` showed as params, a key under
 * `props:` showed as none, and `component:` was read as `type:`.
 */
function splitParams(frontMatter) {
  const { type, preset, props } = frontMatter
  const written = {}
  const reserved = {}
  for (const [key, value] of Object.entries(frontMatter)) {
    if (key === 'type' || key === 'preset' || key === 'props') continue
    if (key === 'fetch' || isSectionKey(key)) reserved[key] = value
    else written[key] = value
  }
  if (props && typeof props === 'object' && !Array.isArray(props)) Object.assign(written, props)
  const params = {}
  for (const [key, value] of Object.entries(written)) {
    if (isSectionParam(key)) reserved[key] = value
    else params[key] = value
  }
  return {
    type: type || null,
    preset: preset || null,
    reserved,
    params
  }
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
    insets: item.insets || [],
    media: item.media || [],
    snippets: item.snippets || [],
    buttons: item.buttons || [],
    data: item.data || {},
    cards: item.cards || [],
    documents: item.documents || [],
    forms: item.forms || [],
    quotes: item.quotes || [],
    headings: item.headings || [],
    ...(item.math && item.math.length ? { math: item.math } : {}),
    ...(item.tables && item.tables.length ? { tables: item.tables } : {})
  }
}

/**
 * Guarantee content structure exists: what a component receives.
 * A copy of @uniweb/runtime's, which the CLI can't load without React.
 * _contracts/inspect-shows-what-a-component-receives.test.js fails when they part.
 */
export function guaranteeContentStructure(parsedContent) {
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
    media: content.media || [],
    snippets: content.snippets || [],
    buttons: content.buttons || [],
    data: content.data || {},
    cards: content.cards || [],
    documents: content.documents || [],
    forms: content.forms || [],
    quotes: content.quotes || [],
    headings: content.headings || [],
    ...(content.math && content.math.length ? { math: content.math } : {}),
    ...(content.tables && content.tables.length ? { tables: content.tables } : {}),
    items: (content.items || []).map(guaranteeItemStructure),
    sequence: content.sequence || [],
    raw: content.raw
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
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      continue

    // Recursively clean items
    if (key === 'items' && Array.isArray(value)) {
      result[key] = value.map((item) => removeEmptyFields(item))
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

  // Parse markdown to ProseMirror — the document as stored, insets as written.
  const stored = markdownToProseMirror(markdown)

  // What the component receives: the insets lifted the way a Block lifts them —
  // a placeholder in the content, the inset itself listed beside it. ⛔ This
  // file carried its own copy of the site build's extractor until 2026-09-27,
  // and it had drifted (top-level only, no inline insets, `description` for
  // `title`); insets are lifted by core now, so this asks core.
  const lifted = deps.liftInsets
    ? deps.liftInsets(stored)
    : { content: stored, leaves: [], containers: [] }
  const doc = lifted.content
  const insets = [
    ...lifted.leaves,
    ...lifted.containers.map(({ refId, type, params }) => ({ refId, type, params, container: true }))
  ]

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
    // Raw mode: the ProseMirror AST as stored — insets in it as the author wrote them.
    result.prosemirror = stored
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

  // Grouping near-miss findings — shapes that usually mean the author got a
  // different structure than they wanted (an entry absorbed into the
  // headline, a hand-written eyebrow demoting the title). Observation only:
  // the parse above is untouched.
  const findings = deps.lintContent?.(doc) || []
  if (findings.length > 0) result.findings = findings

  return result
}

/**
 * Natural sort comparator for filenames (handles numeric prefixes).
 */
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * The site a folder is in: the nearest folder above it, or itself, holding a `site.yml`.
 */
function findSiteRoot(dir) {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, 'site.yml'))) return at
    if (dirname(at) === at) return null
  }
}

/**
 * A page folder's files as the page has them, by the build's own walk of it (`pageSectionFiles`), and
 * the files it leaves out. A folder outside a site has no page to ask, so it keeps its name order.
 */
async function inPageOrder(target, files) {
  const siteRoot = findSiteRoot(target)
  if (!siteRoot) return { files, notOnPage: [] }
  try {
    const { pageSectionFiles } = await import('@uniweb/build/content')
    const onPage = await pageSectionFiles(target, siteRoot)
    return { files: onPage, notOnPage: files.filter((file) => !onPage.includes(file)) }
  } catch (err) {
    console.error(
      `${colors.yellow}In name order: could not read this page's order (${err.message})${colors.reset}`
    )
    return { files, notOnPage: [] }
  }
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
  <path>        Path to a .md file, or a page folder: its sections in the page's order

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
      console.error(
        `${colors.red}✗${colors.reset} Expected a .md file: ${flags.target}`
      )
      process.exit(1)
    }
    const content = readFileSync(target, 'utf8')
    const result = processFile(content, basename(target), deps, options)
    console.log(JSON.stringify(result, null, 2))
  } else if (stat.isDirectory()) {
    const found = readdirSync(target)
      .filter(
        (f) => extname(f) === '.md' && !f.startsWith('_') && f !== 'README.md'
      )
      .sort(naturalSort)

    if (found.length === 0) {
      console.error(
        `${colors.yellow}No .md files found in: ${flags.target}${colors.reset}`
      )
      return
    }

    const { files, notOnPage } = await inPageOrder(target, found)
    if (notOnPage.length > 0) {
      console.error(
        `${colors.dim}Not on this page: ${notOnPage.join(', ')}${colors.reset}`
      )
    }

    const results = files.map((file) => {
      const content = readFileSync(resolve(target, file), 'utf8')
      const result = processFile(content, file, deps, options)
      result._file = file
      return result
    })

    console.log(JSON.stringify(results, null, 2))
  }
}
