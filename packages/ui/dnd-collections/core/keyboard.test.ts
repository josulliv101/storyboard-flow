import { describe, expect, test } from "vitest";
import {
  buildGraph,
  getChildren,
  parseNodeId,
  type CollectionsGraph,
  type GraphNodeSpec,
} from "./graph";
import { applyCommand } from "./commands";
import {
  resolveGridRowMoveCommand,
  resolveKeyboardCommand,
  resolveTrashCommand,
  resolveTrimCommand,
} from "./keyboard";

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

describe("resolveTrimCommand", () => {
  // root: [img (4s image), vid (10s source, trimmed 2s in / 1s out -> 7s)]
  const trimGraph = build([
    collection("root", [
      { kind: "media", id: "img", name: "img", durationSeconds: 4 },
      {
        kind: "media",
        mediaKind: "video",
        id: "vid",
        name: "vid",
        fullDurationSeconds: 10,
        trimInSeconds: 2,
        trimOutSeconds: 1,
      },
    ]),
  ]);

  test("image end edge steps the duration up/down", () => {
    expect(resolveTrimCommand(trimGraph, id("img"), "trim-end-extend", 1)).toEqual({
      ok: true,
      value: { type: "update-media", nodeId: "img", update: { mediaKind: "image", durationSeconds: 5 } },
    });
    expect(resolveTrimCommand(trimGraph, id("img"), "trim-end-reduce", 1)).toEqual({
      ok: true,
      value: { type: "update-media", nodeId: "img", update: { mediaKind: "image", durationSeconds: 3 } },
    });
  });

  test("image has no start edge", () => {
    expect(resolveTrimCommand(trimGraph, id("img"), "trim-start-extend", 1)).toEqual({
      ok: false,
      error: { reason: "no-start-edge", nodeId: "img" },
    });
    expect(resolveTrimCommand(trimGraph, id("img"), "trim-start-reduce", 1)).toEqual({
      ok: false,
      error: { reason: "no-start-edge", nodeId: "img" },
    });
  });

  test("video end edge steps trim-out (extend = less trimmed)", () => {
    expect(resolveTrimCommand(trimGraph, id("vid"), "trim-end-extend", 1)).toEqual({
      ok: true,
      value: { type: "update-media", nodeId: "vid", update: { mediaKind: "video", trimOutSeconds: 0 } },
    });
    expect(resolveTrimCommand(trimGraph, id("vid"), "trim-end-reduce", 1)).toEqual({
      ok: true,
      value: { type: "update-media", nodeId: "vid", update: { mediaKind: "video", trimOutSeconds: 2 } },
    });
  });

  test("video start edge steps trim-in (reduce = more trimmed)", () => {
    expect(resolveTrimCommand(trimGraph, id("vid"), "trim-start-reduce", 1)).toEqual({
      ok: true,
      value: { type: "update-media", nodeId: "vid", update: { mediaKind: "video", trimInSeconds: 3 } },
    });
    expect(resolveTrimCommand(trimGraph, id("vid"), "trim-start-extend", 1)).toEqual({
      ok: true,
      value: { type: "update-media", nodeId: "vid", update: { mediaKind: "video", trimInSeconds: 1 } },
    });
  });

  test("rejects collections and unknown nodes", () => {
    expect(resolveTrimCommand(trimGraph, id("root"), "trim-end-extend", 1)).toEqual({
      ok: false,
      error: { reason: "not-media-node", nodeId: "root" },
    });
    expect(resolveTrimCommand(trimGraph, id("ghost"), "trim-end-extend", 1)).toEqual({
      ok: false,
      error: { reason: "missing-node", nodeId: "ghost" },
    });
  });

  test("rejects non-positive and non-finite trim steps", () => {
    for (const stepSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveTrimCommand(trimGraph, id("img"), "trim-end-extend", stepSeconds)).toEqual({
        ok: false,
        error: { reason: "invalid-step", stepSeconds },
      });
    }
  });

  test("the resolver steps the RAW value; the reducer owns the clamp", () => {
    // vid trim-out is 1s -> extend by 2s overshoots to -1s (raw), which the
    // reducer clamps to 0 (a full-length, untrimmed end).
    const resolved = resolveTrimCommand(trimGraph, id("vid"), "trim-end-extend", 2);
    expect(resolved).toEqual({
      ok: true,
      value: { type: "update-media", nodeId: "vid", update: { mediaKind: "video", trimOutSeconds: -1 } },
    });
    const applied = applyCommand(trimGraph, resolved.ok ? resolved.value : { type: "update-media", nodeId: id("vid"), update: { mediaKind: "video" } });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      const vid = applied.value.graph.nodesById.get(id("vid"));
      expect(vid).toMatchObject({ mediaKind: "video", trimOutSeconds: 0 });
    }
  });

  test("a boundary step the reducer clamps to no change is a same-position no-op", () => {
    // vid trim-out already 1s; extend by 1 -> 0. Extend AGAIN from a 0-out
    // graph would clamp back to 0 -> the reducer rejects same-position.
    const extended = applyCommand(trimGraph, {
      type: "update-media",
      nodeId: id("vid"),
      update: { mediaKind: "video", trimOutSeconds: 0 },
    });
    expect(extended.ok).toBe(true);
    if (!extended.ok) return;
    const resolved = resolveTrimCommand(extended.value.graph, id("vid"), "trim-end-extend", 1);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(applyCommand(extended.value.graph, resolved.value)).toEqual({
      ok: false,
      error: { reason: "same-position" },
    });
  });
});

