# Template Tour

The official templates aren't just starter projects — they're worked examples of different positions on the portability spectrum. Each one adopts a different mix of CCA conventions. This guide maps what's where so you can find the pattern you need.

If you haven't read [Foundation Categories](./foundation-categories.md), start there. It explains the bundled-to-portable spectrum. This guide shows that spectrum in practice.

---

## The Matrix

Each template adopts a different subset of CCA conventions. A dash means the template doesn't use that convention — not that it can't.

|                                 | docs              | academic        | marketing       | international     | dynamic         |
| ------------------------------- | ----------------- | --------------- | --------------- | ----------------- | --------------- |
| **Params / presets**            | yes               | yes (extensive) | yes (extensive) | yes               | yes             |
| **content.items**               | yes               | yes             | yes             | yes               | —               |
| **content.data**                | yes (API schemas) | —               | yes             | yes               | yes (live APIs) |
| **Dynamic routes**              | —                 | —               | yes             | yes               | yes             |
| **Semantic CSS tokens**         | —                 | —               | yes             | yes               | yes             |
| **theme.yml**                   | —                 | —               | yes             | yes               | yes             |
| **Per-section theme overrides** | —                 | —               | yes             | yes               | yes             |
| **i18n**                        | —                 | —               | —               | yes (3 languages) | —               |
| **Loading states**              | —                 | —               | —               | —                 | yes             |
| **Portability**                 | bundled           | bundled         | portable-leaning| portable-leaning  | fully portable  |

The templates are ordered left-to-right from bundled to portable. The rest of this guide walks through each one.

---

## docs — Bundled Documentation Site

A documentation site with versioned content, API reference pages, search, and syntax highlighting.

**Where it sits:** Bundled. Hardcoded Tailwind colors in `styles.css`, no `theme.yml`. This is appropriate — a docs site has consistent branding across all deployments.

### What to study here

**Params for layout control.** `DocSection/meta.js` exposes `show_navigation` and `max_width` (prose/lg/xl/full). The content author controls whether the side navigation appears and how wide the content area is — per page. The component reads `params.max_width` and maps it to a Tailwind class. Simple, effective use of params without needing the full theming system.

**Navigation integration.** `LeftPanel` reads the page hierarchy from the website object to build the sidebar navigation tree. This is the clearest example of a section type that consumes CCA's routing data rather than markdown content.

**API reference with data schemas.** `ApiReference/meta.js` declares structured data schemas for API definitions (method, path, parameters, request body, response). Content authors write API specs in tagged YAML blocks (`yaml:api`) and the component renders interactive documentation. This shows how `meta.js` data schemas can structure complex domain-specific content.

### What it keeps bundled

Theming is hardcoded — `styles.css` defines colors directly (`--color-primary`, `--color-code-bg`, `--color-sidebar-bg`) without the semantic token indirection that portable foundations use. A docs site that always looks the same doesn't need theme portability. The colors are chosen for readability (code blocks, syntax highlighting) and changing them per-site would create more problems than it solves.

---

## academic — Bundled Domain-Specialized

An academic research portfolio with publication lists, team grids, timelines, and LaTeX math rendering.

**Where it sits:** Bundled. Hardcoded colors, no `theme.yml`, no external data layer. Similar rationale to docs — institutional sites have fixed branding.

### What to study here

**content.items for structured repeating content.** `PublicationList` is the best example in any template of parsing `content.items` into domain-specific structures. Each H3 heading in the markdown becomes a publication entry. The component parses author lists, journal names, years, and DOIs from the content structure. See `PublicationList/PublicationList.jsx` — the `parsePublication` function shows how to extract structured data from semantic content.

**Domain-specific variant params.** `ProfileHero/meta.js` declares a `variant` param with `researcher`, `lab`, and `department` options. Each variant adjusts the layout and fields displayed — a researcher shows publications and affiliation, a lab shows research areas and team size, a department shows programs. The content author picks the appropriate profile type from a dropdown; the component renders accordingly.

