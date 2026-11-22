/**
 * `uniweb label` — place a picture's words by drawing them over it.
 *
 *     uniweb label                    the sections with a picture's words to place
 *     uniweb label <section file>     open one: pages/backend/1-hero.md
 *
 * A picture's words drawn over it as text are translated with the page: a section gives them in a
 * data block its type declares as `data: { overlay: { schema: '@std/overlay', single: true } }`, and kit's `LabeledImage`
 * draws them. This opens the section's picture in a browser on this machine, with each label as a
 * box. Draw a box loosely over the words a label stands for and it fits itself to them; move it,
 * size it, give it its words, its role and the side it keeps. Save writes the block back into the
 * section's file, and nothing else in the file changes. With `uniweb dev` running, it links to the
 * section on its page, in each language, where the foundation's looks show how the words fit.
 *
 * It reads the site as the build does: the section with the content reader, which keys hold an
 * overlay from the foundation's section types, the languages from `site.yml`, and each label's words
 * in another language from the site's translations, by the hash `uniweb i18n` keys them with.
 *
 * Served on this machine only: bound to 127.0.0.1, it answers only a request that names that host,
 * and only the page it served knows the token its writes need.
 */
import http from 'node:http'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { overlay as OVERLAY } from '@uniweb/schemas'
import { normalizeData } from '@uniweb/schemas/foundation'
import { resolveDefaultLocale, normalizeLanguageList, isWildcardLanguages, localeLabel } from '@uniweb/core/locale-config'

const APP = fileURLToPath(new URL('../label/app.html', import.meta.url))
const STANDARD = '@std/overlay'

const USAGE = `Place a picture's words by drawing them over it.

  uniweb label                    List the sections with a picture's words to place
  uniweb label <section file>     Open one, such as pages/backend/1-hero.md

Options:
  --key <name>    The data key, when a section type declares more than one ${STANDARD}
  --port <n>      Where to serve it on this machine (default: 4780, or any free port)
  --no-open       Print the address without opening a browser

A section type declares where its words go as one record,
\`data: { overlay: { schema: '${STANDARD}', single: true } }\`, and kit's LabeledImage draws them.`

/** The label fields, in the standard's order: how the block is written, and what the app offers. */
const LABEL_FIELDS = Object.keys(OVERLAY.fields.labels.fields)
const ROLES = OVERLAY.fields.labels.fields.role.enum
const ALIGNS = OVERLAY.fields.labels.fields.align.enum

export async function label(args) {
  const options = { key: null, port: 4780, open: true, file: null }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') return console.log(USAGE)
    else if (arg === '--key') options.key = args[++i]
    else if (arg === '--port') options.port = Number(args[++i])
    else if (arg === '--no-open') options.open = false
    else if (arg.startsWith('--')) fail(`Unknown option ${arg}.\n\n${USAGE}`)
    else options.file = arg
  }

  const file = options.file ? path.resolve(options.file) : null
  if (file && !existsSync(file)) fail(`No file at ${options.file}.`)
  const siteRoot = upFrom(file ? path.dirname(file) : process.cwd(), (dir) => existsSync(path.join(dir, 'site.yml')))
  if (!siteRoot) fail(file ? `${options.file} is in no site: no site.yml above it.` : `No site here: run it in a site, or name a section's file.\n\n${USAGE}`)

  const site = await readSite(siteRoot)
  if (!file) return listSections(site)
  return serve(site, file, options)
}

// ── The site, read as the build reads it ─────────────────────────────────────

