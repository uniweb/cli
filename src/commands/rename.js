/**
 * Rename Command
 *
 * Renames packages across the workspace transactionally. Supports
 * `rename foundation`, `rename site`, and `rename extension`. Each
 * subcommand updates a different set of touch points:
 *
 *   foundation: package.json::name + folder + every dependent site's
 *     package.json (dep key + file: path) + every site.yml::foundation
 *     reference + workspace manifests + root scripts.
 *
 *   site: package.json::name + folder + workspace manifests + root
 *     scripts (sites are referenced by name in `pnpm --filter`-style
 *     scripts, hence the regen).
 *
 *   extension: package.json::name + folder + every site.yml::extensions
 *     entry whose URL prefix matches the old folder path + workspace
 *     manifests. Sites don't carry a `file:` dep on extensions (extensions
 *     load by URL at runtime), so no per-site package.json updates.
 *
 * Extensions are technically a flavor of foundation (same build, same
 * package.json shape, distinguished only by `extension: true` in
 * src/foundation.js or `role: 'extension'` in the built schema). The
 * rename verb still keeps them on a separate subcommand because the
 * touch-point sets differ — `rename foundation` against an extension
 * would update the wrong things. Each subcommand guards its target
 * type and points at the right verb when wrong.
 *
 * Pre-flight checks run before any mutation. If anything would conflict
 * (target name already taken, target not found, folder collision,
 * type mismatch) we bail with a clear message and no partial state.
 *
 * Out of scope: registry side. The publish id (package.json::uniweb.id)
 * is independent of the workspace name and stays untouched. Users who
 * want to also rename on the registry run `uniweb publish --name <new>`.
 *
 * Usage:
 *   uniweb rename foundation <old> <new>
 *   uniweb rename site <old> <new>
 *   uniweb rename extension <old> <new>
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, rename as fsRename } from 'node:fs/promises'
import { join, relative, dirname, basename } from 'node:path'
import yaml from 'js-yaml'
import { isExtensionPackage } from '@uniweb/build'
import { findWorkspaceRoot } from '../utils/workspace.js'
import {
  readWorkspaceConfig,
  writeWorkspaceConfig,
  readRootPackageJson,
  writeRootPackageJson,
  updateRootScripts,
} from '../utils/config.js'
import { discoverFoundations, discoverSites } from '../utils/discover.js'
import { writeJsonPreservingStyleAsync } from '../utils/json-file.js'
import { getExistingPackageNames, validatePackageName } from '../utils/names.js'
import { detectPackageManager, installCmd } from '../utils/pm.js'
import { getCliPrefix } from '../utils/interactive.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

const success = (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`)
const error = (msg) => console.error(`${colors.red}✗${colors.reset} ${msg}`)
const info = (msg) => console.log(`${colors.dim}${msg}${colors.reset}`)
const log = console.log

const SUPPORTED_SUBCOMMANDS = new Set(['foundation', 'site', 'extension'])

export async function rename(args = []) {
  const [subcommand, oldName, newName] = args
  const prefix = getCliPrefix()

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    showHelp(prefix)
    return
  }

  if (!SUPPORTED_SUBCOMMANDS.has(subcommand)) {
    error(`Unknown subcommand: ${subcommand}`)
    log(`Supported: rename foundation|site|extension <old> <new>`)
    process.exit(1)
  }

  if (!oldName || !newName) {
    error('Missing arguments.')
    log(`Usage: ${prefix} rename ${subcommand} <old> <new>`)
    process.exit(1)
  }

  if (oldName === newName) {
    error('Old and new names are identical — nothing to do.')
    process.exit(1)
  }

  const rootDir = findWorkspaceRoot()
  if (!rootDir) {
    error('Not in a Uniweb workspace.')
    log(`Run this command from your project root or a site/foundation directory.`)
    process.exit(1)
  }

  if (subcommand === 'foundation') {
    await renameFoundation(rootDir, oldName, newName, prefix)
  } else if (subcommand === 'site') {
    await renameSite(rootDir, oldName, newName, prefix)
  } else if (subcommand === 'extension') {
    await renameExtension(rootDir, oldName, newName, prefix)
  }
}

// ─── Common helpers ──────────────────────────────────────────────

/**
 * Compute the new folder path for a rename. Returns { folderWillRename,
 * newPath, newDir }. The leaf is renamed to match the new package name
 * only when the leaf already matched the old package name — preserves
 * any folder convention the user adopted that diverges from the package
 * name.
 */
