// Graph — the accessor contract, enforced rather than described.
//
// WHY THIS EXISTS. `Graph` publishes its index maps as public `ReadonlyMap`
// fields, and every one of them has an accessor beside it that means something
// slightly different from the raw `.get`:
//
//   getSubtreeRev   falls back to `deadRevById`, so a REMOVED id answers with
//                   the revision it held rather than `undefined`. Raw reads of
//                   `subtreeRevById` miss that — and `subtreeRevById` is the
//                   render subscription key, so a subscriber comparing
//                   revisions across a removal sees nothing change.
//   getChildren     answers `[]` for anything that is not a loaded collection.
//   getParent       answers `null` for a root AND for an unknown id.
//   childrenStateOf is the ONLY honest answer to "loaded, unloaded, reference
//                   or missing" — the distinction `getChildren` deliberately
//                   collapses and the raw map only half-encodes.
//
// A consumer reading the map directly gets whichever of those the map happens
// to give, which is right until it is not. This is not hypothetical: the four
// sites this test was written alongside were the entire consumer surface of
// the core at the time, and two of them were reading `childrenById` raw precisely
// BECAUSE `getChildren` collapses loaded-and-empty with unloaded — reaching
// past the accessor to recover a distinction `childrenStateOf` already states.
//
// WHY A TEST AND NOT A COMMENT. This package's own review found eight comments
// describing checks that did not exist, three of which caused the bug beneath
// them. A note on the field saying "prefer the accessor" is that same shape.
// This is the check.
//
// WHY NOT A TYPE. Narrowing `Graph` so the maps are unreachable would be a
// mechanical rewrite of the engine's most central type, and it was considered
// and rejected: every field is already a `ReadonlyMap`, which any persistent
// map can implement, so hiding them buys nothing for a future change of
// representation. What is worth protecting is the CONTRACT, and a contract is
// exactly what a test can hold and a type cannot.
//
// SCOPE. Only files that actually import Graph are checked. `collections-core`,
// the predecessor engine, uses the identical field names — `nodesById`,
// `childrenById`, `parentById` — on a type with no accessors and no dead-rev
// fallback, so a repo-wide textual scan would be almost entirely false
// positives. Importing Graph is what makes those names mean Graph's.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The `Graph` fields an accessor exists to interpret. */
const INDEX_FIELDS = [
  "nodesById",
  "childrenById",
  "parentById",
  "subtreeRevById",
  "deadRevById",
  "placementsByContentKey",
  "ownerBySourceKey",
] as const;

/**
 * The accessor to reach for instead — named only where one exists.
 *
 * The two derived indexes have NO accessor today. Naming an imaginary one here
 * would be the exact defect this package's review kept finding: prose asserting
 * a thing that is not there. If a consumer needs them, the fix is to add the
 * accessor to `graph.ts`, which is also where the contract would then live.
 */
const ACCESSOR_FOR: Readonly<Record<string, string>> = {
  nodesById: "getNode / nodeCount",
  childrenById: "getChildren / childrenStateOf",
  parentById: "getParent",
  subtreeRevById: "getSubtreeRev",
  deadRevById: "getSubtreeRev",
  placementsByContentKey: "an accessor you add to graph.ts — there is none yet",
  ownerBySourceKey: "an accessor you add to graph.ts — there is none yet",
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "storybook-static",
  "playwright-report",
  "test-results",
]);

/**
 * Walk up from the working directory to the workspace root. Vitest runs this
 * project from `apps/storybook`, not from the package, so neither `cwd` nor a
 * relative path from here can be assumed — the root is found by looking for the
 * `package.json` that declares the workspaces.
 */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (let hops = 0; hops < 10; hops += 1) {
    const manifest = join(dir, "package.json");
    try {
      const raw: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      if (
        typeof raw === "object" &&
        raw !== null &&
        "workspaces" in raw &&
        Array.isArray((raw as { workspaces: unknown }).workspaces)
      ) {
        return dir;
      }
    } catch {
      // No manifest here, or an unreadable one. Keep climbing.
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "graph accessor guard: could not find the workspace root from " +
      process.cwd(),
  );
}

function sourceFilesUnder(dir: string, out: string[]): void {
  let entries: readonly string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      sourceFilesUnder(full, out);
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
}

type Violation = Readonly<{ file: string; line: number; field: string; text: string }>;

function scan(): Readonly<{ checked: readonly string[]; violations: readonly Violation[] }> {
  const root = workspaceRoot();
  // THE CORE is the implementation: it MUST read its own maps. Its React half
  // is a CONSUMER and must not, so the exemption is the package MINUS `react/`.
  //
  // Both halves used to be separate packages, and the exemption was one path.
  // The merge moved the consumer inside the exempt directory — which is exactly
  // the "renamed package" failure this file's own guard below anticipates, and
  // it would have gone quiet rather than red.
  const packageDir = join(root, "packages", "nested-collections") + sep;
  const coreDir = join(packageDir, "core") + sep;
  const reactDir = join(packageDir, "react") + sep;
  // NAMED, not inferred as "the package minus react/". Those were the same set
  // while the package held only those two things, and the difference is what
  // this guard would get wrong first: anything added beside them — a docs
  // folder, a third entry point — is a CONSUMER and must be checked, where
  // subtracting `react/` would have silently exempted it.
  const isEngineImplementation = (file: string): boolean => file.startsWith(coreDir);

  const files: string[] = [];
  sourceFilesUnder(join(root, "apps"), files);
  sourceFilesUnder(join(root, "packages"), files);

  const checked: string[] = [];
  const violations: Violation[] = [];

  for (const file of files) {
    if (isEngineImplementation(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Only a file that imports Graph can be reading Graph's graph.
    //
    // TWO WAYS TO IMPORT IT NOW, and missing the second is the "changed import
    // specifier" failure the guard below names. An outside consumer names the
    // package; the React half is INSIDE it and reaches the core by relative
    // path, so no specifier to match on — it qualifies by location instead.
    const importsTheEngine =
      text.includes("@josulliv101/nested-collections") || file.startsWith(reactDir);
    if (!importsTheEngine) continue;
    checked.push(relative(root, file).split(sep).join("/"));

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      // A comment naming the field is describing it, not reading it — and this
      // file's whole point is that the fields should be discussed by name.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        continue;
      }
      for (const field of INDEX_FIELDS) {
        if (!line.includes(`.${field}`)) continue;
        violations.push({
          file: relative(root, file).split(sep).join("/"),
          line: i + 1,
          field,
          text: trimmed,
        });
      }
    }
  }

  return { checked, violations };
}

describe("Graph consumers reach the graph through its accessors", () => {
  it("finds the consumer files at all", () => {
    // A guard that silently checks NOTHING passes forever. The scan has three
    // ways to go quiet — a moved workspace root, a renamed package, a changed
    // import specifier — and all three look exactly like success. This asserts
    // the guard has something to guard.
    const { checked } = scan();
    expect(checked.length).toBeGreaterThan(0);
    expect(
      checked.some((f) => f.startsWith("packages/nested-collections/react/")),
    ).toBe(true);
  });

  it("no consumer reads a Graph index map directly", () => {
    const { violations } = scan();
    const report = violations
      .map(
        (v) =>
          `${v.file}:${v.line} reads .${v.field} — use ${ACCESSOR_FOR[v.field] ?? "the accessor"}\n` +
          `    ${v.text}`,
      )
      .join("\n");
    expect(report).toBe("");
  });
});
