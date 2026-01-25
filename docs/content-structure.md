# Content Structure

This guide explains how markdown content is parsed and delivered to your components.

## The Basics

When you write markdown in a section file, the parser extracts semantic elements and organizes them into a structured object your component receives:

```markdown
---
type: Features
---

# Our Features

We built this for you.

### Fast
Lightning quick response times.

### Secure
Enterprise-grade security.

### Simple
No configuration required.
```

Your component receives:

```js
{
  title: "Our Features",
  paragraphs: ["We built this for you."],
  items: [
    { title: "Fast", paragraphs: ["Lightning quick response times."] },
    { title: "Secure", paragraphs: ["Enterprise-grade security."] },
    { title: "Simple", paragraphs: ["No configuration required."] }
  ]
}
```

## Content Fields

All content fields are available at the top level:

| Field | Source | Description |
|-------|--------|-------------|
| `title` | First heading | Main headline |
| `pretitle` | Heading before title | Eyebrow/kicker text |
| `subtitle` | Heading after title | Secondary headline |
| `subtitle2` | Third heading | Tertiary headline |
| `paragraphs` | Body text | Array of paragraph strings |
| `links` | `[text](url)` | Array of link objects (see below) |
| `imgs` | `![alt](url)` | Array of image objects |
| `icons` | `![](icon:url)` | Array of icon objects |
| `videos` | `![](url){role=video}` | Array of video objects |
| `lists` | `- item` | Bullet or numbered lists |
| `quotes` | `> text` | Blockquote content |
| `data` | Tagged code blocks | Structured data (see below) |
| `headings` | Overflow headings | Headings after title/subtitle/subtitle2 |
| `items` | Subsequent headings | Child content groups |
| `sequence` | All elements | Ordered array for document-order rendering |

## Attribute Syntax

Both links and media (images, videos, icons) support attributes using curly braces after the element:

```markdown
[text](url){attributes}
![alt](url){attributes}
```

### Attribute Types

| Syntax | Result | Example |
|--------|--------|---------|
| `key=value` | Named attribute | `width=800` |
| `key="value"` | Quoted value (allows spaces) | `alt="My image"` |
| `.className` | CSS class | `.featured` |
| `#idName` | Element ID | `#hero-image` |
| `booleanKey` | Boolean true | `autoplay` |

```markdown
![Hero](./hero.jpg){role=banner width=1200 .featured #main-hero loading=lazy}
```

Attributes can appear in any order.

## Asset Paths

Assets (images, videos, PDFs) can be referenced using several path formats:

### Relative Paths

Paths relative to the markdown file:

```markdown
![Photo](./photo.jpg)           <!-- Same folder as the markdown file -->
![Logo](../shared/logo.svg)     <!-- Parent folder -->
![Team](./images/team.jpg)      <!-- Subfolder -->
```

### Absolute Paths (Site Root)

Paths starting with `/` are resolved from the site's `public/` or `assets/` folder:

```markdown
![Hero](/images/hero.jpg)       <!-- public/images/hero.jpg or assets/images/hero.jpg -->
![Logo](/brand/logo.svg)        <!-- public/brand/logo.svg -->
```

The build system checks `public/` first, then `assets/`.

### External URLs

External URLs are passed through unchanged:

```markdown
![External](https://example.com/image.jpg)
```

## Build Optimizations

During build, local assets are automatically processed:

### Image Optimization

- **PNG, JPG, JPEG, GIF** → Converted to WebP for smaller file sizes
- **SVG, WebP, AVIF** → Passed through unchanged
- All images get content-hashed filenames for cache busting

```markdown
![Photo](./photo.jpg)
<!-- Output: /assets/photo-a1b2c3d4.webp -->
```

### Automatic Poster Generation

Videos without an explicit `poster` attribute get an auto-generated poster image (requires ffmpeg on your system):

```markdown
![Demo](./demo.mp4){role=video}
<!-- Auto-generates: /assets/demo-poster-a1b2c3d4.webp -->
```