function computeNewFolderPath(rootDir, oldPath, oldName, newName) {
  const leaf = basename(oldPath)
  const folderWillRename = leaf === oldName
  if (!folderWillRename) {
    return { folderWillRename, newPath: oldPath, newDir: join(rootDir, oldPath) }
  }
  const parent = dirname(oldPath)
  const newPath = parent === '.' ? newName : join(parent, newName)
  return { folderWillRename, newPath, newDir: join(rootDir, newPath) }
}

/**
 * Update the workspace manifests when a folder path moves. Both
 * pnpm-workspace.yaml and package.json::workspaces are kept in sync
 * (the multi-PM compatibility invariant). Wildcard entries
 * (`extensions/*`) are left alone — only specific paths get rewritten.
 */
async function updateWorkspaceManifestsForFolderMove(rootDir, oldPath, newPath) {
  const wsConfig = await readWorkspaceConfig(rootDir)
  const rootPkg = await readRootPackageJson(rootDir)
  if (wsConfig.packages.includes(oldPath)) {
    const idx = wsConfig.packages.indexOf(oldPath)
    wsConfig.packages[idx] = newPath
    await writeWorkspaceConfig(rootDir, wsConfig)
  }
  if (Array.isArray(rootPkg.workspaces) && rootPkg.workspaces.includes(oldPath)) {
    const idx = rootPkg.workspaces.indexOf(oldPath)
    rootPkg.workspaces[idx] = newPath
    await writeRootPackageJson(rootDir, rootPkg)
  }
}

/**
 * Validate that a name is a legal package name and not already taken in
 * the workspace. Bails the process with an error if either check fails.
 * `src` and `site` are grandfathered as valid names because they're the
 * default folder leaf for the canonical foundation and site, and `add
 * foundation` / `add site` already grandfather them at scaffold time.
 */
async function validateRenameName(rootDir, newName) {
  if (newName !== 'src' && newName !== 'site') {
    const valid = validatePackageName(newName)
    if (valid !== true) {
      error(valid)
      process.exit(1)
    }
  }
  const existingNames = await getExistingPackageNames(rootDir)
  if (existingNames.has(newName)) {
    error(`Cannot rename: a package named ${colors.bright}${newName}${colors.reset} already exists in this workspace.`)
    process.exit(1)
  }
}

/**
 * Rewrite the `name` field in a package.json file.
 */
async function rewritePackageJsonName(pkgPath, newName) {
  const src = await readFile(pkgPath, 'utf-8')
  const pkg = JSON.parse(src)
  pkg.name = newName
  await writeJsonPreservingStyleAsync(pkgPath, pkg, src)
}

// ─── Foundation rename ───────────────────────────────────────────

