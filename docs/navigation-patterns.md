# Navigation Patterns

This guide covers patterns for building navigation components—navbars, sidebars, menus, and other hierarchical link structures.

## Automatic Navigation

Foundation components have access to the complete page structure of the site. This means headers and footers can build their menus automatically from your page hierarchy—no content definition required.

### Using the Page Hierarchy

Use the `useWebsite` hook to access pages:

```jsx
import { useWebsite } from '@uniweb/kit'

function Header() {
  const { website } = useWebsite()
  const pages = website.getPageHierarchy({ for: 'header' })

  return (
    <nav>
      {pages.map((page) => (
        <a key={page.id} href={page.route}>
          {page.label || page.title}
        </a>
      ))}
    </nav>
  )
}
```

The `getPageHierarchy()` method returns pages with their nested children, respecting visibility settings. Each page object includes:

| Field      | Description                           |
| ---------- | ------------------------------------- |
| `id`       | Page identifier                       |
| `route`    | URL path                              |
| `title`    | Page title                            |
| `label`    | Short nav label (falls back to title) |
| `children` | Nested child pages                    |

### Page Visibility Control

Pages can opt out of automatic navigation via `page.yml`:

```yaml
# pages/admin/page.yml
title: Admin Dashboard
hideInHeader: true # Don't show in header navigation
hideInFooter: true # Don't show in footer navigation
```

| Option               | Effect                                                   |
| -------------------- | -------------------------------------------------------- |
| `hidden: true`       | Hide from all navigation (page still accessible via URL) |
| `hideInHeader: true` | Hide from header nav only                                |
| `hideInFooter: true` | Hide from footer nav only                                |

## Manual Navigation

Automatic navigation is convenient but limited. Define navigation manually when you need:

- **Icons** alongside menu items
- **Descriptions** or secondary text
- **External links** mixed with internal pages
- **Custom grouping** different from the page hierarchy
- **Mega menus** with rich content

### Two Approaches for Manual Navigation

| Approach              | Best For                      | Complexity |
| --------------------- | ----------------------------- | ---------- |
| **Markdown lists**    | Simple flat or nested links   | Low        |
| **Nav schema (YAML)** | Icons, descriptions, metadata | Medium     |

### Supporting Both Modes

A well-designed header or footer component supports both automatic and manual navigation:

```jsx
function Header({ content }) {
  const { website } = useWebsite()

  // Manual nav from content (if provided)
  const manualNav = content.data?.nav

  // Automatic nav from page structure (fallback)
  const autoNav = website.getPageHierarchy({ for: 'header' })

  const navItems =
    manualNav ||
    autoNav.map((p) => ({
      label: p.label || p.title,
      href: p.route,
      children: p.children?.map((c) => ({
        label: c.label || c.title,
        href: c.route,
      })),
    }))

  return <nav>{/* render navItems */}</nav>
}
```

This gives content authors flexibility—leave the header section empty for automatic nav, or provide a `nav` block for full control with icons and custom structure.

## Markdown Lists

For simple manual navigation, markdown bullet lists work well. Each list item with a link becomes a navigation entry.

### Flat Navigation

```markdown
---
type: Navbar
---

- [Home](/)
- [About](/about)
- [Contact](/contact)
```

Your component receives:

```js
{
  lists: [
    {
      style: 'bullet',
      items: [
        { links: [{ href: '/', label: 'Home' }] },
        { links: [{ href: '/about', label: 'About' }] },
        { links: [{ href: '/contact', label: 'Contact' }] },
      ],
    },
  ]
}
```

### Nested Navigation (Dropdowns)

Nested lists create hierarchical navigation—perfect for dropdown menus:

```markdown
- [Products](/products)
  - [Widgets](/products/widgets)
  - [Gadgets](/products/gadgets)
- [Company](/company)
  - [About](/company/about)
  - [Careers](/company/careers)
```

Each nested list becomes a `lists` array inside the parent item:

