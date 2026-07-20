import { describe, expect, it } from "vitest";

import { applyCommand } from "./commands";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "./graph";

// A single move used to do three pieces of whole-graph work: a document-order
// DFS over every node (to sort a set that is usually size 1), a clone of both
// index maps, and a no-op check that walked every collection. These pin the
// scaling properties that removed them — they assert STRUCTURE, not wall
// clock, so they cannot flake on a slow machine.

/** `collections` collections of `perCollection` media each, under one root. */
function wideGraph(collections: number, perCollection: number): CollectionsGraph {
  const children: GraphNodeSpec[] = [];
  for (let c = 0; c < collections; c++) {
    const clips: GraphNodeSpec[] = [];
    for (let i = 0; i < perCollection; i++) {
      clips.push({ kind: "media", id: `c${c}-m${i}`, name: `m${i}`, durationSeconds: 2 });
    }
    children.push({ kind: "collection", id: `c${c}`, name: `c${c}`, children: clips });
  }
  const built = buildGraph([{ kind: "collection", id: "root", name: "root", children }]);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
}

describe("move commit cost", () => {
  it("shares parentById for a same-parent reorder", () => {
    const graph = wideGraph(20, 20); // 400 media + 20 collections + root
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: [parseNodeId("c0-m0")],
      toParentId: parseNodeId("c0"),
      toIndex: 5,
    });
    if (!result.ok) throw new Error(result.error.reason);

    // Nothing was reparented, so the per-NODE map is handed through by
    // reference instead of being cloned at the size of the whole graph.
    expect(result.value.graph.parentById).toBe(graph.parentById);
    // The per-collection map genuinely changed and must not be shared.
    expect(result.value.graph.childrenById).not.toBe(graph.childrenById);
  });

  it("clones parentById only when a node actually changes parent", () => {
    const graph = wideGraph(20, 20);
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: [parseNodeId("c0-m0")],
      toParentId: parseNodeId("c1"),
      toIndex: 0,
    });
    if (!result.ok) throw new Error(result.error.reason);
    expect(result.value.graph.parentById).not.toBe(graph.parentById);
    expect(result.value.graph.parentById.get(parseNodeId("c0-m0"))).toBe(parseNodeId("c1"));
  });

  it("leaves untouched collections' children arrays shared", () => {
    const graph = wideGraph(20, 20);
    const before = graph.childrenById.get(parseNodeId("c7"));
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: [parseNodeId("c0-m0")],
      toParentId: parseNodeId("c0"),
      toIndex: 3,
    });
    if (!result.ok) throw new Error(result.error.reason);
    // Structural sharing is what lets the no-op check look at only the
    // touched parents — if this ever stops holding, that scoping is unsound.
    expect(result.value.graph.childrenById.get(parseNodeId("c7"))).toBe(before);
  });

  it("still detects a same-position move as a no-op", () => {
    const graph = wideGraph(5, 5);
    // Moving an item to the index it already occupies changes nothing.
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: [parseNodeId("c0-m2")],
      toParentId: parseNodeId("c0"),
      toIndex: 2,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a rejection");
    expect(result.error.reason).toBe("same-position");
  });

  it("still orders a multi-node move by document order, not selection order", () => {
    const graph = wideGraph(3, 4);
    // Selection order deliberately reversed relative to the document.
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: [parseNodeId("c0-m3"), parseNodeId("c0-m1")],
      toParentId: parseNodeId("c1"),
      toIndex: 0,
    });
    if (!result.ok) throw new Error(result.error.reason);
    expect([...(result.value.graph.childrenById.get(parseNodeId("c1")) ?? [])].slice(0, 2)).toEqual(
      ["c0-m1", "c0-m3"],
    );
  });
});
