/**
 * uniweb update — Reconcile a Uniweb workspace's state with the CLI that's
 * running this command. One job, two convergence steps:
 *
 *   1. Align workspace `@uniweb/*` + `uniweb` deps to this CLI's bundled
 *      version matrix (`getResolvedVersions`) — only deps that *lag* the
 *      matrix are touched; deps that are *ahead* are left alone (no
 *      downgrades) — then run `<pm> install`.
 *   2. Refresh AGENTS.md from this CLI's bundled partial.
 *
 * Why those two belong together: AGENTS.md is regenerated from the CLI's
 * *current* partials and stamped with `cliVersion`. Refreshing it while
 * the installed `@uniweb/*` packages still lag the CLI silently produces a
 * doc that documents features the installed code doesn't have. So step 2
 * refuses to run unless step 1 actually completed (deps aligned *and*
 * installed). `--allow-mismatch` overrides the declared-deps half of that
 * gate; nothing overrides "you skipped the install" — run the install and
 * re-run `update`.
 *
 * What this command does NOT do: update the CLI itself. A globally
 * installed `uniweb` is updated through its package manager
 * (`npm i -g uniweb@latest`, `pnpm add -g uniweb@latest`, …); the version
 * notification machinery (`utils/update-check.js`, `uniweb --version`)
 * surfaces when that's needed. To reconcile a project against the *latest*
 * release without touching a global install, run `npx uniweb@latest
 * update` — npx fetches the latest CLI, which carries its own matrix.
 *
 * Flags:
 *   --agents-only       Only refresh AGENTS.md (skip the deps step).
 *   --deps-only         Only align deps (skip the AGENTS.md step).
 *   --no-agents         Skip the AGENTS.md step.
 *   --no-deps           Skip the deps-alignment step.
 *   --dry-run           Print survey + would-be writes; no mutations.
 *   --allow-mismatch    Refresh AGENTS.md even if declared deps lag.
 *   --yes               Don't prompt — apply edits and run the install.
 *   --non-interactive   Auto-detected; prints the plan, never mutates
 *                       (combine with --yes to apply non-interactively).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import prompts from 'prompts'

import { findWorkspaceRoot } from '../utils/workspace.js'
import { readAgentsVersion, generateAgentsContent } from '../utils/agents-stamp.js'
import { getCliVersion } from '../versions.js'
import { isNonInteractive } from '../utils/interactive.js'
import { detectWorkspacePm, installCmd, detectGlobalCliPm, globalCliUpdateCmd } from '../utils/pm.js'
import { writeJsonPreservingStyle } from '../utils/json-file.js'
import { surveyWorkspaceDeps, compareSemver } from '../utils/dep-survey.js'

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
 * Detect whether this CLI is running from a global install — when global,
 * process.argv[1] points outside any node_modules. Mirrors
 * index.js::isGlobalInstall.
 */
function isGlobalInstall() {
  const scriptPath = process.argv[1]
  if (!scriptPath) return false
  return !scriptPath.split('/').includes('node_modules') &&
         !scriptPath.split('\\').includes('node_modules')
}

/**
 * Detect whether this CLI was launched via `npx uniweb …` (or `npm exec`).
 * npx materializes the package under `…/_npx/<hash>/node_modules/uniweb/…`,
 * which `isGlobalInstall()` can't distinguish from a real project-local
 * dependency (both contain `node_modules`).
 */
