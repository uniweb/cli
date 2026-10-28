/**
 * Where a site's visitors go — the address the CLI shows wherever it says where a site is live:
 * `uniweb publish`, `uniweb status`, `uniweb site list` and `uniweb site unpublish`.
 *
 * A backend names two addresses for a published site. `visitor_url` is where its visitors go: the
 * site's custom domain while one is active, else the address it was delivered to. The other — `url`
 * on a publish, `last_published_url` on a site's status, `deployment.published_url` on a list row —
 * is where the last publish delivered it, which may be a subdomain that only redirects to that
 * domain. The first is shown; the second only where the first is absent or null, as from a backend
 * that does not send it. Both are complete addresses, read verbatim and never composed onto.
 *
 * ⛔ Not a liveness claim. Whether a site IS live is `published` (status) or `deployment.status`
 * (list): an unpublished site keeps both addresses.
 *
 * @param {unknown} visitorUrl - the answer's `visitor_url`
 * @param {unknown} deliveredUrl - the address the last publish delivered the site to
 * @returns {string|null}
 */
export function liveAddress(visitorUrl, deliveredUrl) {
  for (const url of [visitorUrl, deliveredUrl]) if (typeof url === 'string' && url) return url
  return null
}
