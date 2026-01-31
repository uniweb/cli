# Templates

Uniweb projects are created from templates using `uniweb create`. Templates provide the initial project structure, components, and sample content.

---

## Built-in Templates

Built-in templates ship with the CLI and work offline.

### Single (Default)

A minimal workspace with a site and foundation as sibling packages. The recommended starting point.

```
my-project/
├── package.json              # Workspace root
├── pnpm-workspace.yaml
├── site/
│   ├── package.json
│   ├── vite.config.js
│   ├── site.yml
│   ├── main.js
│   └── pages/
└── foundation/
    ├── package.json
    ├── vite.config.js
    └── src/sections/
```

```bash
pnpm create uniweb my-site
```

### Multi

A monorepo for foundation development or multi-site projects.

```
my-workspace/
├── sites/
│   ├── marketing/            # Main site or test site
│   └── docs/                 # Additional site
└── foundations/
    ├── marketing/            # Primary foundation
    └── documentation/        # Additional foundation
```

```bash
pnpm create uniweb my-workspace --template multi
```

Use this when you need multiple sites sharing foundations, multiple foundations for different purposes, or test sites for foundation development.

---

## Official Templates

Feature-rich templates with real components and sample content. **[View all demos](https://uniweb.github.io/templates/)**

### Marketing

[**Live Demo**](https://uniweb.github.io/templates/marketing/) · `pnpm create uniweb my-site --template marketing`

**Includes:** Hero, Features, Pricing, Testimonials, CTA, FAQ, Stats, LogoCloud, Video, Gallery, Team

Perfect for product launches, SaaS websites, and business landing pages.

**Tailwind v3 variant:** Use `--variant tailwind3` if your project requires Tailwind CSS v3 instead of v4:

```bash
pnpm create uniweb my-site --template marketing --variant tailwind3
```

### Academic

[**Live Demo**](https://uniweb.github.io/templates/academic/) · `pnpm create uniweb my-site --template academic`

**Includes:** ProfileHero, PublicationList, ResearchAreas, TeamGrid, Timeline, ContactCard, Navbar, Footer

Perfect for researcher portfolios, lab websites, and academic department sites.

### Docs

[**Live Demo**](https://uniweb.github.io/templates/docs/) · `pnpm create uniweb my-site --template docs`

**Includes:** Header, LeftPanel, DocSection, CodeBlock, Footer

Perfect for technical documentation, guides, and API references.

### International

[**Live Demo**](https://uniweb.github.io/templates/international/) · `pnpm create uniweb my-site --template international`

**Includes:** Hero, Features, Team, CTA, Header (with language switcher), Footer (with language links)

**Languages:** English (default), Spanish, French

A multilingual business site demonstrating Uniweb's i18n capabilities. Includes pre-configured translation files and a complete localization workflow:

```bash
uniweb i18n extract   # Extract translatable strings
uniweb i18n status    # Check translation coverage
uniweb build          # Generates dist/es/, dist/fr/
```

Perfect for international businesses and learning the i18n workflow.

---

## External Templates

Use templates from npm or GitHub:

```bash
# npm package
pnpm create uniweb my-site --template @myorg/template-name

# GitHub repository
pnpm create uniweb my-site --template github:user/repo

# GitHub with specific branch/tag
pnpm create uniweb my-site --template github:user/repo#v1.0.0

# Full GitHub URL
pnpm create uniweb my-site --template https://github.com/user/repo
```

---

## See Also

- [CLI Commands](./cli-commands.md) — Full `create` command reference
- [Quickstart](./quickstart.md) — Create your first site step by step
