// Fourth review round — a rule enforced at one door is a habit, not a rule.
//
// `applyCommand` is the forward door and it is well guarded. `verifyPatchApplies`
// is the REPLAY door — undo, redo, and a peer's patch arriving over the wire —
// and three of the forward door's checks had no twin there. Every serious defect
// this round found was that one shape, so the tests are grouped by it rather
// than by module.
//
//   forward (commands.ts)                    replay (patches.ts)      was
//   ---------------------------------------  ----------------------  --------
//   isSameOrAncestor -> would-create-cycle    verifyMoved             MISSING
//   nodesById.size + n > maxNodes             verifyInserted          MISSING
//   ownsItsSubtree (leaf owns nothing)        planEdits re-derived it  WRONG
//
// The first is the one that destroys documents, and it needs NO hand-built
// patch — two ordinary reducer-produced move patches converge into it. Measured
// before the fix, through the public surface:
//
//   A: move Y into X                          -> ok
//   B: move X into Y (same start document)    -> ok
//   verifyPatchApplies(B-graph, A-patch)      -> {"ok":true}
//   applyPatch                                -> root children [], X<->Y cycle
//   findInvariantViolation                    -> unreachable-node "Y"
//   serialize                                 -> ok, 5 nodes
//   deserialize(that wire)                    -> unreachable-node, FOREVER
//
// A document that saves without error and can never be opened again. The
// invariant audit catches it, but nothing on the write path runs the audit, and
// `applyPatch` is documented (patches.ts:283-289) as deliberately re-checking
// nothing because verify is supposed to have done it.
//
// The cycle check must run against the POST-REMOVAL overlay, not the raw graph:
// in the converging-swap case neither X nor Y is the other's ancestor in the
// pre-state, so a check against `graph.parentById` answers "no cycle" and lets
// it through. That is why this walks the parent map the moves WOULD produce.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

// ---------------------------------------------------------------------------
// Fixture: a leaf and a container that BOTH declare `sourceKey`, which is what
// makes the leaf-ownership case reachable at all.
// ---------------------------------------------------------------------------

type Clip = Readonly<{ title: string; source: string }>;
type ClipEdit = Readonly<{ title?: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    const source = record["source"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    if (typeof source !== "string") {
      return { ok: false, error: [{ path: "$.source", message: "source" }] };
    }
    return { ok: true, value: { title, source } };
  },
  serialize(data): unknown {
    return { title: data.title, source: data.source };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
  },
  sourceKey(data) {
    return data.source;
  },
});

type Folder = Readonly<{ name: string; source: string | null }>;
type FolderEdit = Readonly<{ name?: string }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
    const source = record["source"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    if (source !== null && source !== undefined && typeof source !== "string") {
      return { ok: false, error: [{ path: "$.source", message: "source" }] };
    }
    return { ok: true, value: { name, source: (source as string) ?? null } };
  },
  serialize(data): unknown {
    return { name: data.name, source: data.source };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, name: edit.name ?? data.name } };
  },
  sourceKey(data) {
    return data.source;
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
    const record: Record<string, unknown> = { ...raw };
    const n = record["n"];
    if (typeof n !== "number") {
      return { ok: false, error: [{ path: "$.n", message: "n" }] };
    }
    return { ok: true, value: { n } };
  },
  serialize(value): unknown {
    return { n: value.n };
  },
};

function makeEngine(maxNodes?: number) {
  return createEngine<Types, Summary, {}>(
    maxNodes === undefined
      ? { types, summary, folds: {} }
      : { types, summary, folds: {}, maxNodes },
  );
}

const rootId = parseNodeId("root");

// ---------------------------------------------------------------------------
// 1. A move patch that would create a cycle
// ---------------------------------------------------------------------------

