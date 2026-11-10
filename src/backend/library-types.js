/**
 * ⭐ THE TYPES A FOUNDATION NAMES THAT A LIBRARY DEFINES ARE REGISTERED WITH IT. A foundation is
 * released only once the data types it names are registered: the registry refuses one that names a
 * Model it doesn't hold. A type a library defines is read by the foundation's build from that
 * library's `schemas/` (`workspaceTypeFiles`), so `register` in the foundation registers it from
 * there first, and `push` and `publish`, which release a site's foundation with `register`, do too
 * *[Diego, 2026-11-10: "yes, push and publish should register a library's types automatically"]*.
 *
 * A library here is what the build read the type from: a schemas package (`isSchemasPackage`, not a
 * foundation) outside the foundation that gives its scope, bundled by the foundation or a package of
 * its workspace. A type another FOUNDATION defines is registered when that foundation is, and a
 * refused release names it (`unregistered-types.js`).
 *
 * ⚖️ Registered whole, as `uniweb register` in the library would: what is unchanged the registry
 * answers as such, and a changed definition replaces the registered one, which every site naming the
 * type then reads. The registry judges the change: one it can't make where records of the type are
 * kept it refuses (`destructive_republish`), and the release stops there.
 */

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

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
 * The libraries that define types the foundation names, each once, with the types it names from
 * each. A type its own `schemas/` defines (`@/x`), one nothing local defines, and one two packages
 * define (which the build refused) are left out.
 *
 * @param {object} o
 * @param {string[]} o.named - every type the foundation names (its schema's `dataSchemas`)
 * @param {string} o.foundationDir
 * @returns {Promise<Array<{ dir: string, scope: string, refs: string[] }>>} in the order named
 */
export async function typesFromLibraries({ named, foundationDir }) {
  const { workspaceTypeFiles, packageTypeScope, classifyPackage, isSchemasPackage } = await import('@uniweb/build')
  if (typeof workspaceTypeFiles !== 'function' || typeof packageTypeScope !== 'function') return []
  const byDir = new Map()
  for (const ref of named) {
    // `@uniweb` is reserved, and nothing registers under it.
    if (!/^@[^/]+\/./.test(ref) || ref.startsWith('@uniweb/')) continue
    const files = await workspaceTypeFiles(ref, foundationDir).catch(() => [])
    if (files.length !== 1) continue
    const dir = packageDirOf(files[0])
    if (!dir || within(foundationDir, dir)) continue
    if (classifyPackage(dir) === 'foundation' || !isSchemasPackage(dir)) continue
    const scope = await packageTypeScope(dir, 'schemas')
    if (!scope) continue
    if (!byDir.has(dir)) byDir.set(dir, { dir, scope, refs: [] })
    byDir.get(dir).refs.push(ref)
  }
  return [...byDir.values()]
}
