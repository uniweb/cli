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
 * Parse --name <id> from args.
 * The publish-time "id" — the bare-name segment in the registry name.
 * Distinct from `package.json::name` (a workspace concern). Persisted
 * to `package.json::uniweb.id` after the first successful publish so
 * it doesn't need to be supplied again.
 * @param {string[]} args
 * @returns {string|null}
 */
function parseName(args) {
  const idx = args.indexOf('--name')
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
  const nameFlag = parseName(args)

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

  // 3b. Resolve scope and foundation id.
  //
  // The publish-time identity is two pieces: a SCOPE (org `@`, personal `~`,
  // or empty → server-resolved personal) and an ID (the bare name segment).
  // They live in different places and get different defaults.
  //
  // Scope priority:
  //   1. --namespace <handle> CLI flag           → forces `@<handle>` org scope
  //   2. Sigil in `package.json::name`:
  //        - `@org/x`                            → `@org`
  //        - `~user/x`                           → `~user` (personal alias)
  //   3. `package.json::uniweb.namespace`        → legacy explicit org field
  //   4. (none)                                  → empty scope; server attaches
  //                                                 the publisher's personal
  //                                                 scope at upload time
  //
  // ID priority (the bare name segment):
  //   1. --name <id> CLI flag                    → override
  //   2. Sigil-stripped `package.json::name`     → @org/<id> or ~user/<id>
  //   3. `package.json::uniweb.id`               → persisted publish-id
  //   4. Interactive prompt                      → and write back to
  //                                                 `package.json::uniweb.id`
  //                                                 so future publishes don't
  //                                                 re-prompt.
  //   5. Non-interactive without a usable id     → fail with guidance.
  //
  // Note: a bare `package.json::name` (e.g. the scaffold default `site-src`)
  // is intentionally NOT used as a fallback id. The workspace name is for
  // pnpm linking and the file: dependency in site/package.json — using it
  // as the publish id would couple the registry identity to the workspace,
  // exactly what `uniweb.id` exists to prevent. Users who want their
  // workspace name to be the publish id pass `--name <pkg-name>` once;
  // it persists.
  //
  // Why two storage locations for an ID? `package.json::name` is a
  // workspace concern — pnpm uses it to link packages, sites reference
  // it via `file:` deps and `site.yml::foundation`. Renaming it cascades
  // through several files. `uniweb.id` is publish-only — changing it
  // affects only the registry identity, never the workspace. Most users
  // benefit from leaving `package.json::name` as the scaffold default
  // (`site-src`) and putting the published-as id in `uniweb.id`.
  const pkgPath = join(foundationDir, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const uniwebNamespace = pkg.uniweb?.namespace
  const uniwebId = pkg.uniweb?.id
  const orgScopeMatch = (pkg.name || '').match(/^@([a-z0-9_-]+)\/([a-z0-9_-]+)$/)
  const personalScopeMatch = (pkg.name || '').match(/^~([a-z0-9_-]+)\/([a-z0-9_-]+)$/)

  // Resolve the SCOPE.
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
  }

  // Resolve the ID.
  const ID_RE = /^[a-z0-9_-]+$/
  let foundationName = null
  let writeBackId = false
  if (nameFlag) {
    foundationName = nameFlag
    // Persist the flag's value when it differs from what's already in
    // `uniweb.id`. This makes rename a one-shot:
    //   $ uniweb publish --name new-name
    // From here on, `uniweb publish` (no flag) keeps using `new-name`.
    // No-op when --name matches the existing id.
    if (nameFlag !== uniwebId) writeBackId = true
  } else if (orgScopeMatch) {
    foundationName = orgScopeMatch[2]
  } else if (personalScopeMatch) {
    foundationName = personalScopeMatch[2]
  } else if (uniwebId) {
    foundationName = uniwebId
  }
  if (!foundationName) {
    // No id resolvable from any field. Prompt — or fail in non-interactive.
    if (isNonInteractive(process.argv)) {
      error('Foundation id is required for publishing.')
      console.log('')
      console.log(`  ${colors.dim}Use one of:${colors.reset}`)
      console.log(`    ${colors.cyan}uniweb publish --name <id>${colors.reset}`)
      console.log(`    ${colors.dim}Add ${colors.reset}"uniweb": { "id": "<your-id>" }${colors.dim} to package.json${colors.reset}`)
      console.log(`    ${colors.dim}Or use a scoped name in package.json: ${colors.reset}"name": "@org/<id>"${colors.reset}`)
      process.exit(1)
    }

    const prompts = (await import('prompts')).default
    // Default suggestion: derive from the workspace folder or pkg.name.
    // Strip the suffix `-src` so a foundation in `marketing-src/` defaults
    // to `marketing` as its publish id.
    const workspaceRoot = findWorkspaceRoot(foundationDir) || foundationDir
    const folderName = workspaceRoot === foundationDir
      ? null
      : foundationDir.replace(workspaceRoot + '/', '').split('/')[0]
    const suggestion =
      (typeof pkg.name === 'string' && ID_RE.test(pkg.name) ? pkg.name : null) ||
      (folderName ? folderName.replace(/-src$/, '') : null) ||
      'foundation'

    console.log('')
    console.log(`${colors.dim}This is the first publish of this foundation. Pick a name${colors.reset}`)
    console.log(`${colors.dim}for the registry — what your foundation will be known as.${colors.reset}`)
    const response = await prompts({
      type: 'text',
      name: 'id',
      message: 'Foundation name',
      initial: suggestion,
      validate: (v) => {
        if (!v) return 'Required'
        if (!ID_RE.test(v)) return 'Lowercase letters, digits, hyphens, underscores only'
        return true
      },
    }, {
      onCancel: () => {
        console.log('')
        console.log('Publish cancelled.')
        process.exit(0)
      },
    })
    if (!response.id) process.exit(0)
    foundationName = response.id
    writeBackId = true
  }

  // Validate the resolved id (may have come from any source).
  if (!ID_RE.test(foundationName)) {
    error(`Invalid foundation name: "${foundationName}"`)
    console.log(`  ${colors.dim}Names must be lowercase letters, digits, hyphens, or underscores.${colors.reset}`)
    process.exit(1)
  }

  // Persist the id so future publishes don't re-prompt.
  if (writeBackId) {
    pkg.uniweb = pkg.uniweb || {}
    pkg.uniweb.id = foundationName
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    info(`Wrote ${colors.cyan}uniweb.id: "${foundationName}"${colors.reset} to ${colors.dim}package.json${colors.reset}`)
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
