/**
 * Workspace package discovery
 *
 * Walks the workspace globs and classifies each package as a site or
 * foundation using `classifyPackage` from `@uniweb/build` — the canonical
 * classifier shared with the build pipeline. It keys on real signals
 * (site.yml for sites, generated entry for foundations) rather than which
 * `@uniweb/*` packages happen to be in dependencies, so templates whose
 * sites pull runtime transitively through the foundation (e.g., marketing)
 * are classified correctly.
 *
 * Why this lives in its own file: `@uniweb/build` is an OPTIONAL peer
 * dependency of the CLI. The CLI's startup path (`src/index.js` and
 * everything it statically imports) MUST run in environments where
 * `@uniweb/build` is not installed — `npx uniweb create` in a scratch
 * dir, `npm i -g uniweb` before any project exists, etc. Anything that
 * imports `@uniweb/build` therefore must NOT be reachable from the
 * startup graph; it must be loaded dynamically by commands that already
 * require a project context. Keeping discovery in this dedicated module
 * makes that boundary structural rather than conventional.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { classifyPackage } from '@uniweb/build'
import { readWorkspaceConfig, resolveGlob } from './config.js'

/**
 * Discover foundations in the workspace.
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<Array<{name: string, path: string}>>}
 */
export async function discoverFoundations(rootDir) {
  return discoverByKind(rootDir, 'foundation')
}

/**
 * Discover sites in the workspace.
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<Array<{name: string, path: string}>>}
 */
export async function discoverSites(rootDir) {
  return discoverByKind(rootDir, 'site')
}

async function discoverByKind(rootDir, kind) {
  const { packages } = await readWorkspaceConfig(rootDir)
  const out = []

  for (const pattern of packages) {
    const dirs = await resolveGlob(rootDir, pattern)
    for (const dir of dirs) {
      const fullPath = join(rootDir, dir)
      if (classifyPackage(fullPath) !== kind) continue

      // Read package.json for the package name. Synthesize one from
      // the directory if it's missing or malformed — we still want
      // the package to surface in pickers.
      const pkgPath = join(fullPath, 'package.json')
      let name = dir.split('/').pop()
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
          if (pkg.name) name = pkg.name
        } catch {
          // keep directory-derived name
        }
      }
      out.push({ name, path: dir })
    }
  }

  return out
}
