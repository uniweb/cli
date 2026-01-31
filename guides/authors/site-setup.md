# Setting Up Your Site

This guide walks you through configuring your Uniweb site — naming it, organizing pages, adding languages, enabling search, and deploying to different environments. Everything happens in one file: `site.yml`.

No coding required. You edit a configuration file, and the site handles everything else.

---

## Where Configuration Lives

Your site folder has a `site.yml` file at the root:

```
site/
├── pages/
├── locales/           ← translation files (if multilingual)
├── site.yml           ← your site configuration
└── theme.yml          ← visual identity (colors, fonts)
```

This file controls *what* your site is — its name, its pages, its languages, its features. For *how it looks*, see the [Theming guide](./theming.md).

---

## Naming Your Site

Start with the basics:

```yaml
name: My Company
description: We build things that matter
```

The name appears in the browser tab, search results, and anywhere your template shows the site name (like the header or footer). The description is used for SEO — search engines show it below your page title in results.

That's a complete `site.yml`. Everything else has sensible defaults.

---

## Organizing Your Pages

Your pages come from folders inside `pages/`. By default, the site discovers all of them automatically and uses their folder names as routes:

```
pages/
├── home/          → /
├── about/         → /about
├── services/      → /services
└── contact/       → /contact
```

### Setting the Homepage

Tell the site which folder should be the homepage:

```yaml
index: home
```

The `home` folder becomes `/` (the root URL). Everything else keeps its folder name as the route.

Without `index:`, the site picks the page with the lowest `order` value in its `page.yml`, or the first folder alphabetically.

### Controlling Page Order

Pages appear in navigation in the order they're discovered. To control this, set `order:` in each page's `page.yml`:

```yaml
# pages/about/page.yml
title: About Us
order: 2
```

Lower numbers come first. Pages without an `order` appear after ordered pages.

### Explicit Page List

For precise control over which pages appear and in what order:

```yaml
pages: [home, services, about, contact]
```

The first item becomes the homepage. Pages not in this list are still accessible by URL but won't appear in navigation.

**When to use each approach:**

| Approach | Best for |
|----------|----------|
| `index: home` | Most sites — auto-discovers pages, you just pick the homepage |
| `order:` in page.yml | When you want a specific order but still want auto-discovery |
| `pages: [...]` | When you want precise control over what appears in navigation |

**Tip:** Prefer `index:` over `pages:`. With `pages:`, adding a new folder to `pages/` doesn't automatically show it in navigation — you have to remember to add it to the list.

---

## Adding Languages

If your site needs multiple languages, tell it which ones you support:

```yaml
i18n:
  defaultLocale: en
  locales: [en, es, fr]
```

The `defaultLocale` is whatever language your content is written in. It gets no URL prefix — visitors see `/about`. Other languages get a prefix — `/es/about`, `/fr/about`.

### Adding Display Names

By default, the site uses built-in labels for common languages. To customize what appears in a language switcher:

```yaml
i18n:
  defaultLocale: en
  locales:
    - code: en
      label: English
    - code: es
      label: Español
    - code: fr
      label: Français
```

### Auto-Discovering Languages

If you'd rather let the site detect languages from your translation files:

```yaml
i18n:
  defaultLocale: en
  locales: '*'
```

The site looks at your `locales/` folder and adds every language it finds a translation file for.

### Translated URLs

By default, URLs keep the same path across languages — `/about` becomes `/es/about`. If you want URLs to be translated too (e.g., `/es/acerca-de`), add route translations:

```yaml
i18n:
  defaultLocale: en
  locales: [en, es]
  routeTranslations:
    es:
      /about: /acerca-de
      /services: /servicios
      /contact: /contacto
```

The site handles the mapping — navigation links, language switcher, and internal links all use the correct translated URL automatically.

For the full translation workflow (extracting strings, providing translations, checking coverage), see the [Translation guide](./translating-your-site.md).

---

## Enabling Search

Built-in full-text search is available with one line:

```yaml
search:
  enabled: true
```

The site generates a search index at build time and your template's search component handles the rest. Visitors can search by title, headings, paragraphs, and link text.

### Excluding Pages from Search

If some pages shouldn't appear in search results:

```yaml
search:
  enabled: true
  exclude:
    routes: [/admin, /drafts]
```

For more search options, see the [Search guide](../search.md).

---

## Content Collections

Collections let you create structured data from markdown files — like blog posts, team members, or product listings. Instead of writing JSON, you write markdown files in a folder:

```yaml
collections:
  articles:
    path: library/articles
    sort: date desc

  team:
    path: library/team
    sort: order asc
```

