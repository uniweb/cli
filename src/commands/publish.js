/**
 * Publish Command
 *
 * Publishes a foundation to the Uniweb Registry.
 *
 * Usage:
 *   uniweb publish                          # Publish to remote registry
 *   uniweb publish --local                  # Publish to local registry (.unicloud/)
 *   uniweb publish --registry <url>         # Publish to a specific registry URL
 *   uniweb publish --edit-access open       # Anyone can edit in Studio (default: restricted)
 *   uniweb publish --dry-run                # Show what would be published
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

import { resolveFoundationSrcPath, classifyPackage } from '@uniweb/build'
import { createLocalRegistry, RemoteRegistry } from '../utils/registry.js'
import { ensureAuth, readAuth } from '../utils/auth.js'
import { getRegistryUrl } from '../utils/config.js'
import { findWorkspaceRoot, findFoundations, findSites, promptSelect } from '../utils/workspace.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

function success(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

function error(message) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

function info(message) {
  console.log(`${colors.cyan}→${colors.reset} ${message}`)
}

/**
 * Resolve the foundation directory to publish.
 *
 * Priority:
 * 1. In a foundation directory → use it
 * 2. At workspace root, one foundation → use it
 * 3. At workspace root, multiple → prompt (or error if non-interactive)
 * 4. No foundation → educational error
 *
 * @param {string[]} args
 * @returns {Promise<string>} Absolute path to the foundation directory
 */
async function resolveFoundationDir(args) {
  const cwd = process.cwd()
  const prefix = getCliPrefix()

  // Check if current directory is a foundation
  const type = classifyPackage(cwd)
  if (type === 'foundation') {
    return cwd
  }

  // Check workspace
  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const foundations = await findFoundations(workspaceRoot)

    if (foundations.length === 1) {
      return resolve(workspaceRoot, foundations[0])
    }

    if (foundations.length > 1) {
      if (isNonInteractive(args)) {
        error('Multiple foundations found. Specify which one to publish.')
        console.log('')
        for (const f of foundations) {
          console.log(`  ${colors.cyan}cd ${f} && ${prefix} publish${colors.reset}`)
        }
        process.exit(1)
      }

      const choice = await promptSelect('Which foundation?', foundations)
      if (!choice) {
        console.log('\nPublish cancelled.')
        process.exit(0)
      }
      return resolve(workspaceRoot, choice)
    }
  }

  // No foundation found — educational error
  error('No foundation found in this workspace.')
  console.log('')
  console.log(`  ${colors.dim}\`publish\` registers your foundation so clients you invite can${colors.reset}`)
  console.log(`  ${colors.dim}create and manage their own sites with it.${colors.reset}`)
  console.log('')
  console.log(`  ${colors.dim}To publish, run this command from a foundation directory, or from a${colors.reset}`)
  console.log(`  ${colors.dim}workspace root that contains a foundation.${colors.reset}`)
  process.exit(1)
}

/**
 * Parse --registry <url> from args.
 * @param {string[]} args
 * @returns {string|null}
 */
function parseRegistryUrl(args) {
  const idx = args.indexOf('--registry')
  if (idx === -1 || !args[idx + 1]) return null
  return args[idx + 1]
}

/**
 * Parse --namespace <handle> from args.
 * @param {string[]} args
 * @returns {string|null}
 */
function parseNamespace(args) {
  const idx = args.indexOf('--namespace')
  if (idx === -1 || !args[idx + 1]) return null
  return args[idx + 1]
}

/**
 * Parse --edit-access <policy> from args.
 * @param {string[]} args
 * @returns {'open'|'restricted'|null}
 */
function parseEditAccess(args) {
  const idx = args.indexOf('--edit-access')
  if (idx === -1 || !args[idx + 1]) return null
  const value = args[idx + 1]
  if (value !== 'open' && value !== 'restricted') {
    error(`Invalid --edit-access value: "${value}". Must be "open" or "restricted".`)
    process.exit(1)
  }
  return value
}

/**
 * Main publish command handler
 */
