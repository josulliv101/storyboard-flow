// Fifth review round — the tombstone store becomes one number.
//
// `subtreeRevById` is the fold cache's ONLY invalidation mechanism: an entry
// keyed (foldKey, nodeId, rev) becomes unreachable once the rev moves past it,
// which is why nothing ever evicts for correctness. So a re-inserted id must not
// restart below where it died, or the table serves the DEAD lineage's values —
// a wrong aggregate at the root that does not self-heal. That has shipped twice.
//
// The answer was a per-id tombstone store. It was correct and unbounded:
// `applyRemoved` copied it whole on every removal, so a delete cost what the
// SESSION had deleted rather than what the document held. MEASURED,
// insert-then-remove one node in a loop with the live count pinned at 1 —
// 0.045 ms per delete at 1,000 tombstones, 0.195 ms at 4,000, 0.478 ms at 8,000,
// with D separate deletions copying D^2/2 entries in total.
//
// `Graph.revFloor` replaces it: one number at or above every revision this
// lineage has ever issued. STRICTLY STRONGER than the tombstone it replaced —
// "above every rev ANY node ever had" implies "above every rev THIS id ever
// had" — and O(1) to carry.
//
// TWO THINGS IT TRADES FOR, and this file exists for both.
//
// The floor is maintained by each arm rather than derived, so an arm that bumps
// and forgets to raise it lets a returning id collide with a cached rev,
// silently. `bumpSubtreeRevsInto` reports the highest value it wrote so a caller
// cannot compute it independently and drift, and invariant check 10 audits the
// result. That check earned its keep immediately: it caught two arms
// (`applyNonUndoableWriteEdits` and `markMissing`) that this change had missed.
//
// And 0 became a sentinel. `getSubtreeRev` answers 0 for an id the graph does
// not hold, which is what makes a removal visible to the removed node's own
// subscribers without keeping a row behind to compare against — so no live node
// may sit at 0, and every seed is `INITIAL_REV`. Seeding at 0, as this did, made
// a never-edited node read 0 both before and after its own removal.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedFold,
  type ConsumerDefinedSummaryType,
  type Graph,
  type Issue,
  type NodeId,
  type Result,
  defineNodeType,
  getSubtreeRev,
  INITIAL_REV,
  parseNodeId,
} from "../index";
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

/** Counts live nodes under a subtree. The aggregate a stale entry corrupts. */
const sizeFold: ConsumerDefinedFold<Types, Summary, number> = {
  key: "size",
  leaf() {
    return 1;
  },
  collection(_node, children) {
    let total = 1;
    for (const child of children) total += child.value;
    return { value: total, certainty: "exact" };
  },
  placeholder() {
    return { value: 0, certainty: "partial" };
  },
  missing() {
    return { value: 0, certainty: "partial" };
  },
  sealed() {
    return { value: 0, certainty: "partial" };
  },
};

const rootId = parseNodeId("root");

function makeStore(devChecks = false) {
  const engine = createEngine<Types, Summary, { size: typeof sizeFold }>({
    types,
    summary,
    folds: { size: sizeFold },
    devChecks,
  });
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { folder: 1 },
    rootIds: ["root"],
    nodes: [
      { id: "root", kind: "folder", data: { name: "R" }, children: ["a", "b"] },
      { id: "a", kind: "folder", data: { name: "A" }, children: [] },
      { id: "b", kind: "folder", data: { name: "B" }, children: [] },
    ],
  });
  if (!loaded.ok) throw new Error("fixture failed to load");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

