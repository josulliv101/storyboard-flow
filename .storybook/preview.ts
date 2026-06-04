import type { Preview } from '@storybook/nextjs-vite';
import '../app/globals.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
  },
};

export default preview;
