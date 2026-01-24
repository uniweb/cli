# Content Collections

Author content in markdown and automatically generate JSON data files. Collections let you maintain blog posts, team members, products, or any structured data as markdown files with frontmatter metadata.

## Overview

Content collections separate **content authoring** from **page structure**:

- **Pages** (in `pages/`) define what components render where
- **Collections** (in `library/`) define data items as markdown files
- At build time, collections become JSON files in `public/data/`
- Pages reference collections using `data: collection-name`

This keeps content portable and component-independent.

---

## Quick Start

### 1. Create a collection folder

```
site/
└── library/
    └── articles/
        ├── getting-started.md
        ├── design-patterns.md
        └── advanced-features.md
```

### 2. Write content with frontmatter

```markdown
---
title: Getting Started with Uniweb
date: 2025-01-15
author: Sarah Chen
tags: [tutorial, beginner]
---

Learn how to build your first site with Uniweb.

## Installation

First, create a new project...
```

### 3. Declare collection in site.yml

```yaml
# site.yml
name: My Site
collections:
  articles:
    path: library/articles
    sort: date desc
```

### 4. Use in pages

```yaml
# pages/blog/page.yml
title: Blog
data: articles
```

The build automatically generates `public/data/articles.json`, and `data: articles` makes it available to your components.

For more control, use the full fetch syntax: `fetch: /data/articles.json` or `fetch: { collection: articles, limit: 10 }`.

---

## Collection Configuration

### site.yml syntax

```yaml
collections:
  # Simple form (just path)
  articles: library/articles

  # Extended form (with options)
  articles:
    path: library/articles
    sort: date desc           # Field + direction
    filter: published != false
    limit: 100                # Max items (0 = unlimited)
    excerpt:
      maxLength: 160          # Auto-excerpt character limit
      field: description      # Use this frontmatter field if present
```

### Multiple collections

```yaml
collections:
  articles:
    path: library/articles
    sort: date desc

  products:
    path: library/products
    sort: price asc

  team:
    path: library/team
    sort: order asc
```

Each collection generates its own JSON file: `/data/articles.json`, `/data/products.json`, `/data/team.json`.

---

## Content Item Fields

Each markdown file in a collection becomes a JSON object:

| Field | Source | Notes |
|-------|--------|-------|
| `slug` | Filename | `getting-started.md` → `"getting-started"` |
| `title` | Frontmatter | Typically required |
| `date` | Frontmatter | ISO date string |
| `author` | Frontmatter | String or object |
| `tags` | Frontmatter | Array of strings |
| `published` | Frontmatter | Boolean (default: `true`) |
| `image` | Frontmatter or auto | First image in content if not specified |
| `excerpt` | Frontmatter or auto | First ~160 chars if not specified |
| `content` | Parsed body | ProseMirror JSON structure |
| `lastModified` | File system | ISO timestamp |
| *custom* | Frontmatter | All other fields pass through |

### Example generated JSON

```json
[
  {
    "slug": "getting-started",
    "title": "Getting Started with Uniweb",
    "date": "2025-01-15",
    "author": "Sarah Chen",
    "tags": ["tutorial", "beginner"],
    "published": true,
    "excerpt": "Learn how to build your first site...",
    "content": { "type": "doc", "content": [...] },
    "lastModified": "2025-01-15T10:30:00.000Z"
  }
]
```

---

## Filtering

Filter items using simple expressions:

```yaml
collections:
  articles:
    path: library/articles
    filter: published != false
```

### Supported operators

| Operator | Example | Description |
|----------|---------|-------------|
| `==` | `category == tutorial` | Equal |
| `!=` | `published != false` | Not equal |
| `>` | `date > 2025-01-01` | Greater than |
| `<` | `price < 100` | Less than |
| `>=` | `rating >= 4` | Greater than or equal |
| `<=` | `order <= 10` | Less than or equal |
| `contains` | `tags contains featured` | Array includes value |

### Examples

```yaml
# Only published items
filter: published != false

# Items after a date
filter: date > 2025-01-01

# Items with a specific tag
filter: tags contains featured

# Items in a category
filter: category == tutorial
```

---

## Sorting

Sort by one or more fields:

```yaml
collections:
  articles:
    path: library/articles
    sort: date desc         # Newest first

  products:
    path: library/products
    sort: price asc         # Cheapest first

  team:
    path: library/team
    sort: order asc, name asc  # By order, then alphabetically
```

### Sort direction