```js
{
  lists: [
    {
      style: 'bullet',
      items: [
        {
          links: [{ href: '/products', label: 'Products' }],
          lists: [
            {
              style: 'bullet',
              items: [
                { links: [{ href: '/products/widgets', label: 'Widgets' }] },
                { links: [{ href: '/products/gadgets', label: 'Gadgets' }] },
              ],
            },
          ],
        },
        // ...
      ],
    },
  ]
}
```

### Adding Descriptions

Text after a link becomes a paragraph—useful for mega menus:

```markdown
- [Widgets](/products/widgets)

  Our award-winning widget collection.

- [Gadgets](/products/gadgets)

  The latest in gadget technology.
```

```js
items: [
  {
    links: [{ href: '/products/widgets', label: 'Widgets' }],
    paragraphs: ['Our award-winning widget collection.'],
  },
  // ...
]
```

### Rendering Nested Lists

Here's a recursive component for nested navigation:

```jsx
function NavList({ list, depth = 0 }) {
  return (
    <ul className={depth === 0 ? 'nav-root' : 'nav-submenu'}>
      {list.items.map((item, i) => (
        <li key={i}>
          {item.links?.[0] && (
            <a href={item.links[0].href}>{item.links[0].label}</a>
          )}
          {item.paragraphs?.[0] && (
            <span className="description">{item.paragraphs[0]}</span>
          )}
          {item.lists?.map((nested, j) => (
            <NavList key={j} list={nested} depth={depth + 1} />
          ))}
        </li>
      ))}
    </ul>
  )
}
```

## Nav Schema (Tagged YAML)

For richer navigation with icons, targets, and metadata, use the `nav` schema via tagged YAML blocks:

````markdown
---
type: Header
---

```yaml:nav
- icon: /icons/home.svg
  label: Home
  href: /
- icon: /icons/docs.svg
  label: Documentation
  href: /docs
  children:
    - label: Getting Started
      href: /docs/getting-started
      text: Quick introduction
    - label: API Reference
      href: /docs/api
      text: Complete API docs
- icon: /icons/github.svg
  label: GitHub
  href: https://github.com/example
  target: _blank
```
````

### Nav Schema Fields

| Field      | Type    | Description                                 |
| ---------- | ------- | ------------------------------------------- |
| `label`    | string  | **Required.** Display text                  |
| `href`     | string  | Link destination                            |
| `icon`     | string  | Path to icon file (e.g., `/icons/home.svg`) |
| `text`     | string  | Secondary text (description, subtitle)      |
| `target`   | string  | Link target (`_self`, `_blank`)             |
| `children` | nav[]   | Nested navigation items (recursive)         |
| `order`    | number  | Custom sort order                           |
| `hidden`   | boolean | Hide from display                           |
| `current`  | boolean | Mark as current/active page                 |

### Accessing Nav Data

Tagged YAML appears in `content.data`:

```jsx
function Header({ content }) {
  const nav = content.data?.nav || []

  return (
    <nav>
      {nav.map((item, i) => (
        <NavItem key={i} item={item} />
      ))}
    </nav>
  )
}

function NavItem({ item }) {
  return (
    <div className={item.current ? 'active' : ''}>
      {item.icon && <img src={item.icon} alt="" className="w-5 h-5" />}
      <a href={item.href} target={item.target}>
        {item.label}
      </a>
      {item.text && <span className="text-sm text-gray-500">{item.text}</span>}
      {item.children?.length > 0 && (
        <div className="ml-4">
          {item.children.map((child, i) => (
            <NavItem key={i} item={child} />
          ))}
        </div>
      )}
    </div>
  )
}
```

### Multiple Nav Blocks

Use different tags for different navigation areas:

````markdown
```yaml:main-nav
- label: Home
  href: /
- label: Products
  href: /products
```

```yaml:footer-nav
- label: Privacy
  href: /privacy
- label: Terms
  href: /terms
```
````

Access them separately:

```js
const mainNav = content.data?.['main-nav'] || []
const footerNav = content.data?.['footer-nav'] || []
```

## Choosing Your Approach

