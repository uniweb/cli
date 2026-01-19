export default {
  title: 'Section',
  description: 'A versatile content section for headings, text, and links',
  category: 'Content',

  elements: {
    pretitle: {
      label: 'Eyebrow',
      description: 'Small text above the title (H3 before H1)',
    },
    title: {
      label: 'Title',
      description: 'Main heading (H1)',
    },
    subtitle: {
      label: 'Subtitle',
      description: 'Secondary heading (H2 after H1)',
    },
    paragraphs: {
      label: 'Content',
      description: 'Body text paragraphs',
    },
    links: {
      label: 'Links',
      description: 'Call-to-action buttons',
    },
    imgs: {
      label: 'Images',
      description: 'Section images',
    },
  },

  properties: {
    theme: {
      type: 'select',
      label: 'Theme',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'primary', label: 'Primary' },
      ],
      default: 'light',
    },
    align: {
      type: 'select',
      label: 'Alignment',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
      default: 'center',
    },
    width: {
      type: 'select',
      label: 'Width',
      options: [
        { value: 'narrow', label: 'Narrow' },
        { value: 'default', label: 'Default' },
        { value: 'wide', label: 'Wide' },
        { value: 'full', label: 'Full Width' },
      ],
      default: 'default',
    },
  },
}
