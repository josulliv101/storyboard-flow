// The boundary the package is built around, enforced instead of described.
//
// `createEngine` must stay callable from a route handler. The moment anything
// reachable from the CORE entry carries `"use client"`, a consumer's
// `export const engine = createEngine(...)` lands in a client module, a server
// route imports it, it typechecks clean, and it 500s at request time. The code
// calls that "this repo's most expensive bug class and CI is blind to it" — and
// CI was blind to it, because nothing checked.
//
// It used to be enforced by the two halves being SEPARATE PACKAGES: there was no
// path from one to the other except a dependency the core did not declare. They
// are one package now, published with an `exports` map — `.` for the core,
// `./react` for the bindings — so the guarantee needs something that actually
// looks at the module graph.
//
// THIS WALKS IT. Starting at the core barrel, it follows every relative import
// transitively and asserts that nothing reached carries the directive, imports
// React, or lives under `react/`. A single `export *` added to the core barrel
// would fail it, which is the mistake worth being unable to make.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const REACT_DIR = join(PACKAGE_ROOT, "react") + sep;
const CORE_ENTRY = join(PACKAGE_ROOT, "index.ts");

/** Every relative specifier in a source file. Bare specifiers are handled by
 *  the caller — they cannot be resolved to a file in this package. */
function relativeImports(text: string): readonly string[] {
  const out: string[] = [];
  // `from "..."` covers imports and re-exports; `import("...")` covers dynamic.
  const patterns = [
    /\bfrom\s+["'](\.[^"']*)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']*)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m = re.exec(text);
    while (m !== null) {
      const spec = m[1];
      if (spec !== undefined) out.push(spec);
      m = re.exec(text);
    }
  }
  return out;
}

/** TypeScript's extensionless specifiers, resolved the way the bundler will. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Everything reachable from `entry` by relative import, transitively. */
function reachableFrom(entry: string): readonly string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const spec of relativeImports(text)) {
      const target = resolveSpecifier(file, spec);
      if (target !== null) stack.push(target);
    }
  }
  return [...seen];
}

const show = (file: string): string =>
  relative(PACKAGE_ROOT, file).split(sep).join("/");

describe("the core entry cannot reach the react half", () => {
  const reached = reachableFrom(CORE_ENTRY);

  it("reaches a real module graph, not an empty one", () => {
    // A guard that walks nothing passes forever. The core is ~70 files; if this
    // ever collapses to a handful, the resolver stopped resolving and every
    // assertion below became vacuous.
    expect(reached.length).toBeGreaterThan(30);
    expect(reached.map(show)).toContain("index.ts");
    expect(reached.map(show)).toContain("engine/index.ts");
  });

  it("reaches nothing under react/", () => {
    const leaked = reached.filter((f) => f.startsWith(REACT_DIR)).map(show);
    expect(leaked).toEqual([]);
  });

  it('reaches nothing carrying "use client"', () => {
    const clientish = reached
      .filter((f) => /^\s*["']use client["']/m.test(readFileSync(f, "utf8")))
      .map(show);
    expect(clientish).toEqual([]);
  });

  it("reaches nothing that imports react", () => {
    const reactish = reached
      .filter((f) => /\bfrom\s+["']react(\/[^"']*)?["']/.test(readFileSync(f, "utf8")))
      .map(show);
    expect(reactish).toEqual([]);
  });

  it("the react half really is on the other side of the line", () => {
    // The negative space: without this, all four assertions above would also
    // pass if `react/` simply had no `"use client"` in it at all.
    const entry = join(PACKAGE_ROOT, "react", "index.ts");
    expect(existsSync(entry)).toBe(true);
    expect(/^\s*["']use client["']/m.test(readFileSync(entry, "utf8"))).toBe(true);

    const fromReact = reachableFrom(entry);
    // And it DOES reach the core — one package, one direction.
    expect(fromReact.map(show)).toContain("index.ts");
  });

  it("the exports map names exactly the two entries", () => {
    // The map is what makes the walk above meaningful to a consumer: `.` must
    // not resolve anywhere near `react/`.
    const manifest: unknown = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
    );
    const exportsMap = (manifest as { exports?: Record<string, unknown> }).exports;
    expect(exportsMap).toBeDefined();
    expect(Object.keys(exportsMap ?? {}).sort()).toEqual([".", "./react"]);
    expect(exportsMap?.["."]).toBe("./index.ts");
    expect(exportsMap?.["./react"]).toBe("./react/index.ts");
  });

  it("no source file outside react/ carries the directive", () => {
    // Belt to the walk's braces: the walk only sees what is IMPORTED, so a file
    // added to the core but not yet wired in would be invisible to it.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "react") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
        if (/^\s*["']use client["']/m.test(readFileSync(full, "utf8"))) {
          offenders.push(show(full));
        }
      }
    };
    walk(PACKAGE_ROOT);
    expect(offenders).toEqual([]);
  });
});
