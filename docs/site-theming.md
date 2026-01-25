# Site Theming

Customize your site's colors, typography, and appearance through a `theme.yml` file. The theming system generates CSS custom properties at build time, enabling consistent branding across all components.

## Quick Start

Create `site/theme.yml`:

```yaml
colors:
  primary: "#3b82f6"
  secondary: "#64748b"
```

That's it. Your site now has a complete color palette with 11 shades for each color, accessible via CSS variables like `var(--primary-500)` or Tailwind classes like `bg-primary-500`.

## How It Works

1. **Build time**: The build reads `theme.yml` and generates CSS custom properties
2. **Color generation**: Each base color generates 11 perceptually-uniform shades using OKLCH
3. **CSS injection**: Generated CSS is injected into `<head>` (works with SSG)
4. **Foundation integration**: Components reference theme variables for consistent styling

## Color Palettes

Define brand colors with a single hex value—shades are auto-generated:

```yaml
colors:
  primary: "#3b82f6"      # Main brand color
  secondary: "#64748b"    # Supporting color
  accent: "#8b5cf6"       # Highlight color
  neutral: "#737373"      # Text, backgrounds, borders
```

### Generated Shades

Each color generates 11 shades:

| Shade | Lightness | Use Case |
|-------|-----------|----------|
| 50 | 97% | Subtle backgrounds |
| 100 | 93% | Hover backgrounds |
| 200 | 87% | Active backgrounds |
| 300 | 78% | Borders |
| 400 | 68% | Placeholder text |
| 500 | 55% | **Base color** |
| 600 | 48% | Primary buttons |
| 700 | 40% | Pressed states |
| 800 | 32% | Dark accents |
| 900 | 24% | Near-black |
| 950 | 14% | Darkest |

### Using Colors

**In CSS:**
```css
.my-button {
  background: var(--primary-600);
  color: white;
}
.my-button:hover {
  background: var(--primary-700);
}
```

**In Tailwind** (requires foundation setup):
```jsx
<button className="bg-primary-600 hover:bg-primary-700 text-white">
  Click me
</button>
```

### Pre-defined Shade Objects

For precise control, provide your own shade values:

```yaml
colors:
  brand:
    50: "#fef2f2"
    100: "#fee2e2"
    200: "#fecaca"
    300: "#fca5a5"
    400: "#f87171"
    500: "#ef4444"
    600: "#dc2626"
    700: "#b91c1c"
    800: "#991b1b"
    900: "#7f1d1d"
    950: "#450a0a"
```

## Color Contexts

Contexts define semantic color tokens for different section backgrounds. Apply them via the `theme` frontmatter parameter:

```markdown
---
type: Hero
theme: dark
---
```

### Default Contexts

Three contexts are available by default:

| Context | Background | Text | Use Case |
|---------|------------|------|----------|
| `light` | White | Dark gray | Default sections |
| `medium` | Light gray | Dark gray | Alternating sections |
| `dark` | Dark gray | White | Hero sections, footers |

### Customizing Contexts

Override semantic tokens per context:

```yaml
contexts:
  light:
    bg: white
    fg: var(--neutral-900)
    muted: var(--neutral-500)
    link: var(--primary-600)
    border: var(--neutral-200)

  medium:
    bg: var(--neutral-100)
    fg: var(--neutral-900)
    muted: var(--neutral-600)
    link: var(--primary-600)
    border: var(--neutral-300)

  dark:
    bg: var(--neutral-900)
    fg: white
    muted: var(--neutral-400)
    link: var(--primary-400)
    border: var(--neutral-700)
```

### Using Context Tokens

Components can reference semantic tokens that adapt to context:

```css
.card {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
}

.card a {
  color: var(--link);
}

.card .subtitle {
  color: var(--muted);
}
```

The same component renders appropriately in any context without conditional styling.

## Typography

Configure font families and imports:

```yaml
fonts:
  body: "Inter, system-ui, sans-serif"
  heading: "Poppins, system-ui, sans-serif"
  mono: "Fira Code, monospace"

  import:
    - url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700"
    - url: "https://fonts.googleapis.com/css2?family=Poppins:wght@600;700"
```

### Generated CSS Variables

```css
:root {
  --font-body: Inter, system-ui, sans-serif;
  --font-heading: Poppins, system-ui, sans-serif;
  --font-mono: Fira Code, monospace;
}
```

### Using Fonts

```css
body {
  font-family: var(--font-body);
}

h1, h2, h3 {
  font-family: var(--font-heading);
}

code {
  font-family: var(--font-mono);
}
```

## Appearance (Light/Dark Mode)

Control site-wide color scheme preferences:

