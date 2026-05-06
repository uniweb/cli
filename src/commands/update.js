/**
 * uniweb update — Reconcile a Uniweb workspace's state with the running
 * CLI's expectations. Three convergence steps, in order:
 *
 *   1. Self-update the global CLI install (npm / pnpm / yarn auto-detected).
 *   2. Align workspace `@uniweb/*` + `uniweb` deps to the CLI's bundled
 *      version matrix (`getResolvedVersions`), then run `<pm> install`.
 *   3. Refresh AGENTS.md from the CLI's bundled partial.
 *
 * Why steps 2 and 3 belong together: AGENTS.md is regenerated from the
 * CLI's *current* partials and stamped with `cliVersion`. Refreshing it
 * while declared deps in `package.json` lag the CLI silently produces a
 * doc that documents features the installed code doesn't have. The
 * verb's drift gate refuses that combination unless `--allow-mismatch`
 * is explicit.
 *
 * Flags:
 *   --agents-only       Skip self-update + deps; only refresh AGENTS.md.
 *   --deps-only         Skip self-update + AGENTS.md; only align deps.
 *   --no-agents         Skip the AGENTS.md step.
 *   --no-deps           Skip the deps-alignment step.
 *   --dry-run           Print survey + would-be writes; no mutations.
 *   --allow-mismatch    Permit AGENTS.md refresh when declared deps lag.
 *   --yes               Skip confirmation prompts (still respects gates).
 *   --non-interactive   Auto-detected; never auto-installs from a script.
 *
 * Project-local case (CLI lives in node_modules, not global): self-update
 * is a no-op (the version is pinned by package.json). Deps + AGENTS.md
 * paths still run.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import prompts from 'prompts'

import { findWorkspaceRoot, getWorkspacePackages } from '../utils/workspace.js'
import { readAgentsVersion, generateAgentsContent } from '../utils/agents-stamp.js'
import { getCliVersion, getResolvedVersions, updatePackageVersions } from '../versions.js'
import { isNonInteractive } from '../utils/interactive.js'
import { detectWorkspacePm, installCmd } from '../utils/pm.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

const success = (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`)
const warn = (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`)
const error = (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`)
const info = (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`)
const log = console.log

/**
 * Detect whether this CLI is running from a global install. Mirrors the
 * logic in index.js::isGlobalInstall — when global, process.argv[1]
 * points outside any node_modules.
 */
function isGlobalInstall() {
  const scriptPath = process.argv[1]
  if (!scriptPath) return false
  return !scriptPath.split('/').includes('node_modules') &&
         !scriptPath.split('\\').includes('node_modules')
}

/**
 * Find a *Uniweb* workspace root from cwd. Stricter than findWorkspaceRoot
 * — also requires that the workspace's root package.json declares uniweb
 * as a dep or devDep. Otherwise we'd write AGENTS.md and edit package.json
 * files in unrelated monorepos.
 */
function findUniwebWorkspace(cwd) {
  const workspaceDir = findWorkspaceRoot(cwd)
  if (!workspaceDir) return null
  const pkgPath = join(workspaceDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const hasUniwebDep = !!(pkg.devDependencies?.uniweb || pkg.dependencies?.uniweb)
    return hasUniwebDep ? workspaceDir : null
  } catch {
    return null
  }
}

/**
 * Detect the package manager that owns the *global* CLI install.
 * Path-based (different signal than detectWorkspacePm, which reads
 * lockfiles in the workspace).
 *
 * @returns {'pnpm'|'yarn'|'npm'}
 */
function detectGlobalPm() {
  const path = (process.argv[1] || '').toLowerCase()
  if (path.includes('/pnpm/') || path.includes('\\pnpm\\')) return 'pnpm'
  if (path.includes('/yarn/') || path.includes('\\yarn\\')) return 'yarn'
  return 'npm'
}

/**
 * Build the global-install command for a given PM.
 */
function globalInstallCmd(pm) {
  if (pm === 'pnpm') return 'pnpm add -g uniweb@latest'
  if (pm === 'yarn') return 'yarn global add uniweb@latest'
  return 'npm i -g uniweb@latest'
}

/**
 * Fetch the latest published version. Returns null on network error.
 */
