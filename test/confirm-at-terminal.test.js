/**
 * ⭐ A REFUSAL THE TERMINAL MAY SETTLE (2026-10-03). When everything a publish owes is a change to a
 * plan the site already has, the `402` carries `confirm: { prompt, token, reduction }` beside its
 * door. At an interactive terminal the owner answers the backend's own sentence — confirm, open the
 * app, or cancel — and confirming publishes again with the token.
 *
 * ⛔ The properties this file exists for, beside the happy path: A CHARGE IS NEVER CONFIRMED
 * UNATTENDED — Enter cancels it, `--yes` does not answer it, and with no one at the terminal it is
 * reported exactly as before confirms existed. A REDUCTION asks lightly — Enter continues — and
 * `--yes` answers it, telling the backend it went unanswered (`&unattended=true`).
 * [Diego, 2026-10-03: "allow it for reductions only, keep charges interactive".]
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readPaymentRefusal, settleRefusal } from '../src/backend/payment-handoff.js'
import { BackendClient } from '../src/backend/client.js'

const PROBLEM = 'application/problem+json'
const DOOR = 'https://app.example.test/publish/abc123'
const PROMPT = 'Publishing changes what this site pays for — hosting: add Site Search, $4.83 now, then $25.00/month, on Visa ••4242. Confirm and publish?'
const DETAIL = 'this site asks for Site Search — confirm the change in the app to publish'

const LOWER = 'Publishing lowers what this site pays — hosting: remove Site Search, a credit of $5.00 now, then $10.00/month, on Visa ••4242. Continue and publish?'
const REDUCTION = { prompt: LOWER, token: 'red-1', reduction: true }

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
  const unattended = []
  const republish = async (token, options = {}) => {
    tokens.push(token)
    unattended.push(options.unattended === true)
    return responses.shift()()
  }
  const opened = []
  const open = async (url) => (opened.push(url), true)
  return { say, ask, republish, open, lines, asked, tokens, unattended, opened }
}

test('reads the confirm whole — a prompt and a token, from a problem body only', () => {
  assert.deepEqual(verdict().confirm, { prompt: PROMPT, token: 'tok/1+2=', reduction: false })
  assert.deepEqual(verdict({ confirm: REDUCTION }).confirm, REDUCTION)
  // Only `true` is a reduction: anything else is asked as a charge.
  assert.equal(verdict({ confirm: { ...REDUCTION, reduction: 'yes' } }).confirm.reduction, false)
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

test('a refusal without a confirm — no longer confirmable here: its sentence, and its door', async () => {
  // E.g. the request now asks for a first plan, which the app settles. Never a declined card: a
  // confirmed change is invoiced as it applies.
  const declined = 'this site now asks for a hosting plan — choose one in the app to publish'
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

test('a reduction asks lightly: its own words, Continue first, and Enter continues', async () => {
  const h = harness({ answers: [undefined], responses: [published] })
  const out = await settleRefusal({ verdict: verdict({ confirm: REDUCTION }), interactive: true, ...h })
  assert.deepEqual(h.asked, [{ question: LOWER, options: ['Continue and publish', 'Open it in the app', 'Cancel'], fallback: 'Continue and publish' }])
  assert.deepEqual(h.tokens, ['red-1'])
  assert.deepEqual(h.unattended, [false]) // a person answered it
  assert.equal(out.response.status, 200)
})

test('`--yes` answers a reduction without asking — and says so to the backend, and in the log', async () => {
  for (const interactive of [false, true]) {
    const h = harness({ responses: [published] })
    const out = await settleRefusal({ verdict: verdict({ confirm: REDUCTION }), args: ['--yes'], interactive, ...h })
    assert.equal(h.asked.length, 0)
    assert.deepEqual(h.tokens, ['red-1'])
    assert.deepEqual(h.unattended, [true])
    assert.ok(h.lines.includes(`info: ${LOWER}`))
    assert.equal(out.response.status, 200)
  }
})

test('CONTROL — no one at the terminal and no `--yes`: a reduction is reported, not answered — with the flag that would', async () => {
  const h = harness()
  const out = await settleRefusal({ verdict: verdict({ confirm: REDUCTION }), interactive: false, ...h })
  assert.deepEqual(out, { exitCode: 1 })
  assert.equal(h.tokens.length, 0)
  assert.ok(h.lines.some((l) => l.includes('uniweb publish --yes')))
})

test('⛔ `--yes` never answers a charge — and, never blocking on a prompt, does not ask it either', async () => {
  const atTerminal = harness()
  const asked = await settleRefusal({ verdict: verdict(), args: ['--yes'], interactive: true, ...atTerminal })
  assert.deepEqual(asked, { exitCode: 1 })
  assert.equal(atTerminal.asked.length, 0)
  assert.equal(atTerminal.tokens.length, 0)
  assert.equal(atTerminal.opened.length, 0) // reported as an unattended run is: the link printed, not opened
  assert.ok(atTerminal.lines.some((l) => l.includes('without `--yes`')))

  const unattended = harness()
  const reported = await settleRefusal({ verdict: verdict(), args: ['--yes'], interactive: false, ...unattended })
  assert.deepEqual(reported, { exitCode: 1 })
  assert.equal(unattended.tokens.length, 0)
  assert.ok(unattended.lines.includes(`err: ${DETAIL}`))
})

test('a reduction that turns into a charge is not answered by `--yes`', async () => {
  const h = harness({ responses: [() => refused()] }) // the fresh offer charges
  const out = await settleRefusal({ verdict: verdict({ confirm: REDUCTION }), args: ['--yes'], interactive: false, ...h })
  assert.deepEqual(h.unattended, [true])
  assert.deepEqual(out, { exitCode: 1 })
  assert.ok(h.lines.some((l) => l.startsWith('warn: ') && l.includes('nothing was applied')))
})

test('a reduction offered again and again is answered a few times, then reported', async () => {
  const again = () => refused({ confirm: REDUCTION })
  const h = harness({ responses: [again, again, again, again] })
  const out = await settleRefusal({ verdict: verdict({ confirm: REDUCTION }), args: ['--yes'], interactive: false, ...h })
  assert.equal(h.tokens.length, 3)
  assert.deepEqual(out, { exitCode: 1 })
})

test('an unattended confirm carries `unattended=true` beside the token', async () => {
  const calls = []
  const client = new BackendClient({
    origin: 'http://backend.test',
    token: 'TKN',
    fetchImpl: async (url) => (calls.push(String(url)), new Response('{}', { status: 200 }))
  })
  await client.publishSite('site-1', { confirm: 'red-1', unattended: true })
  await client.publishSite('site-1', { confirm: 'tok-2' })
  const publishes = calls.filter((u) => u.includes('/dev/site/publish/'))
  assert.deepEqual(publishes, [
    'http://backend.test/dev/site/publish/site-1?confirm=red-1&unattended=true',
    'http://backend.test/dev/site/publish/site-1?confirm=tok-2'
  ])
})
