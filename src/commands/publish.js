/**
 * Publish Command
 *
 * Publishes a foundation to the Uniweb Registry as a CATALOG product —
 * a deliberate, named, versioned artifact that other developers may
 * consume across many sites.
 *
 * For SITE-BOUND foundations (one foundation, one site), use
 * `uniweb deploy` instead. The deploy command auto-publishes a
 * workspace-local foundation as part of the deploy under a registry
 * slot scoped to the site, with no naming ceremony. That's the right
 * flow for the "this foundation only powers this one site" case.
 *
 * Phase 3 of the CLI ergonomics overhaul reshaped this command around
 * the catalog/site-bound distinction:
 *
 *   - Bare `uniweb publish` (no explicit name) is no longer accepted.
 *     The user must provide a deliberate name via --name, --namespace,
 *     a sigil-scoped package.json::name, or package.json::uniweb.id.
 *   - Catalog confirmation is required: interactive runs prompt; CI
 *     runs need --catalog to skip the prompt.
 *   - Both gates are skipped for --local (local mock, no public
 *     consequences).
 *
 * Usage:
 *   uniweb publish @org/my-foundation       # Catalog publish (interactive prompt confirms)
 *   uniweb publish --name my-foundation     # Same; flag form
 *   uniweb publish @org/x --catalog         # Skip the catalog confirmation prompt
 *   uniweb publish --local                  # Local registry (.unicloud/) — no gates
 *   uniweb publish --registry <url>         # Specific registry URL
 *   uniweb publish --edit-access open       # Anyone can edit in Studio (default: restricted)
 *   uniweb publish --dry-run                # Show what would be published; no writes
 *   uniweb publish --propagate              # Walk trusting sites' policy waves
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

import { resolveFoundationSrcPath, classifyPackage } from '@uniweb/build'
import { createLocalRegistry, RemoteRegistry } from '../utils/registry.js'
import { ensureAuth, readAuth, writeAuth, decodeJwtPayload } from '../utils/auth.js'
import { getRegistryUrl, getBackendUrl } from '../utils/config.js'
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
  // --catalog confirms the user understands they're publishing to the
  // public catalog. Phase 3 of the CLI ergonomics overhaul: in
  // interactive mode, missing --catalog triggers a confirmation prompt;
  // in non-interactive mode, it's required (otherwise fatal). Skipped
  // entirely for --local (local mock) and --dry-run (no writes).
  const isCatalog = args.includes('--catalog')
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

  // 2. Auto-build if dist/ is missing OR stale.
  //
  //    "Stale" means the schema fingerprint baked into
  //    `dist/meta/schema.json::_self.version` doesn't match the user's
  //    current `package.json::version`. That happens when the user bumps
  //    the version and runs `uniweb publish` without rebuilding — the
  //    artifact in dist/ encodes the OLD version, but the publish
  //    intends the NEW one. Without rebuilding we'd ship inconsistent
  //    bytes (schema says one version, registry record says another).
  const distDir = join(foundationDir, 'dist')
  const foundationJs = join(distDir, 'foundation.js')
  const schemaJson = join(distDir, 'meta', 'schema.json')

  // Pre-read package.json so we can compare its version against the
  // schema before deciding whether to rebuild.
  const pkgPath = join(foundationDir, 'package.json')
  let earlyPkg
  try {
    earlyPkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  } catch (err) {
    error(`Failed to read package.json: ${err.message}`)
    process.exit(1)
  }

  // 1b. Phase 4e: catalog-publish gate.
  //
  //     `uniweb publish` is for cataloging a foundation as a product —
  //     deliberate `@org/{name}` name, version-pinnable, discoverable.
  //     Site-bound foundations go through `uniweb deploy` instead, which
  //     uploads them to `sites/{siteId}/_src/...` automatically.
  //
  //     The gate rejects two shapes:
  //       (a) No explicit name at all — running `uniweb publish` from a
  //           fresh scaffold would otherwise register `src` (or whatever
  //           the workspace name is) as a catalog entry.
  //       (b) `~user/...` or personal-UUID scopes — Phase 4e retired the
  //           personal scope; site-bound foundations use deploy, catalog
  //           uses `@org/`. There is no "personal catalog" any more.
  //
  //     `--local` skips the gate (local mock registry, no public consequences).
  const hasExplicitName = !!(
    nameFlag ||
    namespaceFlag ||
    /^[@~]/.test(earlyPkg.name || '') ||
    earlyPkg.uniweb?.id ||
    earlyPkg.uniweb?.namespace
  )
  if (!hasExplicitName && !isLocal) {
    error('uniweb publish needs a deliberate foundation name.')
    console.log('')
    console.log(`  ${colors.bright}If this foundation only powers one site, use ${colors.cyan}uniweb deploy${colors.reset}${colors.bright} instead.${colors.reset}`)
    console.log(`  ${colors.dim}Deploy uploads your foundation alongside the site's assets — no name ceremony.${colors.reset}`)
    console.log('')
    console.log(`  ${colors.bright}If you're cataloging this foundation as a product, name it explicitly:${colors.reset}`)
    console.log(`    ${colors.cyan}uniweb publish @your-org/foundation-name${colors.reset}`)
    console.log('')
    console.log(`  ${colors.dim}For local development, ${colors.reset}${colors.cyan}--local${colors.reset}${colors.dim} skips this gate.${colors.reset}`)
    process.exit(1)
  }

  // 1b'. Phase 4e: reject `~`-scoped names. Site-bound foundations don't
  //      go through publish at all.
  if (!isLocal) {
    const candidateName = nameFlag || earlyPkg.name || earlyPkg.uniweb?.id || ''
    const candidateNamespace = namespaceFlag || earlyPkg.uniweb?.namespace || ''
    if (candidateName.startsWith('~') || candidateNamespace.startsWith('~')) {
      error('uniweb publish is for cataloged foundations only.')
      console.log('')
      console.log(`  ${colors.dim}The personal-UUID scope (${colors.reset}~uuid/name${colors.dim}) is no longer accepted.${colors.reset}`)
      console.log(`  ${colors.dim}Site-bound foundations are uploaded automatically by ${colors.reset}${colors.cyan}uniweb deploy${colors.reset}${colors.dim} — they live with site assets, not in the catalog.${colors.reset}`)
      console.log('')
      console.log(`  ${colors.bright}For a catalog product, use an org scope:${colors.reset}`)
      console.log(`    ${colors.cyan}uniweb publish @your-org/foundation-name${colors.reset}`)
      console.log('')
      console.log(`  ${colors.dim}No org yet? The CLI will offer to claim one for you the first time you publish to a handle you don't own.${colors.reset}`)
      process.exit(1)
    }
  }

  // 1c. Phase 3 catalog confirmation gate.
  //
  //     Cataloging a foundation has consequences (visible in the catalog,
  //     other developers may pin to versions, propagation system tracks
  //     it). Require explicit confirmation:
  //       - Interactive: prompt unless --catalog passed.
  //       - Non-interactive: fatal unless --catalog passed.
  //       - Skipped for --local and --dry-run (no public consequences).
  if (hasExplicitName && !isLocal && !isDryRun && !isCatalog) {
    if (isNonInteractive(process.argv)) {
      error('uniweb publish to the catalog needs --catalog confirmation.')
      console.log('')
      console.log(`  ${colors.dim}Catalog publishes are public — other developers can pin to your versions.${colors.reset}`)
      console.log(`  ${colors.dim}Pass ${colors.reset}${colors.cyan}--catalog${colors.reset}${colors.dim} to confirm:${colors.reset}`)
      console.log(`    ${colors.cyan}uniweb publish ${colors.reset}${colors.dim}<args>${colors.reset} ${colors.cyan}--catalog${colors.reset}`)
      console.log('')
      console.log(`  ${colors.dim}For site-bound foundations, use ${colors.reset}${colors.cyan}uniweb deploy${colors.reset}${colors.dim} instead.${colors.reset}`)
      process.exit(1)
    }

    const prompts = (await import('prompts')).default
    console.log('')
    console.log(`${colors.dim}You're publishing this foundation to the public catalog.${colors.reset}`)
    console.log(`${colors.dim}Other developers will be able to find it and pin to its versions.${colors.reset}`)
    console.log(`${colors.dim}For site-bound foundations, ${colors.reset}${colors.cyan}uniweb deploy${colors.reset}${colors.dim} is the right command.${colors.reset}`)
    console.log('')
    const confirm = await prompts({
      type: 'confirm',
      name: 'go',
      message: 'Continue with catalog publish?',
      initial: false,
    }, {
      onCancel: () => { console.log(''); console.log('Publish cancelled.'); process.exit(0) },
    })
    if (!confirm.go) {
      console.log('')
      console.log(`${colors.dim}Cancelled. Use ${colors.reset}${colors.cyan}uniweb deploy${colors.reset}${colors.dim} for site-bound foundations.${colors.reset}`)
      process.exit(0)
    }
  }

  let needsBuild = !existsSync(foundationJs) || !existsSync(schemaJson)
  let buildReason = needsBuild ? 'no dist/ found' : null

  if (!needsBuild) {
    try {
      const peekSchema = JSON.parse(await readFile(schemaJson, 'utf8'))
      if (peekSchema?._self?.version && earlyPkg.version && peekSchema._self.version !== earlyPkg.version) {
        needsBuild = true
        buildReason = `package.json::version (${earlyPkg.version}) differs from dist/meta/schema.json::_self.version (${peekSchema._self.version})`
      }
    } catch {
      // Malformed schema → treat as stale.
      needsBuild = true
      buildReason = 'dist/meta/schema.json could not be parsed'
    }
  }

  // --dry-run gate. Must come BEFORE the pre-flight registry check (which
  // may persist `uniweb.id` to package.json on the matching-sha path) and
  // BEFORE the build (which writes to dist/). Earlier the dry-run check
  // sat after both, which violated the zero-writes contract.
  if (isDryRun) {
    const previewName = quickResolveCanonicalName(earlyPkg, { namespaceFlag, nameFlag })
      || earlyPkg.name
      || '(unresolved)'
    const target = isLocal ? 'local registry' : `remote registry (${registryUrl || getRegistryUrl()})`
    console.log('')
    info(`Would publish ${colors.bright}${previewName}@${earlyPkg.version}${colors.reset} to ${target}`)
    if (needsBuild) {
      console.log(`  ${colors.dim}Would build first: ${buildReason}${colors.reset}`)
    } else {
      console.log(`  ${colors.dim}Source: ${distDir}${colors.reset}`)
    }
    return
  }

  // 2b. Pre-flight registry check — runs BEFORE the build so we don't
  //     burn vite cycles on a foundation we already know we can't (or
  //     don't need to) publish.
  //
  //     Two outcomes short-circuit the build:
  //
  //       a. The registry already has `<canonicalName>@<version>`
  //          published from the CURRENT git sha (per-foundation last
  //          commit). The artifact upstream is correct; refresh the
  //          local receipt and exit. (Same outcome as the post-build
  //          duplicate check, just earlier — saves a build.)
  //
  //       b. The registry has the version published from a DIFFERENT
  //          sha. The user has unpublished changes against an already-
  //          published version → "bump the version" error before any
  //          build work. Was the eval skill's pp-03 row.
  //
  //     If the pre-flight can't determine the canonical name from
  //     pkg.json + flags + auth alone (e.g., needs a TTY prompt for
  //     the foundation id), it falls through silently to the existing
  //     post-build path. No-build-saved is still the existing behavior.
  if (!isLocal) {
    const preflightName = quickResolveCanonicalName(earlyPkg, { namespaceFlag, nameFlag })
    const preflightVersion = earlyPkg.version
    if (preflightName && preflightVersion) {
      try {
        const auth = await readAuth()
        if (auth?.token) {
          const claims = decodeJwtPayload(auth.token)
          const memberUuid = claims?.memberUuid
          // Empty-scope publishes are server-rewritten to ~<memberUuid>/<id>.
          // Mirror that here so getVersionEntry queries the canonical key.
          const lookupName = preflightName.startsWith('@') || preflightName.startsWith('~')
            ? preflightName
            : memberUuid ? `~${memberUuid}/${preflightName}` : null
          if (lookupName) {
            const registryUrlPre = registryUrl || getRegistryUrl()
            const registryPre = new RemoteRegistry(registryUrlPre, auth.token)
            const existing = await registryPre.getVersionEntry(lookupName, preflightVersion)
            if (existing) {
              const { gitSha } = readGitState(foundationDir)
              if (gitSha && existing.publishedFromGitSha === gitSha) {
                // Already published from this exact source — nothing to do.
                console.log('')
                success(`${colors.bright}${lookupName}@${preflightVersion}${colors.reset} already published from ${gitSha.slice(0, 7)}.`)
                return
              }
              // Sha mismatch (or no provenance recorded for the existing
              // entry). Clean error before any build work.
              console.log('')
              error(`Foundation source has changed since the last publish, but ${colors.bright}${lookupName}@${preflightVersion}${colors.reset} is already published.`)
              console.log('')
              console.log(`  Bump ${colors.cyan}package.json::version${colors.reset} to publish an update:`)
              console.log(`    ${colors.dim}"version": "${bumpPatch(preflightVersion)}"${colors.reset}`)
              process.exit(1)
            }
          }
        }
      } catch {
        // Network down, malformed auth, etc. — fall through to the
        // existing post-build flow. No-build-saved is still the same
        // behavior the user got before this pre-flight existed.
      }
    }
  }

  if (needsBuild) {
    console.log(`${colors.yellow}⚠${colors.reset} ${buildReason}. Building foundation...`)
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

  // 3. Read name + version from the (now-fresh) schema + package.json.
  //
  //    `_self.name` is the build-RESOLVED form — applies `uniweb.id`,
  //    scope resolution, etc., that are easier to read off the build
  //    output than to redo here. `version` is sourced from package.json
  //    directly; the version-skew check above already ensured the
  //    schema and package.json agree.
  let schema
  try {
    schema = JSON.parse(await readFile(schemaJson, 'utf8'))
  } catch (err) {
    error(`Failed to read dist/meta/schema.json: ${err.message}`)
    process.exit(1)
  }

  const rawName = schema._self?.name
  const version = earlyPkg.version

  if (!rawName || !version) {
    error('Foundation missing name or version')
    console.log(`${colors.dim}  Ensure your package.json has "name" and "version" fields,${colors.reset}`)
    console.log(`${colors.dim}  and that the build has produced dist/meta/schema.json with _self.name.${colors.reset}`)
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
  // Note: a bare `package.json::name` (e.g. the scaffold default `src`)
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
  // (`src`) and putting the published-as id in `uniweb.id`.
  // pkgPath was declared earlier (during the rebuild-stale-dist check).
  // Reuse the already-loaded `earlyPkg` rather than re-reading from disk.
  const pkg = earlyPkg
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
    // No id resolvable from any field. Build a set of suggestions
    // contextual to this workspace, then either prompt (TTY) or print
    // them as guidance (CI). The bare `pkg.name` is intentionally NOT
    // a suggestion when it equals the scaffold default `src` — picking
    // that name would couple the registry id to a generic placeholder
    // that future renames couldn't undo.
    const workspaceRoot = findWorkspaceRoot(foundationDir) || foundationDir
    const suggestions = await buildIdSuggestions({ foundationDir, workspaceRoot, pkg })

    if (isNonInteractive(process.argv)) {
      // CI: when there's a high-confidence signal — the workspace
      // package.json's name (the user typed it via `uniweb create
      // <name>`) — auto-derive and persist. This unblocks first-deploy
      // CI flows (pp-01 etc.) where stopping to ask isn't an option.
      // Other suggestion sources (sibling-site name, M-code) are NOT
      // auto-picked because they're ambiguous in multi-package
      // workspaces; they remain available via the error message
      // when no high-confidence signal exists.
      const autoId = await pickAutoDerivedId({ workspaceRoot, foundationDir })
      if (autoId) {
        info(`Auto-deriving ${colors.bright}uniweb.id: "${autoId}"${colors.reset} ${colors.dim}(matches workspace name; persisted to package.json)${colors.reset}`)
        foundationName = autoId
        writeBackId = true
      } else {
        error('Foundation id is required for publishing.')
        console.log('')
        if (suggestions.length > 0) {
          console.log(`  ${colors.bright}Suggestions for your workspace:${colors.reset}`)
          for (const { id, why } of suggestions) {
            console.log(`    ${colors.cyan}${id}${colors.reset}  ${colors.dim}${why}${colors.reset}`)
          }
          console.log('')
        }
        console.log(`  ${colors.dim}Use one of:${colors.reset}`)
        const example = suggestions[0]?.id || '<id>'
        console.log(`    ${colors.cyan}uniweb publish --name ${example}${colors.reset}`)
        console.log(`    ${colors.dim}Add ${colors.reset}"uniweb": { "id": "<your-id>" }${colors.dim} to package.json${colors.reset}`)
        console.log(`    ${colors.dim}Or use a scoped name in package.json: ${colors.reset}"name": "@org/<id>"${colors.reset}`)
        process.exit(1)
      }
    } else {

    const prompts = (await import('prompts')).default
    console.log('')
    console.log(`${colors.dim}This is the first publish of this foundation. Pick a name${colors.reset}`)
    console.log(`${colors.dim}for the registry — what your foundation will be known as.${colors.reset}`)
    console.log('')

    let chosen
    if (suggestions.length > 0) {
      // Surface contextual suggestions first (sibling site, workspace name,
      // M-code series). Always include "Type a different name…" so the
      // user is never trapped in a list.
      const choices = [
        ...suggestions.map(s => ({ title: s.id, description: s.why, value: s.id })),
        { title: 'Type a different name…', value: '__custom__' },
      ]
      const pickResp = await prompts({
        type: 'select',
        name: 'pick',
        message: 'Foundation name',
        choices,
        initial: 0,
      }, {
        onCancel: () => { console.log(''); console.log('Publish cancelled.'); process.exit(0) },
      })
      if (!pickResp.pick) process.exit(0)
      chosen = pickResp.pick
    } else {
      chosen = '__custom__'
    }

    if (chosen === '__custom__') {
      const folderName = workspaceRoot === foundationDir
        ? null
        : foundationDir.replace(workspaceRoot + '/', '').split('/')[0]
      const suggestion =
        suggestions[0]?.id ||
        (folderName ? folderName.replace(/-src$/, '') : null) ||
        ''
      const textResp = await prompts({
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
        onCancel: () => { console.log(''); console.log('Publish cancelled.'); process.exit(0) },
      })
      if (!textResp.id) process.exit(0)
      chosen = textResp.id
    }

    foundationName = chosen
    writeBackId = true
    }
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

  // 3c. Phase 4f: org-claim flow.
  //
  //     `uniweb publish @handle/foo` against a handle the user doesn't own
  //     yet drops into the org-claim flow instead of failing. Three cases:
  //       (a) JWT has no `namespaces` claim at all → token predates org
  //           support; tell the user to `uniweb login` again.
  //       (b) Handle is already in `namespaces` → proceed.
  //       (c) Handle is NOT in `namespaces` → call POST /api/orgs/{handle}.
  //           Confirm-and-claim if available; hard-fail if taken; refresh
  //           the cached token on success and proceed with publish.
  //
  //     Skipped for `--local` (no auth, no org system).
  const claimOrgFlag = args.includes('--claim-org')
  if (!isLocal && scopeSigil === '@') {
    const auth = await readAuth()
    if (!Array.isArray(auth?.namespaces)) {
      // Old token, predates org support.
      error('Your authentication token doesn\'t carry organization claims.')
      console.log('')
      console.log(`  ${colors.dim}Run ${colors.reset}${colors.cyan}uniweb login${colors.reset}${colors.dim} to refresh your session, then retry.${colors.reset}`)
      process.exit(1)
    }
    if (!auth.namespaces.includes(scopeName)) {
      // Need to claim. Confirm interactively unless --claim-org was passed.
      if (isNonInteractive(process.argv) && !claimOrgFlag) {
        error(`You don't own ${colors.bright}@${scopeName}${colors.reset} yet.`)
        console.log('')
        console.log(`  ${colors.dim}In CI, pass ${colors.reset}${colors.cyan}--claim-org${colors.reset}${colors.dim} to claim available handles automatically.${colors.reset}`)
        console.log(`  ${colors.dim}Interactive mode prompts for confirmation.${colors.reset}`)
        process.exit(1)
      }

      if (!claimOrgFlag) {
        const prompts = (await import('prompts')).default
        console.log('')
        console.log(`${colors.dim}You don't own ${colors.reset}${colors.bright}@${scopeName}${colors.reset}${colors.dim} yet.${colors.reset}`)
        console.log(`${colors.dim}Org handles are global and permanent — only the claiming account can publish under them.${colors.reset}`)
        console.log('')
        const confirm = await prompts({
          type: 'confirm',
          name: 'go',
          message: `Claim @${scopeName} for your account?`,
          initial: false,
        }, {
          onCancel: () => { console.log(''); console.log('Publish cancelled.'); process.exit(0) },
        })
        if (!confirm.go) {
          console.log('')
          console.log(`${colors.dim}Cancelled. Publish under a handle you already own, or pick a different one.${colors.reset}`)
          process.exit(0)
        }
      }

      // Org claim hits the PHP backend (auth/identity is PHP's domain),
      // not the worker. In local dev unicloud serves both on one port, so
      // tests work; in production these are different hosts.
      const claimed = await claimOrgHandle({
        handle: scopeName,
        token: auth.token,
        backendUrl: getBackendUrl(),
      })
      if (claimed.taken) {
        error(`@${scopeName} is already claimed by another account.`)
        console.log('')
        console.log(`  ${colors.dim}Pick a different handle. Org names are global and exclusive.${colors.reset}`)
        process.exit(1)
      }
      // Swap the cached token for the refreshed one (now carries the new
      // namespace claim). Subsequent publish calls in this run see it via
      // a fresh `readAuth()` and the worker accepts the upload.
      await writeAuth({
        token: claimed.token,
        email: auth.email,
        expiresAt: auth.expiresAt,
      })
      if (claimed.created) {
        success(`Claimed ${colors.bright}@${scopeName}${colors.reset} for your account.`)
      } else {
        info(`Refreshed your token; ${colors.bright}@${scopeName}${colors.reset} is yours.`)
      }
      console.log('')
    }
  }

  // 4. Create registry (local or remote)
  const isRemote = !isLocal
  let registry

  if (isLocal) {
    registry = createLocalRegistry(foundationDir)
  } else {
    // Remote publish — ensure authenticated (inline login if needed)
    const token = await ensureAuth({ command: 'Publishing', args })

    const url = registryUrl || getRegistryUrl()
    registry = new RemoteRegistry(url, token)
  }

  const registryLabel = isLocal ? 'local registry' : `registry`

  // Git state — read up-front so it can both gate the duplicate check
  // (fresh-checkout no-op vs. true conflict) and ride along in the
  // publish payload.
  const { gitSha, gitDirty } = readGitState(foundationDir)

  // Compute the canonical name the server stores under. Empty-scope
  // (bare-name) publishes go to the registry as `<name>` but are
  // server-side rewritten to `~<memberUuid>/<name>`. The duplicate
  // check below queries the registry's index, which uses the canonical
  // form as the key — so we have to mirror the rewrite locally.
  // Org / personal-scope publishes skip this (their `name` is already
  // canonical).
  let lookupName = name
  if (!scopeSigil && !isLocal) {
    try {
      const localAuth = await readAuth()
      const claims = decodeJwtPayload(localAuth?.token)
      if (claims?.memberUuid) {
        lookupName = `~${claims.memberUuid}/${foundationName}`
      }
    } catch {
      // No usable auth — fall back to the bare name. The publish call
      // itself will fail later with an auth error if a token is needed.
    }
  }

  // 5. Check for duplicates. If the registry already has this exact
  //    version recorded as published from the current commit, treat it
  //    as a fresh-checkout no-op — the artifact upstream is already
  //    correct; there's nothing to upload.
  const existingEntry = await registry.getVersionEntry(lookupName, version)
  if (existingEntry) {
    if (gitSha && existingEntry.publishedFromGitSha === gitSha) {
      // Persist uniweb.id BEFORE the early return when an auto-derive
      // or prompt-resolved id was set in this run. Without this, the
      // next run wouldn't know the id and would have to re-derive
      // from scratch — which means the pre-flight registry check at
      // the top of publish() can't fire either (it relies on a
      // resolvable id from pkg.json alone). Persisting here closes
      // that loop so future deploys hit the pre-flight bail and skip
      // the build entirely.
      if (writeBackId) {
        pkg.uniweb = pkg.uniweb || {}
        pkg.uniweb.id = foundationName
        await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
        info(`Wrote ${colors.cyan}uniweb.id: "${foundationName}"${colors.reset} to ${colors.dim}package.json${colors.reset}`)
      }
      console.log('')
      success(`${colors.bright}${lookupName}@${version}${colors.reset} already published from ${gitSha.slice(0, 7)}.`)
      return
    }
    console.log('')
    error(`Foundation source has changed since the last publish, but ${colors.bright}${name}@${version}${colors.reset} is already published.`)
    console.log('')
    console.log(`  Bump ${colors.cyan}package.json::version${colors.reset} to publish an update:`)
    console.log(`    ${colors.dim}"version": "${bumpPatch(version)}"${colors.reset}`)
    process.exit(1)
  }

  // 6. Publish
  info(`Publishing ${colors.bright}${name}@${version}${colors.reset} to ${registryLabel}...`)

  // Resolve the publisher's identity
  const auth = isLocal ? null : await readAuth()
  const publishMetadata = {
    publishedBy: auth?.email || (isLocal ? 'local' : 'cli'),
    classification: isPropagate ? 'propagate' : 'silent',
    // Git provenance lets `uniweb deploy` decide whether a workspace-local
    // foundation needs republishing — see deploy.js's staleness check.
    ...(gitSha ? { publishedFromGitSha: gitSha } : {}),
    ...(typeof gitDirty === 'boolean' ? { publishedFromGitDirty: gitDirty } : {}),
  }
  if (editAccess) {
    publishMetadata.editAccess = editAccess
  }

  try {
    await registry.publish(name, version, distDir, publishMetadata)
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
/**
 * Quickly compute the canonical foundation name from `package.json` +
 * CLI flags alone, without prompting and without reading the build's
 * `dist/meta/schema.json`. Used by the pre-flight registry check so we
 * can short-circuit the build when the registry already has this
 * version published.
 *
 * Returns null when resolution would need a prompt or auto-derive
 * (caller falls through to the existing post-build resolution path,
 * which handles those cases). The returned string is one of:
 *   - `@<scope>/<id>`  (org scope, full canonical form)
 *   - `~<handle>/<id>` (personal alias scope)
 *   - `<id>`            (bare; caller may prepend `~<memberUuid>/`
 *                       from the JWT for the actual lookup)
 *
 * The full resolution at line 313+ is the canonical implementation;
 * this helper is a strict subset that mirrors the high-confidence
 * paths only. If they diverge, the helper is the one that should
 * stay conservative (return null on uncertainty).
 */
