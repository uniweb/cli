# Foundation Configuration

The `foundation.js` file defines customizable CSS variables and optional custom layouts for your foundation.

## Overview

Foundations can expose configuration points that sites customize in their `theme.yml`:

```
foundation/
├── src/
│   ├── foundation.js      # Variables and optional Layout
│   ├── components/        # Your components
│   └── styles.css         # Global styles
├── package.json
└── vite.config.js
```

---

## CSS Variables (vars)

Define CSS custom properties that sites can override.

### Defining Variables

```js
// foundation/src/foundation.js

/**
 * CSS custom properties that sites can override in theme.yml
 */
export const vars = {
  'header-height': {
    default: '4rem',
    description: 'Fixed header height',
  },
  'max-content-width': {
    default: '80rem',
    description: 'Maximum content width',
  },
  'section-padding-y': {
    default: '5rem',
    description: 'Vertical padding for sections',
  },
  'border-radius': {
    default: '0.5rem',
    description: 'Default border radius for cards and buttons',
  },
}
```

### Variable Schema

Each variable is an object with:

| Field | Type | Description |
|-------|------|-------------|
| `default` | string | Default CSS value |
| `description` | string | What the variable controls |

### Using Variables in Components

Reference variables in your CSS:

```css
/* foundation/src/styles.css */
.header {
  height: var(--header-height);
  position: sticky;
  top: 0;
}

.container {
  max-width: var(--max-content-width);
  margin: 0 auto;
  padding: 0 1.5rem;
}

section {
  padding: var(--section-padding-y) 0;
}

.card {
  border-radius: var(--border-radius);
}
```

Or in component JSX with Tailwind arbitrary values:

```jsx
function Header() {
  return (
    <header className="h-[var(--header-height)] sticky top-0">
      {/* content */}
    </header>
  )
}
```

### Site Overrides

Sites override variables in `theme.yml`:

```yaml
# site/theme.yml
vars:
  header-height: 5rem
  max-content-width: 72rem
  section-padding-y: 6rem
```

The build merges site overrides with foundation defaults, generating CSS:

```css
:root {
  --header-height: 5rem;        /* overridden */
  --max-content-width: 72rem;   /* overridden */
  --section-padding-y: 6rem;    /* overridden */
  --border-radius: 0.5rem;      /* default */
}
```

---

## Custom Layout

Foundations can provide a custom Layout component that controls page structure.

### Default Behavior

Without a custom Layout, the runtime uses a simple wrapper:

```jsx
// Default layout
function Layout({ children }) {
  return <>{children}</>
}
```

### Custom Layout

Export a Layout component from `foundation.js`:

```js
// foundation/src/foundation.js
export { default as Layout } from './Layout.jsx'

export const vars = {
  // ...
}
```

```jsx
// foundation/src/Layout.jsx
export default function Layout({ header, footer, left, right, children }) {
  return (
    <div className="min-h-screen flex flex-col">
      {header}

      <div className="flex-1 flex">
        {left && (
          <aside className="w-64 border-r">
            {left}
          </aside>
        )}

        <main className="flex-1">
          {children}
        </main>

        {right && (
          <aside className="w-64 border-l">
            {right}
          </aside>
        )}
      </div>

      {footer}
    </div>
  )
}
```

### Layout Props

| Prop | Type | Description |
|------|------|-------------|
| `header` | ReactNode | Rendered `@header` sections (or null) |
| `footer` | ReactNode | Rendered `@footer` sections (or null) |
| `left` | ReactNode | Rendered `@left` sections (or null) |
| `right` | ReactNode | Rendered `@right` sections (or null) |
| `children` | ReactNode | Page content sections |
| `page` | Page | Current page instance |
| `website` | Website | Website instance |

### Respecting Page Layout Options

Check page layout flags before rendering special sections:

```jsx
export default function Layout({ header, footer, left, right, children, page }) {
  return (
    <div className="min-h-screen flex flex-col">
      {page.hasHeader() && header}

      <div className="flex-1 flex">
        {page.hasLeftPanel() && left && (
          <aside className="w-64">{left}</aside>
        )}

        <main className="flex-1">{children}</main>

        {page.hasRightPanel() && right && (
          <aside className="w-64">{right}</aside>
        )}
      </div>

      {page.hasFooter() && footer}
    </div>
  )
}
```

### Responsive Layout

Handle mobile layouts:

