/**
 * Section Component Metadata (v2)
 *
 * A versatile content section for headings, text, and links.
 */
export default {
  title: 'Section',
  description: 'A versatile content section for headings, text, and links',
  category: 'content',
  purpose: 'Inform',

  content: {
    pretitle: 'Eyebrow text',
    title: 'Main heading',
    subtitle: 'Secondary heading',
    paragraphs: 'Body text',
    links: 'Call-to-action buttons',
    imgs: 'Section images',
  },

  params: {
    theme: {
      type: 'select',
      label: 'Theme',
      options: ['light', 'dark', 'primary'],
      default: 'light',
    },
    align: {
      type: 'select',
      label: 'Alignment',
      options: ['left', 'center', 'right'],
      default: 'center',
    },
    width: {
      type: 'select',
      label: 'Width',
      options: [
        'narrow',
        'default',
        'wide',
        { value: 'full', label: 'Full Width' },
      ],
      default: 'default',
    },
  },

  presets: {
    default: {
      label: 'Centered',
      params: { theme: 'light', align: 'center' },
    },
    dark: {
      label: 'Dark Theme',
      params: { theme: 'dark', align: 'center' },
    },
    left: {
      label: 'Left Aligned',
      params: { theme: 'light', align: 'left' },
    },
  },
}
