// Third review round — the replay door did not check the ownership rule.
//
// `verifyPatchApplies` exists so a DORMANT patch is refused before it can be
// applied: the graph moves on while an entry sleeps on the stack, and the
// entry's world may no longer be the one it recorded. It checked node absence,
// parent existence, parent loaded-ness, index bounds and the recorded `before`
// — everything structural — and never asked whether the arriving node's
// `sourceKey` is already owned by somebody else.
//
// `applyIngest` is what makes that reachable rather than theoretical. It is a
// NON-UNDOABLE server write, so it can move a live node onto a key a sleeping
// patch still carries, and the undo that follows re-installs the original owner
// beside it. The result is a graph `findInvariantViolation` reports as
// `duplicate-owner` — installed through the one door whose whole job is to
// refuse patches that no longer apply.
//
// NOTE ON SHAPE: these fixtures use CONTAINERS, not clips. Leaves no longer own
// a `sourceKey` at all (see `ownsItsSubtree`), so a leaf-based reproduction of
// this is now inert — which is worth pinning, and the last test here does.
import { describe, expect, it } from "vitest";

import {
  type Issue,
  type Result,
  type SummaryType,
  defineNodeType,
  parseNodeId,
} from "./types";
import { createEngine } from "./engine";

type Box = Readonly<{ name: string; source: string | null }>;
type BoxEdit = Readonly<{ name?: string; source?: string | null }>;

const boxType = defineNodeType<Box, BoxEdit>()({
  kind: "box",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Box, readonly Issue[]> {
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
    return {
      ok: true,
      value: {
        name: edit.name ?? data.name,
        source: edit.source === undefined ? data.source : edit.source,
      },
    };
  },
  sourceKey(data) {
    return data.source;
  },
});