```yaml
appearance:
  default: light              # 'light', 'dark', or 'system'
  allowToggle: true           # Let visitors switch modes
  respectSystemPreference: true
  schemes: [light, dark]      # Available schemes
```

### Appearance Options

| Option | Values | Description |
|--------|--------|-------------|
| `default` | `light`, `dark`, `system` | Initial color scheme |
| `allowToggle` | `true`, `false` | Show mode toggle UI |
| `respectSystemPreference` | `true`, `false` | Honor `prefers-color-scheme` |
| `schemes` | Array | Which schemes to support |

### Simple Shorthand

For simple cases, use a string:

```yaml
appearance: light    # Fixed light mode, no toggle
appearance: dark     # Fixed dark mode, no toggle
appearance: system   # Follow system preference
```

### React Hook for Toggle

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

## Foundation Variables

Foundations can define customizable CSS variables that sites override:

### Foundation Definition

In `foundation/src/foundation.js`:

```js
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
    description: 'Vertical section padding',
  },
}
```

### Site Override

In `site/theme.yml`:

```yaml
vars:
  header-height: 5rem
  max-content-width: 72rem
```

### Using Foundation Variables

```css
.header {
  height: var(--header-height);
}

.container {
  max-width: var(--max-content-width);
  margin: 0 auto;
}

section {
  padding: var(--section-padding-y) 1.5rem;
}
```

## Tailwind CSS v4 Integration

For foundations using Tailwind CSS v4, map theme colors in `styles.css`:

```css
@import "tailwindcss";

@theme inline {
  /* Map theme palette to Tailwind */
  --color-primary-50: var(--primary-50);
  --color-primary-100: var(--primary-100);
  /* ... all shades ... */
  --color-primary-950: var(--primary-950);

  /* Semantic aliases */
  --color-primary: var(--primary-500);
}
```

Now Tailwind classes work with theme colors:

```jsx
<button className="bg-primary-600 hover:bg-primary-700">
  Theme-aware button
</button>
```

## Runtime Access

Access theme data programmatically in components:

### useThemeData

```jsx
import { useThemeData } from '@uniweb/kit'

function ColorPicker() {
  const theme = useThemeData()

  if (!theme) return null

  const colors = theme.getPaletteNames() // ['primary', 'secondary', ...]
  const primary500 = theme.getColor('primary', 500)

  return (
    <div style={{ color: primary500 }}>
      Available: {colors.join(', ')}
    </div>
  )
}
```

### useThemeColor

```jsx
import { useThemeColor, useThemeColorVar } from '@uniweb/kit'

function Badge() {
  // Get actual color value
  const accentColor = useThemeColor('accent', 600)

  // Get CSS variable reference
  const primaryVar = useThemeColorVar('primary', 500) // 'var(--primary-500)'

  return (
    <span style={{ background: accentColor, color: primaryVar }}>
      New
    </span>
  )
}
```

### useColorContext

```jsx
import { useColorContext } from '@uniweb/kit'

function Card({ block }) {
  const context = useColorContext(block) // 'light', 'medium', or 'dark'

  return (
    <div className={`card card--${context}`}>
      {/* ... */}
    </div>
  )
}
```

## Complete Example

```yaml
# site/theme.yml

# Brand colors
colors:
  primary: "#0066cc"      # Blue
  secondary: "#475569"    # Slate
  accent: "#dc2626"       # Red for CTAs
  neutral: "#64748b"      # Gray scale

# Section contexts
contexts:
  light:
    bg: white
    fg: var(--neutral-900)
    link: var(--primary-600)
  dark:
    bg: var(--primary-900)
    fg: white
    link: var(--primary-300)

# Typography
fonts:
  body: "Inter, sans-serif"
  heading: "Inter, sans-serif"
  import:
    - url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700"

# Dark mode support
appearance:
  default: light
  allowToggle: true
  respectSystemPreference: true
  schemes: [light, dark]

# Foundation overrides
vars:
  header-height: 4.5rem
  max-content-width: 76rem
```

## Best Practices

1. **Start with primary**: Define at least a `primary` color—it's the foundation of your palette

2. **Use semantic tokens**: Reference context tokens (`--bg`, `--fg`, `--link`) in components instead of specific colors for automatic dark mode support

3. **Leverage generated shades**: Use lighter shades for backgrounds (50-200) and darker shades for text/accents (600-900)

4. **Test both schemes**: If enabling dark mode, verify all contexts look good in both light and dark schemes

5. **Keep fonts minimal**: Load only weights you actually use to optimize performance

## Related

- [Content Structure](./content-structure.md) — How content is parsed
- [Component Metadata](./component-metadata.md) — Full meta.js schema
- [Data Fetching](./data-fetching.md) — Load external data