async function renameFoundation(rootDir, oldName, newName, prefix) {
  await validateRenameName(rootDir, newName)

  const foundations = await discoverFoundations(rootDir)
  const target = foundations.find(f => f.name === oldName)
  if (!target) {
    error(`No foundation named ${colors.bright}${oldName}${colors.reset} in this workspace.`)
    if (foundations.length > 0) {
      log(`Available: ${foundations.map(f => f.name).join(', ')}`)
    }
    process.exit(1)
  }

  // Type guard — point users at the right subcommand if they're trying
  // to rename an extension via the foundation verb. They share a build
  // shape but their touch-point sets differ (foundation rename touches
  // sites' deps + site.yml::foundation; extension rename touches
  // site.yml::extensions URLs).
  if (isExtensionPackage(join(rootDir, target.path))) {
    error(`${colors.bright}${oldName}${colors.reset} is an extension, not a foundation.`)
    log(`Use \`${prefix} rename extension ${oldName} ${newName}\` instead.`)
    process.exit(1)
  }

  const oldFoundationPath = target.path
  const oldFoundationDir = join(rootDir, oldFoundationPath)
  const { folderWillRename, newPath: newFoundationPath, newDir: newFoundationDir } =
    computeNewFolderPath(rootDir, oldFoundationPath, oldName, newName)
  if (folderWillRename && existsSync(newFoundationDir)) {
    error(`Cannot rename: target folder ${colors.bright}${newFoundationPath}/${colors.reset} already exists.`)
    process.exit(1)
  }

  // Find every site that depends on the foundation. Two signals must
  // agree: site.yml::foundation === oldName AND package.json has the
  // dep key. If they disagree (which doctor would have flagged) we
  // still rename whichever signals point to the old name — the goal
  // is to leave the workspace consistent under the new name.
  const sites = await discoverSites(rootDir)
  const affectedSites = []
  for (const site of sites) {
    const sitePkgPath = join(rootDir, site.path, 'package.json')
    const siteYmlPath = join(rootDir, site.path, 'site.yml')
    let pkg, pkgSrc, ymlData
    try {
      pkgSrc = await readFile(sitePkgPath, 'utf-8')
      pkg = JSON.parse(pkgSrc)
    } catch {
      pkg = null
      pkgSrc = null
    }
    try {
      ymlData = yaml.load(await readFile(siteYmlPath, 'utf-8')) || {}
    } catch {
      ymlData = null
    }
    const hasDep = pkg?.dependencies && oldName in pkg.dependencies
    const ymlMatches = ymlData?.foundation === oldName
    if (hasDep || ymlMatches) {
      affectedSites.push({
        path: site.path,
        name: site.name,
        pkg,
        pkgSrc,
        sitePkgPath,
        siteYmlPath,
        ymlData,
        hasDep,
        ymlMatches,
      })
    }
  }

  // ─── Print plan, then execute ────────────────────────────────

  log('')
  log(`${colors.bright}Rename foundation${colors.reset}: ${colors.yellow}${oldName}${colors.reset} → ${colors.green}${newName}${colors.reset}`)
  log('')
  if (folderWillRename) {
    info(`  Folder:  ${oldFoundationPath}/  →  ${newFoundationPath}/`)
  } else {
    info(`  Folder:  ${oldFoundationPath}/  (unchanged — leaf doesn't match package name)`)
  }
  info(`  package.json::name:  "${oldName}"  →  "${newName}"`)
  if (affectedSites.length === 0) {
    info(`  Sites depending on this foundation: none`)
  } else {
    info(`  Sites depending on this foundation:`)
    for (const s of affectedSites) {
      info(`    • ${s.name} at ${s.path}/`)
    }
  }
  log('')

  if (folderWillRename) {
    await fsRename(oldFoundationDir, newFoundationDir)
  }
  await rewritePackageJsonName(join(newFoundationDir, 'package.json'), newName)

  for (const s of affectedSites) {
    if (s.hasDep) {
      const newRel = relative(join(rootDir, s.path), newFoundationDir) || '.'
      const oldValue = s.pkg.dependencies[oldName]
      delete s.pkg.dependencies[oldName]
      s.pkg.dependencies[newName] = oldValue.startsWith('file:')
        ? `file:${newRel}`
        : oldValue  // npm-pinned, leave it; rename-then-republish is out of scope.
      await writeJsonPreservingStyleAsync(s.sitePkgPath, s.pkg, s.pkgSrc)
    }
    if (s.ymlMatches) {
      const newYmlData = { ...s.ymlData, foundation: newName }
      await writeFile(s.siteYmlPath, yaml.dump(newYmlData, { flowLevel: -1, quotingType: "'" }))
    }
  }

  if (folderWillRename) {
    await updateWorkspaceManifestsForFolderMove(rootDir, oldFoundationPath, newFoundationPath)
  }

  // Root scripts can reference the foundation by name (e.g. `pnpm --filter
  // <name> build`). updateRootScripts regenerates them from the current
  // discoverSites output, which has fresh names after the writes above.
  const pm = detectPackageManager()
  const freshSites = await discoverSites(rootDir)
  await updateRootScripts(rootDir, freshSites, pm)

  log('')
  success(`Renamed foundation ${colors.bright}${oldName}${colors.reset} → ${colors.bright}${newName}${colors.reset}`)
  printNextSteps(prefix, pm)
}

// ─── Site rename ─────────────────────────────────────────────────