**Extensive param-driven customization.** `PublicationList/meta.js` has params for citation style (detailed/apa/mla/chicago/ieee), grouping (none/year), search visibility, and display limits. Five presets combine these into named configurations (full, recent, apa, mla, ieee). This is the deepest example of how params and presets create a content-author interface for a complex component.

### What it keeps bundled

Everything except params. Colors are hardcoded, including domain-specific tokens like `--color-journal` and `--color-conference` for publication type badges. Data comes from `content.items` (parsed from markdown), not from external APIs. This makes sense for an academic portfolio where the researcher writes their own publications directly in markdown. No external data source to abstract over.

---

## marketing — Portable-Leaning

A marketing site with hero sections, feature grids, blog with dynamic routes, pricing tables, and testimonials.

**Where it sits:** Portable-leaning. Has `theme.yml`, imports `theme-tokens.css` from kit, and all 16 components use semantic CSS tokens (`text-heading`, `text-muted`, `bg-surface-subtle`, `bg-btn-primary`, etc.). Visual effects like gradients and dark backgrounds are controlled through frontmatter (`theme:` and `background:`) rather than component params.

### What to study here

**Extensive presets.** `Hero/meta.js` has presets for Centered Hero, Split Layout, and Minimal. Each preset sets layout and pattern params — visual effects like gradients come from frontmatter `background:` configuration, not component params. This shows the CCA separation: components control layout, content authors control appearance.

