# Site Theming

Customize your site's colors, typography, and appearance through a `theme.yml` file. The theming system generates CSS custom properties at build time, enabling consistent branding across all components.

## Quick Start

Create `site/theme.yml`:

```yaml
colors:
  primary: "#3b82f6"
  secondary: "#64748b"
```

That's it. Your site now has a complete color palette with 11 shades for each color, accessible via CSS variables like `var(--color-primary-500)` or Tailwind classes like `bg-primary-500`.

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

### Generation Modes

Control how shades are generated with the `mode` option:

```yaml
colors:
  primary:
    base: "#3b82f6"
    mode: natural     # 'fixed', 'natural', or 'vivid'
```

| Mode | Hue | Chroma | Best For |
|------|-----|--------|----------|
| `fixed` | Constant | Linear scaling | Design systems, accessibility |
| `natural` | Temperature-aware shifts | Bézier curve (1.1x boost) | Organic, artistic palettes |
| `vivid` | Subtle shifts | High boost (1.4x) | Bold marketing, gaming |

**Fixed (default)**: Predictable results with constant hue across all shades. Best for design systems where consistent contrast ratios matter.

**Natural**: Warmer colors (reds, oranges) shift cooler in light shades and warmer in dark shades. Cool colors do the opposite. Creates more organic-feeling palettes.

**Vivid**: Maximum saturation with dramatic chroma curves. Colors stay vibrant even at light and dark extremes.

See the [color modes visual comparison](./color-modes-example.html) for a side-by-side view.

### Exact Brand Color Matching

Guarantee your exact brand color appears at shade 500:

```yaml
colors:
  brand:
    base: "#E31937"
    exactMatch: true   # Shade 500 = exact input
```

Without `exactMatch`, the algorithm calculates shade 500's lightness (55%), which may differ slightly from your input color.

### Using Colors

**In CSS:**
```css
.my-button {
  background: var(--color-primary-600);
  color: white;
}
.my-button:hover {
  background: var(--color-primary-700);
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
    fg: var(--color-neutral-900)
    muted: var(--color-neutral-500)
    link: var(--color-primary-600)
    border: var(--color-neutral-200)

  medium:
    bg: var(--color-neutral-100)
    fg: var(--color-neutral-900)
    muted: var(--color-neutral-600)
    link: var(--color-primary-600)
    border: var(--color-neutral-300)

  dark:
    bg: var(--color-neutral-900)
    fg: white
    muted: var(--color-neutral-400)
    link: var(--color-primary-400)
    border: var(--color-neutral-700)
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

## Code Block Syntax Highlighting

Code blocks in markdown content are automatically syntax-highlighted using [Shiki](https://shiki.style). Customize the colors via the `code` section:

```yaml
code:
  background: "#1e1e2e"     # Code block background
  foreground: "#cdd6f4"     # Default text color

  # Syntax highlighting colors
  keyword: "#cba6f7"        # Keywords (if, else, function)
  string: "#a6e3a1"         # String literals
  number: "#fab387"         # Numbers
  comment: "#6c7086"        # Comments
  function: "#89b4fa"       # Function names
  variable: "#f5e0dc"       # Variables
  operator: "#89dceb"       # Operators
  type: "#f9e2af"           # Type names
  constant: "#f38ba8"       # Constants
  property: "#94e2d5"       # Object properties
  tag: "#89b4fa"            # HTML/JSX tags
  attribute: "#f9e2af"      # HTML attributes
```

### Default Theme

If you don't customize `code`, Uniweb uses a dark theme inspired by Catppuccin Mocha—a popular color scheme that's easy on the eyes.

### How It Works

1. **Lazy loading**: Shiki is only loaded when a page contains code blocks
2. **Tree-shaking**: If your foundation doesn't render code blocks, Shiki isn't bundled
3. **Runtime injection**: CSS variables are injected when the first code block renders
4. **Dynamic content**: Works with both static pages and API-loaded content

Shiki is included with `@uniweb/kit` - no additional installation needed.

### Supported Languages

Common languages are loaded by default:
- JavaScript, TypeScript, JSX, TSX
- JSON, YAML, HTML, CSS
- Markdown, Python, Bash

Other languages are loaded on-demand when encountered.

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
@import "@uniweb/kit/theme-tokens.css";
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
  const primaryVar = useThemeColorVar('primary', 500) // 'var(--color-primary-500)'

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
    fg: var(--color-neutral-900)
    link: var(--color-primary-600)
  dark:
    bg: var(--color-primary-900)
    fg: white
    link: var(--color-primary-300)

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

## See Also

- [Site Configuration](./site-configuration.md) — Full site.yml reference
- [Page Configuration](./page-configuration.md) — Section theme parameter
- [Content Structure](./content-structure.md) — How content is parsed
- [Component Metadata](./component-metadata.md) — Full meta.js schema
