import { describe, expect, test } from "vitest";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "./graph";
import {
  decodeDropTarget,
  encodeDropTarget,
  isIntentInvalid,
  resolveCommandFromIntent,
  resolveDropIntent,
  resolvePlacementCommand,
  type RectLike,
} from "./intents";

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

const graph = build([
  collection("root-a", [media("A"), media("B"), collection("F", [media("f1")]), media("C")]),
  collection("root-b", [media("X")]),
]);

const rect: RectLike = { left: 100, top: 0, width: 200, height: 100 };
const ids = (values: readonly string[]) => values.map((v) => parseNodeId(v));

describe("drop target encoding", () => {
  test("round-trips node and panel targets", () => {
    expect(decodeDropTarget(encodeDropTarget({ type: "node", nodeId: parseNodeId("A") }))).toEqual({
      type: "node",
      nodeId: "A",
    });
    expect(
      decodeDropTarget(encodeDropTarget({ type: "panel", collectionId: parseNodeId("root-a") }))
    ).toEqual({ type: "panel", collectionId: "root-a" });
  });

  test("rejects malformed ids", () => {
    expect(decodeDropTarget("garbage")).toBeNull();
    expect(decodeDropTarget("node:")).toBeNull();
    expect(decodeDropTarget("mystery:x")).toBeNull();
  });
});

describe("resolveDropIntent", () => {
  test("left half of a media node -> insert-before; right half -> insert-after", () => {
    const before = resolveDropIntent({
      graph,
      target: { type: "node", nodeId: parseNodeId("B") },
      targetRect: rect,
      point: { x: 120, y: 50 },
      activeIds: ids(["A"]),
    });
    expect(before).toEqual({ type: "insert-adjacent", side: "before", targetId: "B" });

    const after = resolveDropIntent({
      graph,
      target: { type: "node", nodeId: parseNodeId("B") },
      targetRect: rect,
      point: { x: 280, y: 50 },
      activeIds: ids(["A"]),
    });
    expect(after).toEqual({ type: "insert-adjacent", side: "after", targetId: "B" });
  });

  test("center band of a collection card -> nest-inside; edges -> insert-adjacent", () => {
    const nest = resolveDropIntent({
      graph,
      target: { type: "node", nodeId: parseNodeId("F") },
      targetRect: rect,
      point: { x: 200, y: 50 }, // center
      activeIds: ids(["A"]),
    });
    expect(nest).toEqual({ type: "nest-inside", collectionId: "F" });

    const edge = resolveDropIntent({
      graph,
      target: { type: "node", nodeId: parseNodeId("F") },
      targetRect: rect,
      point: { x: 105, y: 50 }, // far left, outside [25%, 75%] band
      activeIds: ids(["A"]),
    });
    expect(edge).toEqual({ type: "insert-adjacent", side: "before", targetId: "F" });
  });

  test("panel target without child rects -> append-to-collection", () => {
    const intent = resolveDropIntent({
      graph,
      target: { type: "panel", collectionId: parseNodeId("root-b") },
      targetRect: rect,
      point: { x: 200, y: 50 },
      activeIds: ids(["A"]),
    });
    expect(intent).toEqual({ type: "append-to-collection", collectionId: "root-b" });
  });

  test("malformed pointer geometry resolves no intent", () => {
    const base = {
      graph,
      target: { type: "node", nodeId: parseNodeId("B") } as const,
      targetRect: rect,
      point: { x: 120, y: 50 },
      activeIds: ids(["A"]),
    };
    expect(resolveDropIntent({ ...base, point: { x: Number.NaN, y: 50 } })).toBeNull();
    expect(
      resolveDropIntent({
        ...base,
        targetRect: { ...rect, width: Number.POSITIVE_INFINITY },
      })
    ).toBeNull();
    expect(resolveDropIntent({ ...base, targetRect: { ...rect, height: -1 } })).toBeNull();
  });

  test("dragged node itself is never a target (self-drop guard)", () => {
    const intent = resolveDropIntent({
      graph,
      target: { type: "node", nodeId: parseNodeId("A") },
      targetRect: rect,
      point: { x: 280, y: 50 },
      activeIds: ids(["A"]),
    });
    expect(intent).toBeNull();
  });

  test("descendants of a dragged collection resolve intents that are flagged invalid", () => {
    // Hovering f1 while dragging F: the intent resolves (so the UI can show
    // a live "Cannot drop (cycle)" preview) but is flagged invalid — and the
    // reducer independently rejects it at commit.
    const intent = resolveDropIntent({
      graph,
      target: { type: "node", nodeId: parseNodeId("f1") },
      targetRect: rect,
      point: { x: 120, y: 50 },
      activeIds: ids(["F"]),
    });
    expect(intent).toEqual({ type: "insert-adjacent", side: "before", targetId: "f1" });
    expect(isIntentInvalid(graph, intent!, ids(["F"]))).toBe(true);
  });
});

