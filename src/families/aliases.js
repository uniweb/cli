/**
 * What `doctor` knows about names that are NOT standard families.
 *
 * ⛔ THIS FILE MUST NEVER BE IMPORTED BY THE RESOLVER, and the reason is the
 * whole design. `resolveFamily()` in `@uniweb/schemas` matches exactly, so a
 * component either is a standard family or is not. Everything here is a GUESS —
 * and a guess in the resolver is silent: map `Banner` to `hero` and someone
 * whose Banner is a cookie notice gets a confidently wrong illustration with no
 * error anywhere, forever, because a wrong picture is not a failure.
 *
 * ⭐ HERE, THE SAME GUESS IS SAFE, because a human sees it and approves the
 * edit. That difference also makes this list DISPOSABLE: it never reaches a
 * consumer, so a bad entry can simply be deleted, where a bad alias in the
 * published list would be append-only forever.
 *
 * ⭐ ALIASES AND SUFFIXES COMPOSE, which is why the table stays small. Adding
 * `sponsors → logo-cloud` makes `SponsorStrip`, `SponsorBand` and `SponsorGrid`
 * all resolve without a row each. ⇒ Add the SUBJECT; let the suffix rule handle
 * the shape.
 */

import { isFamily, normalizeName } from '@uniweb/schemas/families'

