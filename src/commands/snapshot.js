/**
 * Snapshot Command
 *
 * Captures a site in a real browser and composes a preview image from the
 * captures — by default the site's card image, recorded as `preview:` in
 * site.yml.
 *
 * The capturing and composing is `@uniweb/snapshot`, a separate package so that
 * nobody who never takes a snapshot installs a browser driver. This command finds
 * the site, puts it behind a URL, and records the result:
 *
 *   uniweb snapshot                 build the site, serve dist/, capture it
 *   uniweb snapshot --dev           capture the site's Vite dev server (no build)
 *   uniweb snapshot --url <url>     capture a site that is already running
 *
 * The layout is chosen from the page: one that scrolls gets `split` (the first
 * view in a browser window, overlapped by a long strip of the page); one that
 * does not — a documentation shell, an app — gets `device` (desktop and phone).
 *
 * `preview:` is written only when site.yml has none, or holds the app's generated
 * token. An address the author wrote is never replaced.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { upsertYamlScalar } from '@uniweb/build/uwx'

import { didYouMean } from '../utils/args.js'
import { humanBytes } from '../utils/bytes.js'
import { discoverSites } from '../utils/discover.js'
import { detectWorkspacePm } from '../utils/pm.js'
import { isAuthoredPreview } from '../utils/preview.js'
import { findWorkspaceRoot } from '../utils/workspace.js'

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const VALUE_FLAGS = ['--site', '--url', '--route', '--layout', '--tone', '--size', '--scale', '--quality', '--out', '--hide']
const BOOLEAN_FLAGS = ['--dev', '--no-build', '--no-set-preview']
const GLOBAL_FLAGS = ['--non-interactive', '--help', '-h']
const ALL_FLAGS = [...VALUE_FLAGS, ...BOOLEAN_FLAGS, ...GLOBAL_FLAGS]

export const DEFAULT_OUTPUT = join('public', 'preview.webp')

class UsageError extends Error {}

const camel = (flag) => flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())

/**
 * Parse `uniweb snapshot` arguments. Throws a UsageError naming the first problem.
 *
 * @param {string[]} args
 */
export function parseSnapshotArgs(args = []) {
  const options = { hide: [], positionals: [] }
  for (let i = 0; i < args.length; i++) {
    const raw = args[i]
    if (raw === '--') {
      options.positionals.push(...args.slice(i + 1))
      break
    }
    if (!raw.startsWith('-') || raw === '-') {
      options.positionals.push(raw)
      continue
    }
    const eq = raw.indexOf('=')
    const name = eq === -1 ? raw : raw.slice(0, eq)
    if (VALUE_FLAGS.includes(name)) {
      const value = eq === -1 ? args[++i] : raw.slice(eq + 1)
      if (value === undefined || value === '' || (eq === -1 && value.startsWith('--'))) {
        throw new UsageError(`\`${name}\` needs a value.`)
      }
      if (name === '--hide') options.hide.push(value)
      else options[camel(name)] = value
    } else if (BOOLEAN_FLAGS.includes(name)) {
      options[camel(name)] = true
    } else if (!GLOBAL_FLAGS.includes(name)) {
      const suggestion = didYouMean(name, ALL_FLAGS)
      throw new UsageError(
        `Unknown flag \`${name}\` for \`uniweb snapshot\`.` + (suggestion ? ` Did you mean \`${suggestion}\`?` : '')
      )
    }
  }

  if (options.dev && options.url) throw new UsageError('Pass `--dev` or `--url`, not both.')
  if (options.layout && !['auto', 'split', 'device'].includes(options.layout)) {
    throw new UsageError('`--layout` is auto, split or device.')
  }
  if (options.tone && !['auto', 'light', 'deep'].includes(options.tone)) {
    throw new UsageError('`--tone` is auto, light or deep.')
  }
  if (options.size !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(options.size)
    const [width, height] = match ? [Number(match[1]), Number(match[2])] : []
    if (!match || width < 320 || height < 200 || width > 4096 || height > 4096) {
      throw new UsageError('`--size` is WIDTHxHEIGHT, e.g. 1600x1000 (320–4096 wide, 200–4096 tall).')
    }
    options.canvas = { width, height }
  }
  if (options.scale !== undefined) {
    if (!['1', '2'].includes(options.scale)) throw new UsageError('`--scale` is 1 or 2.')
    options.scale = Number(options.scale)
  }
  if (options.quality !== undefined) {
    const quality = Number(options.quality)
    if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
      throw new UsageError('`--quality` is a whole number from 1 to 100.')
    }
    options.quality = quality
  }
  return options
}

