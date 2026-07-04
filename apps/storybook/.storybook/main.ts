import type { StorybookConfig } from '@storybook/nextjs-vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const storybookDir = dirname(fileURLToPath(import.meta.url));
const compatShim = (name: string) => resolve(storybookDir, 'shims', `es-toolkit-compat-${name}.ts`);
const timelineAppDir = resolve(storybookDir, '../../timeline-gstudio001');
const uiPackageDir = resolve(storybookDir, '../../../packages/ui');

const config: StorybookConfig = {
  stories: [
    '../../web/components/**/*.stories.@(ts|tsx)',
    '../../../packages/ui/**/*.stories.@(ts|tsx)',
    '../../timeline-gstudio001/components/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-vitest', '@storybook/addon-a11y', '@storybook/addon-mcp'],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {
      nextConfigPath: resolve(storybookDir, '../../web/next.config.ts'),
    },
  },
  viteFinal: async config => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: [
        ...(Array.isArray(config.resolve?.alias) ? config.resolve.alias : []),
        {
          find: /^@\/components\/(assets|auth|core|timeline)\/(.*)$/,
          replacement: `${timelineAppDir}/components/$1/$2`,
        },
        {
          find: /^@\/lib\/(timeline-documents|timeline-media-client)$/,
          replacement: `${timelineAppDir}/lib/$1`,
        },
        {
          find: /^@\/core\/(.*)$/,
          replacement: `${uiPackageDir}/core/$1`,
        },
        {
          find: /^@\/lib\/utils$/,
          replacement: `${uiPackageDir}/lib/utils`,
        },
        { find: '@', replacement: resolve(storybookDir, '../../web') },
        { find: '@gstudio', replacement: resolve(storybookDir, '../../timeline-gstudio001') },
        { find: 'es-toolkit/compat/get', replacement: compatShim('get') },
        { find: 'es-toolkit/compat/isPlainObject', replacement: compatShim('isPlainObject') },
        { find: 'es-toolkit/compat/last', replacement: compatShim('last') },
        { find: 'es-toolkit/compat/maxBy', replacement: compatShim('maxBy') },
        { find: 'es-toolkit/compat/minBy', replacement: compatShim('minBy') },
        { find: 'es-toolkit/compat/omit', replacement: compatShim('omit') },
        { find: 'es-toolkit/compat/range', replacement: compatShim('range') },
        { find: 'es-toolkit/compat/sortBy', replacement: compatShim('sortBy') },
        { find: 'es-toolkit/compat/sumBy', replacement: compatShim('sumBy') },
        { find: 'es-toolkit/compat/throttle', replacement: compatShim('throttle') },
        { find: 'es-toolkit/compat/uniqBy', replacement: compatShim('uniqBy') },
        ...(config.resolve?.alias && !Array.isArray(config.resolve.alias)
          ? Object.entries(config.resolve.alias).map(([find, replacement]) => ({ find, replacement }))
          : []),
      ],
    },
    optimizeDeps: {
      ...config.optimizeDeps,
      include: Array.from(new Set([...(config.optimizeDeps?.include ?? []), 'recharts'])),
    },
  }),
  staticDirs: ['../../web/public'],
};

export default config;
