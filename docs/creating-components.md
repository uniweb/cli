# Creating Components

Build custom components for your foundation.

## Component Structure

Each section type lives in its own folder under `foundation/src/sections/`:

```
foundation/src/sections/
└── FeatureCard/
    ├── FeatureCard.jsx   # The React component (or index.jsx — both work)
    └── meta.js           # Content interface declaration
```

The `meta.js` file makes a component a section type — selectable via `type:` in content. Components without `meta.js` are ordinary React components that live wherever makes sense (typically `src/components/`).

---

## Minimal Component

### meta.js

```js
export default {
  title: 'Feature Card',
  category: 'showcase',
}
```

### index.jsx

```jsx
export function FeatureCard({ content, params }) {
  const { title, paragraphs, imgs } = content

  return (
    <div className="p-6 border rounded-lg">
      {imgs[0] && <img src={imgs[0].src} alt={imgs[0].alt} className="w-16 h-16" />}
      <h3 className="text-xl font-bold mt-4">{title}</h3>
      {paragraphs[0] && <p className="text-gray-600 mt-2">{paragraphs[0]}</p>}
    </div>
  )
}
```

### Usage in content

```markdown
---
type: FeatureCard
---

![](/icons/rocket.svg)

# Fast Performance

Built for speed with optimized loading and caching.
```

---

## Component Props

Every section type receives:

```jsx
function MyComponent({ content, params, block }) {
  // content - Parsed markdown content
  // params  - Frontmatter parameters (with defaults from meta.js)
  // block   - Block instance (access to page, website)
}
```

### content

The runtime guarantees this structure:

```js
content = {
  // Headings
  title: '',           // H1
  pretitle: '',        // Heading before H1
  subtitle: '',        // Heading after H1

  // Body
  paragraphs: [],      // Paragraph text
  links: [],           // [{ href, label }]
  lists: [],           // List items

  // Media
  imgs: [],            // [{ src, alt, title }]
  icons: [],           // Small images marked as icons

  // Structure
  items: [],           // Content groups from subsequent headings
  data: {},            // Tagged blocks + fetched data

  // Document order
  sequence: [],        // All elements in original order
}
```

**No null checks needed.** Empty arrays/strings are guaranteed.

### params

Configuration from frontmatter, with defaults from `meta.js`:

```markdown
---
type: Hero
theme: dark
layout: centered
---
```

```jsx
function Hero({ params }) {
  const { theme, layout } = params
  // theme = 'dark' (from frontmatter)
  // layout = 'centered' (from frontmatter)
  // Other params have defaults from meta.js
}
```

### block

Access to page and site context:

```jsx
function MyComponent({ block }) {
  const page = block.page
  const website = block.website

  console.log(page.title)
  console.log(website.name)
}
```

---

## Writing meta.js

The `meta.js` file defines your component's interface.

### Required Fields

```js
export default {
  title: 'Feature Card',        // Display name
  category: 'showcase',         // Grouping: impact, showcase, structure
}
```

### Describing Content

Document what content your component uses:

```js
export default {
  title: 'Hero',
  category: 'impact',

  content: {
    pretitle: 'Eyebrow text',
    title: 'Headline',
    subtitle: 'Secondary headline',
    paragraphs: 'Description [1-2]',    // [count] is guidance
    links: 'CTA buttons [1-2]',
    image: 'Hero image [1]',
  },
}
```

The count syntax (`[1]`, `[1-2]`, `[2+]`) documents expected quantity.

### Adding Parameters

Define configurable options:

```js
export default {
  title: 'Hero',
  category: 'impact',

  params: {
    theme: {
      type: 'select',
      label: 'Theme',
      options: ['light', 'dark', 'gradient'],
      default: 'light',
    },
    layout: {
      type: 'select',
      label: 'Layout',
      options: ['centered', 'left', 'split'],
      default: 'centered',
    },
    showPattern: {
      type: 'boolean',
      label: 'Show Background Pattern',
      default: false,
    },
  },
}
```

**Parameter types:**

| Type | UI | Value |
|------|-----|-------|
| `select` | Dropdown | String from options |
| `boolean` | Toggle | true/false |
| `string` | Text input | Any string |
| `number` | Number input | Numeric value |

### Creating Presets

Named combinations of parameters:

```js
export default {
  title: 'Hero',
  category: 'impact',

  params: {
    theme: { type: 'select', options: ['light', 'dark', 'gradient'], default: 'light' },
    layout: { type: 'select', options: ['centered', 'left'], default: 'centered' },
  },

  presets: {
    default: {
      label: 'Light Centered',
      params: { theme: 'light', layout: 'centered' },
    },
    bold: {
      label: 'Dark Hero',
      params: { theme: 'dark', layout: 'centered' },
    },
    gradient: {
      label: 'Gradient Split',
      params: { theme: 'gradient', layout: 'split' },
    },
  },
}
```

