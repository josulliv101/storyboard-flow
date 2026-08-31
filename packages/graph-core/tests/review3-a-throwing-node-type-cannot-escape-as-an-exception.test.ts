// Third review round — the other half of "the engine survives its consumers".
//
// Every consumer `parse` call is defensively wrapped: ./serialize wraps node
// data, and a prior round wrapped the summary type beside it. NO `serialize`
// call was, and `serialize` is consumer code on exactly the same footing.
//
// The asymmetry costs three different contracts:
//
//   - `dispatch` promises a `Result`. A node type that throws while the reducer
//     round-trips its own output turned that into an unhandled exception out of
//     a React event handler, at every call site that correctly wrote
//     `if (!result.ok)`.
//   - `verifyPatchApplies` promises a `Result`. Undo runs the consumer's
//     `serialize` once per changed node to prove the recorded `before` still
//     stands, so a throwing node type took out undo the same way.
//   - `serializeGraph` promises to be TOTAL, in those words, "because a save
//     path that throws loses the user's document". Its own `serializeData`
//     already states the policy — "an unserializable node should cost one
//     node's fidelity, never the whole save" — and then called `nodeType.serialize`
//     unwrapped on the very next line.
import { describe, expect, it } from "vitest";

import {
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

// Which node-type call should blow up. Flipped per test; the throw is realistic —
// an encoder meeting a value it cannot represent, not a synthetic panic.
const explode = {
  nodeSerialize: false,
  applyEdit: false,
  summarySerialize: false,
};

function resetExplosions(): void {
  explode.nodeSerialize = false;
  explode.applyEdit = false;
  explode.summarySerialize = false;
}

type Clip = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ title?: string; seconds?: number }>;

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
    const seconds = record["seconds"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { title, seconds } };
  },
  serialize(data): unknown {
    if (explode.nodeSerialize) {
      throw new TypeError("clip.serialize cannot encode this value");
    }
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    if (explode.applyEdit) {
      throw new TypeError("clip.applyEdit blew up");
    }
    return {
      ok: true,
      value: {
        title: edit.title ?? data.title,
        seconds: edit.seconds ?? data.seconds,
      },
    };
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
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data): unknown {
    return { name: data.name };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { name: edit.name ?? data.name } };
  },
});

const types = [clipType, folderType] as const;
type Types = typeof types;

type Summary = Readonly<{ seconds: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const seconds = record["seconds"];
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { seconds } };
  },
  serialize(value): unknown {
    if (explode.summarySerialize) {
      throw new TypeError("summary.serialize cannot encode this value");
    }
    return { seconds: value.seconds };
  },
};

const folds = {};

function makeEngine() {
  return createEngine<Types, Summary, typeof folds>({
    types,
    summary,
    folds,
    now: () => 1234,
  });
}

const clipAId = parseNodeId("a");

/** root -> [a(clip 4), box(folder, unloaded, summary { seconds: 30 })] */
function loadedStore() {
  const engine = makeEngine();
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes: [
      {
        id: "root",
        kind: "folder",
        data: { name: "Root" },
        children: ["a", "box"],
      },
      { id: "a", kind: "clip", data: { title: "A", seconds: 4 } },
      {
        id: "box",
        kind: "folder",
        data: { name: "Box" },
        childrenState: "unloaded",
        summary: { seconds: 30 },
      },
    ],
  });
  if (!loaded.ok) throw new Error("fixture failed to deserialize");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

