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
    // Anything SERVED to a reader must derive its collection summaries.
    //
    // `itemCount`, `previewItems` and `duration` are denormalized onto the
    // PARENT's collection clip, and writes are patch-scoped — editing a child
    // never rewrites the parent that summarizes it. `serveTimelineDocument`
    // recomputes them across the closure; the stored record does not, and its
    // values are routinely wrong.
    //
    // `derive-collection-summaries.ts` justified "served, never persisted" with
    // "every view loads through the same GET route, so no reader ever sees a
    // stale summary". That invariant lived only in a comment, and the remote
    // MCP `read_timeline` broke it — returning the stored record straight to an
    // agent, which saw `previewItems: []` and a stale `itemCount`. It shipped
    // and merged; human review did not catch it (#279, #282). Hence a rule.
    //
    // The allowlist below is the complete set of places raw reads are correct.
    // Adding to it should require saying why in the same breath.
    {
        files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
        ignores: [
            // The derive machinery itself — these READ raw in order to derive.
            "lib/serve-timeline.ts",
            "lib/load-timeline-closure.ts",
            // Write round-trips: read, mutate, write back. Deriving here would
            // PERSIST the summaries, which is the thing the design forbids.
            "app/api/trash/route.ts",
            // Existence + ownership check only; the content is never read.
            "lib/project-asset-scope.ts",
            "lib/project-asset-scope.test.ts",
            // Reads `revision` alone.
            "app/api/timelines/revisions/route.ts",
            // Reads the root raw, then derives explicitly via loadTimelineClosure
            // + deriveClosureSummaries — see the comment at its call site.
            //
            // The BRACKETS MUST BE ESCAPED. `ignores` takes globs, where
            // `[id]` is a character class matching one of `i`, `d`, `n` — so
            // the unescaped path silently matches nothing and this file gets
            // flagged anyway. Every Next dynamic segment in this app has the
            // same shape, so any future entry needs the same treatment.
            "app/api/timelines/\\[id\\]/preview-manifest/route.ts",
        ],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@/lib/firebase-timeline-store",
                            importNames: [
                                "readStoredTimelineDocument",
                                "readStoredTimelineEntry",
                            ],
                            message:
                                "Stored collection summaries (itemCount, previewItems, duration) are stale by design. Use serveTimelineDocument from @/lib/serve-timeline for anything served to a reader. If this is a write round-trip, an existence check, or a revision read, add the file to the allowlist in eslint.config.mjs with a reason.",
                        },
                    ],
                },
            ],
        },
    },
]);
