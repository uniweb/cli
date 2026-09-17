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
 *   uniweb snapshot --compare       one capture, several looks, on one sheet
 *
 * The layout is chosen from the page: one that scrolls gets `split` (the first
 * view in a browser window, beside a long strip of the page); one that does not
 * — a documentation shell, an app — gets `device` (desktop and phone). How the
 * two frames sit together is the look: `--gap`/`--overlap`, `--strip`, `--side`,
 * `--frame`, `--tone`.
 *
 * A site keeps its chosen look in `site/snapshot.yml` (utils/snapshot-settings.js):
 * the command's defaults for that site, which flags override and `--save` writes.
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
import {
  SETTINGS_FILE,
  SettingsError,
  mergeSettings,
  readSnapshotSettings,
  saveSnapshotSettings
} from '../utils/snapshot-settings.js'
import { findWorkspaceRoot } from '../utils/workspace.js'

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

/** Flags that choose the image, by the `snapshot.yml` setting each one sets. */
const SETTING_FLAGS = {
  '--route': 'route',
  '--layout': 'layout',
  '--tone': 'tone',
  '--gap': 'gap',
  '--overlap': 'overlap',
  '--strip': 'strip',
  '--side': 'side',
  '--frame': 'frame',
  '--size': 'size',
  '--scale': 'scale',
  '--quality': 'quality',
  '--hide': 'hide',
  '--out': 'out'
}
const NUMBER_SETTINGS = ['gap', 'overlap', 'scale', 'quality']
/** Flags that choose where the site comes from and what the run does. */
const CONTROL_VALUE_FLAGS = ['--site', '--url']
const CONTROL_BOOLEAN_FLAGS = ['--dev', '--no-build', '--no-set-preview', '--compare', '--save']
const GLOBAL_FLAGS = ['--non-interactive', '--help', '-h']
const ALL_FLAGS = [...Object.keys(SETTING_FLAGS), ...CONTROL_VALUE_FLAGS, ...CONTROL_BOOLEAN_FLAGS, ...GLOBAL_FLAGS]
const LOOK_SETTINGS = ['gap', 'overlap', 'strip', 'side', 'frame']

export const DEFAULT_OUTPUT = join('public', 'preview.webp')
export const COMPARE_OUTPUT = join('.uniweb', 'snapshot', 'compare.webp')

class UsageError extends Error {}

const camel = (flag) => flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())

/**
 * Parse `uniweb snapshot` arguments into the image settings they choose and the
 * run controls. Checks the shape of each value; what a value may be (a layout
 * name, a range) is checked by the package, before anything is built.
 *
 * @param {string[]} args
 * @param {string} [cwd] - `--out` is relative to it
 */
export function parseSnapshotArgs(args = [], cwd = process.cwd()) {
  const settings = {}
  const control = {}
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const raw = args[i]
    if (raw === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (!raw.startsWith('-') || raw === '-') {
      positionals.push(raw)
      continue
    }
    const eq = raw.indexOf('=')
    const name = eq === -1 ? raw : raw.slice(0, eq)
    const takesValue = name in SETTING_FLAGS || CONTROL_VALUE_FLAGS.includes(name)
    if (takesValue) {
      const value = eq === -1 ? args[++i] : raw.slice(eq + 1)
      if (value === undefined || value === '' || (eq === -1 && value.startsWith('--'))) {
        throw new UsageError(`\`${name}\` needs a value.`)
      }
      const key = SETTING_FLAGS[name]
      if (!key) control[camel(name)] = value
      else if (key === 'hide') settings.hide = [...(settings.hide ?? []), value]
      else if (key === 'out') settings.out = resolve(cwd, value)
      else if (NUMBER_SETTINGS.includes(key)) {
        const number = Number(value)
        if (!Number.isFinite(number)) throw new UsageError(`\`${name}\` needs a number.`)
        settings[key] = number
      } else settings[key] = value
    } else if (CONTROL_BOOLEAN_FLAGS.includes(name)) {
      control[camel(name)] = true
    } else if (!GLOBAL_FLAGS.includes(name)) {
      const suggestion = didYouMean(name, ALL_FLAGS)
      throw new UsageError(
        `Unknown flag \`${name}\` for \`uniweb snapshot\`.` + (suggestion ? ` Did you mean \`${suggestion}\`?` : '')
      )
    }
  }

  if (control.dev && control.url) throw new UsageError('Pass `--dev` or `--url`, not both.')
  if (settings.gap !== undefined && settings.overlap !== undefined) {
    throw new UsageError('Pass `--gap` or `--overlap`, not both.')
  }
  if (control.compare && control.save) {
    throw new UsageError('`--save` keeps the look of a snapshot; choose a look from the sheet, then save that.')
  }
  return { settings, control, positionals }
}

/**
 * The package's options for a set of settings. `size` is the one setting whose
 * shape the package does not take as written.
 */
export function libraryOptions({ size, out, scale, quality, ...rest }) {
  const options = { ...rest }
  if (size !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(String(size))
    if (!match) throw new UsageError('`size` is WIDTHxHEIGHT, e.g. 1600x1000.')
    options.canvas = { width: Number(match[1]), height: Number(match[2]) }
  }
  if (scale !== undefined) options.scale = Number(scale)
  if (quality !== undefined) options.quality = Number(quality)
  if (out !== undefined) options.output = out
  return options
}

