// Fourth review round — the ceiling was checked after the work, not before.
//
// A seed forest is a plain object tree handed in by the consumer, and NOTHING
// stops two branches pointing at the same child object. That is a DAG, not a
// cycle: no seed is its own ancestor, so `buildSeedPlacements`'s cyclic-seed
// guard never fires for it. The walk then visits the shared subtree once per
// PATH, which is 2^depth for one child reused at every level.
//
// `applyInsertNodes` did check `maxNodes` — after `buildSeedPlacements`
// returned, counted from the placements it had already built. So the refusal was
// correct and the cost was not. MEASURED against a `maxNodes` of 50:
//
//   depth      placements built     time      then refused with actual=
//      10                 2,048      4 ms                        2,048
//      12                 8,192     11 ms                        8,192
//      14                32,768     37 ms                       32,768
//      16               131,072    144 ms                      131,072
//
// Doubling per level, all of it to end in `would-exceed-max-nodes` for a ceiling
// of 50. At depth 30 that is two billion placements and the process is gone
// before anything gets to refuse.
//
// After, at every one of those depths: `actual=51`, under a millisecond. The
// walk stops the moment it passes the ceiling, so the cost is O(maxNodes)
// instead of O(2^depth) — the same correction ./serialize made on the ingress
// door, which calls its equivalent "the EARLIEST honest point".
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
  return { engine, store: engine.createStore(loaded.value.graph) };
}

/**
 * A seed DAG: every level reuses the SAME child object twice.
 *
 * Expanded as a tree this is 2^depth nodes. As an object graph it is `depth`
 * objects. Nothing here is cyclic — walk any path from the root and you never
 * meet the same object twice on that path — which is exactly why the
 * cyclic-seed guard cannot catch it.
 */
function sharedChildDag(depth: number): Seed<Types, Summary> {
  let node: Seed<Types, Summary> = {
    kind: "folder",
    data: { name: "leaf" },
    children: [],
  };
  for (let i = 0; i < depth; i += 1) {
    node = { kind: "folder", data: { name: `d${i}` }, children: [node, node] };
  }
  return node;
}

describe("a shared seed child is refused without being expanded", () => {
  it("stops at the ceiling instead of at 2^depth", () => {
    const CEILING = 50;
    for (const depth of [10, 12, 14, 16]) {
      const { store } = storeWith({ maxNodes: CEILING });
      const refused = store.dispatch({
        type: "insert-nodes",
        toParentId: rootId,
        toIndex: 0,
        seeds: [sharedChildDag(depth)],
      });

      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error.code).toBe("would-exceed-max-nodes");

      // THE ASSERTION THAT MATTERS. `actual` is how many placements had been
      // built when the walk stopped, so it is a direct readout of the work
      // done. Before the running budget it was 2^depth — 131,072 at depth 16
      // against a ceiling of 50. Bounded just above the ceiling now, and FLAT
      // as depth grows, which is the property a threshold on time could not
      // state.
      expect(refused.error.actual).toBeLessThanOrEqual(CEILING + 1);

      // Nothing was written: the reducer validates completely, then applies.
      expect(store.getGraph().nodesById.size).toBe(1);
      store.destroy();
    }
  }, 120_000);

  it("does not explode in the DEPTH pre-check either", () => {
    // `tallestSeed` runs before `buildSeedPlacements`, only when `maxDepth` is
    // set, and it walked the same DAG the same exponential way. It memoises by
    // object identity now — a seed's height depends only on the seed, so the
    // same object always has the same answer.
    const { store } = storeWith({ maxDepth: 4, maxNodes: 100_000 });
    const refused = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [sharedChildDag(20)],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    // Depth is answered from the seeds alone and refused first, so this never
    // reaches the node ceiling.
    expect(refused.error.code).toBe("would-exceed-max-depth");
    expect(refused.error.actual).toBe(22);
  }, 120_000);

  it("still refuses a genuinely CYCLIC seed, which is a different shape", () => {
    // A DAG is not a cycle, and the guard for one is not the guard for the
    // other. This is the cycle: a seed reachable from itself.
    const { store } = storeWith({ maxNodes: 100 });
    const cyclic: { kind: "folder"; data: Folder; children: unknown[] } = {
      kind: "folder",
      data: { name: "self" },
      children: [],
    };
    cyclic.children.push(cyclic);

    const refused = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [cyclic as unknown as Seed<Types, Summary>],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("parse-failed");
  }, 120_000);

  it("still accepts an ordinary nested insert, shared objects included", () => {
    // The guard must not cost the traffic it sits in front of. A shared child
    // is LEGAL when the expansion fits — it just means those subtrees are
    // duplicated, which is what the consumer asked for.
    const { engine, store } = storeWith({ maxNodes: 100 });
    const shared: Seed<Types, Summary> = {
      kind: "folder",
      data: { name: "shared" },
      children: [],
    };
    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [
        { kind: "folder", data: { name: "a" }, children: [shared, shared] },
      ],
    });
    expect(inserted.ok).toBe(true);
    // One parent plus two independent copies of the shared child: the objects
    // were shared, the NODES are not.
    expect(store.getGraph().nodesById.size).toBe(4);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.undo().ok).toBe(true);
    expect(store.getGraph().nodesById.size).toBe(1);
  });
});
