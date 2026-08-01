/**
 * `uniweb doctor` — a form with nowhere to send it.
 *
 * A form whose site has no submission destination renders as a disabled
 * control. That is the correct behaviour (the alternative is posting a
 * visitor's answers into a 404) but it is only visible by looking at the page,
 * so it is exactly the kind of thing that ships unnoticed.
 *
 * The check is deliberately narrow, and the suppression is the interesting
 * half: a destination can come from `submit:` in site.yml OR from the host at
 * serve time, and doctor can only see the first. Warning whenever `submit:` is
 * absent would fire on every correctly-configured hosted site — nagging the
 * people who got it right, which is how a check trains everyone to ignore it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findFormContent, checkFormSubmitTarget } from '../src/commands/doctor.js'

function makeSite(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-form-'))
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, body)
  }
  return dir
}

const FORM_MD = ['---', 'type: ContactForm', '---', '', '```yaml:form', 'fields:', '  - name: email', '```', ''].join('\n')

test('findFormContent — finds a form block in a page', () => {
  const dir = makeSite({ 'pages/contact/1-form.md': FORM_MD })
  try {
    assert.deepEqual(findFormContent(dir, {}), [join('pages', 'contact', '1-form.md')])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findFormContent — accepts every serialization spelling of the tag', () => {
  for (const fence of ['```yaml:form', '```yml:form', '```json:form', '````yaml:form']) {
    const dir = makeSite({ 'pages/a/s.md': `${fence}\nx: 1\n\`\`\`\n` })
    try {
      assert.equal(findFormContent(dir, {}).length, 1, `expected a hit for ${fence}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

/**
 * The parser's `processCodeInfo` splits the info string on ':' and trims
 * neither half, so a space around the colon produces the tag `" form"` — which
 * lands at `content.data[" form"]` and is not a form. Matching it here would
 * warn about a block that is not one, so the detector is exactly as strict as
 * the parser rather than merely close to it.
 */
test('findFormContent — rejects whitespace around the colon, as the parser does', () => {
  const dir = makeSite({
    'pages/a/s.md': '```yaml: form\nx: 1\n```\n',
    'pages/b/s.md': '```yaml :form\nx: 1\n```\n',
  })
  try {
    assert.deepEqual(findFormContent(dir, {}), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findFormContent — ignores other tagged blocks', () => {
  const dir = makeSite({
    'pages/a/s.md': '```yaml:nav\n- label: Home\n```\n',
    'pages/b/s.md': '```yaml:formatting\nx: 1\n```\n', // `form` must not match a prefix
    'pages/c/s.md': '```js\nconst form = 1\n```\n',
  })
  try {
    assert.deepEqual(findFormContent(dir, {}), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findFormContent — scans layout/ and honours paths.pages', () => {
  const dir = makeSite({ 'layout/header.md': FORM_MD, 'content/home/s.md': FORM_MD })
  try {
    const found = findFormContent(dir, { paths: { pages: 'content' } })
    assert.equal(found.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findFormContent — an absent pages/ is not an error', () => {
  const dir = makeSite({ 'site.yml': 'name: Empty\n' })
  try {
    assert.deepEqual(findFormContent(dir, {}), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('warns when a form has no destination and no host is in the picture', async () => {
  const dir = makeSite({ 'pages/contact/1-form.md': FORM_MD })
  const issues = []
  try {
    await checkFormSubmitTarget({ sitePath: dir, siteName: 'site', siteYml: {}, issues })
    assert.equal(issues.length, 1)
    assert.equal(issues[0].id, 'form-without-submit-target')
    assert.equal(issues[0].type, 'warning')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('silent when the site declares submit:', async () => {
  const dir = makeSite({ 'pages/contact/1-form.md': FORM_MD })
  const issues = []
  try {
    await checkFormSubmitTarget({ sitePath: dir, siteName: 'site', siteYml: { submit: '/forms' }, issues })
    assert.deepEqual(issues, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The suppression that keeps this check from nagging correctly-configured
// hosted sites, where having no `submit:` is the right answer.
test('silent when a deploy target means a host may supply one', async () => {
  const dir = makeSite({
    'pages/contact/1-form.md': FORM_MD,
    'deploy.yml': 'targets:\n  production:\n    host: uniweb\n',
  })
  const issues = []
  try {
    await checkFormSubmitTarget({ sitePath: dir, siteName: 'site', siteYml: {}, issues })
    assert.deepEqual(issues, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('silent when the site has no forms at all', async () => {
  const dir = makeSite({ 'pages/home/1-hero.md': '# Hello\n' })
  const issues = []
  try {
    await checkFormSubmitTarget({ sitePath: dir, siteName: 'site', siteYml: {}, issues })
    assert.deepEqual(issues, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
