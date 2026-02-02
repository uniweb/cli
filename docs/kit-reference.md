# Kit & Core Reference

`@uniweb/kit` is the developer-facing API for Uniweb foundations. It provides React hooks for accessing site context, primitive components (Link, Image, Icon), and utility functions. When you need something from the framework, you import it from kit.

The data classes underneath — Website, Page, Block from `@uniweb/core` — are documented below for reference. You access them through hooks and the `block` prop, not by importing core directly.

---

## Hooks

### useWebsite

Access the current website instance.

```jsx
import { useWebsite } from '@uniweb/kit'

function Header() {
  const { website } = useWebsite()

  return (
    <header>
      <h1>{website.name}</h1>
      <nav>
        {website.getPageHierarchy({ for: 'header' }).map(page => (
          <a key={page.id} href={page.route}>{page.label}</a>
        ))}
      </nav>
    </header>
  )
}
```

#### Return Value

```js
const { website } = useWebsite()
```

| Property | Type | Description |
|----------|------|-------------|
| `website` | Website | The active website instance |

### useRouting

SSG-safe access to routing functionality. Returns hook functions that you call to get routing data.

```jsx
import { useRouting } from '@uniweb/kit'

function NavLink({ href, children }) {
  const { useLocation, useNavigate } = useRouting()
  const location = useLocation()
  const navigate = useNavigate()

  const isActive = location.pathname === href

  return (
    <a
      href={href}
      className={isActive ? 'active' : ''}
      onClick={(e) => {
        e.preventDefault()
        navigate(href)
      }}
    >
      {children}
    </a>
  )
}
```

#### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `useLocation()` | function | Returns location object `{ pathname, search, hash }` |
| `useParams()` | function | Returns route parameters for dynamic routes |
| `useNavigate()` | function | Returns navigate function for programmatic navigation |
| `Link` | component | Router Link component (or `'a'` fallback) |
| `isRoutingAvailable()` | function | Check if router context is available |

**SSG Safety**: During SSG/prerender, these return sensible defaults (empty pathname, empty params, no-op navigate) instead of throwing errors.

### useActiveRoute

Active route detection for navigation highlighting.

```jsx
import { useActiveRoute } from '@uniweb/kit'

function NavItem({ page }) {
  const { isActive, isActiveOrAncestor } = useActiveRoute()

  return (
    <a
      href={page.route}
      className={isActiveOrAncestor(page) ? 'active' : ''}
    >
      {page.label}
    </a>
  )
}
```

#### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `route` | string | Current normalized route (e.g., `'docs/getting-started'`) |
| `rootSegment` | string | First segment of route (e.g., `'docs'`) |
| `isActive(pageOrRoute)` | function | Check exact match with current route |
| `isActiveOrAncestor(pageOrRoute)` | function | Check if page or its children are active |

Both `isActive` and `isActiveOrAncestor` accept a **page object** or a **route string**:

```jsx
isActive(page)          // page object with .route property
isActive('/blog')       // route string — same comparison logic
isActiveOrAncestor('/research')  // matches /research, /research/papers, etc.
```

Use `isActiveOrAncestor` for parent nav items that should highlight when child pages are active.

**Why `useActiveRoute` instead of `website.activePage`:** The hook reads from React Router's location, which updates synchronously during navigation. `website.activePage` is a property on a vanilla JS singleton — it's always correct but isn't reactive in the React sense, so it won't trigger re-renders on its own. The hook also delegates route comparison to `Website.isRouteActive()`, which handles normalization and base path, and accepts both page objects and strings without branching.

### useVersion

Access version information for versioned documentation.

```jsx
import { useVersion } from '@uniweb/kit'

function VersionSwitcher() {
  const {
    isVersioned,
    currentVersion,
    versions,
    getVersionUrl,
    isDeprecatedVersion
  } = useVersion()

  if (!isVersioned) return null

  return (
    <select
      value={currentVersion?.id}
      onChange={(e) => window.location.href = getVersionUrl(e.target.value)}
    >
      {versions.map(v => (
        <option key={v.id} value={v.id}>
          {v.label}
          {v.deprecated && ' (deprecated)'}
        </option>
      ))}
    </select>
  )
}
```

#### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `isVersioned` | boolean | Is current page in a versioned scope? |
| `currentVersion` | object | `{ id, label, latest, deprecated }` |
| `versions` | array | All versions in current scope |
| `latestVersionId` | string | ID of the latest version |
| `versionScope` | string | Route where versioning starts |
| `isLatestVersion` | boolean | Is current the latest version? |
| `isDeprecatedVersion` | boolean | Is current version deprecated? |
| `getVersionUrl(id)` | function | Compute URL for a version |
| `hasVersionedContent` | boolean | Does site have any versioned content? |
| `versionedScopes` | object | Map of scope → `{ versions, latestId }` |

### useThemeData

Access theme configuration.

```jsx
import { useThemeData } from '@uniweb/kit'

function ColorPalette() {
  const theme = useThemeData()

  if (!theme) return null

  const palettes = theme.getPaletteNames()
  const primary500 = theme.getColor('primary', 500)

  return (
    <div style={{ color: primary500 }}>
      Available: {palettes.join(', ')}
    </div>
  )
}
```

See [Site Theming](./site-theming.md) for the full Theme API.

### useAppearance

Control light/dark mode.

```jsx
import { useAppearance } from '@uniweb/kit'

function DarkModeToggle() {
  const { scheme, toggle, canToggle } = useAppearance()

  if (!canToggle) return null

  return (
    <button onClick={toggle}>
      {scheme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  )
}
```

#### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `scheme` | string | Current scheme: `'light'` or `'dark'` |
| `toggle` | function | Switch between schemes |
| `canToggle` | boolean | Is toggling enabled? |
| `setScheme(s)` | function | Set a specific scheme |

### useThemeColor / useThemeColorVar

Convenience hooks for accessing theme colors.

```jsx
import { useThemeColor, useThemeColorVar } from '@uniweb/kit'

function Badge() {
  // Get actual color value
  const accentColor = useThemeColor('accent', 600)

  // Get CSS variable reference
  const primaryVar = useThemeColorVar('primary', 500)

  return (
    <span style={{ background: accentColor, borderColor: primaryVar }}>
      New
    </span>
  )
}
```

### useInView

Detect when an element enters the viewport. Useful for lazy loading and scroll animations.

```jsx
import { useInView } from '@uniweb/kit'

function LazyImage({ src, alt }) {
  const { ref, inView } = useInView({
    threshold: 0.1,
    triggerOnce: true
  })

  return (
    <div ref={ref}>
      {inView ? (
        <img src={src} alt={alt} />
      ) : (
        <div className="placeholder" />
      )}
    </div>
  )
}
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `threshold` | number | `0` | Visibility threshold (0-1) |
| `triggerOnce` | boolean | `false` | Only trigger once |
| `rootMargin` | string | `'0px'` | Margin around root |

### block.dataLoading

Check whether a block's runtime data fetch is in progress. This is a boolean property on the `block` instance, set by the runtime's `BlockRenderer`.

```jsx
import { DataPlaceholder } from '@uniweb/kit'

function ArticleList({ content, block }) {
  if (block.dataLoading) {
    return <DataPlaceholder lines={4} />
  }

  const articles = content.data.articles || []
  return <ArticleGrid articles={articles} />
}
```

| Value | Meaning |
|-------|---------|
| `true` | A runtime fetch is in progress |
| `false` / `undefined` | Data is available (or no fetch configured) |

This hook watches `block.dataLoading` and triggers a re-render when the fetch completes. See [Component Metadata](./component-metadata.md#loading-states) for details.

---

## Data Classes (from @uniweb/core)

You typically access these through `useWebsite()` or the `block` prop. Direct import from `@uniweb/core` is rarely needed.

### Website

The website instance provides access to site-wide data and navigation.

```jsx
function Header({ block }) {
  const website = block.website

  // Site identity
  console.log(website.name)         // 'My Site'
  console.log(website.description)  // 'Site description'

  // Pages
  const pages = website.getPageHierarchy({ for: 'header' })
  const allPages = website.pages

  // Locales (for language switcher UI)
  // Note: Content arrives already localized - no translation lookup needed
  if (website.hasMultipleLocales()) {
    const locales = website.getLocales()    // All locale objects
    const active = website.getActiveLocale() // Current locale code
    const url = website.getLocaleUrl('es')   // URL for switching
  }

  // Search
  if (website.isSearchEnabled()) {
    // Show search UI
  }
}
```

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getPageHierarchy(opts)` | array | Get pages for navigation |
| `getLocales()` | array | Get all locale objects |
| `getActiveLocale()` | string | Get current locale code |
| `getLocaleUrl(code)` | string | Get URL for a locale |
| `hasMultipleLocales()` | boolean | Check if multilingual |
| `isSearchEnabled()` | boolean | Check if search is enabled |
| `isVersionedRoute(route)` | boolean | Check if route is versioned |
| `getVersionScope(route)` | string | Get version scope for route |
| `getVersionUrl(version, route)` | string | Compute versioned URL |

