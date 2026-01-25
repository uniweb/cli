# Navigation Patterns

This guide covers patterns for building navigation components—navbars, sidebars, menus, and other hierarchical link structures.

## Two Approaches

There are two ways to define navigation in Uniweb:

| Approach | Best For | Complexity |
|----------|----------|------------|
| **Markdown lists** | Simple flat or nested link lists | Low |
| **Nav schema (tagged YAML)** | Rich navigation with icons, descriptions, metadata | Medium |

Both approaches work. Choose based on how much structure your navigation needs.

## Automatic vs Manual Navigation

Foundation components have access to the complete page structure of the site. This means headers and footers can build their menus automatically—no content definition required.

### Automatic Navigation

Use the `useWebsite` hook to access the page hierarchy:

```jsx
import { useWebsite } from '@uniweb/kit'

function Header() {
  const { website } = useWebsite()
  const pages = website.getPageHierarchy({ for: 'header' })

  return (
    <nav>
      {pages.map(page => (
        <a key={page.id} href={page.route}>{page.label || page.title}</a>
      ))}
    </nav>
  )
}
```

The `getPageHierarchy()` method returns pages with their children, respecting visibility settings.

### Page Visibility Control

Pages can opt out of automatic navigation via `page.yml`:

```yaml
# pages/admin/page.yml
title: Admin Dashboard
hideInHeader: true   # Don't show in header navigation
hideInFooter: true   # Don't show in footer navigation
```

| Option | Effect |
|--------|--------|
| `hidden: true` | Hide from all navigation (page still accessible) |
| `hideInHeader: true` | Hide from header nav only |
| `hideInFooter: true` | Hide from footer nav only |

### When to Use Manual Navigation

Automatic navigation is convenient but limited. Use manual definitions when you need:

- **Icons** alongside menu items
- **Descriptions** or secondary text
- **External links** mixed with internal pages
- **Custom grouping** different from the page hierarchy
- **Mega menus** with rich content

A well-designed header or footer component supports both modes:

```jsx
function Header({ content }) {
  const { website } = useWebsite()

  // Manual nav from content (if provided)
  const manualNav = content.data?.nav

  // Automatic nav from page structure (fallback)
  const autoNav = website.getPageHierarchy({ for: 'header' })

  const navItems = manualNav || autoNav.map(p => ({
    label: p.label || p.title,
    href: p.route,
    children: p.children?.map(c => ({ label: c.label || c.title, href: c.route }))
  }))

  return <nav>{/* render navItems */}</nav>
}
```

This gives content authors flexibility—leave the header section empty for automatic nav, or provide a `nav` block for full control.

## Markdown Lists

For simple navigation, markdown bullet lists work well. Each list item with a link becomes a navigation entry.

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
  lists: [{
    style: "bullet",
    items: [
      { links: [{ href: "/", label: "Home" }] },
      { links: [{ href: "/about", label: "About" }] },
      { links: [{ href: "/contact", label: "Contact" }] }
    ]
  }]
}
```

### Nested Navigation (Dropdowns)

Nested lists create hierarchical navigation—perfect for dropdown menus:

```markdown
---
type: Navbar
---

- [Products](/products)
  - [Widgets](/products/widgets)
  - [Gadgets](/products/gadgets)
- [Company](/company)
  - [About](/company/about)
  - [Careers](/company/careers)
    - [Engineering](/company/careers/engineering)
    - [Design](/company/careers/design)
```

Each nested list becomes a `lists` array inside the parent item:

```js
{
  lists: [{
    style: "bullet",
    items: [
      {
        links: [{ href: "/products", label: "Products" }],
        lists: [{
          style: "bullet",
          items: [
            { links: [{ href: "/products/widgets", label: "Widgets" }] },
            { links: [{ href: "/products/gadgets", label: "Gadgets" }] }
          ]
        }]
      },
      // ... Company with nested items
    ]
  }]
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
    links: [{ href: "/products/widgets", label: "Widgets" }],
    paragraphs: ["Our award-winning widget collection."]
  },
  // ...
]
```

### Rendering Nested Lists

Here's a simple recursive component:

```jsx
function NavList({ list, depth = 0 }) {
  return (
    <ul className={depth === 0 ? "nav-root" : "nav-submenu"}>
      {list.items.map((item, i) => (
        <li key={i}>
          {item.links?.[0] && (
            <a href={item.links[0].href}>{item.links[0].label}</a>
          )}
          {item.paragraphs?.[0] && (
            <span className="description">{item.paragraphs[0]}</span>
          )}
          {item.lists?.map((sublist, j) => (
            <NavList key={j} list={sublist} depth={depth + 1} />
          ))}
        </li>
      ))}
    </ul>
  )
}

