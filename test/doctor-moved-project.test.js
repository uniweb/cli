/**
 * `uniweb doctor` on what a moved project gets wrong without a word: a site named for a folder
 * holding other packages, a `@source` that finds nothing, and the prose checks reaching a
 * foundation whose styles sit in `src/`.
 *
 * Measured 2026-10-31 on a repository moved to one folder per project. npm started the foundation
 * instead of the site; the CSS lost about 40% with the build exiting 0; and two prose findings came
 * to light only once the foundations were flat, because the checks read the package root.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'
import { checkSiteNameIsAFolder, checkStaleSources } from '../src/commands/doctor.js'

const named = (siteName, sitePath, packagePaths) => {
  const issues = []
  checkSiteNameIsAFolder({ siteName, sitePath, packagePaths, issues })
  return issues.map((i) => i.id)
}

test('⭐ a site named for the folder holding it and its foundation', () => {
  assert.deepEqual(named('marketing', 'marketing/site', ['marketing/src', 'marketing/site']), ['site-name-is-a-folder'])
})

test('a site named for a folder elsewhere that holds a package', () => {
  assert.deepEqual(named('docs', 'sites/docs', ['docs/src', 'sites/docs']), ['site-name-is-a-folder'])
})

test('CONTROL — the names that work', () => {
  assert.deepEqual(named('marketing-site', 'marketing/site', ['marketing/src', 'marketing/site']), [], 'the convention')
  assert.deepEqual(named('site', 'site', ['src', 'site']), [], 'the default project')
  assert.deepEqual(named('docs', 'docs/site', ['foundations/docs', 'docs/site']), [], 'alone in its folder: npm selects just it')
  assert.deepEqual(named('@acme/site', 'acme/site', ['acme/src', 'acme/site']), [], 'a scoped name is no folder')
  assert.deepEqual(named('docs', 'sites/docs', ['docs-src/src', 'sites/docs']), [], 'a folder that only starts like it')
})

/** A foundation whose stylesheet names a path, with `src/` inside its package or flat. */
function foundationWith(css, { nested = false } = {}) {
  const root = tmp('uw-doctor-source-')
  const srcDir = nested ? join(root, 'src') : root
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'styles.css'), css)
  return srcDir
}

test('⭐ a @source that finds nothing is named, with what is missing', { timeout: 60_000 }, async () => {
  const issues = []
  const srcDir = foundationWith('@source "../node_modules/@uniweb/kit/src/**/*.{js,jsx}";\n')
  await checkStaleSources({ foundationName: '@acme/app', srcDir, issues })
  assert.deepEqual(issues.map((i) => i.id), ['stale-source'])
})

test('CONTROL — a stylesheet whose @source finds what it names, or names only what it may have', { timeout: 60_000 }, async () => {
  const issues = []
  const srcDir = foundationWith('@source "./components/**/*.jsx";\n')
  mkdirSync(join(srcDir, 'node_modules', '@uniweb', 'kit', 'src'), { recursive: true })
  writeFileSync(join(srcDir, 'styles.css'), '@source "./node_modules/@uniweb/kit/src/**/*.jsx";\n@source "./components/**/*.jsx";\n')
  await checkStaleSources({ foundationName: '@acme/app', srcDir, issues })
  assert.deepEqual(issues, [])
})

// ── the whole verb, on a project with a foundation of each shape ─────────────────────

function workspace(files) {
  const root = tmp('uw-doctor-moved-')
  const all = {
    'pnpm-workspace.yaml': "packages:\n  - '*/src'\n  - '*/site'\n",
    'package.json': JSON.stringify({ name: 'w', private: true, workspaces: ['*/src', '*/site'] }),
    ...files
  }
  for (const [rel, body] of Object.entries(all)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  return root
}

const project = (name, { nested, css, section, siteName = `${name}-site` }) => {
  const source = nested ? `${name}/src/src` : `${name}/src`
  return {
    [`${name}/src/package.json`]: JSON.stringify({
      name: `@acme/${name}`,
      main: nested ? './src/_entry.generated.js' : './_entry.generated.js'
    }),
    [`${source}/_entry.generated.js`]: 'export default {}\n',
    [`${source}/styles.css`]: css,
    [`${source}/sections/Post/index.jsx`]: section,
    [`${name}/site/package.json`]: JSON.stringify({ name: siteName, dependencies: { [`@acme/${name}`]: 'file:../src' } }),
    [`${name}/site/site.yml`]: `name: ${name}\nfoundation: '@acme/${name}'\n`,
    [`${name}/site/pages/home/page.yml`]: 'title: Home\n'
  }
}

const ARTICLE = "import { Article } from '@uniweb/kit'\nexport default function Post() { return <Article /> }\n"

const doctor = async (root) => {
  const { doctor: verb } = await import('../src/commands/doctor.js')
  const run = await runVerb(root, verb, [], {})
  return run.output.replace(/\x1b\[[0-9;]*m/g, '')
}

test('⭐ the prose check reaches a foundation with src/ inside its package, and names the path to edit', { timeout: 60_000 }, async () => {
  const out = await doctor(workspace(project('one', { nested: true, css: '@import "tailwindcss";\n', section: ARTICLE })))
  assert.match(out, /\[prose-without-tokens\] @acme\/one/)
  assert.match(out, /Add to one\/src\/src\/styles\.css:/)
})

test('CONTROL — Tailwind Typography styles prose too, so it is not called unstyled', { timeout: 60_000 }, async () => {
  const css = "@import \"tailwindcss\";\n@plugin '@tailwindcss/typography';\n"
  const out = await doctor(workspace(project('one', { css, section: ARTICLE })))
  assert.doesNotMatch(out, /prose-without-tokens/)
})

test('a foundation is named by its path from the workspace root, since several are called src', { timeout: 60_000 }, async () => {
  const root = workspace({
    ...project('one', { css: '', section: 'export default function Post() { return null }\n' }),
    ...project('two', { css: '', section: 'export default function Post() { return null }\n' })
  })
  const out = await doctor(root)
  assert.match(out, /@acme\/one \(folder: one\/src\/\)/)
  assert.match(out, /@acme\/two \(folder: two\/src\/\)/)
})

test('the whole verb says each of them', { timeout: 60_000 }, async () => {
  const root = workspace(
    project('one', {
      siteName: 'one',
      css: '@source "../node_modules/@uniweb/kit/src/**/*.{js,jsx}";\n',
      section: 'export default function Post() { return null }\n'
    })
  )
  const out = await doctor(root)
  assert.match(out, /\[site-name-is-a-folder\] The site package one has the name of a folder holding one\/src/)
  assert.match(out, /\[stale-source\] @acme\/one has a @source that finds nothing/)
  assert.match(out, /@source "\.\.\/node_modules\/@uniweb\/kit\/src\/\*\*\/\*\.\{js,jsx\}"\s+\(no \.\.\/node_modules\/@uniweb\/kit\/src\/\)/)
})
