# Site Theming

Customize your site's colors, typography, and appearance through a `theme.yml` file. The theming system generates CSS custom properties at build time, enabling consistent branding across all components.

## Quick Start

Create `site/theme.yml`:

```yaml
colors:
  primary: "#3b82f6"
  secondary: "#64748b"
```

That's it. Your site now has a complete color palette with 11 shades for each color, semantic tokens that adapt per-section, and Tailwind utility classes like `bg-primary-500` and `text-heading` ready to use.

## How It Works

1. **You define colors** in `theme.yml` (one hex value per palette)
2. **Build generates CSS** — 11 perceptually-uniform shades per color (OKLCH), semantic tokens for light/medium/dark contexts, font variables
3. **CSS is injected** into `<head>` at runtime (works with SSG — zero FOUC)
4. **Content authors control sections** — `theme: dark` in frontmatter applies a context class, and all semantic tokens resolve accordingly

The key insight: **components don't manage their own colors**. They use semantic tokens (`text-heading`, `bg-surface`, `border-edge`) that resolve differently depending on the section's context. A content author writes `theme: dark` on a hero section, and every component inside it automatically gets light text on a dark background — no conditional logic in the component.

## Color Palettes

Define brand colors with a single hex value — shades are auto-generated:

```yaml
colors:
  primary: "#3b82f6"      # Main brand color
  secondary: "#64748b"    # Supporting color
  accent: "#8b5cf6"       # Highlight color
  neutral: "#737373"      # Text, backgrounds, borders
```

### Generated Shades

Each color generates 11 shades as CSS variables (`--primary-50` through `--primary-950`):

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

Palette colors are available as both CSS variables and Tailwind classes.

**CSS variables** (short names, set by the build):
```css
.my-button {
  background: var(--primary-600);
  color: white;
}
.my-button:hover {
  background: var(--primary-700);
}
```

**Tailwind classes** (via `theme-tokens.css` bridge):
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

Contexts define semantic color tokens for different section backgrounds. Content authors apply them via the `theme` frontmatter parameter:

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

### Semantic Tokens

Each context defines CSS variables that components use instead of hardcoded colors:

| Token | Purpose | Tailwind Class |
|-------|---------|---------------|
| `--heading` | Heading text | `text-heading` |
| `--text` | Body text | `text-body` |
| `--text-muted` | Secondary text | `text-muted` |
| `--bg` | Section background | `bg-surface` |
| `--bg-subtle` | Card backgrounds | `bg-surface-subtle` |
| `--border` | Primary borders | `border-edge` |
| `--link` | Link text | `text-link` |
| `--btn-primary-bg` | Primary button | `bg-btn-primary` |

Components using these tokens adapt automatically when a content author changes the section's `theme:` in frontmatter. No conditional logic needed in the component — the CSS cascade handles it.

### Customizing Contexts

Override semantic tokens per context:

```yaml
contexts:
  light:
    bg: white
    link: var(--primary-600)
    border: var(--neutral-200)

  dark:
    bg: var(--primary-900)         # Use primary color instead of neutral
    link: var(--accent-300)        # Use accent for links in dark sections
```

### Per-Section Token Overrides

The `theme:` frontmatter supports an extended object format that lets content authors override specific tokens for a single section. Use `mode` to set the context (light/medium/dark), and add any token names alongside it:

```yaml
---
type: Header
theme:
  mode: light
  btn-primary-bg: var(--neutral-900)
  btn-primary-hover: var(--neutral-800)
---
```

This keeps the light context for text and backgrounds, but gives the primary button a dark appearance — just for this section. Any token from the semantic token table above can be overridden this way.

The overrides are applied as inline CSS custom properties on the section wrapper, so they take precedence over the context class values. Components don't need to know about the overrides — they just use `bg-btn-primary` and get the overridden value.

For simple string usage, `theme: dark` is equivalent to `theme: { mode: dark }`.

### Section Backgrounds

Sections can also declare a background in frontmatter, independent of the theme context:

```yaml
---
type: CTA
theme: dark
background:
  color: var(--primary-600)
---
```

This gives the section a branded background with all the dark context's text and link colors. The runtime renders the background behind the component — the component doesn't need to know about it.

Background accepts several formats:

```yaml
# Solid color
background:
  color: var(--primary-600)

# Gradient
background:
  gradient: linear-gradient(135deg, var(--primary-600), var(--primary-800))

# Image (shorthand — a path or URL is treated as an image)
background: /images/hero.jpg

# Image with overlay
background:
  image: /images/hero.jpg
  overlay: 0.5

# Video (autoplays muted, loops)
background:
  video: /videos/hero.mp4
```

