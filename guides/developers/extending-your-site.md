# Extending Your Site

Your site is a Vite app. That means the entire Vite plugin ecosystem is available to you — PWA support, sitemaps, image optimization, bundle analysis, and anything else the community has built. You don't need Uniweb to support these features specifically. You install a plugin, register it in your `vite.config.js`, and it works.

This guide covers how to add Vite plugins to a site, walks through PWA as a worked example, and maps out the different extensibility layers so you know which one fits what you're trying to do.

---

## Adding Vite Plugins

Every site has a `vite.config.js` that looks like this:

```js
import { defineSiteConfig } from '@uniweb/build/site'

export default defineSiteConfig()
```

`defineSiteConfig()` returns a full Vite config with everything Uniweb needs — React, Tailwind, content collection, routing. It also accepts standard Vite options, including a `plugins` array. Your plugins run alongside the built-in ones:

```js
import { defineSiteConfig } from '@uniweb/build/site'
import myPlugin from 'some-vite-plugin'

export default defineSiteConfig({
  plugins: [myPlugin()],
})
```

To use a Vite plugin, you install it as a dev dependency in your **site** package (not the foundation — the site is the Vite app that builds the final output):

```bash
cd site
pnpm add -D some-vite-plugin
```

Then import and register it in `vite.config.js`. That's the full pattern. The rest of this guide applies it to specific cases.

---

## Worked Example: PWA Support

A Progressive Web App needs three things: a web app manifest (tells the browser the app's name, icons, colors), a service worker (handles offline caching and updates), and registration code (connects the service worker to the page). The Vite ecosystem has a plugin that handles all three.

### Step 1: Install the plugin

From your site directory:

```bash
cd site
pnpm add -D vite-plugin-pwa
```

This adds `vite-plugin-pwa` to your site's `devDependencies`.

### Step 2: Configure it

Open `site/vite.config.js` and register the plugin:

```js
import { defineSiteConfig } from '@uniweb/build/site'
import { VitePWA } from 'vite-plugin-pwa'

export default defineSiteConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'My Site',
        short_name: 'MySite',
        description: 'A brief description of your site',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})
```

### Step 3: Add icons

Place your PWA icon files in `site/public/`:

```
site/
├── public/
│   ├── pwa-192x192.png
│   └── pwa-512x512.png
├── vite.config.js
└── ...
```

Files in `public/` are served at the site root. The manifest references them by filename.

### Step 4: Build and verify

```bash
pnpm build
pnpm preview
```

Open DevTools → Application → Manifest to confirm the manifest loaded. The Service Workers panel shows the registered worker. On a second visit, the site works offline.

### Customizing further

`vite-plugin-pwa` has options for workbox strategies (cache-first vs network-first), custom service worker code, and update prompts. See the [vite-plugin-pwa documentation](https://vite-pwa-org.netlify.app/) for the full API. Everything it supports works inside `defineSiteConfig()` — there's nothing Uniweb-specific to account for.

If your site uses a base path for subdirectory deployment (`base: /docs/` in `site.yml`), the plugin picks it up automatically from the Vite config. No extra configuration needed.

---

## Other Common Plugins

The same install-and-register pattern works for any Vite plugin. A few that site authors commonly reach for:

**Sitemap generation:**

```bash
cd site
pnpm add -D vite-plugin-sitemap
```

```js
import { defineSiteConfig } from '@uniweb/build/site'
import sitemap from 'vite-plugin-sitemap'

export default defineSiteConfig({
  plugins: [
    sitemap({ hostname: 'https://example.com' }),
  ],
})
```

**Compression (gzip/brotli):**

```bash
cd site
pnpm add -D vite-plugin-compression
```

```js
import { defineSiteConfig } from '@uniweb/build/site'
import compression from 'vite-plugin-compression'

export default defineSiteConfig({
  plugins: [compression()],
})
```

Each plugin's npm page or GitHub README explains its options. Install it, register it, done.

---

## Extensibility Layers

Vite plugins are one of several ways to extend a Uniweb site. Each layer solves a different kind of problem:

### Vite plugins — build-time site features

What you've seen above. Plugins run during the Vite build and can generate files, transform assets, inject HTML, and hook into the dev server. Use this for anything that's a build concern: PWA, sitemaps, compression, image optimization, bundle analysis, environment variable handling.

**Installed to:** site's `devDependencies`
**Configured in:** `site/vite.config.js`

### head.html — external scripts and tags

A `head.html` file in your site root injects raw HTML into every page's `<head>`. No bundling, no build step — the content is inserted as-is. Use this for third-party scripts that provide their own loading mechanism: analytics, chat widgets, consent banners, custom fonts, verification meta tags.

```html
<!-- site/head.html -->
<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>
<meta name="google-site-verification" content="..." />
```

**Installed to:** nothing — just a file
**Configured in:** `site/head.html`

### Extensions — additional section types

Extensions are secondary foundations loaded at runtime. They contribute section types that content authors can use in markdown, alongside the primary foundation's types. Use this when you want to add a pack of components (charts, effects, embeds) without modifying the primary foundation.

```yaml
# site/site.yml
extensions:
  - https://cdn.example.com/charts/foundation.js
```

Extensions can only add section types. They don't provide layouts, theme variables, or site-level behavior. They're structurally identical to foundations — same build, same output — but loaded as supplements.

**Installed to:** nothing — loaded by URL
**Configured in:** `site/site.yml`

### Foundation npm dependencies — libraries used by components

Components in your foundation can use any npm package. Charting libraries, animation frameworks, date utilities — install them in the foundation and import them in your components. They're bundled into `foundation.js` by Vite and tree-shaken per foundation.

```bash
cd foundation
pnpm add framer-motion
```

```jsx
// foundation/src/sections/AnimatedHero.jsx
import { motion } from 'framer-motion'

export default function AnimatedHero({ content }) {
  return (
    <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {content.title}
    </motion.h1>
  )
}
```

**Installed to:** foundation's `dependencies`
**Configured in:** nothing — standard imports

---

## Choosing the Right Layer

| You want to...                             | Use                           |
| ------------------------------------------ | ----------------------------- |
| Add offline support, generate sitemaps     | Vite plugin (site)            |
| Optimize images at build time              | Vite plugin (site)            |
| Add analytics or a chat widget             | head.html                     |
| Add a verification meta tag                | head.html                     |
| Use a third-party component pack           | Extension (site.yml)          |
| Use an animation library in components     | npm package (foundation)      |
| Use a data visualization library           | npm package (foundation)      |

The layers don't overlap much. Build-time features are Vite plugins. External scripts are head.html. Component libraries are foundation dependencies. Additional component packs from a URL are extensions.

---

## See Also

- [Site Configuration](../../docs/site-configuration.md) — full reference for `site.yml` and `head.html`
- [Building with Uniweb](./building-with-uniweb.md) — project structure and the site/foundation relationship
- [Foundation Categories](./foundation-categories.md) — how portable a foundation can be
