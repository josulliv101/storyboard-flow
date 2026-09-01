// Typecheck EVERY workspace package that declares a tsconfig.
//
// WHY A SCRIPT and not seven CI steps: the list is derived from what is on
// disk, so a new package is covered the day it is created rather than the day
// someone remembers to add a step. CI had four packages uncovered — including
// both graph packages and `timeline-model`, which did not compile at all and
// had not for long enough that nobody knew.
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const tscEntry = join(root, "node_modules", "typescript", "bin", "tsc");

/**
 * Every tsconfig under `packages/`, ONE LEVEL DEEP AS WELL AS AT THE TOP.
 *
 * A package may carry more than one, and `nested-collections` is why: its core
 * compiles with `lib: ["esnext"]` and NO DOM, which is what proves the engine
 * cannot reach for `document` or import React — and that only holds while the
 * React half is checked by its own config, which names `dom` and `jsx`. One
 * merged config would hand the core a DOM lib and turn the package's central
 * rule back into a convention.
 *
 * Scanning only the top level would therefore have left `react/` unchecked the
 * day the two packages became one — silently, which is the exact failure this
 * script's own header records: "CI had four packages uncovered ... and had not
 * for long enough that nobody knew."
 */
const packages = [];
for (const name of readdirSync(packagesDir)) {
  const dir = join(packagesDir, name);
  if (!statSync(dir).isDirectory()) continue;
  if (existsSync(join(dir, "tsconfig.json"))) packages.push(name);
  for (const inner of readdirSync(dir)) {
    if (inner === "node_modules") continue;
    const innerDir = join(dir, inner);
    if (!statSync(innerDir).isDirectory()) continue;
    if (existsSync(join(innerDir, "tsconfig.json"))) {
      packages.push(`${name}/${inner}`);
    }
  }
}

if (packages.length === 0) {
  console.error("typecheck:packages found no package with a tsconfig.json");
  process.exit(1);
}

let failed = 0;
for (const name of packages) {
  const cwd = join(packagesDir, name);
  process.stdout.write(`typecheck ${name} ... `);
  // The compiler is invoked as a JS entry point through the CURRENT node, not
  // through `npx`. `spawnSync("npx")` fails silently on Windows without a
  // shell — status 1, both streams empty — which reads as "every package is
  // broken" and is really "the command never ran".
  const run = spawnSync(process.execPath, [tscEntry, "--noEmit", "-p", "tsconfig.json"], {
    cwd,
    encoding: "utf8",
  });
  if (run.error !== undefined) {
    failed += 1;
    console.log("FAILED to launch tsc:", run.error.message);
    continue;
  }
  if (run.status === 0) {
    console.log("ok");
    continue;
  }
  failed += 1;
  console.log("FAILED");
  process.stdout.write(`${run.stdout ?? ""}${run.stderr ?? ""}\n`);
}

console.log(
  `\n${packages.length - failed}/${packages.length} packages typecheck clean`,
);
process.exit(failed === 0 ? 0 : 1);