function quickResolveCanonicalName(pkg, { namespaceFlag, nameFlag } = {}) {
  if (!pkg) return null
  const orgScopeMatch = (pkg.name || '').match(/^@([a-z0-9_-]+)\/([a-z0-9_-]+)$/)
  const personalScopeMatch = (pkg.name || '').match(/^~([a-z0-9_-]+)\/([a-z0-9_-]+)$/)
  const uniwebNamespace = pkg.uniweb?.namespace
  const uniwebId = pkg.uniweb?.id

  // Scope precedence mirrors the full resolution.
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

  // Id precedence mirrors the full resolution but stops at "no-prompt"
  // sources. Auto-derive and TTY prompts both happen post-build so the
  // user sees suggestions in context; the pre-flight only fires when
  // the id is already determined.
  let id = null
  if (nameFlag) id = nameFlag
  else if (orgScopeMatch) id = orgScopeMatch[2]
  else if (personalScopeMatch) id = personalScopeMatch[2]
  else if (uniwebId) id = uniwebId
  else return null

  if (scopeSigil) return `${scopeSigil}${scopeName}/${id}`
  return id
}

function bumpPatch(version) {
  const parts = version.split('.')
  if (parts.length !== 3) return version
  parts[2] = String(Number(parts[2]) + 1)
  return parts.join('.')
}

