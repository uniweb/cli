/**
 * `uniweb doctor` — what a link to the site shows, its tab icon, and its home-screen icon.
 *
 * A chat, a feed or a search result draws a card from a page's head tags: its image (the page's
 * `seo.image`, else the site's), its title and its description. Nothing fails when they are
 * wrong, so these are found from the source: whether the image is there, its size and format,
 * and the text. The pages are the build's own (`collectSiteContent`), so a page.yml the build
 * cannot parse is reported as that, never as a page with no description.
 *
 * The favicon: a static build links the one its public folder holds when site.yml names none; a
 * Uniweb host's pages link only the one site.yml names.
 *
 * The touch icon: the PNG iOS puts on a home screen, `site.yml`'s `touchIcon:` — a PNG, square, at
 * least 180×180, and opaque, since iOS draws a transparent pixel black.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'
import yaml from 'js-yaml'
import { checkLinkPreviews, checkFavicon, checkTouchIcon } from '../src/commands/doctor.js'

/** A real PNG of `width`×`height`, black — `pad` bytes of an ancillary chunk make it heavy. */
function png(width, height, { pad = 0 } = {}) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(pad ? [chunk('zzZz', Buffer.alloc(pad))] : []),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * A site: `site.yml` from `siteYml`, a page per entry of `pages` (`{ name: pageYmlText }`, the
 * first is the home page), and `files` under the site (`{ 'public/x.png': Buffer|string }`).
 */
function site(t, { siteYml = 'name: S\n', pages = { home: 'title: Home\ndescription: The home page.\n' }, files = {} } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uniweb-doctor-previews-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'site.yml'), siteYml)
  for (const [name, pageYml] of Object.entries(pages)) {
    mkdirSync(join(dir, 'pages', name), { recursive: true })
    writeFileSync(join(dir, 'pages', name, 'page.yml'), pageYml)
    writeFileSync(join(dir, 'pages', name, '1-intro.md'), `---\ntype: Section\n---\n\n# ${name}\n`)
  }
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  return dir
}

async function previews(sitePath) {
  const issues = []
  await checkLinkPreviews({ sitePath, siteName: 'site', issues })
  return issues
}

const ids = (issues) => issues.map((i) => i.id)

test('a site with a 1200×630 card and short descriptions is fine', async (t) => {
  const dir = site(t, {
    siteYml: 'name: S\nseo:\n  image: /images/card.png\n',
    files: { 'public/images/card.png': png(1200, 630) }
  })
  assert.deepEqual(await previews(dir), [])
})

test('no image anywhere is a recommendation, never a warning', async (t) => {
  const [issue] = await previews(site(t))
  assert.equal(issue.id, 'share-image-none')
  assert.equal(issue.type, 'info')
  assert.equal(issue.message, 'Links to this site show no image')
})

test('a page with its own image needs none from the site; the others are named', async (t) => {
  const dir = site(t, {
    pages: {
      home: 'title: Home\ndescription: Home.\nseo:\n  image: /home.png\n',
      about: 'title: About\ndescription: About.\n'
    },
    files: { 'public/home.png': png(1200, 630) }
  })
  const [issue] = await previews(dir)
  assert.equal(issue.id, 'share-image-none')
  assert.equal(issue.message, 'Links to 1 page show no image')
})

test('an image that is not there is a warning naming it', async (t) => {
  const issues = await previews(site(t, { siteYml: 'name: S\nseo:\n  image: /images/gone.jpg\n' }))
  assert.deepEqual(ids(issues), ['share-image-missing'])
  assert.equal(issues[0].type, 'warn')
  assert.match(issues[0].message, /\/images\/gone\.jpg/)
})

