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
// drift back: if someone teaches `resolveDrop` the budgets, or lets a returning
// id resume below where it died, these fail and point at the prose that has to
// change with it.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";
import { getSubtreeRev } from "../graph";

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
// 1. a removed id keeps no per-id state, and a returning one still resumes high
// ---------------------------------------------------------------------------

// WHAT THIS BLOCK USED TO PIN, and why it is written differently now. The
// comment on `Graph.deadRevById` claimed "an id is live or dead, never both"
// and cited invariant check 6 as asserting it; both halves were false, so these
// tests pinned the ACTUAL overlap so the corrected prose could not drift back.
//
// The tombstone store is gone — replaced by `Graph.revFloor`, one number at or
// above every revision this lineage has issued — so there is no longer a second
// map to overlap with. The PROPERTY those tests were ultimately protecting is
// unchanged and is what they assert now: a returning id must resume above every
// revision its previous life could have cached, or the fold cache serves the
// dead lineage's values.
describe("a removed id leaves nothing behind, and comes back above it", () => {
  it("is in NO map once removed, and reads the absent sentinel", () => {
    const { store } = twoClips();
    const before = getSubtreeRev(store.getGraph(), c1);
    expect(before).toBeGreaterThan(0);

    expect(store.dispatch({ type: "remove-nodes", nodeIds: [c1] }).ok).toBe(true);
    const removed = store.getGraph();
    expect(removed.subtreeRevById.has(c1)).toBe(false);
    // 0 is the absent-id sentinel, and no live node ever holds it — which is
    // what makes the removal visible to the removed node's own subscribers
    // without keeping a row behind for them to compare against.
    expect(getSubtreeRev(removed, c1)).toBe(0);
    expect(getSubtreeRev(removed, c1)).not.toBe(before);
    // The floor still remembers, for every id at once.
    expect(removed.revFloor).toBeGreaterThanOrEqual(before);
  });

  it("resumes above everything its last life could have cached", () => {
    const { store } = twoClips();
    // Move its revision along first, so "above where it died" is a real bar.
    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: c1, kind: "clip", edit: { title: "edited" } }],
      }).ok,
    ).toBe(true);
    const whileLive = getSubtreeRev(store.getGraph(), c1);

    expect(store.dispatch({ type: "remove-nodes", nodeIds: [c1] }).ok).toBe(true);
    expect(store.undo().ok).toBe(true);

    const restored = store.getGraph();
    expect(restored.subtreeRevById.has(c1)).toBe(true);
    // THE RULE. Walking a returning id back down is the fold-cache poisoning
    // `applyRemoved` documents, and this is the line that would catch it.
    expect(getSubtreeRev(restored, c1)).toBeGreaterThan(whileLive);
  });

  it("the audit polices the floor throughout, where it policed nothing before", () => {
    // The old block ended by noting that no check read `deadRevById` at all.
    // The floor is one number maintained by each arm rather than a row written
    // beside each id, so it CAN drift — and invariant check 10 is what makes
    // that loud instead of silent.
    const { engine, store } = twoClips();
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.dispatch({ type: "remove-nodes", nodeIds: [c1] }).ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.undo().ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();

    // And it really would notice: a graph whose floor has fallen behind its own
    // revisions is exactly the state a forgetful arm would produce.
    const good = store.getGraph();
    const drifted = { ...good, revFloor: 0 };
    const violation = engine.findInvariantViolation(drifted);
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe("revision-past-floor");
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
