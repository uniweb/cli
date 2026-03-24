/**
 * Login Command
 *
 * Authenticates with the Uniweb platform. Stores credentials at ~/.uniweb/auth.json.
 *
 * Flow:
 *   1. Start a temporary HTTP server on a random port
 *   2. Open the browser to {backend}/cli-auth.php?action=login&callback=http://localhost:{port}/callback
 *   3. PHP authenticates the user, signs a JWT, redirects to the callback
 *   4. CLI receives the token and stores it at ~/.uniweb/auth.json
 *   5. Falls back to token-paste if browser fails
 *
 * Usage:
 *   uniweb login
 *   uniweb login --token-paste    # Skip browser, use token paste
 */

import { createServer } from 'node:http'
import { writeAuth, readAuth, isExpired } from '../utils/auth.js'
import { getBackendUrl } from '../utils/config.js'

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
 * Try to open a URL in the default browser.
 * @param {string} url
 * @returns {Promise<boolean>} Whether the browser was opened
 */
async function openBrowser(url) {
  try {
    const { exec } = await import('node:child_process')
    const cmd = process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`

    return new Promise((resolve) => {
      exec(cmd, (err) => resolve(!err))
    })
  } catch {
    return false
  }
}

/**
 * Browser-based login flow.
 *
 * Starts a temp HTTP server, opens the browser to the PHP login page,
 * waits for the callback with the JWT token.
 *
 * @param {string} backendUrl - PHP backend URL
 * @param {number} [timeoutMs=120000] - Timeout in ms
 * @returns {Promise<{ token: string, email: string } | null>}
 */
function browserLogin(backendUrl, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`)
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const token = url.searchParams.get('token')
      const email = url.searchParams.get('email')

      if (!token) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<h2>Login failed</h2><p>No token received. Please try again.</p>')
        cleanup()
        resolve(null)
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`
        <html>
          <body style="font-family: system-ui, sans-serif; text-align: center; padding: 60px;">
            <h2 style="color: #16a34a;">Login successful!</h2>
            <p>You can close this window and return to your terminal.</p>
          </body>
        </html>
      `)
      cleanup()
      resolve({ token, email: email || '' })
    })

    let timeout

    function cleanup() {
      clearTimeout(timeout)
      server.close()
    }

    // Listen on a random port
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port
      const callbackUrl = `http://localhost:${port}/callback`
      const loginUrl = `${backendUrl}/cli-auth.php?action=login&callback=${encodeURIComponent(callbackUrl)}`

      console.log(`${colors.cyan}→${colors.reset} Opening browser for login...`)
      console.log(`  ${colors.dim}${loginUrl}${colors.reset}`)
      console.log('')

      const opened = await openBrowser(loginUrl)
      if (!opened) {
        console.log(`${colors.yellow}⚠${colors.reset} Could not open browser.`)
        console.log(`  Open this URL manually: ${colors.cyan}${loginUrl}${colors.reset}`)
      }

      console.log(`${colors.dim}Waiting for login... (${timeoutMs / 1000}s timeout)${colors.reset}`)
    })

    // Timeout
    timeout = setTimeout(() => {
      server.close()
      resolve(null)
    }, timeoutMs)

    server.on('error', () => {
      resolve(null)
    })
  })
}

/**
 * Token-paste login flow (fallback).
 * @returns {Promise<{ token: string, email: string } | null>}
 */
async function tokenPasteLogin() {
  const prompts = (await import('prompts')).default

  console.log('Paste your token from the Uniweb login page.')
  console.log('')

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
      message: 'Token:',
      validate: (v) => (v ? true : 'Token is required'),
    },
  ], {
    onCancel: () => {
      console.log('\nLogin cancelled.')
      process.exit(0)
    },
  })

  if (!response.email || !response.token) {
    return null
  }

  return { token: response.token, email: response.email }
}

/**
 * Main login command handler
 */
export async function login(args = []) {
  const forceTokenPaste = args.includes('--token-paste')

  // Check if already logged in
  const existing = await readAuth()
  if (existing && !isExpired(existing)) {
    console.log(`Already logged in as ${colors.bright}${existing.email}${colors.reset}`)
    console.log(`${colors.dim}Continuing will replace the existing session.${colors.reset}`)
    console.log('')
  }

  const backendUrl = getBackendUrl()
  let result = null

  if (!forceTokenPaste) {
    // Try browser-based login
    result = await browserLogin(backendUrl)

    if (!result) {
      console.log('')
      console.log(`${colors.yellow}⚠${colors.reset} Browser login timed out or failed.`)
      console.log(`  Falling back to token paste...`)
      console.log('')
      result = await tokenPasteLogin()
    }
  } else {
    result = await tokenPasteLogin()
  }

  if (!result) {
    error('Login cancelled.')
    process.exit(1)
  }

  // Store credentials (JWT has 30-day expiry)
  await writeAuth({
    token: result.token,
    email: result.email,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })

  console.log('')
  success(`Logged in as ${colors.bright}${result.email}${colors.reset}`)
}

export default login
