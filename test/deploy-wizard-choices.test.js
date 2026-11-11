/**
 * What the deploy wizard offers, and in what order.
 *
 * Uniweb hosting is the host the docs recommend: it has the full set of features (pages over
 * live data, the Uniweb app for authors, forms and accounts). So the wizard lists Uniweb Cloud
 * first and says it's recommended, and its title also says it's paid, beside static hosts that
 * say they're free, so a person picks knowing which costs money. Every static host it can act
 * on is still offered, and "Somewhere else" (`uniweb export`) stays last.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDestinationChoices } from '../src/utils/destination-prompt.js'

test('Uniweb Cloud comes first, recommended and marked paid', async () => {
  const [first] = await buildDestinationChoices()
  assert.equal(first.value.kind, 'uniweb')
  assert.match(first.title, /recommended/)
  assert.match(first.title, /paid/)
})

test('every static host is still offered, and Somewhere else comes last', async () => {
  const choices = await buildDestinationChoices()
  const hosts = choices.filter((c) => c.value.kind === 'adapter').map((c) => c.value.host)
  for (const host of ['github-pages', 'cloudflare-pages', 'netlify', 'vercel', 's3-cloudfront']) {
    assert.ok(hosts.includes(host), `${host} is offered`)
  }
  assert.equal(choices.at(-1).value.kind, 'export')
})
