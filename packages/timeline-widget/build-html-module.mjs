import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Wraps Vite's single-file output as a TypeScript module exporting the HTML as
// a string.
//
// Why a module rather than reading dist/index.html at runtime: the MCP route
// runs as a Vercel serverless function, and a loose file only reaches the
// bundle if file tracing happens to include it. An import is a hard dependency
// the bundler cannot miss — the same "make the deploy-time graph explicit"
// lesson the jose/ERR_REQUIRE_ESM incident taught.

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "dist", "index.html");
// Generated INTO this package and committed: `index.ts` re-exports it, so the
// consuming app imports a package rather than a path into another workspace.
const target = join(here, "timeline-app-html.ts");

const html = readFileSync(source, "utf8");

// Backticks and ${ } would terminate or interpolate the template literal.
const escaped = html.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

// Not named `module`: that shadows the CommonJS global and trips
// @next/next/no-assign-module-variable.
const moduleSource = `// GENERATED FILE — do not edit.
// Built from src/ by \`npm run build\` in @storyboard/timeline-widget.
// Edit the sources there and rebuild.
//
// The MCP Apps UI, inlined as a string so the serverless function can serve it
// as a ui:// resource with no runtime file access.

export const TIMELINE_APP_HTML = \`${escaped}\`;
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, moduleSource, "utf8");

console.log(
  `[mcp-app] wrote ${target} (${(html.length / 1024).toFixed(0)} KB of HTML)`,
);
