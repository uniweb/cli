/**
 * ⭐ IS A LOCAL FOUNDATION'S `dist/` OLDER THAN WHAT ITS BUILD READS? One rule, for every verb that
 * uses a built foundation: `uniweb build` from a site, `export`, `deploy --host` and `dev` before
 * they use it (`ensureFoundationFresh`), and `register` before it uploads it
 * (`foundationNeedsBuild`). A build reads:
 *   - the foundation's source root, the folder `package.json::main` names (`resolveFoundationSrcPath`:
 *     the package itself when flat, `src/` when nested), and what at its root shapes the build
 *     (`package.json`, a `vite.config.*`, a legacy `foundation.js` or `meta.js`, and `public/`,
 *     which Vite copies into `dist/`);
 *   - every library it bundles: any local package it depends on (`librariesOf`, `@uniweb/build`),
 *     wherever it is linked from.
 * Dot-folders, `node_modules`, and what a foundation's build writes into one (`dist/`, the
 * generated entry) are never sources. A library that is not a foundation keeps its `dist/`, which
 * may be what the foundation imports.
 *
 * A folder counts as well as its files: adding, removing or renaming a file changes its folder's
 * time and no file's, so a deleted section type or a renamed component makes the build stale too.
 * ⛔ Until 2026-11-10 only files counted, and a build kept a section type whose file was gone.
 *
 * Ties count as fresh: a build writes its output after it reads its input, so equal times mean a
 * build in the same millisecond, and on a fresh clone, where whole trees share a time, a tie
 * counted stale would rebuild every foundation once for nothing.
 *
 * ⛔ Until 2026-11-09 only the foundation's own folder was walked, and the two verbs walked it two
 * ways. Measured: with only a library's file changed, `uniweb build` kept the old `dist/`, so the
 * prerendered page showed the old component while the site's JS had the new one; and `register`
 * answered that nothing needed building. ⛔ Until 2026-10-13 `build` walked `<package>/src/`
 * whatever the layout, and a flat package's edits never made it stale.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { classifyPackage, librariesOf, resolveFoundationSrcPath } from '@uniweb/build'

// What at a foundation's root shapes its build, when its sources are in `src/`.
const ROOT_FILES = ['package.json', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.ts', 'vite.config.mts', 'foundation.js', 'meta.js']
const ROOT_FOLDERS = ['public']

// What a foundation's build writes into the foundation.
const BUILD_OUTPUT = new Set(['dist', '_entry.generated.js'])

/** The first file or folder under `dir`, `dir` itself included, newer than `builtAt`, or null. */
function newerUnder(dir, builtAt, { skipOutput }) {
  const stack = [dir]
  while (stack.length) {
    const at = stack.pop()
    try {
      if (statSync(at).mtimeMs > builtAt) return at
    } catch {
      continue
    }
    let entries
    try {
      entries = readdirSync(at, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || (skipOutput && BUILD_OUTPUT.has(e.name))) continue
      const full = join(at, e.name)
      if (e.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!e.isFile()) continue
      try {
        if (statSync(full).mtimeMs > builtAt) return full
      } catch {
        // unreadable: not newer
      }
    }
  }
  return null
}

/**
 * The first file a foundation's build reads that is newer than `builtAt`, and the library it is
 * in; null when every one is as old as the build or older.
 *
 * @param {string} foundationDir
 * @param {number} builtAt - the built entry's mtime, epoch ms
 * @returns {{ file: string, library: string|null }|null}
 */
export function newerInput(foundationDir, builtAt) {
  for (const f of ROOT_FILES) {
    const p = join(foundationDir, f)
    try {
      if (existsSync(p) && statSync(p).mtimeMs > builtAt) return { file: p, library: null }
    } catch {
      // unreadable: not newer
    }
  }
  const srcDir = resolveFoundationSrcPath(foundationDir)
  const own = newerUnder(srcDir, builtAt, { skipOutput: true })
  if (own) return { file: own, library: null }
  if (srcDir !== foundationDir) {
    for (const f of ROOT_FOLDERS) {
      const p = join(foundationDir, f)
      const file = existsSync(p) ? newerUnder(p, builtAt, { skipOutput: false }) : null
      if (file) return { file, library: null }
    }
  }
  for (const { name, dir } of librariesOf(foundationDir)) {
    const file = newerUnder(dir, builtAt, { skipOutput: classifyPackage(dir) === 'foundation' })
    if (file) return { file, library: name }
  }
  return null
}