export async function publish(args = []) {
  const isLocal = args.includes('--local')
  const isDryRun = args.includes('--dry-run')
  // --propagate opts the new version into the registry's version-update
  // walk: trusting sites whose policy permits the jump pick it up
  // automatically via gated rollout. Without --propagate (default
  // 'silent'), the artifact is stored but no site moves until republish
  // or manual refresh.
  const isPropagate = args.includes('--propagate')
  const registryUrl = parseRegistryUrl(args)
  const editAccess = parseEditAccess(args)
  const namespaceFlag = parseNamespace(args)

  // 1. Resolve foundation directory
  const foundationDir = await resolveFoundationDir(args)

  // Verify it's actually a foundation (canonical classifier checks
  // package.json::main, then main.js, then legacy foundation.js).
  if (classifyPackage(foundationDir) !== 'foundation') {
    error(`Not a foundation directory: ${foundationDir}`)
    process.exit(1)
  }

  // 2. Auto-build if dist/ is missing
  const distDir = join(foundationDir, 'dist')
  const foundationJs = join(distDir, 'foundation.js')
  const schemaJson = join(distDir, 'meta', 'schema.json')

  if (!existsSync(foundationJs) || !existsSync(schemaJson)) {
    console.log(`${colors.yellow}⚠${colors.reset} No build found. Building foundation...`)
    console.log('')
    execSync('npx uniweb build --target foundation', {
      cwd: foundationDir,
      stdio: 'inherit',
    })
    console.log('')

    if (!existsSync(foundationJs) || !existsSync(schemaJson)) {
      error('Build did not produce dist/foundation.js and dist/meta/schema.json')
      process.exit(1)
    }
  }

  // 3. Read name and version from meta/schema.json
  let schema
  try {
    schema = JSON.parse(await readFile(schemaJson, 'utf8'))
  } catch (err) {
    error(`Failed to read dist/meta/schema.json: ${err.message}`)
    process.exit(1)
  }

  const rawName = schema._self?.name
  const version = schema._self?.version

  if (!rawName || !version) {
    error('dist/meta/schema.json missing _self.name or _self.version')
    console.log(`${colors.dim}  Ensure your package.json has "name" and "version" fields.${colors.reset}`)
    process.exit(1)
  }

  // 3b. Resolve scope.
  //
  // Priority order:
  //   1. --namespace <handle> CLI flag (forces an org-style scope)
  //   2. Explicit scope in `package.json` `name`:
  //        - `@org/x`   → org scope
  //        - `~user/x`  → personal alias scope (opt-in)
  //   3. `package.json` `uniweb.namespace` (legacy explicit field)
  //   4. Empty / unscoped name → personal scope from JWT (memberId).
  //
  // The empty-scope path is the new keystone. A bare `name: "site-src"`
  // means "publish under my personal scope, named site-src." The Worker
  // resolves the empty scope to the user's memberId-keyed personal
  // scope via the `sub` claim. Locally (--local) we just record an
  // `~me/` placeholder that the local serve path tolerates.
  //
  // For `--local` the JWT may not exist; we fall back to the publisher's
  // declared identity ('local' from auth or the literal string 'local').
  const pkg = JSON.parse(await readFile(join(foundationDir, 'package.json'), 'utf8'))
  const uniwebNamespace = pkg.uniweb?.namespace
  const orgScopeMatch = (pkg.name || '').match(/^@([a-z0-9_-]+)\//)
  const personalScopeMatch = (pkg.name || '').match(/^~([a-z0-9_-]+)\//)
  const selfScopeMatch = rawName.match(/^@([a-z0-9_-]+)\//)

  // Resolve scope — either an `@org` (sigil '@') or a `~user` (sigil '~').
  // null sigil with a value means "use the empty-scope path"; null/null
  // means we couldn't resolve anything.
  let scopeSigil = null
  let scopeName = null
  if (namespaceFlag) {
    scopeSigil = '@'
    scopeName = namespaceFlag
  } else if (orgScopeMatch) {
    scopeSigil = '@'
    scopeName = orgScopeMatch[1]
  } else if (personalScopeMatch) {
    scopeSigil = '~'
    scopeName = personalScopeMatch[1]
  } else if (uniwebNamespace) {
    scopeSigil = '@'
    scopeName = uniwebNamespace
  } else if (selfScopeMatch) {
    // Legacy: scope embedded in dist schema's _self.name. Rare.
    scopeSigil = '@'
    scopeName = selfScopeMatch[1]
  }

  // Construct registry name. For an explicit scope, that's `<sigil><name>/<base>`;
  // for the empty-scope path, the CLI sends the bare base name and lets the
  // server attach the personal scope. The server is the source of truth for
  // empty-scope ownership (anchored to `sub`).
  let foundationName
  if (orgScopeMatch) {
    foundationName = pkg.name.slice(orgScopeMatch[0].length)
  } else if (personalScopeMatch) {
    foundationName = pkg.name.slice(personalScopeMatch[0].length)
  } else if (selfScopeMatch) {
    foundationName = rawName.slice(selfScopeMatch[0].length)
  } else {
    // Bare name (empty-scope path) — use rawName as-is.
    foundationName = rawName
  }

  // Validate the bare name component (matches uniweb-edge's regex).
  if (!/^[a-z0-9_-]+$/.test(foundationName)) {
    error(`Invalid foundation name: "${foundationName}"`)
    console.log(`  ${colors.dim}Names must be lowercase letters, digits, hyphens, or underscores.${colors.reset}`)
    process.exit(1)
  }

  // The registry name. Three cases:
  //
  //   1. Explicit scope (`@org/x` or `~user/x`)         → `<sigil><name>/<base>`.
  //   2. Empty-scope, --local                           → synthesize a
  //        personal-scope form `~<loginName-or-sub-or-'me'>/<base>` so the
  //        local index mirrors what production will write. This is the
  //        local mock's stand-in for the server-side memberId resolution.
  //   3. Empty-scope, remote                            → send the bare
  //        name. The Worker attaches the personal scope server-side
  //        (anchoring to the `sub` claim), and the publish response
  //        carries the canonical URL back to the CLI for the receipt.
  let name
  if (scopeSigil) {
    name = `${scopeSigil}${scopeName}/${foundationName}`
  } else if (isLocal) {
    const localAuth = await readAuth()
    const personalSeed = localAuth?.loginName || localAuth?.sub || 'me'
    name = `~${personalSeed}/${foundationName}`
  } else {
    name = foundationName
  }

  // 3c. Advisory scope authorization (Worker enforces — this is for early UX feedback)
  if (!isLocal) {
    const auth = await readAuth()
    if (scopeSigil === '@') {
      // Org scope: must be in the user's namespaces[] claim.
      const namespaces = auth?.namespaces
      if (Array.isArray(namespaces) && !namespaces.includes(scopeName)) {
        error(`You don't have publish access to namespace "${colors.bright}@${scopeName}${colors.reset}"`)
        if (namespaces.length > 0) {
          console.log(`  ${colors.dim}Your organizations: ${namespaces.map(n => '@' + n).join(', ')}${colors.reset}`)
          console.log(`  ${colors.dim}Or remove the scope from package.json::name to publish under your personal scope.${colors.reset}`)
        } else {
          console.log(`  ${colors.dim}You don't belong to any organizations.${colors.reset}`)
          console.log(`  ${colors.dim}Use a bare name in package.json (e.g. "site-src") to publish under your personal scope.${colors.reset}`)
        }
        process.exit(1)
      }
    } else if (scopeSigil === '~') {
      // Personal alias scope: must match the user's loginName claim
      // (until handle-aliasing ships, this is loginName-only).
      if (auth?.loginName && auth.loginName !== scopeName) {
        error(`Personal scope "${colors.bright}~${scopeName}${colors.reset}" doesn't match your account`)
        console.log(`  ${colors.dim}Your personal scope: ~${auth.loginName}${colors.reset}`)
        console.log(`  ${colors.dim}Or remove the scope from package.json::name to publish under your personal scope.${colors.reset}`)
        process.exit(1)
      }
    }
    // Empty-scope: no client-side check. The server resolves to the
    // memberId from the JWT (sub claim) and writes ownership accordingly.
  }

  // 4. Create registry (local or remote)
  const isRemote = !isLocal
  let registry

  if (isLocal) {
    registry = createLocalRegistry(foundationDir)
  } else {
    // Remote publish — ensure authenticated (inline login if needed)
    const token = await ensureAuth({ command: 'Publishing' })

    const url = registryUrl || getRegistryUrl()
    registry = new RemoteRegistry(url, token)
  }

  const registryLabel = isLocal ? 'local registry' : `registry`

  // 5. Check for duplicates
  if (await registry.exists(name, version)) {
    console.log('')
    error(`${colors.bright}${name}@${version}${colors.reset} is already published.`)
    console.log('')
    console.log(`  Bump the version in foundation.js to publish an update:`)
    console.log(`    ${colors.dim}export const version = '${bumpPatch(version)}'${colors.reset}`)
    process.exit(1)
  }

  // 6. Dry-run check
  if (isDryRun) {
    console.log('')
    info(`Would publish ${colors.bright}${name}@${version}${colors.reset} to ${registryLabel}`)
    console.log(`  ${colors.dim}Source: ${distDir}${colors.reset}`)
    if (isLocal) {
      console.log(`  ${colors.dim}Target: ${registry.getPackagePath(name, version)}${colors.reset}`)
    } else {
      console.log(`  ${colors.dim}Target: ${registry.apiUrl}${colors.reset}`)
    }
    return
  }

  // 7. Publish
  info(`Publishing ${colors.bright}${name}@${version}${colors.reset} to ${registryLabel}...`)

  // Resolve the publisher's identity
  const auth = isLocal ? null : await readAuth()
  const publishMetadata = {
    publishedBy: auth?.email || (isLocal ? 'local' : 'cli'),
    classification: isPropagate ? 'propagate' : 'silent',
  }
  if (editAccess) {
    publishMetadata.editAccess = editAccess
  }

  let publishResult
  try {
    publishResult = await registry.publish(name, version, distDir, publishMetadata)
  } catch (err) {
    if (err.code === 'CONFLICT') {
      error(`${colors.bright}${name}@${version}${colors.reset} already exists on the registry.`)
      console.log(`  Bump the version in foundation.js to publish an update.`)
      process.exit(1)
    }
    if (err.code === 'UNAUTHORIZED') {
      error('Authentication failed.')
      console.log(`  Run ${colors.cyan}${getCliPrefix()} login${colors.reset} to refresh your credentials.`)
      process.exit(1)
    }
    throw err
  }

  // Local event memory — read by `uniweb deploy` to decide whether a
  // workspace-local foundation needs republishing. Lives under dist/ which
  // is gitignored; not part of the upload.
  const receiptUrl = publishResult?.url
    || (isLocal
      ? `file://${registry.getPackagePath(name, version)}/`
      : `${registry.apiUrl}/${name}/${version}/`)
  const { gitSha, gitDirty } = readGitState(foundationDir)
  const receipt = {
    schemaVersion: 1,
    publishedFromGitSha: gitSha,
    publishedFromGitDirty: gitDirty,
    url: receiptUrl,
    publishedAt: new Date().toISOString(),
    classification: isPropagate ? 'propagate' : 'silent',
  }
  await writeFile(join(distDir, 'publish.json'), JSON.stringify(receipt, null, 2) + '\n')

  const prefix = getCliPrefix()
  const isExtension = schema._self?.role === 'extension'
  console.log('')
  success(`Published ${colors.bright}${name}@${version}${colors.reset}${isExtension ? '  (extension)' : ''}`)
  if (editAccess) {
    console.log(`  ${colors.dim}Edit access: ${editAccess}${colors.reset}`)
  }

  // Cross-promotion: working with clients (remote only), deploy (if workspace has a site)
  if (isRemote) {
    console.log('')
    if (isExtension) {
      console.log(`  ${colors.bright}Authorize a client to use this extension:${colors.reset}`)
      console.log(`    ${colors.bright}${prefix} invite <email>${colors.reset}    Client adds this extension to their site`)
    } else {
      console.log(`  ${colors.bright}Working with clients:${colors.reset}`)
      console.log(`    ${colors.bright}${prefix} invite <email>${colors.reset}    Client creates their own site with your foundation`)
      console.log(`    ${colors.bright}${prefix} handoff <email>${colors.reset}   Create a web or local site and hand it off to a client`)
    }
  }
  const workspaceRoot = findWorkspaceRoot(foundationDir)
  if (workspaceRoot) {
    const sites = await findSites(workspaceRoot)
    if (sites.length > 0) {
      console.log('')
      console.log(`  ${colors.dim}Tip: Run \`${prefix} deploy\` for a conventional static bundle deployment.${colors.reset}`)
    }
  }
}

/**
 * Bump the patch version of a semver string.
 * @param {string} version - e.g. "1.0.0"
 * @returns {string} - e.g. "1.0.1"
 */
function bumpPatch(version) {
  const parts = version.split('.')
  if (parts.length !== 3) return version
  parts[2] = String(Number(parts[2]) + 1)
  return parts.join('.')
}

function readGitState(dir) {
  try {
    const sha = execSync('git rev-parse HEAD', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
    const status = execSync('git status --porcelain', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    return { gitSha: sha || null, gitDirty: status.length > 0 }
  } catch {
    return { gitSha: null, gitDirty: false }
  }
}

export default publish