async function renameSite(rootDir, oldName, newName, prefix) {
  await validateRenameName(rootDir, newName)

  const sites = await discoverSites(rootDir)
  const target = sites.find(s => s.name === oldName)
  if (!target) {
    error(`No site named ${colors.bright}${oldName}${colors.reset} in this workspace.`)
    if (sites.length > 0) {
      log(`Available: ${sites.map(s => s.name).join(', ')}`)
    }
    process.exit(1)
  }

  const oldSitePath = target.path
  const oldSiteDir = join(rootDir, oldSitePath)
  const { folderWillRename, newPath: newSitePath, newDir: newSiteDir } =
    computeNewFolderPath(rootDir, oldSitePath, oldName, newName)
  if (folderWillRename && existsSync(newSiteDir)) {
    error(`Cannot rename: target folder ${colors.bright}${newSitePath}/${colors.reset} already exists.`)
    process.exit(1)
  }

  log('')
  log(`${colors.bright}Rename site${colors.reset}: ${colors.yellow}${oldName}${colors.reset} → ${colors.green}${newName}${colors.reset}`)
  log('')
  if (folderWillRename) {
    info(`  Folder:  ${oldSitePath}/  →  ${newSitePath}/`)
  } else {
    info(`  Folder:  ${oldSitePath}/  (unchanged — leaf doesn't match package name)`)
  }
  info(`  package.json::name:  "${oldName}"  →  "${newName}"`)
  log('')

  if (folderWillRename) {
    await fsRename(oldSiteDir, newSiteDir)
  }
  await rewritePackageJsonName(join(newSiteDir, 'package.json'), newName)
  if (folderWillRename) {
    await updateWorkspaceManifestsForFolderMove(rootDir, oldSitePath, newSitePath)
  }

  // Root scripts include `pnpm --filter <site-name>` style invocations
  // for `dev` / `preview` and per-site aliases. Regenerate from fresh
  // site discovery to pick up the new name.
  const pm = detectPackageManager()
  const freshSites = await discoverSites(rootDir)
  await updateRootScripts(rootDir, freshSites, pm)

  log('')
  success(`Renamed site ${colors.bright}${oldName}${colors.reset} → ${colors.bright}${newName}${colors.reset}`)
  printNextSteps(prefix, pm)
}

// ─── Extension rename ────────────────────────────────────────────

async function renameExtension(rootDir, oldName, newName, prefix) {
  await validateRenameName(rootDir, newName)

  // Extensions are a subset of foundations (same build, distinguished
  // by `extension: true` declaration). Find via discoverFoundations,
  // then verify the extension marker.
  const foundations = await discoverFoundations(rootDir)
  const target = foundations.find(f => f.name === oldName)
  if (!target) {
    error(`No package named ${colors.bright}${oldName}${colors.reset} in this workspace.`)
    process.exit(1)
  }
  if (!isExtensionPackage(join(rootDir, target.path))) {
    error(`${colors.bright}${oldName}${colors.reset} is a foundation, not an extension.`)
    log(`Use \`${prefix} rename foundation ${oldName} ${newName}\` instead.`)
    process.exit(1)
  }

  const oldExtPath = target.path
  const oldExtDir = join(rootDir, oldExtPath)
  const { folderWillRename, newPath: newExtPath, newDir: newExtDir } =
    computeNewFolderPath(rootDir, oldExtPath, oldName, newName)
  if (folderWillRename && existsSync(newExtDir)) {
    error(`Cannot rename: target folder ${colors.bright}${newExtPath}/${colors.reset} already exists.`)
    process.exit(1)
  }

  // Find every site referencing this extension via its site.yml's
  // `extensions:` array. Sites declare extensions by URL, with the
  // shape `/<workspace-relative-path>/dist/<file>` (where <file> is
  // `entry.js` post-Phase-4, `foundation.js` for older builds — match
  // both). Foreign URLs (https://, anything not starting with
  // `/<oldExtPath>/`) are left untouched.
  const oldUrlPrefix = `/${oldExtPath}/`
  const newUrlPrefix = `/${newExtPath}/`
  const sites = await discoverSites(rootDir)
  const affectedSites = []
  for (const site of sites) {
    const siteYmlPath = join(rootDir, site.path, 'site.yml')
    let ymlData
    try {
      ymlData = yaml.load(await readFile(siteYmlPath, 'utf-8')) || {}
    } catch {
      continue
    }
    const exts = Array.isArray(ymlData.extensions) ? ymlData.extensions : []
    const hits = exts.filter(e => typeof e === 'string' && e.startsWith(oldUrlPrefix))
    if (hits.length > 0) {
      affectedSites.push({ site, ymlData, siteYmlPath, hits })
    }
  }

  log('')
  log(`${colors.bright}Rename extension${colors.reset}: ${colors.yellow}${oldName}${colors.reset} → ${colors.green}${newName}${colors.reset}`)
  log('')
  if (folderWillRename) {
    info(`  Folder:  ${oldExtPath}/  →  ${newExtPath}/`)
  } else {
    info(`  Folder:  ${oldExtPath}/  (unchanged — leaf doesn't match package name)`)
  }
  info(`  package.json::name:  "${oldName}"  →  "${newName}"`)
  if (affectedSites.length === 0) {
    info(`  Sites referencing this extension: none`)
  } else {
    info(`  Sites referencing this extension:`)
    for (const { site, hits } of affectedSites) {
      info(`    • ${site.name} at ${site.path}/  (${hits.length} entr${hits.length === 1 ? 'y' : 'ies'})`)
    }
  }
  log('')

  if (folderWillRename) {
    await fsRename(oldExtDir, newExtDir)
  }
  await rewritePackageJsonName(join(newExtDir, 'package.json'), newName)

  for (const a of affectedSites) {
    const newExts = (a.ymlData.extensions || []).map(e =>
      typeof e === 'string' && e.startsWith(oldUrlPrefix)
        ? newUrlPrefix + e.slice(oldUrlPrefix.length)
        : e
    )
    const newYmlData = { ...a.ymlData, extensions: newExts }
    await writeFile(a.siteYmlPath, yaml.dump(newYmlData, { flowLevel: -1, quotingType: "'" }))
  }

  if (folderWillRename) {
    await updateWorkspaceManifestsForFolderMove(rootDir, oldExtPath, newExtPath)
  }

  // Extensions don't appear in root scripts (no dev/preview filter by
  // extension name — the foundation's own scripts handle building).
  // No updateRootScripts needed.

  const pm = detectPackageManager()
  log('')
  success(`Renamed extension ${colors.bright}${oldName}${colors.reset} → ${colors.bright}${newName}${colors.reset}`)
  printNextSteps(prefix, pm)
}

