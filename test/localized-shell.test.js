/**
 * A language's shell (`dist/<locale>/index.html`) carries that language's content, written by the one
 * rule every shell's data is (`@uniweb/core/data-script`): every `<` escaped, so the content reads back
 * as it was, whatever its text holds.
 *
 * ⛔ Until 2026-11-11 the build pasted the language's `site-content.json` in as it was, pretty-printed
 * and unescaped. A `</script>` in any page's text (a code block showing an analytics tag) closed the
 * element early; the prerender's swap for each page's own content stopped there, and every page of
 * that language kept the rest of the site as text after a script that threw. `$$` and `$&` in the
 * text were rewritten as replacement patterns too.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateLocalizedHtml } from '../src/commands/build.js'

const SNIPPET = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>\n<script>\n  gtag("js", new Date());\n</script>'

/** The text of the shell's `__SITE_CONTENT__` element, as a browser reads it: up to its first `</script>`. */
function embedded(html) {
  const open = html.match(/<script[^>]*id="__SITE_CONTENT__"[^>]*>/)
  assert.ok(open, 'the shell carries content')
  const start = open.index + open[0].length
  return html.slice(start, html.indexOf('</script>', start))
}

test("a language's shell embeds its content escaped, and it reads back whole", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'uniweb-localized-shell-'))
  try {
    const dist = join(projectDir, 'dist')
    mkdirSync(join(dist, 'es'), { recursive: true })
    const base = { config: { defaultLanguage: 'en' }, pages: [{ route: '/', sections: [] }] }
    writeFileSync(
      join(dist, 'index.html'),
      `<!doctype html><html lang="en"><head><title>T</title><script type="application/json" id="__SITE_CONTENT__">${JSON.stringify(base)}</script></head><body><div id="root"></div></body></html>`
    )
    const es = {
      config: { defaultLanguage: 'en', activeLocale: 'es' },
      pages: [{ route: '/docs/analytics', sections: [{ content: { text: SNIPPET } }, { content: { text: 'Matemáticas: $$x^2$$, y $& en una expresión.' } }] }],
    }
    writeFileSync(join(dist, 'es', 'site-content.json'), JSON.stringify(es, null, 2))

    await generateLocalizedHtml(projectDir, { locales: ['es'] })

    const html = readFileSync(join(dist, 'es', 'index.html'), 'utf8')
    assert.match(html, /<html lang="es"/)
    assert.equal(html.match(/id="__SITE_CONTENT__"/g).length, 1)
    assert.deepEqual(JSON.parse(embedded(html)), es)
    // Nothing of the content is left outside its element: the page ends as the shell did.
    assert.ok(html.trimEnd().endsWith('<div id="root"></div></body></html>'), html.slice(-200))
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})