/** Normalized name → family id. A guess a developer approves, never a contract. */
const ALIASES = {
  // → hero
  'jumbotron': 'hero',
  'masthead': 'hero',
  'banner-hero': 'hero',
  'dashboard-hero': 'hero',
  'splash': 'hero',
  // → profile
  'profile-hero': 'profile',
  'bio': 'profile',
  'about-me': 'profile',
  // → statement
  'pullquote': 'statement',
  'pull-quote': 'statement',
  'manifesto': 'statement',
  // → announcement
  'notice': 'announcement',
  'alert-bar': 'announcement',
  'top-bar': 'announcement',
  // → article
  'article-body': 'article',
  'article-header': 'article',
  'post': 'article',
  'blog-post': 'article',
  'doc': 'article',
  // → rich-text
  'freeform': 'rich-text',
  'wysiwyg': 'rich-text',
  'prose': 'rich-text',
  'text': 'rich-text',
  // → figure
  'image': 'figure',
  'diagram': 'figure',
  'illustration': 'figure',
  // → gallery
  'photos': 'gallery',
  'photo-gallery': 'gallery',
  'image-gallery': 'gallery',
  'carousel': 'gallery',
  'slideshow': 'gallery',
  // → video
  'player': 'video',
  'video-player': 'video',
  'video-embed': 'video',
  // → code-block
  'code': 'code-block',
  'snippet': 'code-block',
  'codecard': 'code-block',
  // → callout
  'admonition': 'callout',
  'note': 'callout',
  'warning': 'callout',
  'banner-note': 'callout',
  'deprecation': 'callout',
  // → steps
  'how-it-works': 'steps',
  'walkthrough': 'steps',
  'tutorial': 'steps',
  'lesson': 'steps',
  // → accordion
  'disclosure': 'accordion',
  'collapse': 'accordion',
  'expander': 'accordion',
  // → faq
  'faqs': 'faq',
  'questions': 'faq',
  'q-and-a': 'faq',
  // → card-grid
  'blog': 'card-grid',
  'posts': 'card-grid',
  'cards': 'card-grid',
  'tiles': 'card-grid',
  'showcase-grid': 'card-grid',
  // → team
  'people': 'team',
  'staff': 'team',
  'members': 'team',
  'directory': 'team',
  'roster': 'team',
  'speakers': 'team',
  // → products
  'catalog': 'products',
  'shop': 'products',
  'store': 'products',
  // → jobs
  'careers': 'jobs',
  'openings': 'jobs',
  'vacancies': 'jobs',
  // → schedule
  'agenda': 'schedule',
  'program': 'schedule',
  'timetable': 'schedule',
  'events': 'schedule',
  // → downloads
  'files': 'downloads',
  'resources': 'downloads',
  'attachments': 'downloads',
  'downloader': 'downloads',
  // → bibliography
  'publications': 'bibliography',
  'citations': 'bibliography',
  'references': 'bibliography',
  'papers': 'bibliography',
  // → recommendations
  'related': 'recommendations',
  'suggested': 'recommendations',
  'you-may-like': 'recommendations',
  'recommender': 'recommendations',
  // → features
  'feature': 'features',
  'benefits': 'features',
  'capabilities': 'features',
  'highlights': 'features',
  // → testimonials
  'testimonial': 'testimonials',
  'reviews': 'testimonials',
  'quotes-from-customers': 'testimonials',
  'social-proof': 'testimonials',
  // → logo-cloud
  'logos': 'logo-cloud',
  'clients': 'logo-cloud',
  'partners': 'logo-cloud',
  'brands': 'logo-cloud',
  'sponsors': 'logo-cloud',
  'logocloud': 'logo-cloud',
  // → spotlight
  'split-feature': 'spotlight',
  'split': 'spotlight',
  'feature-split': 'spotlight',
  'alternating': 'spotlight',
  // → pricing
  'plans': 'pricing',
  'plans-public': 'pricing',
  'price': 'pricing',
  'prices': 'pricing',
  'tiers': 'pricing',
  'packages': 'pricing',
  // → stats
  'numbers': 'stats',
  'counters': 'stats',
  'kpis': 'stats',
  'figures': 'stats',
  // → metrics
  'dashboard': 'metrics',
  'insights': 'metrics',
  'analytics': 'metrics',
  // → data-table
  'table': 'data-table',
  'datatable': 'data-table',
  'spreadsheet': 'data-table',
  // → comparison
  'compare': 'comparison',
  'comparison-table': 'comparison',
  'versus': 'comparison',
  // → cta
  'call-to-action': 'cta',
  'action': 'cta',
  'conversion': 'cta',
  // → contact
  'contact-form': 'contact',
  'contact-us': 'contact',
  'get-in-touch': 'contact',
  'enquiry': 'contact',
  'inquiry': 'contact',
  // → newsletter
  'subscribe': 'newsletter',
  'signup': 'newsletter',
  'email-signup': 'newsletter',
  'mailing-list': 'newsletter',
  // → booking
  'calendar': 'booking',
  'reserve': 'booking',
  'appointment': 'booking',
  // → estimate
  'quote-request': 'estimate',
  'get-a-quote': 'estimate',
  // → search
  'search-modal': 'search',
  'search-bar': 'search',
  'finder': 'search',
  'lookup': 'search',
  // → auth
  'login': 'auth',
  'log-in': 'auth',
  'sign-in': 'auth',
  'signin': 'auth',
  'signup-form': 'auth',
  'register': 'auth',
  'account': 'auth',
  // → header
  'navbar': 'header',
  'nav': 'header',
  'top-nav': 'header',
  'main-nav': 'header',
  'site-header': 'header',
  'masthead-nav': 'header',
  // → footer
  'site-footer': 'footer',
  'bottom': 'footer',
  'colophon': 'footer',
  // → pathways
  'doc-nav': 'pathways',
  'next-steps': 'pathways',
  'explore': 'pathways',
  // → toc
  'table-of-contents': 'toc',
  'on-this-page': 'toc',
  'sidebar': 'toc',
  'left-panel': 'toc',
  'outline': 'toc',
  // → map
  'google-map': 'map',
  'mapbox': 'map',
  'location': 'map',
  'location-map': 'map',
  // → embed
  'iframe': 'embed',
  'oembed': 'embed',
  'external': 'embed',
  // → raw-code
  'html': 'raw-code',
  'raw-html': 'raw-code',
  'custom-code': 'raw-code',
  'code-injection': 'raw-code',
  // → widget
  'custom-app': 'widget',
  'third-party': 'widget',
  'plugin': 'widget',
  // → grid
  'grid-composition': 'grid',
  'columns': 'grid',
  'split-layout': 'grid',
  // → scene
  'scene-composer': 'scene',
  'composer': 'scene',
  'canvas': 'scene',}

/**
 * Shape words that carry no meaning of their own.
 *
 * Developers name sections `<Subject><Shape>` — `CtaBand`, `FeatureGrid`,
 * `SponsorStrip`, `PriceBand`, `StatsGrid`, `ProgramsList`. The shape is noise;
 * the subject is the signal.
 *
 * ⭐ A RULE REACHES FURTHER THAN A TABLE. This one resolves names nobody has
 * invented yet, which is the point — the space of section names is unbounded
 * and a list of them can never be.
 *
 * ⚠️ Stripping runs AFTER an exact match, so `CardGrid` finds the `card-grid`
 * family and is never stripped to `card`.
 */
