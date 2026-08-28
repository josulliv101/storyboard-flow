// A destroyed store must refuse every write, not perform it silently.
//
// `destroy()` clears the listeners and the fold cache. A mutation after that
// point lands in a graph nothing is subscribed to and no cache reflects — the
// only symptom is a later read disagreeing with what the UI last drew. The
// subscribe methods already treated post-destroy calls as benign no-ops; these
// pin the same decision for the write half.
import { describe, expect, it } from "vitest";

import { createEngine } from "./engine";
import { defineNodeType, parseNodeId } from "./types";
import type { Issue, Result, SummaryCodec } from "./types";

type Clip = Readonly<{ title: string }>;
type ClipEdit = Readonly<{ title: string }>;
type Folder = Readonly<{ name: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse: (raw): Result<Clip, readonly Issue[]> => ({
    ok: true,
    value: { title: String((raw as Clip).title) },
  }),
  serialize: (d) => d,
  applyEdit: (_d, e) => ({ ok: true, value: { title: e.title } }),
});
const folderType = defineNodeType<Folder, Record<string, never>>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse: (raw): Result<Folder, readonly Issue[]> => ({
    ok: true,
    value: { name: String((raw as Folder).name) },
  }),
  serialize: (d) => d,
  applyEdit: (d) => ({ ok: true, value: d }),
});

const types = [clipType, folderType] as const;
const summary: SummaryCodec<Record<string, never>> = {
  parse: () => ({ ok: true, value: {} }),
  serialize: () => ({}),
};

function makeStore() {
  const engine = createEngine<
    typeof types,
    Record<string, never>,
    Record<string, never>
  >({ types, summary, folds: {}, now: () => 0 });
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes: [
      { id: "root", kind: "folder", data: { name: "R" }, children: ["a", "sub"] },
      { id: "a", kind: "clip", data: { title: "A" } },
      {
        id: "sub",
        kind: "folder",
        data: { name: "S" },
        childrenState: "unloaded",
      },
    ],
  });
  if (!loaded.ok) throw new Error("fixture failed");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

const rootId = parseNodeId("root");
const clipAId = parseNodeId("a");
const subId = parseNodeId("sub");

describe("a destroyed store refuses every write", () => {
  it("refuses dispatch, and does not change the graph", () => {
    const { store } = makeStore();
    const before = store.getGraph();
    store.destroy();

    const result = store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipAId, kind: "clip", edit: { title: "ZOMBIE" } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("store-destroyed");
    // Identity, not equality: a refused write must not have produced a graph.
    expect(store.getGraph()).toBe(before);
  });

  it("refuses undo and redo", () => {
    const { store } = makeStore();
    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipAId, kind: "clip", edit: { title: "B" } }],
      }).ok,
    ).toBe(true);
    store.destroy();

    const undone = store.undo();
    expect(undone.ok).toBe(false);
    if (!undone.ok) expect(undone.error.code).toBe("store-destroyed");

    const redone = store.redo();
    expect(redone.ok).toBe(false);
    if (!redone.ok) expect(redone.error.code).toBe("store-destroyed");
  });

  it("refuses ingest", () => {
    const { store } = makeStore();
    store.destroy();
    const result = store.ingest([
      { nodeId: clipAId, kind: "clip", edit: { title: "from-io" } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("store-destroyed");
  });

  it("refuses load", () => {
    const { store } = makeStore();
    const before = store.getGraph();
    store.destroy();
    const result = store.load(subId, {
      formatVersion: 1,
      schemaVersions: { clip: 1 },
      rootIds: ["s1"],
      nodes: [{ id: "s1", kind: "clip", data: { title: "S1" } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("store-destroyed");
    expect(store.getGraph()).toBe(before);
  });

  it("markMissing becomes a no-op rather than a silent write", () => {
    // It returns void, so there is no rejection to carry — the guarantee is
    // that the graph is untouched.
    const { store } = makeStore();
    const before = store.getGraph();
    store.destroy();
    store.markMissing(subId, "gone");
    expect(store.getGraph()).toBe(before);
  });

  it("still READS, because reads after teardown are harmless", () => {
    // The refusal is about writes. A card that outlives its provider by a frame
    // should still be able to render what it last held rather than crash.
    const { store } = makeStore();
    store.destroy();
    expect(store.getGraph().nodesById.has(rootId)).toBe(true);
    expect(store.canUndo()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Undo verification must not call the consumer's codec when it does not have to
// ---------------------------------------------------------------------------

describe("verifyDataChanged consults the codec only when it must", () => {
  it("serializes nothing on an ordinary undo/redo of an edit", () => {
    // The machine-independent form of this claim: COUNT the consumer calls
    // rather than time them. `serialize` is consumer code of unknown cost, and
    // an undo used to run it twice per changed node even when the node still
    // held the very object the patch recorded.
    let serializeCalls = 0;
    const countingClip = defineNodeType<Clip, ClipEdit>()({
      kind: "clip",
      container: false,
      schemaVersion: 1,
      parse: (raw): Result<Clip, readonly Issue[]> => ({
        ok: true,
        value: { title: String((raw as Clip).title) },
      }),
      serialize(d) {
        serializeCalls += 1;
        return d;
      },
      applyEdit: (_d, e) => ({ ok: true, value: { title: e.title } }),
    });
    const countingTypes = [countingClip, folderType] as const;
    const engine = createEngine<
      typeof countingTypes,
      Record<string, never>,
      Record<string, never>
    >({ types: countingTypes, summary, folds: {}, now: () => 0 });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: ["a"] },
        { id: "a", kind: "clip", data: { title: "A" } },
      ],
    });
    if (!loaded.ok) throw new Error("fixture failed");
    const store = engine.createStore(loaded.value.graph);

    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipAId, kind: "clip", edit: { title: "B" } }],
      }).ok,
    ).toBe(true);

    serializeCalls = 0;
    expect(store.undo().ok).toBe(true);
    expect(store.redo().ok).toBe(true);
    expect(serializeCalls).toBe(0);
  });

  it("cannot become a way for a dormant patch to clobber a server write", () => {
    // The fast path must not weaken the guarantee the comparison exists for.
    // `applyIngest` is the non-undoable write, so it moves a node's data out
    // from under a dormant patch. The engine's answer is to SCRUB that entry
    // rather than let the replay refuse later — so the observable guarantee is
    // not a particular rejection code, it is that the server's value survives.
    const { store } = makeStore();
    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipAId, kind: "clip", edit: { title: "B" } }],
      }).ok,
    ).toBe(true);
    expect(store.undo().ok).toBe(true);

    const scrubbed = store.ingest([
      { nodeId: clipAId, kind: "clip", edit: { title: "SERVER" } },
    ]);
    expect(scrubbed.ok).toBe(true);
    if (scrubbed.ok) expect(scrubbed.value).toContain(clipAId);

    // The redo entry was scrubbed, so there is nothing to replay — and either
    // way "B" must not come back over the top of "SERVER".
    store.redo();
    const node = store.getGraph().nodesById.get(clipAId);
    const title =
      node !== undefined && !node.quarantined && node.kind === "clip"
        ? node.data.title
        : "?";
    expect(title).toBe("SERVER");
  });
});
