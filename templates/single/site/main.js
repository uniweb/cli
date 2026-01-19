import initRuntime from '@uniweb/runtime'

const useRuntimeLoading = import.meta.env.VITE_FOUNDATION_MODE === 'runtime'

async function start() {
  if (useRuntimeLoading) {
    initRuntime({
      url: '/foundation/foundation.js',
      cssUrl: '/foundation/assets/style.css'
    })
  } else {
    // #foundation alias is resolved by Vite based on site.yml config
    const foundation = await import('#foundation')
    await import('#foundation/styles')
    initRuntime(foundation)
  }
}

start().catch(console.error)
