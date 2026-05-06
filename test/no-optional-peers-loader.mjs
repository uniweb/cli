/**
 * Test loader: stubs out the CLI's optional peer dependencies so that any
 * import of them (static or dynamic) fails with ERR_MODULE_NOT_FOUND, the
 * same error a real install hits when the peer isn't on disk.
 *
 * Used by `test/smoke-startup.test.js` to assert that the CLI's startup
 * path — everything reachable from `src/index.js` before a verb starts
 * handling args — does NOT statically import any optional peer.
 *
 * Why this matters: the CLI is `npx`-able into a scratch dir and globally
 * installable; in both cases optional peers (`@uniweb/build` and friends)
 * are absent. A static import anywhere in the startup graph crashes the
 * binary at module-load time, before --help / --version / create can run.
 * v0.12.17 shipped exactly that regression — see commit history of
 * `src/utils/config.js` for the postmortem.
 */

const OPTIONAL_PEERS = [
  '@uniweb/build',
  '@uniweb/content-reader',
  '@uniweb/semantic-parser',
]

export function resolve(specifier, context, nextResolve) {
  for (const peer of OPTIONAL_PEERS) {
    if (specifier === peer || specifier.startsWith(peer + '/')) {
      const err = new Error(
        `Cannot find package '${specifier}' (smoke-test stub: optional peer must not be reached during CLI startup)`,
      )
      err.code = 'ERR_MODULE_NOT_FOUND'
      throw err
    }
  }
  return nextResolve(specifier, context)
}
