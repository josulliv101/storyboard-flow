import path from "node:path";
import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    coverage: {
      allowExternal: true,
      exclude: [
        ...coverageConfigDefaults.exclude,
        "**/.storybook/**",
        "**/*stories-helpers.*",
        "**/*.stories.*",
        "**/*.test.*",
        "**/*.spec.*",
        "**/__tests__/**",
        "**/storybook-static/**",
        "**/test-results/**",
        "**/playwright-report/**",
        "**/tests/**",
        "**/next-env.d.ts",
      ],
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage/storybook",
    },
    projects: [
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(dirname, ".storybook") })],
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
            provider: playwright({}),
          },
          name: "storybook",
        },
      },
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "../../packages/ui/**/*.test.ts",
            "../../packages/ui/**/*.test.tsx",
            "../../packages/timeline-domain/**/*.test.ts",
            "../../packages/collections-core/**/*.test.ts",
            "../../packages/timeline-model/**/*.test.ts",
            "../../packages/timeline-widget/**/*.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
    ],
  },
});
