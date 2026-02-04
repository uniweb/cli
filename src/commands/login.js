/**
 * `uniweb login` — mock authentication for the local registry.
 *
 * Prompts for email, generates a mock token, writes .unicloud/auth.json.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import prompts from 'prompts'
import { getAuthPath } from '../registry/paths.js'

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

export async function login() {
  const authPath = getAuthPath()

  // Check if already logged in
  if (existsSync(authPath)) {
    try {
      const existing = JSON.parse(await readFile(authPath, 'utf8'))
      if (existing.email && existing.token) {
        console.log(`Already logged in as ${colors.cyan}${existing.email}${colors.reset}`)
        const { confirm } = await prompts({
          type: 'confirm',
          name: 'confirm',
          message: 'Log in with a different account?',
          initial: false,
        }, {
          onCancel: () => process.exit(0),
        })
        if (!confirm) return
      }
    } catch {
      // Corrupted auth file — proceed with new login
    }
  }

  const { email } = await prompts({
    type: 'text',
    name: 'email',
    message: 'Email:',
    validate: (v) => (v && v.includes('@') ? true : 'Please enter a valid email'),
  }, {
    onCancel: () => {
      console.log('\nLogin cancelled.')
      process.exit(0)
    },
  })

  if (!email) {
    process.exit(1)
  }

  // Generate mock token
  const payload = JSON.stringify({ email, iat: Date.now() })
  const token = 'uwt_' + Buffer.from(payload).toString('base64url')

  // Write auth file
  await mkdir(dirname(authPath), { recursive: true })
  await writeFile(authPath, JSON.stringify({ token, email }, null, 2))

  console.log(`${colors.green}✓${colors.reset} Logged in as ${colors.cyan}${email}${colors.reset}`)
  console.log(`${colors.dim}  Auth saved to ${authPath}${colors.reset}`)
}
