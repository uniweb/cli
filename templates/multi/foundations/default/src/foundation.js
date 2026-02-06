/**
 * Default Foundation Configuration
 *
 * This file defines foundation-level configuration:
 * - vars: CSS custom properties that sites can override in theme.yml
 * - Layout: Custom page layout component (optional)
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
    default: '5rem',
    description: 'Vertical padding for sections',
  },
}

/**
 * Runtime exports (Layout and props)
 */
export default {
  // Optional: Create custom layouts in src/layouts/
  // Then set defaultLayout: 'MyLayout' below

  // Foundation-wide props (accessible via website.foundationProps):
  props: {},
}