**Conditional layout rendering.** `Hero/index.jsx` uses the `layout` param (center/left/split) to conditionally render different arrangements of content and images within a single component. While not a full Dispatcher pattern (it doesn't delegate to separate files), it demonstrates how a single section type handles multiple visual layouts through params.

**Dynamic routes for blog.** The `site/pages/blog/[slug]/` folder creates dynamic routes for individual blog posts. `BlogList` fetches the article collection via `content.data` and renders the list page. This is the clearest example of the list-page + dynamic-route pattern described in the site configuration docs.

**Frontmatter-driven theming.** The marketing template demonstrates how content authors control section appearance through frontmatter rather than component params. Hero sections use `theme: dark` with `background: { gradient: ... }`, stats sections use `background: { color: var(--primary-600) }`, and testimonials use `theme: medium` for a subtle background. Components simply render with semantic tokens — the runtime handles context classes.

---

## international — Portable-Leaning

A multilingual site (English, Spanish, French) with blog, team pages, and full i18n support.

**Where it sits:** Portable-leaning. Semantic CSS tokens throughout, `theme.yml` controls colors and fonts, CCA data layer for articles, full i18n. Components use semantic classes (`text-heading`, `bg-btn-primary`) instead of hardcoded colors.

### What to study here

**Semantic theming done right.** `styles.css` maps CSS custom properties to Tailwind utilities: `--color-heading`, `--color-body`, `--color-muted`, `--color-link`, `--color-btn-primary`. Components use these as Tailwind classes (`text-heading`, `bg-btn-primary`). The site's `theme.yml` sets the actual colors — swap the palette and every component adapts. Compare `Hero/Hero.jsx` here (semantic classes) with the marketing Hero (hardcoded classes) to see the difference in practice.

**Full i18n with three languages.** The `site/locales/` directory contains `es.json`, `fr.json`, and `manifest.json`. This is the only template that demonstrates the complete translation workflow — extraction, manifest hashes, and locale files. If you need to build a multilingual site, this is the reference.

**Data inheritance.** `ArticleList/meta.js` uses `data: { inherit: ['articles'] }` — the section type inherits article data declared at the page level in `page.yml`. The page fetches the collection once; the section type consumes it without knowing where it came from. This is the CCA data layer pattern: page declares, component reads.

**Dynamic routes with i18n.** The `site/pages/blog/[slug]/` folder creates dynamic routes for blog posts, and translations apply to the dynamic content. This shows how CCA's routing and i18n systems compose.

### What it keeps bundled

Very little. This template is close to fully portable — a different site could use this foundation with different content, different languages, and different colors. The main bundled aspect is the specific component set (hero, features, team, article list), which reflects the marketing-style site structure.

---

## dynamic — Fully Portable

A data-driven dashboard for a wildlife conservation organization, featuring live API data, weather widgets, publication databases, and species sightings.

**Where it sits:** Fully portable. Every CCA convention is in use — semantic tokens, `theme.yml`, CCA data layer with live APIs, loading states, per-section backgrounds. This is the reference implementation for portable patterns.

### What to study here

**Semantic CSS tokens throughout.** `styles.css` maps a comprehensive set of tokens: `--color-heading`, `--color-body`, `--color-muted`, `--color-subtle`, `--color-link`, `--color-edge-muted`, `--color-surface`. Components reference these exclusively — no hardcoded color classes anywhere. This is what a fully portable foundation's styling looks like.

**Live API data with loading states.** Seven of ten section types use `block.dataLoading`. The pattern is consistent:

```js
// Publications/Publications.jsx
const papers = content.data?.papers || []
const loading = block.dataLoading
```

The component doesn't fetch data, manage cache, or handle errors — the runtime does all of that. The component reads `content.data` and shows a loading state when `block.dataLoading` is true. See `Publications/Publications.jsx:17`, `Hero/Hero.jsx:9`, `Sightings/Sightings.jsx:24` for examples.

**Per-section data fetching.** Each section's markdown frontmatter declares its own fetch config. The hero fetches weather data, sightings fetches from iNaturalist, publications fetches from a research API. The runtime resolves each independently. Check `site/pages/home/1-hero.md` and `site/pages/home/3-sightings.md` for the frontmatter fetch configs.

**Dynamic routes with detail queries.** The `blog/[id]` folder creates dynamic routes for individual field notes. The parent `blog/page.yml` fetches from JSONPlaceholder with `detail: rest` — when a user navigates from the list, the cached collection provides the item; when they land directly on `/blog/5`, the runtime fetches `https://jsonplaceholder.typicode.com/posts/5` as a single REST call instead of fetching all 12 posts. This is the only template that combines dynamic routes with live API data and loading states.

### Why it's the portability reference

Every section type in this foundation could serve a completely different site — different APIs, different colors, different content. The components know how to render data, not where data comes from. They know how to apply tokens, not what colors those tokens resolve to. Swap the `theme.yml` and every component rebrands. Swap the page configs and every component reads new APIs. That's what portable means in practice.

---

## Choosing What to Study

Start from what you're trying to learn:

- **"How do params and presets work?"** — marketing `Hero/meta.js` (4 presets, 3 params) or academic `PublicationList/meta.js` (5 presets, 6 params)
- **"How does semantic theming work?"** — international `styles.css` and any component, or dynamic for a more comprehensive example
- **"How do I use the CCA data layer?"** — dynamic (any data section, `Publications` is the clearest) or international (`ArticleList` with data inheritance)
- **"How does i18n work?"** — international (the only template with translations)
- **"How do I use content.items for repeating content?"** — academic `PublicationList` (complex parsing) or marketing `Features` (simpler pattern)
- **"How do dynamic routes work?"** — marketing `blog/[slug]` or international `blog/[slug]`; dynamic `blog/[id]` adds `detail: rest` for single-entity fetching
- **"How do loading states work?"** — dynamic (7 sections demonstrate the pattern)
- **"How do section backgrounds work?"** — marketing (gradients, solid colors via frontmatter `background:`) or dynamic (per-section data with backgrounds)

---

## See Also

- [Foundation Categories](./foundation-categories.md) — The portability spectrum these templates demonstrate
- [Thinking in Contexts](./thinking-in-contexts.md) — Semantic theming in depth (dynamic and international are the references)
- [Working with Data](./working-with-data.md) — CCA data layer (dynamic and international templates)
- [CCA Component Patterns](./component-patterns.md) — Params, presets, content.items patterns