/** A leaf that also declares `sourceKey`, to pin the interaction with #574. */
type Clip = Readonly<{ title: string; source: string }>;
const clipType = defineNodeType<Clip, Readonly<{ title?: string }>>()({
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
    if (typeof title !== "string" || typeof source !== "string") {
      return { ok: false, error: [{ path: "$", message: "shape" }] };
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

const types = [boxType, clipType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: SummaryType<Summary> = {
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

function makeEngine() {
  return createEngine<Types, Summary, {}>({ types, summary, folds: {} });
}

const rootId = parseNodeId("root");
const xId = parseNodeId("x");
const zId = parseNodeId("z");

/** root -> [x(owns "asset-a"), z(owns "asset-b")], both loaded and empty. */
function ownedPair() {
  const engine = makeEngine();
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { box: 1, clip: 1 },
    rootIds: ["root"],
    nodes: [
      {
        id: "root",
        kind: "box",
        data: { name: "Root", source: null },
        children: ["x", "z"],
      },
      { id: "x", kind: "box", data: { name: "X", source: "asset-a" }, children: [] },
      { id: "z", kind: "box", data: { name: "Z", source: "asset-b" }, children: [] },
    ],
  });
  if (!loaded.ok) throw new Error("fixture failed to deserialize");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

describe("replay cannot install a duplicate owner", () => {
  it("refuses an undo that would re-install a second owner", () => {
    const { engine, store } = ownedPair();

    // 1. Remove x. Its patch sleeps on the stack still carrying "asset-a".
    const removed = store.dispatch({ type: "remove-nodes", nodeIds: [xId] });
    expect(removed.ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();

    // 2. The server moves z onto the key x used to own. Non-undoable, and
    //    legitimately accepted — nothing owns "asset-a" right now.
    const ingested = store.ingest([
      { nodeId: zId, kind: "box", edit: { source: "asset-a" } },
    ]);
    expect(ingested.ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();

    // 3. Ctrl-Z. The sleeping patch would bring x back onto a key z now owns.
    const undone = store.undo();
    expect(undone.ok).toBe(false);
    if (undone.ok) return;
    expect(undone.error.code).toBe("duplicate-owner");

    // The graph must be untouched, not merely reported on afterwards.
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    // And the entry stays on the stack — a refused replay is not a consumed one.
    expect(store.canUndo()).toBe(true);
  });

  it("refuses a redo that would re-install a second owner", () => {
    const { engine, store } = ownedPair();

    // An insert whose node owns a fresh key, then undone so it sleeps on the
    // REDO stack.
    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "box", data: { name: "New", source: "asset-c" } }],
    });
    expect(inserted.ok).toBe(true);
    expect(store.undo().ok).toBe(true);

    // The server moves z onto that key while the patch sleeps.
    expect(
      store.ingest([{ nodeId: zId, kind: "box", edit: { source: "asset-c" } }]).ok,
    ).toBe(true);

    const redone = store.redo();
    expect(redone.ok).toBe(false);
    if (redone.ok) return;
    expect(redone.error.code).toBe("duplicate-owner");
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.canRedo()).toBe(true);
  });

  it("still allows an undo that re-installs the ONLY owner", () => {
    const { engine, store } = ownedPair();
    expect(store.dispatch({ type: "remove-nodes", nodeIds: [xId] }).ok).toBe(true);

    // Nobody took the key. The undo must still work — a guard that refuses
    // every replay of an owning node would be worse than the defect.
    const undone = store.undo();
    expect(undone.ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.getGraph().ownerBySourceKey.get("asset-a")).toBe(xId);
  });

  it("still allows undo/redo of a node that owns nothing", () => {
    const { engine, store } = ownedPair();
    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "box", data: { name: "Plain", source: null } }],
    });
    expect(inserted.ok).toBe(true);
    expect(store.undo().ok).toBe(true);
    expect(store.redo().ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });

  it("refuses a single patch that claims one key twice", () => {
    const { engine, store } = ownedPair();
    // Two owning boxes inserted together, same key. The reducer refuses this
    // outright, so the graph never holds it — pinned so the verify-side guard
    // and the reducer keep agreeing about a patch's own interior.
    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [
        { kind: "box", data: { name: "P", source: "asset-d" } },
        { kind: "box", data: { name: "Q", source: "asset-d" } },
      ],
    });
    expect(inserted.ok).toBe(false);
    if (inserted.ok) return;
    expect(inserted.error.code).toBe("duplicate-owner");
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });

  it("refuses an undo of a data change that would restore a taken key", () => {
    // The SAME hole on the data path: an undo restores a `source` value, and a
    // server write may have moved another node onto it meanwhile. Named here
    // because a fix that guards only the insert arm leaves this one open.
    const { engine, store } = ownedPair();

    // x vacates "asset-a" by moving to a fresh key. The patch's `before` still
    // carries "asset-a".
    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: xId, kind: "box", edit: { source: "asset-c" } }],
      }).ok,
    ).toBe(true);

    // The server moves z onto the key x just vacated.
    expect(
      store.ingest([{ nodeId: zId, kind: "box", edit: { source: "asset-a" } }]).ok,
    ).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();

    const undone = store.undo();
    if (undone.ok) {
      // Recorded rather than asserted-away: if this passes, the data arm is
      // already safe by another route and only the insert arm needed guarding.
      expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
      return;
    }
    expect(undone.error.code).toBe("duplicate-owner");
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });

  it("still allows undo/redo of an edit that does not touch the key", () => {
    // THE COMMON CASE, and the one the first draft of these tests missed: an
    // owning node is renamed, and the undo restores a value whose sourceKey is
    // the one that node ALREADY owns. Without the `existing === nodeId`
    // self-exemption every such undo is refused — which would break renaming
    // any owning container, not some exotic replay. Mutation testing is what
    // surfaced the gap: deleting that exemption failed nothing.
    const { engine, store } = ownedPair();

    const renamed = store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: xId, kind: "box", edit: { name: "Renamed" } }],
    });
    expect(renamed.ok).toBe(true);

    const undone = store.undo();
    expect(undone.ok).toBe(true);
    const redone = store.redo();
    expect(redone.ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.getGraph().ownerBySourceKey.get("asset-a")).toBe(xId);
  });

  it("does not refuse a LEAF replay, because a leaf owns nothing", () => {
    // The interaction with the leaf-exemption change: two clips may share a
    // source freely, so nothing on the replay path may start refusing them.
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { box: 1, clip: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "box",
          data: { name: "Root", source: null },
          children: ["c1"],
        },
        { id: "c1", kind: "clip", data: { title: "One", source: "asset-a" } },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "clip", data: { title: "Two", source: "asset-a" } }],
    });
    expect(inserted.ok).toBe(true);
    expect(store.undo().ok).toBe(true);
    expect(store.redo().ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });
});
