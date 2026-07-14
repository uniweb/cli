/**
 * Template resolver - parses template identifiers and determines source type
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Built-in templates (programmatic, not file-based)
export const BUILTIN_TEMPLATES = ['blank', 'starter', 'none']

/**
 * Load the official template metadata map — `{ id: { name, description,
 * tags } }`, keyed by template id.
 *
 * There are two sources of truth depending on where the CLI is running:
 *
 * 1. **Local dev inside the Uniweb monorepo** — the authoritative file
 *    is `framework/templates/manifest.json`. Adding a new template
 *    there makes it immediately reachable from any locally-run CLI
 *    without republishing. This is the only path that matters for
 *    `node scripts/framework/sandbox.js create`.
 *
 * 2. **Published CLI (npm-installed)** — the monorepo isn't on disk, so
 *    we read the vendored framework index at `../framework-index.json`,
 *    which the publish pipeline rewrites just before `pnpm publish` runs,
 *    copying the manifest's `templates` verbatim. The framework index is a
 *    single snapshot file that also carries `@uniweb/*` package versions
 *    (consumed by versions.js), so both the template list and the version
 *    resolver share one source of truth.
 *
 * When both sources are available (local dev with a committed snapshot),
 * the live workspace manifest wins so newly-added templates are visible
 * without waiting for a CLI republish.
 *
 * Both files store `templates` as the same `{ id: { name, description,
 * tags } }` shape, so one map feeds both name-resolution
 * (OFFICIAL_TEMPLATES) and the interactive picker (buildTemplateChoices) —
 * neither hardcodes a list. (An earlier version returned only the keys and
 * left the `create` picker with its own hardcoded array, which silently
 * drifted out of sync whenever a template was added.)
 */
function loadOfficialTemplateMap() {
  // Local dev: framework/templates/manifest.json relative to this file
  // at framework/cli/src/templates/resolver.js
  const workspaceManifest = join(__dirname, '..', '..', '..', 'templates', 'manifest.json')
  const picked = tryReadTemplateMap(workspaceManifest)
  if (picked) return picked

  // Published CLI fallback: the framework index snapshot, one directory
  // up at framework/cli/src/framework-index.json.
  const indexPath = join(__dirname, '..', 'framework-index.json')
  const fromIndex = tryReadTemplateMap(indexPath)
  if (fromIndex) return fromIndex

  // If both sources fail, return an empty map rather than a stale
  // hardcoded list. An unknown template name then falls through to
  // the npm `@uniweb/template-<name>` lookup path, which is the
  // intended behavior for third-party templates.
  return {}
}

function tryReadTemplateMap(path) {
  try {
    if (!statSync(path).isFile()) return null
    const data = JSON.parse(readFileSync(path, 'utf8'))
    if (data && data.templates && typeof data.templates === 'object') {
      return data.templates
    }
  } catch {}
  return null
}

// Official template metadata keyed by id. Derived from manifest.json (local
// dev) or framework-index.json (published CLI) at module load time — see
// loadOfficialTemplateMap() for details. Read once per process; to reflect a
// just-added template, restart the CLI or rerun the scaffolder.
export const OFFICIAL_TEMPLATE_MAP = loadOfficialTemplateMap()

// Official template ids, e.g. ['marketing', 'docs', 'academic', …].
export const OFFICIAL_TEMPLATES = Object.keys(OFFICIAL_TEMPLATE_MAP)

// Built-in (programmatic) picker entries — not in the manifest; the CLI
// generates these itself. "Blank" trails the official templates.
const BUILTIN_LEAD_CHOICES = [
  { title: 'None', value: 'none', description: 'Foundation + site with no content' },
  { title: 'Starter', value: 'starter', description: 'Foundation + site + sample content' }
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
      name: identifier,
    }
  }

  // Official templates from @uniweb/templates
  if (OFFICIAL_TEMPLATES.includes(identifier)) {
    return {
      type: 'official',
      name: identifier,
    }
  }

  // GitHub shorthand: github:user/repo or github:user/repo#ref
  if (identifier.startsWith('github:')) {
    const rest = identifier.slice(7) // Remove 'github:'
    return parseGitHubIdentifier(rest)
  }

  // GitHub URL: https://github.com/user/repo
  if (identifier.startsWith('https://github.com/') || identifier.startsWith('http://github.com/')) {
    const url = new URL(identifier)
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length >= 2) {
      const [owner, repo] = pathParts
      // Check for tree/branch in URL
      const treeIndex = pathParts.indexOf('tree')
      const ref = treeIndex >= 0 && pathParts[treeIndex + 1] ? pathParts[treeIndex + 1] : undefined
      return {
        type: 'github',
        owner,
        repo: repo.replace(/\.git$/, ''),
        ref,
      }
    }
    throw new Error(`Invalid GitHub URL: ${identifier}`)
  }

  // Scoped npm package: @scope/package-name
  if (identifier.startsWith('@')) {
    return {
      type: 'npm',
      package: identifier,
    }
  }

  // Local path (relative, absolute, or home directory)
  if (identifier.startsWith('./') || identifier.startsWith('../') ||
      identifier.startsWith('/') || identifier.startsWith('~')) {
    return {
      type: 'local',
      path: identifier,
    }
  }

  // Unscoped name - assume it's an npm package with @uniweb/template- prefix
  // This allows users to type `uniweb create foo --template blog` for @uniweb/template-blog
  return {
    type: 'npm',
    package: `@uniweb/template-${identifier}`,
  }
}

/**
 * Parse GitHub identifier: user/repo or user/repo#ref
 */
function parseGitHubIdentifier(identifier) {
  const [repoPath, ref] = identifier.split('#')
  const [owner, repo] = repoPath.split('/')

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub identifier: ${identifier}. Expected format: user/repo or user/repo#ref`)
  }

  return {
    type: 'github',
    owner,
    repo: repo.replace(/\.git$/, ''),
    ref: ref || undefined,
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