/**
 * The `preview:` value that names `output`, or null when it cannot be named — an
 * image outside the site's `public/` folder has no site-root path.
 */
export function previewValueFor(siteDir, output) {
  const rel = relative(join(siteDir, 'public'), output)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return '/' + rel.split(sep).join('/')
}

/**
 * What to do with site.yml's `preview:` given the value we would write.
 * @returns {'set'|'unchanged'|'replace'|'keep'}
 */
export function previewDecision(current, next) {
  if (current === undefined || current === null || current === '') return 'set'
  if (current === next) return 'unchanged'
  return isAuthoredPreview(current) ? 'keep' : 'replace'
}

/** The site the command applies to: named, else the one containing cwd, else the only one. */
export function pickSite(sites, rootDir, { requested, cwd }) {
  if (requested) {
    return { site: sites.find((s) => s.name === requested || s.path === requested) ?? null }
  }
  const containing = sites.find((s) => {
    const rel = relative(join(rootDir, s.path), cwd)
    return !rel.startsWith('..') && !isAbsolute(rel)
  })
  if (containing) return { site: containing }
  return { site: sites[0] ?? null, ambiguous: sites.length > 1 }
}

/** Import `@uniweb/snapshot` from the site, the workspace, or next to this CLI. */
async function loadSnapshotPackage(dirs) {
  for (const dir of dirs) {
    if (!dir) continue
    let entry
    try {
      entry = createRequire(join(dir, 'package.json')).resolve('@uniweb/snapshot')
    } catch {
      continue
    }
    return import(pathToFileURL(entry).href)
  }
  try {
    return await import('@uniweb/snapshot')
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') return null
    throw err
  }
}

function installHint(rootDir) {
  switch (detectWorkspacePm(rootDir)) {
    case 'npm':
      return 'npm install --save-dev @uniweb/snapshot'
    case 'yarn':
      return 'yarn add --dev -W @uniweb/snapshot'
    default:
      return 'pnpm add -D -w @uniweb/snapshot'
  }
}

/**
 * `uniweb build` in the site, with this same CLI. Its output is held back and
 * shown only if it fails: on success it ends in shipping advice that has nothing
 * to do with taking a snapshot.
 */
function runBuild(siteDir) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [process.argv[1], 'build'], {
      cwd: siteDir,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const output = []
    child.stdout.on('data', (chunk) => output.push(chunk))
    child.stderr.on('data', (chunk) => output.push(chunk))
    child.on('error', fail)
    child.on('close', (code) => {
      if (code === 0) return done()
      process.stderr.write(Buffer.concat(output))
      fail(new Error(`The site build failed (exit ${code}).`))
    })
  })
}

function readSiteYml(siteDir) {
  const file = join(siteDir, 'site.yml')
  if (!existsSync(file)) return { file, data: {} }
  try {
    return { file, data: yaml.load(readFileSync(file, 'utf8')) || {} }
  } catch {
    return { file, data: {} }
  }
}

function fail(message, ...details) {
  const [first, ...rest] = String(message).split('\n')
  console.error(`${RED}✗${RESET} ${first}`)
  for (const line of [...rest, ...details]) console.error(`  ${line.replace(/^ {2}/, '')}`)
  process.exit(1)
}