Use in content:

```markdown
---
type: Hero
preset: bold
---
```

### Background Support

Enable background images/videos:

```js
export default {
  title: 'Hero',
  category: 'impact',
  background: true,    // Engine handles background rendering
}
```

Content authors can then configure:

```markdown
---
type: Hero
background:
  image: /images/hero-bg.jpg
  overlay:
    type: dark
    opacity: 0.5
---
```

---

## Handling Items

When content has multiple headings after the main content, they become `items`:

```markdown
---
type: Features
---

# Our Features

The best features for your needs.

## Fast

Lightning quick performance.

## Secure

Enterprise-grade security.

## Scalable

Grows with your needs.
```

The component receives:

```js
content.title = "Our Features"
content.paragraphs = ["The best features for your needs."]
content.items = [
  { title: "Fast", paragraphs: ["Lightning quick performance."] },
  { title: "Secure", paragraphs: ["Enterprise-grade security."] },
  { title: "Scalable", paragraphs: ["Grows with your needs."] },
]
```

Render items:

```jsx
function Features({ content }) {
  const { title, paragraphs, items } = content

  return (
    <section>
      <h2>{title}</h2>
      <p>{paragraphs[0]}</p>

      <div className="grid grid-cols-3 gap-6">
        {items.map((item, i) => (
          <div key={i}>
            <h3>{item.title}</h3>
            <p>{item.paragraphs[0]}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
```

---

## Using Tagged Blocks

For structured data that doesn't fit markdown, use tagged code blocks:

````markdown
---
type: PricingTable
---

# Pricing

Choose the plan that's right for you.

```yaml:plans
- name: Starter
  price: 9
  features: [5 projects, 1GB storage]
- name: Pro
  price: 29
  features: [Unlimited projects, 10GB storage, Priority support]
```
````

Access in component:

```jsx
function PricingTable({ content }) {
  const { title, paragraphs } = content
  const plans = content.data.plans || []

  return (
    <section>
      <h2>{title}</h2>
      <p>{paragraphs[0]}</p>

      <div className="grid grid-cols-2 gap-6">
        {plans.map(plan => (
          <div key={plan.name}>
            <h3>{plan.name}</h3>
            <p className="text-3xl">${plan.price}/mo</p>
            <ul>
              {plan.features.map(f => <li key={f}>{f}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
```

Define the schema in meta.js:

```js
export default {
  title: 'Pricing Table',
  category: 'showcase',

  schemas: {
    plans: {
      name: 'string',
      price: 'number',
      features: { type: 'array', of: 'string' },
    },
  },
}
```

---

## Accessing Context

Use hooks for site-wide data:

```jsx
import { useWebsite, useActiveRoute } from '@uniweb/kit'

function Header({ content }) {
  const { website } = useWebsite()
  const { isActiveOrAncestor } = useActiveRoute()

  const pages = website.getPageHierarchy({ for: 'header' })

  return (
    <header>
      <span>{website.name}</span>
      <nav>
        {pages.map(page => (
          <a
            key={page.id}
            href={page.route}
            className={isActiveOrAncestor(page) ? 'active' : ''}
          >
            {page.label}
          </a>
        ))}
      </nav>
    </header>
  )
}
```

See [Runtime API](./runtime-api.md) for all available hooks.

---

## Building the Foundation

After creating components:

```bash
cd foundation
pnpm build
```

This generates:
- `dist/foundation.js` — Bundled components
- `dist/schema.json` — Component metadata for the runtime

---

## Generating Documentation

Generate `COMPONENTS.md` for content authors:

```bash
cd foundation
uniweb docs
```

This creates documentation with each component's:
- Description and category
- Content expectations
- Parameters and defaults
- Available presets

---

## Best Practices

1. **Graceful degradation** — Handle missing content without errors
2. **Sensible defaults** — Every param should have a good default
3. **Intent over implementation** — `theme: dark` not `backgroundColor: #1a1a1a`
4. **Minimal required content** — Components should render with minimal input
5. **Consistent naming** — Use the standard content element names

---

## See Also

- [Component Metadata](./component-metadata.md) — Full meta.js reference
- [Content Structure](./content-structure.md) — How content is parsed
- [Runtime API](./runtime-api.md) — Hooks and objects
- [Foundation Configuration](./foundation-configuration.md) — CSS variables and Layout