| Scenario                         | Recommendation       |
| -------------------------------- | -------------------- |
| Simple site, few pages           | Automatic navigation |
| Need icons or descriptions       | Nav schema (YAML)    |
| Quick prototype                  | Markdown lists       |
| Deep nesting (3+ levels)         | Nav schema (YAML)    |
| Mix of internal + external links | Nav schema (YAML)    |
| Content authors prefer markdown  | Markdown lists       |

## Common Patterns

### Header with Dropdown Menu

````markdown
```yaml:nav
- label: Products
  children:
    - label: Widgets
      href: /products/widgets
      text: For small projects
    - label: Gadgets
      href: /products/gadgets
      text: For enterprises
- label: Pricing
  href: /pricing
- label: About
  href: /about
```
````

### Sidebar with Sections

````markdown
```yaml:nav
- label: Getting Started
  children:
    - label: Installation
      href: /docs/install
    - label: Quick Start
      href: /docs/quickstart
- label: Guides
  children:
    - label: Components
      href: /docs/components
    - label: Theming
      href: /docs/theming
```
````

### Social Links (Icon-Only)

````markdown
```yaml:social
- icon: /icons/twitter.svg
  label: Twitter
  href: https://twitter.com/example
  target: _blank
- icon: /icons/github.svg
  label: GitHub
  href: https://github.com/example
  target: _blank
```
````

The `label` provides accessibility (screen readers) while only the icon is displayed visually.

### Table of Contents

For auto-generated tables of contents from page headings, see the [Content Structure](./content-structure.md#document-order-rendering-with-sequence) guide on using the `sequence` array to extract headings.

## Active State Detection

Components often need to highlight the current page in navigation. Use `useActiveRoute` from `@uniweb/kit`:

```jsx
import { useActiveRoute, Link } from '@uniweb/kit'

function NavLink({ href, label }) {
  const { isActive, isActiveOrAncestor } = useActiveRoute()

  // Exact match for home, ancestor match for everything else
  const active = href === '/' ? isActive(href) : isActiveOrAncestor(href)

  return (
    <Link href={href} className={active ? 'text-blue-600 font-semibold' : 'text-gray-600'}>
      {label}
    </Link>
  )
}
```

Both `isActive` and `isActiveOrAncestor` accept page objects or route strings:

```jsx
isActive(page)                   // page object from getPageHierarchy()
isActive('/blog')                // route string — same logic
isActiveOrAncestor('/research')  // matches /research, /research/papers, etc.
```

This matters because headers often mix automatic pages (objects from `getPageHierarchy()`) with manual nav items (strings from `content.data`). With `useActiveRoute`, both work without branching:

```jsx
const renderNavItem = (item) => {
  const href = item.href || item.navigableRoute
  const label = item.label || item.title
  const active = href === '/'
    ? isActive(href)
    : isActiveOrAncestor(href)

  return <Link href={href} className={active ? 'active' : ''}>{label}</Link>
}
```

**Why `useActiveRoute` over manual comparison:** Three things you'd otherwise have to handle yourself:

1. **Route normalization and base path** — `isActiveOrAncestor` delegates to `Website.isRouteActiveOrAncestor()`, which normalizes slashes and handles subdirectory deployments (`base:` in `site.yml`). A raw `startsWith` comparison breaks when the site is deployed at `/docs/`.

2. **Reactive during navigation** — The hook reads from React Router's `useLocation()`, which updates synchronously when the user clicks a link. `website.activePage` is a property on a vanilla JS singleton — it's correct but doesn't trigger React re-renders on its own. If you read `website.activePage` during render, you may see the previous page until the next render cycle.

3. **Consistent API** — The same `isActive(pageOrString)` call works whether the nav item came from `getPageHierarchy()` (page objects) or from a `yaml:nav` block (plain strings with `href`). No branching on `item.route ? ... : ...` needed.

## See Also

- [Content Structure](./content-structure.md) — Full content parsing reference
- [Page Configuration](./page-configuration.md) — Navigation visibility options (hidden, hideInHeader, hideInFooter)
- [Linking](./linking.md) — The `page:` protocol for stable internal links
- [Component Metadata](./component-metadata.md) — Documenting nav expectations in meta.js
