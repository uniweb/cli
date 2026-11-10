/**
 * ⭐ A @uniweb/* package older than this CLI: an export the CLI imports is not there. It happens
 * when a project's CLI moves without its framework packages, and Node then says only which name is
 * missing. ⛔ Measured 2026-11-10: uniweb 1.31.6 over @uniweb/build 1.20.5 stopped every build with
 * "The requested module '@uniweb/build' does not provide an export named 'librariesOf'".
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The framework package and the export it lacks, when `err` is that failure; else null.
 *
 * @param {unknown} err - what an `import()` of a command threw
 * @returns {{ pkg: string, name: string }|null}
 */
export function staleFrameworkExport(err) {
  if (!(err instanceof SyntaxError)) return null
  const m = /module '(@uniweb\/[^'/]+)[^']*' does not provide an export named '([^']+)'/.exec(err.message || '')
  return m ? { pkg: m[1], name: m[2] } : null
}

/** The installed version of `pkg`, as this module resolves it, or null. */
export function installedVersion(pkg) {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve(pkg)))
    while (!existsSync(join(dir, 'package.json')) && dirname(dir) !== dir) dir = dirname(dir)
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}
