/**
 * Foundation Configuration
 *
 * This file defines foundation-level configuration:
 * - vars: CSS custom properties that sites can override in theme.yml
 * - defaultLayout: Name of the default layout from src/layouts/ (optional)
 * - props: Foundation-wide props accessible via website.foundationProps
 *
 * Identity (name, version, description) comes from package.json.
 */

// Create a layout at src/layouts/MyLayout/index.jsx

/**
 * CSS custom properties that sites can override in theme.yml
 */
export const vars = {
  'header-height': {
    default: '4rem',
    description: 'Fixed header height',
  },
  'max-content-width': {
    default: '80rem',
    description: 'Maximum content width (1280px)',
  },
  'section-padding-y': {
    default: 'clamp(4rem, 6vw, 7rem)',
    description: 'Vertical padding for sections (fluid: adapts to viewport)',
  },
}

/**
 * Runtime exports
 *
 * Layout components live in src/layouts/ and are auto-discovered.
 * Each layout receives pre-rendered page areas as props:
 * - page, website, params: Runtime context
 * - header, body, footer: Core page regions (pre-rendered React elements)
 * - Plus any custom areas declared in the layout's meta.js
 *
 * If no layouts exist, the runtime uses a default layout.
 */
export default {
  // Optional: Create custom layouts in src/layouts/
  // Then set defaultLayout: 'MyLayout' below

  // Foundation-wide props (accessible via website.foundationProps):
  props: {},
}
