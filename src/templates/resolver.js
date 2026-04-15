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
 * Load the list of official template names.
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
 *    we read a vendored snapshot file (`./official-templates.snapshot.json`)
 *    that the publish script rewrites from the workspace manifest just
 *    before `pnpm publish` runs. The snapshot is committed so every CLI
 *    version in git carries the template list it shipped with.
 *
 * When both sources are available (local dev with a committed snapshot),
 * the live workspace manifest wins so newly-added templates are visible
 * without waiting for a CLI republish.
 *
 * The previous implementation hardcoded a string array here, which
 * silently duplicated `framework/templates/manifest.json` and required
 * a two-repo edit whenever a template was added.
 */
function loadOfficialTemplateList() {
  // Local dev: framework/templates/manifest.json relative to this file
  // at framework/cli/src/templates/resolver.js
  const workspaceManifest = join(__dirname, '..', '..', '..', 'templates', 'manifest.json')
  const picked = tryReadManifest(workspaceManifest)
  if (picked) return picked

  // Published CLI fallback: vendored snapshot next to this file
  const snapshotPath = join(__dirname, 'official-templates.snapshot.json')
  const snapshot = tryReadManifest(snapshotPath)
  if (snapshot) return snapshot

  // If both fail, return an empty list rather than a stale hardcoded
  // array. An unknown template name then falls through to the npm
  // `@uniweb/template-<name>` lookup path, which is the intended
  // behavior for third-party templates.
  return []
}

function tryReadManifest(path) {
  try {
    if (!statSync(path).isFile()) return null
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    if (manifest && manifest.templates && typeof manifest.templates === 'object') {
      return Object.keys(manifest.templates)
    }
  } catch {}
  return null
}

// Official templates from the templates repo. Derived from manifest.json
// at module load time — see loadOfficialTemplateList() for the two source
// paths (local workspace vs. vendored snapshot). If the list needs to
// reflect a just-added template, restart the CLI process or rerun the
// scaffolder; this constant is read once per process.
export const OFFICIAL_TEMPLATES = loadOfficialTemplateList()

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