// ─── Shared output ───────────────────────────────────────────────

function printNextSteps(prefix, pm) {
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)}${colors.reset}  ${colors.dim}(refresh symlinks under the new name)${colors.reset}`)
  log(`      ${colors.cyan}${prefix} doctor${colors.reset}  ${colors.dim}(verify wiring)${colors.reset}`)
}

function showHelp(prefix) {
  log(`
${colors.cyan}${colors.bright}Uniweb Rename${colors.reset}

Rename a package across the workspace, keeping all wiring in sync.

${colors.bright}Usage:${colors.reset}
  ${prefix} rename foundation <old-name> <new-name>
  ${prefix} rename site <old-name> <new-name>
  ${prefix} rename extension <old-name> <new-name>

${colors.bright}What rename foundation does:${colors.reset}
  • Updates the foundation's package.json::name.
  • Renames the folder if its leaf matched the old package name.
  • Updates every site's package.json dependency key + file: path.
  • Updates every site's site.yml::foundation reference.
  • Updates pnpm-workspace.yaml + package.json::workspaces (kept in sync).
  • Regenerates root scripts.

${colors.bright}What rename site does:${colors.reset}
  • Updates the site's package.json::name.
  • Renames the folder if its leaf matched the old package name.
  • Updates pnpm-workspace.yaml + package.json::workspaces.
  • Regenerates root scripts (\`dev\` / \`preview\` filter by site name).

${colors.bright}What rename extension does:${colors.reset}
  • Updates the extension's package.json::name.
  • Renames the folder if its leaf matched the old package name.
  • Updates every site.yml::extensions URL whose path matched the old folder.
  • Updates pnpm-workspace.yaml + package.json::workspaces.

${colors.bright}What rename does NOT do (any subcommand):${colors.reset}
  • Push to the registry. The publish id (package.json::uniweb.id) is
    independent. To rename on the registry too, run \`${prefix} publish --name <new>\`.

${colors.bright}Examples:${colors.reset}
  ${prefix} rename foundation src marketing-src
  ${prefix} rename site site marketing-com
  ${prefix} rename extension effects animations
`)
}
