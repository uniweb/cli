import { start, initRuntime } from '@uniweb/runtime'

// __FOUNDATION_CONFIG__ is replaced at build time by the site's Vite config.
// It tells us whether the foundation is bundled or loaded from a URL at runtime.
const config = __FOUNDATION_CONFIG__

if (config.mode === 'runtime') {
  // Runtime mode: foundation loaded from URL via dynamic import()
  initRuntime({ url: config.url, cssUrl: config.cssUrl })
} else {
  // Bundled mode: foundation imported at build time
  await import('#foundation/styles')
  start({ foundation: import('#foundation') })
}
