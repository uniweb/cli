/**
 * uniweb update - Update generated project files
 *
 * Regenerates AGENTS.md from the installed CLI version.
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findWorkspaceRoot } from '../utils/workspace.js'
import { readAgentsVersion, generateAgentsContent } from '../utils/agents-stamp.js'
import { getCliVersion } from '../versions.js'

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
}

const success = (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`)
const warn = (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`)
const error = (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`)
const log = console.log

export async function update(args = []) {
  const workspaceDir = findWorkspaceRoot(process.cwd())

  if (!workspaceDir) {
    error('Not in a Uniweb workspace')
    log(`${colors.dim}Run this command from your project root or a package directory.${colors.reset}`)
    process.exit(1)
  }

  const cliVersion = getCliVersion()
  const agentsPath = join(workspaceDir, 'AGENTS.md')
  const currentVersion = readAgentsVersion(agentsPath)

  if (currentVersion === cliVersion) {
    success(`AGENTS.md is already up to date (v${cliVersion})`)
    return
  }

  const content = generateAgentsContent()
  writeFileSync(agentsPath, content)

  if (currentVersion) {
    success(`Updated AGENTS.md (v${currentVersion} → v${cliVersion})`)
  } else {
    success(`Created AGENTS.md (v${cliVersion})`)
  }
}
