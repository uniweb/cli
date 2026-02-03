# Layout Panels

Layout panels (header, footer, left, right) render on every page. They provide site-wide navigation, branding, and persistent UI elements.

## Overview

Layout panels live in the `layout/` directory, parallel to `pages/`:

```
site/
├── layout/
│   ├── header/               # Renders at top of every page
│   │   └── header.md
│   ├── footer/               # Renders at bottom of every page
│   │   └── footer.md
│   ├── left/                 # Left sidebar (if foundation supports)
│   │   └── sidebar.md
│   └── right/                # Right sidebar (if foundation supports)
│       └── sidebar.md
├── pages/
│   └── home/                 # Regular page
│       └── hero.md
```

Unlike regular pages, layout panels:
- Don't create navigable routes
- Render on all pages automatically
- Can be suppressed per-page via layout options

---

## Built-in Panels

### header

Renders at the top of every page, typically containing:
- Logo and site name
- Main navigation
- Search button
- Language switcher
- Dark mode toggle

```markdown
<!-- layout/header/header.md -->
---
type: Header
sticky: true
---

![Logo](/logo.svg){role=icon}

- [Home](/)
- [Products](/products)
- [About](/about)
- [Contact](/contact)
```

### footer

Renders at the bottom of every page, typically containing:
- Site links organized by category
- Legal links (privacy, terms)
- Social media links
- Copyright notice

```markdown
<!-- layout/footer/footer.md -->
---
type: Footer
---

## Company

- [About](/about)
- [Careers](/careers)
- [Contact](/contact)

## Legal

- [Privacy](/privacy)
- [Terms](/terms)

---

© 2025 Acme Corp. All rights reserved.
```

### left / right

Side panels for documentation sites, dashboards, or complex layouts:

```markdown
<!-- layout/left/sidebar.md -->
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
```
```

---

## How They Work

### Rendering Order

```
┌─────────────────────────────────────┐
│           header                    │
├──────────┬─────────────┬────────────┤
│          │             │            │
│  left    │   Page      │  right     │
│          │   Content   │            │
│          │             │            │
├──────────┴─────────────┴────────────┤
│           footer                    │
└─────────────────────────────────────┘
```

The foundation's Layout component controls where panels appear:

```jsx
// foundation/src/Layout.jsx
export default function Layout({ header, footer, left, right, body }) {
  return (
    <div className="layout">
      {header}
      <div className="main">
        {left && <aside className="left">{left}</aside>}
        <main>{body}</main>
        {right && <aside className="right">{right}</aside>}
      </div>
      {footer}
    </div>
  )
}
```

### Content Flow

1. Site build collects layout panels from `layout/`
2. Runtime loads them alongside the active page
3. Foundation Layout receives them as props
4. Each page's layout options control visibility

---

## Multiple Sections

Panel folders can contain multiple `.md` files:

```
layout/header/
├── 1-topbar.md       # Announcement bar
└── 2-navbar.md       # Main navigation
```

Both render in order, giving you flexibility for complex headers:

```jsx
// 1-topbar.md
---
type: TopBar
---
New feature released! [Learn more](/blog/new-feature)

// 2-navbar.md
---
type: Navbar
sticky: true
---
<!-- Main navigation -->
```

---

## Per-Page Layout Control

Pages can disable panels via `layout` in `page.yml`:

```yaml
# pages/landing/page.yml
title: Landing Page
layout:
  header: false    # No header on this page
  footer: false    # No footer on this page
