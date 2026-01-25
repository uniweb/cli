# Runtime API Reference

This guide covers the runtime objects and React hooks available to foundation components.

## Overview

The Uniweb runtime provides a layered API:

| Layer | Package | Purpose |
|-------|---------|---------|
| **Core** | `@uniweb/core` | Data classes (Website, Page, Block, Theme) |
| **Kit** | `@uniweb/kit` | React hooks and utilities |

Components typically use hooks from `@uniweb/kit`. The underlying classes from `@uniweb/core` are available for advanced use cases.

---

## React Hooks

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

Access routing information and navigation.

```jsx
import { useRouting } from '@uniweb/kit'

function NavLink({ href, children }) {
  const { route, navigate } = useRouting()
  const isActive = route === href || route.startsWith(href + '/')

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
| `route` | string | Current route path (e.g., `/about`) |
| `navigate` | function | Navigate to a route programmatically |
| `params` | object | Route parameters for dynamic routes |

### useLocale

Access translations and locale information.

```jsx
import { useLocale } from '@uniweb/kit'

function Footer() {
  const { t, locale, locales } = useLocale()

  return (
    <footer>
      <p>{t('footer.copyright')}</p>
      <p>Current language: {locale}</p>
    </footer>
  )
}
```

#### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `t(key)` | function | Get translation for a key |
| `locale` | string | Current locale code |
| `locales` | array | All available locale objects |
| `isDefaultLocale` | boolean | Is current locale the default? |

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

---

## Core Objects

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

  // Locales
  if (website.hasMultipleLocales()) {
    const locales = website.getLocales()
    const active = website.getActiveLocale()
    const url = website.getLocaleUrl('es')
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
  console.log(block.id)        // 'hero'
  console.log(block.component) // 'Hero'

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
| `component` | string | Component name |
| `page` | Page | Parent page |
| `website` | Website | Parent website |
| `childBlocks` | array | Nested blocks |
| `data` | object | Fetched/cascaded data |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `hasChildBlocks()` | boolean | Has nested sections? |
| `getChildBlockRenderer()` | component | Get ChildBlocks renderer |

---

## Component Props

Every foundation component receives these props:

```jsx
function MyComponent({ content, params, block, input }) {
  // content - Parsed markdown content
  const { title, paragraphs, links, imgs, items, data } = content

  // params - Frontmatter parameters (with defaults from meta.js)
  const { theme, layout } = params

  // block - Block instance for navigation
  const { page, website } = block

  // input - Form input data (optional)
  const { email, message } = input || {}
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

---

## Utility Functions

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
import { useWebsite, useRouting, useLocale } from '@uniweb/kit'

function MyComponent() {
  const { website } = useWebsite()
  const { route } = useRouting()
  const { t, locale } = useLocale()

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
- [Internationalization](./internationalization.md) — Locale hooks and API
- [Versioning](./versioning.md) — Version hooks and API
