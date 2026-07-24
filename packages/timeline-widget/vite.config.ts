import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the MCP Apps UI into ONE self-contained HTML file.
//
// Single-file is a hard requirement, not a preference: the host renders this
// resource inside a sandboxed iframe from a `ui://` URI, so there is no origin
// to fetch sibling assets from. Everything — JS, CSS — must be inlined.
//
// `build-html-module.mjs` then wraps the output as a TS module so the Next
// serverless function can import it as a string. Reading it from disk at
// runtime would depend on file tracing dragging the asset into the Lambda,
// which is exactly the class of deploy-only breakage this project already ate
// once (see the jose/ERR_REQUIRE_ESM incident).

export default defineConfig({
  root: __dirname,
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Inline every asset regardless of size; nothing may stay external.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
