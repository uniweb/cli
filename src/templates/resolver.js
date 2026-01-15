/**
 * Template resolver - parses template identifiers and determines source type
 */

// Built-in templates that are generated programmatically
export const BUILTIN_TEMPLATES = ['single', 'multi']

// Official templates from @uniweb/templates package
export const OFFICIAL_TEMPLATES = ['marketing', 'docs', 'learning']

/**
 * Parse a template identifier and determine its source type
 *
 * @param {string} identifier - Template identifier (e.g., 'single', 'marketing', 'github:user/repo')
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
    default:
      return 'Unknown'
  }
}