describe("resolveTrashCommand", () => {
  // root: [A, B, Trash(t1)] — a designated trash collection holding one item.
  const trashGraph = build([
    collection("root", [media("A"), media("B"), collection("Trash", [media("t1")])]),
  ]);

  test("appends the node to the end of the trash collection", () => {
    expect(resolveTrashCommand(trashGraph, id("A"), id("Trash"))).toEqual({
      ok: true,
      // Trash already holds one item (t1), so the node lands at index 1.
      value: { type: "move-nodes", nodeIds: ["A"], toParentId: "Trash", toIndex: 1 },
    });
  });

  test("the resolved command applies and is undoable", () => {
    const resolved = resolveTrashCommand(trashGraph, id("A"), id("Trash"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const applied = applyCommand(trashGraph, resolved.value);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(getChildren(applied.value.graph, id("Trash"))).toEqual(["t1", "A"]);
    expect(getChildren(applied.value.graph, id("root"))).toEqual(["B", "Trash"]);
  });

  test("rejects a node already directly inside trash (no-op)", () => {
    expect(resolveTrashCommand(trashGraph, id("t1"), id("Trash"))).toEqual({
      ok: false,
      error: { reason: "already-in-trash", nodeId: "t1" },
    });
  });

  test("rejects roots and unknown nodes", () => {
    expect(resolveTrashCommand(trashGraph, id("root"), id("Trash"))).toEqual({
      ok: false,
      error: { reason: "cannot-move-root", nodeId: "root" },
    });
    expect(resolveTrashCommand(trashGraph, id("ghost"), id("Trash"))).toEqual({
      ok: false,
      error: { reason: "missing-node", nodeId: "ghost" },
    });
  });

  test("rejects a trash id that is absent or not a collection", () => {
    expect(resolveTrashCommand(trashGraph, id("A"), id("B"))).toEqual({
      ok: false,
      error: { reason: "no-trash-collection", trashId: "B" },
    });
    expect(resolveTrashCommand(trashGraph, id("A"), id("ghost"))).toEqual({
      ok: false,
      error: { reason: "no-trash-collection", trashId: "ghost" },
    });
  });

  test("resolves a command the reducer then rejects as a cycle", () => {
    // Trashing a collection INTO one of its own descendants is a cycle. The
    // resolver stays structural and produces the command; the reducer guards.
    const nested = build([
      collection("root", [collection("Outer", [collection("Inner", [])])]),
    ]);
    const resolved = resolveTrashCommand(nested, id("Outer"), id("Inner"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const applied = applyCommand(nested, resolved.value);
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.error.reason).toBe("would-create-cycle");
  });
});
