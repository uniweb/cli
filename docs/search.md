# Site Search

Uniweb includes built-in full-text search powered by [Fuse.js](https://fusejs.io/). Search indexes are generated at build time and loaded on-demand for instant client-side search.

## Quick Start

Search works out of the box. If your foundation includes a search UI component (like the academic template's `SearchModal`), users can search your site immediately.

To explicitly enable and configure search, add to `site.yml`:

```yaml
search:
  enabled: true
```

## How It Works

1. **Build time**: Content is extracted from all pages and sections
2. **Index generation**: A `search-index.json` file is created in your build output
3. **Runtime**: The search client loads the index on first use and caches it
4. **Search**: Fuse.js performs fuzzy matching against the index

The index is typically small (tens of KB) and cached in localStorage, so subsequent searches are instant.

## Configuration

### Basic Configuration

```yaml
# site.yml
search:
  enabled: true
```

### Full Configuration

```yaml
search:
  enabled: true

  # What to include in the index
  include:
    pages: true        # Page titles and descriptions
    sections: true     # Section content
    headings: true     # Heading text
    paragraphs: true   # Paragraph text
    links: true        # Link labels
    lists: true        # List item text

  # What to exclude
  exclude:
    routes:            # Routes to skip (prefix match)
      - /admin
      - /draft
    components:        # Component types to skip
      - CodeBlock
      - RawHtml
```

All `include` options default to `true`. Exclusions default to empty arrays.

### Disabling Search

```yaml
search:
  enabled: false
```

Or simply omit the `search` configuration—search is enabled by default.

## Foundation Requirements

To use search, your foundation needs:

1. **Fuse.js dependency** in `foundation/package.json`:
   ```json
   {
     "dependencies": {
       "fuse.js": "^7.0.0"
     }
   }
   ```

2. **A search UI component** that uses the search client from `@uniweb/kit`

The academic template includes both of these ready to use.

## Building a Search UI

### Using the Search Client

```jsx
import { useWebsite } from '@uniweb/kit'
import { useEffect, useState } from 'react'

function SearchInput() {
  const { website } = useWebsite()
  const [client, setClient] = useState(null)
  const [results, setResults] = useState([])
  const [query, setQuery] = useState('')

  // Initialize search client
  useEffect(() => {
    if (!website.isSearchEnabled()) return

    async function init() {
      const { createSearchClient } = await import('@uniweb/kit/search')
      setClient(createSearchClient(website))
    }
    init()
  }, [website])

  // Perform search
  useEffect(() => {
    if (!client || !query.trim()) {
      setResults([])
      return
    }

    client.query(query, { limit: 10 }).then(setResults)
  }, [client, query])

  if (!website.isSearchEnabled()) {
    return null
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      <ul>
        {results.map(result => (
          <li key={result.id}>
            <a href={result.href}>{result.title}</a>
            {result.snippetHtml && (
              <p dangerouslySetInnerHTML={{ __html: result.snippetHtml }} />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

### Search Client API

```js
const { createSearchClient } = await import('@uniweb/kit/search')
const client = createSearchClient(website)

// Check if search is enabled
client.isEnabled()  // boolean

// Perform a search
const results = await client.query('authentication', {
  limit: 10,           // Max results (default: 10)
  type: 'section',     // Filter: 'page' or 'section'
  route: '/docs'       // Filter: route prefix
})

// Preload the index (warm the cache)
await client.preload()

// Clear the cache
client.clearCache()
```

### Search Result Shape

Each result includes:

```js
{
  // Identity
  id: 'section:/docs/auth:intro',
  type: 'section',              // 'page' or 'section'

  // Navigation
  route: '/docs/auth',
  sectionId: 'intro',
  anchor: 'SectionIntro',
  href: '/docs/auth#SectionIntro',  // Ready-to-use link

  // Display
  title: 'Authentication',
  pageTitle: 'Auth Guide',      // Parent page title (for sections)
  description: '...',
  excerpt: '...',
  component: 'Article',         // Component type (for sections)

  // Search-specific
  snippetText: '...matching text...',
  snippetHtml: '...with <mark>highlights</mark>...',
  matches: [...]                // Raw Fuse.js match data
}
```

## What Gets Indexed

### Pages

- Title (from `page.yml`)
- Description
- Keywords (from SEO config)

Pages are weighted higher in search results than sections.

### Sections

- Headings (first H1 becomes the section title)
- Paragraphs
- Link labels
- List items

### Excluded Content

The following are automatically excluded:

- Special routes (`/@header`, `/@footer`)
- Pages marked with `seo.noindex: true`
- Routes and components in `search.exclude`

## Keyboard Shortcuts

The academic template's `SearchModal` includes keyboard support:

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Open search |
| `↑` / `↓` | Navigate results |
| `Enter` | Go to selected result |
| `Escape` | Close search |

To add keyboard shortcuts to your own component:

```jsx
import { useSearchShortcut } from '../SearchModal'

function MyComponent() {
  const [searchOpen, setSearchOpen] = useState(false)

  // Register Cmd/Ctrl+K shortcut
  useSearchShortcut(() => setSearchOpen(true))

  return (
    // ...
  )
}
```

## Multi-Locale Support

For sites with multiple locales, separate search indexes are generated:

```
dist/
├── search-index.json      # Default locale
├── es/
│   └── search-index.json  # Spanish
└── fr/
    └── search-index.json  # French
```

The search client automatically uses the correct index based on the active locale.

## Performance

- **Index size**: Typically 20-50KB for small/medium sites
- **Caching**: Index is cached in memory and localStorage
- **Lazy loading**: Fuse.js is dynamically imported only when needed
- **Preloading**: Optional `client.preload()` for instant first search

For large sites (hundreds of pages), consider:
- Excluding verbose components (like full article bodies)
- Using route exclusions for low-value content

## Example: Academic Template

The academic template demonstrates search with:

- `SearchModal` component with full keyboard navigation
- `SearchButton` with keyboard shortcut hint
- Integration in the `Navbar` component
- Fuse.js as a foundation dependency
- Search enabled in `site.yml`

See `templates/academic/template/foundation/src/components/SearchModal/` for the complete implementation.

## Related

- [Site Configuration](./site-configuration.md) — Full site.yml reference
- [Content Structure](./content-structure.md) — How content is organized
