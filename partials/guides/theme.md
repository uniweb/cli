# Theming: tokens, light and dark, `theme.yml`, fonts, `styles.css`

On-demand guide (`uniweb guide theme`); AGENTS.md is assumed read. Author's view: `reference/site-theming.md`.

## Semantic tokens

| Token | Purpose |
|---|---|
| `heading`, `body`, `subtle` | text |
| `section`, `card`, `muted` | section background, panel background, hover/zebra |
| `border`, `ring` | lines, focus |
| `link` / `link-hover` | links |
| `primary` / `-foreground` / `-hover` / `-border`, `secondary` / … | actions |
| `success` / `warning` / `error` / `info`, `+ -subtle` | status, status backgrounds |

Palette shades: `text-primary-600`, `bg-neutral-100`, `border-accent-300` — 50–950 for primary, secondary, accent, neutral. Full mapping in `theme-tokens.css`.

**Debugging a token that "does nothing" — don't probe in the browser.** Tailwind v4 is JIT and emits only classes found in scanned source, so a class assigned from the console can never resolve. Ask the build: `grep -o '\.text-link{[^}]*}' dist/assets/*.css`. A rule prints → the utility exists and something overrides it at runtime. Nothing prints → `styles.css` doesn't import `theme-tokens.css` (or declares its own `@theme inline` omitting it), or `@source` doesn't cover the file.

**Per-section theme maps.** A section's `theme:` is `theme.yml` for that section — tokens beside `mode`, plus `colors`, `contexts`, `vars` scoped to it (`theme: { mode: light, section: neutral-100, card: neutral-50, primary: neutral-900, colors: { accent: '#e65100' }, contexts: { dark: { link: accent-300 } } }`). `background:` accepts CSS variables and hex too, so authors alternate surfaces with no component code. Map a source design's surface variations to backgrounds or token overrides in frontmatter — not to component code.

## Section context vs site scheme

- **Section context** — `theme:` on one section. Per-section, author-controlled.
- **Site scheme** — the global preference under `appearance:` in `theme.yml`; the visitor's toggle.

A section with no `theme:` follows the scheme; one that pins `theme: dark` stays dark in either.

```yaml
appearance:
  default: light                # light | dark | system
  allowToggle: true             # offer a switch (also generates dark tokens)
  respectSystemPreference: true # first visit follows the OS; false pins `default`
  schemes: [light, dark]
```

Shorthands: `appearance: light` / `dark` (fixed), `appearance: system`. A site has dark mode when it offers a toggle, defaults to `dark`/`system`, or lists `dark`. Precedence: stored choice > a dark OS > `default:` — the OS can only choose dark, so `default: light` is a fallback, not a guarantee, unless `respectSystemPreference: false`, and `default: dark` stays dark on a light OS.

| Goal | `theme.yml` |
|---|---|
| Always light / dark, no switch | `appearance: light` / `dark` |
| Toggle, follow OS on first visit | `{ default: system, allowToggle: true }` |
| Toggle, always start light | `{ default: light, allowToggle: true, respectSystemPreference: false }` |

```jsx
const { scheme, toggle, canToggle } = useAppearance()
if (!canToggle) return null
```

The runtime applies `scheme-dark`/`scheme-light` to `<html>` before paint. For Tailwind `dark:` utilities: `@custom-variant dark (&:where(.scheme-dark, .scheme-dark *));` in `styles.css`; prefer tokens, which adapt per section.

## theme.yml

```yaml
colors:
  primary: '#3b82f6'          # your hex at shade 500
  secondary: '#64748b'
  accent: '#8b5cf6'
  neutral: stone              # named preset: stone, zinc, gray, slate, neutral
contexts:
  light: { section: '#fafaf9' }
appearance: { default: light, allowToggle: true }
fonts: { heading: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" }
inline: { callout: { color: var(--accent), font-weight: '600' } }
vars: { radius: 0.75rem }
code: dracula                 # or { light: github-light, dark: github-dark }, or { theme: github-dark, background: '#0D0D0D' }
```

Context override keys match token names (`section:` not `bg:`). In light/medium `--primary` uses shade 600, `--link` 600, `--ring` 500; in dark `--primary` 500, `--link` 400. Buttons use 600 for contrast with white text; for brand-exact buttons set `contexts.light.primary: primary-500` and `primary-hover: primary-600`, and test contrast — bright brands at 500 may fail WCAG 4.5:1. A code block paints its theme's background and foreground before the highlighter loads when both are known.

