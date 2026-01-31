# Uniweb Documentation

Reference documentation for the Uniweb component content architecture.

---

## Getting Started

- **[Quickstart](./quickstart.md)** — Create your first site
- **[Templates](./templates.md)** — Built-in, official, and external templates
- **[Deployment](./deployment.md)** — Deploy to Vercel, Netlify, Cloudflare, and more

## Core Concepts

- **[Content Structure](./content-structure.md)** — How markdown is parsed into structured content (title, paragraphs, links, items)
- **[Component Metadata](./component-metadata.md)** — The `meta.js` file: declaring content expectations, parameters, and presets
- **[Creating Components](./creating-components.md)** — Build section types for your foundation

## Configuration

- **[Site Configuration](./site-configuration.md)** — Global settings in `site.yml`: identity, page ordering, features
- **[Page Configuration](./page-configuration.md)** — Per-page settings in `page.yml`: layout, SEO, data sources
- **[Foundation Configuration](./foundation-configuration.md)** — CSS variables and custom Layout for your foundation

## Content & Data

- **[Data Fetching](./data-fetching.md)** — Load external JSON/YAML and make it available to components
- **[Content Collections](./content-collections.md)** — Turn folders of markdown into queryable data (blogs, portfolios)
- **[Dynamic Routes](./dynamic-routes.md)** — Generate pages from data (one page per blog post, product, etc.)

## Navigation & Structure

- **[Linking](./linking.md)** — Stable `page:` links that survive restructuring
- **[Navigation Patterns](./navigation-patterns.md)** — Building menus, breadcrumbs, and navigation from page hierarchy
- **[Special Sections](./special-sections.md)** — Site-wide header, footer, and sidebars (`@header`, `@footer`, `@left`, `@right`)

## Features

- **[Site Theming](./site-theming.md)** — Colors, typography, dark mode, and CSS variables
- **[Search](./search.md)** — Built-in full-text search with zero configuration
- **[Internationalization](./internationalization.md)** — Multi-language sites with build-time translation
- **[Versioning](./versioning.md)** — Multiple documentation versions with automatic switching

## Reference

- **[CLI Commands](./cli-commands.md)** — Complete reference for `uniweb create`, `build`, `docs`, `i18n`
- **[Runtime API](./runtime-api.md)** — Hooks and objects available to components (`useWebsite`, `useVersion`, etc.)

---

## Guides

Narrative guides with worked examples and deeper explanations:

**For developers** (building foundations and components):
- [Building with Uniweb](../guides/developers/building-with-uniweb.md)
- [Converting Existing Designs](../guides/developers/converting-existing-designs.md)
- [Component Patterns](../guides/developers/component-patterns.md)
- [Thinking in Contexts](../guides/developers/thinking-in-contexts.md)

**For content authors** (writing pages in markdown):
- [Writing Content](../guides/authors/writing-content.md)
- [Site Setup](../guides/authors/site-setup.md)
- [Theming](../guides/authors/theming.md)
- [Recipes](../guides/authors/recipes.md)

---

## Getting Help

- **CLI help**: `uniweb --help`
- **Issues**: [github.com/uniweb/cli/issues](https://github.com/uniweb/cli/issues)
