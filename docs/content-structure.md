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

| Field        | Source                 | Description                                |
| ------------ | ---------------------- | ------------------------------------------ |
| `title`      | First heading          | Main headline                              |
| `pretitle`   | Heading before title   | Eyebrow/kicker text                        |
| `subtitle`   | Heading after title    | Secondary headline                         |
| `subtitle2`  | Third heading          | Tertiary headline                          |
| `paragraphs` | Body text              | Array of paragraph strings                 |
| `links`      | `[text](url)`          | Array of link objects (see below)          |
| `imgs`       | `![alt](url)`          | Array of image objects                     |
| `icons`      | `![](icon:url)`        | Array of icon objects                      |
| `videos`     | `![](url){role=video}` | Array of video objects                     |
| `lists`      | `- item`               | Bullet or numbered lists                   |
| `quotes`     | `> text`               | Blockquote content                         |
| `data`       | Tagged code blocks     | Structured data (see below)                |
| `headings`   | Overflow headings      | Headings after title/subtitle/subtitle2    |
| `items`      | Subsequent headings    | Child content groups                       |
| `sequence`   | All elements           | Ordered array for document-order rendering |

## Attribute Syntax

Both links and media (images, videos, icons) support attributes using curly braces after the element:

```markdown
[text](url){attributes}
![alt](url){attributes}
```

### Attribute Types

| Syntax        | Result                       | Example          |
| ------------- | ---------------------------- | ---------------- |
| `key=value`   | Named attribute              | `width=800`      |
| `key="value"` | Quoted value (allows spaces) | `alt="My image"` |
| `.className`  | CSS class                    | `.featured`      |
| `#idName`     | Element ID                   | `#hero-image`    |
| `booleanKey`  | Boolean true                 | `autoplay`       |

```markdown
![Hero](./hero.jpg){role=banner width=1200 .featured #main-hero loading=lazy}
```

Attributes can appear in any order.

## Asset Paths

Assets (images, videos, PDFs) can be referenced using several path formats:

### Relative Paths

Paths relative to the markdown file:

```markdown
![Photo](./photo.jpg) <!-- Same folder as the markdown file -->
![Logo](../shared/logo.svg) <!-- Parent folder -->
![Team](./images/team.jpg) <!-- Subfolder -->
```

### Absolute Paths (Site Root)

Paths starting with `/` are resolved from the site's `public/` or `assets/` folder:

```markdown
![Hero](/images/hero.jpg) <!-- public/images/hero.jpg or assets/images/hero.jpg -->
![Logo](/brand/logo.svg) <!-- public/brand/logo.svg -->
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

| Role              | Output Array | Use Case                 |
| ----------------- | ------------ | ------------------------ |
| `image` (default) | `imgs`       | Content images           |
| `banner`          | `imgs`       | Hero/banner images       |
| `gallery`         | `imgs`       | Gallery images           |
| `background`      | `imgs`       | Background images        |
| `icon`            | `icons`      | Icons and small graphics |
| `video`           | `videos`     | Video content            |

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

| Attribute  | Description                              |
| ---------- | ---------------------------------------- |
| `width`    | Image width                              |
| `height`   | Image height                             |
| `loading`  | `lazy` or `eager`                        |
| `fit`      | CSS object-fit: `cover`, `contain`, etc. |
| `position` | CSS object-position                      |

### Video Attributes

```markdown
![Demo](./video.mp4){role=video autoplay muted loop controls poster=./thumb.jpg}
```

| Attribute  | Description            |
| ---------- | ---------------------- |
| `autoplay` | Auto-play on load      |
| `muted`    | Start muted            |
| `loop`     | Loop playback          |
| `controls` | Show video controls    |
| `poster`   | Poster/thumbnail image |

### Icons

Icons can be referenced in three ways:

**1. URL-based icons (any SVG file):**

```markdown
![Logo](./logo.svg){role=icon}
![Logo](icon:./logo.svg)
```

**2. Named icons from icon libraries:**

```markdown
![check](lucide:check)
![arrow](lucide:arrow-right){size=20}
![heart](lucide:heart){size=24 color=red}
```

Supported icon library prefixes (browse icons visually at [react-icons.github.io/react-icons](https://react-icons.github.io/react-icons/)):

| Prefix (friendly name) | Short code | Library |
| ---------------------- | ---------- | ------- |
| `lucide:` | `lu` | [Lucide](https://lucide.dev) |
| `heroicons:` | `hi` | [Heroicons v1](https://heroicons.com) |
| `heroicons2:` | `hi2` | [Heroicons v2](https://heroicons.com) |
| `feather:` | `fi` | [Feather](https://feathericons.com) |
| `phosphor:` | `pi` | [Phosphor](https://phosphoricons.com) |
| `tabler:` | `tb` | [Tabler Icons](https://tabler-icons.io) |
| `bootstrap:` | `bs` | [Bootstrap Icons](https://icons.getbootstrap.com) |
| `material-design:` | `md` | [Material Design](https://fonts.google.com/icons) |
| `ant-design:` | `ai` | [Ant Design Icons](https://ant.design/components/icon/) |
| `remix:` | `ri` | [Remix Icon](https://remixicon.com) |
| `simple-icons:` | `si` | [Simple Icons](https://simpleicons.org) |
| `ionicons:` | `io5` | [Ionicons 5](https://ionicons.com) |
| `boxicons:` | `bi` | [Boxicons](https://boxicons.com) |
| `vscode:` | `vsc` | [VS Code Codicons](https://github.com/microsoft/vscode-codicons) |
| `weather:` | `wi` | [Weather Icons](https://erikflowers.github.io/weather-icons/) |
| `game:` | `gi` | [Game Icons](https://game-icons.net) |
| `fa:` / `fa6:` | `fa` / `fa6` | [Font Awesome 5 & 6](https://fontawesome.com) |

**Icon attributes:**

| Attribute | Description |
| --------- | ----------- |
| `size` | Icon size in pixels (default: 24) |
| `color` | Icon color (CSS color value) |

**Important:** Named icons require foundation support. The foundation must include the icon library to render named icons. See [Foundation Configuration](./foundation-configuration.md#icon-libraries) for setup instructions.

If your foundation doesn't include an icon library, use URL-based icons instead:

```markdown
![check](/icons/check.svg){role=icon}
```

### Clickable Images and Videos

Images and videos can be links—clicking them navigates to the specified URL:

```markdown
![Product Screenshot](./screenshot.jpg){href=/products/details}
![Demo Video](./demo.mp4){role=video href=/demo target=\_blank}
```

```js
imgs: [
  {
    url: './screenshot.jpg',
    alt: 'Product Screenshot',
    href: '/products/details',
  },
]
videos: [{ src: './demo.mp4', href: '/demo', target: '_blank' }]
```

Components can wrap the media in a link element when `href` is present:

```jsx
function Image({ src, alt, href, target }) {
  const img = <img src={src} alt={alt} />
  return href ? (
    <a href={href} target={target}>
      {img}
    </a>
  ) : (
    img
  )
}
```

## Inline Text Styling

Style inline text with semantic classes using bracketed spans—Pandoc-style syntax that works in both markdown files and the visual editor.

### Basic Syntax

```markdown
[text]{.class}
[text]{#id}
[text]{.class #id key=value}
```

### Common Styles

```markdown
This has [highlighted text]{.highlight} for emphasis.

Here's a [muted note]{.muted} that's less prominent.

This is a [callout]{.callout} for important info.
```

Your component receives these as `<span>` elements in paragraph text:

```js
paragraphs: [
  'This has <span class="highlight">highlighted text</span> for emphasis.',
]
```

### Multiple Classes and Attributes

```markdown
[styled text]{.highlight .large}
[anchor point]{#section-start}
[tooltip text]{.info data-tooltip="More details here"}
```

### Combining with Other Formatting

Spans work with bold, italic, and other inline formatting:

```markdown
This is [**bold and highlighted**]{.highlight} text.
Check the [_italicized note_]{.muted} below.
```

### Use Cases

| Class        | Purpose                                             |
| ------------ | --------------------------------------------------- |
| `.highlight` | Draw attention to key phrases                       |
| `.muted`     | De-emphasize secondary information                  |
| `.callout`   | Important notes or warnings                         |
| `.code`      | Inline code-like styling (alternative to backticks) |

Your foundation defines what classes are available and how they're styled. The visual editor can provide a dropdown of predefined styles.

## Links and Buttons

Links are collected in the `links` array. Attributes control behavior and styling.

### Basic Links

```markdown
[Learn more](/about)
[External](https://example.com){target=\_blank}
[Download](./report.pdf){download}
[Download as](./report.pdf){download="annual-report.pdf"}
```

| Attribute  | Description                    |
| ---------- | ------------------------------ |
| `target`   | `_blank`, `_self`, etc.        |
| `rel`      | `noopener`, `noreferrer`, etc. |
| `download` | Make it a download link        |

### Link Detection

The parser intelligently handles links based on context:

**Links in text** stay as paragraphs with inline HTML:

```markdown
Visit our [about page](/about) to learn more.
```

```js
paragraphs: ['Visit our <a href="/about">about page</a> to learn more.']
```

**Link-only paragraphs** become link objects—useful for CTAs and navigation:

```markdown
[Get Started](/signup)
```

```js
links: [{ href: '/signup', label: 'Get Started' }]
```

**Multiple links on consecutive lines** split into separate link objects:

```markdown
[Home](/)
[About](/about)
[Contact](/contact)
```

```js
links: [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
]
```

This makes it easy to create button groups or nav links without special syntax.

### Links with Icons

When a link-only paragraph contains an adjacent icon, the parser associates them:

```markdown
![](/icons/home.svg){role=icon} [Home](/)
```

```js
links: [
  {
    href: '/',
    label: 'Home',
    iconBefore: { url: '/icons/home.svg' },
    iconAfter: null,
  },
]
```

Icons can appear before or after the link text:

```markdown
[External Link](https://example.com) ![](/icons/external.svg){role=icon}
```

```js
links: [
  {
    href: 'https://example.com',
    label: 'External Link',
    iconBefore: null,
    iconAfter: { url: '/icons/external.svg' },
  },
]
```

**Note:** Icon association only works for single-link paragraphs where the relationship is unambiguous. In paragraphs with multiple links, icons are collected separately in the `icons` array.

### Clickable Icons

Icons can be links themselves—useful for social media buttons and icon-only navigation:

```markdown
![Twitter](/icons/twitter.svg){role=icon href="https://twitter.com/example" target=\_blank}
![GitHub](/icons/github.svg){role=icon href="https://github.com/example" target=\_blank}
```

```js
icons: [
  {
    url: '/icons/twitter.svg',
    href: 'https://twitter.com/example',
    target: '_blank',
  },
  {
    url: '/icons/github.svg',
    href: 'https://github.com/example',
    target: '_blank',
  },
]
```

Components can check `icon.href` to render clickable icons differently from decorative ones.

### Link Attributes

Links can include optional attributes that components may use as rendering hints:

```markdown
[Get Started](/signup){variant=primary size=lg}
[Learn More](/docs){target=_blank}
[Download PDF](/file.pdf)
```

**Available attributes:**

| Attribute | Values                                     | Description                |
| --------- | ------------------------------------------ | -------------------------- |
| `role`    | Any string (e.g., `button`, `nav`)         | Hint for component styling |
| `variant` | `primary`, `secondary`, `outline`, `ghost` | Visual style hint          |
| `size`    | `sm`, `md`, `lg`                           | Size hint                  |
| `target`  | `_blank`, `_self`, etc.                    | Link target                |

**Important:** These attributes are hints—components decide how to render links. A Hero component might render all links as buttons regardless of attributes, while a Footer component might render them as plain links.

### Link Types

Components receive all links in the `content.links` array:

```js
const { links } = content

links.forEach((link) => {
  console.log(link.href)
  console.log(link.label)
  console.log(link.role)     // Optional hint from author
  console.log(link.variant)  // Optional styling hint
  console.log(link.target)   // Link target
})
```

File links (`.pdf`, `.doc`, etc.) automatically include `download: true` for browser handling.

## Document-Order Rendering with Sequence

While most components use the semantic fields (`title`, `paragraphs`, `items`), some components need to render content in exact document order—like an Article or Blog Post component.

The `sequence` array provides all elements in their original order:

```js
const { sequence } = content

sequence.forEach((element) => {
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
      return (
        <CodeBlock language={element.attrs.language}>{element.text}</CodeBlock>
      )
    // ... other types
  }
})
```

**When to use which:**

| Approach        | Use Case                               | Example Components                |
| --------------- | -------------------------------------- | --------------------------------- |
| Semantic fields | Structured layouts with specific slots | Hero, Features, Pricing, Team     |
| `sequence`      | Document-order flow                    | Article, Blog Post, Documentation |

You can also combine both—use semantic fields for the header area and sequence for the body.

## Semantic Heading Interpretation

**Important:** Heading levels in markdown are _relative_, not absolute. A `#` (H1) in your markdown doesn't necessarily become an `<h1>` in the final HTML.

The parser interprets headings based on their _relationship_ to each other:

```markdown
## Welcome ← This becomes `title` (it's the first/main heading)

### Getting Started ← This becomes `subtitle` (it's after the title)

Some content here.

### Features ← This starts an `item` (heading after content)
```

The same semantic structure can be expressed with different heading levels:

```markdown
# Welcome ← title

## Getting Started ← subtitle
```

or:

```markdown
### Welcome ← title

#### Getting Started ← subtitle
```

Both produce the same `content.title` and `content.subtitle`. The component decides what HTML elements to use. A hero component might render `title` as `<h1>`, while a card component might render it as `<h3>`.

### Pretitle Detection

Any heading followed by a _more important_ heading automatically becomes a pretitle:

```markdown
### Welcome to ← pretitle (H3 before H1)

# Acme Corp ← title

## Build faster ← subtitle
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

items.forEach((tier) => {
  console.log(tier.title) // "Starter", "Pro"
  console.log(tier.paragraphs) // ["$9/month", "Perfect for..."], ...
  console.log(tier.links) // [{ href: "/signup?plan=starter", role: "button", ... }]
})
```

## Lists

The `lists` field contains markdown bullet or numbered lists. Each list is an array of list items, and each list item has the same structure as content (paragraphs, links, nested lists, etc.):

```markdown
- First item with **bold** text
- Second item with a [link](/path)
  - Nested item
- Third item
```

```js
// lists is an array of lists (usually just one)
// Each list is an array of list items
// Each list item has: paragraphs, links, lists (nested), etc.

const { lists } = content

lists[0].forEach((item) => {
  console.log(item.paragraphs) // ["First item with <strong>bold</strong> text"]
  console.log(item.links) // [{ href: "/path", label: "link" }] for second item
  console.log(item.lists) // Nested lists array (for items with sub-lists)
})
```

**Structure:**

```
lists: [                           // Array of lists in the content
  [                                // First list (array of list items)
    {                              // First list item
      paragraphs: string[],
      links: Link[],
      lists: [...],                // Nested sub-lists
      ...                          // Same fields as content
    },
    ...
  ]
]
```

**Important:** List items are _not_ plain strings. They're objects with the same structure as content, allowing rich formatting, links, and nested lists within each item.

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

For structured data served as JSON collections (blog posts, team members, events), see [Content Collections](./content-collections.md). That guide covers markdown collections (`.md` for rich content, `.yml` for pure data), static JSON files, and runtime data — including how to choose the right approach for i18n.

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
paragraphs.forEach((p) => console.log(p))
items.map((item) => <Card {...item} />)
```

## Nesting: Items, Subsections, and Child Pages

There are three ways to create nested content, each for a different purpose:

| Approach        | What it is                                     | When to use                                                 |
| --------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| **Items**       | Headings in one markdown file                  | Repeating content within a single section (cards, features) |
| **Subsections** | Separate section files in the same page folder | Complex sections needing their own component type           |
| **Child pages** | Subfolders in `pages/`                         | Separate pages with their own routes                        |

### Items (same section)

Use items for repeating content that shares the same component—feature cards, pricing tiers, FAQ questions. Just use headings after content in your markdown file.

### Subsections (same page, different sections)

Use subsections when one page needs multiple sections with different component types. Create separate markdown files in the page folder:

```
pages/home/
├── page.yml
├── 1-hero.md        # type: Hero
├── 2-features.md    # type: Features
└── 3-cta.md         # type: CallToAction
```

Each section file can specify its own `type:` in frontmatter. The parent component renders child sections using `block.childBlocks`.

### Child pages (separate routes)

Subfolders create entirely separate pages with their own routes:

```
pages/
├── docs/            → /docs
│   ├── page.yml
│   ├── intro.md
│   ├── getting-started/   → /docs/getting-started
│   │   └── ...
│   └── api/               → /docs/api
│       └── ...
└── about/           → /about
```

**Key point:** Each folder is its own page with its own route. Parent and child folders don't conflict—`/docs` and `/docs/getting-started` are separate pages that both exist.

The `index:` setting in `site.yml` only controls which page becomes the root `/` route—it doesn't affect other pages or create any "container" behavior.

> **Note for developers coming from other site frameworks:**
> Uniweb treats every page folder as a distinct route. Nested pages do **not** replace or "take over" their parent folder.
>
> - `/docs` builds to `dist/docs/index.html` _(when prerendering is enabled)_
> - `/docs/getting-started` builds to `dist/docs/getting-started/index.html`
>
> Both pages exist independently—no conflict, no overwriting.

## How Attributes Reach Components

Attributes written in markdown flow through the entire pipeline without filtering. Understanding how they arrive helps you decide what to use and what to ignore.

### Two Channels

Attributes reach components through two distinct channels depending on the content type:

**1. Object properties** — on `imgs[]`, `links[]`, `icons[]`

When a content author writes `![Logo](./logo.svg){role=icon color=red}`, the parser extracts attributes into an object. Your component receives:

```js
content.icons[0]
// { library: undefined, name: undefined, src: './logo.svg', role: 'icon', color: 'red' }
```

Kit components like `<Icon>`, `<Link>`, and `<Image>` destructure the properties they understand and spread the rest onto the DOM element via `...props`. So `color=red` becomes an HTML attribute on the `<svg>`.

**2. Inline HTML** — in `title`, `paragraphs[]`, `items[].title`, etc.

When attributes appear on inline text or within paragraph content, they're serialized as HTML before reaching the component. For example:

```markdown
This has [important]{.callout color=red} information.
```

Your component receives:

```js
content.paragraphs[0]
// 'This has <span class="callout" style="color: red;">important</span> information.'
```

Kit's `<Text>`, `<H1>`, `<H2>`, and `<P>` components render these strings with `dangerouslySetInnerHTML`, so the span and its attributes appear in the DOM as-is.

### What Survives the Pipeline

Nothing is filtered. Every attribute the content author writes reaches the component:

| Stage | What happens |
|-------|-------------|
| **Markdown** | `{key=value .class #id}` parsed into object |
| **Content reader** | Stored in ProseMirror node attrs |
| **Semantic parser** | Spread onto content objects (imgs, links) or serialized as HTML (text) |
| **prepare-props** | Passed through — only guarantees structure, doesn't filter |
| **Component** | Receives everything — decides what to use |

Known attributes like `width`, `height`, `loading`, `target`, `role` are extracted by name during parsing and placed in predictable fields. Unknown attributes are preserved alongside them — nothing is discarded.

### The Foundation as Gatekeeper

This creates a deliberate design choice for foundations: how much control do you give content authors?

**Permissive** — spread everything onto the DOM:

```jsx
function FeatureCard({ icon, title, paragraphs }) {
  return (
    <div>
      <Icon {...icon} />  {/* All icon attributes reach the <svg> */}
      <H1 text={title} /> {/* Inline HTML rendered as-is */}
    </div>
  )
}
```

This is what Kit components do by default. Content authors can add `color`, `class`, `data-*`, `aria-*` attributes and they all work. It's a useful escape hatch — a content author can write `![](lu-star){color=var(--primary-600)}` to tint an icon without the foundation needing a `color` param.

**Restrictive** — pick only what you support:

```jsx
function FeatureCard({ icon, title, paragraphs }) {
  // Only pass the attributes this foundation supports
  const { library, name, size } = icon
  return (
    <div>
      <Icon library={library} name={name} size={size} />
      <H1 text={title} />
    </div>
  )
}
```

Here, `color=red` on an icon is silently ignored. The foundation preserves its branding because it controls exactly which properties reach the DOM.

Both are valid. A design-system foundation serving multiple sites might be strict to enforce brand consistency. A personal site foundation might be permissive because the content author and developer are the same person.

### Transforming Inline HTML

Since text fields (`paragraphs`, `title`, etc.) arrive as HTML strings, a foundation that wants to intercept inline attributes needs to parse the HTML. `DOMParser` works for this:

```jsx
function StyledParagraph({ text }) {
  // Transform inline attributes before rendering
  const transformed = useMemo(() => {
    const doc = new DOMParser().parseFromString(text, 'text/html')

    // Example: remap color values to design tokens
    doc.querySelectorAll('span[style]').forEach(span => {
      const color = span.style.color
      if (color && !color.startsWith('var(')) {
        // Replace raw colors with the nearest design token
        span.style.color = `var(--primary-600)`
      }
    })

    // Example: strip classes the foundation doesn't support
    doc.querySelectorAll('[class]').forEach(el => {
      const allowed = ['highlight', 'muted', 'callout']
      el.className = [...el.classList].filter(c => allowed.includes(c)).join(' ')
    })

    return doc.body.innerHTML
  }, [text])

  return <p dangerouslySetInnerHTML={{ __html: transformed }} />
}
```

This is an advanced technique — most foundations won't need it. But it's available when a foundation needs to enforce constraints on inline styling while still allowing authors to use the attribute syntax.

## See Also

- [Page Configuration](./page-configuration.md) — page.yml options for sections and ordering
- [Navigation Patterns](./navigation-patterns.md) — Building navbars, menus, and sidebars
- [Linking](./linking.md) — The `page:` protocol for stable internal links
- [Component Metadata](./component-metadata.md) — Documenting what content your component expects
