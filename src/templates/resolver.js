/**
 * Template resolver - parses template identifiers and determines source type
 */

import { loadFrameworkIndex } from '../versions.js'

// Built-in templates (programmatic, not file-based)
export const BUILTIN_TEMPLATES = ['blank', 'starter', 'none']

/**
 * THE OFFICIAL TEMPLATES THIS CLI SCAFFOLDS — one snapshot.
 *
 * `../framework-index.json` is written when the CLI is published: the
 * templates' manifest (`{ id: { name, description, tags } }`) and, in
 * `packages`, the `@uniweb/templates` version whose release holds their
 * content. The interactive picker, `uniweb template list` and the download in
 * `create` all read it, so the CLI offers exactly the templates it can fetch,
 * and fetches the content released with the package versions it pins. A CLI
 * goes on scaffolding the templates it was published with until it is
 * updated — consistent, not newest.
 *
 * ⛔ Until 2026-10-08 a CLI run from a source checkout listed the templates
 * repo's working manifest instead, and every CLI downloaded from the `latest`
 * release. So a CLI could offer a template its release did not hold, and
 * scaffold content newer than the packages it pinned: a template using a kit
 * export the CLI's kit did not have yet failed to build.
 *
 * (An earlier version still hardcoded the picker's list, which silently
 * drifted whenever a template was added — the reason no list is written here.)
 */
const INDEX = loadFrameworkIndex()

// Official template metadata keyed by id. Empty when the snapshot did not load:
// an unknown name then falls through to the npm `@uniweb/template-<name>`
// lookup, the path for third-party templates, rather than to a stale list.
export const OFFICIAL_TEMPLATE_MAP =
  INDEX?.templates && typeof INDEX.templates === 'object' ? INDEX.templates : {}

// Official template ids, e.g. ['marketing', 'docs', 'academic', …].
export const OFFICIAL_TEMPLATES = Object.keys(OFFICIAL_TEMPLATE_MAP)

// The release the official templates download from — `v<@uniweb/templates
// version>`, the repo's tag — or null when the snapshot names none.
const TEMPLATES_VERSION = INDEX?.packages?.['@uniweb/templates']?.version
export const OFFICIAL_TEMPLATES_RELEASE = TEMPLATES_VERSION ? `v${TEMPLATES_VERSION}` : null

// Built-in (programmatic) picker entries — not in the manifest; the CLI
// generates these itself. "Blank" trails the official templates.
const BUILTIN_LEAD_CHOICES = [
  {
    title: 'None',
    value: 'none',
    description: 'Foundation + site with no content'
  },
  {
    title: 'Starter',
    value: 'starter',
    description: 'Foundation + site + sample content'
  }
]
const BLANK_CHOICE = {
  title: 'Blank workspace',
  value: 'blank',
  description: 'Empty workspace — grow with uniweb add'
}

/**
 * Build the choices for the interactive `create` template prompt: the
 * built-in leads (None, Starter), then every official template from the
 * shared manifest in manifest order, then Blank last. Deriving the official
 * entries from OFFICIAL_TEMPLATE_MAP keeps the picker in lockstep with
 * framework/templates/manifest.json — adding a template there (and
 * republishing the CLI) is all it takes for it to appear here.
 *
 * @returns {Array<{title: string, value: string, description: string}>}
 */
export function buildTemplateChoices() {
  const official = Object.entries(OFFICIAL_TEMPLATE_MAP).map(([id, info]) => ({
    title: info?.name || id,
    value: id,
    description: info?.description || ''
  }))
  return [...BUILTIN_LEAD_CHOICES, ...official, BLANK_CHOICE]
}

/**
 * How many options the `create` picker shows at once: all of them, when the
 * terminal has the rows. prompts shows 10 by default and scrolls the rest, and
 * past ten choices that put most of the official templates below the fold —
 * a template you have to scroll to find reads as one that is not there.
 *
 * Seven rows are kept back: the question, and the highlighted choice's
 * description, which wraps under it when it is long.
 *
 * @param {number} count - the picker's choices
 * @param {number} [rows] - the terminal's height, when it reports one
 * @returns {number}
 */
export function templatePickerPageSize(count, rows = process.stdout.rows) {
  const room = Number.isFinite(rows) && rows > 0 ? rows - 7 : count
  return Math.max(10, Math.min(count, room))
}

/**
 * Parse a template identifier and determine its source type
 *
 * @param {string} identifier - Template identifier (e.g., 'blank', 'marketing', 'github:user/repo')
 * @returns {Object} Parsed template info
 */
export function parseTemplateId(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    throw new Error('Template identifier is required')
  }

  identifier = identifier.trim()

  // Built-in templates
  if (BUILTIN_TEMPLATES.includes(identifier)) {
    return {
      type: 'builtin',
      name: identifier
    }
  }

  // Official templates from @uniweb/templates
  if (OFFICIAL_TEMPLATES.includes(identifier)) {
    return {
      type: 'official',
      name: identifier
    }
  }

  // GitHub shorthand: github:user/repo or github:user/repo#ref
  if (identifier.startsWith('github:')) {
    const rest = identifier.slice(7) // Remove 'github:'
    return parseGitHubIdentifier(rest)
  }

  // GitHub URL: https://github.com/user/repo
  if (
    identifier.startsWith('https://github.com/') ||
    identifier.startsWith('http://github.com/')
  ) {
    const url = new URL(identifier)
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length >= 2) {
      const [owner, repo] = pathParts
      // Check for tree/branch in URL
      const treeIndex = pathParts.indexOf('tree')
      const ref =
        treeIndex >= 0 && pathParts[treeIndex + 1]
          ? pathParts[treeIndex + 1]
          : undefined
      return {
        type: 'github',
        owner,
        repo: repo.replace(/\.git$/, ''),
        ref
      }
    }
    throw new Error(`Invalid GitHub URL: ${identifier}`)
  }

  // Scoped npm package: @scope/package-name
  if (identifier.startsWith('@')) {
    return {
      type: 'npm',
      package: identifier
    }
  }

  // Local path (relative, absolute, or home directory)
  if (
    identifier.startsWith('./') ||
    identifier.startsWith('../') ||
    identifier.startsWith('/') ||
    identifier.startsWith('~')
  ) {
    return {
      type: 'local',
      path: identifier
    }
  }

  // Unscoped name - assume it's an npm package with @uniweb/template- prefix
  // This allows users to type `uniweb create foo --template blog` for @uniweb/template-blog
  return {
    type: 'npm',
    package: `@uniweb/template-${identifier}`
  }
}

/**
 * Parse GitHub identifier: user/repo or user/repo#ref
 */
function parseGitHubIdentifier(identifier) {
  const [repoPath, ref] = identifier.split('#')
  const [owner, repo] = repoPath.split('/')

  if (!owner || !repo) {
    throw new Error(
      `Invalid GitHub identifier: ${identifier}. Expected format: user/repo or user/repo#ref`
    )
  }

  return {
    type: 'github',
    owner,
    repo: repo.replace(/\.git$/, ''),
    ref: ref || undefined
  }
}

/**
 * Get a display name for a template identifier
 */
export function getTemplateDisplayName(parsed) {
  switch (parsed.type) {
    case 'builtin':
      return `Built-in: ${parsed.name}`
    case 'official':
      return `Official: ${parsed.name}`
    case 'npm':
      return parsed.package
    case 'github':
      return `${parsed.owner}/${parsed.repo}${parsed.ref ? `#${parsed.ref}` : ''}`
    case 'local':
      return `Local: ${parsed.path}`
    default:
      return 'Unknown'
  }
}
