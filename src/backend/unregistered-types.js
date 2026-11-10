/**
 * ⭐ THE TYPES A FOUNDATION NAMES THAT ANOTHER LOCAL PACKAGE DEFINES, AND THE REGISTRY DOESN'T HOLD.
 * A foundation is released only once the data types it names are registered: the registry refuses
 * one that depends on a Model it doesn't have. A type a library or another foundation of the workspace
 * defines is registered from that package, with `uniweb register` there. Measured 2026-11-10 on a
 * local backend: a site's push released its foundation, which names `@acme/libplan` from a library it
 * bundles, and the registry answered 400, "no such data-schema is registered on this deployment and
 * this package does not publish one"; after `uniweb register` in the library, the push went through.
 */

import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path'

const within = (dir, path) => {
  const rel = relative(resolve(dir), resolve(path))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** The package `file` is in: the nearest folder above it with a package.json. */
function packageDirOf(file) {
  for (let at = dirname(resolve(file)); ; at = dirname(at)) {
    if (existsSync(join(at, 'package.json'))) return at
    if (dirname(at) === at) return null
  }
}

/**
 * Each type `named` that the foundation does not define, that one other local package does, and that
 * the registry answers it does not hold (`readDataSchema` → null). A type the registry could not be
 * asked about is left out: this explains a refusal, and says nothing it could not check.
 *
 * @param {object} o
 * @param {string[]} o.named - every type the foundation names (its schema's `dataSchemas`)
 * @param {string[]} o.defined - the ones it defines, which its register sends
 * @param {string} o.foundationDir
 * @param {{ readDataSchema(name: string): Promise<object|null> }} o.client
 * @returns {Promise<Array<{ ref: string, dir: string }>>} each type and the folder of the package that defines it
 */
export async function unregisteredLocalTypes({ named, defined, foundationDir, client }) {
  const { workspaceTypeFiles } = await import('@uniweb/build')
  if (typeof workspaceTypeFiles !== 'function') return []
  const out = []
  for (const ref of named) {
    if (defined.includes(ref) || /^@(?:std|uniweb)\//.test(ref)) continue
    const files = await workspaceTypeFiles(ref, foundationDir).catch(() => [])
    if (files.length !== 1) continue
    const dir = packageDirOf(files[0])
    if (!dir || within(foundationDir, dir)) continue
    const held = await client.readDataSchema(ref).catch(() => undefined)
    if (held === null) out.push({ ref, dir })
  }
  return out
}
