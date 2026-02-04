# Theming Your Uniweb Site

This guide shows you how to customize your site's visual identity — colors, fonts, dark mode, and more. Everything happens in one file: `theme.yml`.

No coding required. You edit a configuration file, and the site generates all the colors and styles automatically.

---

## Where Theming Lives

Your site folder has a `theme.yml` file:

```
site/
├── pages/
├── site.yml
└── theme.yml          ← your site's visual identity
```

This file controls how your site looks. The template you chose provides the structure and layout — `theme.yml` lets you make it yours.

---

## Your Brand Colors

The simplest thing you can do is set your brand color:

```yaml
colors:
  primary: "#3b82f6"
```

That single line generates a complete color palette — eleven shades from very light to very dark — that your entire site uses for buttons, links, accents, and highlights.

You can add more colors:

```yaml
colors:
  primary: "#3b82f6"      # Your main brand color
  secondary: "#64748b"    # A supporting color
  accent: "#8b5cf6"       # For highlights or calls to action
  neutral: "#737373"      # Grays for text, borders, backgrounds
```

Each color you define generates its own set of shades. You just pick the base color — the site does the rest.

### How to pick colors

You only need to provide one hex color per palette. A good starting point:

- **primary** — your brand's main color (used for buttons, links, key accents)
- **neutral** — a gray tone for text, borders, and backgrounds
- **secondary** or **accent** — optional supporting colors

If you're not sure what hex codes to use, tools like [Coolors](https://coolors.co/) or [Realtime Colors](https://www.realtimecolors.com/) can help you explore palettes.

### Exact brand color matching

By default, the site generates shades using a perceptually uniform color space, which may adjust your input color slightly for consistency. If your brand guidelines require an exact color match:

```yaml
colors:
  brand:
    base: "#E31937"
    exactMatch: true
```

This guarantees your exact hex value appears in the palette.

### Shade generation modes

You can control how shades are generated:

```yaml
colors:
  primary:
    base: "#3b82f6"
    mode: natural
```

| Mode | Effect | Best for |
|------|--------|----------|
| `fixed` | Consistent hue across all shades | Design systems, corporate sites |
| `natural` | Subtle hue shifts that feel organic | Artistic, editorial sites |
| `vivid` | Maximum color intensity | Bold marketing, gaming sites |

The default is `fixed`. Most sites don't need to change this.

### Providing your own shades

If you have a specific palette from a designer, you can provide all the shades yourself:

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

---

## Fonts

Set the fonts your site uses:

```yaml
fonts:
  body: "Inter, system-ui, sans-serif"
  heading: "Poppins, system-ui, sans-serif"
  mono: "Fira Code, monospace"
```

| Font type | Where it's used |
|-----------|----------------|
| `body` | Paragraphs, general text |
| `heading` | Titles, subtitles, headings |
| `mono` | Code blocks, technical text |

### Loading web fonts

If you're using fonts from Google Fonts (or another provider), tell the site where to load them:

```yaml
fonts:
  body: "Inter, system-ui, sans-serif"
  heading: "Poppins, system-ui, sans-serif"

  import:
    - url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700"
    - url: "https://fonts.googleapis.com/css2?family=Poppins:wght@600;700"
```

Only load the font weights you actually use. Each weight adds to your page load time.

> **Automatic optimization:** When you use Google Fonts (or any external font provider), the build automatically adds preconnect hints so the browser starts connecting to the font server earlier. You don't need to do anything extra — just list your imports and the optimization happens for you.

### Using system fonts

If you don't specify fonts, the site uses the visitor's system fonts — which load instantly and look native to each operating system. This is a perfectly good choice:

```yaml
fonts:
  body: "system-ui, sans-serif"
  heading: "system-ui, sans-serif"
```

---

## Section Themes

Individual sections on your pages can use different color schemes. You set this in the section's frontmatter with the `theme:` setting:

```markdown
---
type: Hero
theme: dark
---

# Welcome to Our Site
```

Three themes are available by default:

| Theme | Background | Text | Typical use |
|-------|------------|------|-------------|
| `light` | White | Dark | Default for most sections |
| `medium` | Light gray | Dark | Alternating sections for visual rhythm |
| `dark` | Dark | White | Hero banners, footers, calls to action |

You don't need to set `theme:` on every section. Sections default to `light`. Use `medium` and `dark` strategically to create visual contrast between sections on a page.

### Customizing themes

You can change what colors each theme uses:

```yaml
contexts:
  light:
    bg: white
    fg: neutral-900
    muted: neutral-500
    border: neutral-200

  medium:
    bg: neutral-100
    fg: neutral-900
    muted: neutral-600
    border: neutral-300

  dark:
    bg: neutral-900
    fg: white
    muted: neutral-400
    border: neutral-700
```

The tokens (`bg`, `fg`, `muted`, `border`) are semantic — they describe the *role* of the color, not a specific value. When a section uses `theme: dark`, all its colors automatically switch to the dark context values.

| Token | What it controls |
|-------|-----------------|
| `bg` | Section background |
| `fg` | Main text color |
| `muted` | Secondary text (subtitles, captions) |
| `link` | Link color |
| `border` | Border color |

The values reference your color palettes. For example, `neutral-900` means shade 900 of your neutral color. You can also use `white`, `black`, or any palette shade you've defined.

---

## Dark Mode

You can let visitors switch between light and dark appearances:

```yaml
appearance:
  default: light
  allowToggle: true
  respectSystemPreference: true
  schemes: [light, dark]
```