/**
 * High-confidence auto-derive for non-interactive (CI) first publishes.
 *
 * Diego's principle: never silently take a generic scaffold default like
 * `src` or `site` as the registry id (those are placeholders, not user
 * intent). But when the user has typed a real name elsewhere — most
 * unambiguously the workspace package.json's `name` (set by
 * `uniweb create <name>`) — picking that in CI is the obvious right
 * answer and stopping to ask just breaks the CI run.
 *
 * Auto-derive set is intentionally NARROW:
 *   1. Workspace package.json::name, when it's a clean id and not a
 *      generic placeholder.
 *
 * Other suggestion sources from `buildIdSuggestions` (sibling-site
 * name, M-code series) are NOT auto-picked: they're ambiguous in
 * multi-package or multi-foundation workspaces. They remain visible
 * in the CI error message when no high-confidence signal exists, so
 * the user can pick one explicitly via `--name <id>`.
 *
 * Returns the id string, or null when no high-confidence signal is
 * available (caller falls through to the existing error-with-
 * suggestions guidance).
 */
async function pickAutoDerivedId({ workspaceRoot, foundationDir }) {
  const ID_RE = /^[a-z0-9_-]+$/
  const PLACEHOLDERS = new Set(['src', 'site', 'foundation', 'workspace', 'project'])
  const isHighConfidence = s => typeof s === 'string' && ID_RE.test(s) && !PLACEHOLDERS.has(s)

  if (!workspaceRoot || workspaceRoot === foundationDir) return null
  try {
    const wsPkg = JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8'))
    const wsName = typeof wsPkg.name === 'string'
      ? wsPkg.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '')
      : null
    if (isHighConfidence(wsName)) return wsName
  } catch { /* no workspace package.json — skip */ }
  return null
}

