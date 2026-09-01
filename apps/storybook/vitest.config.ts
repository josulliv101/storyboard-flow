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
  // The package's `exports` name `dist/`, because that is what npm publishes.
  // Nothing in this repo imports it by specifier today — the two halves reach
  // each other relatively — but the moment something does, TypeScript would
  // resolve it to SOURCE (via the `paths` in tsconfig.json) while the runtime
  // resolved it to a `dist/` that may not be built. Types and runtime
  // disagreeing is the quiet kind of wrong, so they are pinned to the same
  // place here.
  resolve: {
    alias: {
      "@josulliv101/nested-collections/react": fileURLToPath(
        new URL("../../packages/nested-collections/react/index.ts", import.meta.url),
      ),
      "@josulliv101/nested-collections": fileURLToPath(
        new URL("../../packages/nested-collections/core/index.ts", import.meta.url),
      ),
    },
  },
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
            "../../packages/nested-collections/**/*.test.ts",
            // graph-react's runtime tests. They existed and never ran: the
            // globs named six packages and this was not one of them, and the
            // file is `.tsx` so a `*.test.ts` glob alone would still miss it.
            
            "../../packages/nested-collections/**/*.test.tsx",
            "../../packages/timeline-model/**/*.test.ts",
            "../../packages/timeline-widget/**/*.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
    ],
  },
});
