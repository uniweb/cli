/**
 * The ad platforms a site can name in `site.yml::services`: `services.x`, `services.meta`.
 *
 * Each is a row the host acts on: it sends the site's conversions on to that platform, server
 * side, with the site's own token. So a foundation renders nothing for one, `uniweb status` never
 * hears one reported as live, and a platform's token is a secret for the host to read.
 *
 * ⭐ ONE LIST FOR THE CLI. `@uniweb/build` checks the rows as they are written and keeps its own
 * (`AD_PLATFORMS` in `uwx/services-request.js`), since the CLI may run where that package is not
 * installed. A new platform is a name added here and there.
 */
export const AD_PLATFORMS = new Set(['meta', 'x'])
