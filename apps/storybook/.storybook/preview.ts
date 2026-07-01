import type { Preview } from '@storybook/nextjs-vite';
import './preview.css';

const preview: Preview = {
  parameters: {
    actions: {
      argTypesRegex: '^on[A-Z].*',
    },
    layout: 'fullscreen',
  },
};

export default preview;
