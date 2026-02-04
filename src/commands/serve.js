/**
 * `uniweb serve` — HTTP server for the local registry.
 *
 * Serves published foundations at /{name}@{version}/{filepath}
 * with CORS headers so foundations can be loaded via import().
 *
 * Default port: 4000 (configurable via --port).
 */

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { getRegistryDir, sanitizeName } from '../registry/paths.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
}

const MIME_TYPES = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export async function serve(args = []) {
  // Parse --port flag
  let port = 4000
  const portIdx = args.indexOf('--port')
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`${colors.red}✗${colors.reset} Invalid port number`)
      process.exit(1)
    }
  }

  const registryDir = getRegistryDir()
  const indexPath = join(registryDir, 'index.json')

  if (!existsSync(indexPath)) {
    console.error(`${colors.red}✗${colors.reset} No packages published yet`)
    console.log(`  Run ${colors.cyan}uniweb publish${colors.reset} from a foundation directory first.`)
    process.exit(1)
  }

  // Read index to list available packages
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  const packagesDir = join(registryDir, 'packages')

  const server = createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      res.end('Method not allowed')
      return
    }

    const url = new URL(req.url, `http://localhost:${port}`)
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '')

    if (!pathname) {
      // Root — return index listing
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(index, null, 2))
      return
    }

    // Parse: {name}@{version}/{filepath}
    const atIdx = pathname.indexOf('@', pathname.startsWith('@') ? 1 : 0)
    if (atIdx === -1) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Invalid path. Expected: /{name}@{version}/{file}')
      return
    }

    const name = pathname.slice(0, atIdx)
    const rest = pathname.slice(atIdx + 1)
    const slashIdx = rest.indexOf('/')
    if (slashIdx === -1) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Invalid path. Expected: /{name}@{version}/{file}')
      return
    }

    const version = rest.slice(0, slashIdx)
    const filepath = rest.slice(slashIdx + 1)

    if (!name || !version || !filepath) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Invalid path. Expected: /{name}@{version}/{file}')
      return
    }

    const safeName = sanitizeName(name)
    const fullPath = join(packagesDir, safeName, version, filepath)

    // Security: prevent path traversal
    const resolved = join(packagesDir, safeName, version)
    if (!fullPath.startsWith(resolved)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Forbidden')
      return
    }

    try {
      const fileStat = await stat(fullPath)
      if (!fileStat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }

      const ext = extname(fullPath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      const content = await readFile(fullPath)

      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
    }
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`${colors.red}✗${colors.reset} Port ${port} is already in use`)
      console.log(`  Try a different port: ${colors.cyan}uniweb serve --port 4001${colors.reset}`)
      process.exit(1)
    }
    throw err
  })

  server.listen(port, () => {
    console.log(`${colors.green}✓${colors.reset} Registry server running at ${colors.cyan}http://localhost:${port}${colors.reset}`)
    console.log('')

    // List available packages
    const names = Object.keys(index)
    if (names.length === 0) {
      console.log(`${colors.dim}  No packages published yet.${colors.reset}`)
    } else {
      console.log(`${colors.bright}Available packages:${colors.reset}`)
      console.log('')
      for (const name of names) {
        const versions = Object.keys(index[name].versions || {})
        for (const v of versions) {
          console.log(`  ${colors.cyan}http://localhost:${port}/${name}@${v}/foundation.js${colors.reset}`)
        }
      }
    }

    console.log('')
    console.log(`${colors.dim}Press Ctrl+C to stop.${colors.reset}`)
  })

  // Keep process alive
  await new Promise(() => {})
}