/** Deterministic LCG. A fuzz that cannot be re-run on its failing seed is a
 *  flake, not a test — the same rule `move-cost.test.ts` states. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function everyRev<S>(graph: Graph<Types, S>): readonly number[] {
  return [...graph.subtreeRevById.values()];
}

describe("a revision floor replaces the tombstone store", () => {
  it("no live node sits at 0, and 0 means absent", () => {
    const { store } = makeStore();
    const graph = store.getGraph();
    for (const rev of everyRev(graph)) expect(rev).toBeGreaterThan(0);
    expect(graph.subtreeRevById.get(rootId)).toBe(INITIAL_REV);
    expect(getSubtreeRev(graph, parseNodeId("nobody"))).toBe(0);
  });

  it("a removal is visible to the removed node's own subscribers", () => {
    // The property the tombstone's `+ 1` existed for, now carried by the
    // sentinel. `commitGraph` compares `getSubtreeRev` across the commit.
    const { store } = makeStore();
    const aId = parseNodeId("a");
    let woke = 0;
    store.subscribeToNode(aId, () => {
      woke += 1;
    });
    const before = getSubtreeRev(store.getGraph(), aId);
    expect(store.dispatch({ type: "remove-nodes", nodeIds: [aId] }).ok).toBe(true);
    expect(getSubtreeRev(store.getGraph(), aId)).not.toBe(before);
    expect(woke).toBe(1);
  });

  it("a NEVER-EDITED node's removal is visible too", () => {
    // The case seeding at 0 could not express: with the old seed this node read
    // 0 before its removal and 0 after, so its subscribers never fired. It is
    // why `INITIAL_REV` is 1 rather than a matter of taste.
    const { store } = makeStore();
    const bId = parseNodeId("b");
    expect(getSubtreeRev(store.getGraph(), bId)).toBe(INITIAL_REV);
    let woke = 0;
    store.subscribeToNode(bId, () => {
      woke += 1;
    });
    expect(store.dispatch({ type: "remove-nodes", nodeIds: [bId] }).ok).toBe(true);
    expect(woke).toBe(1);
  });

  it("churn no longer grows anything the next commit has to copy", () => {
    // THE POINT OF THE CHANGE. This loop left one tombstone per cycle behind
    // before, in a map every subsequent removal copied whole.
    const { store } = makeStore();
    for (let i = 0; i < 200; i += 1) {
      const inserted = store.dispatch({
        type: "insert-nodes",
        toParentId: rootId,
        toIndex: 0,
        seeds: [{ kind: "folder", data: { name: "N" } }],
      });
      if (!inserted.ok) throw new Error(inserted.error.code);
      const kids = store.getGraph().childrenById.get(rootId) ?? [];
      const id = kids[0];
      if (id === undefined) throw new Error("child missing");
      const removed = store.dispatch({ type: "remove-nodes", nodeIds: [id] });
      if (!removed.ok) throw new Error(removed.error.code);
      store.clearHistory();
    }
    const graph = store.getGraph();
    // Exactly total over the live nodes — no per-id residue at all.
    expect(graph.subtreeRevById.size).toBe(graph.nodesById.size);
    expect(graph.nodesById.size).toBe(3);
    // The floor moved, because it is a high-water mark. It is a number.
    expect(graph.revFloor).toBeGreaterThan(INITIAL_REV);
  });

  it("a re-inserted id never reuses a revision its dead lineage cached", () => {
    // THE P1, through the public store, with the fold cache live. The gesture is
    // the one `applyRemoved` documents: read a rollup, edit, delete, bring it
    // back, and read again.
    const { store } = makeStore();
    const aId = parseNodeId("a");

    const seen = new Set<number>();
    seen.add(getSubtreeRev(store.getGraph(), aId));
    expect(store.aggregate("size", rootId)?.value).toBe(3);

    for (let round = 0; round < 5; round += 1) {
      expect(
        store.dispatch({
          type: "edit-nodes",
          edits: [{ nodeId: aId, kind: "folder", edit: { name: `r${round}` } }],
        }).ok,
      ).toBe(true);
      seen.add(getSubtreeRev(store.getGraph(), aId));
      expect(store.dispatch({ type: "remove-nodes", nodeIds: [aId] }).ok).toBe(true);
      expect(store.undo().ok).toBe(true);
      const back = getSubtreeRev(store.getGraph(), aId);
      // Never a revision this id has held before — that is exactly what would
      // let the memo table answer with the dead lineage's value.
      expect(seen.has(back)).toBe(false);
      seen.add(back);
      // And the aggregate is right every time, which is the symptom that
      // would show if it were not.
      expect(store.aggregate("size", rootId)?.value).toBe(3);
    }
  });

  it("holds the floor invariant across randomised operation sequences", () => {
    // The floor is maintained by each arm rather than derived, so the way to be
    // wrong is an arm that bumps and forgets. Check 10 is the audit; this drives
    // it over sequences nobody hand-picked.
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const random = makeRandom(seed);
      const { engine, store } = makeStore();
      let minted = 0;

      for (let step = 0; step < 60; step += 1) {
        const graph = store.getGraph();
        const live = [...graph.nodesById.keys()].filter((id) => id !== rootId);
        const pick = (): NodeId | undefined =>
          live[Math.floor(random() * live.length)];
        const roll = random();

        if (roll < 0.3 || live.length === 0) {
          minted += 1;
          store.dispatch({
            type: "insert-nodes",
            toParentId: rootId,
            toIndex: 0,
            seeds: [{ kind: "folder", data: { name: `n${minted}` } }],
          });
        } else if (roll < 0.5) {
          const victim = pick();
          if (victim !== undefined) {
            store.dispatch({ type: "remove-nodes", nodeIds: [victim] });
          }
        } else if (roll < 0.7) {
          const target = pick();
          if (target !== undefined) {
            store.dispatch({
              type: "edit-nodes",
              edits: [
                { nodeId: target, kind: "folder", edit: { name: `e${step}` } },
              ],
            });
          }
        } else if (roll < 0.8) {
          const mover = pick();
          const into = pick();
          if (mover !== undefined && into !== undefined && mover !== into) {
            store.dispatch({
              type: "move-nodes",
              nodeIds: [mover],
              toParentId: into,
              toIndex: 0,
            });
          }
        } else if (roll < 0.9) {
          store.undo();
        } else {
          store.redo();
        }

        const next = store.getGraph();
        // CHECK 10, every step: no live node at the sentinel, and nothing above
        // the floor. A missed raise anywhere shows up here.
        const violation = engine.findInvariantViolation(next);
        expect(
          violation === null ? null : `${String(seed)}@${String(step)} ${violation.code}`,
        ).toBeNull();
        for (const rev of everyRev(next)) {
          expect(rev).toBeGreaterThan(0);
          expect(rev).toBeLessThanOrEqual(next.revFloor);
        }
      }
    }
  });

  it("check 10 actually fails on a drifted floor", () => {
    // The guard against an audit that cannot fail — the mistake this package
    // deleted a perf gate over.
    const { engine, store } = makeStore();
    expect(store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: parseNodeId("a"), kind: "folder", edit: { name: "x" } }],
    }).ok).toBe(true);

    const good = store.getGraph();
    expect(engine.findInvariantViolation(good)).toBeNull();

    const behind = engine.findInvariantViolation({ ...good, revFloor: 0 });
    expect(behind?.code).toBe("revision-past-floor");

    const zeroed = new Map(good.subtreeRevById);
    zeroed.set(parseNodeId("a"), 0);
    const sentinel = engine.findInvariantViolation({
      ...good,
      subtreeRevById: zeroed,
    });
    expect(sentinel?.code).toBe("revision-past-floor");
  });

  it("survives a lazy load, which seeds arrivals from the floor", () => {
    const engine = createEngine<Types, Summary, { size: typeof sizeFold }>({
      types,
      summary,
      folds: { size: sizeFold },
    });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "R" },
          childrenState: "unloaded" as const,
        },
      ],
    });
    if (!loaded.ok) throw new Error("fixture failed to load");
    const store = engine.createStore(loaded.value.graph);
    const floorBefore = store.getGraph().revFloor;

    const filled = store.load(rootId, {
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["p1"],
      nodes: [{ id: "p1", kind: "folder", data: { name: "P" }, children: [] }],
    });
    expect(filled.ok).toBe(true);

    const graph = store.getGraph();
    expect(engine.findInvariantViolation(graph)).toBeNull();
    const arrived = graph.subtreeRevById.get(parseNodeId("p1")) ?? 0;
    expect(arrived).toBeGreaterThan(floorBefore);
    expect(arrived).toBeLessThanOrEqual(graph.revFloor);
  });
});
