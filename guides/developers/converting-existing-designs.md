# Converting Existing Designs

You have a React file — maybe AI-generated, maybe hand-built, maybe inherited from a project. It renders a full page: nav, hero, features, testimonials, footer. Everything's in one file or scattered across a few. It works, it looks good, and now you want to bring it into a Uniweb project.

This guide shows how. The key insight is that you don't have to do it all at once — the conversion has natural stopping points, each independently useful.

---

## What You're Starting From

Here's a typical AI-generated landing page (this one came from Gemini). The structure is familiar:

```jsx
export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      <Nav />
      <main className="flex-grow pt-20">
        <Hero />
        <TheModel />
        <TwoWaysIn />
        <WorkModes />
        <Multilingual />
        <Institutions />
        <OpenArchitecture />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  )
}
```

Each component is 40–100 lines of JSX with hardcoded content, hardcoded Tailwind classes, and lucide-react icons. There's a `Button` helper, a `Badge` helper, a `Section` wrapper. Standard AI output.

If you squint at this, it's already a page with sections. The `App` function is a router. `Nav` is the header. `Footer` is the footer. Each component in `<main>` is a section. The mapping to Uniweb is direct — but you don't have to make it all at once.

---

## Level 0: CCA as Routing

The minimum viable migration. You create a Uniweb project, paste the entire original file into one section type, and let the site handle routing. Nothing is decomposed — all the original components, content, and styling stay exactly where they are.

**Foundation:**

```
foundation/src/sections/
└── App/
    └── App.jsx         ← paste the entire file: Nav, Hero, Footer, everything
```

That's one section type. No `meta.js` needed — a folder at the root of `sections/` is automatically addressable. The title "App" is inferred from the folder name. Everything else in the original file — `Nav`, `Hero`, `TheModel`, `Button`, `Badge`, `Section`, `Footer` — lives inside `App.jsx` as local functions. They don't need their own folders. They're just internal code inside the one section type that CCA knows about.

**Site:**

```
site/pages/
└── home/
    └── home.md         ← one section, one page
```

The markdown file is three lines:

```markdown
---
type: App
---
```

The component receives `content` and `params` but doesn't use them — it renders its baked-in JSX. That's fine. You already get:

- File-based routing
- Dev server with hot reload
- Production build with static HTML
- The ability to add more pages by creating folders

This level is useful when you need to get something live quickly and plan to improve it later. The site works. It looks identical to the original. The architecture is in place for when you're ready.

---

## Level 1: Decompose and Name by Purpose

This is where you break the monolith into separate section types — one per section — and give them names that describe what they _render_ rather than what they _say_. Each gets its own folder and `meta.js`. The content is still hardcoded in JSX, but the sections are now independent and reusable.

Shared helpers like `Button`, `Badge`, `Section` move to `foundation/src/components/` — ordinary React components, imported by section types.

```
foundation/src/
├── sections/            # Addressable — section types
│   ├── Hero/
│   ├── SplitContent/
│   ├── FeatureCards/
│   ├── Header/
│   └── Footer/
└── components/          # React components
    ├── Button.jsx
    ├── Badge.jsx
    └── SectionWrapper.jsx
```

At this level, the section types don't need `meta.js` — they're at the root of `sections/`, so they're addressable by default. Add `meta.js` later when you need params or content expectations.

The site now has a section per component, with `@header` and `@footer` split out:

```
site/pages/
├── @header/
│   └── header.md          # type: Header
├── @footer/
│   └── footer.md          # type: Footer
└── home/
    ├── page.yml
    ├── 1-hero.md           # type: Hero
    ├── 2-model.md          # type: SplitContent
    ├── 3-paths.md          # type: FeatureCards
    └── ...
```

Now look at the names. The AI-generated file has components named after their content:

| AI name            | What it actually does                       |
| ------------------ | ------------------------------------------- |
| `TheModel`         | Text on one side, video/visual on the other |
| `TwoWaysIn`        | Two feature cards side by side              |
| `WorkModes`        | Three-column feature grid                   |
| `Multilingual`     | Centered text in a card                     |
| `Institutions`     | Quote with attribution and dark background  |
| `OpenArchitecture` | Centered icon, heading, paragraph, link     |
| `FinalCTA`         | Call to action with heading and button      |

Rename them by what they _render_, not what they _say_:

| AI name            | CCA name         | Why                                     |
| ------------------ | ---------------- | --------------------------------------- |
| `TheModel`         | `SplitContent`   | Text + visual, either side              |
| `TwoWaysIn`        | `FeatureCards`   | N cards with icon, title, list, CTA     |
| `WorkModes`        | `FeatureColumns` | N columns with icon, title, description |
| `Multilingual`     | `Highlight`      | Centered callout in a card              |
| `Institutions`     | `Testimonial`    | Quote + attribution                     |
| `OpenArchitecture` | `CenteredCTA`    | Icon, heading, text, link               |
| `FinalCTA`         | `CallToAction`   | Heading, text, button                   |

Why this matters: `Institutions` can only ever be the institutions section. `Testimonial` can render any quote — a customer review, a partner endorsement, an internal praise. The same component, freed from its birth content, becomes reusable. If you later add a `/customers` page, `Testimonial` is already there.

And when you find that several pages have similar-but-different heroes or CTAs? That's one component with a `variant` param — the Dispatcher pattern. See [CCA Component Patterns](./component-patterns.md) for how to consolidate similar sections without over-engineering the abstraction.

At this level you also get header/footer separation (renders on every page), so adding a second page is just a new folder with markdown files.

---

## Level 2: Separate Content from Code

This is where the site starts earning its keep. You move hardcoded strings out of JSX and into markdown, and the component reads from `content` instead.

Take the Hero:

```jsx
// BEFORE: hardcoded content
const Hero = () => (
  <Section className="pt-32 md:pt-48">
    <Badge>The Component Content System</Badge>
    <h1 className="font-serif text-5xl md:text-7xl font-medium tracking-tight text-slate-900">
      Manage how content becomes pages through components.
    </h1>
    <p className="text-xl text-stone-700">
      You choose a collection—or commission a custom one. ...
    </p>
    <Button variant="primary">Start from a Template</Button>
    <Button variant="secondary">
      <Download size={16} /> Get the App
    </Button>
  </Section>
)
```

```jsx
// AFTER: content from markdown
export function Hero({ content }) {
  const { pretitle, title, paragraphs, links, imgs } = content

  return (
    <div className="pt-32 md:pt-48 max-w-7xl mx-auto px-6">
      {pretitle && (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold border tracking-wider uppercase mb-6 bg-stone-100 text-stone-700 border-stone-300">
          {pretitle}
        </span>
      )}
      <h1 className="font-serif text-5xl md:text-7xl font-medium tracking-tight text-slate-900">
        {title}
      </h1>
      {paragraphs[0] && (
        <p className="text-xl text-stone-700 leading-relaxed max-w-lg">
          {paragraphs[0]}
        </p>
      )}
      <div className="flex gap-4 mt-12">
        {links.map((link, i) => (
          <Button
            key={i}
            variant={i === 0 ? 'primary' : 'secondary'}
            href={link.href}
          >
            {link.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
```

And the markdown becomes real content:

```markdown
---
type: Hero
---

### The Component Content System

# Manage how content becomes pages through components.

You choose a collection — or commission a custom one. You arrange, decorate, add your voice. The design language holds, keeping everything coherent as the site evolves.

[Start from a Template](/templates)
[Get the App](/downloads)

![Hero illustration](./hero.jpg)
```

**What moved where:**

