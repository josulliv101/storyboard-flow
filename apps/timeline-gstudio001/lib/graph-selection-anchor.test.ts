import { describe, expect, it } from "vitest";

import { buildGraph, parseNodeId, type CollectionsGraph, type NodeId } from "@storyboard/ui/dnd-collections";

import { resolveAnchorId, type SelectionAnchorMemo } from "./graph-selection-anchor";

/**
 * project ─ alpha, bravo, charlie, delta, scene-a[ c1, c2 ]
 *
 * Grid order for the top level is exactly that array. `scene-a`'s children are
 * a second parent, which the removal fallback must not reach across.
 */
function fixture(): CollectionsGraph {
  const built = buildGraph([
    {
      kind: "collection",
      id: "project",
      name: "Project",
      children: [
        { kind: "media", id: "alpha", name: "alpha" },
        { kind: "media", id: "bravo", name: "bravo" },
        { kind: "media", id: "charlie", name: "charlie" },
        { kind: "media", id: "delta", name: "delta" },
        {
          kind: "collection",
          id: "scene-a",
          name: "Scene A",
          children: [
            { kind: "media", id: "c1", name: "c1" },
            { kind: "media", id: "c2", name: "c2" },
          ],
        },
      ],
    },
  ]);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
}

const id = (value: string): NodeId => parseNodeId(value);
const sel = (...values: string[]): ReadonlySet<NodeId> => new Set(values.map(id));

function memo(anchor: string | null, selected: ReadonlySet<NodeId>): SelectionAnchorMemo {
  return { anchorId: anchor === null ? null : id(anchor), selectedIds: selected };
}

describe("resolveAnchorId", () => {
  const graph = fixture();

  it("is null for an empty selection", () => {
    expect(resolveAnchorId(graph, sel(), null)).toBeNull();
  });

  it("is the only selected card for a plain click", () => {
    expect(resolveAnchorId(graph, sel("bravo"), null)).toBe(id("bravo"));
  });

  it("follows the most recently added card, not grid order", () => {
    // Ctrl+click charlie, then ctrl+click alpha: the anchor is alpha, the card
    // just touched, even though charlie is later in the grid. This is the case
    // a pure grid-order rule gets wrong, and it would park the toolbar on a
    // card the user did not click.
    const selection = sel("charlie", "alpha");

    expect(resolveAnchorId(graph, selection, memo("charlie", sel("charlie")))).toBe(id("alpha"));
  });

  it("holds still when the selection has not changed", () => {
    // The same Set instance means nothing moved. Re-deriving from insertion
    // order here would be harmless, but the memo is what lets the fallback
    // below survive to the next render.
    const selection = sel("alpha", "charlie");

    expect(resolveAnchorId(graph, selection, memo("alpha", selection))).toBe(id("alpha"));
  });

  it("moves to the last remaining card in GRID order when the anchor is deselected", () => {
    // Selected alpha, delta, bravo in that click order, anchor bravo. Ctrl+click
    // bravo off: insertion order would answer "delta" (picked second); grid
    // order answers "delta" too here only because it is last on screen — so
    // pick a case where they differ, below.
    const before = sel("alpha", "delta", "bravo");
    const after = sel("alpha", "delta");

    expect(resolveAnchorId(graph, after, memo("bravo", before))).toBe(id("delta"));
  });

  it("prefers grid order over click order for that fallback", () => {
    // Clicked delta first, then alpha, then charlie (the anchor). Removing
    // charlie leaves {delta, alpha}: insertion order says alpha, grid order
    // says delta — and grid order is the one the user can see.
    const before = sel("delta", "alpha", "charlie");
    const after = sel("delta", "alpha");

    expect(resolveAnchorId(graph, after, memo("charlie", before))).toBe(id("delta"));
  });

  it("does not reach across parents for the fallback", () => {
    // The removed anchor's siblings are all deselected; what remains is inside
    // scene-a. "The next one along" is meaningless across two timelines, so it
    // falls back to the most recent pick rather than inventing an order.
    const before = sel("c1", "alpha");
    const after = sel("c1");

    expect(resolveAnchorId(graph, after, memo("alpha", before))).toBe(id("c1"));
  });

  it("is null once the last card is deselected", () => {
    expect(resolveAnchorId(graph, sel(), memo("alpha", sel("alpha")))).toBeNull();
  });

  it("recovers when the memo's anchor was already gone", () => {
    // A deleted anchor is pruned from the selection by the store, so the memo
    // can arrive describing a card that no longer exists anywhere. That must
    // resolve, not throw.
    const stale = memo("ghost", sel("ghost", "alpha"));

    expect(resolveAnchorId(graph, sel("alpha", "bravo"), stale)).toBe(id("bravo"));
  });
});
