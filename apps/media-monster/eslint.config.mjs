import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // OURS, and it travels with `distDir` in next.config.ts. Dev builds into
    // `.next-dev` so a production build cannot overwrite what the dev server is
    // serving; the moment that directory existed, eslint started linting
    // generated output because only `.next/**` was ignored. It does not fail
    // quietly — 349 errors and 4,861 warnings out of Next's own emitted code —
    // but every one of them is about a file nobody wrote, and the real errors
    // are somewhere in the middle of them.
    ".next-dev/**",
  ]),
]);

export default eslintConfig;
