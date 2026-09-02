// Sixth review round — the cyclic-seed guard sat behind the door it protected.
//
// `applyInsertNodes` runs two walks over the seed forest, in this order:
//
//   1. `tallestSeed`, the DEPTH pre-check. Runs ONLY when `maxDepth` is set.
//   2. `buildSeedPlacements`, the expansion — which carries the cyclic-seed
//      guard, and is the only thing that ever carried it.
//
// So a seed that contains itself was refused when `maxDepth` was unset and HUNG
// when it was set. `tallestSeed`'s post-order loop re-pushes an unexpanded frame
// for a seed whose children it cannot finish, and a seed that is its own child
// can never finish: the stack grows by one frame per iteration until the process
// dies. MEASURED, the same self-referencing seed at the same `maxNodes`, with
// only `maxDepth` differing:
//
//   maxDepth omitted (the default)   parse-failed, 1 ms
//   maxDepth: 10                     worker exited unexpectedly, ~10 s
//
// SETTING THE CEILING IS WHAT OPENED THE HOLE, which is the part worth keeping:
// `maxDepth` is the control a consumer reaches for precisely because seed
// nesting is untrusted, and reaching for it turned a clean refusal into a hang.
//
// `tallestSeed` asserted the guard it did not have — "a cyclic seed is the one
// shape that could leave one missing, and `buildSeedPlacements` refuses that
// with `parse-failed`" — naming a check that runs AFTERWARDS. The fourth round
// has a whole file about comments that assert a check must be true.
//
// AND THE SUITE TESTED BOTH AXES WITHOUT CROSSING THEM.
// `review4-a-seed-forest-is-a-dag-not-a-tree` covers a DAG WITH `maxDepth`, and
// a cycle WITHOUT it. The one cell of that 2x2 that hangs is the one nobody
// wrote, so this file is the crossing rather than a new shape.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  type Seed,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ name?: string }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const name = ({ ...raw } as Record<string, unknown>)["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data): unknown {
    return { name: data.name };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, name: edit.name ?? data.name } };
  },
});

const types = [folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const n = ({ ...raw } as Record<string, unknown>)["n"];
    if (typeof n !== "number") {
      return { ok: false, error: [{ path: "$.n", message: "n" }] };
    }
    return { ok: true, value: { n } };
  },
  serialize(value): unknown {
    return { n: value.n };
  },
};

const rootId = parseNodeId("root");

function storeWith(config: Readonly<{ maxNodes?: number; maxDepth?: number }>) {
  const engine = createEngine<Types, Summary, {}>({
    types,
    summary,
    folds: {},
    ...config,
  });
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { folder: 1 },
    rootIds: ["root"],
    nodes: [{ id: "root", kind: "folder", data: { name: "R" }, children: [] }],
  });
  if (!loaded.ok) throw new Error("fixture failed to load");
  return engine.createStore(loaded.value.graph);
}

/** A seed that is its own child. The shortest cycle there is. */
function selfReferencing(): Seed<Types, Summary> {
  const seed: { kind: "folder"; data: Folder; children: unknown[] } = {
    kind: "folder",
    data: { name: "self" },
    children: [],
  };
  seed.children.push(seed);
  return seed as unknown as Seed<Types, Summary>;
}

/** A two-step cycle, so the guard cannot be a bare `seed.children.includes(seed)`. */
function mutuallyReferencing(): Seed<Types, Summary> {
  const a: { kind: "folder"; data: Folder; children: unknown[] } = {
    kind: "folder",
    data: { name: "a" },
    children: [],
  };
  const b: { kind: "folder"; data: Folder; children: unknown[] } = {
    kind: "folder",
    data: { name: "b" },
    children: [],
  };
  a.children.push(b);
  b.children.push(a);
  return a as unknown as Seed<Types, Summary>;
}

describe("a cyclic seed is refused at the depth pre-check too", () => {
  // Short timeouts on purpose. The defect is a non-terminating loop, so the
  // honest failure signal is the clock, not an assertion — and a default-length
  // timeout on a loop that allocates a frame per iteration reaches the heap
  // limit and takes the worker down before vitest can report anything.
  it("refuses a self-referencing seed WITH maxDepth set", () => {
    const store = storeWith({ maxDepth: 10, maxNodes: 100 });
    const refused = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [selfReferencing()],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("parse-failed");
    expect(refused.error.issues).toEqual([
      { path: "$.children", message: "cyclic seed" },
    ]);
  }, 5_000);

  it("refuses a mutually-referencing pair WITH maxDepth set", () => {
    const store = storeWith({ maxDepth: 10, maxNodes: 100 });
    const refused = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [mutuallyReferencing()],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("parse-failed");
  }, 5_000);

  it("refuses a cycle buried under legitimate nesting", () => {
    // The cycle is not at the root of the forest, so the guard has to survive a
    // descent rather than fire on the first frame it sees.
    const store = storeWith({ maxDepth: 10, maxNodes: 100 });
    const outer: Seed<Types, Summary> = {
      kind: "folder",
      data: { name: "outer" },
      children: [
        { kind: "folder", data: { name: "leaf" }, children: [] },
        mutuallyReferencing(),
      ],
    };
    const refused = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [outer],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("parse-failed");
  }, 5_000);

  it("refuses the same seed IDENTICALLY with maxDepth unset", () => {
    // The rejection a consumer reads must not depend on which of the two walks
    // caught it — the house rule `applyInsertNodes` already states for the node
    // ceiling ("shaped exactly like the post-hoc one so a consumer cannot tell
    // which arm refused"), applied to the other guard.
    const withCeiling = storeWith({ maxDepth: 10, maxNodes: 100 }).dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [selfReferencing()],
    });
    const without = storeWith({ maxNodes: 100 }).dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [selfReferencing()],
    });
    expect(withCeiling.ok).toBe(false);
    expect(without.ok).toBe(false);
    if (withCeiling.ok || without.ok) return;
    expect(withCeiling.error).toEqual(without.error);
  }, 5_000);

  it("still measures a legal DAG rather than refusing it", () => {
    // The guard must not cost the traffic it sits in front of. A shared child
    // object is a DAG, not a cycle, and it stays legal — this is the case the
    // fourth round made cheap, re-asserted here because the fix touches the
    // same walk.
    const store = storeWith({ maxDepth: 4, maxNodes: 100 });
    const shared: Seed<Types, Summary> = {
      kind: "folder",
      data: { name: "shared" },
      children: [],
    };
    const accepted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      // Depth 3 under a root at depth 1: root -> parent -> shared, twice over.
      seeds: [
        { kind: "folder", data: { name: "parent" }, children: [shared, shared] },
      ],
    });
    expect(accepted.ok).toBe(true);
  }, 5_000);
});