describe("resolveDropIntent panel gap resolution", () => {
  // root-a's cards laid out in one row, 100 wide with 20px gaps:
  // A [0,100]  B [120,220]  F [240,340]  C [360,460], all top 0 height 100.
  const row = (id: string, left: number) => ({
    id: parseNodeId(id),
    rect: { left, top: 0, width: 100, height: 100 } as RectLike,
  });
  const childRects = [row("A", 0), row("B", 120), row("F", 240), row("C", 360)];
  const panel = {
    graph,
    target: { type: "panel", collectionId: parseNodeId("root-a") } as const,
    targetRect: { left: -10, top: -10, width: 500, height: 200 } as RectLike,
    panelChildRects: childRects,
  };

  test("gap between two cards -> insert between them, not append", () => {
    // Nearer A's right edge: anchors after A.
    expect(
      resolveDropIntent({ ...panel, point: { x: 105, y: 50 }, activeIds: ids(["X"]) })
    ).toEqual({ type: "insert-adjacent", side: "after", targetId: "A" });
    // Nearer B's left edge: anchors before B — the same insertion point.
    expect(
      resolveDropIntent({ ...panel, point: { x: 115, y: 50 }, activeIds: ids(["X"]) })
    ).toEqual({ type: "insert-adjacent", side: "before", targetId: "B" });
  });

  test("row ends: panel padding left of the first card / right of the last", () => {
    expect(
      resolveDropIntent({ ...panel, point: { x: -5, y: 50 }, activeIds: ids(["X"]) })
    ).toEqual({ type: "insert-adjacent", side: "before", targetId: "A" });
    expect(
      resolveDropIntent({ ...panel, point: { x: 470, y: 50 }, activeIds: ids(["X"]) })
    ).toEqual({ type: "insert-adjacent", side: "after", targetId: "C" });
  });

  test("vertical whitespace (no card's row) still appends", () => {
    expect(
      resolveDropIntent({ ...panel, point: { x: 200, y: 150 }, activeIds: ids(["X"]) })
    ).toEqual({ type: "append-to-collection", collectionId: "root-a" });
  });

  test("a dragged card is not a gap anchor — the nearest real neighbor wins", () => {
    // x=115 is nearest B, but B is being dragged (dimmed in place): A wins.
    expect(
      resolveDropIntent({ ...panel, point: { x: 115, y: 50 }, activeIds: ids(["B"]) })
    ).toEqual({ type: "insert-adjacent", side: "after", targetId: "A" });
  });
});

