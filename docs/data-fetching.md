# Dynamic Data Fetching

Load external data from local files or remote URLs and make it available to your components. Data can be fetched at build time (for static sites) or runtime (for dynamic content).

## Overview

The `fetch` property lets you load structured data into `content.data`. It works at three levels:

| Level | File | Scope |
|-------|------|-------|
| **Section** | Frontmatter | Available to that section's component |
| **Page** | `page.yml` | Cascaded to all sections on that page |
| **Site** | `site.yml` | Cascaded to all pages and sections |

Data cascades down: site → page → section. Components opt into receiving cascaded data via `inheritData` in their `meta.js`.

---

## Basic Usage

### Section-level fetch

The simplest form—load data for a specific section:

```markdown
---
type: TeamGrid
fetch: /data/team.json
---

# Our Team

Meet the people behind the project.
```

The component receives the data in `content.data.team` (key inferred from filename).

### Page-level fetch

Load data once, share with all sections on a page:

```yaml
# pages/about/page.yml
title: About Us
fetch:
  path: /data/team.json
  schema: people
```

All sections on `/about` can access `content.data.people` if they opt in.

### Site-level fetch

Load global data available everywhere:

```yaml
# site.yml
name: My Site
fetch:
  path: /data/config.json
  schema: siteConfig
```

---

## Full Configuration

```yaml
fetch:
  path: /data/team.json      # Local file (under public/)
  # OR
  url: https://api.example.com/team  # Remote URL

  schema: person             # Key in content.data (default: inferred from filename)
  prerender: true            # Build-time fetch (default: true)
  merge: false               # Replace existing data (default: false)
  transform: data.items      # Extract nested path from response
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `path` | — | Local file path relative to `public/` |
| `url` | — | Remote URL (mutually exclusive with `path`) |
| `schema` | *filename* | Key under `content.data` where data is stored |
| `prerender` | `true` | Fetch at build time (SSG) vs runtime |
| `merge` | `false` | Combine with existing data vs replace |
| `transform` | — | Dot-path to extract from response (e.g., `data.items`) |

### Schema inference

When `schema` is omitted, it's inferred from the filename:

```yaml
fetch: /data/team-members.json  # → schema: team-members
fetch: /api/events.yaml         # → schema: events
```

---

## Data Cascading

Data flows from site → page → section. Components must opt in to receive cascaded data.

### Component opt-in (meta.js)

```js
// foundation/src/components/TeamGrid/meta.js
export default {
  title: 'Team Grid',

  // Accept all cascaded data
  inheritData: true,

  // Or be selective
  inheritData: ['person', 'config'],
}
```

### Precedence

Local data (from tagged blocks or section fetch) takes precedence over cascaded data:

```
Section fetch/tagged blocks  →  highest priority
Page fetch                   →  medium priority
Site fetch                   →  lowest priority
```

If a section has `yaml:team` and the page also fetches `team`, the tagged block wins.

---

## Build-time vs Runtime

### Build-time (default)

```yaml
fetch:
  path: /data/team.json
  prerender: true  # default
```

- Data fetched during `uniweb build`
- Embedded in static HTML
- Fast page loads, SEO-friendly
- Data is snapshot at build time

### Runtime

```yaml
fetch:
  url: https://api.example.com/team
  prerender: false
```

- Data fetched when page loads in browser
- Always fresh
- Requires JavaScript
- Good for frequently changing data

---

## Merge vs Replace

### Replace (default)

```yaml
fetch:
  path: /data/team.json
  merge: false  # default
```

Fetched data completely replaces any existing data under that schema key.

### Merge

```yaml
fetch:
  path: /data/more-team.json
  schema: team
  merge: true
```

- **Arrays**: Concatenated (`[...existing, ...fetched]`)
- **Objects**: Shallow merged (`{ ...existing, ...fetched }`)

Useful for combining data from multiple sources.

---

## Local Files

**Prefer collections over manual JSON files.** Collections provide:
- Markdown-based authoring with frontmatter
- Automatic i18n support
- Better content management

See [Content Collections](./content-collections.md) for the recommended approach.

### Manual JSON files (when needed)

For configuration data or integration with external tools that generate JSON, you can place files in `public/data/`:

```
site/
├── public/
│   └── data/
│       └── config.json    # For config/integration data
├── library/
│   └── team/              # Prefer: markdown collection
│       ├── alice.md
│       └── bob.md
└── pages/
```

Reference with paths starting with `/`:

```yaml
fetch: /data/config.json
```

Both JSON and YAML are supported.

---

## Remote URLs

Fetch from any URL:

```yaml
fetch:
  url: https://api.example.com/v1/team
  schema: team
  transform: data.members
