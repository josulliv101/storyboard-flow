import { describe, expect, test } from "vitest";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "./graph";
import {
  decodeDropTarget,
  encodeDropTarget,
  isIntentInvalid,
  resolveCommandFromIntent,
  resolveDropIntent,
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

  test("fails cleanly when the adjacency target vanished", () => {
    const result = resolveCommandFromIntent(
      graph,
      { type: "insert-adjacent", side: "before", targetId: parseNodeId("ghost") },
      ids(["A"])
    );
    expect(result).toEqual({ ok: false, error: { reason: "missing-node", nodeId: "ghost" } });
  });
});
