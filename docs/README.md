# Uniweb Developer Guide

Build content-driven websites with React components and markdown. Uniweb handles the complexity so you can focus on what matters: your content and your design.

## The Key Insight

**Content flows to components, already processed.**

In Uniweb, you don't wire up data fetching, parse markdown, or manage state. You write markdown content, and your components receive it as structured props:

```jsx
// Your component receives content ready to render
function Hero({ content, params }) {
  const { title, paragraphs, links, imgs } = content
  const { theme, layout } = params

  return (
    <section className={theme}>
      <h1>{title}</h1>
      {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </section>
  )
}
```

No `useState`, no `useEffect`, no loading states. The runtime guarantees your content structure—empty arrays instead of null, defaults applied from your component's metadata.

This is the **Component Content Architecture (CCA)**: content is resolved before it reaches your components.

---

## What This Means for You

### Write content in markdown
Authors work in familiar markdown with YAML frontmatter. No CMS training, no complex interfaces.

### Build components that just render
Your React components receive props and render. No data fetching logic, no defensive null checks.

### Get static HTML for free
Every page pre-renders to HTML at build time. Fast loads, great SEO, works without JavaScript.

### Localization without runtime overhead
Multi-language content is resolved at build time. Components receive already-translated content—no `t()` functions, no translation lookups.

---

## Start Here

If you're new to Uniweb, read these first:

| Guide | What You'll Learn |
|-------|-------------------|
| [Content Structure](./content-structure.md) | How markdown becomes component props |
| [Component Metadata](./component-metadata.md) | Defining what your components expect |
| [Site Configuration](./site-configuration.md) | The `site.yml` file |
| [Page Configuration](./page-configuration.md) | The `page.yml` file |

---

## All Guides

### Core Concepts

- **[Content Structure](./content-structure.md)** — How markdown is parsed into structured content (title, paragraphs, links, items)
- **[Component Metadata](./component-metadata.md)** — The `meta.js` file: declaring content expectations, parameters, and presets

### Configuration

- **[Site Configuration](./site-configuration.md)** — Global settings in `site.yml`: identity, page ordering, features
- **[Page Configuration](./page-configuration.md)** — Per-page settings in `page.yml`: layout, SEO, data sources
- **[Foundation Configuration](./foundation-configuration.md)** — CSS variables and custom Layout for your foundation

### Content & Data

- **[Data Fetching](./data-fetching.md)** — Load external JSON/YAML and make it available to components
- **[Content Collections](./content-collections.md)** — Turn folders of markdown into queryable data (blogs, portfolios)
- **[Dynamic Routes](./dynamic-routes.md)** — Generate pages from data (one page per blog post, product, etc.)

### Navigation & Structure

- **[Linking](./linking.md)** — Stable `page:` links that survive restructuring
- **[Navigation Patterns](./navigation-patterns.md)** — Building menus, breadcrumbs, and navigation from page hierarchy
- **[Special Sections](./special-sections.md)** — Site-wide header, footer, and sidebars (`@header`, `@footer`, `@left`, `@right`)

### Features

- **[Site Theming](./site-theming.md)** — Colors, typography, dark mode, and CSS variables
- **[Search](./search.md)** — Built-in full-text search with zero configuration
- **[Internationalization](./internationalization.md)** — Multi-language sites with build-time translation
- **[Versioning](./versioning.md)** — Multiple documentation versions with automatic switching

### Reference

- **[Runtime API](./runtime-api.md)** — Hooks and objects available to components (`useWebsite`, `useVersion`, etc.)

---

## The Mental Model

```
┌─────────────────────────────────────────────────────────────┐
│                        AUTHOR LAYER                         │
│  Markdown files with YAML frontmatter                       │
│  pages/about/1-hero.md                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (build time)
┌─────────────────────────────────────────────────────────────┐
│                       RUNTIME LAYER                         │
│  Parses markdown → Applies defaults → Resolves locale       │
│  Guarantees content shape                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      COMPONENT LAYER                        │
│  Receives { content, params, block }                        │
│  Just renders—no fetching, no state management              │
└─────────────────────────────────────────────────────────────┘
```

**Key points:**

1. **Authors** write content in markdown
2. **Runtime** processes it (parsing, defaults, localization)
3. **Components** receive clean, guaranteed props

Your components never deal with the messy parts—that's Uniweb's job.

---

## Quick Patterns

### Access site/page data in components

```jsx
import { useWebsite } from '@uniweb/kit'

function Footer({ content }) {
  const { website } = useWebsite()

  return (
    <footer>
      <p>© {new Date().getFullYear()} {website.name}</p>
    </footer>
  )
}
```

### Build navigation from page structure

```jsx
function Nav() {
  const { website } = useWebsite()
  const pages = website.getPageHierarchy({ for: 'header' })

  return (
    <nav>
      {pages.map(page => (
        <a key={page.id} href={page.route}>{page.label}</a>
      ))}
    </nav>
  )
}
```

### Handle multi-language sites

```jsx
function LanguageSwitcher() {
  const { website } = useWebsite()

  if (!website.hasMultipleLocales()) return null

  return (
    <select onChange={e => window.location.href = website.getLocaleUrl(e.target.value)}>
      {website.getLocales().map(loc => (
        <option key={loc.code} value={loc.code}>{loc.label}</option>
      ))}
    </select>
  )
}
```

Note: Components receive content already translated. No `t()` function needed—the content in `content.title` is already in the user's language.

---

## Getting Help

- **CLI help**: `uniweb --help`
- **Issues**: [github.com/uniweb/cli/issues](https://github.com/uniweb/cli/issues)
