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
            // The MCP Apps UI is a STANDALONE Vite bundle rendered in a host's
            // sandboxed iframe — it is not Next code and has no Next runtime,
            // so the @next/next rules misfire on it (e.g. recommending
            // next/image for an iframe with no image optimizer). Its own
            // typecheck still runs via the app tsconfig.
            "mcp-app/**",
            // Generated from mcp-app/ by build:mcp-app — a 500KB string.
            "lib/mcp-apps/timeline-app-html.ts",
        ],
    },
    {
        extends: [...next],
    },
]);