function isNpxInvocation() {
  const p = (process.argv[1] || '').replace(/\\/g, '/')
  return p.includes('/_npx/')
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

/** Fetch the latest published CLI version. Returns null on network error. */
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

/** Run a shell command, inheriting stdio. Resolves with the exit code. */
function runCommand(cmd, cwd) {
  return new Promise((resolve) => {
    const [bin, ...rest] = cmd.split(' ')
    const child = spawn(bin, rest, { stdio: 'inherit', cwd })
    child.on('close', code => resolve(code ?? 0))
    child.on('error', () => resolve(1))
  })
}

/** Print the survey report grouped by package directory. */
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
 * Apply the CLI's matrix to workspace package.json files — but only to
 * deps that *lag* the matrix (survey status `behind`). Deps that are
 * `ahead` are left alone: `update` never downgrades. Indentation and the
 * trailing newline of each file are preserved (a one-key bump shouldn't
 * reflow the whole file). Returns the list of paths that actually changed.
 */
function applyDepUpdates(workspaceDir, surveyRows, dryRun) {
  const behind = surveyRows.filter(r => r.status === 'behind')
  const byDir = {}
  for (const row of behind) {
    const dir = row.relDir === '(root)' ? '' : row.relDir
    if (!byDir[dir]) byDir[dir] = []
    byDir[dir].push(row)
  }

  const edited = []
  for (const [relDir, dirRows] of Object.entries(byDir)) {
    const pkgDir = relDir ? join(workspaceDir, relDir) : workspaceDir
    const pkgPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgPath)) continue
    const original = readFileSync(pkgPath, 'utf8')
    let pkg
    try { pkg = JSON.parse(original) } catch { continue }

    let changed = false
    for (const row of dirRows) {
      const section = pkg[row.section]
      if (section && section[row.name] !== undefined && section[row.name] !== row.target) {
        section[row.name] = row.target
        changed = true
      }
    }

    if (changed) {
      edited.push(pkgPath)
      if (!dryRun) writeJsonPreservingStyle(pkgPath, pkg, original)
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
  const hasYes = args.includes('--yes')
  const nonInteractive = isNonInteractive(args)
  const isGlobal = isGlobalInstall()
  const isNpx = isNpxInvocation()
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
    survey = await surveyWorkspaceDeps(workspaceDir)
    agentsVersion = readAgentsVersion(join(workspaceDir, 'AGENTS.md'))
    printSurvey(survey, cliVersion, agentsVersion)
  }

  // ── This command reconciles the *project*, not the CLI ───────────
  // Surface (but don't act on) a newer published CLI: this run aligns
  // the project to *this* CLI's matrix.
  let installPm = inProject ? detectWorkspacePm(workspaceDir) : null
  if (isNpx) {
    log(`${colors.dim}Running${colors.reset} ${colors.cyan}uniweb@${cliVersion}${colors.reset} ${colors.dim}via npx — aligning this project to v${cliVersion}'s matrix.${colors.reset}`)
    log(`${colors.dim}(To install the CLI:${colors.reset} ${colors.cyan}npm i -g uniweb${colors.reset}${colors.dim}.)${colors.reset}`)
    log('')
  } else if (isGlobal) {
    const latest = await fetchLatestVersion()
    if (latest && compareSemver(latest, cliVersion) > 0) {
      const pm = detectGlobalCliPm()
      log(`${colors.yellow}A newer uniweb is available:${colors.reset} ${colors.dim}v${cliVersion}${colors.reset} → ${colors.cyan}v${latest}${colors.reset}`)
      log(`${colors.dim}This run aligns the project to v${cliVersion}. To update the CLI:${colors.reset} ${colors.cyan}${globalCliUpdateCmd(pm)}${colors.reset}`)
      log(`${colors.dim}Or, to align to the latest release without a global install:${colors.reset} ${colors.cyan}npx uniweb@latest update${colors.reset}`)
      log('')
    }
  } else {
    // Project-local copy (lives in this project's node_modules).
    log(`${colors.dim}Running the project-local CLI (v${cliVersion}) — pinned by your project's${colors.reset} ${colors.cyan}package.json${colors.reset}${colors.dim}.${colors.reset}`)
    log(`${colors.dim}To use a newer CLI, bump${colors.reset} ${colors.cyan}uniweb${colors.reset}${colors.dim} in${colors.reset} ${colors.cyan}package.json${colors.reset}${colors.dim} and re-install, or run${colors.reset} ${colors.cyan}npx uniweb@latest update${colors.reset}${colors.dim}.${colors.reset}`)
    log('')
  }

  if (!inProject) {
    log(`${colors.dim}Not inside a Uniweb project — nothing to reconcile.${colors.reset}`)
    log(`${colors.dim}Run this from a project created by${colors.reset} ${colors.cyan}uniweb create${colors.reset}${colors.dim}.${colors.reset}`)
    log('')
    return
  }

  // ── Step 1: Deps alignment ───────────────────────────────────────
  let depsEdited = false      // package.json files were rewritten
  let installRan = false      // `<pm> install` ran and succeeded
  let editedPaths = []

  if (!skipDeps && survey) {
    if (!survey.anyDrift) {
      success('Workspace deps are aligned with the CLI.')
      if (survey.anyAhead) {
        log(`${colors.dim}(Some deps are ahead of the CLI's bundled matrix — left untouched.)${colors.reset}`)
      }
      if (!existsSync(join(workspaceDir, 'node_modules'))) {
        warn(`No ${colors.bright}node_modules${colors.reset} in the workspace — run ${colors.cyan}${installCmd(installPm || 'pnpm')}${colors.reset} to install.`)
      }
      log('')
    } else {
      log(`${colors.yellow}⚠${colors.reset}  Some workspace deps lag the CLI's bundled matrix.`)
      log('')

      // Decide whether to write the package.json edits.
      let proceed
      if (dryRun) {
        proceed = false
      } else if (hasYes) {
        proceed = true
      } else if (nonInteractive) {
        proceed = false
        info(`${colors.dim}Non-interactive — printing the alignment plan; not editing files.${colors.reset}`)
        log(`${colors.dim}To apply, re-run with${colors.reset} ${colors.cyan}--yes${colors.reset}${colors.dim}, or align manually:${colors.reset}`)
        log(`  ${colors.cyan}pnpm update "@uniweb/*" uniweb -r${colors.reset}`)
        log('')
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
        const wouldEdit = applyDepUpdates(workspaceDir, survey.rows, true)
        if (wouldEdit.length > 0) {
          info('Dry-run: would update package.json in:')
          for (const path of wouldEdit) log(`  ${colors.dim}- ${relativize(path, workspaceDir)}${colors.reset}`)
          if (installPm) {
            log(`${colors.dim}Then would run:${colors.reset} ${colors.cyan}${installCmd(installPm)}${colors.reset}`)
          } else {
            log(`${colors.dim}Then would prompt for an install command (no lockfile detected).${colors.reset}`)
          }
          log('')
        }
      } else if (proceed) {
        editedPaths = applyDepUpdates(workspaceDir, survey.rows, false)
        depsEdited = editedPaths.length > 0
        if (!depsEdited) {
          info('No package.json files needed changes.')
          log('')
        } else {
          for (const path of editedPaths) success(`Updated ${relativize(path, workspaceDir)}`)
          log('')

          // Resolve the workspace PM (lockfile-driven). If absent, ask.
          if (!installPm) {
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
              installPm = picked || null
            }
          }

          if (installPm) {
            const cmd = installCmd(installPm)
            let runInstall
            if (hasYes) {
              runInstall = true
            } else if (nonInteractive) {
              runInstall = false
              info(`${colors.dim}Non-interactive — run the install yourself:${colors.reset} ${colors.cyan}${cmd}${colors.reset}`)
              log('')
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
                installRan = true
                success('Install complete.')
                log('')
              } else {
                error(`Install failed (exit ${code}). package.json edits are intact.`)
                const editedRel = editedPaths.map(p => relativize(p, workspaceDir)).join(' ')
                log(`${colors.dim}To revert:${colors.reset} ${colors.cyan}git checkout -- ${editedRel}${colors.reset}`)
                log(`${colors.dim}To retry: ${colors.reset} ${colors.cyan}${cmd}${colors.reset}`)
                log('')
                process.exit(code)
              }
            } else {
              log(`${colors.dim}Skipped install. Edits saved; run${colors.reset} ${colors.cyan}${cmd}${colors.reset} ${colors.dim}to apply them.${colors.reset}`)
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

  // ── Step 2: AGENTS.md ────────────────────────────────────────────
  let agentsResult = null     // 'created' | 'updated' | 'current' | 'skipped'

  if (!skipAgents) {
    agentsResult = await refreshAgents({
      workspaceDir, cliVersion, allowMismatch, dryRun,
      hasYes, nonInteractive, agentsOnly, depsEdited, installRan, installPm,
    })
  }

  // ── Closing summary ──────────────────────────────────────────────
  if (!dryRun && (depsEdited || agentsResult === 'created' || agentsResult === 'updated')) {
    printSummary({ editedPaths, depsEdited, installRan, installPm, agentsResult, cliVersion })
  }
}

/**
 * Step 2 — regenerate AGENTS.md from the CLI's bundled partial, stamped
 * with the CLI version. Guarded: won't run if the deps were edited but
 * not installed (the doc would describe code that isn't on disk yet), and
 * won't run if declared deps still lag the CLI unless --allow-mismatch.
 *
 * @returns {'created'|'updated'|'current'|'skipped'} what happened.
 */
async function refreshAgents(ctx) {
  const {
    workspaceDir, cliVersion, allowMismatch, dryRun,
    hasYes, nonInteractive, agentsOnly, depsEdited, installRan, installPm,
  } = ctx

  // Deps were rewritten but not installed → node_modules is now behind
  // package.json. Refreshing the doc here would document features the
  // installed code doesn't have. No override — run the install first.
  if (depsEdited && !installRan) {
    const cmd = installCmd(installPm || 'pnpm')
    warn('AGENTS.md refresh skipped: package.json was updated but not installed.')
    log(`${colors.dim}Your${colors.reset} ${colors.bright}node_modules${colors.reset} ${colors.dim}is behind your${colors.reset} ${colors.bright}package.json${colors.reset}${colors.dim}. Run${colors.reset} ${colors.cyan}${cmd}${colors.reset}${colors.dim}, then re-run${colors.reset} ${colors.cyan}uniweb update${colors.reset}${colors.dim}.${colors.reset}`)
    log('')
    return 'skipped'
  }

  // Re-survey: deps may have just been edited+installed, which clears the
  // declared-deps gate.
  const finalSurvey = await surveyWorkspaceDeps(workspaceDir)
  if (finalSurvey.anyDrift && !allowMismatch) {
    warn('AGENTS.md refresh skipped: workspace deps still lag the CLI.')
    log(`${colors.dim}AGENTS.md from v${cliVersion} would document features not in your installed packages.${colors.reset}`)
    log(`${colors.dim}Re-run without ${colors.reset}${colors.cyan}--no-deps${colors.reset}${colors.dim}, or pass ${colors.reset}${colors.cyan}--allow-mismatch${colors.reset}${colors.dim} to override.${colors.reset}`)
    log('')
    if (agentsOnly) process.exit(1)
    return 'skipped'
  }

  const agentsPath = join(workspaceDir, 'AGENTS.md')
  const currentAgentsVersion = readAgentsVersion(agentsPath)
  if (currentAgentsVersion === cliVersion) {
    success(`AGENTS.md is already up to date (v${cliVersion}).`)
    return 'current'
  }

  if (dryRun) {
    info(`Dry-run: would ${currentAgentsVersion ? `update AGENTS.md (v${currentAgentsVersion} → v${cliVersion})` : `create AGENTS.md (v${cliVersion})`}.`)
    return 'skipped'
  }

  if (!hasYes && !nonInteractive && !agentsOnly) {
    const action = currentAgentsVersion
      ? `Update AGENTS.md (v${currentAgentsVersion} → v${cliVersion})?`
      : `Create AGENTS.md (v${cliVersion})?`
    const { yes } = await prompts({ type: 'confirm', name: 'yes', message: action, initial: true })
    if (!yes) {
      log(`${colors.dim}Skipped AGENTS.md.${colors.reset}`)
      return 'skipped'
    }
  }

  writeFileSync(agentsPath, generateAgentsContent())
  if (currentAgentsVersion) {
    success(`Updated AGENTS.md (v${currentAgentsVersion} → v${cliVersion}).`)
    return 'updated'
  }
  success(`Created AGENTS.md (v${cliVersion}).`)
  return 'created'
}

/** Print a compact recap of what changed, plus a review hint. */
function printSummary({ editedPaths, depsEdited, installRan, installPm, agentsResult, cliVersion }) {
  log(`${colors.bright}Summary${colors.reset}`)
  if (depsEdited) {
    log(`  ${colors.green}✓${colors.reset} package.json updated in ${editedPaths.length} file${editedPaths.length === 1 ? '' : 's'}`)
    if (installRan) {
      log(`  ${colors.green}✓${colors.reset} ${installCmd(installPm || 'pnpm')} completed`)
    } else {
      log(`  ${colors.yellow}⚠${colors.reset} install NOT run — run ${colors.cyan}${installCmd(installPm || 'pnpm')}${colors.reset} to apply`)
    }
  }
  if (agentsResult === 'created') log(`  ${colors.green}✓${colors.reset} AGENTS.md created (v${cliVersion})`)
  else if (agentsResult === 'updated') log(`  ${colors.green}✓${colors.reset} AGENTS.md updated (v${cliVersion})`)
  else if (agentsResult === 'skipped' && depsEdited) log(`  ${colors.dim}·${colors.reset} AGENTS.md not refreshed (see above)`)
  log(`${colors.dim}Review changes with${colors.reset} ${colors.cyan}git diff${colors.reset}${colors.dim}, then commit.${colors.reset}`)
  log('')
}
