import { describe, expect, test } from "vitest";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "./graph";
import { resolveGridRowMoveCommand, resolveKeyboardCommand } from "./keyboard";

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

/** root: [A, F(f1), B, G(), C] — two sibling collections around media. */
const graph = build([
  collection("root", [
    media("A"),
    collection("F", [media("f1")]),
    media("B"),
    collection("G", []),
    media("C"),
  ]),
]);

const id = parseNodeId;

describe("resolveKeyboardCommand", () => {
  test("move-prev swaps with the previous sibling", () => {
    expect(resolveKeyboardCommand(graph, id("B"), "move-prev")).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["B"], toParentId: "root", toIndex: 1 },
    });
  });

  test("move-prev at the start is a boundary rejection", () => {
    expect(resolveKeyboardCommand(graph, id("A"), "move-prev")).toEqual({
      ok: false,
      error: { reason: "no-previous-sibling" },
    });
  });

  test("move-next swaps with the next sibling", () => {
    expect(resolveKeyboardCommand(graph, id("B"), "move-next")).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["B"], toParentId: "root", toIndex: 3 },
    });
  });

  test("move-next at the end is a boundary rejection", () => {
    expect(resolveKeyboardCommand(graph, id("C"), "move-next")).toEqual({
      ok: false,
      error: { reason: "no-next-sibling" },
    });
  });

  test("move-home / move-end jump to the edges", () => {
    expect(resolveKeyboardCommand(graph, id("B"), "move-home")).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["B"], toParentId: "root", toIndex: 0 },
    });
    expect(resolveKeyboardCommand(graph, id("B"), "move-end")).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["B"], toParentId: "root", toIndex: 4 },
    });
  });

  test("nest-in-neighbor prefers the NEXT sibling collection", () => {
    // B sits between F (before) and G (after) — G wins.
    expect(resolveKeyboardCommand(graph, id("B"), "nest-in-neighbor")).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["B"], toParentId: "G", toIndex: 0 },
    });
  });

  test("nest-in-neighbor falls back to the previous sibling collection", () => {
    // C has no collection after it; F/G are before — nearest previous is G.
    expect(resolveKeyboardCommand(graph, id("C"), "nest-in-neighbor")).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["C"], toParentId: "G", toIndex: 0 },
    });
  });

  test("nest-in-neighbor with no sibling collection rejects", () => {
    const flat = build([collection("solo", [media("x"), media("y")])]);
    expect(resolveKeyboardCommand(flat, id("x"), "nest-in-neighbor")).toEqual({
      ok: false,
      error: { reason: "no-neighbor-collection" },
    });
  });

  test("move-out lands right after the parent's own card", () => {
    // f1 lives in F; F sits at index 1 of root — f1 moves out to root index 2.
    expect(resolveKeyboardCommand(graph, id("f1"), "move-out")).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["f1"], toParentId: "root", toIndex: 2 },
    });
  });

  test("move-out from a root panel's direct child rejects (nowhere to go)", () => {
    expect(resolveKeyboardCommand(graph, id("A"), "move-out")).toEqual({
      ok: false,
      error: { reason: "no-parent-to-move-out-to" },
    });
  });

  test("roots and unknown nodes reject", () => {
    expect(resolveKeyboardCommand(graph, id("root"), "move-next")).toEqual({
      ok: false,
      error: { reason: "cannot-move-root", nodeId: "root" },
    });
    expect(resolveKeyboardCommand(graph, id("ghost"), "move-next")).toEqual({
      ok: false,
      error: { reason: "missing-node", nodeId: "ghost" },
    });
  });
});

describe("resolveGridRowMoveCommand", () => {
  // grid: [g0..g9] in a 4-column grid -> rows [g0-g3], [g4-g7], [g8, g9].
  const gridGraph = build([
    collection(
      "grid",
      Array.from({ length: 10 }, (_, i) => media(`g${i}`))
    ),
  ]);

  test("down lands one row later in the same column", () => {
    // g1 (row 0, col 1) -> visible boundary 6 -> post-removal index 5 (row 1, col 1).
    expect(resolveGridRowMoveCommand(gridGraph, id("g1"), "down", 4)).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["g1"], toParentId: "grid", toIndex: 5 },
    });
  });

  test("up lands one row earlier in the same column", () => {
    expect(resolveGridRowMoveCommand(gridGraph, id("g5"), "up", 4)).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["g5"], toParentId: "grid", toIndex: 1 },
    });
  });

  test("down into a shorter last row clamps to the end", () => {
    // g6 (row 1, col 2): row 2 has only [g8, g9] -> boundary clamps to 10 -> index 9.
    expect(resolveGridRowMoveCommand(gridGraph, id("g6"), "down", 4)).toEqual({
      ok: true,
      value: { type: "move-nodes", nodeIds: ["g6"], toParentId: "grid", toIndex: 9 },
    });
  });

  test("boundary rejections: first row up, last row down", () => {
    expect(resolveGridRowMoveCommand(gridGraph, id("g2"), "up", 4)).toEqual({
      ok: false,
      error: { reason: "already-first-row" },
    });
    expect(resolveGridRowMoveCommand(gridGraph, id("g9"), "down", 4)).toEqual({
      ok: false,
      error: { reason: "already-last-row" },
    });
  });

  test("rejects non-finite, zero, and fractional column counts", () => {
    for (const columns of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveGridRowMoveCommand(gridGraph, id("g5"), "down", columns)).toEqual({
        ok: false,
        error: { reason: "invalid-columns" },
      });
    }
  });

  test("rejects roots and unknown nodes", () => {
    expect(resolveGridRowMoveCommand(gridGraph, id("grid"), "down", 4)).toEqual({
      ok: false,
      error: { reason: "cannot-move-root", nodeId: "grid" },
    });
    expect(resolveGridRowMoveCommand(gridGraph, id("ghost"), "down", 4)).toEqual({
      ok: false,
      error: { reason: "missing-node", nodeId: "ghost" },
    });
  });
});
