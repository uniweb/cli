/**
 * A foundation's NAME — what it registers as (`@org/<name>`) and what sites pin.
 *
 * It is `main.js`'s `name`, else package.json's (`@uniweb/build`'s
 * `readFoundationName`). `src` and `foundation` name the folder the code sits in,
 * so they are refused as a name: every project in an org would register the same
 * `@org/src`. The CLI's part is WRITING the name — the scaffold at `create` / `add`,
 * and `register` when a foundation has none — by text edits, since `create` runs
 * before anything is installed. So every edit here is read back through the
 * build's own rule: a text edit that the build does not read as the name is the
 * failure this file exists to catch.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import prompts from 'prompts'
import { readFoundationName, FORBIDDEN_FOUNDATION_NAMES } from '@uniweb/build'
import {
  SCAFFOLD_FOLDER_NAMES,
  normalizeFoundationName,
  suggestFoundationName,
  mainNamesFoundation,
  writeFoundationName,
  ensureFoundationName
} from '../src/utils/foundation-name.js'
import { scaffoldFoundation, applyContent } from '../src/utils/scaffold.js'

const made = []
process.on('exit', () => made.forEach((d) => rmSync(d, { recursive: true, force: true })))
const tmp = (prefix) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  made.push(dir)
  return dir
}

/** A flat-layout foundation package: package.json, and main.js when given. */
function pkgDir({ name = 'src', main } = {}) {
  const dir = tmp('uw-cli-fname-')
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.1.0', type: 'module', main: './_entry.generated.js' })
  )
  if (main !== undefined) writeFileSync(join(dir, 'main.js'), main)
  return dir
}
const nameOf = async (dir) => (await readFoundationName(dir)).name

test('the folder names the CLI will not write are exactly the ones the build refuses', () => {
  // The one fact this module duplicates, because it cannot import @uniweb/build.
  assert.deepEqual([...SCAFFOLD_FOLDER_NAMES].sort(), [...FORBIDDEN_FOUNDATION_NAMES].sort())
})

test('normalizeFoundationName makes a name from free text, never a folder name', () => {
  assert.equal(normalizeFoundationName('My Site'), 'my-site')
  assert.equal(normalizeFoundationName('@acme/Docs_Portal'), 'docs-portal')
  assert.equal(normalizeFoundationName('--x--'), 'x')
  assert.equal(normalizeFoundationName('src'), null)
  assert.equal(normalizeFoundationName('Foundation'), null)
  assert.equal(normalizeFoundationName('!!!'), null)
  assert.equal(normalizeFoundationName(undefined), null)
})

test('suggestFoundationName offers the folder — or, for src/, the project folder', () => {
  assert.equal(suggestFoundationName('/work/my-site/src'), 'my-site')
  assert.equal(suggestFoundationName('/work/ws/foundation'), 'ws')
  assert.equal(suggestFoundationName('/work/ws/foundations/ui'), 'ui')
})

test('mainNamesFoundation sees a top-level name, and only that', () => {
  assert.equal(mainNamesFoundation("export default { name: 'x' }"), true)
  assert.equal(mainNamesFoundation("const name = 'x'\nexport default { name }"), true)
  // CONTROL — the same word nested, commented out, or inside a string is not a name
  assert.equal(mainNamesFoundation("export default { props: { name: 'x' } }"), false)
  assert.equal(mainNamesFoundation("export default {\n  // name: 'x'\n  props: {},\n}"), false)
  assert.equal(mainNamesFoundation("export default { title: 'a, name: b' }"), false)
})

test('writeFoundationName creates main.js when there is none — and the build reads it', async () => {
  const dir = pkgDir()
  assert.deepEqual(writeFoundationName(join(dir, 'main.js'), 'marketing'), { ok: true })
  assert.equal(await nameOf(dir), 'marketing')
})

