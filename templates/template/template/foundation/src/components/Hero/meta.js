export default {
  title: 'Hero',
  description: 'A hero section for landing pages',
  category: 'Headers',

  elements: {
    pretitle: {
      label: 'Eyebrow',
      description: 'Small text above the title',
    },
    title: {
      label: 'Headline',
      required: true,
    },
    subtitle: {
      label: 'Subtitle',
    },
    paragraphs: {
      label: 'Description',
    },
    links: {
      label: 'Call to Action',
    },
  },

  properties: {
    theme: {
      type: 'select',
      label: 'Theme',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'gradient', label: 'Gradient' },
      ],
      default: 'light',
    },
    layout: {
      type: 'select',
      label: 'Layout',
      options: [
        { value: 'center', label: 'Center' },
        { value: 'left', label: 'Left' },
      ],
      default: 'center',
    },
  },
}
