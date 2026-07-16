import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "../core/graph";
import {
  InvalidInitialGraphError,
  createCollectionsStore,
  type CollectionsChange,
} from "./collections-store";

// Direct tests for the store's CONTRACTS — the invariants every selector
// depends on and a refactor can silently break: snapshot fields keep their
// identity unless they changed, no-op updates never notify, and the drag/
// selection state machine transitions exactly as documented. (Interaction
// BEHAVIOR is covered by the story suites; this file pins the mechanics.)

const media = (id: string): GraphNodeSpec => ({ kind: "media", id, name: id });

function graphFixture(): CollectionsGraph {
  const result = buildGraph([
    { kind: "collection", id: "root-a", name: "A", children: [media("x"), media("y"), media("z")] },
    { kind: "collection", id: "root-b", name: "B", children: [] },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function graphWithInvalidDuration(): CollectionsGraph {
  const graph = graphFixture();
  const node = graph.nodesById.get(parseNodeId("x"));
  if (!node || node.kind !== "media" || node.mediaKind === "video") {
    throw new Error("Expected image fixture node x.");
  }
  const nodesById = new Map(graph.nodesById);
  nodesById.set(node.id, { ...node, durationSeconds: Number.NaN });
  return { ...graph, nodesById };
}

const id = parseNodeId;
const moveX = {
  type: "move-nodes",
  nodeIds: [id("x")],
  toParentId: id("root-b"),
  toIndex: 0,
} as const;

describe("createCollectionsStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("rejects a malformed initial graph before creating the store", () => {
    expect(() => createCollectionsStore(graphWithInvalidDuration())).toThrowError(
      InvalidInitialGraphError
    );
    expect(() => createCollectionsStore(graphWithInvalidDuration())).toThrowError(
      /nodesById\["x"\]\.durationSeconds/
    );
  });

  test("dispatch commits the graph, records history, and emits onChange", () => {
    const changes: CollectionsChange[] = [];
    const store = createCollectionsStore(graphFixture(), { onChange: (c) => changes.push(c) });

    const result = store.dispatch(moveX);
    expect(result.ok).toBe(true);
    const { graph, canUndo, historyEntries } = store.getSnapshot();
    expect([...(graph.childrenById.get(id("root-b")) ?? [])]).toEqual(["x"]);
    expect(canUndo).toBe(true);
    expect(historyEntries).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(changes[0].origin).toBe("command");
  });

  test("reentrant listeners preserve onChange order and graph-patch pairing", () => {
    const changes: CollectionsChange[] = [];
    const store = createCollectionsStore(graphFixture(), {
      onChange: (change) => changes.push(change),
    });
    let dispatchedNested = false;
    store.subscribe(() => {
      if (dispatchedNested) return;
      dispatchedNested = true;
      store.dispatch({
        type: "move-nodes",
        nodeIds: [id("y")],
        toParentId: id("root-b"),
        toIndex: 0,
      });
    });

    expect(store.dispatch(moveX).ok).toBe(true);

    expect(
      changes.map((change) =>
        change.command?.type === "move-nodes" ? change.command.nodeIds[0] : null
      )
    ).toEqual(["x", "y"]);
    expect([...(changes[0].graph.childrenById.get(id("root-b")) ?? [])]).toEqual(["x"]);
    expect([...(changes[1].graph.childrenById.get(id("root-b")) ?? [])]).toEqual([
      "y",
      "x",
    ]);
  });

  test("onChange can dispatch reentrantly without reversing queued events", () => {
    const changes: CollectionsChange[] = [];
    let store: ReturnType<typeof createCollectionsStore> | null = null;
    store = createCollectionsStore(graphFixture(), {
      onChange: (change) => {
        if (
          change.command?.type === "move-nodes" &&
          change.command.nodeIds[0] === id("x")
        ) {
          store?.dispatch({
            type: "move-nodes",
            nodeIds: [id("y")],
            toParentId: id("root-b"),
            toIndex: 0,
          });
        }
        changes.push(change);
      },
    });

    expect(store.dispatch(moveX).ok).toBe(true);
    expect(
      changes.map((change) =>
        change.command?.type === "move-nodes" ? change.command.nodeIds[0] : null
      )
    ).toEqual(["x", "y"]);
  });

  test("interaction-only updates preserve graph and historyEntries identity", () => {
    const store = createCollectionsStore(graphFixture());
    store.dispatch(moveX);
    const before = store.getSnapshot();

    store.setSelection([id("y")]);
    const after = store.getSnapshot();

    expect(after).not.toBe(before); // snapshot identity changes per notify...
    expect(after.graph).toBe(before.graph); // ...but untouched FIELDS do not
    expect(after.historyEntries).toBe(before.historyEntries);
  });

  test("same-set selection and equal drop intents do not notify", () => {
    const store = createCollectionsStore(graphFixture());
    store.setSelection([id("x"), id("y")]);
    store.beginDrag(id("x")); // drop intents only register while a drag is live
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSelection([id("y"), id("x")]); // same set, different order
    expect(listener).not.toHaveBeenCalled();

    store.setDropIntent({ type: "nest-inside", collectionId: id("root-b") });
    expect(listener).toHaveBeenCalledTimes(1);
    store.setDropIntent({ type: "nest-inside", collectionId: id("root-b") }); // equal
    expect(listener).toHaveBeenCalledTimes(1);

    store.clearSelection();
    expect(listener).toHaveBeenCalledTimes(2);
    store.clearSelection(); // already empty
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("drop intents are ignored while no drag is live; clearing is always allowed", () => {
    const store = createCollectionsStore(graphFixture());
    const listener = vi.fn();
    store.subscribe(listener);

    // Idle: the dnd-kit collision loop can outlive the store's drag state
    // (replaceGraph mid-drag, failed palette factory) — a late publication
    // must not repaint indicators for a drag the store says is over.
    store.setDropIntent({ type: "nest-inside", collectionId: id("root-b") });
    expect(store.getSnapshot().interaction.dropIntent).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    store.beginPaletteDrag();
    store.setDropIntent({ type: "nest-inside", collectionId: id("root-b") });
    expect(store.getSnapshot().interaction.dropIntent).not.toBeNull();

    store.endDrag();
    expect(store.getSnapshot().interaction.dropIntent).toBeNull();
    store.setDropIntent({ type: "append-to-collection", collectionId: id("root-b") });
    expect(store.getSnapshot().interaction.dropIntent).toBeNull();
  });

  test("replaceGraph mid-drag blocks late intent publications from the dead gesture", () => {
    const store = createCollectionsStore(graphFixture());
    store.beginDrag(id("x"));
    const next = buildGraph([
      { kind: "collection", id: "root-a", name: "A", children: [media("y")] },
    ]);
    if (!next.ok) throw new Error(JSON.stringify(next.error));
    expect(store.replaceGraph(next.value).ok).toBe(true);

    // The still-live gesture keeps resolving intents; the store must refuse
    // them — isDragging was reset and nothing may preview against the new
    // graph until a fresh drag begins.
    store.setDropIntent({ type: "append-to-collection", collectionId: id("root-a") });
    expect(store.getSnapshot().interaction.dropIntent).toBeNull();
    expect(store.getSnapshot().interaction.isDragging).toBe(false);
  });

  test("selection APIs ignore node ids that are missing from the graph", () => {
    const store = createCollectionsStore(graphFixture());
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSelection([id("x"), id("missing")]);
    expect([...store.getSnapshot().interaction.selectedIds]).toEqual(["x"]);
    expect(listener).toHaveBeenCalledTimes(1);

    listener.mockClear();
    store.toggleSelected(id("missing"));
    expect([...store.getSnapshot().interaction.selectedIds]).toEqual(["x"]);
    expect(listener).not.toHaveBeenCalled();

    store.setSelection([id("x"), id("still-missing")]);
    expect(listener).not.toHaveBeenCalled();
  });

  test("beginDrag puts the PRESSED id first and sets isDragging", () => {
    const store = createCollectionsStore(graphFixture());
    store.setSelection([id("x"), id("y"), id("z")]);
    store.beginDrag(id("z"));

    const { interaction } = store.getSnapshot();
    expect(interaction.isDragging).toBe(true);
    expect([...interaction.activeIds]).toEqual(["z", "x", "y"]);
    expect(interaction.activeIdSet.has(id("y"))).toBe(true);

    store.endDrag();
    const ended = store.getSnapshot().interaction;
    expect(ended.isDragging).toBe(false);
    expect(ended.activeIds).toHaveLength(0);
    expect(ended.dropIntent).toBeNull();
  });

  test("beginPaletteDrag marks a drag live without activeIds; endDrag clears it", () => {
    const store = createCollectionsStore(graphFixture());
    store.beginPaletteDrag();
    expect(store.getSnapshot().interaction.isDragging).toBe(true);
    expect(store.getSnapshot().interaction.activeIds).toHaveLength(0);
    store.endDrag();
    expect(store.getSnapshot().interaction.isDragging).toBe(false);
  });

  test("subscribeToChanges mirrors the onChange feed and unsubscribes cleanly", () => {
    const viaOption: string[] = [];
    const viaSeam: string[] = [];
    const store = createCollectionsStore(graphFixture(), {
      onChange: (c) => viaOption.push(c.origin),
    });
    const interactionNotifies = vi.fn();
    const unsubscribe = store.subscribeToChanges((change) => {
      viaSeam.push(`${change.origin}:${change.patch.type}`);
    });
    store.subscribe(interactionNotifies);

    store.dispatch(moveX);
    store.undo();
    store.redo();
    // Interaction-only updates never reach the change feed.
    store.setSelection([id("y")]);

    expect(viaSeam).toEqual([
      "command:nodes-moved",
      "undo:nodes-moved",
      "redo:nodes-moved",
    ]);
    expect(viaOption).toEqual(["command", "undo", "redo"]); // both feeds, same events

    unsubscribe();
    store.undo();
    expect(viaSeam).toHaveLength(3); // no longer delivered
    expect(viaOption).toHaveLength(4); // the option keeps receiving
  });

  test("subscribeToChanges works without an onChange option and stops on destroy", () => {
    const store = createCollectionsStore(graphFixture());
    const seen = vi.fn();
    store.subscribeToChanges(seen);

    store.dispatch(moveX);
    expect(seen).toHaveBeenCalledTimes(1);

    store.destroy();
    store.dispatch({
      type: "move-nodes",
      nodeIds: [id("y")],
      toParentId: id("root-b"),
      toIndex: 0,
    });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test("undo restores, redo replays; onChange origins are labeled", () => {
    const origins: string[] = [];
    const store = createCollectionsStore(graphFixture(), {
      onChange: (c) => origins.push(c.origin),
    });
    store.dispatch(moveX);

    expect(store.undo()).toBe(true);
    expect([...(store.getSnapshot().graph.childrenById.get(id("root-a")) ?? [])]).toEqual([
      "x",
      "y",
      "z",
    ]);
    expect(store.getSnapshot().canRedo).toBe(true);

    expect(store.redo()).toBe(true);
    expect([...(store.getSnapshot().graph.childrenById.get(id("root-b")) ?? [])]).toEqual(["x"]);
    expect(origins).toEqual(["command", "undo", "redo"]);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false); // stack exhausted
  });

  test("replaceGraph swaps the graph, clears history, prunes selection, resets drag, and is silent", () => {
    const changes: CollectionsChange[] = [];
    const store = createCollectionsStore(graphFixture(), { onChange: (c) => changes.push(c) });
    store.dispatch(moveX); // some history + a change on the feed
    store.setSelection([id("x"), id("y")]); // x moved to root-b above, y stays
    store.beginDrag(id("y")); // an in-progress drag
    changes.length = 0; // ignore the dispatch's change; watch the replace

    const next = buildGraph([
      { kind: "collection", id: "root-a", name: "A", children: [media("y"), media("w")] },
    ]);
    if (!next.ok) throw new Error(JSON.stringify(next.error));
    expect(store.replaceGraph(next.value)).toEqual({ ok: true, value: undefined });

    const snap = store.getSnapshot();
    expect(snap.graph).toBe(next.value); // the new graph is committed
    expect(snap.canUndo).toBe(false); // history cleared — old patches don't apply
    expect(snap.historyEntries).toEqual([]);
    expect(snap.interaction.isDragging).toBe(false); // drag reset
    expect(snap.interaction.activeIds).toHaveLength(0);
    // Selection pruned to ids the new graph still has: y survives, x is gone.
    expect(snap.interaction.selectedIds.has(id("y"))).toBe(true);
    expect(snap.interaction.selectedIds.has(id("x"))).toBe(false);
    // No onChange for a caller-supplied reset.
    expect(changes).toHaveLength(0);
  });

  test("rejects a malformed replacement graph without changing store state", () => {
    const changes: CollectionsChange[] = [];
    const store = createCollectionsStore(graphFixture(), { onChange: (change) => changes.push(change) });
    store.dispatch(moveX);
    store.setSelection([id("y")]);
    store.beginDrag(id("y"));
    changes.length = 0;
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const before = store.getSnapshot();

    expect(store.replaceGraph(graphWithInvalidDuration())).toEqual({
      ok: false,
      error: {
        reason: "invalid-value",
        path: '$.nodesById["x"].durationSeconds',
        message: "Expected a finite, non-negative number.",
      },
    });
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().canUndo).toBe(true);
    expect(store.getSnapshot().interaction.isDragging).toBe(true);
    expect(store.getSnapshot().interaction.selectedIds.has(id("y"))).toBe(true);
    expect(notifications).toBe(0);
    expect(changes).toEqual([]);
  });

  test("undoing an add prunes the removed node from the selection", () => {
    const store = createCollectionsStore(graphFixture());
    const added = store.dispatch({
      type: "add-nodes",
      nodes: [{ id: id("new-1"), kind: "media", name: "New", durationSeconds: 2 }],
      toParentId: id("root-b"),
      toIndex: 0,
    });
    expect(added.ok).toBe(true);
    store.setSelection([id("x"), id("new-1")]);

    expect(store.undo()).toBe(true);

    const { graph, interaction } = store.getSnapshot();
    expect(graph.nodesById.has(id("new-1"))).toBe(false);
    // The removed id must not survive in the selection — a stale id would
    // poison the next multi-drag (the reducer rejects the whole command
    // with missing-node, so the drop silently does nothing).
    expect(interaction.selectedIds.has(id("new-1"))).toBe(false);
    expect(interaction.selectedIds.has(id("x"))).toBe(true);
  });

  test("graph changes that remove nothing keep selection identity", () => {
    const store = createCollectionsStore(graphFixture());
    store.setSelection([id("y")]);
    const before = store.getSnapshot().interaction.selectedIds;

    store.dispatch(moveX);
    store.undo();
    store.redo();

    // Moves never remove nodes: pruning must not touch (or re-allocate)
    // the selection set — field identity is the selector contract.
    expect(store.getSnapshot().interaction.selectedIds).toBe(before);
  });

  test("maxHistoryEntries caps the undo stack", () => {
    const store = createCollectionsStore(graphFixture(), { maxHistoryEntries: 1 });
    // Two commits, cap of 1: the first falls off and only one undo is possible.
    store.dispatch(moveX);
    store.dispatch({
      type: "move-nodes",
      nodeIds: [id("y")],
      toParentId: id("root-b"),
      toIndex: 0,
    });
    expect(store.getSnapshot().historyEntries).toHaveLength(1);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false); // the older commit is no longer undoable
  });

  test("flashRejection sets, auto-clears, and re-flash resets the timer", () => {
    const store = createCollectionsStore(graphFixture());
    store.flashRejection([id("x")]);
    expect(store.getSnapshot().interaction.rejectedIdSet.has(id("x"))).toBe(true);

    vi.advanceTimersByTime(400);
    store.flashRejection([id("y")]); // resets the clock
    vi.advanceTimersByTime(400);
    expect(store.getSnapshot().interaction.rejectedIdSet.has(id("y"))).toBe(true);
    vi.advanceTimersByTime(300);
    expect(store.getSnapshot().interaction.rejectedIdSet.size).toBe(0);
  });

  test("destroy clears the pending flash timer and all listeners", () => {
    const store = createCollectionsStore(graphFixture());
    const listener = vi.fn();
    store.subscribe(listener);
    store.flashRejection([id("x")]);
    listener.mockClear();

    store.destroy();
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();
  });

  test("destroy does not strand a live rejection flash in the retained store", () => {
    const store = createCollectionsStore(graphFixture());
    store.flashRejection([id("x")]);

    // Cancelling the timer would otherwise leave rejectedIdSet populated
    // forever in a store that survives effect cleanup (Activity-style hide):
    // on reveal the cards would still render data-rejected.
    store.destroy();
    expect(store.getSnapshot().interaction.rejectedIdSet.size).toBe(0);
  });

  // Hydration is IO landing, not user intent: it must reach snapshot
  // subscribers (views re-render) while staying invisible to undo/redo and
  // the persistence change feed — and, unlike replaceGraph, it must leave
  // the history replayable.
  describe("hydrate", () => {
    const hydrationSpecs: readonly GraphNodeSpec[] = [
      media("h1"),
      { kind: "collection", id: "h-nested", name: "Nested", children: [media("h2")] },
    ];

    test("fills the placeholder and notifies snapshot subscribers only", () => {
      const changes: CollectionsChange[] = [];
      const store = createCollectionsStore(graphFixture(), { onChange: (c) => changes.push(c) });
      const feed = vi.fn();
      store.subscribeToChanges(feed);
      const listener = vi.fn();
      store.subscribe(listener);

      const result = store.hydrate(id("root-b"), hydrationSpecs);
      expect(result.ok).toBe(true);
      const { graph, canUndo, historyEntries } = store.getSnapshot();
      expect([...(graph.childrenById.get(id("root-b")) ?? [])]).toEqual(["h1", "h-nested"]);
      expect(listener).toHaveBeenCalledTimes(1);
      // No history entry, no change-feed event, no onChange.
      expect(canUndo).toBe(false);
      expect(historyEntries).toHaveLength(0);
      expect(feed).not.toHaveBeenCalled();
      expect(changes).toHaveLength(0);
    });

    test("undo history SURVIVES hydration and still replays", () => {
      const store = createCollectionsStore(graphFixture());
      // Commit BEFORE hydration: move x into root-b, then undo it so the
      // placeholder is empty again when hydration lands.
      expect(store.dispatch(moveX).ok).toBe(true);
      expect(store.undo()).toBe(true);

      expect(store.hydrate(id("root-b"), hydrationSpecs).ok).toBe(true);
      // Redo replays the pre-hydration patch onto the hydrated graph.
      expect(store.redo()).toBe(true);
      const children = [...(store.getSnapshot().graph.childrenById.get(id("root-b")) ?? [])];
      expect(children).toEqual(["x", "h1", "h-nested"]);
      // …and undoing it again leaves the hydrated nodes untouched.
      expect(store.undo()).toBe(true);
      expect([...(store.getSnapshot().graph.childrenById.get(id("root-b")) ?? [])]).toEqual([
        "h1",
        "h-nested",
      ]);
    });

    test("rejections return without notifying anyone", () => {
      const store = createCollectionsStore(graphFixture());
      const listener = vi.fn();
      store.subscribe(listener);
      const before = store.getSnapshot();

      expect(store.hydrate(id("root-a"), hydrationSpecs)).toMatchObject({
        ok: false,
        error: { reason: "collection-not-empty" },
      });
      expect(store.hydrate(id("root-b"), [media("x")])).toMatchObject({
        ok: false,
        error: { reason: "duplicate-id", id: "x" },
      });
      expect(listener).not.toHaveBeenCalled();
      expect(store.getSnapshot()).toBe(before);
    });

    test("an empty spec list is a silent no-op", () => {
      const store = createCollectionsStore(graphFixture());
      const listener = vi.fn();
      store.subscribe(listener);
      const before = store.getSnapshot();

      expect(store.hydrate(id("root-b"), []).ok).toBe(true);
      expect(listener).not.toHaveBeenCalled();
      expect(store.getSnapshot()).toBe(before);
      expect(store.getSnapshot().graph).toBe(before.graph);
    });
  });
});