describe("resolveCommandFromIntent (post-removal index math)", () => {
  test("insert-after when the dragged node sits before the target (forward drag)", () => {
    // root-a children: [A, B, F, C]. Dragging A after B: boundary is visible
    // index 2, minus one dragged node before it -> post-removal index 1.
    const result = resolveCommandFromIntent(
      graph,
      { type: "insert-adjacent", side: "after", targetId: parseNodeId("B") },
      ids(["A"])
    );
    expect(result).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["A"], toParentId: "root-a", toIndex: 1 },
    });
  });

  test("insert-before with multiple dragged nodes ahead of the boundary", () => {
    // Dragging A and B before C (visible index 3): two dragged before -> 1.
    const result = resolveCommandFromIntent(
      graph,
      { type: "insert-adjacent", side: "before", targetId: parseNodeId("C") },
      ids(["A", "B"])
    );
    expect(result).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["A", "B"], toParentId: "root-a", toIndex: 1 },
    });
  });

  test("nest-inside appends at the end of the collection", () => {
    const result = resolveCommandFromIntent(
      graph,
      { type: "nest-inside", collectionId: parseNodeId("F") },
      ids(["A"])
    );
    expect(result).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["A"], toParentId: "F", toIndex: 1 },
    });
  });

  test("append-to-collection excludes dragged nodes from the end index", () => {
    // root-a has 4 children, one of which (A) is being dragged -> end = 3.
    const result = resolveCommandFromIntent(
      graph,
      { type: "append-to-collection", collectionId: parseNodeId("root-a") },
      ids(["A"])
    );
    expect(result).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["A"], toParentId: "root-a", toIndex: 3 },
    });
  });

  test("insert-at-index: cross-collection uses the boundary as-is", () => {
    // root-a children: [A, B, F, C]; X comes from root-b, so no dragged
    // nodes sit before the boundary.
    const result = resolveCommandFromIntent(
      graph,
      { type: "insert-at-index", collectionId: parseNodeId("root-a"), index: 2 },
      ids(["X"])
    );
    expect(result).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["X"], toParentId: "root-a", toIndex: 2 },
    });
  });

  test("insert-at-index: visible boundary converts to post-removal index", () => {
    // Dragging A within root-a to visible boundary 2 (between B and F):
    // A sits before the boundary -> post-removal index 1.
    const result = resolveCommandFromIntent(
      graph,
      { type: "insert-at-index", collectionId: parseNodeId("root-a"), index: 2 },
      ids(["A"])
    );
    expect(result).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["A"], toParentId: "root-a", toIndex: 1 },
    });
  });

  test("insert-at-index: multi-drag subtracts every dragged node before the boundary", () => {
    // Dragging A and B to visible boundary 3 -> two dragged before -> 1.
    const result = resolveCommandFromIntent(
      graph,
      { type: "insert-at-index", collectionId: parseNodeId("root-a"), index: 3 },
      ids(["A", "B"])
    );
    expect(result).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["A", "B"], toParentId: "root-a", toIndex: 1 },
    });
  });

  test("insert-at-index: clamps an out-of-range boundary to the end", () => {
    const result = resolveCommandFromIntent(
      graph,
      { type: "insert-at-index", collectionId: parseNodeId("root-a"), index: 99 },
      ids(["A"])
    );
    expect(result).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["A"], toParentId: "root-a", toIndex: 3 },
    });
  });

  test("insert-at-index: rejects fractional and non-finite boundaries", () => {
    for (const index of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveCommandFromIntent(
          graph,
          { type: "insert-at-index", collectionId: parseNodeId("root-a"), index },
          ids(["A"])
        )
      ).toEqual({ ok: false, error: { reason: "invalid-index", index } });
    }
  });

  test("insert-at-index: destination and cycle preview match the reducer", () => {
    const intent = {
      type: "insert-at-index",
      collectionId: parseNodeId("F"),
      index: 0,
    } as const;
    // Dragging F "into itself at index 0" is a cycle — the preview must
    // flag it exactly as applyCommand would reject it.
    expect(isIntentInvalid(graph, intent, ids(["F"]))).toBe(true);
    expect(isIntentInvalid(graph, intent, ids(["A"]))).toBe(false);
  });

  test("fails cleanly when the adjacency target vanished", () => {
    const result = resolveCommandFromIntent(
      graph,
      { type: "insert-adjacent", side: "before", targetId: parseNodeId("ghost") },
      ids(["A"])
    );
    expect(result).toEqual({ ok: false, error: { reason: "missing-node", nodeId: "ghost" } });
  });
});

describe("resolvePlacementCommand", () => {
  const ids = (list: readonly string[]) => list.map(parseNodeId);
  const place = (lane: number, startSeconds: number) =>
    resolvePlacementCommand(
      { type: "place-at-time", collectionId: parseNodeId("root"), lane, startSeconds },
      ids(["A"]),
    );

  test("carries the lane and the time onto a set-node-placement", () => {
    const result = place(1, 7.5);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value).toEqual({
      type: "set-node-placement",
      nodeIds: ids(["A"]),
      placement: { trackIndex: 1, placedStart: 7.5 },
    });
  });

  test("LANE 0 CLEARS BOTH FIELDS and ignores the time", () => {
    // Dropping onto the picture means "rejoin the cut". There is no "here" to
    // place at on that row — its clips pack end to end from array order — so
    // the clip takes the slot its position gives it. One command, one undo;
    // a move as well would have cost two.
    const result = place(0, 7.5);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.placement).toEqual({ trackIndex: null, placedStart: null });
  });

  test("clamps a drag past the left edge to the very start", () => {
    const result = place(1, -3);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.placement.placedStart).toBe(0);
  });

  test("refuses a fractional or negative lane", () => {
    expect(place(1.5, 1).ok).toBe(false);
    expect(place(-1, 1).ok).toBe(false);
  });

  test("refuses a non-finite time", () => {
    expect(place(1, Number.NaN).ok).toBe(false);
    expect(place(1, Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  test("refuses an empty drag set", () => {
    const result = resolvePlacementCommand(
      { type: "place-at-time", collectionId: parseNodeId("root"), lane: 1, startSeconds: 1 },
      [],
    );
    expect(result.ok).toBe(false);
  });

  test("places a whole multi-selection in ONE command", () => {
    const result = resolvePlacementCommand(
      { type: "place-at-time", collectionId: parseNodeId("root"), lane: 2, startSeconds: 3 },
      ids(["A", "B"]),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.nodeIds).toEqual(ids(["A", "B"]));
  });
});
