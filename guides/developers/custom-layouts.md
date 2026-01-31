# Custom Layouts

The Layout component is the frame around your content. It controls where the header sits, whether there's a sidebar, how the footer is placed, and how all of that adapts on mobile. Every page on every site renders through a Layout — the only question is whether you use the runtime's default or provide your own.

Most foundations don't need a custom Layout. The default renders header, body, and footer in sequence with semantic HTML wrappers, and that covers marketing sites, landing pages, and blogs. You need a custom Layout when the *arrangement* of areas matters — sidebars, sticky headers, mobile drawers, content that's narrower when there's no right panel.

The docs template ships with a custom Layout that handles all of these. We'll use it as the worked example throughout this guide.

---

## What the Runtime Gives You

When the runtime renders a page, it pre-renders each layout area into React elements and passes them to your Layout as props:

```jsx
// packages/runtime/src/components/Layout.jsx (simplified)
function DefaultLayout({ header, body, footer }) {
  return (
    <>
      {header && <header>{header}</header>}
      {body && <main>{body}</main>}
      {footer && <footer>{footer}</footer>}
    </>
  )
}
```

| Prop | Source | What it contains |
|------|--------|-----------------|
| `header` | `@header` folder | Pre-rendered React elements (or null) |
| `body` | Page content files | Pre-rendered React elements (or null) |
| `footer` | `@footer` folder | Pre-rendered React elements (or null) |
| `left` | `@left` folder | Pre-rendered React elements (or null) |
| `right` | `@right` folder | Pre-rendered React elements (or null) |
| `page` | Runtime | Current Page instance |
| `website` | Runtime | Website instance |

The key insight: by the time your Layout receives these props, the sections are already rendered. Your Layout doesn't render content — it *arranges* content. The `header` prop isn't a list of blocks you need to loop through; it's a finished React element tree you place where you want it.

---

## Layout Areas Are Like Pages

Each `@` folder can contain multiple sections, just like a regular page folder:

```
site/pages/
├── @header/
│   ├── page.yml
│   ├── 1-topbar.md        ← Announcement bar
│   └── 2-navbar.md         ← Main navigation
├── @footer/
│   ├── page.yml
│   ├── 1-footer.md         ← Footer links
│   └── 2-copyright.md      ← Copyright bar
├── @left/
│   ├── page.yml
│   └── sidebar-nav.md      ← Sidebar navigation
└── home/
    ├── page.yml
    └── hero.md
```

The runtime renders all sections in `@header` into a single React element and passes that as the `header` prop. Your Layout wraps that element in a `<header>` tag — that's where the semantic HTML comes from. Section components themselves render `<div>`s. They don't know whether they'll end up in a header, sidebar, or main content area.

```
┌─────────────────────────────────────┐
│           @header                   │
├──────────┬─────────────┬────────────┤
│          │             │            │
│  @left   │   Page      │  @right    │
│          │   Content   │            │
│          │             │            │
├──────────┴─────────────┴────────────┤
│           @footer                   │
└─────────────────────────────────────┘
```

---

## When You Need a Custom Layout

| Use case | Custom Layout? | Why |
|----------|---------------|-----|
| Marketing site (header, sections, footer) | No | Default handles this |
| Blog with sidebar | Maybe | Only if sidebar needs sticky positioning or responsive behavior |
| Documentation with navigation sidebar | Yes | Sticky sidebar, mobile drawer, conditional widths |
| Dashboard with persistent left panel | Yes | Panel positioning, responsive collapse |
| Site where footer is inside the content area | Yes | Default puts footer after main, not inside it |
| Different header height per page | No | Use CSS variables and page-specific classes |

The general rule: if header → body → footer in a single column is enough, you don't need one. If you need areas side-by-side, sticky, or conditionally visible based on viewport — you do.

---

## Building a Custom Layout

### The Minimum

A custom Layout that's equivalent to the default, but gives you a starting point to customize:

```jsx
// foundation/src/components/Layout.jsx
export default function Layout({ header, body, footer, left, right, page }) {
  return (
    <div className="min-h-screen flex flex-col">
      {page.hasHeader() && header && (
        <header>{header}</header>
      )}

      <main className="flex-1">
        {body}
      </main>

      {page.hasFooter() && footer && (
        <footer>{footer}</footer>
      )}
    </div>
  )
}
```