| Setting | What it does |
|---------|-------------|
| `default` | The initial appearance (`light`, `dark`, or `system`) |
| `allowToggle` | Whether visitors can switch between light and dark |
| `respectSystemPreference` | Follow the visitor's operating system setting |
| `schemes` | Which appearances are available |

### Simple options

For simpler setups, you can use a shorthand:

```yaml
appearance: light     # Always light, no toggle
appearance: dark      # Always dark, no toggle
appearance: system    # Follow the visitor's system setting
```

### How dark mode works

When dark mode is active, all the section themes (`light`, `medium`, `dark`) adjust their colors automatically. You don't need to create separate content for dark mode — the same sections look appropriate in both appearances.

Your template handles the dark mode toggle UI. Most templates show a sun/moon button in the header when `allowToggle` is enabled.

---

## Page Background

By default, the page background is white. Many designs use a tinted background — a light gray, a warm off-white, or a subtle color wash. Set it in `theme.yml`:

```yaml
background: var(--neutral-100)
```

This accepts any CSS background value:

```yaml
# Solid color
background: "#f8f9fa"

# Theme variable
background: var(--neutral-100)

# Gradient
background: linear-gradient(180deg, white, var(--neutral-50))
```

The page background shows through between sections and behind sections that use the default light theme. Sections with their own `theme:` or `background:` in frontmatter render on top of it.

---

## Inline Text Styles

You can define named styles for inline text — accent colors, highlights, callouts — so content authors can use them without knowing CSS:

```yaml
inline:
  accent:
    color: var(--primary-600)
  muted:
    color: var(--text-muted)
  callout:
    color: var(--accent-600)
    font-weight: 600
  highlight:
    background: var(--primary-100)
    color: var(--primary-900)
```

Content authors use them with bracket syntax:

```markdown
Get [real-time data]{accent} from our [secure API]{muted}.

This is [important]{callout} — please read carefully.

The [key finding]{highlight} was confirmed by three studies.
```

Each name you define becomes available as an inline style. Because the values can reference theme variables (like `var(--primary-600)`), the styles adapt automatically when you change your brand colors or when text appears inside a dark section.

---

## Code Block Colors

If your site displays code examples, you can customize how they look:

```yaml
code:
  background: "#1e1e2e"
  foreground: "#cdd6f4"
  keyword: "#cba6f7"
  string: "#a6e3a1"
  number: "#fab387"
  comment: "#6c7086"
  function: "#89b4fa"
  variable: "#f5e0dc"
  operator: "#89dceb"
  type: "#f9e2af"
  tag: "#89b4fa"
  attribute: "#f9e2af"
```

If you don't customize this, the site uses a dark theme that's easy on the eyes. Most sites don't need to change code colors unless they have specific brand requirements.

---

## Template Settings

Your template may define additional settings you can customize — like header height, content width, or section spacing. These appear under `vars:` in `theme.yml`:

```yaml
vars:
  header-height: 5rem
  max-content-width: 72rem
  section-padding-y: 6rem
```

What settings are available depends entirely on your template. Check your template's documentation or look at the comments in the `theme.yml` file that came with your site.

---

## Complete Example

Here's a full `theme.yml` showing all the options together:

```yaml
# Brand colors
colors:
  primary: "#0066cc"
  secondary: "#475569"
  accent: "#dc2626"
  neutral: "#64748b"

# Page background
background: var(--neutral-100)

# Section color contexts
contexts:
  light:
    bg: white
    fg: neutral-900
    link: primary-600
  dark:
    bg: primary-900
    fg: white
    link: primary-300

# Typography
fonts:
  body: "Inter, sans-serif"
  heading: "Inter, sans-serif"
  import:
    - url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700"

# Inline text styles
inline:
  accent:
    color: var(--primary-600)
  highlight:
    background: var(--primary-100)
    color: var(--primary-900)

# Dark mode support
appearance:
  default: light
  allowToggle: true
  respectSystemPreference: true
  schemes: [light, dark]

# Template settings
vars:
  header-height: 4.5rem
  max-content-width: 76rem
```

---

## Tips

### Start simple

You don't need to fill in everything. A `theme.yml` with just a primary color is enough:

```yaml
colors:
  primary: "#3b82f6"
```

The site has sensible defaults for everything else. Add more customization as you need it.

### Use the preview

The best way to see how your changes look is to run the site locally with `pnpm dev` and edit `theme.yml`. Changes take effect when you refresh the page.

### Colors affect the whole site

When you change your primary color, every button, link, and accent on the site updates automatically. That's the point — you set the brand once, and the entire site follows.

### Section themes create rhythm

Alternating between `light` and `medium` (or adding a `dark` hero at the top) creates visual variety without changing your content:

```markdown
<!-- 1-hero.md -->
---
type: Hero
theme: dark
---

<!-- 2-features.md -->
---
type: Features
---

<!-- 3-testimonials.md -->
---
type: Testimonials
theme: medium
---

<!-- 4-cta.md -->
---
type: CTA
theme: dark
---
```

### Don't fight the template

If something doesn't look right, it's usually better to adjust your colors and fonts than to try to override the template's design decisions. The template was designed to work well with the theming system — let it do its job.

---

## What's Next?

- **[Writing Content](./writing-content.md)** — How to write content for sections
- **[Translating Your Site](./translating-your-site.md)** — Add multiple languages
- **[Recipes](./recipes.md)** — Copy-paste solutions for common patterns
