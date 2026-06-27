import type { StorybookConfig } from "@storybook/nextjs-vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const storybookDir = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/nextjs-vite",
    options: {
      nextConfigPath: resolve(storybookDir, "../next.config.ts"),
    },
  },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    resolve: {
      ...viteConfig.resolve,
      alias: [
        { find: "@", replacement: resolve(storybookDir, "..") },
        ...(Array.isArray(viteConfig.resolve?.alias) ? viteConfig.resolve.alias : []),
      ],
    },
  }),
};

export default config;
