import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
    {
        // .next-dev is this app's DEV distDir (see next.config) — generated
        // webpack output, never lintable. .next is covered by the Next preset,
        // but the custom name is not.
        ignores: [
            ".next-dev/**",
            ".next/**",
            "storybook-static/**",
            "test-results/**",
            "playwright-report/**",
            "coverage/**",
        ],
    },
    {
        extends: [...next],
    },
]);