/** A variant's changes as the flags that apply them; `current` for none. */
export function flagsFor(changes) {
  const parts = Object.entries(changes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `--${key} ${value}`)
  return parts.length ? parts.join(' ') : 'current'
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

function installHint(rootDir, command = 'add') {
  switch (detectWorkspacePm(rootDir)) {
    case 'npm':
      return 'npm install --save-dev @uniweb/snapshot@latest'
    case 'yarn':
      return `yarn ${command} --dev -W @uniweb/snapshot@latest`
    default:
      return `pnpm ${command} -D -w @uniweb/snapshot@latest`
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
  const cwd = process.cwd()
  let parsed
  try {
    parsed = parseSnapshotArgs(args, cwd)
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    fail(err.message, 'Run `uniweb snapshot --help` for the accepted flags.')
  }
  const { settings: flagSettings, control, positionals } = parsed

  const rootDir = findWorkspaceRoot(cwd)
  const sites = rootDir ? await discoverSites(rootDir).catch(() => []) : []
  const requested = control.site ?? positionals[0] ?? null
  const { site, ambiguous } = pickSite(sites, rootDir ?? cwd, { requested, cwd })

  if (requested && !site) {
    fail(`Site "${requested}" not found.`, `Available: ${sites.map((s) => s.name).join(', ') || '(none)'}`)
  }
  if (!site && !control.url) {
    fail('No site found here.', 'Run this inside a Uniweb workspace, or pass `--url <address> --out <file>`.')
  }
  if (!site && !flagSettings.out) {
    fail('`--out <file>` is needed outside a site: there is no site folder to write to.')
  }
  if (!site && control.save) fail(`\`--save\` writes ${SETTINGS_FILE} into a site, and there is none here.`)
  if (ambiguous) {
    console.error(`${YELLOW}⚠${RESET} Multiple sites found; using ${CYAN}${site.name}${RESET}. Pick one with \`--site <name>\`.`)
  }

  const siteDir = site ? join(rootDir, site.path) : null

  // The site's saved look, under this run's flags. For a comparison, the file's
  // `out` names the preview image, not the sheet.
  let fileSettings = {}
  if (siteDir) {
    try {
      fileSettings = readSnapshotSettings(siteDir).settings
    } catch (err) {
      if (!(err instanceof SettingsError)) throw err
      fail(err.message)
    }
  }
  const base = { ...fileSettings }
  if (control.compare) delete base.out
  const merged = mergeSettings(base, flagSettings)
  let options
  try {
    options = libraryOptions(merged)
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    fail(err.message)
  }
  options.output ??= join(siteDir, control.compare ? COMPARE_OUTPUT : DEFAULT_OUTPUT)

  const lib = await loadSnapshotPackage([siteDir, rootDir])
  if (!lib) {
    fail(
      '`uniweb snapshot` needs `@uniweb/snapshot`, which is not installed here.',
      'Add it as a dev dependency of the workspace:',
      `  ${CYAN}${installHint(rootDir)}${RESET}`
    )
  }
  const chosesLook = LOOK_SETTINGS.some((key) => options[key] !== undefined)
  if ((control.compare || chosesLook) && typeof lib.compare !== 'function') {
    fail(
      'The installed `@uniweb/snapshot` predates looks and comparisons.',
      'Update it:',
      `  ${CYAN}${installHint(rootDir)}${RESET}`
    )
  }
  if (typeof lib.normalizeOptions === 'function') {
    try {
      lib.normalizeOptions(options)
    } catch (err) {
      fail(err.message, `Check the flags${Object.keys(fileSettings).length ? ` and ${SETTINGS_FILE}` : ''}.`)
    }
  }

  // Put the site behind a URL.
  let source
  try {
    if (control.url) {
      source = { url: control.url, label: control.url, close: async () => {} }
    } else if (control.dev) {
      console.error(`${DIM}→ starting the dev server for ${site.name}${RESET}`)
      const dev = await lib.startDevServer(siteDir)
      source = { url: dev.url, label: `dev server (${dev.url})`, close: dev.close }
    } else {
      if (!control.noBuild) {
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

  const onStep = (step) => {
    if (step === 'capture') {
      const page = options.route && options.route !== '/' ? ` · ${options.route}` : ''
      console.error(`${DIM}→ capturing ${source.label}${page}${RESET}`)
    }
    if (step === 'compose') console.error(`${DIM}→ composing${RESET}`)
  }

  let result
  try {
    result = control.compare
      ? await lib.compare({ ...options, url: source.url, label: flagsFor, onStep })
      : await lib.snapshot({ ...options, url: source.url, onStep })
  } catch (err) {
    await source.close().catch(() => {})
    fail(err.message)
  }
  await source.close()

  const shown = relative(cwd, options.output) || options.output

  if (control.compare) {
    console.log(
      `${GREEN}✓${RESET} ${shown} ${DIM}(${result.width}×${result.height}, ${result.variants.length} looks from one capture)${RESET}`
    )
    result.variants.forEach((variant, i) => {
      console.log(`  ${String(i + 1).padStart(2)}  ${i === 0 ? `${DIM}current${RESET}` : `${CYAN}${variant.label}${RESET}`}`)
    })
    console.log(`  ${DIM}Take one with its flags, and add --save to keep it: uniweb snapshot ${result.variants[1]?.label ?? ''} --save${RESET}`)
    return
  }

  console.log(
    `${GREEN}✓${RESET} ${shown} ${DIM}(${result.width}×${result.height}, ${humanBytes(result.bytes)} — ${result.layout} layout, ${result.tone} background)${RESET}`
  )

  if (control.save) {
    const { saved } = saveSnapshotSettings(siteDir, flagSettings, fileSettings)
    const where = relative(cwd, join(siteDir, SETTINGS_FILE))
    if (saved.length) console.log(`  ${where}: ${CYAN}saved ${saved.join(', ')}${RESET}`)
    else console.log(`  ${DIM}${where}: nothing to save — pass the flags you want to keep.${RESET}`)
  }

  if (!siteDir || control.noSetPreview) return

  const value = previewValueFor(siteDir, options.output)
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