This is already more than the default — it checks page layout flags and uses a flex column for full-height pages. From here, you add what your design needs.

### Exporting from foundation.js

The runtime picks up your Layout from the foundation's default export:

```js
// foundation/src/foundation.js
import Layout from './components/Layout'

export const vars = {
  'header-height': { default: '4rem', description: 'Fixed header height' },
  'sidebar-width': { default: '280px', description: 'Left sidebar width' },
}

export default {
  Layout,
  props: {},
}
```

That's it. The runtime checks for a foundation-provided Layout and uses it instead of the default. If you remove the export, the default takes over again.

### Respecting Page Layout Options

Pages can opt out of layout areas via `page.yml`:

```yaml
# site/pages/landing/page.yml
title: Landing Page
layout:
  header: false
  footer: false
```

Your Layout should check these flags:

```jsx
export default function Layout({ header, body, footer, left, right, page }) {
  const hasLeft = page.hasLeftPanel() && left
  const hasRight = page.hasRightPanel() && right

  return (
    <div className="min-h-screen flex flex-col">
      {page.hasHeader() && header && <header>{header}</header>}

      <div className="flex-1 flex">
        {hasLeft && <aside>{left}</aside>}
        <main className="flex-1">{body}</main>
        {hasRight && <aside>{right}</aside>}
      </div>

      {page.hasFooter() && footer && <footer>{footer}</footer>}
    </div>
  )
}
```

The `page.hasHeader()` / `page.hasFooter()` / `page.hasLeftPanel()` / `page.hasRightPanel()` methods return whether the page wants that area. Checking both the flag and the prop (`page.hasHeader() && header`) means you handle the case where the page wants a header but the site hasn't defined `@header` content.

---

## A Real Layout: Documentation Sidebar

The docs template Layout handles sticky header, responsive sidebars, a mobile drawer, and conditional content width. Here's how it's built.

> Source: `packages/templates/templates/docs/template/foundation/src/components/Layout/index.jsx`

### The Structure

```jsx
export default function Layout({
  page, website, header, body, footer,
  left, right, leftPanel, rightPanel,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Backwards compatibility: accept both prop names
  const leftContent = left || leftPanel
  const rightContent = right || rightPanel

  // Close sidebar on page navigation
  const activeRoute = page?.route
  useEffect(() => {
    setSidebarOpen(false)
  }, [activeRoute])

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 w-full border-b border-gray-200
        bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        {header}
      </header>

      {/* Mobile Sidebar (see next section) */}
      {leftContent && (
        <MobileSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
          {leftContent}
        </MobileSidebar>
      )}

      {/* Main Content Area */}
      <div className="flex-1 w-full max-w-7xl mx-auto">
        <div className="flex">
          {/* Left Sidebar - Desktop */}
          {leftContent && (
            <aside className="hidden md:block sticky top-16 w-64
              flex-shrink-0 h-[calc(100vh-4rem)] overflow-y-auto border-r">
              {leftContent}
            </aside>
          )}

          {/* Center Content */}
          <main className="flex-1 min-w-0">
            <div className={cn(
              'px-4 py-8 sm:px-6 lg:px-8',
              !rightContent && 'max-w-3xl mx-auto'
            )}>
              <div className="prose prose-slate max-w-none">
                {body}
              </div>

              {/* Footer inside main (design choice — see below) */}
              {footer && (
                <footer className="mt-12 pt-8 border-t">
                  {footer}
                </footer>
              )}
            </div>
          </main>

          {/* Right Sidebar - Desktop */}
          {rightContent && (
            <aside className="hidden xl:block sticky top-16 w-64
              flex-shrink-0 h-[calc(100vh-4rem)] overflow-y-auto border-l">
              {rightContent}
            </aside>
          )}
        </div>
      </div>

      {/* Mobile Menu Button */}
      {leftContent && (
        <MenuButton onClick={() => setSidebarOpen(true)} />
      )}
    </div>
  )
}
```

A few things to notice:

- The header is sticky with `backdrop-blur` for a translucent effect
- Sidebars use `sticky top-16` — they stick below the header (4rem = 16 in Tailwind's spacing)
- `min-w-0` on main prevents flex children from overflowing
- The whole thing is wrapped in `flex flex-col` with `min-h-screen` so the page always fills the viewport

### Mobile Sidebar Drawer

The mobile sidebar is a separate component with a backdrop, slide animation, and scroll lock:

```jsx
function MobileSidebar({ isOpen, onClose, children }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={onClose} />
      )}
      {/* Drawer */}
      <div className={cn(
        'md:hidden fixed top-16 left-0 w-72 h-[calc(100vh-4rem)] bg-white z-50',
        'transform transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-md"
          aria-label="Close sidebar">
          {/* close icon SVG */}
        </button>
        <div className="h-full overflow-y-auto">{children}</div>
      </div>
    </>
  )
}
```

The drawer is positioned at `top-16` so it sits below the header. It renders the same `leftContent` that the desktop sidebar gets — same React element, two placements. On `md:` and wider, the drawer is hidden and the static sidebar takes over.

### Footer Inside Main

In the docs template, the footer sits *inside* the main content area, below the body. This is a deliberate design choice — documentation footers typically show prev/next navigation, which belongs with the content rather than spanning the full page width.

A marketing site would do the opposite: place the footer outside and below the flex container so it spans the full width. There's no right answer — the Layout lets you make this choice.

### Conditional Width

When there's no right sidebar, the content area constrains itself:

```jsx
<div className={cn(
  'px-4 py-8 sm:px-6 lg:px-8',
  !rightContent && 'max-w-3xl mx-auto'
)}>
```

Without this, documentation text would stretch to fill the space where the right sidebar would be. Constraining to `max-w-3xl` keeps prose readable. When the right sidebar is present, the content naturally fills the remaining space between the two sidebars.

---

## Semantic HTML

The Layout is responsible for wrapping areas in semantic HTML elements. This is a convention, not a technical requirement — but it matters for accessibility and SEO.

| Area | Semantic wrapper | Why |
|------|-----------------|-----|
| Header sections | `<header>` | Landmark for screen readers, contains site navigation |
| Body sections | `<main>` | The primary content of the page |
| Footer sections | `<footer>` | Site-wide footer information |
| Sidebars | `<aside>` | Complementary content (navigation, table of contents) |

Section components render `<div>`s. They don't add `<header>` or `<main>` wrappers because they don't know where they'll be placed. A navigation component might end up in the header, a sidebar, or the main content area — the Layout decides placement, so the Layout provides the semantic wrappers.

---

## Tips

- **Start without a custom Layout.** The default covers most cases. Add one when you have a specific arrangement need, not preemptively.

- **Keep layout logic in Layout, rendering logic in components.** The Layout controls *where* things go. Components control *what* things look like. If you're styling content inside the Layout, it probably belongs in a component or in CSS.

- **Use CSS variables for dimensions.** Declare `header-height` and `sidebar-width` in `foundation.js` so sites can tune them. Then reference `var(--header-height)` in your Layout. The docs template does this — sticky positioning, sidebar heights, and mobile drawer offsets all reference the same variable.

- **Close mobile drawers on route change.** SPA navigation doesn't trigger a page reload, so drawers stay open unless you close them explicitly. The docs template watches `page.route` in a `useEffect`.

- **Test with and without panels.** Some pages may not have `@left` or `@right` content. Your Layout should handle null gracefully — check before rendering, and consider adjusting the main content width when panels are absent.

- **The `left`/`leftPanel` prop aliases.** The runtime passes both `left` and `leftPanel` (same for `right`/`rightPanel`) for backwards compatibility. Use whichever name you prefer, or accept both like the docs template does: `const leftContent = left || leftPanel`.

---

## See Also

- [Foundation Configuration](../../docs/foundation-configuration.md) — CSS variables, Layout export, complete reference
- [Special Sections](../../docs/special-sections.md) — How `@header`, `@footer`, `@left`, `@right` folders work
- [CCA Component Patterns](./component-patterns.md) — Section type organization and common patterns