const SHAPE_SUFFIXES = [
  'band', 'strip', 'grid', 'list', 'panel', 'block', 'bar',
  'row', 'box', 'section', 'group', 'area', 'wrapper', 'container', 'module',
]

/**
 * Names real foundations use whose meaning is genuinely ambiguous.
 *
 * ⭐ THIS LIST IS THE DISCIPLINE, and it is what to point at when someone asks
 * why their name did not resolve. A wrong auto-fix is worse than a fallback: the
 * developer approves it once, and it is wrong in their source forever.
 *
 * ⚠️ These still SUGGEST — `doctor` names the candidates and lets the developer
 * choose. They are only barred from `--fix`.
 */
const AMBIGUOUS = new Map([
  ['banner', "hero? announcement? callout? A cookie notice is a banner too"],
  ['quote', "estimate (a price request) or a pull-quote. The collision that made `estimate` carry the longer id"],
  ['timeline', "process (ordered steps) or roadmap (dated milestones) — the two that already read as duplicates"],
  ['showcase', "features? gallery? spotlight? Real foundations ship one and it could be any of the three"],
  ['section', "a container word that names no shape — it is a suffix, never a subject"],
  ['block', "a container word that names no shape — it is a suffix, never a subject"],
  ['card', "a container word that names no shape — it is a suffix, never a subject"],
  ['panel', "a container word that names no shape — it is a suffix, never a subject"],
  ['overview', "every group has a plausible claim on it"],
  ['summary', "every group has a plausible claim on it"],
  ['highlights', "every group has a plausible claim on it"],
  ['page', "an app-screen word — if it resolved, every application screen would mis-file"],
  ['detail', "an app-screen word — if it resolved, every application screen would mis-file"],
  ['view', "an app-screen word — if it resolved, every application screen would mis-file"],
])

/** `x`, `xs`, and `x` without a trailing `s` — enough for `feature` ↔ `features`. */
function plurals(stem) {
  return [stem, `${stem}s`, stem.endsWith('s') ? stem.slice(0, -1) : null].filter(Boolean)
}

function matchExactOrAlias(stem) {
  for (const candidate of plurals(stem)) {
    if (isFamily(candidate)) return candidate
    if (ALIASES[candidate]) return ALIASES[candidate]
  }
  return null
}

/** Levenshtein distance, iterative two-row form. */
function editDistance(a, b) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

/**
 * What `doctor` would propose for a name that is not a standard family.
 *
 * Steps 2–4 of the matcher; step 1 (exact) is the resolver's and has already
 * failed by the time this is called.
 *
 * @param {string} name - a component name, or an unrecognized `family:` value
 * @param {string[]} families - every known family id, for the near-miss step
 * @returns {{id: string|null, via: 'alias'|'suffix'|'near'|null,
 *            fixable: boolean, ambiguous: string|null}}
 */
export function suggestFamily(name, families) {
  const miss = { id: null, via: null, fixable: false, ambiguous: null }
  const norm = normalizeName(name)
  if (!norm) return miss

  // ⛔ Checked BEFORE the alias table so an ambiguous word can never be
  // auto-fixed by a rule that happens to reach it from another direction.
  const why = AMBIGUOUS.get(norm)

  const alias = ALIASES[norm]
  if (alias) return { id: alias, via: 'alias', fixable: !why, ambiguous: why || null }

  for (const suffix of SHAPE_SUFFIXES) {
    if (!norm.endsWith(`-${suffix}`)) continue
    const stem = norm.slice(0, -(suffix.length + 1))
    const hit = matchExactOrAlias(stem)
    if (hit) return { id: hit, via: 'suffix', fixable: !why, ambiguous: why || null }
    break // one suffix only — stripping two invents a word the developer never wrote
  }

  // ⛔ Suggest only. A near miss is a typo hypothesis, and `heros` → `hero` is
  // obvious while `header` → `hero` is not; the developer can tell them apart
  // and a rule cannot.
  let best = null
  let bestScore = Infinity
  for (const id of families) {
    const score = editDistance(norm, id)
    if (score < bestScore) {
      bestScore = score
      best = id
    }
  }
  if (bestScore <= 2) return { id: best, via: 'near', fixable: false, ambiguous: why || null }

  return why ? { ...miss, ambiguous: why } : miss
}

export { ALIASES, SHAPE_SUFFIXES, AMBIGUOUS }