/**
 * Build a list of contextual `uniweb.id` suggestions for first-time publishes.
 *
 * The CLI never auto-picks an id (Diego's principle: a bare folder name like
 * "src" is wrong, and silently committing to it would couple the registry
 * id to scaffold noise the user can't easily undo). Instead, suggest names
 * derived from signals the workspace already exposes:
 *
 *   - **Sibling site name.** When exactly one site exists in the workspace,
 *     the user's mental model is "this foundation is FOR that site" — so
 *     the site's name (or "<site>-foundation" if it would collide with the
 *     site's own package name) is a natural pick.
 *   - **Workspace name.** A workspace package.json often carries a name
 *     more meaningful than the foundation folder ("acme-marketing" vs "src").
 *   - **Folder name minus `-src`.** Foundations placed under
 *     `<name>-src/` strongly suggest `<name>` as the publish id (this
 *     is the existing default; preserved here for back-compat).
 *   - **Code-based fallback (M1, M2, …).** When the workspace already has
 *     other foundations (i.e., the user manages a category of similar
 *     foundations across sites/projects), suggest the next code in series.
 *
 * Returns deduplicated `{ id, why }` entries — `why` is shown next to the
 * id in both the CI guidance message and the TTY select prompt so the
 * user can tell at a glance which signal each suggestion comes from.
 *
 * The bare scaffold default `pkg.name === 'src'` is excluded by design.
 * Likewise any non-conforming shape (uppercase, dots, etc.) is filtered
 * out so users only ever see valid candidates.
 */