```jsx
import { useState } from 'react'

export default function Layout({ header, footer, left, children, page }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen">
      {page.hasHeader() && (
        <div className="sticky top-0 z-50">
          {header}
          {left && (
            <button
              className="md:hidden p-2"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              ☰
            </button>
          )}
        </div>
      )}

      <div className="flex">
        {page.hasLeftPanel() && left && (
          <aside className={`
            fixed md:sticky top-[var(--header-height)] h-screen w-64
            transform transition-transform
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}>
            {left}
          </aside>
        )}

        <main className="flex-1 p-4">
          {children}
        </main>
      </div>

      {page.hasFooter() && footer}
    </div>
  )
}
```

---

## Common Variable Patterns

### Spacing System

```js
export const vars = {
  'spacing-xs': { default: '0.25rem', description: 'Extra small spacing' },
  'spacing-sm': { default: '0.5rem', description: 'Small spacing' },
  'spacing-md': { default: '1rem', description: 'Medium spacing' },
  'spacing-lg': { default: '2rem', description: 'Large spacing' },
  'spacing-xl': { default: '4rem', description: 'Extra large spacing' },
}
```

### Layout Dimensions

```js
export const vars = {
  'header-height': { default: '4rem', description: 'Header height' },
  'sidebar-width': { default: '16rem', description: 'Sidebar width' },
  'max-content-width': { default: '80rem', description: 'Max content width' },
  'max-prose-width': { default: '65ch', description: 'Max width for text' },
}
```

### Visual Style

```js
export const vars = {
  'border-radius-sm': { default: '0.25rem', description: 'Small radius' },
  'border-radius': { default: '0.5rem', description: 'Default radius' },
  'border-radius-lg': { default: '1rem', description: 'Large radius' },
  'shadow-sm': { default: '0 1px 2px rgba(0,0,0,0.05)', description: 'Small shadow' },
  'shadow': { default: '0 4px 6px rgba(0,0,0,0.1)', description: 'Default shadow' },
}
```

### Animation

```js
export const vars = {
  'transition-fast': { default: '150ms', description: 'Fast transitions' },
  'transition-normal': { default: '300ms', description: 'Normal transitions' },
  'transition-slow': { default: '500ms', description: 'Slow transitions' },
}
```

---

## Complete Example

```js
// foundation/src/foundation.js

/**
 * CSS custom properties that sites can override in theme.yml
 */
export const vars = {
  // Layout
  'header-height': {
    default: '4rem',
    description: 'Fixed header height',
  },
  'sidebar-width': {
    default: '16rem',
    description: 'Sidebar width for documentation layouts',
  },
  'max-content-width': {
    default: '80rem',
    description: 'Maximum width for page content',
  },

  // Spacing
  'section-padding-y': {
    default: '5rem',
    description: 'Vertical padding for sections',
  },
  'container-padding-x': {
    default: '1.5rem',
    description: 'Horizontal padding for containers',
  },

  // Visual
  'border-radius': {
    default: '0.5rem',
    description: 'Default border radius',
  },
  'card-shadow': {
    default: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    description: 'Card shadow',
  },
}

/**
 * Custom layout component
 */
export { default as Layout } from './Layout.jsx'
```

```jsx
// foundation/src/Layout.jsx
export default function Layout({ header, footer, left, right, children, page }) {
  const hasLeft = page.hasLeftPanel() && left
  const hasRight = page.hasRightPanel() && right

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      {page.hasHeader() && (
        <div className="sticky top-0 z-50 h-[var(--header-height)]">
          {header}
        </div>
      )}

      <div className="flex-1 flex max-w-[var(--max-content-width)] mx-auto w-full">
        {hasLeft && (
          <aside className="w-[var(--sidebar-width)] shrink-0 border-r hidden lg:block">
            <div className="sticky top-[var(--header-height)] overflow-y-auto max-h-[calc(100vh-var(--header-height))]">
              {left}
            </div>
          </aside>
        )}

        <main className="flex-1 min-w-0">
          {children}
        </main>

        {hasRight && (
          <aside className="w-[var(--sidebar-width)] shrink-0 border-l hidden xl:block">
            <div className="sticky top-[var(--header-height)] overflow-y-auto max-h-[calc(100vh-var(--header-height))]">
              {right}
            </div>
          </aside>
        )}
      </div>

      {page.hasFooter() && footer}
    </div>
  )
}
```

---

## Runtime Access

Access foundation variables from components:

```jsx
import { useThemeData } from '@uniweb/kit'

function Component() {
  const theme = useThemeData()

  // Get a foundation variable value
  const headerHeight = theme?.getFoundationVar('header-height')

  return <div style={{ marginTop: headerHeight }}>...</div>
}
```

---

## Best Practices

1. **Use semantic names**: `header-height` not `h1` or `size-16`

2. **Provide good defaults**: Defaults should work out of the box

3. **Document everything**: The `description` field helps site authors

4. **Group related vars**: Keep spacing, layout, and visual vars organized

5. **Consider dark mode**: Vars referencing colors should use theme tokens

6. **Keep Layout simple**: Complex logic belongs in components, not Layout

7. **Test overrides**: Verify vars work when sites customize them

---

## See Also

- [Site Theming](./site-theming.md) — Site-level theme customization
- [Special Sections](./special-sections.md) — @header, @footer, @left, @right
- [Component Metadata](./component-metadata.md) — Component meta.js schema
- [Runtime API](./runtime-api.md) — Accessing theme data in components