describe("the replay gate refuses a move that would create a cycle", () => {
  /** root -> [Y(folder,[y1]), X(folder,[x1])]. Two sibling folders. */
  const twoSiblingFolders = {
    formatVersion: 1 as const,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes: [
      {
        id: "root",
        kind: "folder",
        data: { name: "Root", source: null },
        children: ["Y", "X"],
      },
      {
        id: "Y",
        kind: "folder",
        data: { name: "Y", source: null },
        children: ["y1"],
      },
      { id: "y1", kind: "clip", data: { title: "y1", source: "a1" } },
      {
        id: "X",
        kind: "folder",
        data: { name: "X", source: null },
        children: ["x1"],
      },
      { id: "x1", kind: "clip", data: { title: "x1", source: "a2" } },
    ],
  };

  it("refuses two ordinary reducer patches that converge into a swap", () => {
    const engine = makeEngine();

    // Peer A moves Y into X. Legal on its own.
    const a = engine.deserialize(twoSiblingFolders);
    // ASSERTED, not just guarded: an early return on a refused load would make
    // this pass vacuously under the very mutation it exists to catch.
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const storeA = engine.createStore(a.value.graph);
    const moveA = storeA.dispatch({
      type: "move-nodes",
      nodeIds: [parseNodeId("Y")],
      toParentId: parseNodeId("X"),
      toIndex: 0,
    });
    expect(moveA.ok).toBe(true);
    if (!moveA.ok) return;

    // Peer B, from the SAME starting document, moves X into Y. Also legal.
    const b = engine.deserialize(twoSiblingFolders);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const storeB = engine.createStore(b.value.graph);
    const moveB = storeB.dispatch({
      type: "move-nodes",
      nodeIds: [parseNodeId("X")],
      toParentId: parseNodeId("Y"),
      toIndex: 0,
    });
    expect(moveB.ok).toBe(true);

    // B gates A's patch the sanctioned way. Neither node is the other's
    // ancestor in B's PRE-state, so only a post-removal walk sees the cycle.
    const verdict = engine.verifyPatchApplies(storeB.getGraph(), moveA.value);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error.code).toBe("would-create-cycle");
  });

  it("refuses a move directly into the moved node's own subtree", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["outer", "spare"],
        },
        {
          id: "outer",
          kind: "folder",
          data: { name: "Outer", source: null },
          children: ["inner"],
        },
        {
          id: "inner",
          kind: "folder",
          data: { name: "Inner", source: null },
          children: [],
        },
        {
          id: "spare",
          kind: "folder",
          data: { name: "Spare", source: null },
          children: [],
        },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // Hand-built, because the reducer will not produce this one — which is the
    // point: the replay door must refuse it without relying on the reducer.
    const verdict = engine.verifyPatchApplies(loaded.value.graph, {
      type: "moved",
      moves: [
        {
          nodeId: parseNodeId("outer"),
          fromParentId: rootId,
          fromIndex: 0,
          toParentId: parseNodeId("inner"),
          toIndex: 0,
        },
      ],
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error.code).toBe("would-create-cycle");
  });

  it("still accepts an ordinary move and its own inverse", () => {
    // The guard must not refuse the legal traffic it sits in front of: a plain
    // move, then the undo of that move, both through the replay door.
    const engine = makeEngine();
    const loaded = engine.deserialize(twoSiblingFolders);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const moved = store.dispatch({
      type: "move-nodes",
      nodeIds: [parseNodeId("x1")],
      toParentId: parseNodeId("Y"),
      toIndex: 0,
    });
    expect(moved.ok).toBe(true);
    expect(store.undo().ok).toBe(true);
    expect(store.redo().ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. An insert patch that would breach the node ceiling
// ---------------------------------------------------------------------------

describe("the replay gate refuses an insert that would breach maxNodes", () => {
  it("refuses the undo that would grow the graph past the ceiling", () => {
    // The reachable shape: a lazy load legitimately consumes the headroom a
    // delete just freed, while the removal patch sleeps on the undo stack.
    // `store.load` does not touch history, so nothing reconciles the two.
    const engine = makeEngine(6);
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["lazy", "c1", "c2", "c3", "c4"],
        },
        {
          id: "lazy",
          kind: "folder",
          data: { name: "Lazy", source: null },
          childrenState: "unloaded",
        },
        { id: "c1", kind: "clip", data: { title: "c1", source: "s1" } },
        { id: "c2", kind: "clip", data: { title: "c2", source: "s2" } },
        { id: "c3", kind: "clip", data: { title: "c3", source: "s3" } },
        { id: "c4", kind: "clip", data: { title: "c4", source: "s4" } },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);
    expect(store.getGraph().nodesById.size).toBe(6);

    // Free two slots.
    const removed = store.dispatch({
      type: "remove-nodes",
      nodeIds: [parseNodeId("c3"), parseNodeId("c4")],
    });
    expect(removed.ok).toBe(true);
    expect(store.getGraph().nodesById.size).toBe(4);

    // Spend them on a lazy page. Legal — this is exactly at the ceiling.
    const load = store.load(parseNodeId("lazy"), {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["L1", "L2"],
      nodes: [
        { id: "L1", kind: "clip", data: { title: "L1", source: "s5" } },
        { id: "L2", kind: "clip", data: { title: "L2", source: "s6" } },
      ],
    });
    expect(load.ok).toBe(true);
    expect(store.getGraph().nodesById.size).toBe(6);

    // The forward door refuses to grow further, correctly.
    const insert = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "clip", data: { title: "extra", source: "s7" } }],
    });
    expect(insert.ok).toBe(false);

    // So must the replay door. Before the fix this returned ok and took the
    // graph to 8 nodes against a ceiling of 6 — a document that then refuses
    // to deserialize, permanently, at that config.
    const undone = store.undo();
    expect(undone.ok).toBe(false);
    if (undone.ok) return;
    expect(undone.error.code).toBe("would-exceed-max-nodes");
    expect(store.getGraph().nodesById.size).toBe(6);

    // And the document it holds is still loadable, which is the actual point.
    const roundTrip = engine.deserialize(engine.serialize(store.getGraph()));
    expect(roundTrip.ok).toBe(true);
  });

  it("still accepts an undo that fits", () => {
    const engine = makeEngine(6);
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["c1", "c2"],
        },
        { id: "c1", kind: "clip", data: { title: "c1", source: "s1" } },
        { id: "c2", kind: "clip", data: { title: "c2", source: "s2" } },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    expect(
      store.dispatch({ type: "remove-nodes", nodeIds: [parseNodeId("c2")] }).ok,
    ).toBe(true);
    expect(store.undo().ok).toBe(true);
    expect(store.getGraph().nodesById.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. A leaf owns no sourceKey — at the EDIT door too
// ---------------------------------------------------------------------------

describe("a leaf owns no sourceKey when it is edited", () => {
  // review3-a-leaf-owns-no-subtree.test.ts fixed three sites and this was the
  // fourth: `planEdits` spelled the rule out again as
  // `collection === null || stateOwnsSubtree(collection.children)`, and
  // `collection === null` IS the leaf case. That is verbatim the predicate
  // review3 deleted. Both edit doors share `planEdits`, so a server-side
  // `applyNonUndoableWrite` could not repair it either.

  it("accepts ONE edit-nodes carrying two leaves that share a source", () => {
    // review3 already covers editing them one at a time. The batch is the
    // gesture types.ts documents as the reason edits are plural: "a rename
    // across every placement of an asset is a single `edit-nodes` over all of
    // them, which is what keeps Ctrl-Z matching what the user thinks they did."
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["c1", "c2"],
        },
        { id: "c1", kind: "clip", data: { title: "One", source: "asset-A" } },
        { id: "c2", kind: "clip", data: { title: "Two", source: "asset-A" } },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(engine.findInvariantViolation(loaded.value.graph)).toBeNull();
    const store = engine.createStore(loaded.value.graph);

    const edited = store.dispatch({
      type: "edit-nodes",
      edits: [
        { nodeId: parseNodeId("c1"), kind: "clip", edit: { title: "A!" } },
        { nodeId: parseNodeId("c2"), kind: "clip", edit: { title: "B!" } },
      ],
    });
    expect(edited.ok).toBe(true);
  });

  it("accepts editing a leaf whose source equals an owning container's", () => {
    // Strictly worse than the batch case and needs no batch: the container
    // legitimately OWNS the key, the leaf legitimately does not, and the edit
    // does not even touch `sourceKey` — `planEdits` re-derives `nextKey` from
    // `nextData` unconditionally. Before the fix this node could not be edited
    // through any write door for as long as the container held that key, on a
    // graph the engine's own audit calls valid.
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["box", "c1"],
        },
        {
          id: "box",
          kind: "folder",
          data: { name: "Box", source: "asset-A" },
          children: ["k1"],
        },
        { id: "k1", kind: "clip", data: { title: "k1", source: "other" } },
        { id: "c1", kind: "clip", data: { title: "One", source: "asset-A" } },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(engine.findInvariantViolation(loaded.value.graph)).toBeNull();
    // The container is the owner, and that is correct.
    expect(loaded.value.graph.ownerBySourceKey.get("asset-A")).toBe("box");
    const store = engine.createStore(loaded.value.graph);

    const edited = store.dispatch({
      type: "edit-nodes",
      edits: [
        { nodeId: parseNodeId("c1"), kind: "clip", edit: { title: "renamed" } },
      ],
    });
    expect(edited.ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });

  it("still refuses a CONTAINER edit that would install a second owner", () => {
    // The rule is real for containers, and relaxing it for leaves must not
    // relax it here — a second owning container on one key is the incoherent
    // state the whole mechanism exists to prevent.
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["one", "two"],
        },
        {
          id: "one",
          kind: "folder",
          data: { name: "One", source: "asset-A" },
          children: [],
        },
        {
          id: "two",
          kind: "folder",
          data: { name: "Two", source: "asset-B" },
          children: [],
        },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    // `applyEdit` on folder only writes `name`, so drive the collision through
    // a fresh placement instead: a second owning container on "asset-A".
    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [
        {
          kind: "folder",
          data: { name: "Three", source: "asset-A" },
          children: [],
        },
      ],
    });
    expect(inserted.ok).toBe(false);
    if (inserted.ok) return;
    expect(inserted.error.code).toBe("duplicate-owner");
  });
});