To use your own poster, specify it explicitly:

```markdown
![Demo](./demo.mp4){role=video poster=./custom-poster.jpg}
```

### Automatic PDF Previews

PDFs without an explicit `preview` attribute get an auto-generated preview thumbnail (requires pdf-lib):

```markdown
![Report](./report.pdf)
<!-- Auto-generates: /assets/report-thumb-a1b2c3d4.webp -->
```

To use your own preview, specify it explicitly:

```markdown
![Report](./report.pdf){preview=./report-cover.jpg}
```

## Media Assets: Images, Videos, and Icons

Media uses the standard image syntax `![alt](url)` but the `role` attribute determines which content array it goes into:

| Role | Output Array | Use Case |
|------|--------------|----------|
| `image` (default) | `imgs` | Content images |
| `banner` | `imgs` | Hero/banner images |
| `gallery` | `imgs` | Gallery images |
| `background` | `imgs` | Background images |
| `icon` | `icons` | Icons and small graphics |
| `video` | `videos` | Video content |

### Setting the Role

There are two ways to set the role:

**1. Prefix syntax (legacy):**
```markdown
![Logo](icon:./logo.svg)
![Demo](video:./demo.mp4)
```

**2. Attribute syntax (recommended):**
```markdown
![Logo](./logo.svg){role=icon}
![Demo](./demo.mp4){role=video}
![Hero](./hero.jpg){role=banner}
```

The attribute syntax is more flexible—it allows combining role with other attributes:

```markdown
![Demo](./demo.mp4){role=video autoplay muted loop poster=./poster.jpg}
```

### Image Attributes

```markdown
![Alt text](./image.jpg){width=800 height=600 loading=lazy fit=cover}
```

| Attribute | Description |
|-----------|-------------|
| `width` | Image width |
| `height` | Image height |
| `loading` | `lazy` or `eager` |
| `fit` | CSS object-fit: `cover`, `contain`, etc. |
| `position` | CSS object-position |

### Video Attributes

```markdown
![Demo](./video.mp4){role=video autoplay muted loop controls poster=./thumb.jpg}
```

| Attribute | Description |
|-----------|-------------|
| `autoplay` | Auto-play on load |
| `muted` | Start muted |
| `loop` | Loop playback |
| `controls` | Show video controls |
| `poster` | Poster/thumbnail image |

### Clickable Images and Videos

Images and videos can be links—clicking them navigates to the specified URL:

```markdown
![Product Screenshot](./screenshot.jpg){href=/products/details}
![Demo Video](./demo.mp4){role=video href=/demo target=_blank}
```

```js
imgs: [{ url: "./screenshot.jpg", alt: "Product Screenshot", href: "/products/details" }]
videos: [{ src: "./demo.mp4", href: "/demo", target: "_blank" }]
```

Components can wrap the media in a link element when `href` is present:

```jsx
function Image({ src, alt, href, target }) {
  const img = <img src={src} alt={alt} />
  return href ? <a href={href} target={target}>{img}</a> : img
}
```

## Links and Buttons

Links are collected in the `links` array. Attributes control behavior and styling.

### Basic Links

```markdown
[Learn more](/about)
[External](https://example.com){target=_blank}
[Download](./report.pdf){download}
[Download as](./report.pdf){download="annual-report.pdf"}
```

| Attribute | Description |
|-----------|-------------|
| `target` | `_blank`, `_self`, etc. |
| `rel` | `noopener`, `noreferrer`, etc. |
| `download` | Make it a download link |

### Link Detection

The parser intelligently handles links based on context:

**Links in text** stay as paragraphs with inline HTML:

```markdown
Visit our [about page](/about) to learn more.
```

```js
paragraphs: ["Visit our <a href=\"/about\">about page</a> to learn more."]
```

**Link-only paragraphs** become link objects—useful for CTAs and navigation:

```markdown
[Get Started](/signup)
```

```js
links: [{ href: "/signup", label: "Get Started" }]
```

**Multiple links on consecutive lines** split into separate link objects:

```markdown
[Home](/)
[About](/about)
[Contact](/contact)
```

```js
links: [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" }
]
```

This makes it easy to create button groups or nav links without special syntax.

### Links with Icons

When a link-only paragraph contains an adjacent icon, the parser associates them:

```markdown
![](/icons/home.svg){role=icon} [Home](/)
```

```js
links: [{
  href: "/",
  label: "Home",
  iconBefore: { url: "/icons/home.svg" },
  iconAfter: null
}]
```

Icons can appear before or after the link text:

```markdown
[External Link](https://example.com) ![](/icons/external.svg){role=icon}
```

```js
links: [{
  href: "https://example.com",
  label: "External Link",
  iconBefore: null,
  iconAfter: { url: "/icons/external.svg" }
}]
```

**Note:** Icon association only works for single-link paragraphs where the relationship is unambiguous. In paragraphs with multiple links, icons are collected separately in the `icons` array.

### Clickable Icons

Icons can be links themselves—useful for social media buttons and icon-only navigation:

```markdown
![Twitter](/icons/twitter.svg){role=icon href="https://twitter.com/example" target=_blank}
![GitHub](/icons/github.svg){role=icon href="https://github.com/example" target=_blank}
```

```js
icons: [
  { url: "/icons/twitter.svg", href: "https://twitter.com/example", target: "_blank" },
  { url: "/icons/github.svg", href: "https://github.com/example", target: "_blank" }
]
```

Components can check `icon.href` to render clickable icons differently from decorative ones.

### Creating Buttons

Links become buttons with a `role` attribute or the `.button` class:

**Prefix syntax:**
```markdown
[Get Started](button:/signup)
```

**Class syntax:**
```markdown
[Get Started](/signup){.button}
[Secondary](/learn){.button variant=secondary}
```

**Attribute syntax:**
```markdown
[Get Started](/signup){role=button variant=primary size=lg}
```

### Button Attributes

| Attribute | Values | Description |
|-----------|--------|-------------|
| `variant` | `primary`, `secondary`, `outline`, `ghost` | Visual style |
| `size` | `sm`, `md`, `lg` | Button size |
| `icon` | Icon name | Icon to display |

### Link Roles

The `role` attribute distinguishes link types in your component:

```js
const { links } = content

links.forEach(link => {
  console.log(link.role)  // "link", "button", "button-primary", "document"
  console.log(link.href)
  console.log(link.label)
})

// Filter by role
const buttons = links.filter(l => l.role?.startsWith('button'))
const downloads = links.filter(l => l.role === 'document')
```

File links (`.pdf`, `.doc`, etc.) automatically get `role: "document"` and `download: true`.

## Document-Order Rendering with Sequence

While most components use the semantic fields (`title`, `paragraphs`, `items`), some components need to render content in exact document order—like an Article or Blog Post component.

The `sequence` array provides all elements in their original order:

```js
const { sequence } = content

sequence.forEach(element => {
  switch (element.type) {
    case 'heading':
      return <Heading level={element.level}>{element.text}</Heading>
    case 'paragraph':
      return <Paragraph html={element.text} />
    case 'image':
      return <Image src={element.attrs.src} alt={element.attrs.alt} />
    case 'list':
      return <List items={element.children} style={element.style} />
    case 'blockquote':
      return <Blockquote>{element.children}</Blockquote>
    case 'codeBlock':
      return <CodeBlock language={element.attrs.language}>{element.text}</CodeBlock>
    // ... other types
  }
})
```

**When to use which:**

| Approach | Use Case | Example Components |
|----------|----------|-------------------|
| Semantic fields | Structured layouts with specific slots | Hero, Features, Pricing, Team |
| `sequence` | Document-order flow | Article, Blog Post, Documentation |

You can also combine both—use semantic fields for the header area and sequence for the body.

## Semantic Heading Interpretation

**Important:** Heading levels in markdown are *relative*, not absolute. A `#` (H1) in your markdown doesn't necessarily become an `<h1>` in the final HTML.

