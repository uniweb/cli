# Working with Data

Your components need data — articles from a CMS, team members from JSON, products from an API. In a typical React app, you'd write a `useEffect`, manage loading states, handle errors, and figure out caching yourself. In Uniweb, you declare what data a page needs, and the runtime handles fetching, caching, and delivery. Your component receives the data in `content.data` — no hooks, no loading logic, no cache management.

This guide covers how data flows from a fetch config to your components, how auto-wiring saves you from repeating yourself, and how detail queries avoid fetching a full collection when you only need one item.

> This guide describes the **portable** approach to data — where the site declares data sources and the foundation reads from `content.data`. If your foundation is bundled or partially bundled, standard React data fetching (`useEffect` + `fetch()`) still works. See [Foundation Categories](./foundation-categories.md) for when each approach makes sense.

---

## The Basics: A Page That Fetches Data

A page declares what data it needs in `page.yml`:

```yaml
# pages/blog/page.yml
title: Blog
data: articles
```

That single line does three things:

1. References the `articles` collection (built from `library/articles/`)
2. Makes the data available as `content.data.articles` for every section on the page
3. Caches the result — navigating away and back doesn't re-fetch

Your component declares that it works with this data:

```js
// foundation/src/sections/ArticleList/meta.js
export default {
  title: 'Article List',
  data: {
    entity: 'articles',
  },
}
```

And reads it:

```jsx
// foundation/src/sections/ArticleList/ArticleList.jsx
export default function ArticleList({ content }) {
  const articles = content.data.articles

  if (!articles) return <DataPlaceholder />

  return (
    <ul>
      {articles.map(a => (
        <li key={a.slug}>{a.title}</li>
      ))}
    </ul>
  )
}
```

That's the full wiring. No `fetch()` call, no `useState`, no `useEffect`. The runtime reads the fetch config, executes the query, caches the result, and delivers it to every component that opted in.

---

## What `data.entity` Does for You

When you write `data: { entity: 'articles' }` in meta.js, the build derives `inheritData: ['articles']` automatically. This tells the runtime which data schemas your component accepts.

You don't write `inheritData` yourself — the entity declaration is enough. The build figures out the rest. If you need to accept additional schemas beyond the entity type, explicit `inheritData` overrides are available, but they're rarely needed.

The point of `entity` isn't just a label. It's a contract: "this component works with article data." The runtime uses that contract to resolve data automatically — especially on template pages, where the component doesn't know where the data comes from.

---

## Auto-Wiring: Template Pages Get Data for Free

Here's the canonical blog setup:

```
pages/
└── blog/
    ├── page.yml              # data: articles
    ├── list.md               # type: ArticleList
    └── [slug]/
        ├── page.yml          # (no data declaration)
        └── article.md        # type: Article
```

The `[slug]` page declares no data. It doesn't need to. The runtime resolves data automatically by checking its parent:

1. Does `[slug]` have its own fetch config? No.
2. Does its parent (`/blog`) have a fetch config? Yes — articles.
3. Is articles already cached (from visiting the list page)? Often yes — cache hit.
4. Extract the matching item by slug.

Your Article component receives both the collection and the current item:

```js
content.data.articles  // [...all articles...]
content.data.article   // { slug: 'my-post', title: '...' }
```

The plural key is the full collection. The singular key (`article`, automatically singularized from `articles`) is the item matching the current route parameter.

This is auto-wiring: the runtime walks a short, predictable path — page → parent → site — looking for a fetch config that matches what the component declared in `data.entity`. No deep hierarchy walking, no magic. Parent doesn't have it? Check the site config. Still nothing? The component gets no data, and `content.data.articles` is undefined.

---

## The Cache Makes Navigation Cheap

When a user visits `/blog`, the runtime fetches the articles collection and caches it. When they click through to `/blog/my-post`, the runtime finds the same articles query via auto-wiring, hits the cache, and extracts the matching item. No second fetch.

When they navigate back to `/blog` — cache hit again.

The cache is keyed by query identity (URL + schema + transform), not by page. Two pages that reference the same query share one cache entry. The cache lives for the SPA session — a full page reload clears it.

This is why the data layer distinguishes between queries and data. A query describes what to fetch and how. Data is the result of executing that query. Two pages can independently reference the same query, and the cache deduplicates the actual HTTP request. No data "flows" between pages — they just happen to ask the same question and get the same cached answer.

---

## Detail Queries: Fetch One Instead of All

Auto-wiring handles the common case well. But there's an edge case: what if the user lands directly on `/blog/my-post`? They bookmarked it, or followed a shared link. The cache is empty — nobody visited the list page first.

Without any hint, the runtime fetches the full collection to find one item. For a blog with 20 articles and a local JSON file, that's fine. For an API returning 500 products with full descriptions, it's wasteful.

The `detail` field tells the runtime how to fetch just the one entity:

```yaml
# pages/blog/page.yml
title: Blog
fetch:
  url: https://api.example.com/articles
  schema: articles
  detail: rest
```

The runtime follows a resolution order:

1. **Collection cached?** Extract the item locally. No fetch needed.
2. **`detail` defined?** Build a single-entity URL and fetch just that one.
3. **Neither?** Fetch the full collection, cache it, extract the item.

Step 1 covers normal SPA navigation (user came from the list page). Step 2 covers direct navigation (user landed on the detail page). Step 3 is the fallback — it always works, it's just not optimal for large collections from remote APIs.

### URL Conventions

The `detail` value tells the runtime how to construct the single-entity URL from the route parameter:

```yaml
# REST: appends the param value to the base URL
# GET /api/articles/my-post
detail: rest

# Query param: adds ?slug=my-post to the base URL
# GET /api/articles?slug=my-post
detail: query

# Custom pattern: replaces {slug} with the param value
# GET /api/article/my-post
detail: https://api.example.com/article/{slug}
```

The placeholder name (`{slug}`) comes from the dynamic route folder name (`[slug]`). If your folder is `[id]`, the placeholder is `{id}`.

### What the Component Sees

When data comes from a detail query, the component receives only the singular key:

```js
content.data.article   // { slug: 'my-post', title: '...' }
content.data.articles  // undefined — no collection was fetched
```

When data comes from a cached collection (the normal case), both are available:

```js
content.data.article   // { slug: 'my-post', title: '...' }
content.data.articles  // [...all items...]
```

Components that check `if (!article) return ...` work in both cases without changes. If you need the collection for a "related articles" section and it's not there (detail query path), that section renders its empty state — which is the right behavior, since the user didn't come from the list.

### When to Use It

`detail` is an optimization, not a requirement. It matters when:

- Your collection endpoint is expensive (slow API, large payload)
- Users frequently land directly on detail pages (shared links, search engines)
- The API supports single-entity fetches (most REST APIs do)

For local JSON files built from markdown collections, the full file is small and already on the same server. `detail` adds complexity without meaningful benefit in that case.

---

## The Fetch Config

Here's the full set of options available on a fetch config:

```yaml
fetch:
  path: /data/articles.json              # Local file (under public/)
  url: https://api.example.com/articles  # Remote URL (mutually exclusive with path)
  schema: articles                       # Key in content.data
  detail: rest                           # Single-entity optimization (rest | query | pattern)
  prerender: true                        # Build-time fetch (true) vs runtime-only (false)
  transform: data.items                  # Extract nested path from response
  limit: 6                               # Post-processing: take first N items
  sort: date desc                        # Post-processing: sort by field
  filter: tags contains featured         # Post-processing: filter items
```

The shorthands cover common cases:

```yaml
# Collection reference — fetches /data/articles.json, schema inferred
data: articles

# Local file path — schema inferred from filename
fetch: /data/team.json

# Collection with post-processing
fetch:
  collection: articles
  limit: 3
  sort: date desc
```

---

## Putting It Together: A Product Catalog

Here's a complete example with auto-wiring and a detail query — a product catalog backed by an external API.

**Site structure:**

```
pages/
└── products/
    ├── page.yml
    ├── grid.md               # type: ProductGrid
    └── [id]/
        ├── page.yml
        └── product.md        # type: ProductPage
```

**Parent page config:**

```yaml
# pages/products/page.yml
title: Products
fetch:
  url: https://api.example.com/products
  schema: products
  detail: rest
  transform: data.items
```

**Component metadata:**

```js
// foundation/src/sections/ProductGrid/meta.js
export default {
  title: 'Product Grid',
  data: { entity: 'products' },
}
```

```js
// foundation/src/sections/ProductPage/meta.js
export default {
  title: 'Product Page',
  data: { entity: 'products' },
}
```

**What happens at runtime:**

| Scenario | What the runtime does |
|----------|----------------------|
| User visits `/products` | Fetches full collection from API. Caches it. ProductGrid gets `content.data.products`. |
| User clicks a product | Navigates to `/products/42`. Cache hit — extracts item. ProductPage gets `content.data.product` and `content.data.products`. |
| User lands directly on `/products/42` | Cache empty. `detail: rest` → fetches `GET /api/products/42`. ProductPage gets `content.data.product` only. |
| User then visits `/products` | Fetches full collection (the detail cache doesn't satisfy the collection query). ProductGrid gets `content.data.products`. |

Both components use the same `data: { entity: 'products' }` declaration. The runtime resolves the right data for each context — collection on the list page, singular item on the detail page.

---

## See Also

- [Dynamic Routes](../../docs/dynamic-routes.md) — Folder naming, route expansion, singularization rules
- [Data Fetching](../../docs/data-fetching.md) — Full fetch config reference, post-processing options, collection references
- [Content Collections](../../docs/content-collections.md) — Building collections from markdown
- [Component Metadata](../../docs/component-metadata.md) — The `data` field in meta.js