async function buildIdSuggestions({ foundationDir, workspaceRoot, pkg }) {
  const ID_RE = /^[a-z0-9_-]+$/
  const sanitize = s => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') : null)
  const isValid = s => typeof s === 'string' && ID_RE.test(s) && s !== 'src' && s !== 'site'

  const seen = new Set()
  const out = []
  const push = (id, why) => {
    if (!isValid(id) || seen.has(id)) return
    seen.add(id)
    out.push({ id, why })
  }

  // 1. Sibling-site suggestion. Only fires when there's exactly one site
  //    in the workspace, because that's the unambiguous "for X" case.
  try {
    const sites = await findSites(workspaceRoot)
    if (sites.length === 1) {
      const sitePath = sites[0]
      try {
        const sitePkg = JSON.parse(await readFile(join(workspaceRoot, sitePath, 'package.json'), 'utf8'))
        const siteName = sanitize(sitePkg.name)
        if (siteName) {
          push(siteName, `matches your site "${siteName}"`)
          push(`${siteName}-foundation`, `derived from your site "${siteName}"`)
        }
      } catch { /* missing or malformed site package.json — skip */ }
    }
  } catch { /* findSites can fail in odd workspaces; non-fatal */ }

  // 2. Workspace name suggestion. The workspace package.json's name is
  //    the user's chosen project identity; if it's a clean id, suggest it.
  try {
    if (workspaceRoot && workspaceRoot !== foundationDir) {
      const wsPkg = JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8'))
      const wsName = sanitize(wsPkg.name)
      if (wsName) push(wsName, `matches your workspace "${wsName}"`)
    }
  } catch { /* no workspace package.json — skip */ }

  // 3. Folder name minus `-src`. The pre-existing default lives on as a
  //    suggestion now rather than the auto-pick.
  if (workspaceRoot && foundationDir !== workspaceRoot) {
    const folderName = foundationDir.replace(workspaceRoot + '/', '').split('/')[0]
    const stripped = sanitize(folderName?.replace(/-src$/, ''))
    if (stripped) push(stripped, `derived from the folder "${folderName}"`)
  }

  // 4. Code-based fallback. Only suggested when the workspace already has
  //    multiple foundations — the case Diego flagged (publishers managing
  //    a category like M1, M2, M3 across sites/projects).
  try {
    const foundations = await findFoundations(workspaceRoot)
    if (foundations.length >= 2) {
      // Find the next M-number not already used by a sibling foundation's id.
      const usedCodes = new Set()
      for (const fp of foundations) {
        try {
          const fp_pkg = JSON.parse(await readFile(join(workspaceRoot, fp, 'package.json'), 'utf8'))
          const id = fp_pkg.uniweb?.id
          const m = typeof id === 'string' && id.match(/^m(\d+)$/i)
          if (m) usedCodes.add(parseInt(m[1], 10))
        } catch { /* skip */ }
      }
      let n = 1
      while (usedCodes.has(n)) n++
      push(`m${n}`, `next in your "M-code" series`)
    }
  } catch { /* findFoundations failed — skip */ }

  return out
}