function Navbar({ content }) {
  return (
    <nav>
      {content.lists.map((list, i) => (
        <NavList key={i} list={list} />
      ))}
    </nav>
  )
}
```

## Nav Schema (Tagged YAML)

For richer navigation with icons, targets, visibility flags, and deep nesting, use the `nav` schema via tagged YAML blocks:

```markdown
---
type: Sidebar
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
      text: Complete API documentation
- icon: /icons/github.svg
  label: GitHub
  href: https://github.com/example
  target: _blank
```
```

### Nav Schema Fields

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | **Required.** Display text |
| `href` | string | Link destination |
| `icon` | string | Path to icon file (e.g., `/icons/home.svg`) |
| `text` | string | Secondary text (description, subtitle) |
| `target` | string | Link target (`_self`, `_blank`) |
| `children` | nav[] | Nested navigation items (recursive) |
| `order` | number | Custom sort order |
| `hidden` | boolean | Hide from display |
| `current` | boolean | Mark as current/active page |

### Accessing Nav Data

Tagged YAML appears in `content.data`:

```js
function Sidebar({ content }) {
  const nav = content.data?.nav || []

  return (
    <aside>
      {nav.map((item, i) => (
        <NavItem key={i} item={item} />
      ))}
    </aside>
  )
}

function NavItem({ item }) {
  return (
    <div className={item.current ? "active" : ""}>
      {item.icon && <img src={item.icon} alt="" />}
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

You can have multiple nav blocks with different tags:

```markdown
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
```

Access them separately:

```js
const mainNav = content.data?.['main-nav'] || []
const footerNav = content.data?.['footer-nav'] || []
```

## Choosing Between Approaches

### Use Markdown Lists When:

- Navigation is simple (flat or one level of nesting)
- You don't need icons or metadata
- Content authors prefer writing markdown
- Quick prototyping

### Use Nav Schema When:

- Navigation needs icons
- Items have descriptions or secondary text
- You need visibility control (`hidden`, `current`)
- Deep nesting (3+ levels)
- Multiple nav sections on one page
- Consistent structure matters for component reuse

## Common Patterns

### Header with Dropdown Menu

```markdown
---
type: Header
---

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
```

### Sidebar with Sections

```markdown
---
type: Sidebar
---

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
- label: API
  children:
    - label: Reference
      href: /docs/api
    - label: Examples
      href: /docs/examples
```
```

### Social Links (Icon-Only)

```markdown
---
type: Footer
---

```yaml:social
- icon: /icons/twitter.svg
  label: Twitter
  href: https://twitter.com/example
  target: _blank
- icon: /icons/github.svg
  label: GitHub
  href: https://github.com/example
  target: _blank
- icon: /icons/linkedin.svg
  label: LinkedIn
  href: https://linkedin.com/company/example
  target: _blank
```
```

The `label` provides accessibility (screen readers) while the icon is displayed visually.

### Table of Contents

For auto-generated tables of contents from page headings, see the [Content Structure](./content-structure.md#document-order-rendering-with-sequence) guide on using the `sequence` array to extract headings.

## Active State Detection

Components often need to highlight the current page in navigation. Use the routing hooks from `@uniweb/kit`:

```jsx
import { useRouting } from '@uniweb/kit'

function NavLink({ href, label }) {
  const { route } = useRouting()
  const isActive = route === href || route.startsWith(href + '/')

  return (
    <a
      href={href}
      className={isActive ? "text-blue-600 font-semibold" : "text-gray-600"}
    >
      {label}
    </a>
  )
}
```

For the nav schema, you can set `current: true` in the YAML, or compute it dynamically in the component.

## See Also

- [Content Structure](./content-structure.md) — Full content parsing reference
- [Linking](./linking.md) — The `page:` protocol for stable internal links
- [Component Metadata](./component-metadata.md) — Documenting nav expectations in meta.js
