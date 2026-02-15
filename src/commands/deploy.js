/**
 * Deploy Command
 *
 * Deploys a built site to Uniweb hosting.
 *
 * Phase 1: Educational output only — points to alternatives.
 * Phase 4: Full deployment to Uniweb hosting.
 *
 * Usage:
 *   uniweb deploy              # Deploy to Uniweb hosting (coming soon)
 *   uniweb deploy --prod       # Deploy to production
 *   uniweb deploy --dry-run    # Show what would be deployed
 */

import { getCliPrefix } from '../utils/interactive.js'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
}

/**
 * Main deploy command handler
 */
export async function deploy(args = []) {
  console.log(`${colors.yellow}Deploy to Uniweb hosting is coming soon.${colors.reset}`)
  console.log('')
  console.log('In the meantime, deploy your site with:')
  console.log('')
  console.log(`  ${colors.bright}vercel${colors.reset}               Vercel`)
  console.log(`  ${colors.bright}netlify deploy${colors.reset}       Netlify`)
  console.log(`  Or upload ${colors.cyan}dist/${colors.reset} to any static host`)
  console.log('')
  console.log(`${colors.dim}Build your site first with \`${getCliPrefix()} build\`${colors.reset}`)
}

export default deploy
