import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-vitest'],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  staticDirs: ['../public'],
};

export default config;
