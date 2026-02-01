# Dynamic Routes

Generate multiple pages from a single template using data. Perfect for blogs, product catalogs, team directories, and any content where each item needs its own page.

## Overview

Dynamic routes use a special `[param]` folder naming convention. At build time, the folder expands into multiple pages—one for each item in the parent's data.

```
pages/
└── blog/
    ├── page.yml              # Fetches articles data
    ├── list.md               # Blog listing page
    └── [slug]/               # Dynamic route → expands to /blog/post-1, /blog/post-2, etc.
        ├── page.yml
        └── article.md        # Article template
```

**Result after build:**
```
/blog                         # List of all articles
/blog/getting-started         # Individual article (slug: "getting-started")
/blog/advanced-features       # Individual article (slug: "advanced-features")
/blog/best-practices          # Individual article (slug: "best-practices")
```

---

## Quick Start

### 1. Create a collection

Create markdown files in `library/articles/`:

```markdown
<!-- library/articles/getting-started.md -->
---
title: Getting Started with Uniweb
excerpt: Learn the basics...
author: Jane Doe
date: 2025-01-15
---

Your article content here...
```

```markdown
<!-- library/articles/advanced-features.md -->
---
title: Advanced Features
excerpt: Deep dive into...
author: John Smith
date: 2025-01-20
---

Your article content here...
```

The filename becomes the `slug` (e.g., `getting-started`).

### 2. Set up the parent page with data

```yaml
# pages/blog/page.yml
title: Blog
description: Latest articles and tutorials
data: articles
```

This references the `articles` collection. The build generates JSON automatically from your markdown files.

### 3. Create the dynamic route folder

```yaml
# pages/blog/[slug]/page.yml
title: Article
description: Blog article
```

```markdown
<!-- pages/blog/[slug]/article.md -->
---
type: Article
---
```

### 4. Create your component with inheritData

```js
// foundation/src/sections/Article/meta.js
export default {
  title: 'Article',
  inheritData: ['article', 'articles'],  // Receives current + all items
}
```

```jsx
// foundation/src/sections/Article/index.jsx
export function Article({ content }) {
  const article = content.data.article
  const allArticles = content.data.articles || []

  if (!article) {
    return <div>Article not found</div>
  }

  return (
    <article>
      <h1>{article.title}</h1>
      <p>By {article.author} on {article.date}</p>
      <p>{article.excerpt}</p>

      <h2>More Articles</h2>
      <ul>
        {allArticles
          .filter(a => a.slug !== article.slug)
          .map(a => (
            <li key={a.slug}>
              <a href={`/blog/${a.slug}`}>{a.title}</a>
            </li>
          ))}
      </ul>
    </article>
  )
}
```

---

## How It Works

### 1. Parent fetches data

The parent page (`/blog`) references collection data:

```yaml
# pages/blog/page.yml
data: articles
```

This is equivalent to `fetch: { collection: articles }` or `fetch: /data/articles.json`. The schema is inferred from the collection name.

### 2. Dynamic folder detected

The `[slug]` folder name tells the build system this is a dynamic route. The param name (`slug`) determines which field to use for URLs.

### 3. Routes expanded at build time

During prerender, the dynamic route expands:

| Template Route | Concrete Routes |
|----------------|-----------------|
| `/blog/:slug` | `/blog/getting-started` |
| | `/blog/advanced-features` |
| | `/blog/best-practices` |

### 4. Data cascaded to each page

Each generated page receives:

| Key | Value | Description |
|-----|-------|-------------|
| `content.data.article` | `{ slug, title, ... }` | Current item (singularized schema) |
| `content.data.articles` | `[...]` | All items from parent |

The schema name is automatically singularized: `articles` → `article`.

---

## Folder Naming

The param name comes from the folder name:

| Folder | Param | URL Pattern | Uses Field |
|--------|-------|-------------|------------|
| `[slug]` | `slug` | `/blog/:slug` | `item.slug` |
| `[id]` | `id` | `/products/:id` | `item.id` |
| `[username]` | `username` | `/users/:username` | `item.username` |