describe("the reducer refuses rather than throwing when a node type blows up", () => {
  it("returns a Result when applyEdit throws", () => {
    resetExplosions();
    const { store } = loadedStore();
    explode.applyEdit = true;

    let thrown: unknown = null;
    let result: ReturnType<typeof store.dispatch> | null = null;
    try {
      result = store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipAId, kind: "clip", edit: { seconds: 9 } }],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeNull();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.code).toBe("edit-rejected");
      expect(result.error.message).toContain("threw");
    }
  });

  it("returns a Result when serialize throws while re-parsing the edit", () => {
    resetExplosions();
    const { store } = loadedStore();
    explode.nodeSerialize = true;

    let thrown: unknown = null;
    let result: ReturnType<typeof store.dispatch> | null = null;
    try {
      result = store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipAId, kind: "clip", edit: { seconds: 9 } }],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeNull();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.error.code).toBe("parse-failed");
  });

  it("leaves the graph and the history stack untouched after a node type throw", () => {
    resetExplosions();
    const { store } = loadedStore();
    const before = store.getGraph();

    explode.nodeSerialize = true;
    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipAId, kind: "clip", edit: { seconds: 9 } }],
    });
    resetExplosions();

    // A refused command is not a commit: same graph identity, nothing to undo.
    expect(store.getGraph()).toBe(before);
    expect(store.canUndo()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyPatchApplies — the undo path
// ---------------------------------------------------------------------------

describe("replay verification refuses rather than throwing", () => {
  it("returns a Result when serialize throws while comparing a dormant patch", () => {
    resetExplosions();
    const { engine, store } = loadedStore();

    // Two edits, so the first patch's `before` is no longer the object the
    // graph holds — which is what gets past the identity fast path and reaches
    // the consumer's `serialize`.
    const first = store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipAId, kind: "clip", edit: { seconds: 5 } }],
    });
    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipAId, kind: "clip", edit: { seconds: 6 } }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    explode.nodeSerialize = true;
    let thrown: unknown = null;
    let verified: ReturnType<typeof engine.verifyPatchApplies> | null = null;
    try {
      verified = engine.verifyPatchApplies(store.getGraph(), first.value);
    } catch (error) {
      thrown = error;
    }
    resetExplosions();

    expect(thrown).toBeNull();
    expect(verified?.ok).toBe(false);
    if (verified && !verified.ok) {
      expect(verified.error.code).toBe("data-mismatch");
    }
  });

  it("keeps undo Result-shaped when the node type throws mid-verification", () => {
    resetExplosions();
    const { store } = loadedStore();
    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipAId, kind: "clip", edit: { seconds: 5 } }],
    });
    store.applyNonUndoableWrite([{ nodeId: clipAId, kind: "clip", edit: { seconds: 5 } }]);

    explode.nodeSerialize = true;
    let thrown: unknown = null;
    let undone: ReturnType<typeof store.undo> | null = null;
    try {
      undone = store.undo();
    } catch (error) {
      thrown = error;
    }
    resetExplosions();

    // Either it verified and undid, or it refused — but it must not throw, and
    // the stack must not be left half-moved.
    expect(thrown).toBeNull();
    expect(undone).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializeGraph — the save path, which is documented TOTAL
// ---------------------------------------------------------------------------

describe("the save path stays total when a node type throws", () => {
  it("does not lose the document when a node type throws", () => {
    resetExplosions();
    const { engine, store } = loadedStore();
    const graph = store.getGraph();

    explode.nodeSerialize = true;
    let thrown: unknown = null;
    let doc: ReturnType<typeof engine.serialize> | null = null;
    try {
      doc = engine.serialize(graph);
    } catch (error) {
      thrown = error;
    }
    resetExplosions();

    expect(thrown).toBeNull();
    expect(doc).not.toBeNull();
    // Every node still present — one node's fidelity, never the whole save.
    expect(doc?.nodes.map((node) => node.id).sort()).toEqual([
      "a",
      "box",
      "root",
    ]);
    // And the unaffected kinds still serialized normally.
    const root = doc?.nodes.find((node) => node.id === "root");
    expect(root?.data).toEqual({ name: "Root" });
  });

  it("does not lose the document when the summary type throws", () => {
    resetExplosions();
    const { engine, store } = loadedStore();
    const graph = store.getGraph();

    explode.summarySerialize = true;
    let thrown: unknown = null;
    let doc: ReturnType<typeof engine.serialize> | null = null;
    try {
      doc = engine.serialize(graph);
    } catch (error) {
      thrown = error;
    }
    resetExplosions();

    expect(thrown).toBeNull();
    expect(doc?.nodes.map((node) => node.id).sort()).toEqual([
      "a",
      "box",
      "root",
    ]);
    // The clip beside it is untouched by the summary type's failure.
    const clip = doc?.nodes.find((node) => node.id === "a");
    expect(clip?.data).toEqual({ title: "A", seconds: 4 });
  });

  it("round-trips a healthy graph unchanged, so the guards cost nothing", () => {
    resetExplosions();
    const { engine, store } = loadedStore();
    const doc = engine.serialize(store.getGraph());
    const reloaded = engine.deserialize(doc);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.report.quarantined.length).toBe(0);
    expect(engine.findInvariantViolation(reloaded.value.graph)).toBeNull();
  });
});