| Was in JSX                       | Now in markdown                       | Accessed via            |
| -------------------------------- | ------------------------------------- | ----------------------- |
| `"The Component Content System"` | `### ... ` (pretitle)                 | `content.pretitle`      |
| `"Manage how content..."`        | `# ...` (title)                       | `content.title`         |
| `"You choose a collection..."`   | Paragraph text                        | `content.paragraphs[0]` |
| `"Start from a Template"` + URL  | `[Start from a Template](/templates)` | `content.links[0]`      |
| `<Download size={16} />`         | `![](lu-download)` next to link       | `content.links[1].icon` |
| Hero image                       | `![Hero illustration](./hero.jpg)`    | `content.imgs[0]`       |

**What stayed in JSX:** Layout (`pt-32 md:pt-48`), the badge styling, the button variants, the grid structure, the font choices. These are design decisions — they belong in the component.

**Items work the same way.** The `WorkModes` component (now `FeatureColumns`) had three hardcoded columns. In markdown, headings after body content become items:

```markdown
---
type: FeatureColumns
---

# Work how you work

A single identity across all platforms.

### Cloud

![](lu-cloud)

Edit from the web app or mobile. Changes publish instantly.

### Local

![](lu-monitor)

Native apps for desktop. Work directly on your file system.

### Teams

![](lu-users)

Devs commit to git. Content teams use the visual app.
```

The component reads `content.items` — each item has its own `title`, `paragraphs`, `icons`. No hardcoded strings, no fixed number of columns.

At this level, you're no longer the bottleneck for text changes. A content author can change every word on the page without opening a `.jsx` file — add a fourth column to FeatureColumns with another `###` heading, swap the hero image, rewrite the testimonial quote. Your design stays intact because the component controls the layout. The content lives in markdown where it's easy to edit, translate, and version.

---

## Level 3: Semantic Theming

This is where [Thinking in Contexts](./thinking-in-contexts.md) connects. Level 2 separated content from code. This level separates _theme from code_.

Look at the colors in the AI-generated Hero:

```jsx
<h1 className="text-slate-900">...</h1>
<p className="text-stone-700">...</p>
<span className="bg-stone-100 text-stone-700 border-stone-300">...</span>
```