async function readSite(siteRoot) {
  const build = await import('@uniweb/build/site')
  const { computeHash, resolveLocales } = await import('@uniweb/build/i18n')
  const { parseNumericPrefix } = await import('@uniweb/build/content')
  // The content reader the build carries, so a section reads here as it reads there.
  const fromBuild = createRequire(fileURLToPath(import.meta.resolve('@uniweb/build')))
  const { markdownToProseMirror } = await import(pathToFileURL(fromBuild.resolve('@uniweb/content-reader')).href)

  const config = build.readSiteConfig(siteRoot)
  const defaultLanguage = resolveDefaultLocale(config)
  // The languages as the build takes them: those listed, or with none or `*`, each translation file.
  const listed = isWildcardLanguages(config.languages) || config.languages == null
    ? await resolveLocales(config.languages, path.join(siteRoot, config.i18n?.localesDir || 'locales'))
    : normalizeLanguageList(config.languages)
  const languages = [defaultLanguage, ...listed.filter((code) => code !== defaultLanguage)]

  // Which keys of which section types hold a picture's words: those bound to the standard.
  let sections = {}
  try {
    sections = (await build.foundationSections(siteRoot)) || {}
  } catch {
    // a foundation that doesn't read is reported by the commands that build it
  }
  const keysByType = {}
  for (const [type, entry] of Object.entries(sections)) {
    if (!entry || typeof entry !== 'object' || type.startsWith('_') || type === 'dataSchemas') continue
    const keys = Object.entries(normalizeData(entry.data || {}, { strict: false }) || {})
      .filter(([, decl]) => decl?.kind === 'schema' && decl.schema === STANDARD)
      .map(([key]) => key)
    if (keys.length) keysByType[type] = keys
  }
  const fallbackType = await build.siteDefaultSectionType(siteRoot).catch(() => 'Section')

  return {
    root: siteRoot,
    config,
    build,
    computeHash,
    parseNumericPrefix,
    markdownToProseMirror,
    defaultLanguage,
    languages,
    languageNames: Object.fromEntries(languages.map((code) => [code, localeLabel(code) || code])),
    keysByType,
    fallbackType,
  }
}

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|svg|avif)$/i

/** A section's file as the labeller works on it: its type, its pictures, its overlay block. */
function readSection(site, file, key) {
  const raw = readFileSync(file, 'utf8')
  const version = createHash('sha256').update(raw).digest('hex').slice(0, 16)
  const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  const meta = (front && yaml.load(front[1])) || {}
  const doc = site.markdownToProseMirror(front ? raw.slice(front[0].length) : raw)
  const images = []
  let block = null
  walk(doc, (node) => {
    if (node.type === 'image' && node.attrs?.role !== 'icon' && IMAGE_FILE.test(String(node.attrs?.src ?? '').split(/[?#]/)[0])) {
      images.push(node.attrs)
    }
    if (key && node.type === 'dataBlock' && node.attrs?.tag === key && !block) block = node.attrs
  })
  const stem = path.basename(file, path.extname(file)).replace(/^@/, '')
  return {
    raw,
    version,
    type: meta.type || site.fallbackType,
    sectionId: meta.id || site.parseNumericPrefix(stem).name,
    images,
    overlay: block ? (block.data ?? {}) : null,
  }
}

async function listSections(site) {
  const rows = []
  for (const { file } of await site.build.sectionFilesOf(site.root)) {
    let section
    try {
      section = readSection(site, file, null)
    } catch {
      continue
    }
    for (const key of site.keysByType[section.type] || []) {
      const { overlay } = readSection(site, file, key)
      rows.push({ file: path.relative(process.cwd(), file), type: section.type, key, labels: overlay?.labels?.length ?? 0, pictures: section.images.length })
    }
  }
  if (!Object.keys(site.keysByType).length) {
    console.log(`No section type of this site's foundation declares a picture's words (\`data: { overlay: { schema: '${STANDARD}', single: true } }\`).`)
    return
  }
  if (!rows.length) {
    console.log(`No section is of a type that takes a picture's words: ${Object.keys(site.keysByType).join(', ')}.`)
    return
  }
  console.log(`Sections with a picture's words to place:\n`)
  for (const row of rows) {
    const what = row.labels ? `${row.labels} label${row.labels === 1 ? '' : 's'}` : 'none yet'
    console.log(`  ${row.file}  (${row.type}, \`${row.key}\`: ${what}, ${row.pictures} picture${row.pictures === 1 ? '' : 's'})`)
  }
  console.log(`\nOpen one: uniweb label ${rows[0].file}`)
}

// ── Writing the block back ───────────────────────────────────────────────────

const PLAIN = /^[A-Za-z][\w.-]*$/
const RESERVED = /^(true|false|null|yes|no|on|off|y|n|~)$/i

/** The order the standard gives an object's fields: `sizes` by role, a `dark` pair color first. */
const ORDER = { sizes: Object.keys(OVERLAY.fields.sizes.fields), dark: Object.keys(OVERLAY.fields.dark.fields) }

/** An object's fields in the order the standard gives them, and any other after them. */
function ordered(value, name) {
  const order = ORDER[name] || []
  const rank = (key) => (order.includes(key) ? order.indexOf(key) : order.length)
  return Object.entries(value).sort(([a], [b]) => rank(a) - rank(b))
}

/** A value as YAML that reads back as itself: a word as is, anything else quoted, as JSON is valid YAML. */
function scalar(value, quote, name) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean' || value === null) return String(value)
  if (typeof value === 'string') return !quote && PLAIN.test(value) && !RESERVED.test(value) ? value : JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => scalar(item, false)).join(', ')}]`
  if (value && typeof value === 'object') {
    const pairs = ordered(value, name).filter(([, item]) => !isEmpty(item))
    return `{ ${pairs.map(([name, item]) => `${PLAIN.test(name) && !RESERVED.test(name) ? name : JSON.stringify(name)}: ${scalar(item, false)}`).join(', ')} }`
  }
  return JSON.stringify(value)
}

/** Nothing to write: no value, an empty string, or an object or list holding nothing. */
function isEmpty(value) {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.values(value).every(isEmpty)
  return false
}

/** The overlay's own fields, in the standard's order: `baked`, `sizes`, its colors, then its labels. */
const OVERLAY_FIELDS = Object.keys(OVERLAY.fields)

/**
 * The block as an author writes it: the overlay's fields in the standard's order, then one label a
 * line, its fields in the standard's order and a field it doesn't name after them. Words and colors
 * are quoted (a line break reads as `\n`, and `#` would start a comment); a role or a side is a word.
 */
