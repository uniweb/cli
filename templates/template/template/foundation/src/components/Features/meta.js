export default {
  title: 'Features',
  description: 'Display a list of features in a grid',
  category: 'Content',

  elements: {
    title: {
      label: 'Section Title',
    },
    subtitle: {
      label: 'Section Subtitle',
    },
    items: {
      label: 'Features',
      description: 'Each H3 becomes a feature item',
    },
  },

  properties: {
    columns: {
      type: 'select',
      label: 'Columns',
      options: [
        { value: 2, label: '2 Columns' },
        { value: 3, label: '3 Columns' },
        { value: 4, label: '4 Columns' },
      ],
      default: 3,
    },
    theme: {
      type: 'select',
      label: 'Theme',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'gray', label: 'Gray' },
        { value: 'dark', label: 'Dark' },
      ],
      default: 'light',
    },
  },
}