The parser interprets headings based on their *relationship* to each other:

```markdown
## Welcome          ← This becomes `title` (it's the first/main heading)
### Getting Started ← This becomes `subtitle` (it's after the title)

Some content here.

### Features        ← This starts an `item` (heading after content)
```

The same semantic structure can be expressed with different heading levels:

```markdown
# Welcome           ← title
## Getting Started  ← subtitle
```

or:

```markdown
### Welcome         ← title
#### Getting Started ← subtitle
```

Both produce the same `content.title` and `content.subtitle`. The component decides what HTML elements to use. A hero component might render `title` as `<h1>`, while a card component might render it as `<h3>`.

### Pretitle Detection

Any heading followed by a *more important* heading automatically becomes a pretitle:

```markdown
### Welcome to       ← pretitle (H3 before H1)
# Acme Corp          ← title
## Build faster      ← subtitle
```

This works at any level:
- H3 → H1 = pretitle
- H2 → H1 = pretitle
- H4 → H2 = pretitle
- H6 → H5 = pretitle

No special syntax needed—the parser detects it automatically.

## Items: Child Content Groups

The `items` array contains child content groups. A new item starts whenever a heading appears after other content (paragraphs, images, etc.). Each item has the same field structure as the main content.

Use items when your component displays repeating content—feature cards, pricing tiers, team members, FAQ questions.

**Convention:** Use a higher-level heading for the main title and lower-level headings for items. This makes the structure clear, but the parser is flexible—any heading after content starts a new item.

```markdown
# Pricing

Choose your plan.

### Starter
$9/month

Perfect for individuals.

[Get Started](/signup?plan=starter){.button}

### Pro
$29/month

For growing teams.

[Get Started](/signup?plan=pro){.button variant=primary}
```

```js
// In your Pricing component
const { title, paragraphs, items } = content

items.forEach(tier => {
  console.log(tier.title)       // "Starter", "Pro"
  console.log(tier.paragraphs)  // ["$9/month", "Perfect for..."], ...
  console.log(tier.links)       // [{ href: "/signup?plan=starter", role: "button", ... }]
})
```

## Structured Data

Use tagged code blocks to pass structured data to components:

````markdown
```yaml:form
fields:
  - name: email
    type: email
    required: true
  - name: message
    type: textarea
submitLabel: Send Message
```
````

The tag (after the colon) routes parsed data to `content.data`:

```js
const formConfig = content.data?.form || {}
// { fields: [...], submitLabel: "Send Message" }
```

**Supported formats:**
- `json:tag-name` — Parsed as JSON
- `yaml:tag-name` — Parsed as YAML

**Untagged code blocks** are not parsed—they stay as display-only code in the content sequence.

## Dividers as Separators

You can also use horizontal rules (`---`) to separate items instead of headings:

```markdown
# Team

---

![](/sarah.jpg)

**Sarah Chen**

Lead Engineer

---

![](/alex.jpg)

**Alex Rivera**

Designer
```

This creates two items without requiring headings for each.

## Runtime Guarantees

The runtime guarantees all fields exist—you don't need defensive null checks:

```js
// These are always defined (empty string/array if not in content)
const { title, paragraphs, links, imgs, items, data } = content

// Safe to use directly
paragraphs.forEach(p => console.log(p))
items.map(item => <Card {...item} />)
```

## Items vs Subsections

There are two ways to create nested content:

| Approach | When to use |
|----------|-------------|
| **Items** (headings in one file) | Repeating content within a single section |
| **Subsections** (separate files) | When children need their own component types |

Prefer items when possible—they're simpler for content authors. Use subsections when children are complex enough to warrant their own component selection.

## See Also

- [Page Configuration](./page-configuration.md) — page.yml options for sections and ordering
- [Navigation Patterns](./navigation-patterns.md) — Building navbars, menus, and sidebars
- [Linking](./linking.md) — The `page:` protocol for stable internal links
- [Component Metadata](./component-metadata.md) — Documenting what content your component expects
