# Page Configuration

The `page.yml` file in each page folder defines metadata, layout options, SEO settings, and data sources for that page.

## Quick Start

A minimal page.yml:

```yaml
title: About Us
```

That's all you need. The page renders all `.md` files in the folder as sections.

## Full Reference

```yaml
# Identity
title: About Us
description: Learn about our company
label: About                    # Short nav label (defaults to title)
id: about                       # Stable ID for page: links

# Ordering
order: 2                        # Sort position in navigation

# Child Pages
pages: [team, history, careers] # Order child pages (first is index)
index: team                     # Or just set the index page

# Navigation Visibility
hidden: true                    # Hide from all navigation
hideInHeader: true              # Hide from header nav only
hideInFooter: true              # Hide from footer nav only

# Layout
layout:
  header: true                  # Show site header
  footer: true                  # Show site footer
  leftPanel: true               # Show left sidebar
  rightPanel: true              # Show right sidebar

# Sections
sections: '*'                   # Auto-discover (default)

# Data
data: articles                  # Shorthand for collection fetch
fetch:                          # Full fetch config
  path: /data/team.json
  schema: team

# SEO
seo:
  noindex: false
  image: /og-about.png
  changefreq: monthly
  priority: 0.8
```

---

## Identity

```yaml
title: About Us
description: Learn about our company and team
label: About
id: about-page
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Page title (browser tab, navigation) |
| `description` | string | Meta description for SEO |
| `label` | string | Short label for navigation (defaults to title) |
| `id` | string | Stable ID for `page:` links (see [Linking](./linking.md)) |

### Why Use Labels?

When your title is long, provide a shorter label for navigation:

```yaml
title: Getting Started with Uniweb Components
label: Getting Started
```

Navigation shows "Getting Started" while the page title remains descriptive.

### Why Use IDs?

IDs let links survive page reorganization:

```yaml
# pages/docs/setup/installation/page.yml
id: installation
title: Installation Guide
```

Now `[Install](page:installation)` works regardless of where the page moves.

---

## Ordering

Control where the page appears in navigation.

```yaml
order: 2
```

Lower numbers appear first. Pages without `order` are sorted after those with it, alphabetically by folder name.

---

## Child Page Ordering

When a page has child pages (subfolders), control their order.

### Explicit Order

```yaml
# pages/docs/page.yml
pages: [getting-started, guides, api-reference]
```

- First item becomes the index (route `/docs` shows `getting-started`)
- Others get routes like `/docs/guides`, `/docs/api-reference`

### Just Set the Index

```yaml
index: getting-started
```

Designate which child page is the index. Others are auto-discovered.

### Auto-Discovery (Default)

Omit both to auto-discover children. They're sorted by their `order` property, and the lowest becomes the index.

---

## Navigation Visibility

Control where the page appears in automatically-generated navigation.

```yaml
hidden: true          # Hide everywhere (page still accessible via URL)
hideInHeader: true    # Hide from header navigation only
hideInFooter: true    # Hide from footer navigation only
```

| Option | Header Nav | Footer Nav | Direct URL |
|--------|------------|------------|------------|
| (default) | ✓ | ✓ | ✓ |
| `hideInHeader: true` | ✗ | ✓ | ✓ |
| `hideInFooter: true` | ✓ | ✗ | ✓ |
| `hidden: true` | ✗ | ✗ | ✓ |

Use cases:
- **Admin pages**: `hidden: true`
- **Legal pages**: `hideInHeader: true` (show only in footer)
- **Landing pages**: `hideInFooter: true` (show only in header)

---

## Layout Options

Control which site-wide elements appear on this page.

```yaml
layout:
  header: false       # Don't show site header
  footer: false       # Don't show site footer
  leftPanel: false    # Don't show left sidebar
  rightPanel: false   # Don't show right sidebar
```

All options default to `true`.

### Use Cases

**Full-screen landing page:**
```yaml
title: Welcome
layout:
  header: false
  footer: false
```

**Documentation without sidebars:**
```yaml
title: Quick Reference
layout:
  leftPanel: false
  rightPanel: false