#### getPageHierarchy Options

```js
website.getPageHierarchy({
  for: 'header',        // 'header' or 'footer' (respects hide flags)
  nested: true,         // Include children (default: true)
  includeHidden: false  // Include hidden pages (default: false)
})
```

Returns:
```js
[
  {
    id: 'about',
    route: '/about',
    title: 'About Us',
    label: 'About',
    description: 'Learn about us',
    order: 2,
    hasContent: true,
    children: [...]
  }
]
```

### Page

Access page metadata and layout configuration.

```jsx
function Layout({ block }) {
  const page = block.page

  // Identity
  console.log(page.route)       // '/about'
  console.log(page.title)       // 'About Us'
  console.log(page.description) // 'Learn about our company'

  // Layout flags
  if (page.hasHeader()) { /* render header */ }
  if (page.hasFooter()) { /* render footer */ }

  // Versioning
  if (page.isVersioned()) {
    const version = page.getVersion()
    const versions = page.getVersions()
  }
}
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `route` | string | Page route path |
| `title` | string | Page title |
| `description` | string | Page description |
| `label` | string | Short nav label |
| `id` | string | Stable page ID |
| `layout` | object | Layout flags |
| `sections` | array | Page sections (blocks) |
| `website` | Website | Parent website |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `hasHeader()` | boolean | Should render header? |
| `hasFooter()` | boolean | Should render footer? |
| `hasLeftPanel()` | boolean | Should render left panel? |
| `hasRightPanel()` | boolean | Should render right panel? |
| `isVersioned()` | boolean | Is page in versioned scope? |
| `getVersion()` | object | Current version info |
| `getVersions()` | array | All versions in scope |
| `getVersionUrl(id)` | string | URL for version switch |

### Block

The block represents a rendered section.

```jsx
function Hero({ content, params, block }) {
  // Navigation to related objects
  const page = block.page
  const website = block.website

  // Block identity
  console.log(block.id)   // 'hero'
  console.log(block.type) // 'Hero'

  // Child blocks (for composition)
  if (block.hasChildBlocks()) {
    const ChildBlocks = block.getChildBlockRenderer()
    return <ChildBlocks />
  }
}
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Section ID |
| `type` | string | Component name |
| `page` | Page | Parent page |
| `website` | Website | Parent website |
| `childBlocks` | array | Nested blocks |
| `data` | object | Fetched/cascaded data |
| `dataLoading` | boolean | Runtime data fetch in progress |
| `hasBackground` | boolean | Engine renders a background behind this section |
| `themeName` | string | Color context (`light`, `medium`, `dark`) |
| `state` | any | Persistent component state |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `hasChildBlocks()` | boolean | Has nested sections? |
| `getChildBlockRenderer()` | component | Get ChildBlocks renderer |

---

## Component Props

Every foundation component receives these props:

```jsx
function MyComponent({ content, params, block }) {
  // content - Parsed markdown content
  const { title, paragraphs, links, imgs, items, data } = content

  // params - Frontmatter parameters (with defaults from meta.js)
  const { theme, layout } = params

  // block - Block instance for navigation
  const { page, website } = block

  // data - Form tagged blocks or dynamic content source (optional)
  const { email, message } = data['schema-name'] || {}
}
```

### Content Shape

The runtime guarantees this structure (empty values if not in content):

```js
content = {
  // Headings
  title: '',
  pretitle: '',
  subtitle: '',
  subtitle2: '',

  // Body content
  paragraphs: [],
  links: [],
  lists: [],
  quotes: [],

  // Media
  imgs: [],
  icons: [],
  videos: [],

  // Structure
  items: [],         // Child content groups
  headings: [],      // Overflow headings

  // Data
  data: {},          // Tagged blocks + fetched data

  // Document order
  sequence: []       // All elements in order
}
```

### Params with Defaults

Param defaults from `meta.js` are automatically applied:

```js
// meta.js
export default {
  params: {
    theme: { type: 'select', options: ['light', 'dark'], default: 'light' },
    columns: { type: 'number', default: 3 }
  }
}

// Component receives merged params
function Grid({ params }) {
  const { theme, columns } = params
  // theme = 'light' if not specified in frontmatter
  // columns = 3 if not specified
}
```

### DataPlaceholder

A ready-made loading placeholder for sections waiting on runtime data. Renders animated pulse bars.

