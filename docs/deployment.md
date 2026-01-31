# Deployment

Deploy your Uniweb site to any static hosting platform.

## Build for Production

```bash
pnpm build
```

This produces:

```
site/dist/
├── index.html
├── about.html
├── docs/
│   └── getting-started.html
├── assets/
│   ├── index-[hash].js
│   └── index-[hash].css
└── search-index.json
```

The `dist/` folder is a complete static site ready to deploy.

---

## Pre-rendering (SSG)

For static HTML at build time, enable pre-rendering in `site.yml`:

```yaml
build:
  prerender: true
```

**Benefits:**
- Fast initial page loads
- SEO-friendly (content in HTML)
- Works without JavaScript
- Cacheable at CDN edge

**Without pre-rendering:**
- Single `index.html` with client-side rendering
- JavaScript loads and renders content
- Smaller initial bundle

Most sites should enable pre-rendering.

---

## Vercel

### Via CLI

```bash
cd site
npx vercel
```

Follow the prompts. Vercel auto-detects the Vite configuration.

### Via Git Integration

1. Push your repo to GitHub/GitLab/Bitbucket
2. Import in [vercel.com/new](https://vercel.com/new)
3. Set root directory to `site`
4. Deploy

**Build settings (auto-detected):**
- Build Command: `pnpm build`
- Output Directory: `dist`
- Install Command: `pnpm install`

### vercel.json (optional)

```json
{
  "buildCommand": "cd .. && pnpm build",
  "outputDirectory": "dist"
}
```

---

## Netlify

### Via CLI

```bash
cd site
npx netlify deploy --prod --dir=dist
```

### Via Git Integration

1. Push your repo to GitHub/GitLab/Bitbucket
2. Import in [app.netlify.com](https://app.netlify.com)
3. Configure:
   - Base directory: `site`
   - Build command: `pnpm build`
   - Publish directory: `site/dist`

### netlify.toml

```toml
[build]
  base = "site"
  command = "pnpm build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

The redirect handles client-side routing for non-prerendered pages.

---

## Cloudflare Pages

### Via Dashboard

1. Connect your repository
2. Configure:
   - Build command: `cd site && pnpm build`
   - Build output directory: `site/dist`

### Via Wrangler

```bash
cd site
npx wrangler pages deploy dist
```

---

## GitHub Pages

### Manual Deploy

```bash
cd site
pnpm build
npx gh-pages -d dist
```

### GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install
      - run: pnpm build

      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./site/dist
```

**Note:** For project sites (not `username.github.io`), set the base path in `vite.config.js`:

```js
export default defineConfig({
  base: '/repo-name/',
  // ...
})
```

---

## AWS S3 + CloudFront

### Upload to S3

```bash
cd site
pnpm build
aws s3 sync dist/ s3://your-bucket-name --delete
```

### CloudFront Invalidation

```bash
aws cloudfront create-invalidation \
  --distribution-id YOUR_DIST_ID \
  --paths "/*"
```

### S3 Static Website Settings

- Index document: `index.html`
- Error document: `index.html` (for SPA routing)

---

## Docker / Self-Hosted

### Nginx

```dockerfile
FROM nginx:alpine
COPY site/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

```nginx
# nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Build and run:

```bash
docker build -t my-site .
docker run -p 8080:80 my-site
```

### Node.js (Express)

```js
import express from 'express'
import { resolve } from 'path'

const app = express()
const dist = resolve('site/dist')

app.use(express.static(dist))

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(resolve(dist, 'index.html'))
})

app.listen(3000)
```

---

## Environment Variables

For build-time configuration, use Vite's env variables:

```bash
# .env.production
VITE_API_URL=https://api.example.com
VITE_ANALYTICS_ID=UA-XXXXX
```

Access in code:

```js
const apiUrl = import.meta.env.VITE_API_URL
```

**Note:** Only variables prefixed with `VITE_` are exposed to the client.

---

## Build Optimization

### Analyze Bundle

```bash
cd site
pnpm build -- --analyze
```

### Compression

Most platforms handle compression automatically. For self-hosted:

```bash
# Pre-compress assets
gzip -k dist/assets/*.js
brotli dist/assets/*.js
```

Configure your server to serve `.gz` or `.br` files when available.

---

## Troubleshooting

### 404 on Page Refresh

**Problem:** Direct URL access returns 404.

**Solution:** Configure your host to serve `index.html` for unknown routes (SPA fallback), or enable pre-rendering so actual HTML files exist.

### Missing Assets

**Problem:** JS/CSS files not loading.

**Solution:** Check the `base` path in `vite.config.js` matches your deployment path.

### Slow Initial Load

**Problem:** Large JavaScript bundle.

**Solution:**
1. Enable pre-rendering for static HTML
2. Check bundle size with `--analyze`
3. Lazy-load heavy components

---

## Publishing a Foundation

Foundations are portable — you can publish them for other sites to consume.

### To npm

```bash
cd foundation
uniweb build
npm publish
```

Other projects can then install your foundation as a dependency:

```bash
pnpm add @acme/foundation
```

### To uniweb.app

For use with platform-managed sites and visual editing:

```bash
uniweb login          # First time only
uniweb build
uniweb publish
```

Sites control their own update strategy — automatic, minor-only, patch-only, or pinned to a specific version.

---

## See Also

- [CLI Commands](./cli-commands.md) — Build command options
- [Site Configuration](./site-configuration.md) — Pre-render settings
- [Templates](./templates.md) — Project templates