These are hardcoded to one palette. The component can't adapt to a dark context (the text would be invisible), and it can't adapt to a different brand (it's permanently slate/stone).

Replace them with semantic tokens:

```jsx
<h1 className="text-heading">...</h1>
<p className="text-muted">...</p>
<span className="bg-surface-subtle text-muted border-edge-muted">...</span>
```

Now the component works in any context — `theme: light`, `theme: dark`, `theme: medium` — because the tokens resolve to appropriate values based on context. And it works with any brand, because the palette comes from `theme.yml`, not from the component.

**The Testimonial is a good example.** The AI version hardcodes a dark card:

```jsx
<div className="bg-stone-900 text-stone-300 rounded-xl">
  <h2 className="text-white">Trusted by major institutions.</h2>
  <p className="text-stone-200 font-serif italic">
    "The University of Ottawa uses Uniweb to..."
  </p>
  <Button variant="white">Read Case Study</Button>
</div>
```

With semantic theming, you don't build any of that. The component uses tokens and the frontmatter handles the rest:

```markdown
---
type: Testimonial
theme: dark
---

# Trusted by major institutions. Available to everyone.

> "The University of Ottawa uses Uniweb to give faculty members professional academic sites."

[Read Institutional Case Study](/case-studies/uottawa)
```

The component just uses tokens:

```jsx
export function Testimonial({ content }) {
  const { title, quotes, links } = content

  return (
    <div className="bg-surface rounded-xl p-12">
      <h2 className="text-heading text-3xl font-serif">{title}</h2>
      {quotes[0] && (
        <blockquote className="text-body text-lg font-serif italic border-l-2 border-edge pl-6">
          {quotes[0].paragraphs[0]}
        </blockquote>
      )}
      {links[0] && (
        <Button variant="secondary" href={links[0].href}>
          {links[0].label}
        </Button>
      )}
    </div>
  )
}
```

Set `theme: dark` and it's a dark card. Set `theme: light` and it's a light card. Set `theme: medium` and it's a gray card. Change the primary color in `theme.yml` and the accent colors shift everywhere. The component doesn't know or care.

---

## You Don't Have to Go in Order

The four levels are a logical progression, but they're not a mandatory sequence. Real conversions often mix levels:

- You might start at Level 0 to get the site live immediately, then decompose into components (Level 1) when you have time.
- You might do Level 2 (content separation) for the Hero but leave the Footer at Level 1 (hardcoded) because it rarely changes.
- You might jump straight to Level 3 for new components you're building from scratch, while leaving converted components at Level 2.

The architecture doesn't enforce a particular order. Once you've decomposed (Level 1+), each section is independent — one can be at Level 1 while another is at Level 3, on the same page, in the same foundation.

---

## What Changes at Each Level

|             | Structure     | Content in... | Colors in...     | Reusable?                    | Themeable? |
| ----------- | ------------- | ------------- | ---------------- | ---------------------------- | ---------- |
| **Level 0** | One component | JSX           | JSX              | No                           | No         |
| **Level 1** | Decomposed    | JSX           | JSX              | By name, not yet by content  | No         |
| **Level 2** | Decomposed    | Markdown      | JSX              | Yes — any content            | No         |
| **Level 3** | Decomposed    | Markdown      | Site's theme.yml | Yes — any content, any brand | Yes        |

Each level reduces the coupling between the component and its birth context. By Level 3, the component has no memory of the site it was designed for.

---

## The Practical Reality

AI tools generate impressive-looking pages. But the output is often monolithic — content baked into code, colors hardcoded, component names describing what they say rather than what they do. That's not a criticism of the AI. It's generating a _page_, not an _architecture_.

The value of converting isn't aesthetic — the page already looks good. The value is operational:

- **You stop being the bottleneck for text changes.** At Level 0, every word change requires a developer. At Level 2, content lives in markdown — anyone can edit it.
- **Your components become reusable.** At Level 1, `Testimonial` serves any quote, not just one client's. One component, many pages.
- **Your foundation works across sites.** At Level 3, the same components adapt to different brands via `theme.yml`. Ship once, theme anywhere.

You don't need all of this on day one. Start where you are, convert what's worth converting, and stop when the return on effort drops. A Level 2 foundation with one hardcoded Footer is better than a Level 0 monolith or an overengineered Level 3 conversion of a section that changes once a year.

### AI as a collaborator

The original monolithic page might come from a chat-based AI — ChatGPT, Gemini, Claude — where you describe what you want and get back a complete React file. That's a fine way to start a design. But a chat agent generates a *page*, not a *project*. It doesn't know your routing, your content model, or your theming system.

The conversion into CCA can be done by hand or with a coding agent like Claude Code or ChatGPT Codex — tools that work inside your project, see your files, and understand the codebase. CCA's architecture makes these agents particularly effective at both sides. The site package is markdown and YAML: structured enough for AI to author confidently, flexible enough that it doesn't need to understand rendering. The foundation package is standard React with a clear contract (`meta.js` declares what the component expects, `content` delivers it). Every Uniweb project includes an `AGENTS.md` file with the patterns and conventions a coding agent needs to work as a sophisticated content author on the site side and as a component developer on the foundation side.

In practice, this means you can generate a landing page in a chat, paste it at Level 0, and then let a coding agent handle the decomposition and content extraction. The separation of concerns that makes CCA good for teams of humans makes it equally good for teams that include AI.

---

## See Also

- **[Thinking in Contexts](./thinking-in-contexts.md)** — The full semantic theming guide (what Level 3 gives you)
- **[Component Metadata](../../docs/component-metadata.md)** — `meta.js` reference for declaring content expectations and parameters
- **[Content Structure](../../docs/content-structure.md)** — How markdown becomes `content.title`, `content.items`, etc.
- **[Writing Content](../authors/writing-content.md)** — The content author's perspective on sections, headings, and items