export function blockText(overlay, key, newline = '\n') {
  const lines = [`\`\`\`yaml:${key}`]
  const keys = [...OVERLAY_FIELDS.filter((name) => name !== 'labels'), 'labels', ...Object.keys(overlay).filter((name) => !OVERLAY_FIELDS.includes(name))]
  for (const name of keys) {
    const value = overlay[name]
    if (name !== 'labels' && isEmpty(value)) continue
    if (name !== 'labels') {
      lines.push(`${name}: ${scalar(value, false, name)}`)
      continue
    }
    if (!Array.isArray(value) || !value.length) {
      lines.push('labels: []')
      continue
    }
    lines.push('labels:')
    for (const label of value) {
      const own = Object.keys(label).filter((field) => !LABEL_FIELDS.includes(field))
      const named = [...LABEL_FIELDS, ...own].filter((field) => !isEmpty(label[field]))
      lines.push(`  - { ${named.map((field) => `${field}: ${scalar(label[field], field === 'text', field)}`).join(', ')} }`)
    }
  }
  lines.push('```')
  return lines.join(newline)
}

/** The file with its block replaced, or, with none yet, placed after the section's last picture. */
export function withBlock(raw, block, key, newline = '\n') {
  const lines = raw.split(/\r?\n/)
  const opening = new RegExp(`^(\`{3,}|~{3,})yaml:${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
  const start = lines.findIndex((line) => opening.test(line))
  if (start >= 0) {
    const fence = lines[start].match(opening)[1]
    let end = start + 1
    while (end < lines.length && !(lines[end].startsWith(fence[0].repeat(fence.length)) && /^(`{3,}|~{3,})\s*$/.test(lines[end]))) end++
    if (end >= lines.length) throw new Error(`The \`${key}\` block in the file has no closing fence.`)
    lines.splice(start, end - start + 1, ...block.split(newline))
    return lines.join(newline)
  }
  // A block after the section's first item (`###`) would be that item's, so it goes before them.
  const items = lines.findIndex((line) => /^###\s/.test(line))
  const before = items >= 0 ? lines.slice(0, items) : lines
  let at = before.map((line) => /^!\[/.test(line)).lastIndexOf(true)
  at = at >= 0 ? at + 1 : before.length
  const inserted = block.split(newline)
  if (at > 0 && lines[at - 1].trim() !== '') inserted.unshift('')
  if (at < lines.length && lines[at].trim() !== '') inserted.push('')
  lines.splice(at, 0, ...inserted)
  return lines.join(newline)
}

/**
 * Equal as the page reads them: what is empty (a field, an empty `baked`, `sizes` or `dark`) isn't
 * written, so isn't there, and the order of an object's fields is how the block writes them, not a
 * difference.
 */
function sameData(read, drawn) {
  const tidy = (value) => {
    if (Array.isArray(value)) return value.map(tidy)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().filter((key) => !isEmpty(value[key]) || key === 'labels').map((key) => [key, tidy(value[key])]))
    }
    return value
  }
  return JSON.stringify(tidy(read ?? {})) === JSON.stringify(tidy(drawn))
}