Each markdown file in `library/articles/` becomes an item in the `articles` collection, sorted by date. Pages can then display this data using their template's components.

For the full guide, see [Collections](./collections.md). For technical details, see [Content Collections](../../docs/content-collections.md).

---

## Deploying to a Subdirectory

Most sites deploy to the root of a domain — `https://example.com/`. But sometimes you need to deploy under a subdirectory, like `https://example.com/docs/` or `https://username.github.io/my-project/`.

Set the base path in `site.yml`:

```yaml
base: /docs/
```

This tells the site to prefix all URLs with `/docs/`. Navigation, links, assets, and the language switcher all work correctly under the subdirectory.

**When you need this:**
- GitHub Pages project sites (not `username.github.io`, but `username.github.io/repo-name/`)
- Sites hosted under a path on a shared domain
- Demos or previews at paths like `/demos/my-site/`

**When you don't need this:** If your site is at the root of a domain (including custom domains on GitHub Pages, Vercel, Netlify, etc.), you don't need `base:` at all.

---

## Global Data

If your site needs data available on every page — like configuration from an API or a shared data file:

```yaml
fetch:
  path: /data/site-config.json
  schema: config
```

Place `site-config.json` in your `public/data/` folder. Components that expect `config` data will receive it automatically.

You can also fetch from a remote URL:

```yaml
fetch:
  url: https://api.example.com/config
  schema: config
```

For details, see [Data Fetching](../data-fetching.md).

---

## Build Options

Control how your site is built for production:

```yaml
build:
  prerender: true
```

**Pre-rendering** (the default) generates an HTML file for each page at build time. This means:
- Pages load fast — the content is already in the HTML
- Search engines can read your content
- Pages work even without JavaScript

If you set `prerender: false`, the site generates a single HTML file and renders everything in the browser with JavaScript. This is useful for fully dynamic sites but is slower for visitors and less SEO-friendly.

Most sites should leave pre-rendering on.

---

## Putting It All Together

Here's a complete `site.yml` for a company website with multiple languages and a blog:

```yaml
# Identity
name: Acme Corp
description: Building the future of widgets

# Pages
index: home

# Languages
i18n:
  defaultLocale: en
  locales:
    - code: en
      label: English
    - code: es
      label: Español

# Features
search:
  enabled: true

# Blog content
collections:
  articles:
    path: library/articles
    sort: date desc
```

And here's a minimal one for a simple single-language site:

```yaml
name: My Portfolio
index: home
```

You only need to include what you're using. Start simple and add settings as you need them.

---

## Tips

### Start with the minimum

A `site.yml` with just `name:` works. Add configuration as your site grows. You don't need to decide on languages, search, or collections up front.

### Use `index:` instead of `pages:`

With `index:`, new pages are automatically discovered and appear in navigation. With `pages:`, you have to manually update the list every time you add a page.

### Test your base path locally

If you're deploying to a subdirectory, test it before deploying:

```bash
pnpm build
npx serve dist
```

Visit `http://localhost:3000/your-base-path/` to verify everything works.

### One language at a time

If adding translations, get one additional language working before adding more. The workflow is the same for each language — once you've done it once, the rest is repetition.

---

## Quick Reference

| Setting | What it does | Example |
|---------|-------------|---------|
| `name` | Site name for titles and metadata | `name: My Site` |
| `description` | SEO description | `description: A great site` |
| `index` | Which folder is the homepage | `index: home` |
| `pages` | Explicit page order (overrides auto-discovery) | `pages: [home, about]` |
| `base` | Base path for subdirectory deployment | `base: /docs/` |
| `i18n.defaultLocale` | Primary language (no URL prefix) | `defaultLocale: en` |
| `i18n.locales` | Supported languages | `locales: [en, es, fr]` |
| `search.enabled` | Turn on full-text search | `enabled: true` |
| `build.prerender` | Generate static HTML (default: true) | `prerender: true` |
| `collections` | Define content collections | See [Collections](../content-collections.md) |
| `fetch` | Global data source | See [Data Fetching](../data-fetching.md) |

---

## What's Next?

- **[Writing Content](./writing-content.md)** — How to write sections in markdown
- **[Theming](./theming.md)** — Customize colors, fonts, and dark mode
- **[Translating Your Site](./translating-your-site.md)** — Full translation workflow
- **[Collections](./collections.md)** — Blog posts, team members, products, and other repeating content
- **[Recipes](./recipes.md)** — Copy-paste solutions for common patterns
- **[Deployment](../deployment.md)** — Deploy to Vercel, Netlify, GitHub Pages, and more