async function fetchLatestVersion() {
  try {
    const res = await fetch('https://registry.npmjs.org/uniweb/latest')
    if (!res.ok) return null
    const data = await res.json()
    return data?.version || null
  } catch {
    return null
  }
}

/**
 * Strip a leading semver range operator (^, ~, >=, <, etc.) so two specs
 * can be compared by their underlying version. Range expressions like
 * ">=0.5 <0.7" aren't fully parsed — we take the first version-shaped
 * token. Sufficient for `@uniweb/*` deps which use `^x.y.z` consistently.
 */
function stripRange(spec) {
  return (spec || '').replace(/^[\^~>=<\s]+/, '').trim().split(/\s+/)[0] || ''
}

/**
 * Compare two version specs (range prefix tolerated). Returns 1/-1/0.
 */
function compareSemver(a, b) {
  const pa = stripRange(a).split('.').map(Number)
  const pb = stripRange(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

/**
 * Run a shell command, inheriting stdio. Resolves with the exit code.
 */
function runCommand(cmd, cwd) {
  return new Promise((resolve) => {
    const [bin, ...rest] = cmd.split(' ')
    const child = spawn(bin, rest, { stdio: 'inherit', cwd })
    child.on('close', code => resolve(code ?? 0))
    child.on('error', () => resolve(1))
  })
}

/**
 * Survey workspace `@uniweb/*` and `uniweb` deps against the CLI's
 * bundled version matrix. Returns a structured report with one row per
 * (package directory, dep section, dep name).
 *
 * Comparison is on *declared* versions (package.json), not installed
 * (node_modules) — that's what the user committed and what they'll
 * `git diff` after `applyDepUpdates`.
 */
async function surveyVersions(workspaceDir) {
  const targets = getResolvedVersions()
  const packages = await getWorkspacePackages(workspaceDir)
  const dirs = ['', ...packages]
  const rows = []
  let anyDrift = false
  let anyAhead = false

  for (const relDir of dirs) {
    const pkgDir = relDir ? join(workspaceDir, relDir) : workspaceDir
    const pkgPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgPath)) continue
    let pkg
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { continue }

    for (const sectionName of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const section = pkg[sectionName]
      if (!section) continue
      for (const [name, current] of Object.entries(section)) {
        if (!(name.startsWith('@uniweb/') || name === 'uniweb')) continue
        const target = targets[name]
        if (!target) continue
        const cmp = compareSemver(target, current)
        let status
        if (cmp > 0) { status = 'behind'; anyDrift = true }
        else if (cmp < 0) { status = 'ahead'; anyAhead = true }
        else { status = 'aligned' }
        rows.push({
          relDir: relDir || '(root)',
          section: sectionName,
          name,
          current,
          target,
          status,
        })
      }
    }
  }

  return { targets, rows, anyDrift, anyAhead }
}

/**
 * Print the survey report grouped by package directory.
 */
function printSurvey(report, cliVersion, agentsVersion) {
  log('')
  log(`${colors.bright}uniweb CLI:${colors.reset}             v${cliVersion}`)
  log(`${colors.bright}AGENTS.md stamp:${colors.reset}        ${agentsVersion ? 'v' + agentsVersion : colors.dim + '(none)' + colors.reset}`)
  log('')

  if (report.rows.length === 0) {
    log(`${colors.dim}No @uniweb/* deps found in workspace package.json files.${colors.reset}`)
    log('')
    return
  }

  const byDir = {}
  for (const row of report.rows) {
    if (!byDir[row.relDir]) byDir[row.relDir] = []
    byDir[row.relDir].push(row)
  }

  log(`${colors.bright}Workspace deps (declared):${colors.reset}`)
  for (const [dir, dirRows] of Object.entries(byDir)) {
    log(`  ${colors.dim}${dir}/${colors.reset}`)
    const maxName = Math.max(...dirRows.map(r => r.name.length))
    for (const row of dirRows) {
      const padding = ' '.repeat(maxName - row.name.length)
      let icon, statusText
      if (row.status === 'aligned') {
        icon = `${colors.green}✓${colors.reset}`
        statusText = `${colors.dim}aligned${colors.reset}`
      } else if (row.status === 'behind') {
        icon = `${colors.yellow}✗${colors.reset}`
        statusText = `${colors.yellow}behind${colors.reset}`
      } else {
        icon = `${colors.cyan}↑${colors.reset}`
        statusText = `${colors.cyan}ahead of CLI${colors.reset}`
      }
      log(`    ${icon} ${row.name}${padding}  ${row.current.padEnd(10)} → ${row.target.padEnd(10)}  ${statusText}`)
    }
  }
  log('')
}