- `asc` — Ascending (A-Z, 1-9, oldest first)
- `desc` — Descending (Z-A, 9-1, newest first)

---

## Limiting

Limit the number of items in the output:

```yaml
collections:
  # Latest 10 articles only
  articles:
    path: library/articles
    sort: date desc
    limit: 10
```

Use `limit: 0` (or omit) for no limit.

---

## Unpublished Content

Items with `published: false` in frontmatter are excluded from the generated JSON:

```markdown
---
title: Draft Post
published: false
---

This won't appear in the output.
```

By default, items without a `published` field are included (treated as `published: true`).

---

## Excerpts

Excerpts are automatically generated from content:

```yaml
collections:
  articles:
    path: library/articles
    excerpt:
      maxLength: 200        # Character limit (default: 160)
      field: description    # Prefer this frontmatter field
```

### Excerpt precedence

1. Explicit `excerpt` in frontmatter
2. `field` specified in config (e.g., `description`)
3. Auto-extracted from content body

### Auto-extraction

The first ~160 characters of plain text are extracted, truncated at a word boundary with `...` appended.

---

## Images

The `image` field is populated from:

1. Explicit `image` in frontmatter
2. First image found in the markdown content

```markdown
---
title: My Post
image: /images/hero.jpg  # Explicit
---

Or automatically extracted from:

![Hero](images/auto-detected.jpg)
```

---

## Complete Example: Blog

### Directory structure

```
site/
├── site.yml
├── library/
│   └── articles/
│       ├── getting-started.md
│       ├── design-patterns.md
│       └── advanced-features.md
├── pages/
│   └── blog/
│       ├── page.yml
│       ├── 1-list.md
│       └── [slug]/
│           ├── page.yml
│           └── 1-article.md
└── public/
    └── data/
        └── articles.json  # Auto-generated
```

### site.yml

```yaml
name: My Blog
collections:
  articles:
    path: library/articles
    sort: date desc
```

### library/articles/getting-started.md

```markdown
---
title: Getting Started with Uniweb
date: 2025-01-15
author: Sarah Chen
tags: [tutorial, beginner]
---

Learn how to build your first site with Uniweb.

## Installation

First, create a new project:

\`\`\`bash
npx uniweb create my-site
\`\`\`

## Configuration

Edit `site.yml` to set your site name...
```

### pages/blog/page.yml

```yaml
title: Blog
data: articles
```

### Using with Dynamic Routes

Combine collections with [dynamic routes](./dynamic-routes.md) for individual article pages:

```yaml
# pages/blog/[slug]/page.yml
title: Article
```

The parent's fetched data (`articles`) cascades to the dynamic route. Each generated page (`/blog/getting-started`, `/blog/design-patterns`, etc.) receives the current item as `content.data.article`.

See [Dynamic Routes](./dynamic-routes.md) for details.

### Referencing Collections in Other Pages

Use the `data:` shorthand to fetch collection data anywhere in your site:

```yaml
# pages/home/1-teaser.md
---
type: ArticleTeaser
data: articles
---

# Latest from the Blog
```

This fetches from `/data/articles.json` and makes it available as `content.data.articles`.

For more control (filtering, sorting, limiting), use the full `fetch:` syntax:

```yaml
# pages/home/1-teaser.md
---
type: ArticleTeaser
fetch:
  collection: articles   # Fetches from /data/articles.json
  limit: 3               # Only 3 articles
  sort: date desc        # Most recent first
---

# Latest from the Blog
```

See [Data Fetching](./data-fetching.md#collection-references) for details.

---

## Dev Mode

During development (`pnpm dev`):

- Collection folders are watched for changes
- JSON files regenerate automatically when content changes
- Hot reload triggers when collections update

---

## Build Output

During production build (`pnpm build`):

1. Collections are processed before Vite build
2. JSON files are written to `public/data/`
3. They're included in the final `dist/` output

---

## Edge Cases

| Situation | Behavior |
|-----------|----------|
| Missing collection folder | Warning logged, empty array generated |
| Empty collection | Empty array `[]` generated |
| Invalid frontmatter | Error with filename, file skipped |
| Unpublished items | Excluded from output |
| No date field with date sort | Items sorted by filename |
| Nested folders | Not supported (flat structure only) |

---

## See Also

- [Dynamic Routes](./dynamic-routes.md) — Generate pages from collection data
- [Data Fetching](./data-fetching.md) — The `data:` shorthand and advanced `fetch:` syntax
- [Content Structure](./content-structure.md) — How markdown content is parsed
