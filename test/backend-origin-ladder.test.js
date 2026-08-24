/**
 * resolveBackendOrigin — the backend resolution ladder.
 *
 * Nothing covered this before `siteScope` was added, and it is exactly the kind of thing
 * that needs pinning: the order decides where every backend verb SENDS, a wrong tier is
 * silent, and each tier was argued for separately. The two that carry the argument are
 * `siteScope` beating the session (the reason it is a tier at all) and an ABSENT
 * `siteScope` deferring rather than defaulting (the regression that would break local dev
 * for every project that records nothing).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBackendOrigin } from '../src/backend/client.js'

const FLAG = 'https://flag.example'
const ENV = 'https://env.example'
const SCOPE = 'http://localhost:8080'
const DEPLOY = 'https://deploy.example'

// `UNIWEB_REGISTER_URL` is tier 2, so a value inherited from the developer's shell would
// silently outrank the tiers under test. Neutralize it per-test rather than assuming.
function withoutEnv(fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'UNIWEB_REGISTER_URL')
  const prior = process.env.UNIWEB_REGISTER_URL
  delete process.env.UNIWEB_REGISTER_URL
  try {
    return fn()
  } finally {
    if (had) process.env.UNIWEB_REGISTER_URL = prior
  }
}

test('an explicit flag outranks every project-derived tier', () => {
  withoutEnv(() => {
    assert.equal(
      resolveBackendOrigin(FLAG, { siteScope: SCOPE, siteBackend: DEPLOY }),
      FLAG
    )
  })
  // `--backend` is how you deliberately aim elsewhere — at a staging mirror, say — so a
  // project file must never veto a flag the user just typed. A wrong aim is caught by
  // assertSiteBackendScope instead of being silently redirected.
})

test('the env override outranks the project, and the flag outranks the env', () => {
  const prior = process.env.UNIWEB_REGISTER_URL
  process.env.UNIWEB_REGISTER_URL = ENV
  try {
    assert.equal(resolveBackendOrigin(null, { siteScope: SCOPE }), ENV)
    assert.equal(resolveBackendOrigin(FLAG, { siteScope: SCOPE }), FLAG)
  } finally {
    if (prior === undefined) delete process.env.UNIWEB_REGISTER_URL
    else process.env.UNIWEB_REGISTER_URL = prior
  }
})

test('$backend outranks deploy.yml — identity beats shipping config', () => {
  // They agree in the normal case. When they disagree the identity has to win, because
  // resolving to deploy.yml's value only reaches the scope guard and stops.
  withoutEnv(() => {
    assert.equal(
      resolveBackendOrigin(null, { siteScope: SCOPE, siteBackend: DEPLOY }),
      SCOPE
    )
  })
})

test('$backend outranks the session — the reason it is a tier at all', () => {
  // Returning SCOPE proves the session/config/default tier was never consulted: those
  // live behind getRegistryApiBaseUrl(), which is only reached by falling through.
  // Without this, a teammate who clones a project bound to a local backend resolves to
  // whatever they last logged into and is then REFUSED — nagged instead of routed.
  withoutEnv(() => {
    assert.equal(resolveBackendOrigin(null, { siteScope: SCOPE }), SCOPE)
  })
})

test('⛔ an ABSENT $backend defers to the next tier — it must not default', () => {
  // THE REGRESSION THIS FILE EXISTS FOR. `$backend` is omitted for the default backend,
  // and "absent means the default" is right for the scope COMPARISON. Applying it here
  // would make the tier fire for every project, and since it sits above the session it
  // would shadow `uniweb login --backend <local>` on every project that records nothing
  // — i.e. break local development for the 98%. In a precedence chain, absent has to
  // mean "defer".
  withoutEnv(() => {
    assert.equal(
      resolveBackendOrigin(null, { siteScope: null, siteBackend: DEPLOY }),
      DEPLOY
    )
    assert.equal(
      resolveBackendOrigin(null, { siteScope: undefined, siteBackend: DEPLOY }),
      DEPLOY
    )
  })
})

test('an unparseable tier falls through instead of winning with a broken value', () => {
  withoutEnv(() => {
    assert.equal(
      resolveBackendOrigin('not-a-url', { siteScope: SCOPE }),
      SCOPE
    )
    assert.equal(
      resolveBackendOrigin(null, { siteScope: 'not-a-url', siteBackend: DEPLOY }),
      DEPLOY
    )
  })
})

test('a full endpoint URL is reduced to its origin at every tier', () => {
  withoutEnv(() => {
    assert.equal(
      resolveBackendOrigin(null, { siteScope: 'http://localhost:8080/dev/site/push' }),
      SCOPE
    )
    assert.equal(resolveBackendOrigin('https://flag.example/a/b?c=1'), FLAG)
  })
})
