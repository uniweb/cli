/**
 * Rename Command
 *
 * Renames packages across the workspace transactionally. Currently
 * supports `rename foundation <old> <new>`; sites and extensions can be
 * added with the same scaffolding when needed.
 *
 * What a foundation rename touches (in order):
 *   1. The foundation's own package.json::name.
 *   2. Folder name on disk (when folder leaf matches old package name).
 *   3. Each site's package.json: dep key (old → new) + file: path.
 *   4. Each site's site.yml::foundation.
 *   5. pnpm-workspace.yaml::packages and package.json::workspaces
 *      (when the folder rename moved the path).
 *   6. Root scripts (`pnpm --filter <old>` references).
 *
 * Pre-flight checks run before any mutation. If anything would conflict
 * (target name already taken, foundation not found, folder collision)
 * we bail with a clear message and no partial state.
 *
 * Out of scope: registry side. The publish id (`package.json::uniweb.id`)
 * is independent of the workspace name and stays untouched. Users who
 * want to also rename on the registry run `uniweb publish --name <new>`.
 *
 * Usage:
 *   uniweb rename foundation <old> <new>
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, rename as fsRename } from 'node:fs/promises'
import { join, relative, dirname, basename } from 'node:path'
import yaml from 'js-yaml'
import { findWorkspaceRoot } from '../utils/workspace.js'
import {
  discoverFoundations,
  discoverSites,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  readRootPackageJson,
  writeRootPackageJson,
  updateRootScripts,
} from '../utils/config.js'
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

export async function rename(args = []) {
  const [subcommand, oldName, newName] = args
  const prefix = getCliPrefix()

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    showHelp(prefix)
    return
  }

  if (subcommand !== 'foundation') {
    error(`Unknown subcommand: ${subcommand}`)
    log(`Supported: rename foundation <old> <new>`)
    process.exit(1)
  }

  if (!oldName || !newName) {
    error('Missing arguments.')
    log(`Usage: ${prefix} rename foundation <old> <new>`)
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

  await renameFoundation(rootDir, oldName, newName, prefix)
}

async function renameFoundation(rootDir, oldName, newName, prefix) {
  // ─── Pre-flight ───────────────────────────────────────────────

  // Validate the new name (format + reserved-name check). `src` is
  // grandfathered in for the same reason add foundation grandfathers
  // it (the convention for "the package that lives in src/").
  if (newName !== 'src') {
    const valid = validatePackageName(newName)
    if (valid !== true) {
      error(valid)
      process.exit(1)
    }
  }

  // The foundation must exist under its current name.
  const foundations = await discoverFoundations(rootDir)
  const target = foundations.find(f => f.name === oldName)
  if (!target) {
    error(`No foundation named ${colors.bright}${oldName}${colors.reset} in this workspace.`)
    if (foundations.length > 0) {
      log(`Available: ${foundations.map(f => f.name).join(', ')}`)
    }
    process.exit(1)
  }

  // The new name must be free across the entire workspace.
  const existingNames = await getExistingPackageNames(rootDir)
  if (existingNames.has(newName)) {
    error(`Cannot rename: a package named ${colors.bright}${newName}${colors.reset} already exists in this workspace.`)
    process.exit(1)
  }

  const oldFoundationPath = target.path  // workspace-relative
  const oldFoundationDir = join(rootDir, oldFoundationPath)
  const folderLeaf = basename(oldFoundationPath)

  // Decide the new folder path. Rule: if the folder leaf matches the
  // old package name, rename the leaf to match the new package name
  // (preserving any parent dirs like `foundations/`). Otherwise leave
  // the folder alone — the user named the folder differently than the
  // package, and we honor that.
  let newFoundationPath = oldFoundationPath
  let newFoundationDir = oldFoundationDir
  const folderWillRename = folderLeaf === oldName
  if (folderWillRename) {
    const parent = dirname(oldFoundationPath)
    newFoundationPath = parent === '.' ? newName : join(parent, newName)
    newFoundationDir = join(rootDir, newFoundationPath)
    if (existsSync(newFoundationDir)) {
      error(`Cannot rename: target folder ${colors.bright}${newFoundationPath}/${colors.reset} already exists.`)
      process.exit(1)
    }
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
    let pkg, ymlText, ymlData
    try {
      pkg = JSON.parse(await readFile(sitePkgPath, 'utf-8'))
    } catch {
      pkg = null
    }
    try {
      ymlText = await readFile(siteYmlPath, 'utf-8')
      ymlData = yaml.load(ymlText) || {}
    } catch {
      ymlText = null
      ymlData = null
    }
    const hasDep = pkg?.dependencies && oldName in pkg.dependencies
    const ymlMatches = ymlData?.foundation === oldName
    if (hasDep || ymlMatches) {
      affectedSites.push({
        path: site.path,
        name: site.name,
        pkg,
        sitePkgPath,
        siteYmlPath,
        ymlData,
        hasDep,
        ymlMatches,
      })
    }
  }

  // Read workspace config + root package.json once. Both manifests
  // are kept in sync by addWorkspaceGlob; we update both here too
  // (the multi-PM compatibility invariant).
  const wsConfig = await readWorkspaceConfig(rootDir)
  const rootPkg = await readRootPackageJson(rootDir)

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

  // 1. Rename the folder (if applicable). Do this first because every
  //    later write needs paths under the new location.
  if (folderWillRename) {
    await fsRename(oldFoundationDir, newFoundationDir)
  }

  // 2. Rewrite the foundation's package.json::name.
  const fndPkgPath = join(newFoundationDir, 'package.json')
  const fndPkg = JSON.parse(await readFile(fndPkgPath, 'utf-8'))
  fndPkg.name = newName
  await writeFile(fndPkgPath, JSON.stringify(fndPkg, null, 2) + '\n')

  // 3 + 4. For each affected site, update package.json deps and site.yml.
  for (const s of affectedSites) {
    if (s.hasDep) {
      // Rename the dep key. Recompute the file: path against the new
      // foundation location (the old one no longer exists if the
      // folder was renamed).
      const newRel = relative(join(rootDir, s.path), newFoundationDir) || '.'
      const oldValue = s.pkg.dependencies[oldName]
      delete s.pkg.dependencies[oldName]
      s.pkg.dependencies[newName] = oldValue.startsWith('file:')
        ? `file:${newRel}`
        : oldValue  // npm-pinned, leave it; rename-then-republish would
                    // need a separate `pnpm update` step that's out of scope.
      await writeFile(s.sitePkgPath, JSON.stringify(s.pkg, null, 2) + '\n')
    }
    if (s.ymlMatches) {
      const newYmlData = { ...s.ymlData, foundation: newName }
      await writeFile(s.siteYmlPath, yaml.dump(newYmlData, { flowLevel: -1, quotingType: "'" }))
    }
  }

  // 5. Update workspace manifests. Both pnpm-workspace.yaml and
  //    package.json::workspaces (sync invariant) — only the entry
  //    matching the old folder path moves; bare globs like
  //    `foundations/*` don't change.
  if (folderWillRename) {
    if (wsConfig.packages.includes(oldFoundationPath)) {
      const idx = wsConfig.packages.indexOf(oldFoundationPath)
      wsConfig.packages[idx] = newFoundationPath
      await writeWorkspaceConfig(rootDir, wsConfig)
    }
    if (Array.isArray(rootPkg.workspaces) && rootPkg.workspaces.includes(oldFoundationPath)) {
      const idx = rootPkg.workspaces.indexOf(oldFoundationPath)
      rootPkg.workspaces[idx] = newFoundationPath
      await writeRootPackageJson(rootDir, rootPkg)
    }
  }

  // 6. Root scripts can reference the foundation by name (e.g.
  //    `pnpm --filter <name> build`). updateRootScripts regenerates
  //    them from the current discoverSites output, which has fresh
  //    names after the writes above.
  const pm = detectPackageManager()
  const freshSites = await discoverSites(rootDir)
  await updateRootScripts(rootDir, freshSites, pm)

  // ─── Done ─────────────────────────────────────────────────────

  log('')
  success(`Renamed foundation ${colors.bright}${oldName}${colors.reset} → ${colors.bright}${newName}${colors.reset}`)
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)}${colors.reset}  ${colors.dim}(refresh symlinks under the new name)${colors.reset}`)
  log(`      ${colors.cyan}${getCliPrefix()} doctor${colors.reset}  ${colors.dim}(verify wiring)${colors.reset}`)
}

function showHelp(prefix) {
  log(`
${colors.cyan}${colors.bright}Uniweb Rename${colors.reset}

Rename a package across the workspace, keeping all wiring in sync.

${colors.bright}Usage:${colors.reset}
  ${prefix} rename foundation <old-name> <new-name>

${colors.bright}What it does (foundation):${colors.reset}
  • Updates the foundation's package.json::name.
  • Renames the folder if its leaf matched the old package name.
  • Updates every site's package.json dependency key + file: path.
  • Updates every site's site.yml::foundation reference.
  • Updates pnpm-workspace.yaml + package.json::workspaces (kept in sync).
  • Regenerates root scripts.

${colors.bright}What it does NOT do:${colors.reset}
  • Push to the registry. The publish id (package.json::uniweb.id) is
    independent. To rename on the registry too, run \`${prefix} publish --name <new>\`.

${colors.bright}Examples:${colors.reset}
  ${prefix} rename foundation src marketing-src
  ${prefix} rename foundation marketing acme-marketing
`)
}
