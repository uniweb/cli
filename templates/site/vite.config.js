import { defineSiteConfig } from '@uniweb/build/site'

// Options passed here REPLACE the framework's, key by key — except
// optimizeDeps.include / .exclude, which are added to rather than replaced.
// So `build: { sourcemap: true }` overrides the framework's whole build block;
// check what you are replacing before you pass one.
export default defineSiteConfig()
