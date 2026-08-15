import { describe, expect, test } from "vitest";
import {
  buildGraph,
  findGraphInvariantViolation,
  getChildren,
  mediaDurationSeconds,
  parseNodeId,
  type CollectionsGraph,
  type GraphNodeSpec,
} from "./graph";
import {
  applyCommand,
  MIN_MEDIA_DURATION_SECONDS,
  type CollectionsCommand,
} from "./commands";
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

  test("rejects a MULTI-node arrangement that lands where it started as same-position", () => {
    // [A, B] back to the head of root-a: post-removal base is [C, D, F],
    // ascending insertion reproduces [A, B, C, D, F] — identical layout, so
    // graphChildrenEqual must catch it (nothing pushed to history).
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: ids(["A", "B"]),
      toParentId: parseNodeId("root-a"),
      toIndex: 0,
    });
    expect(result).toEqual({ ok: false, error: { reason: "same-position" } });
  });

  test("rejects an empty drag set as nothing-to-move", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: [],
      toParentId: parseNodeId("root-b"),
      toIndex: 0,
    });
    expect(result).toEqual({ ok: false, error: { reason: "nothing-to-move" } });
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

  test("rejects non-integer indexes (NaN splices at 0; a fraction desyncs from its patch)", () => {
    const graph = fixture();
    for (const toIndex of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, -0.5]) {
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

  test("does not hang on a corrupt cyclic parentById chain", () => {
    // Hand-build a graph whose parent pointers form a cycle (A -> B -> A):
    // the descendant-pruning walk must terminate, not spin forever.
    const graph = fixture();
    const cyclicParents = new Map(graph.parentById);
    cyclicParents.set(parseNodeId("A"), parseNodeId("B"));
    cyclicParents.set(parseNodeId("B"), parseNodeId("A"));
    const corrupt: CollectionsGraph = { ...graph, parentById: cyclicParents };

    // Whatever it decides, it must RETURN (the assertion is that this call
    // completes at all rather than timing out).
    const result = applyCommand(corrupt, {
      type: "move-nodes",
      nodeIds: ids(["A"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 0,
    });
    expect(result).toBeDefined();
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

  test("indexes an affected source collection once for multi-node moves", () => {
    const base = fixture();
    const sourceChildren = [...getChildren(base, parseNodeId("root-a"))];
    Object.defineProperty(sourceChildren, "indexOf", {
      value: () => {
        throw new Error("per-node linear source lookup");
      },
    });
    const childrenById = new Map(base.childrenById);
    childrenById.set(parseNodeId("root-a"), sourceChildren);
    const graph: CollectionsGraph = { ...base, childrenById };

    const { graph: next, patch } = apply(graph, {
      type: "move-nodes",
      nodeIds: ids(["A", "C"]),
      toParentId: parseNodeId("root-b"),
      toIndex: 1,
    });
    expect(patch).toMatchObject({
      type: "nodes-moved",
      moves: [{ nodeId: "A", fromIndex: 0 }, { nodeId: "C", fromIndex: 2 }],
    });
    expect(childNames(next, "root-b")).toEqual(["X", "A", "C", "Y"]);
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

  test("rejects added nodes with an empty or whitespace id", () => {
    const graph = fixture();
    // parseNodeId would throw on these, but the reducer is public and a
    // consumer can forge a branded id past the type system.
    for (const badId of ["", "   "]) {
      expect(
        applyCommand(graph, {
          type: "add-nodes",
          nodes: [{ ...newMedia, id: badId as unknown as typeof newMedia.id }],
          toParentId: parseNodeId("root-a"),
          toIndex: 0,
        })
      ).toEqual({ ok: false, error: { reason: "invalid-node-id", nodeId: badId } });
    }
  });

  test("rejects a malformed runtime node without partially adding the batch", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "add-nodes",
      nodes: [
        newMedia,
        {
          ...newMedia,
          id: parseNodeId("invalid-duration"),
          durationSeconds: Number.NaN,
        },
      ],
      toParentId: parseNodeId("root-a"),
      toIndex: 0,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        reason: "invalid-node",
        index: 1,
        validationError: {
          reason: "invalid-value",
          path: "$.durationSeconds",
          message: "Expected a finite, non-negative number.",
        },
      },
    });
    expect(graph.nodesById.has(newMedia.id)).toBe(false);
    expect(graph.nodesById.has(parseNodeId("invalid-duration"))).toBe(false);
  });

  test("stores a parsed copy instead of caller-owned node data", () => {
    const graph = fixture();
    const posterSrcs = ["frame-a.jpg", "frame-b.jpg"];
    const node = {
      id: parseNodeId("new-video"),
      kind: "media" as const,
      mediaKind: "video" as const,
      name: "New video",
      posterSrcs,
      fullDurationSeconds: 10,
      trimInSeconds: 1,
      trimOutSeconds: 2,
    };
    const result = applyCommand(graph, {
      type: "add-nodes",
      nodes: [node],
      toParentId: parseNodeId("root-a"),
      toIndex: 0,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    const stored = result.value.graph.nodesById.get(node.id);
    expect(stored).not.toBe(node);
    if (stored?.kind !== "media" || stored.mediaKind !== "video") {
      throw new Error("Expected the added video node.");
    }
    expect(stored.posterSrcs).not.toBe(posterSrcs);
    posterSrcs[0] = "mutated.jpg";
    expect(stored.posterSrcs).toEqual(["frame-a.jpg", "frame-b.jpg"]);
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
    expect(redone.nodesById.get(newMedia.id)).toEqual(added.nodesById.get(newMedia.id));
  });
});

describe("applyCommand: update-media", () => {
  // root-a: [A (image), V (video, full 10, untrimmed)].
  function withVideo(): CollectionsGraph {
    return build([
      collection("root-a", [
        media("A"),
        {
          kind: "media",
          mediaKind: "video",
          id: "V",
          name: "V",
          fullDurationSeconds: 10,
          trimInSeconds: 0,
          trimOutSeconds: 0,
        },
      ]),
    ]);
  }
  const dur = (graph: CollectionsGraph, id: string): number => {
    const n = graph.nodesById.get(parseNodeId(id));
    return n && n.kind === "media" ? mediaDurationSeconds(n) : -1;
  };

  test("image: sets durationSeconds directly", () => {
    const { graph: next } = apply(withVideo(), {
      type: "update-media",
      nodeId: parseNodeId("A"),
      update: { mediaKind: "image", durationSeconds: 9 },
    });
    expect(dur(next, "A")).toBe(9);
  });

  test("video: trimming in and out derives the effective duration", () => {
    const { graph: next } = apply(withVideo(), {
      type: "update-media",
      nodeId: parseNodeId("V"),
      update: { mediaKind: "video", trimInSeconds: 2, trimOutSeconds: 3 },
    });
    expect(dur(next, "V")).toBe(5); // 10 - 2 - 3
  });

  test("video: an omitted end keeps the current trim (change one handle at a time)", () => {
    let graph = withVideo();
    ({ graph } = apply(graph, {
      type: "update-media",
      nodeId: parseNodeId("V"),
      update: { mediaKind: "video", trimOutSeconds: 4 },
    }));
    ({ graph } = apply(graph, {
      type: "update-media",
      nodeId: parseNodeId("V"),
      update: { mediaKind: "video", trimInSeconds: 1 },
    }));
    expect(dur(graph, "V")).toBe(5); // 10 - 1 - 4
  });

  // REVERSED (#341). This asserted the ends could meet at exactly 0, which is
  // what let a drag leave a clip showing nothing while the agent path refused
  // the identical edit. The floor is now the reducer's, so every surface —
  // pointer, keyboard, agent — inherits it.
  test("video: clamps trim so at least the minimum stays showing", () => {
    const { graph: next } = apply(withVideo(), {
      type: "update-media",
      nodeId: parseNodeId("V"),
      update: { mediaKind: "video", trimInSeconds: 8, trimOutSeconds: 8 },
    });
    // trimIn -> 9.9 (10 - floor), trimOut -> 0.
    expect(dur(next, "V")).toBeCloseTo(MIN_MEDIA_DURATION_SECONDS, 6);
  });

  test("video: an over-trimmed START edge alone still leaves the minimum", () => {
    const { graph: next } = apply(withVideo(), {
      type: "update-media",
      nodeId: parseNodeId("V"),
      update: { mediaKind: "video", trimInSeconds: 99 },
    });
    expect(dur(next, "V")).toBeCloseTo(MIN_MEDIA_DURATION_SECONDS, 6);
  });

  test("image: a zero or negative duration lands on the floor, not on nothing", () => {
    const { graph: next } = apply(withVideo(), {
      type: "update-media",
      nodeId: parseNodeId("A"),
      update: { mediaKind: "image", durationSeconds: 0 },
    });
    expect(dur(next, "A")).toBe(MIN_MEDIA_DURATION_SECONDS);
  });

  test("rejects non-media targets, kind mismatch, non-finite values, and no-ops", () => {
    const graph = withVideo();
    expect(
      applyCommand(graph, {
        type: "update-media",
        nodeId: parseNodeId("root-a"),
        update: { mediaKind: "image", durationSeconds: 3 },
      })
    ).toEqual({ ok: false, error: { reason: "not-media-node", nodeId: "root-a" } });
    expect(
      applyCommand(graph, {
        type: "update-media",
        nodeId: parseNodeId("V"), // video
        update: { mediaKind: "image", durationSeconds: 3 }, // image update
      })
    ).toEqual({ ok: false, error: { reason: "invalid-media-update", nodeId: "V" } });
    expect(
      applyCommand(graph, {
        type: "update-media",
        nodeId: parseNodeId("A"),
        update: { mediaKind: "image", durationSeconds: Number.NaN },
      })
    ).toEqual({ ok: false, error: { reason: "invalid-media-update", nodeId: "A" } });
    expect(
      applyCommand(graph, {
        type: "update-media",
        nodeId: parseNodeId("V"),
        update: { mediaKind: "video" }, // no fields -> no change
      })
    ).toEqual({ ok: false, error: { reason: "same-position" } });
    expect(
      applyCommand(graph, {
        type: "update-media",
        nodeId: parseNodeId("nope"),
        update: { mediaKind: "image", durationSeconds: 1 },
      })
    ).toEqual({ ok: false, error: { reason: "missing-node", nodeId: "nope" } });
  });

  test("round-trips through invert (structure untouched, node data restored)", () => {
    const graph = withVideo();
    const { graph: next, patch } = apply(graph, {
      type: "update-media",
      nodeId: parseNodeId("V"),
      update: { mediaKind: "video", trimInSeconds: 2, trimOutSeconds: 1 },
    });
    expect(dur(next, "V")).toBe(7);

    const undone = applyPatch(next, invertPatch(patch));
    expect(findGraphInvariantViolation(undone)).toBeNull();
    expect(dur(undone, "V")).toBe(10); // back to untrimmed
    // Untouched sibling keeps its identity (structural sharing).
    expect(undone.nodesById.get(parseNodeId("A"))).toBe(graph.nodesById.get(parseNodeId("A")));

    const redone = applyPatch(undone, patch);
    expect(dur(redone, "V")).toBe(7);
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

describe("set-node-placement", () => {
  const nodeOf = (graph: CollectionsGraph, id: string) => graph.nodesById.get(parseNodeId(id))!;

  test("sets a lane and a start on media and on collections, leaving structure alone", () => {
    // A whole nested scene under the picture is a legitimate layer, so a
    // collection has to be placeable too.
    for (const target of ["A", "F"]) {
      const graph = fixture();
      const result = applyCommand(graph, {
        type: "set-node-placement",
        nodeIds: [parseNodeId(target)],
        placement: { trackIndex: 1, placedStart: 7.5 },
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(nodeOf(result.value.graph, target).trackIndex).toBe(1);
      expect(nodeOf(result.value.graph, target).placedStart).toBe(7.5);
      for (const [id] of graph.childrenById) {
        expect([...getChildren(result.value.graph, id)]).toEqual([...getChildren(graph, id)]);
      }
      expect(findGraphInvariantViolation(result.value.graph)).toBeNull();
    }
  });

  test("an omitted field is LEFT ALONE, so a lane change cannot un-place a clip", () => {
    const placed = applyCommand(fixture(), {
      type: "set-node-placement",
      nodeIds: [parseNodeId("A")],
      placement: { trackIndex: 1, placedStart: 7.5 },
    });
    if (!placed.ok) throw new Error("expected ok");

    const moved = applyCommand(placed.value.graph, {
      type: "set-node-placement",
      nodeIds: [parseNodeId("A")],
      placement: { trackIndex: 2 },
    });
    if (!moved.ok) throw new Error("expected ok");
    expect(nodeOf(moved.value.graph, "A").trackIndex).toBe(2);
    expect(nodeOf(moved.value.graph, "A").placedStart).toBe(7.5);
  });

  test("null CLEARS a field, deleting the key rather than writing 0", () => {
    const placed = applyCommand(fixture(), {
      type: "set-node-placement",
      nodeIds: [parseNodeId("A")],
      placement: { trackIndex: 1, placedStart: 7.5 },
    });
    if (!placed.ok) throw new Error("expected ok");

    const cleared = applyCommand(placed.value.graph, {
      type: "set-node-placement",
      nodeIds: [parseNodeId("A")],
      placement: { placedStart: null },
    });
    if (!cleared.ok) throw new Error("expected ok");
    // Absence IS the queued state; a 0 would mean "placed at the very start".
    expect("placedStart" in nodeOf(cleared.value.graph, "A")).toBe(false);
    expect(nodeOf(cleared.value.graph, "A").trackIndex).toBe(1);
  });

  test("a no-op change is refused, so it never enters history", () => {
    const noop = applyCommand(fixture(), {
      type: "set-node-placement",
      nodeIds: [parseNodeId("A")],
      placement: { placedStart: null },
    });
    expect(noop.ok).toBe(false);
    if (!noop.ok) expect(noop.error.reason).toBe("same-position");
  });

  test("a missing node is refused", () => {
    const result = applyCommand(fixture(), {
      type: "set-node-placement",
      nodeIds: [parseNodeId("nope")],
      placement: { trackIndex: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("missing-node");
  });

  test("a non-finite value is refused rather than stored", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = applyCommand(fixture(), {
        type: "set-node-placement",
        nodeIds: [parseNodeId("A")],
        placement: { placedStart: bad },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe("invalid-placement");
    }
  });

  test("UNDO restores the previous placement — the whole point of the command", () => {
    // Lane and placement used to live in a consumer side-table, where a change
    // emitted no patch and could not be undone at all.
    const placed = applyCommand(fixture(), {
      type: "set-node-placement",
      nodeIds: [parseNodeId("A")],
      placement: { trackIndex: 1, placedStart: 7.5 },
    });
    if (!placed.ok) throw new Error("expected ok");

    const undone = applyPatch(placed.value.graph, invertPatch(placed.value.patch));
    expect("trackIndex" in nodeOf(undone, "A")).toBe(false);
    expect("placedStart" in nodeOf(undone, "A")).toBe(false);

    const redone = applyPatch(undone, placed.value.patch);
    expect(nodeOf(redone, "A").trackIndex).toBe(1);
    expect(nodeOf(redone, "A").placedStart).toBe(7.5);
  });

  test("a whole selection is placed in ONE patch, and comes back in one undo", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "set-node-placement",
      nodeIds: ids(["A", "B"]),
      placement: { trackIndex: 1 },
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.patch.type).toBe("nodes-updated");

    const undone = applyPatch(result.value.graph, invertPatch(result.value.patch));
    for (const id of ["A", "B"]) expect("trackIndex" in nodeOf(undone, id)).toBe(false);
  });

  test("a repeated id contributes one update, so the patch stays reversible", () => {
    const result = applyCommand(fixture(), {
      type: "set-node-placement",
      nodeIds: ids(["A", "A"]),
      placement: { trackIndex: 1 },
    });
    if (!result.ok) throw new Error("expected ok");
    if (result.value.patch.type !== "nodes-updated") throw new Error("expected nodes-updated");
    expect(result.value.patch.updates).toHaveLength(1);
  });

  test("an empty batch is refused", () => {
    const result = applyCommand(fixture(), {
      type: "set-node-placement",
      nodeIds: [],
      placement: { trackIndex: 1 },
    });
    expect(result.ok).toBe(false);
  });
});

describe("set-node-disabled", () => {
  const nodeOf = (graph: CollectionsGraph, id: string) => graph.nodesById.get(parseNodeId(id))!;

  test("sets the flag on media and on collections, leaving structure alone", () => {
    for (const target of ["A", "F"]) {
      const graph = fixture();
      const result = applyCommand(graph, {
        type: "set-node-disabled",
        nodeIds: [parseNodeId(target)],
        disabled: true,
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(nodeOf(result.value.graph, target).disabled).toBe(true);
      // Structure untouched — a disabled node keeps its slot and its children.
      for (const [id] of graph.childrenById) {
        expect([...getChildren(result.value.graph, id)]).toEqual([...getChildren(graph, id)]);
      }
      expect(findGraphInvariantViolation(result.value.graph)).toBeNull();
    }
  });

  test("enabling DELETES the key rather than writing false", () => {
    const disabled = applyCommand(fixture(), {
      type: "set-node-disabled",
      nodeIds: [parseNodeId("A")],
      disabled: true,
    });
    if (!disabled.ok) throw new Error("expected ok");

    const enabled = applyCommand(disabled.value.graph, {
      type: "set-node-disabled",
      nodeIds: [parseNodeId("A")],
      disabled: false,
    });
    if (!enabled.ok) throw new Error("expected ok");
    // `false` would be truthy-adjacent noise on every clip that ever toggled;
    // absence is the enabled state everywhere else in the model.
    expect("disabled" in nodeOf(enabled.value.graph, "A")).toBe(false);
  });

  test("a no-op change is refused, so it never enters history", () => {
    const alreadyEnabled = applyCommand(fixture(), {
      type: "set-node-disabled",
      nodeIds: [parseNodeId("A")],
      disabled: false,
    });
    expect(alreadyEnabled.ok).toBe(false);
    if (!alreadyEnabled.ok) expect(alreadyEnabled.error.reason).toBe("same-position");
  });

  test("a missing node is refused", () => {
    const result = applyCommand(fixture(), {
      type: "set-node-disabled",
      nodeIds: [parseNodeId("nope")],
      disabled: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("missing-node");
  });

  test("undo restores the previous flag", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "set-node-disabled",
      nodeIds: [parseNodeId("A")],
      disabled: true,
    });
    if (!result.ok) throw new Error("expected ok");

    const undone = applyPatch(result.value.graph, invertPatch(result.value.patch));
    expect("disabled" in nodeOf(undone, "A")).toBe(false);
    const redone = applyPatch(undone, result.value.patch);
    expect(nodeOf(redone, "A").disabled).toBe(true);
  });

  // Disabling a multi-selection is ONE user action. Per-node dispatch made it
  // N history entries, so undo gave the items back one at a time.
  test("a whole selection goes disabled in ONE patch, and comes back in one undo", () => {
    const graph = fixture();
    const result = applyCommand(graph, {
      type: "set-node-disabled",
      nodeIds: ids(["A", "B", "F"]),
      disabled: true,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.patch.type).toBe("nodes-updated");
    if (result.value.patch.type === "nodes-updated") {
      expect(result.value.patch.updates).toHaveLength(3);
    }
    for (const id of ["A", "B", "F"]) {
      expect(nodeOf(result.value.graph, id).disabled).toBe(true);
    }
    expect(findGraphInvariantViolation(result.value.graph)).toBeNull();

    // ONE inversion restores all three — not one item per undo.
    const undone = applyPatch(result.value.graph, invertPatch(result.value.patch));
    for (const id of ["A", "B", "F"]) {
      expect("disabled" in nodeOf(undone, id)).toBe(false);
    }
  });

  test("a partly-disabled selection resolves to one state, skipping what is already there", () => {
    const first = applyCommand(fixture(), {
      type: "set-node-disabled",
      nodeIds: [parseNodeId("A")],
      disabled: true,
    });
    if (!first.ok) throw new Error("expected ok");

    // A is already disabled; B is not. The batch must still apply, carrying
    // only the node that actually changes — otherwise a mixed selection would
    // be refused outright.
    const result = applyCommand(first.value.graph, {
      type: "set-node-disabled",
      nodeIds: ids(["A", "B"]),
      disabled: true,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    if (result.value.patch.type === "nodes-updated") {
      expect(result.value.patch.updates.map((update) => String(update.nodeId))).toEqual(["B"]);
    }
  });

  test("a batch where EVERY node is already in the target state is refused", () => {
    const result = applyCommand(fixture(), {
      type: "set-node-disabled",
      nodeIds: ids(["A", "B"]),
      disabled: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("same-position");
  });

  test("a repeated id contributes ONE update, so the patch stays invertible", () => {
    // Two updates for one node would leave the second's `before` equal to the
    // first's `after`, and inverting that could not restore the original.
    const result = applyCommand(fixture(), {
      type: "set-node-disabled",
      nodeIds: ids(["A", "A"]),
      disabled: true,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    if (result.value.patch.type === "nodes-updated") {
      expect(result.value.patch.updates).toHaveLength(1);
    }
    const undone = applyPatch(result.value.graph, invertPatch(result.value.patch));
    expect("disabled" in nodeOf(undone, "A")).toBe(false);
  });

  test("an empty batch is refused", () => {
    const result = applyCommand(fixture(), {
      type: "set-node-disabled",
      nodeIds: [],
      disabled: true,
    });
    expect(result.ok).toBe(false);
  });
});
