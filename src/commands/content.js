/**
 * Content Command — `uniweb content export`
 *
 * Packages a site project (or a built foundation's schema) as a `.uwx`
 * entity package — the Uniweb exchange format — for import into Uniweb.
 * No JS/HTML: pure content / declarative data.
 *
 *   uniweb content export                 Package the site in the cwd
 *   uniweb content export <dir>           Package a specific site/foundation
 *   uniweb content export -o team.uwx     Choose the output filename
 *   uniweb content export --no-sidecar    Mint fresh ids (submit-once;
 *                                         default is the syncable round trip,
 *                                         persisting ids in .uniweb/uwx-ids.json)
 *   uniweb content export --dry-run       Print a summary; write nothing
 *   uniweb content export --source-locale fr   Wrap single-language fields under
 *                                              this locale (default: en)
 *
 * A site dir is detected by `site.yml`; a foundation by a built
 * `dist/meta/schema.json` (run `uniweb build` first for a foundation).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}!${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

function usage() {
  console.log(`
${c.cyan}uniweb content export${c.reset} [dir] [options]

  Package a site project (or built foundation schema) as a .uwx entity
  package for import into Uniweb.

  ${c.dim}-o, --output <file>${c.reset}      Output path (default: <name>.uwx)
  ${c.dim}--no-sidecar${c.reset}             Mint fresh ids (submit-once) instead of
                           the syncable round trip
  ${c.dim}--dry-run${c.reset}                Print a summary; write nothing
  ${c.dim}--source-locale <code>${c.reset}   Locale for single-language fields (default: en)
`)
}

export async function content(args = []) {
  const sub = args[0]
  if (!sub || sub === '--help' || sub === '-h') {
    usage()
    return
  }
  if (sub === 'export') {
    await contentExport(args.slice(1))
    return
  }
  say.err(`Unknown subcommand: content ${sub}`)
  usage()
  process.exit(1)
}

async function contentExport(args) {
  const { readFlagValue } = await import('../utils/args.js')
  const dryRun = args.includes('--dry-run')
  const noSidecar = args.includes('--no-sidecar')
  const sourceLocale = readFlagValue(args, '--source-locale') || undefined
  let output = readFlagValue(args, '-o')
  if (!output || output === true) output = readFlagValue(args, '--output')
  const dir = resolve(
    args.find((a) => !a.startsWith('-') && a !== output) || process.cwd()
  )

  const isSite = existsSync(join(dir, 'site.yml'))
  const schemaPath = join(dir, 'dist', 'meta', 'schema.json')
  const isFoundation = !isSite && existsSync(schemaPath)

  if (!isSite && !isFoundation) {
    say.err(`No site.yml or built dist/meta/schema.json found in ${dir}`)
    say.dim('Point at a site directory, or `uniweb build` a foundation first.')
    process.exit(1)
  }

  const uwx = await import('@uniweb/build/uwx')
  // --dry-run must have zero side effects: mint ids (no sidecar file).
  const useSidecar = !dryRun && !noSidecar

  let buf
  let defaultName
  try {
    if (isSite) {
      say.info(`Packaging site → @uniweb/site-content (.uwx)…`)
      // Nested $-document on the sync lane. The sidecar is read-only here: it
      // supplies $uuids a prior sync recorded (the backend mints, never this
      // export), so a fresh project exports a uuid-less document.
      buf = await uwx.emitSiteSyncPackage(dir, {
        sidecar: useSidecar, // read <dir>/.uniweb/uwx-ids.json if present
        sourceLocale,
      })
      defaultName = basename(dir)
    } else {
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
      say.info(`Packaging foundation schema → @uniweb/foundation-schema (.uwx)…`)
      buf = uwx.emitFoundationSchemaPackage(schema, {
        sidecar: useSidecar ? join(dir, uwx.SIDECAR_RELPATH) : undefined,
        foundationDir: dir,
        sourceLocale,
      })
      defaultName = (schema?._self?.name || basename(dir)).replace(
        /[^a-z0-9._-]+/gi,
        '-'
      )
    }
  } catch (err) {
    say.err(err.message)
    process.exit(1)
  }

  // Structural summary (not an import simulation). The entity file is located
  // via the manifest index, which works for both lanes: the register lane
  // (foundation schema, flat `items[]`) and the sync lane (site, nested
  // `$`-document).
  const files = uwx.readZip(buf)
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'))
  const entityFile = manifest.entries?.[0]?.file
  const entity = JSON.parse(files.get(entityFile).toString('utf8'))
  const counts = {}
  if (Array.isArray(entity.items)) {
    // Flat register lane: one item per section occurrence.
    for (const it of entity.items) {
      counts[it.section] = (counts[it.section] || 0) + 1
    }
  } else {
    // Nested sync lane: count records per top-level section, recursing into
    // self-nested `$children` and inline `page_sections`.
    const countPages = (pages) => {
      let p = 0
      let s = 0
      for (const page of pages || []) {
        p++
        s += (page.page_sections || []).length
        const sub = countPages(page.$children)
        p += sub.p
        s += sub.s
      }
      return { p, s }
    }
    if (entity.info) counts.info = 1
    const pg = countPages(entity.pages)
    if (pg.p) counts.pages = pg.p
    if (pg.s) counts.page_sections = pg.s
    if (entity.layout_sections?.length) counts.layout_sections = entity.layout_sections.length
    if (entity.extensions?.length) counts.extensions = entity.extensions.length
    if (entity.collections?.length) counts.collections = entity.collections.length
  }

  console.log('')
  say.dim(`subtype       ${manifest.subtype}  (format ${manifest.format})`)
  say.dim(
    `type          ${manifest.models_required[0].name_at_export} ${manifest.models_required[0].uuid}`
  )
  say.dim(`entity        ${entity.uuid || entity.$uuid || entity.$id}`)
  say.dim(
    `items         ${Object.entries(counts)
      .map(([s, n]) => `${s}:${n}`)
      .join('  ')}`
  )
  say.dim(`package_sha256 ${manifest.package_sha256.slice(0, 16)}…`)
  say.dim(`size          ${(buf.length / 1024).toFixed(1)} KiB`)
  console.log('')

  if (dryRun) {
    say.ok('Dry run — nothing written.')
    return
  }

  const outPath = resolve(output || `${defaultName}.uwx`)
  writeFileSync(outPath, buf)
  say.ok(`Wrote ${c.cyan}${outPath}${c.reset}`)
  // Only the register lane (foundation schema) mints + persists ids locally. The
  // site sync lane reads the sidecar read-only — the backend mints on sync — so
  // there is nothing to persist here for a site.
  if (useSidecar && isFoundation) {
    say.dim(
      `ids persisted in ${uwx.SIDECAR_RELPATH} — commit it so re-exports update, not duplicate.`
    )
  }
  console.log('')
  say.warn('v0 scope: media bytes, collection records, and @-nested section')
  say.dim('hierarchy are not yet carried (documented).')
}