## Fonts

| Role | Wired onto | Use |
|---|---|---|
| `body` | `body` | paragraphs, UI |
| `heading` | `h1, h2, h3` | titles |
| `code` | `code, pre, kbd, samp` | monospace |

The site wires families onto elements, so a foundation normally sets none — render semantic markup and the roles apply. Weight/size/style utilities are yours; a font-**family** utility (`font-sans`, `font-serif`) resolves to Tailwind's stacks unless the foundation declares it as a font var. For typefaces the three roles can't express, declare each as a **font var** in `main.js` — a `font-*` name is recognised as a typeface (a bare name takes `type: 'font'`):

```js
export const vars = {
  'font-serif':   { default: 'ui-serif, Georgia, serif', applyTo: ['blockquote', '.tagline'] },  // framework emits the rule
  'font-display': { default: 'ui-sans-serif, system-ui, sans-serif' },                          // component wires it
}
```

`fonts:` in `theme.yml` takes any role name; redeclaring a built-in role's var with a new `applyTo` retargets it. `serif` and `font-serif` are the same var (the site sets it by the bare role name).

```yaml
fonts:
  heading: "Poppins, sans-serif"
  serif: '"Fraunces", Georgia, serif'
  import: [{ url: "https://fonts.googleapis.com/css2?family=Poppins:wght@600;700" }]
  faces: [{ family: "Fraunces", src: /fonts/fraunces.woff2, weight: "100 900" }]
```

The build adds preconnect hints, emits `@font-face` + preload, drops unreferenced families; `uniweb push` uploads face files under `public/`. An imported font replaces the fallback when it arrives (`display=swap`, unless the URL says otherwise), which can re-wrap text on a first visit. `display=optional` in the URL keeps the font first drawn for that visit instead, and `faces:` serves the files from the site, preloaded. The `code` role owns `--font-code`; Tailwind's `font-mono` reads `--font-mono`, a separate var you declare yourself. A role's face on an element it isn't wired onto — a wordmark in the heading face, say — is `font-family: var(--font-heading)`, or a utility of your own: `@theme inline { --font-display: var(--font-heading); }` in `styles.css`, then `font-display`.

## styles.css

```css
@import "tailwindcss";
@import "@uniweb/kit/theme-tokens.css";
@import "@uniweb/kit/prose-tokens.css";
@source "./sections/**/*.{js,jsx}";
@source "./components/**/*.{js,jsx}";
@source "./layouts/**/*.{js,jsx}";
@source "./utils/**/*.{js,jsx}";
@theme { --breakpoint-xs: 30rem; }
```

Two more imports are opt-in: `@uniweb/kit/math-tokens.css` lays out equations, and `@uniweb/kit/callout-tokens.css` draws concept blocks such as `md:warning`, which are otherwise plain prose.

**Name every folder that writes classes,** or keeps them in a string for code elsewhere to write, such as a map of colours to classes in `utils/`. The foundation's own build finds them all, but a site build and `uniweb dev` read only what these lines name, so a class in a folder left out is in one CSS and missing from the other. `uniweb dev`, a site build and `uniweb doctor` (`unread-folder`) give the line to add. `theme-tokens.css` also tells Tailwind to read kit's source, so kit's own classes reach your CSS wherever your package manager put kit; a foundation that skips that import names kit itself, by where kit is (`./node_modules/@uniweb/kit/src/**` under pnpm, `../node_modules/@uniweb/kit/src/**` under npm).

Custom CSS is expected alongside Tailwind — shadow systems, border hierarchies, gradients, glass. Tokens are a floor; add vocabulary that references them so it adapts per context:

```css
.border-subtle { border-color: color-mix(in oklch, var(--border), transparent 50%); }
.text-tertiary { color: color-mix(in oklch, var(--body), var(--subtle) 50%); }
```

Priority: design quality > portability > configurability. Four things a ported design brings that break something: global `scroll-behavior: smooth` (the runtime's `scrollTo(x, y)` inherits it and route changes animate/interrupt — scope it to an element); `filter: blur()` glows (Safari repaints them on the main thread during view transitions — use a radial `mask-image` instead); `-webkit-font-smoothing: antialiased` on `html` (scope it to `.scheme-dark`); JS-started entrance animations (write them in CSS so they start at first paint on a prerendered page).