/**
 * Apply the CLI's bundled matrix to every workspace package.json.
 * `updatePackageVersions` only touches `@uniweb/*` + `uniweb` keys, so
 * unrelated deps (`react`, `vite`, `file:../foundation`, etc.) are left
 * untouched. Returns the list of paths that actually changed.
 */
async function applyDepUpdates(workspaceDir, dryRun) {
  const packages = await getWorkspacePackages(workspaceDir)
  const dirs = ['', ...packages]
  const edited = []

  for (const relDir of dirs) {
    const pkgDir = relDir ? join(workspaceDir, relDir) : workspaceDir
    const pkgPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgPath)) continue
    const original = readFileSync(pkgPath, 'utf8')
    let pkg
    try { pkg = JSON.parse(original) } catch { continue }

    const updated = updatePackageVersions(pkg)
    const newContent = JSON.stringify(updated, null, 2) + (original.endsWith('\n') ? '\n' : '')

    if (newContent !== original) {
      edited.push(pkgPath)
      if (!dryRun) writeFileSync(pkgPath, newContent)
    }
  }

  return edited
}

function relativize(path, root) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path
}

export async function update(args = []) {
  const agentsOnly = args.includes('--agents-only')
  const depsOnly = args.includes('--deps-only')
  const skipAgents = args.includes('--no-agents') || depsOnly
  const skipDeps = args.includes('--no-deps') || agentsOnly
  const dryRun = args.includes('--dry-run')
  const allowMismatch = args.includes('--allow-mismatch')
  const nonInteractive = isNonInteractive(args)
  const skipPrompt = args.includes('--yes') || nonInteractive || dryRun
  const isGlobal = isGlobalInstall()
  const workspaceDir = findUniwebWorkspace(process.cwd())
  const inProject = !!workspaceDir
  const cliVersion = getCliVersion()

  if ((agentsOnly || depsOnly) && !inProject) {
    error(`${agentsOnly ? '--agents-only' : '--deps-only'} requires a Uniweb project (no \`uniweb\` dep in the workspace root).`)
    log(`${colors.dim}Run this command from inside a project created by${colors.reset} ${colors.cyan}uniweb create${colors.reset}${colors.dim}.${colors.reset}`)
    process.exit(1)
  }

  // ── Survey first (always, when in a Uniweb project) ──────────────
  let survey = null
  let agentsVersion = null
  if (inProject) {
    survey = await surveyVersions(workspaceDir)
    agentsVersion = readAgentsVersion(join(workspaceDir, 'AGENTS.md'))
    printSurvey(survey, cliVersion, agentsVersion)
  }

  // ── Step 1: Self-update path ─────────────────────────────────────
  if (!agentsOnly && !depsOnly) {
    if (!isGlobal) {
      log(`${colors.dim}Running the project-local CLI (v${cliVersion}). This copy is pinned by your${colors.reset}`)
      log(`${colors.dim}project's package.json. To update it, bump${colors.reset} ${colors.cyan}uniweb${colors.reset}${colors.dim} in${colors.reset} ${colors.cyan}package.json${colors.reset}${colors.dim} and re-install.${colors.reset}`)
      log('')
    } else {
      const latest = await fetchLatestVersion()
      if (latest === null) {
        warn('Could not reach the npm registry to check for updates.')
        log(`${colors.dim}Current: ${cliVersion}. Try later, or run${colors.reset} ${colors.cyan}${globalInstallCmd(detectGlobalPm())}${colors.reset}${colors.dim} manually.${colors.reset}`)
        log('')
      } else if (compareSemver(latest, cliVersion) <= 0) {
        success(`uniweb is up to date (v${cliVersion}).`)
        log('')
      } else {
        const pm = detectGlobalPm()
        const cmd = globalInstallCmd(pm)
        log(`${colors.yellow}Update available:${colors.reset} ${colors.dim}${cliVersion}${colors.reset} → ${colors.cyan}${latest}${colors.reset}`)
        log(`${colors.dim}Detected package manager:${colors.reset} ${pm}`)
        log(`${colors.dim}Will run:${colors.reset} ${colors.cyan}${cmd}${colors.reset}`)
        log('')

        if (dryRun) {
          info(`${colors.dim}--dry-run: would run \`${cmd}\`.${colors.reset}`)
          log('')
        } else if (skipPrompt) {
          log(`${colors.dim}Non-interactive — skipping self-update. Run the command above to update.${colors.reset}`)
          log('')
        } else {
          const { go } = await prompts({
            type: 'confirm',
            name: 'go',
            message: `Run \`${cmd}\` now?`,
            initial: true,
          })
          if (go) {
            const code = await runCommand(cmd)
            if (code === 0) {
              success(`Self-update complete.`)
            } else {
              error(`Self-update failed (exit ${code}). Run the command above manually if needed.`)
            }
            log('')
          } else {
            log(`${colors.dim}Skipped self-update.${colors.reset}`)
            log('')
          }
        }
      }
    }
  }

  // ── Step 2: Deps alignment ───────────────────────────────────────
  if (!skipDeps && inProject && survey) {
    if (!survey.anyDrift) {
      success('Workspace deps are aligned with the CLI.')
      if (survey.anyAhead) {
        log(`${colors.dim}(Some deps are ahead of the CLI's bundled matrix — left untouched.)${colors.reset}`)
      }
      log('')
    } else {
      log(`${colors.yellow}⚠${colors.reset}  Some workspace deps lag the CLI's bundled matrix.`)
      log('')

      let proceed
      if (dryRun) {
        proceed = false
      } else if (skipPrompt) {
        proceed = !nonInteractive || args.includes('--yes')
        // In CI without --yes, refuse to mutate. The survey above is the report.
        if (!proceed) {
          info(`${colors.dim}Non-interactive — printing the alignment plan; not editing files.${colors.reset}`)
          log(`${colors.dim}To apply, re-run with${colors.reset} ${colors.cyan}--yes${colors.reset}${colors.dim}, or align manually:${colors.reset}`)
          log(`  ${colors.cyan}pnpm update "@uniweb/*" uniweb -r${colors.reset}`)
          log('')
        }
      } else {
        const { go } = await prompts({
          type: 'confirm',
          name: 'go',
          message: `Edit workspace package.json files to align with v${cliVersion}?`,
          initial: true,
        })
        proceed = !!go
      }

      if (dryRun) {
        const wouldEdit = await applyDepUpdates(workspaceDir, true)
        if (wouldEdit.length > 0) {
          info('Dry-run: would update package.json in:')
          for (const path of wouldEdit) log(`  ${colors.dim}- ${relativize(path, workspaceDir)}${colors.reset}`)
          const pm = detectWorkspacePm(workspaceDir)
          if (pm) {
            log(`${colors.dim}Then would run:${colors.reset} ${colors.cyan}${installCmd(pm)}${colors.reset}`)
          } else {
            log(`${colors.dim}Then would prompt for an install command (no lockfile detected).${colors.reset}`)
          }
          log('')
        }
      } else if (proceed) {
        const edited = await applyDepUpdates(workspaceDir, false)
        if (edited.length === 0) {
          info('No package.json files needed changes.')
          log('')
        } else {
          for (const path of edited) {
            success(`Updated ${relativize(path, workspaceDir)}`)
          }
          log('')

          // Resolve the workspace PM (lockfile-driven). If absent, ask.
          let pm = detectWorkspacePm(workspaceDir)
          if (!pm) {
            if (nonInteractive) {
              warn('No lockfile in workspace root — cannot pick an install command for you.')
              log(`${colors.dim}Run one of:${colors.reset} ${colors.cyan}pnpm install${colors.reset} ${colors.dim}/${colors.reset} ${colors.cyan}yarn install${colors.reset} ${colors.dim}/${colors.reset} ${colors.cyan}npm install${colors.reset}`)
              log('')
            } else {
              const { picked } = await prompts({
                type: 'select',
                name: 'picked',
                message: 'No lockfile found. Which package manager does this workspace use?',
                choices: [
                  { title: 'pnpm', value: 'pnpm' },
                  { title: 'yarn', value: 'yarn' },
                  { title: 'npm', value: 'npm' },
                  { title: 'skip — I\'ll install manually', value: null },
                ],
              })
              pm = picked || null
            }
          }

          if (pm) {
            const cmd = installCmd(pm)
            let runInstall
            if (nonInteractive) {
              runInstall = false
              info(`${colors.dim}Non-interactive — printing install command:${colors.reset}`)
              log(`  ${colors.cyan}${cmd}${colors.reset}`)
              log('')
            } else if (skipPrompt) {
              runInstall = true
            } else {
              const { go } = await prompts({
                type: 'confirm',
                name: 'go',
                message: `Run \`${cmd}\` now?`,
                initial: true,
              })
              runInstall = !!go
            }

            if (runInstall) {
              const code = await runCommand(cmd, workspaceDir)
              if (code === 0) {
                success('Install complete.')
                log('')
              } else {
                error(`Install failed (exit ${code}). package.json edits are intact.`)
                const editedRel = edited.map(p => relativize(p, workspaceDir)).join(' ')
                log(`${colors.dim}To revert:${colors.reset} ${colors.cyan}git checkout -- ${editedRel}${colors.reset}`)
                log(`${colors.dim}To retry: ${colors.reset} ${colors.cyan}${cmd}${colors.reset}`)
                log('')
                process.exit(code)
              }
            } else {
              log(`${colors.dim}Skipped install. Edits saved; run${colors.reset} ${colors.cyan}${cmd}${colors.reset} ${colors.dim}to apply.${colors.reset}`)
              log('')
            }
          }
        }
      } else {
        log(`${colors.dim}Skipped deps alignment.${colors.reset}`)
        log('')
      }
    }
  }

  // ── Step 3: AGENTS.md ────────────────────────────────────────────
  if (skipAgents) return
  if (!inProject) {
    // Self-update-only invocation outside a Uniweb project: quietly skip.
    return
  }

  // Re-survey: deps may have just been edited, which clears the gate.
  const finalSurvey = await surveyVersions(workspaceDir)
  if (finalSurvey.anyDrift && !allowMismatch) {
    warn('AGENTS.md refresh skipped: workspace deps still lag the CLI.')
    log(`${colors.dim}AGENTS.md from v${cliVersion} would document features not in your installed packages.${colors.reset}`)
    log(`${colors.dim}Re-run without ${colors.reset}${colors.cyan}--no-deps${colors.reset}${colors.dim}, or pass ${colors.reset}${colors.cyan}--allow-mismatch${colors.reset}${colors.dim} to override.${colors.reset}`)
    log('')
    if (agentsOnly) process.exit(1)
    return
  }

  const agentsPath = join(workspaceDir, 'AGENTS.md')
  const currentAgentsVersion = readAgentsVersion(agentsPath)
  if (currentAgentsVersion === cliVersion) {
    success(`AGENTS.md is already up to date (v${cliVersion}).`)
    return
  }

  if (dryRun) {
    info(`Dry-run: would ${currentAgentsVersion ? `update AGENTS.md (v${currentAgentsVersion} → v${cliVersion})` : `create AGENTS.md (v${cliVersion})`}.`)
    return
  }

  if (!skipPrompt && !agentsOnly) {
    const action = currentAgentsVersion
      ? `Update AGENTS.md (v${currentAgentsVersion} → v${cliVersion})?`
      : `Create AGENTS.md (v${cliVersion})?`
    const { yes } = await prompts({ type: 'confirm', name: 'yes', message: action, initial: true })
    if (!yes) {
      log(`${colors.dim}Skipped AGENTS.md.${colors.reset}`)
      return
    }
  }

  const content = generateAgentsContent()
  writeFileSync(agentsPath, content)
  if (currentAgentsVersion) {
    success(`Updated AGENTS.md (v${currentAgentsVersion} → v${cliVersion}).`)
  } else {
    success(`Created AGENTS.md (v${cliVersion}).`)
  }
}