export async function snapshot(args = []) {
  let options
  try {
    options = parseSnapshotArgs(args)
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    fail(err.message, 'Run `uniweb snapshot --help` for the accepted flags.')
  }

  const cwd = process.cwd()
  const rootDir = findWorkspaceRoot(cwd)
  const sites = rootDir ? await discoverSites(rootDir).catch(() => []) : []
  const requested = options.site ?? options.positionals[0] ?? null
  const { site, ambiguous } = pickSite(sites, rootDir ?? cwd, { requested, cwd })

  if (requested && !site) {
    fail(`Site "${requested}" not found.`, `Available: ${sites.map((s) => s.name).join(', ') || '(none)'}`)
  }
  if (!site && !options.url) {
    fail('No site found here.', 'Run this inside a Uniweb workspace, or pass `--url <address> --out <file>`.')
  }
  if (!site && !options.out) {
    fail('`--out <file>` is needed outside a site: there is no public/ folder to write to.')
  }
  if (ambiguous) {
    console.error(`${YELLOW}⚠${RESET} Multiple sites found; using ${CYAN}${site.name}${RESET}. Pick one with \`--site <name>\`.`)
  }

  const siteDir = site ? join(rootDir, site.path) : null
  const output = options.out ? resolve(cwd, options.out) : join(siteDir, DEFAULT_OUTPUT)

  const lib = await loadSnapshotPackage([siteDir, rootDir])
  if (!lib) {
    fail(
      '`uniweb snapshot` needs `@uniweb/snapshot`, which is not installed here.',
      'Add it as a dev dependency of the workspace:',
      `  ${CYAN}${installHint(rootDir)}${RESET}`
    )
  }

  // Put the site behind a URL.
  let source
  try {
    if (options.url) {
      source = { url: options.url, label: options.url, close: async () => {} }
    } else if (options.dev) {
      console.error(`${DIM}→ starting the dev server for ${site.name}${RESET}`)
      const dev = await lib.startDevServer(siteDir)
      source = { url: dev.url, label: `dev server (${dev.url})`, close: dev.close }
    } else {
      if (!options.noBuild) {
        console.error(`${DIM}→ building ${site.name}${RESET}`)
        await runBuild(siteDir)
      }
      const dist = join(siteDir, 'dist')
      if (!existsSync(join(dist, 'index.html'))) {
        fail(`No built site at ${relative(cwd, dist) || dist}.`, 'Run without `--no-build`, or build the site first.')
      }
      const server = await lib.serveDirectory(dist, { base: readSiteYml(siteDir).data.base })
      source = { url: server.url, label: 'the built site', close: server.close }
    }
  } catch (err) {
    fail(err.message)
  }

  let result
  try {
    result = await lib.snapshot({
      url: source.url,
      route: options.route,
      layout: options.layout,
      tone: options.tone,
      canvas: options.canvas,
      scale: options.scale,
      quality: options.quality,
      hide: options.hide,
      output,
      onStep: (step) => {
        if (step === 'capture') {
          const page = options.route && options.route !== '/' ? ` · ${options.route}` : ''
          console.error(`${DIM}→ capturing ${source.label}${page}${RESET}`)
        }
        if (step === 'compose') console.error(`${DIM}→ composing${RESET}`)
      },
    })
  } catch (err) {
    await source.close().catch(() => {})
    fail(err.message)
  }
  await source.close()

  const shown = relative(cwd, output) || output
  console.log(
    `${GREEN}✓${RESET} ${shown} ${DIM}(${result.width}×${result.height}, ${humanBytes(result.bytes)} — ${result.layout} layout, ${result.tone} background)${RESET}`
  )

  if (!siteDir || options.noSetPreview) return

  const value = previewValueFor(siteDir, output)
  const siteYml = readSiteYml(siteDir)
  if (!value) {
    console.log(`  ${DIM}site.yml not changed: the image is outside ${join(site.path, 'public')}/, so it has no site path.${RESET}`)
    return
  }
  const current = siteYml.data.preview
  switch (previewDecision(current, value)) {
    case 'set':
      upsertYamlScalar(siteYml.file, 'preview', value)
      console.log(`  site.yml: ${CYAN}preview: ${value}${RESET}`)
      break
    case 'replace':
      upsertYamlScalar(siteYml.file, 'preview', value)
      console.log(`  site.yml: ${CYAN}preview: ${value}${RESET} ${DIM}(replaces the app-generated preview)${RESET}`)
      break
    case 'unchanged':
      console.log(`  ${DIM}site.yml already has preview: ${value}${RESET}`)
      break
    case 'keep':
      console.log(`  ${YELLOW}site.yml keeps preview: ${current}${RESET} ${DIM}— set it to ${value} to use this image.${RESET}`)
      break
  }
}

export default snapshot
