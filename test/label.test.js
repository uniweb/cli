/**
 * `uniweb label` places a picture's words over it, in a browser on this machine, and writes them
 * into the section's `@std/overlay` block. These check what it writes and where, which sections it
 * finds, and that what it serves reads the section and saves it back as drawn.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { blockText, withBlock } from '../src/commands/label.js'

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src/index.js')

const OVERLAY = {
  baked: ['en'],
  sizes: { title: 4.3, label: 1 },
  labels: [
    { text: 'YOU', x: 20.9, y: 14.65, w: 8.8, h: 7.3, role: 'title' },
    { role: 'text', text: 'Two\nlines', x: 40, y: 60, w: 12, h: 6, align: 'left', size: 1.05 },
  ],
}

test('writes the block as an author does: baked, sizes, then a label a line in the standard’s order', () => {
  assert.equal(
    blockText(OVERLAY, 'overlay'),
    [
      '```yaml:overlay',
      'baked: [en]',
      'sizes: { title: 4.3, label: 1 }',
      'labels:',
      '  - { text: "YOU", x: 20.9, y: 14.65, w: 8.8, h: 7.3, role: title }',
      '  - { text: "Two\\nlines", x: 40, y: 60, w: 12, h: 6, role: text, align: left, size: 1.05 }',
      '```',
    ].join('\n'),
  )
  // No baked and no sizes: neither is written.
  assert.equal(blockText({ labels: [] }, 'overlay'), '```yaml:overlay\nlabels: []\n```')
})

test('writes the picture’s colors after the sizes, quoted, and leaves out an empty dark', () => {
  const colored = {
    baked: ['en'],
    color: '#232d42',
    dark: { color: '#d6d9de', ground: '#0a1123' },
    labels: [
      { text: 'YOU', x: 20, y: 14, role: 'title', ground: '#fbfcff', dark: {} },
      { text: 'NEW', x: 50, y: 50, color: '#fff', dark: { ground: '#1d3f99' } },
    ],
  }
  // A pair written ground first, as a sample may set it, is written in the standard's order.
  colored.dark = { ground: '#0a1123', color: '#d6d9de' }
  assert.equal(
    blockText(colored, 'overlay'),
    [
      '```yaml:overlay',
      'baked: [en]',
      'color: "#232d42"',
      'dark: { color: "#d6d9de", ground: "#0a1123" }',
      'labels:',
      '  - { text: "YOU", x: 20, y: 14, role: title, ground: "#fbfcff" }',
      '  - { text: "NEW", x: 50, y: 50, color: "#fff", dark: { ground: "#1d3f99" } }',
      '```',
    ].join('\n'),
  )
})

test('replaces the block it finds, and with none places it after the last picture, before any item', () => {
  const block = '```yaml:overlay\nlabels: []\n```'
  assert.equal(
    withBlock('# T\n\n![A](/a.png)\n\n```yaml:overlay\nold: 1\n```\n\nAfter.\n', block, 'overlay'),
    '# T\n\n![A](/a.png)\n\n```yaml:overlay\nlabels: []\n```\n\nAfter.\n',
  )
  assert.equal(
    withBlock('# T\n![A](/a.png)\nWords.\n\n### Item\n\nIts text.\n', block, 'overlay'),
    '# T\n![A](/a.png)\n\n```yaml:overlay\nlabels: []\n```\n\nWords.\n\n### Item\n\nIts text.\n',
  )
})

/** A site on a local foundation whose Diagram type takes a picture's words. */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'label-'))
  const w = (rel, body) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  w('site/site.yml', 'name: t\nfoundation: fnd\nindex: home\nlanguages: [en, fr]\n')
  w('site/package.json', { name: 'site', dependencies: { fnd: 'file:../fdn' } })
  w('fdn/package.json', { name: 'fnd', type: 'module', main: './_entry.generated.js' })
  w('fdn/main.js', "export default { name: '@acme/fnd' }\n")
  w('fdn/sections/Diagram/meta.js', "export default { title: 'Diagram', data: { overlay: { schema: '@std/overlay', single: true } } }\n")
  w('fdn/sections/Diagram/index.jsx', 'export default function Diagram() { return null }\n')
  w('fdn/sections/Plain/meta.js', "export default { title: 'Plain' }\n")
  w('fdn/sections/Plain/index.jsx', 'export default function Plain() { return null }\n')
  w('site/pages/home/page.yml', 'title: Home\n')
  w('site/pages/home/1-stack.md', '---\ntype: Diagram\n---\n\n# The stack\n\n![The stack](/stack.png)\n\n```yaml:overlay\nbaked: [en]\nlabels:\n  - { text: "YOU", x: 20, y: 14, w: 8, h: 7, role: title }\n```\n')
  w('site/pages/home/2-plain.md', '---\ntype: Plain\n---\n\n# Plain\n')
  w('site/locales/fr.json', {})
  return { root, site: join(root, 'site') }
}

