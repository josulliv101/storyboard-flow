import { describe, expect, it, vi } from "vitest";

import {
  buildGraph,
  parseNodeId,
  type CollectionsCommand,
  type CollectionsGraph,
  type HistoryEntry,
} from "@storyboard/ui/dnd-collections";
import type { ClipDetail } from "@storyboard/timeline-domain";

import { collectReachableDetailIds, createGraphDetailsStore } from "./graph-details-store";

function detail(alt: string): ClipDetail {
  return { alt, aspect: 16 / 9 };
}

describe("createGraphDetailsStore", () => {
  it("merges entries, notifies subscribers, and serves them via get/read", () => {
    const store = createGraphDetailsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const a = detail("a");
    store.merge({ a });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get("a")).toBe(a);
    expect(store.read()).toEqual({ a });
  });

  it("keeps untouched entry references stable across a merge (selector contract)", () => {
    const store = createGraphDetailsStore();
    const a = detail("a");
    store.merge({ a });
    const aBefore = store.get("a");

    store.merge({ b: detail("b") });
    expect(store.get("a")).toBe(aBefore);
  });

  it("bails without notifying when every merged entry is reference-identical", () => {
    const store = createGraphDetailsStore();
    const a = detail("a");
    store.merge({ a });
    const snapshot = store.read();
    const listener = vi.fn();
    store.subscribe(listener);

    store.merge({ a });
    expect(listener).not.toHaveBeenCalled();
    expect(store.read()).toBe(snapshot);
  });

  it("replaceAll swaps the whole table", () => {
    const store = createGraphDetailsStore({ a: detail("a") });
    const listener = vi.fn();
    store.subscribe(listener);

    const next = { b: detail("b") };
    store.replaceAll(next);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.read()).toBe(next);
    expect(store.get("a")).toBeUndefined();
  });

  it("prune drops entries outside the keep set and bails when nothing drops", () => {
    const store = createGraphDetailsStore();
    store.merge({ a: detail("a"), b: detail("b"), c: detail("c") });
    const listener = vi.fn();
    store.subscribe(listener);

    store.prune(new Set(["a", "c"]));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.read())).toEqual(["a", "c"]);

    const snapshot = store.read();
    store.prune(new Set(["a", "c"]));
    expect(listener).toHaveBeenCalledTimes(1); // no drop, no notify
    expect(store.read()).toBe(snapshot);
  });

  it("unsubscribe stops notifications", () => {
    const store = createGraphDetailsStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.merge({ a: detail("a") });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("collectReachableDetailIds", () => {
  function graphOf(): CollectionsGraph {
    const built = buildGraph([
      {
        kind: "collection",
        id: "root",
        name: "Root",
        children: [{ kind: "media", id: "clip-1", name: "Clip 1" }],
      },
    ]);
    if (!built.ok) throw new Error("test graph failed to build");
    return built.value;
  }

  const command: CollectionsCommand = {
    type: "move-nodes",
    nodeIds: [parseNodeId("clip-1")],
    toParentId: parseNodeId("root"),
    toIndex: 0,
  };

  function entryOf(patch: HistoryEntry["patch"]): HistoryEntry {
    return { command, patch, at: 0 };
  }

  it("keeps every live graph node id", () => {
    const keep = collectReachableDetailIds({ graph: graphOf(), historyEntries: [] });
    expect(keep.has("root")).toBe(true);
    expect(keep.has("clip-1")).toBe(true);
    expect(keep.has("ghost")).toBe(false);
  });

  it("keeps ids mentioned by any undo-stack patch, across all patch types", () => {
    const removedNode = { kind: "media", mediaKind: "image", id: parseNodeId("removed-1"), name: "Removed", src: "x", durationSeconds: 4 } as const;
    const updatedBefore = { kind: "media", mediaKind: "video", id: parseNodeId("updated-1"), name: "Updated", src: "y", fullDurationSeconds: 8, trimInSeconds: 0, trimOutSeconds: 0 } as const;
    const keep = collectReachableDetailIds({
      graph: graphOf(),
      historyEntries: [
        entryOf({
          type: "nodes-moved",
          moves: [
            {
              nodeId: parseNodeId("moved-1"),
              fromParentId: parseNodeId("root"),
              fromIndex: 0,
              toParentId: parseNodeId("root"),
              toIndex: 1,
            },
          ],
        }),
        entryOf({
          type: "nodes-added",
          adds: [{ node: { ...removedNode, id: parseNodeId("added-1") }, parentId: parseNodeId("root"), index: 0 }],
        }),
        entryOf({
          type: "nodes-removed",
          removals: [{ node: removedNode, parentId: parseNodeId("root"), index: 0 }],
        }),
        entryOf({
          type: "nodes-updated",
          updates: [{ nodeId: parseNodeId("updated-1"), before: updatedBefore, after: updatedBefore }],
        }),
      ],
    });

    expect(keep.has("moved-1")).toBe(true);
    expect(keep.has("added-1")).toBe(true);
    expect(keep.has("removed-1")).toBe(true);
    expect(keep.has("updated-1")).toBe(true);
    // Live graph still folded in alongside history.
    expect(keep.has("clip-1")).toBe(true);
    expect(keep.has("never-existed")).toBe(false);
  });
});
