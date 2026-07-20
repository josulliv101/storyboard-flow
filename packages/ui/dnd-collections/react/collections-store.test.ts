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

  // Per-parent data versions: what lets a virtual view subscribe to "MY
  // children's data changed" instead of `graph.nodesById`, whose identity
  // changes on every data commit anywhere. A selector re-renders iff its
  // selected primitive changes, so these ARE the render-scoping proof.
  test("a media update bumps only its parent's data version", () => {
    const store = createCollectionsStore(graphFixture());
    const before = store.getSnapshot().dataVersionByParent.get(id("root-b")) ?? 0;

    const result = store.dispatch({
      type: "update-media",
      nodeId: id("x"), // child of root-a
      update: { mediaKind: "image", durationSeconds: 7 },
    });
    expect(result.ok).toBe(true);

    const versions = store.getSnapshot().dataVersionByParent;
    expect(versions.get(id("root-a"))).toBe(1);
    expect(versions.get(id("root-b")) ?? 0).toBe(before); // bystander untouched
    expect(store.getSnapshot().graphGeneration).toBe(0);

    // Undo and redo are data commits too — each bumps again, so a view
    // keyed on the version re-renders for replayed trims exactly like
    // forward ones.
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().dataVersionByParent.get(id("root-a"))).toBe(2);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot().dataVersionByParent.get(id("root-a"))).toBe(3);
  });

  test("moves do not bump data versions — structure announces itself via children identity", () => {
    const store = createCollectionsStore(graphFixture());
    expect(store.dispatch(moveX).ok).toBe(true);
    expect(store.getSnapshot().dataVersionByParent.get(id("root-a")) ?? 0).toBe(0);
    expect(store.getSnapshot().dataVersionByParent.get(id("root-b")) ?? 0).toBe(0);
  });

  test("hydration bumps the hydrated collection; replaceGraph bumps the generation", () => {
    const store = createCollectionsStore(graphFixture());
    expect(
      store.hydrate(id("root-b"), [
        { kind: "media", id: "h1", name: "h1", durationSeconds: 2 },
      ]).ok
    ).toBe(true);
    expect(store.getSnapshot().dataVersionByParent.get(id("root-b"))).toBe(1);

    expect(store.replaceGraph(graphFixture()).ok).toBe(true);
    expect(store.getSnapshot().graphGeneration).toBe(1);
    // The old world's counters describe nodes that may be gone — reset.
    expect(store.getSnapshot().dataVersionByParent.get(id("root-b")) ?? 0).toBe(0);
  });

  // The replay guard. Hydration deliberately preserves history — but that
  // made history assume every dormant patch stays applicable, which hydration
  // itself can break. Both cases below were reproduced as real graph
  // corruption (duplicate-child / orphaned children) before the guard.
  test("redo of an add whose id was hydrated in meanwhile is refused, not applied", () => {
    const store = createCollectionsStore(graphFixture());

    // 1. Add "n" to root-a; 2. undo it — "n" now sleeps on the redo stack.
    expect(
      store.dispatch({
        type: "add-nodes",
        nodes: [{ id: id("n"), kind: "media", name: "n", durationSeconds: 2 }],
        toParentId: id("root-a"),
        toIndex: 0,
      }).ok
    ).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().canRedo).toBe(true);

    // 3. A lazy collection hydrates, and the stored document happens to
    //    contain a node with the same id. No collision with the CURRENT
    //    graph, so hydrate rightly accepts it.
    expect(
      store.hydrate(id("root-b"), [
        { kind: "media", id: "n", name: "n from storage", durationSeconds: 9 },
      ]).ok
    ).toBe(true);

    // 4. Redo used to blindly apply: one "n" in two collections, parentById
    //    naming only one. Now the entry is refused and the dead branch drops.
    expect(store.redo()).toBe(false);
    const { graph, canRedo } = store.getSnapshot();
    expect(canRedo).toBe(false);
    expect([...(graph.childrenById.get(id("root-a")) ?? [])]).toEqual(["x", "y", "z"]);
    expect([...(graph.childrenById.get(id("root-b")) ?? [])]).toEqual(["n"]);
    expect(graph.parentById.get(id("n"))).toBe(id("root-b"));
    expect(graph.nodesById.get(id("n"))?.name).toBe("n from storage");
  });

  test("undo of an add is refused once hydration filled the added collection", () => {
    const store = createCollectionsStore(graphFixture());

    // Palette-add an empty collection, then hydrate it — the exact lifecycle
    // of a brand-new sub-timeline whose document loads afterwards.
    expect(
      store.dispatch({
        type: "add-nodes",
        nodes: [{ id: id("c"), kind: "collection", name: "c" }],
        toParentId: id("root-a"),
        toIndex: 0,
      }).ok
    ).toBe(true);
    expect(
      store.hydrate(id("c"), [{ kind: "media", id: "m1", name: "m1", durationSeconds: 2 }]).ok
    ).toBe(true);

    // Undo used to delete "c" children-and-all, orphaning m1 (parentById
    // pointing at a node that no longer exists).
    expect(store.undo()).toBe(false);
    const { graph, canUndo } = store.getSnapshot();
    expect(canUndo).toBe(false); // the unreachable stack is dropped, not left corrupting
    expect(graph.nodesById.has(id("c"))).toBe(true);
    expect([...(graph.childrenById.get(id("c")) ?? [])]).toEqual(["m1"]);
  });

  // The commandPolicy contract. These pin WHY the guard is pre-commit: the
  // "just undo it back out" alternative passes a naive graph assertion but
  // corrupts history, which is exactly the bug this seam replaced.
  test("a policy-blocked command never reaches the graph, history, or the change feed", () => {
    const changes: CollectionsChange[] = [];
    const store = createCollectionsStore(graphFixture(), {
      onChange: (c) => changes.push(c),
      commandPolicy: (command) =>
        command.type === "move-nodes" && command.toParentId === id("root-b")
          ? { reason: "blocked-by-policy", blockedIds: [id("root-b")], message: "Still loading." }
          : null,
    });

    const result = store.dispatch(moveX);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the policy to block the move");
    expect(result.error.reason).toBe("blocked-by-policy");
    if (result.error.reason !== "blocked-by-policy") throw new Error("narrowing");
    expect(result.error.message).toBe("Still loading.");
    expect(result.error.blockedIds).toEqual([id("root-b")]);

    const snapshot = store.getSnapshot();
    expect([...(snapshot.graph.childrenById.get(id("root-a")) ?? [])]).toEqual(["x", "y", "z"]);
    expect([...(snapshot.graph.childrenById.get(id("root-b")) ?? [])]).toEqual([]);
    expect(snapshot.canUndo).toBe(false);
    expect(snapshot.historyEntries).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });

  test("the post-commit bounce this replaced DOES corrupt history (why the policy is pre-commit)", () => {
    // Not a feature — an executable record of the hazard. If someone
    // reintroduces "commit, inspect in a subscriber, undo it back out",
    // this is what they get.
    const store = createCollectionsStore(graphFixture());
    let bouncing = false;
    const unsubscribe = store.subscribeToChanges((change) => {
      if (bouncing && change.origin === "command") store.undo();
    });

    store.dispatch(moveX); // action A
    store.undo(); // A is now redoable
    expect(store.getSnapshot().canRedo).toBe(true);

    bouncing = true;
    store.dispatch({
      type: "move-nodes",
      nodeIds: [id("y")],
      toParentId: id("root-b"),
      toIndex: 0,
    });

    // The graph looks correct — y bounced straight back out...
    expect([...(store.getSnapshot().graph.childrenById.get(id("root-b")) ?? [])]).toEqual([]);
    // ...but redo now replays the REFUSED move, not A. That is the bug.
    bouncing = false;
    expect(store.getSnapshot().canRedo).toBe(true);
    store.redo();
    expect([...(store.getSnapshot().graph.childrenById.get(id("root-b")) ?? [])]).toEqual(["y"]);
    unsubscribe();
  });

  test("a policy-blocked command preserves an existing redo branch", () => {
    // The regression: perform A, undo it (A is now redoable), then attempt a
    // blocked drop. Committing-then-undoing would clear the redo branch and
    // leave the REFUSED command redoable in A's place.
    let blocking = false;
    const store = createCollectionsStore(graphFixture(), {
      commandPolicy: () =>
        blocking ? { reason: "blocked-by-policy", blockedIds: [id("root-b")] } : null,
    });

    store.dispatch(moveX); // action A
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().canRedo).toBe(true);

    blocking = true;
    const blocked = store.dispatch({
      type: "move-nodes",
      nodeIds: [id("y")],
      toParentId: id("root-b"),
      toIndex: 0,
    });
    expect(blocked.ok).toBe(false);

    // A is still the redoable entry, and redoing it replays A — not the
    // move that was just refused.
    expect(store.getSnapshot().canRedo).toBe(true);
    blocking = false;
    expect(store.redo()).toBe(true);
    expect([...(store.getSnapshot().graph.childrenById.get(id("root-b")) ?? [])]).toEqual(["x"]);
    expect(store.getSnapshot().canRedo).toBe(false);
  });

  test("the policy sees the current committed graph and can allow selectively", () => {
    const seen: string[] = [];
    const store = createCollectionsStore(graphFixture(), {
      commandPolicy: (command, graph) => {
        seen.push([...(graph.childrenById.get(id("root-b")) ?? [])].join("|"));
        return null;
      },
    });

    expect(store.dispatch(moveX).ok).toBe(true);
    expect(
      store.dispatch({
        type: "move-nodes",
        nodeIds: [id("y")],
        toParentId: id("root-b"),
        toIndex: 1,
      }).ok
    ).toBe(true);
    // Second call observed the graph AFTER the first commit — the policy is
    // handed live state, not the graph the store was created with.
    expect(seen).toEqual(["", "x"]);
  });

  test("undo and redo bypass the policy — they replay already-accepted commands", () => {
    let blocking = false;
    const store = createCollectionsStore(graphFixture(), {
      commandPolicy: () =>
        blocking ? { reason: "blocked-by-policy", blockedIds: [id("root-b")] } : null,
    });
    store.dispatch(moveX);

    blocking = true;
    expect(store.undo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect([...(store.getSnapshot().graph.childrenById.get(id("root-b")) ?? [])]).toEqual(["x"]);
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