/**
 * Per-directory git state. Mirrors `deploy.js::readGitState` exactly —
 * scopes the sha + dirty check to `dir` rather than reading the whole
 * repo's HEAD. Publish records this in registry metadata; deploy
 * compares against it for staleness. Both sides must read the same
 * shape or the staleness check drifts.
 */
function readGitState(dir) {
  try {
    const sha = execSync('git log -1 --format=%H -- .', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
    const status = execSync('git status --porcelain -- .', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    return { gitSha: sha || null, gitDirty: status.length > 0 }
  } catch {
    return { gitSha: null, gitDirty: false }
  }
}

/**
 * POST /api/orgs/{handle} — claim an `@handle` for the calling user.
 *
 * Returns one of:
 *   { created: true,  token: '<refreshed JWT>' }   — handle was free
 *   { created: false, token: '<refreshed JWT>' }   — user already owned it
 *   { taken:  true }                               — claimed by someone else
 *
 * Other failures throw.
 */
async function claimOrgHandle({ handle, token, backendUrl }) {
  const url = `${backendUrl.replace(/\/$/, '')}/api/orgs/${encodeURIComponent(handle)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  if (res.status === 409) return { taken: true }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j.error || detail
    } catch { /* non-JSON body */ }
    throw new Error(`Org claim failed: ${detail}`)
  }
  const body = await res.json()
  return { created: !!body.created, token: body.token }
}

export default publish