// ⛔ `assets/` served a `/x` until 2026-10-28; it is retired, and a build refuses a `/x` only it
// holds. Doctor says so as the build would, rather than calling the image missing.
test('an image under assets/ is refused, as the build refuses it', async (t) => {
  const dir = site(t, {
    siteYml: 'name: S\nseo:\n  image: /card.png\n',
    files: { 'assets/card.png': png(1200, 630) }
  })
  const issues = await previews(dir)
  assert.deepEqual(ids(issues), ['site-content-unreadable'])
  assert.equal(issues[0].type, 'error')
  assert.match(issues[0].message, /names assets\/card\.png/)
  assert.match(issues[0].message, /into public\//)
})

test('an SVG is a warning: link previews do not draw one', async (t) => {
  const dir = site(t, {
    siteYml: 'name: S\nseo:\n  image: /card.svg\n',
    files: { 'public/card.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>' }
  })
  const issues = await previews(dir)
  assert.deepEqual(ids(issues), ['share-image-format'])
  assert.equal(issues[0].type, 'warn')
  assert.match(issues[0].message, /is an SVG/)
})

test('a file that is not an image is a warning', async (t) => {
  const dir = site(t, { siteYml: 'name: S\nseo:\n  image: /card.png\n', files: { 'public/card.png': 'not an image' } })
  const issues = await previews(dir)
  assert.deepEqual(ids(issues), ['share-image-format'])
  assert.match(issues[0].message, /could not be read as an image/)
})

test('the shape: cropped, thumbnail, soft — the most telling one, as a recommendation', async (t) => {
  const shape = async (w, h) => {
    const dir = site(t, { siteYml: 'name: S\nseo:\n  image: /card.png\n', files: { 'public/card.png': png(w, h) } })
    const issues = await previews(dir)
    assert.deepEqual(ids(issues), ['share-image-shape'], `${w}×${h}`)
    assert.equal(issues[0].type, 'info')
    return issues[0].message
  }
  assert.match(await shape(1448, 1086), /1448×1086: 1\.33:1 — previews crop it to 1\.91:1/)
  assert.match(await shape(400, 210), /under 600×315, previews draw it as a thumbnail/)
  assert.match(await shape(800, 420), /high-resolution screens draw it soft/)
})

test('2:1 and 16:9 are close enough to 1.91:1 to pass', async (t) => {
  for (const [w, h] of [[1200, 600], [1200, 675]]) {
    const dir = site(t, { siteYml: 'name: S\nseo:\n  image: /card.png\n', files: { 'public/card.png': png(w, h) } })
    assert.deepEqual(await previews(dir), [], `${w}×${h}`)
  }
})

test('an image over 5 MB is a warning', async (t) => {
  const dir = site(t, {
    siteYml: 'name: S\nseo:\n  image: /card.png\n',
    files: { 'public/card.png': png(1200, 630, { pad: 5.5 * 1024 * 1024 }) }
  })
  const issues = await previews(dir)
  assert.deepEqual(ids(issues), ['share-image-heavy'])
  assert.equal(issues[0].type, 'warn')
})

test('an image at an address of its own is not this check’s to fetch', async (t) => {
  assert.deepEqual(await previews(site(t, { siteYml: 'name: S\nseo:\n  image: https://cdn.example/card.png\n' })), [])
})

test('descriptions: none, and too long — each listed by route', async (t) => {
  const long = 'x'.repeat(161)
  const dir = site(t, {
    siteYml: 'name: S\nseo:\n  image: https://cdn.example/card.png\n',
    pages: {
      home: 'title: Home\n',
      about: `title: About\ndescription: ${long}\n`,
      contact: 'title: Contact\ndescription: Reach us.\n'
    }
  })
  const issues = await previews(dir)
  assert.deepEqual(ids(issues), ['page-description-none', 'page-description-long'])
  assert.match(issues[0].message, /^1 page states no description$/)
  assert.match(issues[1].message, /^1 description runs past 160 characters$/)
})

test("the home page takes site.yml's description; a noindex page is left out", async (t) => {
  const dir = site(t, {
    siteYml: 'name: S\ndescription: The site.\nseo:\n  image: https://cdn.example/card.png\n',
    pages: {
      home: 'title: Home\n',
      thanks: 'title: Thanks\nseo:\n  noindex: true\n'
    }
  })
  assert.deepEqual(await previews(dir), [])
})

test('a page.yml the build cannot parse is reported as that, not as a missing description', async (t) => {
  const dir = site(t, { pages: { home: 'title: Home\ndescription: Acme: tools for builders\n' } })
  const issues = await previews(dir)
  assert.deepEqual(ids(issues), ['site-content-unreadable'])
  assert.equal(issues[0].type, 'error')
  assert.match(issues[0].message, /could not be parsed as YAML/)
})

// ── the favicon ──────────────────────────────────────────────────────────────

async function favicon(sitePath, { fix = false } = {}) {
  const issues = []
  const siteYml = yaml.load(readFileSync(join(sitePath, 'site.yml'), 'utf8'))
  const fixedLines = []
  await checkFavicon({ sitePath, siteName: 'site', siteYml, issues, shouldFix: () => fix, fixed: (m) => fixedLines.push(m) })
  return { issues, fixedLines }
}

test('a favicon site.yml names, and the site holds, is fine', async (t) => {
  const dir = site(t, { siteYml: 'name: S\nfavicon: /favicon.ico\n', files: { 'public/favicon.ico': 'ico' } })
  assert.deepEqual((await favicon(dir)).issues, [])
})

test('a favicon site.yml names but the site does not hold is a warning', async (t) => {
  const { issues } = await favicon(site(t, { siteYml: 'name: S\nfavicon: /favicon.ico\n' }))
  assert.deepEqual(ids(issues), ['favicon-missing'])
  assert.equal(issues[0].type, 'warn')
})

test('a favicon at an address of its own is left alone', async (t) => {
  assert.deepEqual((await favicon(site(t, { siteYml: 'name: S\nfavicon: https://cdn.example/f.ico\n' }))).issues, [])
})

test('a favicon the build finds but site.yml does not name is a recommendation, fixed by naming it', async (t) => {
  const dir = site(t, { siteYml: '# my site\nname: S\n', files: { 'public/favicon.svg': '<svg/>', 'public/favicon.ico': 'ico' } })
  const found = await favicon(dir)
  assert.deepEqual(ids(found.issues), ['favicon-unnamed'])
  assert.equal(found.issues[0].type, 'info')
  assert.match(found.issues[0].message, /public\/favicon\.svg/)

  const fixed = await favicon(dir, { fix: true })
  assert.equal(fixed.issues[0].fixed, true)
  assert.equal(readFileSync(join(dir, 'site.yml'), 'utf8'), '# my site\nname: S\nfavicon: /favicon.svg\n')
  assert.deepEqual((await favicon(dir)).issues, [])
})

// ── the touch icon ───────────────────────────────────────────────────────────

/** A real PNG of `width`×`height` with an alpha channel, every pixel's alpha `alpha`. */
function pngWithAlpha(width, height, alpha) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const row = Buffer.alloc(width * 4 + 1)
  for (let x = 0; x < width; x++) row[1 + x * 4 + 3] = alpha
  const rows = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

async function touchIcon(sitePath, { fix = false } = {}) {
  const issues = []
  const siteYml = yaml.load(readFileSync(join(sitePath, 'site.yml'), 'utf8'))
  const fixedLines = []
  await checkTouchIcon({ sitePath, siteName: 'site', siteYml, issues, shouldFix: () => fix, fixed: (m) => fixedLines.push(m) })
  return { issues, fixedLines }
}

const named = 'name: S\ntouchIcon: /touch-icon.png\n'

test('a 180×180 opaque PNG the site holds is fine — an unused alpha channel included', async (t) => {
  assert.deepEqual((await touchIcon(site(t, { siteYml: named, files: { 'public/touch-icon.png': png(180, 180) } }))).issues, [])
  assert.deepEqual((await touchIcon(site(t, { siteYml: named, files: { 'public/touch-icon.png': pngWithAlpha(180, 180, 255) } }))).issues, [])
})

test('no touch icon at all is a recommendation, never a warning', async (t) => {
  const { issues } = await touchIcon(site(t))
  assert.deepEqual(ids(issues), ['touch-icon-none'])
  assert.equal(issues[0].type, 'info')
})

test('an apple-touch-icon.png site.yml does not name is a recommendation, fixed by naming it', async (t) => {
  const dir = site(t, { siteYml: '# my site\nname: S\n', files: { 'public/apple-touch-icon.png': png(180, 180) } })
  const found = await touchIcon(dir)
  assert.deepEqual(ids(found.issues), ['touch-icon-unnamed'])
  assert.equal(found.issues[0].type, 'info')

  const fixed = await touchIcon(dir, { fix: true })
  assert.equal(fixed.issues[0].fixed, true)
  assert.equal(readFileSync(join(dir, 'site.yml'), 'utf8'), '# my site\nname: S\ntouchIcon: /apple-touch-icon.png\n')
  assert.deepEqual((await touchIcon(dir)).issues, [])
})

test('a touch icon site.yml names but the site does not hold is a warning', async (t) => {
  const { issues } = await touchIcon(site(t, { siteYml: named }))
  assert.deepEqual(ids(issues), ['touch-icon-missing'])
  assert.equal(issues[0].type, 'warn')
})

test('a touch icon that is not a PNG is a warning', async (t) => {
  const svg = await touchIcon(site(t, { siteYml: named, files: { 'public/touch-icon.png': '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"></svg>' } }))
  assert.deepEqual(ids(svg.issues), ['touch-icon-format'])
  assert.match(svg.issues[0].message, /is SVG, not a PNG/)
  const junk = await touchIcon(site(t, { siteYml: named, files: { 'public/touch-icon.png': 'not an image' } }))
  assert.match(junk.issues[0].message, /could not be read as an image/)
})

test('transparent pixels are a warning: iOS draws them black', async (t) => {
  const { issues } = await touchIcon(site(t, { siteYml: named, files: { 'public/touch-icon.png': pngWithAlpha(180, 180, 0) } }))
  assert.deepEqual(ids(issues), ['touch-icon-transparent'])
  assert.equal(issues[0].type, 'warn')
})

test('not square, or under 180×180, is a recommendation', async (t) => {
  const shape = async (w, h) => {
    const { issues } = await touchIcon(site(t, { siteYml: named, files: { 'public/touch-icon.png': png(w, h) } }))
    assert.deepEqual(ids(issues), ['touch-icon-shape'], `${w}×${h}`)
    assert.equal(issues[0].type, 'info')
    return issues[0].message
  }
  assert.match(await shape(200, 150), /200×150: not square/)
  assert.match(await shape(120, 120), /120×120: under 180×180/)
})

test('a touch icon at an address of its own is left alone', async (t) => {
  assert.deepEqual((await touchIcon(site(t, { siteYml: 'name: S\ntouchIcon: https://cdn.example/t.png\n' }))).issues, [])
})
