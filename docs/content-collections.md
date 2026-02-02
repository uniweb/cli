# Content Collections

Author content in markdown, YAML, or JSON and automatically generate data files. Collections let you maintain blog posts, team members, schedules, or any structured data as individual files in a `library/` folder — `.md` for rich content with body text, `.yml`/`.yaml` for pure structural data, `.json` for existing JSON data or API responses.

## The Data Layer

Collections are authored in `library/` folders and referenced from pages with `data: collection-name`. The build converts them to JSON in `public/data/`, which is an output directory — you don't need to interact with it directly.

There are three ways to provide data to components:

**Collections** (`library/` folders) — Author content as `.md`, `.yml`, or `.json` files. The build converts them to JSON. Markdown items get ProseMirror content bodies, excerpts, and co-located assets automatically. YAML and JSON items pass through as-is. Use `.md` for content with body text (blog posts, case studies), `.yml` or `.json` for purely structural data (schedules, pricing tiers).

**Runtime data** (API fetch) — For production sites where a CMS or backend manages content and serves pre-localized data. Components receive it the same way as static data (via `content.data`).

**Hand-written JSON** (`public/data/` directly) — Power-user pattern for template demo data, configuration-like data, or external tool integration. Provide a companion `.schema.js` for precise control over which fields the i18n system extracts; otherwise it uses heuristics.

Both collections and hand-written JSON get the same i18n treatment — `uniweb i18n extract` processes all JSON files in `public/data/` by default.

**Rule of thumb:** If authors maintain the content and it needs translation, use collections in `library/`. If it's structural or comes from an external system, use runtime fetch.

---

## Overview

Content collections separate **content authoring** from **page structure**:

- **Pages** (in `pages/`) define what components render where
- **Collections** (in `library/`) define data items as markdown or YAML files
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