test('lists the sections of a type that takes a picture’s words', () => {
  const { root, site } = project()
  try {
    const out = execFileSync('node', [CLI, 'label'], { cwd: site, encoding: 'utf8' })
    assert.match(out, /pages\/home\/1-stack\.md\s+\(Diagram, `overlay`: 1 label, 1 picture\)/)
    assert.doesNotMatch(out, /2-plain/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('serves the section, and saves what was drawn into its block', async () => {
  const { root, site } = project()
  const child = spawn('node', [CLI, 'label', 'pages/home/1-stack.md', '--no-open', '--port', '0'], { cwd: site })
  try {
    const address = await new Promise((resolve, reject) => {
      let out = ''
      child.stdout.on('data', (chunk) => {
        out += chunk
        const found = out.match(/http:\/\/127\.0\.0\.1:\d+\//)
        if (found) resolve(found[0])
      })
      child.on('exit', () => reject(new Error(`stopped: ${out}`)))
    })
    const page = await (await fetch(address)).text()
    const token = page.match(/const TOKEN = '([0-9a-f]+)'/)[1]
    const api = (path, body) =>
      fetch(new URL(path, address), {
        method: body ? 'POST' : 'GET',
        headers: { 'X-Labeller-Token': token, ...(body && { 'Content-Type': 'application/json' }) },
        body: body && JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, data: await r.json() }))

    // Without the page's token, nothing.
    assert.equal((await fetch(new URL('/api/section', address))).status, 403)

    const { data: section } = await api('/api/section')
    assert.equal(section.type, 'Diagram')
    assert.equal(section.tag, 'overlay')
    assert.deepEqual(section.vocabulary.roles, ['title', 'label', 'text', 'note'])
    assert.deepEqual(section.languages, ['en', 'fr'])
    assert.deepEqual(section.overlay.labels[0], { text: 'YOU', x: 20, y: 14, w: 8, h: 7, role: 'title' })

    // Saving it as it is changes nothing.
    const same = await api('/api/save', { overlay: section.overlay, version: section.version })
    assert.equal(same.status, 200)
    assert.equal(same.data.unchanged, true)

    const drawn = { ...section.overlay, sizes: { title: 4.3 }, labels: [...section.overlay.labels, { text: 'Engine', x: 50, y: 50 }] }
    const saved = await api('/api/save', { overlay: drawn, version: same.data.version })
    assert.equal(saved.status, 200)
    assert.match(readFileSync(join(site, 'pages/home/1-stack.md'), 'utf8'), /sizes: \{ title: 4\.3 \}\nlabels:\n  - \{ text: "YOU".*\n  - \{ text: "Engine", x: 50, y: 50 \}\n```\n$/)

    // An old version is refused, unless forced.
    const stale = await api('/api/save', { overlay: drawn, version: section.version })
    assert.equal(stale.status, 409)
  } finally {
    child.kill()
    rmSync(root, { recursive: true, force: true })
  }
})
