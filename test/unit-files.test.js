/**
 * A section unit is named by its id (`pages/about/about.md`), and the author's file may be
 * `1-about.md` or `@about.md` — a pull writes into it in place. A push records the files it
 * delivered so the next `pull --merge` merges against them; mapping the unit to a file that
 * does not exist recorded nothing, and the next merge reported a false conflict on a line only
 * the other side had changed (measured 2026-10-07 on the starter's `1-welcome.md`).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { unitFilesOf } from '../src/backend/site-sync.js'

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-unit-files-'))
  writeFileSync(join(dir, 'site.yml'), 'name: t\n')
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  return dir
}

test('a numbered section file is found by its id', () => {
  const dir = site({ 'pages/about/1-about.md': '# About\n' })
  assert.deepEqual(unitFilesOf(dir, 'pages/about/about.md'), ['pages/about/1-about.md'])
})

test('a child section file is found by its id', () => {
  const dir = site({ 'pages/home/@cta.md': '# Go\n' })
  assert.deepEqual(unitFilesOf(dir, 'pages/home/cta.md'), ['pages/home/@cta.md'])
})

test('control: a file named by its id is itself', () => {
  const dir = site({ 'pages/about/about.md': '# About\n', 'pages/about/1-other.md': '# x\n' })
  assert.deepEqual(unitFilesOf(dir, 'pages/about/about.md'), ['pages/about/about.md'])
})

test('a page.yml and a missing file keep their path', () => {
  const dir = site({ 'pages/about/page.yml': 'title: About\n' })
  assert.deepEqual(unitFilesOf(dir, 'pages/about/page.yml'), ['pages/about/page.yml'])
  assert.deepEqual(unitFilesOf(dir, 'pages/gone/gone.md'), ['pages/gone/gone.md'])
})

test('site.yml stands for the info unit', () => {
  assert.deepEqual(unitFilesOf(site({}), 'site.yml'), ['site.yml', 'theme.yml', 'head.html'])
})