test('writeFoundationName adds the name to an existing export, keeping the rest', async () => {
  const empty = pkgDir({ main: 'export default {}\n' })
  writeFoundationName(join(empty, 'main.js'), 'marketing')
  assert.equal(await nameOf(empty), 'marketing')

  const full = pkgDir({
    main: "export const vars = { 'header-height': { default: '4rem' } }\n\nexport default {\n  // Foundation-wide props\n  props: { tone: 'warm' },\n}\n"
  })
  writeFoundationName(join(full, 'main.js'), 'marketing')
  const text = readFileSync(join(full, 'main.js'), 'utf8')
  assert.match(text, /export default \{\n {2}\/\/ What this foundation registers as[^\n]*\n {2}name: 'marketing',\n\n {2}\/\/ Foundation-wide props/)
  assert.equal(await nameOf(full), 'marketing')
  const { default: config, vars } = await import(`${join(full, 'main.js')}?check`)
  assert.deepEqual(config.props, { tone: 'warm' })
  assert.ok(vars['header-height'])
})

test('writeFoundationName replaces a name that cannot register — only when there is exactly one', async () => {
  const dir = pkgDir({ main: "export default {\n  name: 'src',\n  props: {},\n}\n" })
  assert.deepEqual(writeFoundationName(join(dir, 'main.js'), 'marketing', { replace: 'src' }), { ok: true })
  assert.equal(await nameOf(dir), 'marketing')

  const two = pkgDir({ main: "export default { name: 'src', props: { name: 'src' } }\n" })
  const res = writeFoundationName(join(two, 'main.js'), 'marketing', { replace: 'src' })
  assert.equal(res.ok, false)
  assert.match(res.reason, /exactly one place/)
})

test('writeFoundationName says so, rather than guessing, when there is no object export', () => {
  const dir = pkgDir({ main: 'const config = {}\nexport default config\n' })
  const res = writeFoundationName(join(dir, 'main.js'), 'marketing')
  assert.equal(res.ok, false)
  assert.match(res.reason, /no `export default \{/)
})

test("ensureFoundationName gives a name unless main.js has one — a template's own wins", async () => {
  const unnamed = pkgDir({ main: 'export default {\n  props: {},\n}\n' })
  ensureFoundationName(unnamed, 'my-site')
  assert.equal(await nameOf(unnamed), 'my-site')

  const named = pkgDir({ main: "export default { name: 'acme-docs' }\n" })
  ensureFoundationName(named, 'my-site')
  assert.equal(await nameOf(named), 'acme-docs')

  // CONTROL — a nested `name` is not the foundation's, so it gets one
  const nested = pkgDir({ main: "export default { props: { name: 'x' } }\n" })
  ensureFoundationName(nested, 'my-site')
  assert.equal(await nameOf(nested), 'my-site')
})

test('the scaffold names the foundation — and content applied over it does not unname it', async () => {
  const dir = pkgDir()
  await scaffoldFoundation(dir, { name: 'src', registryName: 'my-site', projectName: 'my-site' })
  assert.equal(await nameOf(dir), 'my-site')

  const ext = pkgDir()
  await scaffoldFoundation(ext, { name: 'effects', registryName: 'effects', projectName: 'p', isExtension: true })
  assert.equal(await nameOf(ext), 'effects')

  // A template's main.js replaces the scaffolded one; the caller names it again.
  const content = tmp('uw-cli-content-')
  mkdirSync(join(content, 'sections'))
  writeFileSync(join(content, 'main.js'), 'export default {\n  props: {},\n}\n')
  await applyContent(content, dir, { projectName: 'my-site' })
  assert.equal(await nameOf(dir), 'src', 'the template main.js carries no name')
  ensureFoundationName(dir, 'my-site')
  assert.equal(await nameOf(dir), 'my-site')
})

test('CONTROL — with no name to give, the scaffold writes none', async () => {
  const dir = pkgDir()
  await scaffoldFoundation(dir, { name: 'src', projectName: 'src' })
  assert.equal(mainNamesFoundation(readFileSync(join(dir, 'main.js'), 'utf8')), false)
})

test('register asks for a name once, and keeps it in main.js', async () => {
  const { settleFoundationName } = await import('../src/commands/register.js')
  const asked = async (dir, answer) => {
    const saved = { ci: process.env.CI, tty: process.stdin.isTTY }
    delete process.env.CI
    process.stdin.isTTY = true
    prompts.inject([answer])
    try {
      return await settleFoundationName(dir, { args: [], isPreview: false })
    } finally {
      if (saved.ci !== undefined) process.env.CI = saved.ci
      process.stdin.isTTY = saved.tty
    }
  }

  // Named by the package alone: the name is added to main.js
  const byPackage = pkgDir({ main: 'export default {\n  props: {},\n}\n' })
  assert.equal(await asked(byPackage, 'marketing'), true)
  assert.equal(await nameOf(byPackage), 'marketing')

  // Named `src` in main.js itself: that literal is replaced
  const byMain = pkgDir({ name: 'whatever', main: "export default { name: 'src' }\n" })
  assert.equal(await asked(byMain, 'marketing'), true)
  assert.equal(await nameOf(byMain), 'marketing')

  // CONTROL — a foundation with a name of its own is not asked, and not touched
  const fine = pkgDir({ main: "export default { name: 'docs' }\n" })
  const before = readFileSync(join(fine, 'main.js'), 'utf8')
  assert.equal(await settleFoundationName(fine, { args: ['--non-interactive'], isPreview: false }), true)
  assert.equal(readFileSync(join(fine, 'main.js'), 'utf8'), before)
})
