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

  ${c.dim}-o, --output <file>${c.reset}      Output path (default: <name>.entity.uwx)
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
      buf = await uwx.emitSitePackage(dir, {
        sidecar: useSidecar, // <dir>/.uniweb/uwx-ids.json
        sourceLocale,
      })
      defaultName = basename(dir)
    } else {
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
      say.info(`Packaging foundation → @uniweb/foundation (.uwx)…`)
      buf = uwx.emitFoundationPackage(schema, {
        sidecar: useSidecar ? join(dir, uwx.SIDECAR_RELPATH) : undefined,
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

  // Structural summary (not an import simulation).
  const files = uwx.readZip(buf)
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'))
  const entity = JSON.parse(
    files.get(`entities/${manifest.roots[0]}.json`).toString('utf8')
  )
  const counts = {}
  for (const it of entity.items) {
    counts[it.section] = (counts[it.section] || 0) + 1
  }

  console.log('')
  say.dim(`subtype       ${manifest.subtype}  (format ${manifest.format})`)
  say.dim(
    `model         ${manifest.models_required[0].name_at_export} ${manifest.models_required[0].uuid}`
  )
  say.dim(`entity        ${entity.uuid}`)
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

  const outPath = resolve(output || `${defaultName}.entity.uwx`)
  writeFileSync(outPath, buf)
  say.ok(`Wrote ${c.cyan}${outPath}${c.reset}`)
  if (useSidecar) {
    say.dim(
      `ids persisted in ${uwx.SIDECAR_RELPATH} — commit it so re-exports update, not duplicate.`
    )
  }
  console.log('')
  say.warn('v0 scope: media bytes, collection records, and @-nested section')
  say.dim('hierarchy are not yet carried (documented).')
}
