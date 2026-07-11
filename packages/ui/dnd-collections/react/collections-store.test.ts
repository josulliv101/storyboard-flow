import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "../core/graph";
import { createCollectionsStore, type CollectionsChange } from "./collections-store";

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
});
