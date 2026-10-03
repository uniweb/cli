/**
 * ⭐ A REFUSAL THE TERMINAL MAY SETTLE (2026-10-03). When everything a publish
 * owes is a change to a plan the site already has, the `402` carries `confirm: { prompt, token }`
 * beside its door. At an interactive terminal the owner answers the backend's own sentence — confirm,
 * open the app, or cancel, with Enter cancelling — and confirming publishes again with the token.
 *
 * ⛔ The property this file exists for, beside the happy path: nothing confirms unattended. With no
 * one at the terminal there is no prompt, and the refusal is reported exactly as it was before confirms existed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readPaymentRefusal, settleRefusal } from '../src/backend/payment-handoff.js'
import { BackendClient } from '../src/backend/client.js'

const PROBLEM = 'application/problem+json'
const DOOR = 'https://app.example.test/publish/abc123'
const PROMPT = 'Publishing changes what this site pays for — hosting: add Site Search, $4.83 now, then $25.00/month, on Visa ••4242. Confirm and publish?'
const DETAIL = 'this site asks for Site Search — confirm the change in the app to publish'

const body = ({ confirm = { prompt: PROMPT, token: 'tok/1+2=' }, url = DOOR, detail = DETAIL } = {}) =>
  JSON.stringify({
    status: 402,
    title: 'Payment Required',
    detail,
    reason: 'pending_request',
    ...(url ? { remedy_url: url } : {}),
    ...(confirm ? { confirm } : {})
  })
const verdict = (opts) => readPaymentRefusal({ status: 402, contentType: PROBLEM, body: body(opts) })
const refused = (opts) =>
  new Response(body(opts), { status: 402, statusText: 'Payment Required', headers: { 'content-type': PROBLEM } })
const published = () => new Response(JSON.stringify({ deploy_uuid: 'd1', url: 'https://site.test/', status: 'delivered' }), { status: 200 })

function harness({ answers = [], responses = [] } = {}) {
  const lines = []
  const say = Object.fromEntries(['ok', 'info', 'warn', 'err', 'dim'].map((k) => [k, (m) => lines.push(`${k}: ${m}`)]))
  const asked = []
  const ask = async (question, options, fallback) => {
    asked.push({ question, options, fallback })
    const answer = answers.shift()
    return answer === undefined ? fallback : answer
  }
  const tokens = []
  const republish = async (token) => {
    tokens.push(token)
    return responses.shift()()
  }
  const opened = []
  const open = async (url) => (opened.push(url), true)
  return { say, ask, republish, open, lines, asked, tokens, opened }
}

test('reads the confirm whole — a prompt and a token, from a problem body only', () => {
  assert.deepEqual(verdict().confirm, { prompt: PROMPT, token: 'tok/1+2=' })
  assert.equal(verdict({ confirm: { prompt: PROMPT } }).confirm, null)
  assert.equal(verdict({ confirm: { token: 't' } }).confirm, null)
  assert.equal(verdict({ confirm: null }).confirm, null)
  const plain = readPaymentRefusal({ status: 402, contentType: 'application/json', body: body() })
  assert.equal(plain.confirm, null)
})

test('CONTROL — no one at the terminal: no prompt, the door printed, nothing published again', async () => {
  const h = harness()
  const out = await settleRefusal({ verdict: verdict(), args: ['--non-interactive'], interactive: false, ...h })
  assert.deepEqual(out, { exitCode: 1 })
  assert.equal(h.asked.length, 0)
  assert.equal(h.tokens.length, 0)
  assert.ok(h.lines.includes(`err: ${DETAIL}`))
  assert.ok(h.lines.some((l) => l.includes(DOOR)))
})

test('the question is the backend\'s sentence, verbatim — and Enter cancels', async () => {
  const h = harness({ answers: [undefined] })
  const out = await settleRefusal({ verdict: verdict(), interactive: true, ...h })
  assert.deepEqual(out, { exitCode: 1 })
  assert.deepEqual(h.asked, [{ question: PROMPT, options: ['Confirm and publish', 'Open it in the app', 'Cancel'], fallback: 'Cancel' }])
  assert.equal(h.tokens.length, 0)
  assert.equal(h.opened.length, 0)
})

test('opening the app opens the door verbatim, and publishes nothing', async () => {
  const h = harness({ answers: ['Open it in the app'] })
  const out = await settleRefusal({ verdict: verdict(), interactive: true, ...h })
  assert.deepEqual(out, { exitCode: 1 })
  assert.deepEqual(h.opened, [DOOR])
  assert.equal(h.tokens.length, 0)
})

test('confirming publishes again with the token as it came — and a 200 is the publish', async () => {
  const h = harness({ answers: ['Confirm and publish'], responses: [published] })
  const out = await settleRefusal({ verdict: verdict(), interactive: true, ...h })
  assert.deepEqual(h.tokens, ['tok/1+2='])
  assert.equal(out.response.status, 200)
})

test('a fresh confirm means nothing was applied: asked again, with the new sentence and token', async () => {
  const moved = 'Publishing changes what this site pays for — hosting: add Site Search, $5.10 now, then $25.00/month, on Visa ••4242. Confirm and publish?'
  const h = harness({
    answers: ['Confirm and publish', 'Confirm and publish'],
    responses: [() => refused({ confirm: { prompt: moved, token: 'tok-2' } }), published]
  })
  const out = await settleRefusal({ verdict: verdict(), interactive: true, ...h })
  assert.deepEqual(h.asked.map((a) => a.question), [PROMPT, moved])
  assert.deepEqual(h.tokens, ['tok/1+2=', 'tok-2'])
  assert.ok(h.lines.some((l) => l.startsWith('warn: ') && l.includes('nothing was applied')))
  assert.equal(out.response.status, 200)
})

test('a refusal without a confirm — the card could not settle it: its sentence, and its door', async () => {
  const declined = 'your card was declined — update it in the app to publish'
  const h = harness({ answers: ['Confirm and publish'], responses: [() => refused({ confirm: null, detail: declined })] })
  const out = await settleRefusal({ verdict: verdict(), interactive: true, ...h })
  assert.deepEqual(out, { exitCode: 1 })
  assert.ok(h.lines.includes(`err: ${declined}`))
  assert.deepEqual(h.opened, [DOOR])
})

test('a failure that is not payment comes back to the caller, with its body read', async () => {
  const h = harness({ answers: ['Confirm and publish'], responses: [() => new Response('boom', { status: 500 })] })
  const out = await settleRefusal({ verdict: verdict(), interactive: true, ...h })
  assert.equal(out.response.status, 500)
  assert.equal(out.body, 'boom')
})

test('with no door, the choices are confirm or cancel', async () => {
  const h = harness({ answers: [undefined] })
  await settleRefusal({ verdict: verdict({ url: null }), interactive: true, ...h })
  assert.deepEqual(h.asked[0].options, ['Confirm and publish', 'Cancel'])
})

test('the confirming publish carries the token URL-encoded, and the same body', async () => {
  const calls = []
  const client = new BackendClient({
    origin: 'http://backend.test',
    token: 'TKN',
    fetchImpl: async (url, init) => (calls.push({ url: String(url), body: init?.body }), new Response('{}', { status: 200 }))
  })
  await client.publishSite('site-1', { languages: ['en', 'fr'], confirm: 'tok/1+2=' })
  const publish = calls.find((c) => c.url.includes('/dev/site/publish/'))
  assert.equal(publish.url, 'http://backend.test/dev/site/publish/site-1?confirm=tok%2F1%2B2%3D')
  assert.deepEqual(JSON.parse(publish.body), { languages: ['en', 'fr'] })
})