```

This is useful for:
- Full-screen landing pages
- Print layouts
- Embedded content
- Admin interfaces

### Checking in Components

Foundation components can check layout settings:

```jsx
function Page({ block }) {
  const page = block.page

  return (
    <>
      {page.hasHeader() && <Header />}
      <main>{/* content */}</main>
      {page.hasFooter() && <Footer />}
    </>
  )
}
```

---

## Navigation Visibility

Layout panels often build navigation from the page hierarchy. Pages can opt out:

```yaml
# pages/admin/page.yml
title: Admin Dashboard
hidden: true           # Hide from all navigation
```

```yaml
# pages/legal/page.yml
title: Privacy Policy
hideInHeader: true     # Hide from header nav
hideInFooter: false    # Show in footer nav
```

See [Page Configuration](./page-configuration.md) for all visibility options.

---

## Component Patterns

### Header with Automatic Navigation

```jsx
// foundation/src/components/Header/index.jsx
import { useWebsite } from '@uniweb/kit'

export default function Header({ content }) {
  const { website } = useWebsite()

  // Manual nav from content (if provided)
  const manualNav = content.data?.nav

  // Automatic nav from page structure
  const autoNav = website.getPageHierarchy({ for: 'header' })

  const navItems = manualNav || autoNav.map(p => ({
    label: p.label || p.title,
    href: p.route,
    children: p.children?.map(c => ({
      label: c.label || c.title,
      href: c.route
    }))
  }))

  return (
    <header>
      <nav>
        {navItems.map(item => (
          <NavItem key={item.href} {...item} />
        ))}
      </nav>
    </header>
  )
}
```

### Footer with Locale Switcher

```jsx
// foundation/src/components/Footer/index.jsx
import { useWebsite, getLocaleLabel } from '@uniweb/kit'

export default function Footer({ content }) {
  const { website } = useWebsite()

  return (
    <footer>
      {/* Footer content */}

      {website.hasMultipleLocales() && (
        <div className="locale-switcher">
          {website.getLocales().map(locale => (
            <a
              key={locale.code}
              href={website.getLocaleUrl(locale.code)}
              className={locale.code === website.getActiveLocale() ? 'active' : ''}
            >
              {getLocaleLabel(locale)}
            </a>
          ))}
        </div>
      )}

      <p>{content.paragraphs[0]}</p>
    </footer>
  )
}
```

### Sidebar with Version Awareness

```jsx
// foundation/src/components/Sidebar/index.jsx
import { useVersion } from '@uniweb/kit'

export default function Sidebar({ content }) {
  const { isVersioned, currentVersion, isDeprecatedVersion } = useVersion()

  return (
    <aside>
      {isVersioned && (
        <div className="version-badge">
          {currentVersion?.label}
          {isDeprecatedVersion && <span className="deprecated">Legacy</span>}
        </div>
      )}

      <nav>
        {/* Sidebar navigation */}
      </nav>
    </aside>
  )
}
```

---

## Sticky Headers

For headers that stick to the top while scrolling:

```markdown
---
type: Header
sticky: true
---
```

The foundation component handles the sticky behavior:

```jsx
export default function Header({ content, params }) {
  const { sticky = false } = params

  return (
    <header className={sticky ? 'sticky top-0 z-50' : ''}>
      {/* header content */}
    </header>
  )
}
```

And define the param in meta.js:

```js
export default {
  title: 'Header',
  params: {
    sticky: {
      type: 'boolean',
      label: 'Sticky Header',
      default: false
    }
  }
}
```

---

## Best Practices

1. **Keep content minimal**: Layout panels render on every page—keep them lightweight

2. **Support both modes**: Allow both automatic (from page hierarchy) and manual (from content) navigation

3. **Respect layout flags**: Always check `page.hasHeader()` etc. in your Layout component

4. **Handle empty states**: Layout panels might not exist in all sites

5. **Consider mobile**: Layout panels often need responsive behavior (hamburger menus, collapsible sidebars)

6. **Version awareness**: In docs sites, show version context in headers/sidebars

---

## See Also

- [Page Configuration](./page-configuration.md) — Layout options (header, footer, leftPanel, rightPanel)
- [Navigation Patterns](./navigation-patterns.md) — Building menus and navigation
- [Foundation Configuration](./foundation-configuration.md) — Custom Layout component
- [Kit Reference](./kit-reference.md) — Hooks for accessing page/website data