```jsx
import { DataPlaceholder } from '@uniweb/kit'

function EventGrid({ content, block }) {
  if (block.dataLoading) {
    return <DataPlaceholder lines={5} />
  }

  return <div>{/* render events */}</div>
}
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `lines` | number | `3` | Number of placeholder bars to render |
| `className` | string | `''` | Additional CSS classes |

Uses `animate-pulse` and the `--border` CSS variable for styling. Includes `role="status"` and `aria-label="Loading"` for accessibility.

---

## Utilities

### getLocaleLabel

Get display name for a locale.

```jsx
import { getLocaleLabel, LOCALE_DISPLAY_NAMES } from '@uniweb/kit'

// From locale object with label
getLocaleLabel({ code: 'es', label: 'Spanish' })  // 'Spanish'

// From locale object without label
getLocaleLabel({ code: 'es' })  // 'Español' (from built-in names)

// From string
getLocaleLabel('es')  // 'Español'

// Unknown code
getLocaleLabel({ code: 'xx' })  // 'XX'

// Access built-in names directly
console.log(LOCALE_DISPLAY_NAMES.fr)  // 'Français'
```

### Icon Component

Renders icons from multiple sources: library icons, URLs, direct SVG, or built-in icons.

```jsx
import { Icon } from '@uniweb/kit'

// String ref (recommended for library icons)
<Icon icon="lu-house" />         // dash format
<Icon icon="lu:house" />         // colon format
<Icon icon="lucide:house" />     // full library name

// Explicit library + name
<Icon library="lucide" name="house" />

// From URL
<Icon url="/icons/custom.svg" />

// Direct SVG content
<Icon svg="<svg>...</svg>" />

// Built-in icons (no library needed)
<Icon name="check" />
<Icon name="close" />
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | string/object | — | String ref (`"lu-house"`), URL, or `{ library, name }` object |
| `library` | string | — | Icon library shortcode (`lu`, `hi`, `fi`, etc.) |
| `name` | string | — | Icon name within the library |
| `url` | string | — | URL to fetch SVG from |
| `svg` | string | — | Direct SVG content |
| `size` | string | `'24'` | Icon size in pixels |
| `color` | string | — | Icon color (defaults to `currentColor`) |
| `preserveColors` | boolean | `false` | Keep original SVG colors instead of using `currentColor` |
| `className` | string | — | Additional CSS classes |

The string `icon` prop is the most concise way to use library icons. The same string formats work in markdown (`![](lu-house)`), in YAML data (`icon: lu:house`), and in JSX (`<Icon icon="lu-house" />`).

### parseIconRef

Parse an icon string reference into its library and name parts.

```jsx
import { parseIconRef } from '@uniweb/kit'

parseIconRef('lu-house')       // { library: 'lu', name: 'house' }
parseIconRef('lu:house')       // { library: 'lu', name: 'house' }
parseIconRef('lucide:house')   // { library: 'lucide', name: 'house' }
parseIconRef('not-an-icon')    // null (prefix not a known library)
```

Useful when you receive icon strings from structured data (`content.data`) and need to pass them to components that expect separate library/name props.

### Link Component

Client-side navigation with `page:` protocol support.

```jsx
import { Link } from '@uniweb/kit'

function Navigation() {
  return (
    <nav>
      <Link to="page:home">Home</Link>
      <Link to="page:about#team">Our Team</Link>
      <Link to="/external" target="_blank">External</Link>
    </nav>
  )
}
```

---

## Access Patterns

### From Hooks (Recommended)

```jsx
import { useWebsite, useRouting } from '@uniweb/kit'

function MyComponent() {
  const { website } = useWebsite()
  const { route } = useRouting()

  // Access locale via website
  const locale = website.getActiveLocale()

  // Use hooks throughout the component
}
```

### From Block Props

```jsx
function MyComponent({ block }) {
  const website = block.website
  const page = block.page

  // Access via block reference
}
```

### When to Use Which

| Scenario | Use |
|----------|-----|
| General component logic | Hooks |
| Accessing page/website from nested components | Hooks |
| Simple property access in main component | Block props |
| Non-React code (utilities) | Block props |

---

## See Also

- [Component Metadata](./component-metadata.md) — Defining component interfaces
- [Content Structure](./content-structure.md) — Content shape and guarantees
- [Site Theming](./site-theming.md) — Theme API and hooks
- [Internationalization](./internationalization.md) — Locale switching and build-time translation
- [Versioning](./versioning.md) — Version hooks and API
