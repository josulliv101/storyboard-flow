import { describe, expect, test } from "vitest";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "./graph";
import { resolveKeyboardCommand } from "./keyboard";

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