```

### Checking in Components

Foundation components can check these settings:

```jsx
function MyLayout({ block }) {
  const page = block.page

  return (
    <>
      {page.hasHeader() && <Header />}
      <main>{/* content */}</main>
      {page.hasFooter() && <Footer />}
    </>
  )
}
```

---

## Section Ordering

Control which sections appear and in what order.

### Auto-Discovery (Default)

```yaml
sections: '*'
```

Discovers all `.md` files in the folder, sorted by numeric prefix:

```
pages/home/
├── 1-hero.md         # First
├── 2-features.md     # Second
├── 2.5-testimonials.md  # Between 2 and 3
└── 3-cta.md          # Third
```

### Explicit Order

```yaml
sections:
  - hero
  - features
  - testimonials
  - cta
```

Reference sections by filename (without prefix and extension).

### Nested Sections (Subsections)

```yaml
sections:
  - hero
  - features:          # Parent section
      - logocloud      # Child sections
      - stats
  - pricing
```

### No Sections

```yaml
sections: []
```

Pure route page with no content sections (useful for pages that only have child pages).

---

## Data Fetching

Load external data for components on this page.

### Simple Collection Reference

```yaml
data: articles
```

Fetches from `/data/articles.json` (generated from a collection). Components with `inheritData: true` receive it.

### Full Fetch Configuration

```yaml
fetch:
  path: /data/team.json
  schema: team
  prerender: true
```

### Remote Data

```yaml
fetch:
  url: https://api.example.com/data
  schema: apiData
  transform: data.items
```

See [Data Fetching](./data-fetching.md) for all options.

---

## SEO Configuration

Fine-tune search engine optimization.

```yaml
seo:
  noindex: false           # Allow indexing (default)
  image: /og-about.png     # Open Graph image
  changefreq: monthly      # Sitemap change frequency
  priority: 0.8            # Sitemap priority (0.0-1.0)
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `noindex` | boolean | Prevent search engine indexing |
| `image` | string | Open Graph / social sharing image |
| `changefreq` | string | Sitemap hint: `always`, `hourly`, `daily`, `weekly`, `monthly`, `yearly`, `never` |
| `priority` | number | Sitemap priority (0.0 to 1.0, default 0.5) |

### Noindex Pages

```yaml
# pages/admin/page.yml
title: Admin Dashboard
seo:
  noindex: true
```

This page won't appear in search results or the search index.

---

## Dynamic Routes

For pages generated from data, use `[param]` folder naming:

```
pages/blog/
├── page.yml              # data: articles
└── [slug]/               # Dynamic route
    ├── page.yml
    └── 1-article.md
```

The child `page.yml` is minimal:

```yaml
title: Article
```

Page metadata (title, description) comes from the data item at runtime.

See [Dynamic Routes](./dynamic-routes.md) for the full guide.

---

## Versioned Documentation

For versioned docs, folder structure triggers version detection:

```
pages/docs/
├── page.yml              # Optional version metadata
├── v1/
│   └── intro/
└── v2/
    └── intro/
```

Configure version labels in the parent:

```yaml
# pages/docs/page.yml
title: Documentation
versions:
  v2:
    label: "2.0 (Current)"
    latest: true
  v1:
    label: "1.0 (Legacy)"
    deprecated: true
```

See [Versioning](./versioning.md) for details.

---

## Complete Examples

### Marketing Page

```yaml
title: About Us
description: Learn about our mission and team
order: 2

seo:
  image: /og-about.png
  priority: 0.8
```

### Documentation Section

```yaml
title: Documentation
label: Docs
order: 3

pages: [getting-started, guides, api]

layout:
  leftPanel: true
  rightPanel: false
```

### Blog Listing

```yaml
title: Blog
description: Latest articles and tutorials

data: articles

seo:
  changefreq: weekly
```

### Admin Page (Hidden)

```yaml
title: Admin Dashboard
hidden: true

layout:
  header: false

seo:
  noindex: true
```

---

## See Also

- [Site Configuration](./site-configuration.md) — site.yml reference
- [Content Structure](./content-structure.md) — Section content format
- [Linking](./linking.md) — Stable page references with IDs
- [Dynamic Routes](./dynamic-routes.md) — Data-driven pages
- [Versioning](./versioning.md) — Multi-version documentation
