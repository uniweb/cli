/**
 * ⭐ THE TYPES A FOUNDATION NAMES THAT A LIBRARY DEFINES ARE REGISTERED WITH IT. A foundation is
 * released only once the data types it names are registered: the registry refuses one that names a
 * Model it doesn't hold. A type a library defines is read by the foundation's build from that
 * library's `schemas/` (`workspaceTypeFiles`), so `register` in the foundation registers it from
 * there first, and `push` and `publish`, which release a site's foundation with `register`, do too
 * *[Diego, 2026-11-10: "yes, push and publish should register a library's types automatically"]*.
 *
 * A library here is what the build read the type from, in the build's order: a type
 * `schemas.config.js` routes is read from where the route says, so it is no library's; otherwise the
 * one schemas package (`isSchemasPackage`, not a foundation) that gives the type's scope and holds
 * it, bundled by the foundation, a package of its workspace, or one inside the foundation's own
 * folder. A type another FOUNDATION defines is registered when that foundation is, and a refused
 * release names it (`unregistered-types.js`).
 *
 * ⚖️ Each library sends the types the foundation names from it, the ones its types reference among
 * them, and nothing else: its other files may be another package's to register, or a copy of one the
 * foundation defines. A changed definition replaces the registered one, which every site naming the
 * type then reads, and the registry judges the change: one records of the type can't take it refuses
 * (`destructive_republish`), and the release stops there. Libraries go in the order their types
 * reference each other, a referenced one first, since the registry refuses a reference to a Model it
 * doesn't hold yet.
 */

import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { collectNestedRefs } from '@uniweb/schemas/format'

const real = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** The package `file` is in: the nearest folder above it with a package.json. */
function packageDirOf(file) {
  for (let at = dirname(resolve(file)); ; at = dirname(at)) {
    if (existsSync(join(at, 'package.json'))) return at
    if (dirname(at) === at) return null
  }
}

/** Libraries in an order where one whose types another's reference comes before it; else as found. */
function referencedFirst(libraries, schemas) {
  const holder = new Map()
  for (const lib of libraries) for (const ref of lib.refs) holder.set(ref, lib)
  const before = new Map(libraries.map((lib) => [lib, new Set()]))
  for (const lib of libraries) {
    for (const ref of lib.refs) {
      for (const target of collectNestedRefs(schemas[ref] || {})) {
        const other = holder.get(target)
        if (other && other !== lib) before.get(lib).add(other)
      }
    }
  }
  const out = []
  const placed = new Set()
  const place = (lib, path = new Set()) => {
    if (placed.has(lib) || path.has(lib)) return
    path.add(lib)
    for (const other of before.get(lib)) place(other, path)
    placed.add(lib)
    out.push(lib)
  }
  for (const lib of libraries) place(lib)
  return out
}

/**
 * The libraries that define types the foundation names, each once, with the types it names from
 * each, in the order they register in. A type its own `schemas/` defines (`@/x`), one nothing local
 * defines, one two packages define (which the build refused) and one `schemas.config.js` routes are
 * left out.
 *
 * @param {object} o
 * @param {Record<string, object>} o.schemas - the foundation's built `dataSchemas`: every type it
 *   names, with its definition
 * @param {string} o.foundationDir
 * @returns {Promise<Array<{ dir: string, scope: string, refs: string[] }>>}
 * @throws {Error} `code: 'BUILD_TOO_OLD'` when the installed `@uniweb/build` can't tell
 */
export async function typesFromLibraries({ schemas, foundationDir }) {
  const build = await import('@uniweb/build')
  const { workspaceTypeFiles, packageTypeScope, classifyPackage, isSchemasPackage, routedSchema, resolveFoundationSrcPath } = build
  if ([workspaceTypeFiles, packageTypeScope, routedSchema].some((fn) => typeof fn !== 'function')) {
    throw Object.assign(new Error('the installed @uniweb/build cannot tell which library defines a type'), { code: 'BUILD_TOO_OLD' })
  }
  const srcDir = resolveFoundationSrcPath(foundationDir)
  const own = real(foundationDir)
  const byDir = new Map()
  for (const ref of Object.keys(schemas || {})) {
    // `@uniweb` is reserved, and nothing registers under it.
    if (!/^@[^/]+\/./.test(ref) || ref.startsWith('@uniweb/')) continue
    if (await routedSchema(ref, srcDir).catch(() => false)) continue
    const files = await workspaceTypeFiles(ref, foundationDir).catch(() => [])
    if (files.length !== 1) continue
    const dir = packageDirOf(files[0])
    if (!dir || real(dir) === own) continue
    if (classifyPackage(dir) === 'foundation' || !isSchemasPackage(dir)) continue
    const scope = await packageTypeScope(dir, 'schemas')
    if (!scope) continue
    if (!byDir.has(dir)) byDir.set(dir, { dir, scope, refs: [] })
    byDir.get(dir).refs.push(ref)
  }
  return referencedFirst([...byDir.values()], schemas || {})
}