**Important:** Each item in your data array must have a field matching the param name.

---

## Data Structure

### Parent's fetch returns an array

```json
[
  { "slug": "post-1", "title": "First Post", ... },
  { "slug": "post-2", "title": "Second Post", ... }
]
```

### Each item needs the param field

If your folder is `[slug]`, every item must have a `slug` field:

```json
{ "slug": "my-post", "title": "My Post" }  // ✓ Good
{ "id": "123", "title": "My Post" }        // ✗ Missing slug
```

### Automatic singularization

The schema name is singularized for the current item:

| Parent Schema | Current Item Key | All Items Key |
|---------------|------------------|---------------|
| `articles` | `article` | `articles` |
| `products` | `product` | `products` |
| `people` | `person` | `people` |
| `posts` | `post` | `posts` |

Common irregular plurals are handled: `people` → `person`, `children` → `child`, etc.

---

## Component Setup

### Opting into cascaded data

Components must declare `inheritData` to receive the data:

```js
// meta.js
export default {
  title: 'Article',

  // Receive both singular (current) and plural (all)
  inheritData: ['article', 'articles'],
}
```

### Accessing the data

```jsx
export function Article({ content }) {
  // Current item for this page
  const article = content.data.article

  // All items (for "related" sections, navigation, etc.)
  const allArticles = content.data.articles || []

  // Always handle the case where data might be missing
  if (!article) {
    return <div>Article not found</div>
  }

  return (
    <article>
      <h1>{article.title}</h1>
      {/* ... */}
    </article>
  )
}
```

---

## Page Metadata

Dynamic pages automatically inherit metadata from the current item:

| Item Field | Page Property |
|------------|---------------|
| `title` | Page title (shown in browser tab) |
| `description` or `excerpt` | Meta description |

```json
{
  "slug": "getting-started",
  "title": "Getting Started",           // → <title>Getting Started</title>
  "description": "Learn the basics..."  // → <meta name="description" ...>
}
```

---

## Examples

### Blog with articles

```
pages/blog/
├── page.yml          # data: articles
├── list.md           # type: BlogList
└── [slug]/
    ├── page.yml
    └── article.md    # type: Article
```

### Product catalog

```
pages/products/
├── page.yml          # data: products
├── grid.md           # type: ProductGrid
└── [id]/
    ├── page.yml
    └── detail.md     # type: ProductDetail
```

### Team directory

```
pages/team/
├── page.yml          # data: team (or data: people with schema override)
├── overview.md       # type: TeamGrid
└── [username]/
    ├── page.yml
    └── profile.md    # type: PersonProfile
```

### Documentation with sections

```
pages/docs/
├── page.yml          # data: docs (or fetch: { collection: docs, schema: sections })
├── overview.md
└── [slug]/
    ├── page.yml
    └── content.md    # type: DocPage
```

---

## Multiple Sections on Dynamic Pages

Dynamic pages can have multiple sections, each receiving the cascaded data:

```
pages/blog/[slug]/
├── page.yml
├── 1-article.md      # type: Article (inheritData: ['article'])
├── 2-author.md       # type: AuthorBio (inheritData: ['article'])
└── 3-related.md      # type: RelatedPosts (inheritData: ['articles'])
```

Each component opts into the data it needs via `inheritData`.

---

## Combining with Other Features

### With tagged data blocks

Local data takes precedence over cascaded data:

```markdown
---
type: Article
---

# Custom Override

```yaml:article
title: This overrides the cascaded article
custom: true
```
```

### With additional fetches

Sections can have their own fetches that merge with cascaded data:

```markdown
---
type: Article
fetch:
  path: /data/comments.json
  schema: comments
---
```

The component receives both `content.data.article` (cascaded) and `content.data.comments` (fetched).

---

## Static Generation (SSG)

Dynamic routes are fully compatible with static site generation:

1. **Build time**: All routes are expanded and rendered to HTML
2. **Output**: Each route becomes a static `.html` file
3. **No server needed**: Host anywhere (Netlify, Vercel, GitHub Pages, etc.)

```
dist/
├── blog/
│   ├── index.html              # /blog (listing)
│   ├── getting-started/
│   │   └── index.html          # /blog/getting-started
│   ├── advanced-features/
│   │   └── index.html          # /blog/advanced-features
│   └── best-practices/
│       └── index.html          # /blog/best-practices
```

---

## Detail Queries

When a user navigates from a list page to a detail page (e.g., `/blog` → `/blog/my-post`), the collection data is already cached from the list page. The runtime extracts the matching item — no extra fetch needed.

But when a user **lands directly** on a detail page (e.g., bookmarked `/blog/my-post`), the collection isn't cached. By default, the runtime fetches the full collection just to extract one item. For large collections or expensive API calls, this is wasteful.

The `detail` field on a fetch config tells the runtime how to fetch just the single entity:

```yaml
# pages/blog/page.yml
title: Blog
fetch:
  url: https://api.example.com/articles
  schema: articles
  detail: rest
```

### Conventions

| Value | URL derived | Example for slug=`my-post` |
|-------|------------|---------------------------|
| `rest` | `{url}/{value}` | `https://api.example.com/articles/my-post` |
| `query` | `{url}?{param}={value}` | `https://api.example.com/articles?slug=my-post` |
| Custom pattern | Replace `{param}` placeholder | `https://api.example.com/article/{slug}` → `.../article/my-post` |

### Resolution order

1. Collection already cached? → extract item locally. No fetch needed.
2. `detail` defined? → fetch just the one entity.
3. No `detail`? → fetch the full collection, cache it, extract the item.

### What the component receives

From a detail query, the component receives only the singular key:

```js
content.data.article   // { slug: 'my-post', title: '...' }
content.data.articles  // undefined (no collection fetched)
```

From a cached collection (the normal SPA navigation case), both are available:

```js
content.data.article   // { slug: 'my-post', title: '...' }
content.data.articles  // [...all items...]
```

Components that already handle `if (!article) return ...` work in both cases.

### Examples

```yaml
# REST convention — GET /api/articles/{slug}
fetch:
  url: https://api.example.com/articles
  schema: articles
  detail: rest

# Query param — GET /api/articles?slug={slug}
fetch:
  url: https://api.example.com/articles
  schema: articles
  detail: query

# Custom URL pattern
fetch:
  url: https://api.example.com/articles
  schema: articles
  detail: https://api.example.com/article/{slug}
```

---

## Troubleshooting

### "No data found for dynamic page"

**Cause:** Parent page doesn't have a `fetch` config or the fetch returned empty data.

**Fix:** Ensure the parent `page.yml` has a valid fetch configuration:

```yaml
fetch:
  path: /data/articles.json
  schema: articles
```

### Items missing from output

**Cause:** Items don't have the required param field.

**Fix:** Ensure every item has the field matching your folder name:

```json
// For [slug] folder, every item needs "slug"
{ "slug": "my-post", "title": "..." }
```

### Component shows "not found" message

**Cause:** Component not receiving cascaded data.

**Fix:** Add `inheritData` to your component's `meta.js`:

```js
export default {
  title: 'Article',
  inheritData: ['article', 'articles'],
}
```

### Wrong data in component

**Cause:** Schema name mismatch between fetch and inheritData.

**Fix:** Ensure names match (accounting for singularization):

```yaml
# page.yml
fetch:
  schema: articles  # plural
```

```js
// meta.js
inheritData: ['article', 'articles']  // singular + plural
```

---

## See Also

- [Data Fetching](./data-fetching.md) — Load external data from files or APIs
- [Content Structure](./content-structure.md) — How content is parsed and structured
- [Component Metadata](./component-metadata.md) — Full meta.js schema reference
