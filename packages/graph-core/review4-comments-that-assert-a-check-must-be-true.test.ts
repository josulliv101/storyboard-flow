// Fourth review round — the prose is load-bearing, so a false line in it is a
// defect.
//
// This package documents WHY, records the measurement behind each decision, and
// names the rejected alternative. A reader is meant to be able to trust it, and
// review3 already caught this exact failure mode once:
// review3-consumers-go-through-the-accessors.test.ts opens on "comments
// describing checks that did not exist, three of which caused the bug beneath
// them."
//
// Three more were found by auditing every comment that asserts a CHECK or a
// BOUND against the code. Two were false and one was stale; a fourth candidate
// turned out to be TRUE and was left alone (see the note at the end).
//
// The tests below pin the ACTUAL behaviour, so the corrected comments cannot
// drift back: if someone makes `deadRevById` disjoint, or teaches `resolveDrop`
// the budgets, these fail and point at the prose that has to change with it.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "./types";
import { createEngine } from "./engine";
import { getSubtreeRev } from "./graph";

type Clip = Readonly<{ title: string }>;
type ClipEdit = Readonly<{ title?: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const title = ({ ...raw } as Record<string, unknown>)["title"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    return { ok: true, value: { title } };
  },
  serialize(data): unknown {
    return { title: data.title };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
  },
});

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

const types = [clipType, folderType] as const;
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
const c1 = parseNodeId("c1");

function twoClips(maxNodes?: number) {
  const engine = createEngine<Types, Summary, {}>(
    maxNodes === undefined
      ? { types, summary, folds: {} }
      : { types, summary, folds: {}, maxNodes },
  );
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes: [
      { id: "root", kind: "folder", data: { name: "R" }, children: ["c1", "c2"] },
      { id: "c1", kind: "clip", data: { title: "One" } },
      { id: "c2", kind: "clip", data: { title: "Two" } },
    ],
  });
  if (!loaded.ok) throw new Error("fixture failed to load");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

// ---------------------------------------------------------------------------
// 1. deadRevById is NOT disjoint, and no check says otherwise
// ---------------------------------------------------------------------------

describe("the tombstone store overlaps the live one, inertly", () => {
  it("a removed id that comes back is in BOTH maps", () => {
    // The comment on `Graph.deadRevById` used to say "an id is live or dead,
    // never both", and cite invariant check 6 as asserting it. Check 6 requires
    // every LIVE node to have a rev and never reads `deadRevById`; the overlap
    // needs nothing more exotic than remove-then-undo.
    const { store } = twoClips();

    expect(store.dispatch({ type: "remove-nodes", nodeIds: [c1] }).ok).toBe(true);
    const removed = store.getGraph();
    expect(removed.subtreeRevById.has(c1)).toBe(false);
    expect(removed.deadRevById.has(c1)).toBe(true);

    expect(store.undo().ok).toBe(true);
    const restored = store.getGraph();
    expect(restored.subtreeRevById.has(c1)).toBe(true);
    // THE OVERLAP. Asserted, not merely observed — the tombstone is left in
    // place on purpose, because `applyInserted` seeds the returning id ABOVE it
    // and that is what the high-water rule requires.
    expect(restored.deadRevById.has(c1)).toBe(true);
  });

  it("and the live entry always wins, which is what makes it inert", () => {
    const { store } = twoClips();
    expect(store.dispatch({ type: "remove-nodes", nodeIds: [c1] }).ok).toBe(true);
    const tombstone = store.getGraph().deadRevById.get(c1);
    expect(tombstone).toBeDefined();

    expect(store.undo().ok).toBe(true);
    const restored = store.getGraph();
    // `getSubtreeRev` reads the live map first and only falls through for an id
    // with no live entry, so the stale dead number can never be the answer for
    // a node that is back.
    expect(getSubtreeRev(restored, c1)).toBe(restored.subtreeRevById.get(c1));
    // And the live rev sits at or above the tombstone, never below it — walking
    // a returning id back down is the fold-cache poisoning `applyRemoved`
    // documents.
    expect(getSubtreeRev(restored, c1)).toBeGreaterThanOrEqual(tombstone ?? 0);
  });

  it("the audit is satisfied throughout, because it does not police this map", () => {
    const { engine, store } = twoClips();
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.dispatch({ type: "remove-nodes", nodeIds: [c1] }).ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.undo().ok).toBe(true);
    // Overlapping, and valid. If a future check DOES start policing
    // `deadRevById`, this is the line that will notice.
    expect(store.getGraph().deadRevById.has(c1)).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. resolveDrop runs the structural checks, not the budgets
// ---------------------------------------------------------------------------

describe("resolveDrop refuses the illegal gesture but not the unaffordable one", () => {
  it("refuses a structurally illegal drop while it is still a gesture", () => {
    // This half of the docblock is true and worth pinning beside the half that
    // was not: dropping a container into its own subtree is refused here, not
    // one dispatch later.
    const engine = createEngine<Types, Summary, {}>({ types, summary, folds: {} });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: ["outer"] },
        {
          id: "outer",
          kind: "folder",
          data: { name: "O" },
          children: ["inner"],
        },
        { id: "inner", kind: "folder", data: { name: "I" }, children: [] },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const resolved = store.resolveDrop({
      type: "move",
      nodeIds: [parseNodeId("outer")],
      toParentId: parseNodeId("inner"),
      toIndexBefore: 0,
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("would-create-cycle");
  });

  it("accepts a drop the ceiling will refuse one step later", () => {
    // The half that was false. `maxNodes: 3` on a 3-node graph: the gesture
    // reads as legal and the command it produced is then refused.
    const { store } = twoClips(3);
    expect(store.getGraph().nodesById.size).toBe(3);

    const resolved = store.resolveDrop({
      type: "insert",
      toParentId: rootId,
      toIndexBefore: 0,
      seeds: [{ kind: "clip", data: { title: "N" } }],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const dispatched = store.dispatch(resolved.value);
    expect(dispatched.ok).toBe(false);
    if (dispatched.ok) return;
    expect(dispatched.error.code).toBe("would-exceed-max-nodes");

    // Nothing was written, which is why this is a gesture-layer gap and not a
    // correctness bug: the command door still refused.
    expect(store.getGraph().nodesById.size).toBe(3);
  });
});

// A FOURTH CANDIDATE, CHECKED AND LEFT ALONE. `documentOrderComparator` claims
// the pathological bucket — one content key in every collection — "costs the
// same order as the rebuild it replaces. It is never worse than the rebuild,
// and for every realistic bucket it is not close." Measured against the walk it
// replaces, on exactly that shape:
//
//     collections x width      comparator     rebuild     ratio
//       40 x 40   (1,641)         0.04 ms     0.27 ms      0.15
//       80 x 80   (6,481)         0.03 ms     0.54 ms      0.06
//      160 x 160 (25,761)         0.04 ms     2.41 ms      0.02
//
// Six to fifty times FASTER, and pulling further ahead as the graph grows. The
// claim is sound and no test is added for it: a cost gate that can only ever
// pass is noise, and the audit that matters here has already been done once.
