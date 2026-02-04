/**
 * `uniweb publish` — publish the current foundation to the local registry.
 *
 * 1. Verify this is a foundation (src/foundation.js exists)
 * 2. Check auth
 * 3. Auto-build if dist/ is missing
 * 4. Read name + version from dist/schema.json
 * 5. Reject duplicates
 * 6. Copy dist/ to registry
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { getAuthPath } from '../registry/paths.js'
import { createRegistry } from '../registry/index.js'
import { build } from './build.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
}

export async function publish() {
  const cwd = process.cwd()

  // 1. Must be a foundation
  const foundationSrc = resolve(cwd, 'src/foundation.js')
  if (!existsSync(foundationSrc)) {
    console.error(`${colors.red}✗${colors.reset} Not a foundation directory (no src/foundation.js)`)
    console.log(`${colors.dim}  Run this command from a foundation package directory.${colors.reset}`)
    process.exit(1)
  }

  // 2. Check auth
  const authPath = getAuthPath()
  if (!existsSync(authPath)) {
    console.error(`${colors.red}✗${colors.reset} Not logged in`)
    console.log(`  Run ${colors.cyan}uniweb login${colors.reset} first.`)
    process.exit(1)
  }

  let auth
  try {
    auth = JSON.parse(await readFile(authPath, 'utf8'))
  } catch {
    console.error(`${colors.red}✗${colors.reset} Invalid auth file. Run ${colors.cyan}uniweb login${colors.reset} again.`)
    process.exit(1)
  }

  // 3. Auto-build if needed
  const distDir = resolve(cwd, 'dist')
  const foundationJs = join(distDir, 'foundation.js')
  const schemaJson = join(distDir, 'schema.json')

  if (!existsSync(foundationJs) || !existsSync(schemaJson)) {
    console.log(`${colors.yellow}⚠${colors.reset} No build found. Building foundation...`)
    console.log('')
    await build(['--target', 'foundation'])
    console.log('')

    // Verify build succeeded
    if (!existsSync(foundationJs) || !existsSync(schemaJson)) {
      console.error(`${colors.red}✗${colors.reset} Build did not produce dist/foundation.js and dist/schema.json`)
      process.exit(1)
    }
  }

  // 4. Read name and version from schema.json
  let schema
  try {
    schema = JSON.parse(await readFile(schemaJson, 'utf8'))
  } catch (err) {
    console.error(`${colors.red}✗${colors.reset} Failed to read dist/schema.json: ${err.message}`)
    process.exit(1)
  }

  const name = schema._self?.name
  const version = schema._self?.version

  if (!name || !version) {
    console.error(`${colors.red}✗${colors.reset} dist/schema.json missing _self.name or _self.version`)
    console.log(`${colors.dim}  Ensure your package.json has "name" and "version" fields.${colors.reset}`)
    process.exit(1)
  }

  // 5. Check for duplicates
  const registry = createRegistry()

  if (await registry.exists(name, version)) {
    console.error(`${colors.red}✗${colors.reset} ${colors.bright}${name}@${version}${colors.reset} already exists in the registry`)
    console.log(`${colors.dim}  Bump the version in package.json and rebuild, then publish again.${colors.reset}`)
    process.exit(1)
  }

  // 6. Publish
  await registry.publish(name, version, distDir, {
    publishedBy: auth.email,
  })

  console.log(`${colors.green}✓${colors.reset} Published ${colors.bright}${name}@${version}${colors.reset}`)
  console.log('')
  console.log(`  Start the registry server:`)
  console.log(`    ${colors.cyan}uniweb serve${colors.reset}`)
  console.log('')
  console.log(`  Then reference in site.yml:`)
  console.log(`    ${colors.dim}extensions:${colors.reset}`)
  console.log(`    ${colors.dim}  - http://localhost:4000/${name}@${version}/foundation.js${colors.reset}`)
}
