import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
    {
        ignores: ["storybook-static/**", "test-results/**", "playwright-report/**", "coverage/**"],
    },
    {
        extends: [...next],
    },
]);