// ── Serving it ───────────────────────────────────────────────────────────────

async function serve(site, file, options) {
  const first = readSection(site, file, null)
  const keys = site.keysByType[first.type] || []
  const key = options.key || keys[0]
  if (!key) {
    fail(
      `${path.relative(process.cwd(), file)} is a ${first.type} section, and ${first.type} declares no key for a picture's words.\n` +
        `A section type declares one as \`data: { overlay: { schema: '${STANDARD}', single: true } }\`.` +
        (Object.keys(site.keysByType).length ? ` These do: ${Object.keys(site.keysByType).join(', ')}.` : ''),
    )
  }
  if (options.key && !keys.includes(options.key)) fail(`${first.type} declares no \`${options.key}\` key for a picture's words.`)

  // Where the section is on its page.
  const route = site.build.routeOfSection(file, path.join(site.root, 'pages'), site.config.index)
  const read = () => readSection(site, file, key)

  /** Each text's words in each other language, from the site's translations, keyed as `uniweb i18n` keys them. */
  const translationsOf = (texts, context) => {
    const out = {}
    for (const code of site.languages) {
      if (code === site.defaultLanguage) continue
      let table = {}
      try {
        table = JSON.parse(readFileSync(path.join(site.root, site.config.i18n?.localesDir || 'locales', `${code}.json`), 'utf8'))
      } catch {
        // No translation file for this language yet.
      }
      out[code] = {}
      for (const text of texts) {
        if (typeof text !== 'string' || !text.trim()) continue
        const value = table[site.computeHash(text.trim())]
        out[code][text] =
          typeof value === 'string' ? value : value && typeof value === 'object' ? value.overrides?.[context] ?? value.default ?? null : null
      }
    }
    return out
  }

  /** The section on its page under `uniweb dev`, in each language, or null when no dev server runs. */
  const pageLinks = async (sectionId) => {
    const dev = await site.build.runningDevServer(site.root, { timeout: 800 }).catch(() => null)
    if (!dev?.url) return null
    const base = dev.url.replace(/\/$/, '')
    return Object.fromEntries(
      site.languages.map((code) => [code, `${base}${code === site.defaultLanguage ? '' : `/${code}`}${route === '/' ? '/' : route}#section-${sectionId}`]),
    )
  }

  const pictureFile = (src) => {
    const clean = decodeURIComponent(String(src).split(/[?#]/)[0])
    if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null
    const found = clean.startsWith('/') ? path.join(site.root, 'public', clean) : path.resolve(path.dirname(file), clean)
    return found.startsWith(site.root + path.sep) && existsSync(found) ? found : null
  }

  const payload = async () => {
    const section = read()
    const texts = (section.overlay?.labels ?? []).map((each) => each?.text)
    return {
      file: path.relative(process.cwd(), file),
      tag: key,
      type: section.type,
      section: section.sectionId,
      route,
      version: section.version,
      images: section.images.map((attrs, index) => ({
        url: pictureFile(attrs.src) ? `/picture/${index}` : attrs.src,
        src: attrs.src,
        alt: attrs.alt ?? null,
        role: attrs.role ?? null,
      })),
      overlay: section.overlay,
      vocabulary: { roles: ROLES, aligns: ALIGNS, fields: LABEL_FIELDS },
      languages: site.languages,
      languageNames: site.languageNames,
      defaultLanguage: site.defaultLanguage,
      translations: translationsOf(texts, `${route}:${section.sectionId}`),
      pageLinks: await pageLinks(section.sectionId),
    }
  }

  const save = ({ overlay, version, force }) => {
    if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return [400, { error: 'Nothing to save.' }]
    const section = read()
    if (version !== section.version && !force) {
      return [409, { error: 'The file changed on disk since it was opened here.', version: section.version }]
    }
    const newline = section.raw.includes('\r\n') ? '\r\n' : '\n'
    const next = withBlock(section.raw, blockText(overlay, key, newline), key, newline)
    const temporary = `${file}.label-${process.pid}`
    writeFileSync(temporary, next)
    renameSync(temporary, file)
    // Read back as the build reads it: what the page will get must be what was drawn.
    const written = read()
    if (!sameData(written.overlay, overlay)) {
      writeFileSync(temporary, section.raw)
      renameSync(temporary, file)
      return [500, { error: 'The block did not read back as it was drawn, so the file was left as it was.' }]
    }
    return [200, { version: written.version, unchanged: next === section.raw }]
  }

  const token = randomBytes(18).toString('hex')
  const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif' }
  const shown = path.relative(process.cwd(), file)

  const server = http.createServer(async (request, response) => {
    try {
      const host = String(request.headers.host || '')
      // Only this machine's own address: a page elsewhere that names it reaches nothing.
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(response, 403, 'Forbidden', 'text/plain')
      const url = new URL(request.url, `http://${host}`)
      if (request.method === 'GET' && url.pathname === '/') {
        return send(response, 200, readFileSync(APP, 'utf8').replace('__LABELLER_TOKEN__', token), 'text/html; charset=utf-8')
      }
      if (request.method === 'GET' && url.pathname.startsWith('/picture/')) {
        const image = read().images[Number(url.pathname.slice('/picture/'.length))]
        const found = image && pictureFile(image.src)
        if (!found) return send(response, 404, 'No such picture', 'text/plain')
        return send(response, 200, readFileSync(found), TYPES[path.extname(found).toLowerCase()] || 'application/octet-stream')
      }
      if (!url.pathname.startsWith('/api/')) return send(response, 404, 'Not found', 'text/plain')
      // The page this server wrote is the only one that knows the token, so no other page can write.
      if (request.headers['x-labeller-token'] !== token) return json(response, 403, { error: 'Forbidden' })
      if (request.method === 'GET' && url.pathname === '/api/section') return json(response, 200, await payload())
      if (request.method === 'GET' && url.pathname === '/api/links') return json(response, 200, { pageLinks: await pageLinks(read().sectionId) })
      if (request.method === 'POST' && url.pathname === '/api/translate') {
        const { texts } = await readJson(request)
        return json(response, 200, translationsOf(Array.isArray(texts) ? texts : [], `${route}:${read().sectionId}`))
      }
      if (request.method === 'POST' && url.pathname === '/api/save') {
        const [status, body] = save(await readJson(request))
        if (status === 200) console.log(body.unchanged ? `  saved, unchanged: ${shown}` : `  saved ${shown}`)
        return json(response, status, status === 200 ? { ...body, pageLinks: await pageLinks(read().sectionId) } : body)
      }
      return json(response, 404, { error: 'Not found' })
    } catch (error) {
      return json(response, 500, { error: error.message })
    }
  })

  let port = options.port
  await new Promise((resolve) => {
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && port !== 0) {
        port = 0
        server.listen(0, '127.0.0.1')
      } else fail(error.message)
    })
    server.on('listening', resolve)
    server.listen(port, '127.0.0.1')
  })
  const address = `http://127.0.0.1:${server.address().port}/`
  console.log(`Placing the words over ${shown}'s picture (\`${key}\`).\n`)
  console.log(`  Open ${address} in a browser on this machine, and place the labels there.`)
  console.log(`  Save writes them into the file. Stop with Ctrl-C.`)
  if (options.open) openBrowser(address)
  // Serves until stopped.
  await new Promise(() => {})
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const child of node.content ?? []) walk(child, visit)
}

function upFrom(dir, found) {
  for (let at = dir; ; at = path.dirname(at)) {
    if (found(at)) return at
    if (path.dirname(at) === at) return null
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 2_000_000) reject(new Error('Too much to save.'))
    })
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function send(response, status, body, type) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  response.end(body)
}

function json(response, status, body) {
  send(response, status, JSON.stringify(body), 'application/json; charset=utf-8')
}

function openBrowser(address) {
  const [command, ...rest] =
    process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : ['xdg-open']
  try {
    spawn(command, [...rest, address], { stdio: 'ignore', detached: true }).unref()
  } catch {
    // The address is printed; a browser can be pointed at it by hand.
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
