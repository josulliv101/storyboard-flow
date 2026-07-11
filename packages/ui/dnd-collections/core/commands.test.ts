import { describe, expect, test } from "vitest";
import {
  buildGraph,
  findGraphInvariantViolation,
  getChildren,
  parseNodeId,
  type CollectionsGraph,
  type GraphNodeSpec,
} from "./graph";
import { applyCommand, type CollectionsCommand } from "./commands";
import { applyPatch, invertPatch } from "./patches";

const media = (id: string): GraphNodeSpec => ({ kind: "media", id, name: id });
const collection = (id: string, children: readonly GraphNodeSpec[] = []): GraphNodeSpec => ({
  kind: "collection",
  id,
  name: id,
  children,
});

function build(roots: readonly GraphNodeSpec[]): CollectionsGraph {
  const result = buildGraph(roots);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** [A, B, C, D] in root-a; [X, Y] in root-b; folder F (containing f1) in root-a. */
function fixture(): CollectionsGraph {
  return build([
    collection("root-a", [media("A"), media("B"), media("C"), media("D"), collection("F", [media("f1")])]),
    collection("root-b", [media("X"), media("Y")]),
  ]);
}

const ids = (values: readonly string[]) => values.map((v) => parseNodeId(v));
const childNames = (graph: CollectionsGraph, id: string) => [...getChildren(graph, parseNodeId(id))];

function apply(graph: CollectionsGraph, command: CollectionsCommand) {
  const result = applyCommand(graph, command);
  if (!result.ok) throw new Error(`rejected: ${JSON.stringify(result.error)}`);
  expect(findGraphInvariantViolation(result.value.graph)).toBeNull();
  return result.value;
}

describe("applyCommand: move-nodes", () => {
  test("reorders within a collection (post-removal index)", () => {
    const graph = fixture();
    // Move A after C: post-removal children are [B, C, D, F]; index 2 lands after C.
    const { graph: next } = apply(graph, {
      type: "move-nodes",
      nodeIds: ids(["A"]),
      toParentId: parseNodeId("root-a"),
      toIndex: 2,
    });
    expect(childNames(next, "root-a")).toEqual(["B", "C", "A", "D", "F"]);
  });

  test("moves across collections", () => {
    const graph = fixture();
    const { graph: next } = apply(graph, {
      type: "move-nodes",
      nodeIds: ids(["A"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 1,
    });
    expect(childNames(next, "root-a")).toEqual(["B", "C", "D", "F"]);
    expect(childNames(next, "root-b")).toEqual(["X", "A", "Y"]);
    expect(next.parentById.get(parseNodeId("A"))).toBe("root-b");
  });

  test("nests into a collection node", () => {
    const graph = fixture();
    const { graph: next } = apply(graph, {
      type: "move-nodes",
      nodeIds: ids(["B"]),
      toParentId: parseNodeId("F"),
      toIndex: 1,
    });
    expect(childNames(next, "F")).toEqual(["f1", "B"]);
  });

  test("multi-node move preserves document order regardless of selection order", () => {
    const graph = fixture();
    const { graph: next } = apply(graph, {
      type: "move-nodes",
      nodeIds: ids(["D", "A", "C"]), // deliberately shuffled
      toParentId: parseNodeId("root-b"),
      toIndex: 0,
    });
    expect(childNames(next, "root-b")).toEqual(["A", "C", "D", "X", "Y"]);
    expect(childNames(next, "root-a")).toEqual(["B", "F"]);
  });

  test("multi-node move within the same collection lands contiguously at the index", () => {
    const graph = fixture();
    // Move A and D to post-removal index 1 of root-a ([B, C, F] base) -> B, A, D, C, F.
    const { graph: next } = apply(graph, {
      type: "move-nodes",
      nodeIds: ids(["A", "D"]),
      toParentId: parseNodeId("root-a"),
      toIndex: 1,
    });
    expect(childNames(next, "root-a")).toEqual(["B", "A", "D", "C", "F"]);
  });

  test("prunes descendants of dragged collections (subtree moves with its root)", () => {
    const graph = fixture();
    const { graph: next } = apply(graph, {
      type: "move-nodes",
      nodeIds: ids(["F", "f1"]), // f1 is inside F — must not be ripped out
      toParentId: parseNodeId("root-b"),
      toIndex: 2,
    });
    expect(childNames(next, "root-b")).toEqual(["X", "Y", "F"]);
    expect(childNames(next, "F")).toEqual(["f1"]);
  });

  test("rejects a cycle: collection into its own descendant", () => {
    const graph = build([
      collection("root", [collection("outer", [collection("inner", [])])]),
    ]);
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: ids(["outer"]),
      toParentId: parseNodeId("inner"),
      toIndex: 0,
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: "would-create-cycle", nodeId: "outer" },
    });
  });

  test("rejects a collection dropped into itself", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: ids(["F"]),
      toParentId: parseNodeId("F"),
      toIndex: 0,
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: "would-create-cycle", nodeId: "F" },
    });
  });

  test("rejects moving a root collection (roots are structural anchors)", () => {
    // Without this rejection, the reducer would emit a patch with a null
    // fromParentId, inserting a null key into childrenById and leaving the
    // node both a root and a child — a corrupted graph.
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: ids(["root-a"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 0,
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: "cannot-move-root", nodeId: "root-a" },
    });
    expect(findGraphInvariantViolation(graph)).toBeNull();
  });

  test("rejects a mixed selection that includes a root, changing nothing", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: ids(["A", "root-b"]),
      toParentId: parseNodeId("F"),
      toIndex: 0,
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: "cannot-move-root", nodeId: "root-b" },
    });
    // The whole command is rejected atomically — A did not move either.
    expect(childNames(graph, "root-a")).toEqual(["A", "B", "C", "D", "F"]);
  });

  test("rejects duplicate node ids instead of corrupting", () => {
    // Pre-fix, [A, A] produced two moves for A: applyPatch removed it once
    // from root-a but inserted it TWICE into root-b — a duplicate child.
    // The UI can't produce this (drag sets come from a Set), but the
    // reducer is public and must defend itself.
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: ids(["A", "A"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 0,
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: "duplicate-node-id", nodeId: "A" },
    });
    expect(findGraphInvariantViolation(graph)).toBeNull();
  });

  test("rejects duplicates hidden inside a larger multi-node selection", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: ids(["A", "B", "C", "B"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 0,
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: "duplicate-node-id", nodeId: "B" },
    });
    // Atomic rejection: nothing moved.
    expect(childNames(graph, "root-a")).toEqual(["A", "B", "C", "D", "F"]);
  });

  test("rejects same-position no-ops", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: ids(["A"]),
      toParentId: parseNodeId("root-a"),
      toIndex: 0,
    });
    expect(result).toEqual({ ok: false, error: { reason: "same-position" } });
  });

  test("rejects unknown nodes and non-collection targets", () => {
    const graph = fixture();
    expect(
      applyCommand(graph, {
        type: "move-nodes",
        nodeIds: ids(["nope"]),
        toParentId: parseNodeId("root-a"),
        toIndex: 0,
      })
    ).toEqual({ ok: false, error: { reason: "missing-node", nodeId: "nope" } });
    expect(
      applyCommand(graph, {
        type: "move-nodes",
        nodeIds: ids(["A"]),
        toParentId: parseNodeId("B"),
        toIndex: 0,
      })
    ).toEqual({ ok: false, error: { reason: "target-not-collection", nodeId: "B" } });
  });

  test("rejects non-finite indexes (NaN would silently splice at 0)", () => {
    const graph = fixture();
    for (const toIndex of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        applyCommand(graph, {
          type: "move-nodes",
          nodeIds: ids(["A"]),
          toParentId: parseNodeId("root-b"),
          toIndex,
        })
      ).toEqual({ ok: false, error: { reason: "invalid-index" } });
    }
  });

  test("clamps out-of-range indexes instead of corrupting", () => {
    const graph = fixture();
    const { graph: next } = apply(graph, {
      type: "move-nodes",
      nodeIds: ids(["A"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 99,
    });
    expect(childNames(next, "root-b")).toEqual(["X", "Y", "A"]);
  });

  test("shares structure for untouched collections", () => {
    const graph = fixture();
    const before = getChildren(graph, parseNodeId("F"));
    const { graph: next } = apply(graph, {
      type: "move-nodes",
      nodeIds: ids(["A"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 0,
    });
    // F wasn't involved — its children array must be the SAME reference, so
    // selector subscriptions on it skip re-rendering.
    expect(getChildren(next, parseNodeId("F"))).toBe(before);
    expect(next.nodesById).toBe(graph.nodesById);
  });
});

describe("applyCommand: add-nodes", () => {
  const newMedia = { id: parseNodeId("new-1"), kind: "media", name: "New", durationSeconds: 3 } as const;
  const newFolder = { id: parseNodeId("new-c"), kind: "collection", name: "New folder" } as const;

  test("inserts brand-new nodes at the index; new collections get a children entry", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "add-nodes",
      nodes: [newMedia, newFolder],
      toParentId: parseNodeId("root-a"),
      toIndex: 1,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(findGraphInvariantViolation(result.value.graph)).toBeNull();
    expect(childNames(result.value.graph, "root-a")).toEqual([
      "A", "new-1", "new-c", "B", "C", "D", "F",
    ]);
    expect(result.value.graph.childrenById.get(newFolder.id)).toEqual([]);
  });

  test("rejects id collisions with the graph and within the batch", () => {
    const graph = fixture();
    expect(
      applyCommand(graph, {
        type: "add-nodes",
        nodes: [{ ...newMedia, id: parseNodeId("A") }],
        toParentId: parseNodeId("root-a"),
        toIndex: 0,
      })
    ).toEqual({ ok: false, error: { reason: "duplicate-node-id", nodeId: "A" } });
    expect(
      applyCommand(graph, {
        type: "add-nodes",
        nodes: [newMedia, newMedia],
        toParentId: parseNodeId("root-a"),
        toIndex: 0,
      })
    ).toEqual({ ok: false, error: { reason: "duplicate-node-id", nodeId: "new-1" } });
  });

  test("rejects empty adds and non-collection targets", () => {
    const graph = fixture();
    expect(
      applyCommand(graph, {
        type: "add-nodes",
        nodes: [],
        toParentId: parseNodeId("root-a"),
        toIndex: 0,
      })
    ).toEqual({ ok: false, error: { reason: "nothing-to-add" } });
    expect(
      applyCommand(graph, {
        type: "add-nodes",
        nodes: [newMedia],
        toParentId: parseNodeId("A"),
        toIndex: 0,
      })
    ).toEqual({ ok: false, error: { reason: "target-not-collection", nodeId: "A" } });
  });

  test("add inverts to a removal and back (undo/redo round-trip)", () => {
    const graph = fixture();
    const { graph: added, patch } = apply(graph, {
      type: "add-nodes",
      nodes: [newMedia],
      toParentId: parseNodeId("F"),
      toIndex: 1,
    });
    expect(childNames(added, "F")).toEqual(["f1", "new-1"]);

    const undone = applyPatch(added, invertPatch(patch));
    expect(findGraphInvariantViolation(undone)).toBeNull();
    expect(childNames(undone, "F")).toEqual(["f1"]);
    expect(undone.nodesById.has(newMedia.id)).toBe(false);

    const redone = applyPatch(undone, patch);
    expect(findGraphInvariantViolation(redone)).toBeNull();
    expect(childNames(redone, "F")).toEqual(["f1", "new-1"]);
    expect(redone.nodesById.get(newMedia.id)).toEqual(newMedia);
  });
});

describe("patch inversion round-trips", () => {
  function roundTrip(graph: CollectionsGraph, command: CollectionsCommand) {
    const { graph: next, patch } = apply(graph, command);
    const undone = applyPatch(next, invertPatch(patch));
    expect(findGraphInvariantViolation(undone)).toBeNull();
    for (const [id] of graph.childrenById) {
      expect([...getChildren(undone, id)]).toEqual([...getChildren(graph, id)]);
    }
    const redone = applyPatch(undone, patch);
    for (const [id] of next.childrenById) {
      expect([...getChildren(redone, id)]).toEqual([...getChildren(next, id)]);
    }
  }

  test("single-node cross-collection", () => {
    roundTrip(fixture(), {
      type: "move-nodes",
      nodeIds: ids(["B"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 1,
    });
  });

  test("multi-node from multiple parents into one target", () => {
    roundTrip(fixture(), {
      type: "move-nodes",
      nodeIds: ids(["A", "X", "f1"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 0,
    });
  });

  test("same-collection shuffle", () => {
    roundTrip(fixture(), {
      type: "move-nodes",
      nodeIds: ids(["D", "B"]),
      toParentId: parseNodeId("root-a"),
      toIndex: 0,
    });
  });

  test("nest then round-trip", () => {
    roundTrip(fixture(), {
      type: "move-nodes",
      nodeIds: ids(["A", "B"]),
      toParentId: parseNodeId("F"),
      toIndex: 0,
    });
  });
});
