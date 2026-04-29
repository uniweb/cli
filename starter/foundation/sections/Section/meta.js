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
    images: 'Section images',
  },

  params: {
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
      params: { align: 'center' },
    },
    left: {
      label: 'Left Aligned',
      params: { align: 'left' },
    },
  },
}
