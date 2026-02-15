/**
 * Login Command
 *
 * Authenticates with the Uniweb platform. Stores credentials at ~/.uniweb/auth.json.
 *
 * Phase 1: Token-paste flow only.
 * Phase 2: Browser-based OAuth with token-paste fallback.
 *
 * Usage:
 *   uniweb login
 */

import prompts from 'prompts'
import { writeAuth, readAuth, isExpired } from '../utils/auth.js'

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

/**
 * Main login command handler
 */
export async function login(args = []) {
  // Check if already logged in
  const existing = await readAuth()
  if (existing && !isExpired(existing)) {
    console.log(`Already logged in as ${colors.bright}${existing.email}${colors.reset}`)
    console.log(`${colors.dim}Run \`uniweb login\` again to switch accounts.${colors.reset}`)
    console.log('')
  }

  console.log('Log in to your Uniweb account at uniweb.app.')
  console.log('')

  // Phase 1: token-paste flow
  const response = await prompts([
    {
      type: 'text',
      name: 'email',
      message: 'Email:',
      validate: (v) => (v && v.includes('@') ? true : 'Enter a valid email'),
    },
    {
      type: 'password',
      name: 'token',
      message: 'Token (from uniweb.app/cli-login):',
      validate: (v) => (v ? true : 'Token is required'),
    },
  ], {
    onCancel: () => {
      console.log('\nLogin cancelled.')
      process.exit(0)
    },
  })

  if (!response.email || !response.token) {
    error('Login cancelled.')
    process.exit(1)
  }

  // Store credentials
  await writeAuth({
    token: response.token,
    email: response.email,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })

  console.log('')
  success(`Logged in as ${colors.bright}${response.email}${colors.reset}`)
}

export default login