Video backgrounds autoplay muted and loop. If you provide an `.mp4`, the runtime also tries `.webm` for better compression where supported.

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

When font imports are present, the build automatically injects `<link rel="preconnect">` tags for each import origin. For Google Fonts specifically, it also preconnects to `fonts.gstatic.com` (where font files are served from, separate from the CSS endpoint). This eliminates the DNS/TLS round-trip delay that would otherwise occur when the browser first encounters the `@import` in the theme CSS.

Generated CSS variables:

```css
:root {
  --font-body: Inter, system-ui, sans-serif;
  --font-heading: Poppins, system-ui, sans-serif;
  --font-mono: Fira Code, monospace;
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

If you don't customize `code`, Uniweb uses a dark theme inspired by Catppuccin Mocha. Shiki is lazy-loaded — only downloaded when a page contains code blocks.

## Appearance (Light/Dark Mode)

Control site-wide color scheme preferences:

```yaml
appearance:
  default: light              # 'light', 'dark', or 'system'
  allowToggle: true           # Let visitors switch modes
  respectSystemPreference: true
  schemes: [light, dark]      # Available schemes
```

### Simple Shorthand

For simple cases, use a string:

```yaml
appearance: light    # Fixed light mode, no toggle
appearance: dark     # Fixed dark mode, no toggle
appearance: system   # Follow system preference
```

Components use the `useAppearance()` hook if they need to render a toggle:

```jsx
import { useAppearance } from '@uniweb/kit'

function DarkModeToggle() {
  const { scheme, toggle, canToggle } = useAppearance()
  if (!canToggle) return null
  return <button onClick={toggle}>{scheme === 'dark' ? 'Light' : 'Dark'}</button>
}
```

## Foundation Variables

Foundations can define customizable CSS variables that sites override:

### Foundation Definition

In `foundation/src/foundation.js`:

```js
export const vars = {
  'header-height': {
    default: '4rem',
    description: 'Fixed header height',
  },
  'max-content-width': {
    default: '80rem',
    description: 'Maximum content width',
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

## Tailwind Integration

Foundations using Tailwind CSS v4 import a bridge file that maps theme variables to Tailwind's namespace:

```css
@import "tailwindcss";
@import "@uniweb/kit/theme-tokens.css";
```

This single import registers both semantic tokens and palette shades as Tailwind utilities. The build system generates short CSS variable names (`--primary-600`, `--heading`, `--bg`), and `theme-tokens.css` bridges them to Tailwind's `--color-*` namespace so that classes like `bg-primary-600`, `text-heading`, and `bg-surface` work.

**Why is this bridge needed?** Tailwind v4 builds at compile time, but theme values arrive at runtime (from `theme.yml`). The bridge file registers variable names with fallback defaults so Tailwind can generate the utility classes. At runtime, the real values from the theme CSS override the fallbacks.

Foundations that want different Tailwind names can skip the import and declare their own `@theme inline` block.

## Programmatic Access

Kit provides hooks for rare cases where components need runtime access to theme data — color pickers, theme previews, or dynamic style computation:

```jsx
import { useThemeData, useThemeColor, useThemeColorVar, useColorContext, useAppearance } from '@uniweb/kit'

const theme = useThemeData()                    // Full Theme object
const primaryColor = useThemeColor('primary', 600) // Actual oklch value
const primaryVar = useThemeColorVar('primary', 500) // 'var(--primary-500)'
const context = useColorContext(block)             // 'light', 'medium', or 'dark'
```

Most components don't need these hooks. Semantic tokens and Tailwind classes cover the common cases.

## Complete Example

```yaml
# site/theme.yml

# Brand colors
colors:
  primary: "#0066cc"
  secondary: "#475569"
  accent: "#dc2626"
  neutral: "#64748b"

# Section contexts
contexts:
  light:
    bg: white
    link: var(--primary-600)
  dark:
    bg: var(--primary-900)
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

1. **Start with primary**: Define at least a `primary` color — it's the foundation of your palette

2. **Use semantic tokens**: Reference context tokens (`text-heading`, `bg-surface`, `border-edge`) in components instead of hardcoded colors. They adapt automatically to section themes and site-wide appearance.

3. **Leverage frontmatter**: Section appearance is controlled by content authors through `theme:` and `background:` in frontmatter, not by component params. Components render; the runtime applies context.

4. **Keep fonts minimal**: Load only weights you actually use to optimize performance

## See Also

- [Site Configuration](./site-configuration.md) — Full site.yml reference
- [Page Configuration](./page-configuration.md) — Section theme parameter
- [Thinking in Contexts](../guides/developers/thinking-in-contexts.md) — Deep dive into semantic theming for component developers
- [Component Metadata](./component-metadata.md) — Full meta.js schema