```

### Transform

Many APIs wrap data in a response envelope:

```json
{
  "status": "ok",
  "data": {
    "members": [...]
  }
}
```

Use `transform` to extract the relevant part:

```yaml
fetch:
  url: https://api.example.com/team
  transform: data.members  # Gets just the array
```

---

## Collection References

If you're using [Content Collections](./content-collections.md), there are two ways to reference collection data.

### The `data:` shorthand (recommended)

The simplest way to use collection data:

```yaml
# pages/home/teaser.md
---
type: ArticleTeaser
data: articles
---

# Latest Articles
```

This fetches from `/data/articles.json` and makes it available as `content.data.articles`. Clean and readable.

### The `fetch:` syntax (advanced)

For more control, use the full fetch syntax with post-processing options:

```yaml
# pages/home/teaser.md
---
type: ArticleTeaser
fetch:
  collection: articles   # Fetches from /data/articles.json
  limit: 3               # Show only 3 items
  sort: date desc        # Most recent first
---

# Latest Articles
```

### When to use which

| Syntax | Use case |
|--------|----------|
| `data: articles` | Simple collection reference, no filtering/sorting needed |
| `fetch: { collection: articles, ... }` | Need limit, sort, filter, or other options |
| `fetch: { path: /data/file.json }` | Non-collection JSON files |
| `fetch: { url: https://... }` | Remote data sources |

The `data:` shorthand is equivalent to `fetch: { collection: name }` but more compact.

### Post-processing Options

Collection references support filtering, sorting, and limiting:

```yaml
fetch:
  collection: articles
  filter: tags contains featured   # Only featured articles
  sort: date desc                  # Newest first
  limit: 3                         # Take first 3
```

These options also work with regular `path` or `url` fetches:

```yaml
fetch:
  path: /data/articles.json
  limit: 5
  sort: date desc
```

### Post-processing Order

1. **Filter** is applied first (reduces the dataset)
2. **Sort** is applied second (orders the filtered data)
3. **Limit** is applied last (takes first N items)

### Filter Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `==` | `category == news` | Equal |
| `!=` | `draft != true` | Not equal |
| `>` | `date > 2025-01-01` | Greater than |
| `<` | `price < 100` | Less than |
| `>=` | `rating >= 4` | Greater than or equal |
| `<=` | `order <= 10` | Less than or equal |
| `contains` | `tags contains featured` | Array includes value |

---

## Using Standard Schemas

For validated, structured data, use `@uniweb/schemas`:

```bash
pnpm add @uniweb/schemas
```

```js
// foundation/src/components/TeamGrid/meta.js
import { person } from '@uniweb/schemas'

export default {
  title: 'Team Grid',
  schemas: {
    team: person,  // Validate fetched data against person schema
  },
  inheritData: ['team'],
}
```

The runtime applies defaults from the schema and ensures data structure.

---

## Component Usage

```jsx
export function TeamGrid({ content, params }) {
  // Data from fetch, tagged blocks, or cascaded from page/site
  const team = content.data.team || []

  return (
    <div className="grid grid-cols-3 gap-8">
      {team.map(member => (
        <div key={member.name}>
          <img src={member.avatar} alt={member.name} />
          <h3>{member.name}</h3>
          <p>{member.role}</p>
        </div>
      ))}
    </div>
  )
}
```

---

## Examples

### Team page with local data

```yaml
# pages/team/page.yml
title: Our Team
fetch: /data/team.json
```

```markdown
---
type: TeamGrid
---

# Meet the Team
```

```js
// meta.js
export default {
  title: 'Team Grid',
  inheritData: true,
}
```

### Blog with remote API

```yaml
# pages/blog/page.yml
title: Blog
fetch:
  url: https://api.myblog.com/posts
  schema: posts
  transform: data.articles
  prerender: false  # Always fresh
```

### Site-wide config

```yaml
# site.yml
name: My Site
fetch:
  path: /data/site-config.json
  schema: config
```

```js
// Any component with inheritData: ['config']
export function Footer({ content }) {
  const config = content.data.config || {}
  return <footer>{config.copyright}</footer>
}
```

---

## Error Handling

If a fetch fails:
- An empty array `[]` is used as fallback
- A warning is logged during build
- The page still renders (graceful degradation)

Components should always handle the case where data might be empty.

---

## See Also

- [Dynamic Routes](./dynamic-routes.md) — Generate multiple pages from data (blogs, catalogs, etc.)
- [Content Collections](./content-collections.md) — Markdown-based data collections
- [Content Structure](./content-structure.md) — How content is parsed and structured
- [Component Metadata](./component-metadata.md) — Full meta.js schema reference
