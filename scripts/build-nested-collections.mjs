// NO SHEBANG, deliberately, and this is the one line in the file that will look
// like an oversight. `count-loc.mjs` and both `find-unreachable-*.mjs` carry one
// and this was copied from them — but none of those is IMPORTED, and this one is:
// `the-build-output-is-publishable.test.ts` loads it to drive `buildTo`.
//
// A shebang on a file vite imports fails to parse when the checkout uses CRLF,
// with a bare `SyntaxError: Invalid or unexpected token` and no location. CI is
// Linux and LF, so it passes there and breaks only on a Windows working copy —
// the "green in CI, broken on the machine" shape, inverted. It is invoked as
// `node scripts/build-nested-collections.mjs`, never executed directly, so the
// shebang bought nothing.
/**
 * Build `@josulliv101/nested-collections` for publication.
 *
 * A script rather than a tool config, for the reason `count-loc.mjs` is one:
 * every decision here has a reason that has to be readable, and two of them are
 * load-bearing enough that a `tsup.config.ts` with three keys would hide them.
 *
 * WHAT IT PRODUCES
 *
 *   dist/core/index.js        the engine, bundled, no React anywhere in it
 *   dist/react/index.js       the bindings, bundled, `"use client"` intact
 *   dist/types/**             declarations, mirroring the source layout
 *
 * WHY BUNDLE AT ALL, when `tsc` could emit the tree directly: the source imports
 * extensionlessly (`from "../types"`), which `moduleResolution: "bundler"`
 * permits and Node's ESM resolver does not. `tsc` does not rewrite those, so a
 * plain declaration-plus-JS emit produces a package that typechecks and cannot
 * be imported. Bundling resolves them at build time.
 *
 * TWO THINGS THIS FILE EXISTS TO GET RIGHT
 *
 * 1. `"use client"` MUST SURVIVE onto the React entry, EXACTLY ONCE. Lose it and
 *    the entry silently becomes a server module — the same failure the boundary
 *    test guards in the other direction, and just as invisible.
 *
 *    This carried a `banner` to re-attach it, on the belief that esbuild drops
 *    directives when it bundles. MEASURED, building the React entry both ways:
 *
 *      banner off -> ["use client";, "", "// ...bindings.tsx"]
 *      banner on  -> ["use client";, "use client";, ""]
 *
 *    esbuild hoists the entry's directive to the top of the output on its own,
 *    so the banner was not protecting anything — it was emitting a SECOND copy.
 *    Harmless to bundlers and wrong, and it also meant the guard on the built
 *    output could not fail: removing the banner changed nothing it could see.
 *    The guard now asserts the count, which is the assertion that has teeth.
 *
 * 2. THE REACT BUNDLE MUST NOT INLINE THE CORE. `engine/defaults.ts` keeps a
 *    module-level `mintCounter`, documented as "process-wide, not per-engine,
 *    and that is the point": it is what makes an intra-process id collision
 *    impossible regardless of what `Math.random` does. Two copies of the core in
 *    one process means two counters, and that guarantee falls back to the random
 *    suffix alone. So the React entry IMPORTS the core rather than embedding it,
 *    which the `externalCore` plugin below enforces by rewriting the specifier.
 *
 * Exported rather than only executed, so the build can be verified against its
 * OUTPUT — see `the-build-preserves-the-client-directive.test.ts`. Checking the
 * source would prove nothing about either of the two points above.
 */
import { rmSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE = join(ROOT, "packages", "nested-collections");

/** Shared by both bundles. `neutral` so nothing Node- or browser-specific is
 *  assumed; the core runs in a route handler, a browser and a bare vitest. */
const SHARED = {
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2020",
  // Bare specifiers stay external — `react` above all, which is an OPTIONAL
  // peer dependency and must never be inlined into anything.
  packages: "external",
  legalComments: "inline",
};

/**
 * Rewrite the React half's import of the core into a relative path that is
 * correct in `dist/`, and mark it external so it is not embedded.
 *
 * The source says `../../core` (from `react/src/`). In the output that has to
 * become `../core/index.js`, because `dist/react/index.js` and
 * `dist/core/index.js` are siblings. Matching on the RESOLVED path rather than
 * the specifier text means a file that reaches the core by some other relative
 * depth is caught too.
 */
const externalCore = {
  name: "external-core",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return null;
      if (!args.path.startsWith(".")) return null;
      const resolved = resolve(args.resolveDir, args.path);
      const coreDir = join(PACKAGE, "core") + sep;
      if (resolved === join(PACKAGE, "core") || resolved.startsWith(coreDir)) {
        return { path: "../core/index.js", external: true };
      }
      return null;
    });
  },
};

/** `tsc` twice, because the two halves compile under different `lib`s and that
 *  difference is the package's central rule. One run would erase it. */
function emitDeclarations(outDir) {
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  for (const half of ["core", "react"]) {
    const run = spawnSync(
      process.execPath,
      [tsc, "-p", "tsconfig.build.json", "--outDir", join(outDir, "types")],
      { cwd: join(PACKAGE, half), encoding: "utf8" },
    );
    if (run.status !== 0) {
      throw new Error(
        `declaration emit failed for ${half}:\n${run.stdout ?? ""}${run.stderr ?? ""}`,
      );
    }
  }
}

/**
 * Build both entries into `outDir`. Returns the paths written, so a caller can
 * assert on them without guessing the layout.
 */
export async function buildTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });

  await esbuild({
    ...SHARED,
    entryPoints: [join(PACKAGE, "core", "index.ts")],
    outfile: join(outDir, "core", "index.js"),
  });

  await esbuild({
    ...SHARED,
    entryPoints: [join(PACKAGE, "react", "index.ts")],
    outfile: join(outDir, "react", "index.js"),
    plugins: [externalCore],
    // NO BANNER. esbuild hoists the entry's own `"use client"` to the top of the
    // output; adding one emits it twice. See the header for the measurement.
    // What guarantees it is present is the assertion on the built file, not
    // anything this config does.
  });

  emitDeclarations(outDir);

  return {
    core: join(outDir, "core", "index.js"),
    react: join(outDir, "react", "index.js"),
    coreTypes: join(outDir, "types", "core", "index.d.ts"),
    reactTypes: join(outDir, "types", "react", "index.d.ts"),
  };
}

async function main() {
  const outDir = join(PACKAGE, "dist");
  const written = await buildTo(outDir);
  for (const [label, file] of Object.entries(written)) {
    const ok = existsSync(file);
    console.log(
      `${ok ? "ok  " : "MISS"} ${label.padEnd(10)} ${relative(ROOT, file).split(sep).join("/")}`,
    );
    if (!ok) process.exitCode = 1;
  }
}

// Only when RUN, not when imported — the same rule `count-loc.mjs` states, and
// here it is what lets the verification test drive `buildTo` into a temp
// directory without a stray `dist/` appearing as a side effect.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
