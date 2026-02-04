import { start } from '@uniweb/runtime'

start({
  config: __FOUNDATION_CONFIG__,
  styles: import('#foundation/styles'),
  foundation: import('#foundation')
})