Each `.md` file in a collection becomes a JSON object with the following fields. For `.yml`/`.yaml` and `.json` files, see [Data Items (YAML)](#data-items-yaml) and [Data Items (JSON)](#data-items-json) — they produce only `slug` plus whatever fields you declare.

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

## Data Items (YAML)

For collections where items are pure structural data — no body text, no excerpts, no images — use `.yml` or `.yaml` files instead of markdown. The file extension signals intent:

| File type | What it means | Output |
|-----------|---------------|--------|
| `.md` | Content item (article-like) | slug + frontmatter + body + content + excerpt + image + lastModified |
| `.yml`/`.yaml` | Data item (structural) | slug + YAML fields only |
| `.json` | Data item or multi-item file | Object → slug + JSON fields. Array → all items directly |

A YAML item skips ProseMirror conversion, body extraction, excerpt generation, image detection, and file stat — its output is just `slug` plus the fields you declare.

### Example: Conference schedule

```
site/
└── library/
    └── schedule/
        ├── keynote.yml
        ├── workshop-react.yml
        └── panel-ai.yml
```

```yaml
# library/schedule/keynote.yml
title: Opening Keynote
speaker: Ada Lovelace
time: "09:00"
room: Main Hall
track: general
```

Generated JSON:

```json
[
  {
    "slug": "keynote",
    "title": "Opening Keynote",
    "speaker": "Ada Lovelace",
    "time": "09:00",
    "room": "Main Hall",
    "track": "general"
  }
]
```

No `body`, `content`, `excerpt`, `image`, or `lastModified` — just the data you declared.

### Mixing file types

A single collection can contain `.md`, `.yml`, and `.json` files together. This is useful when some items need rich body content and others are purely structural:

```
site/
└── library/
    └── team/
        ├── alice.md       # Has a bio (rich content)
        ├── bob.md         # Has a bio
        └── vacant.yml     # Open position — just metadata
```

Filtering, sorting, and limiting work identically across both file types.

### `published: false`

Just like markdown items, YAML items with `published: false` are excluded from the output:

```yaml
# Excluded from generated JSON
published: false
title: Coming Soon
```

---

## Data Items (JSON)

For existing JSON data — API responses, exports from other tools, or data you already have in JSON format — place `.json` files in the collection folder. JSON items work like YAML items: pure data, no ProseMirror conversion.

### Single-item files

A `.json` file containing an object is treated as a single item. The slug comes from the filename:

```json
// library/team/alice.json
{
  "name": "Alice",
  "role": "Engineer",
  "avatar": "/images/alice.jpg"
}
```

Output: `{ "slug": "alice", "name": "Alice", "role": "Engineer", ... }`

### Multi-item files

A `.json` file containing an array contributes all items directly — useful for importing existing datasets or API responses:

```json
// library/products/catalog.json
[
  { "slug": "widget-a", "name": "Widget A", "price": 29 },
  { "slug": "widget-b", "name": "Widget B", "price": 49 }
]
```

Both items are added to the collection. Array items should include their own `slug` field since there's no filename to infer it from.

### `published: false`

Single-item JSON files with `published: false` are excluded, just like YAML items. For array items, filtering is not applied per-item — use the collection's `filter` option instead.

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

## Co-located Assets

Collection items can reference assets stored alongside their markdown files using relative paths. This keeps related content together and makes it easy to manage.

### Directory Structure

```
site/
└── library/
    └── articles/
        ├── getting-started.md
        ├── getting-started-diagram.svg    # Co-located with article
        ├── design-patterns.md
        └── design-patterns-architecture.png
```

### Referencing Co-located Assets

Use `./` to reference files in the same folder:

```markdown
---
title: Getting Started
---

Here's how the architecture works:

![Architecture Diagram](./getting-started-diagram.svg)

The system consists of three main parts...
```

### Build Processing

At build time, the collection processor:

1. **Detects relative paths** — Any `./` or `../` path in the content
2. **Copies assets** — Files are copied to `public/library/<collection>/`
3. **Updates paths** — References become site-root-relative (`/library/articles/diagram.svg`)

This means your content stays portable—move an article and its assets together, and everything still works.

### Supported Asset Types

Co-located assets work for all media types:

```markdown
<!-- Images -->
![Diagram](./architecture.svg)
![Photo](./team-photo.jpg)

<!-- Videos -->
![Demo](./demo.mp4){role=video poster=./demo-poster.jpg}

<!-- Documents -->
![Download](./whitepaper.pdf){role=document preview=./whitepaper-preview.png}
```

### Path Resolution

| Path Format | Resolution |
|-------------|------------|
| `./file.jpg` | Same folder as the markdown file |
| `../shared/logo.svg` | Parent folder |
| `/images/hero.jpg` | Site's `public/` folder (unchanged) |
| `https://...` | External URL (unchanged) |

### Output Location

Co-located assets are copied to `public/library/<collection-name>/`:

```
public/
└── library/
    └── articles/
        ├── getting-started-diagram.svg
        └── design-patterns-architecture.png
```

The JSON output references these processed paths:

```json
{
  "slug": "getting-started",
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "image",
        "attrs": {
          "src": "/library/articles/getting-started-diagram.svg",
          "alt": "Architecture Diagram"
        }
      }
    ]
  }
}
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
│       ├── list.md
│       └── [slug]/
│           ├── page.yml
│           └── article.md
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
# pages/home/teaser.md
---
type: ArticleTeaser
data: articles
---

# Latest from the Blog
```

This fetches from `/data/articles.json` and makes it available as `content.data.articles`.

For more control (filtering, sorting, limiting), use the full `fetch:` syntax:

```yaml
# pages/home/teaser.md
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
| Invalid frontmatter (`.md`) | Error with filename, file skipped |
| Invalid YAML (`.yml`) | Error with filename, file skipped |
| Invalid JSON (`.json`) | Error with filename, file skipped |
| Unpublished items | Excluded from output (`.md`, `.yml`, and single-object `.json`) |
| No date field with date sort | Items sorted by filename |
| Mixed `.md`, `.yml`, and `.json` files | All processed; same filtering/sorting/limiting applies |
| Nested folders | Not supported (flat structure only) |

---

## i18n for JSON Data

The i18n extraction pipeline identifies translatable strings in collection data using one of two strategies:

### Schema-guided extraction

Provide a companion schema file alongside your JSON data. The schema tells the extractor exactly which fields contain translatable text:

```
public/data/
├── events.json
└── events.schema.js    # Companion schema
```

```js
// events.schema.js
export default {
  name: 'event',
  fields: {
    title: { type: 'string' },                    // Extracted (string → translatable by default)
    description: { type: 'markdown' },             // Extracted (markdown → always translatable)
    slug: { type: 'string', translatable: false },  // Skipped (explicit opt-out)
    type: { type: 'string', enum: ['workshop', 'talk'] },  // Skipped (enum → not translatable)
    startDate: { type: 'datetime' },               // Skipped (datetime → never translatable)
    location: {
      type: 'object',
      fields: {
        name: { type: 'string' },                  // Extracted (nested string)
        url: { type: 'url' },                      // Skipped (url → never translatable)
      }
    },
    tags: {
      type: 'array',
      items: { type: 'string' }                    // Extracted (array of strings)
    },
  }
}
```

**Type-based defaults:**

| Type | Default | Override with |
|------|---------|--------------|
| `string` | translatable | `translatable: false` to skip |
| `string` + `enum` | NOT translatable | `translatable: true` to include |
| `markdown` | always translatable | — |
| `number`, `boolean`, `date`, `datetime` | never | — |
| `url`, `email`, `image` | never | — |
| `object` | recurse into `fields` | — |
| `array` | recurse into `items` | — |

**Schema discovery order:**

1. Companion file: `public/data/<name>.schema.js`
2. Standard schema: matching name in `@uniweb/schemas` (with automatic singularization — `events` matches the `event` schema)
3. No schema found → heuristic fallback

### Heuristic extraction (no schema)

When no schema is found, the extractor recursively walks the JSON data and extracts all strings that look like human-readable text. It skips:

- **Structural field names** — `slug`, `id`, `type`, `status`, `href`, `url`, `email`, `icon`, `target`, dates, etc.
- **Structural string patterns** — URLs, email addresses, ISO dates, hex colors, file paths, currency codes, plain numbers

This works well for most data but may occasionally include strings you don't want translated (or miss strings you do). For precise control, provide a companion schema.

### Item identification

Collection items are identified by `slug`, `id`, or `name` (checked in that order). If none is found, the item is labeled `unknown` in the manifest. Make sure your JSON items have at least one of these fields for clear translation context.

---

## See Also

- [Dynamic Routes](./dynamic-routes.md) — Generate pages from collection data
- [Data Fetching](./data-fetching.md) — The `data:` shorthand and advanced `fetch:` syntax
- [Content Structure](./content-structure.md) — How markdown content is parsed
