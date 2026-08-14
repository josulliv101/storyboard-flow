import { describe, expect, it } from "vitest";

import type { NodeId } from "@storyboard/ui/dnd-collections";

import {
  acceptsDragTypes,
  aggregateDropStatus,
  cellFollowingPointer,
  gridDropAnchor,
  gridIndicatorGeometry,
  indexOfChildId,
  isSidebarTool,
  neighborsAt,
  resolveAnchorIndex,
  stripDropAnchor,
  stripIndicatorX,
  TOOL_MIME,
  type CardGeometry,
  type DropStatus,
  type GridCellGeometry,
} from "./graph-native-drop-model";

const ids = (...values: string[]) => values as NodeId[];

/** A card `width` wide whose left edge is at `left`. */
const card = (nodeId: string, left: number, width = 100): CardGeometry => ({
  nodeId,
  left,
  right: left + width,
  mid: left + width / 2,
});

/** A grid cell at (left, top), 100x80 by default. */
const cell = (
  nodeId: string,
  left: number,
  top: number,
  width = 100,
  height = 80,
): GridCellGeometry => ({
  nodeId,
  left,
  right: left + width,
  top,
  bottom: top + height,
  midX: left + width / 2,
});

describe("acceptsDragTypes", () => {
  it("accepts the sidebar tool mime and OS files", () => {
    expect(acceptsDragTypes([TOOL_MIME])).toBe(true);
    expect(acceptsDragTypes(["Files"])).toBe(true);
  });

  it("rejects anything else, and an absent type list", () => {
    expect(acceptsDragTypes(["text/plain"])).toBe(false);
    expect(acceptsDragTypes([])).toBe(false);
    expect(acceptsDragTypes(undefined)).toBe(false);
  });
});

describe("isSidebarTool", () => {
  it("admits collection only", () => {
    expect(isSidebarTool("collection")).toBe(true);
    expect(isSidebarTool("image")).toBe(false);
    expect(isSidebarTool("")).toBe(false);
  });
});

describe("indexOfChildId / neighborsAt", () => {
  it("finds an id by value", () => {
    expect(indexOfChildId(ids("a", "b", "c"), "b")).toBe(1);
    expect(indexOfChildId(ids("a"), "zz")).toBe(-1);
  });

  it("brackets an interior gap with both neighbours", () => {
    expect(neighborsAt(ids("a", "b", "c"), 1)).toEqual({ beforeId: "a", afterId: "b" });
  });

  it("has no predecessor at the head and no successor at the tail", () => {
    expect(neighborsAt(ids("a", "b"), 0)).toEqual({ beforeId: null, afterId: "a" });
    expect(neighborsAt(ids("a", "b"), 2)).toEqual({ beforeId: "b", afterId: null });
  });

  it("has neither in an empty list", () => {
    expect(neighborsAt(ids(), 0)).toEqual({ beforeId: null, afterId: null });
  });
});

describe("aggregateDropStatus", () => {
  const map = (...entries: DropStatus[]) =>
    new Map(entries.map((entry, index) => [index, entry] as const));

  it("is null with nothing live", () => {
    expect(aggregateDropStatus(new Map())).toBeNull();
  });

  it("sums counts across concurrent drops", () => {
    const summary = aggregateDropStatus(
      map({ status: "uploading", count: 2 }, { status: "uploading", count: 1 }),
    );
    expect(summary).toEqual({ tone: "progress", message: "Uploading 3 files…" });
  });

  it("says file, singular, at one", () => {
    expect(aggregateDropStatus(map({ status: "uploading", count: 1 }))?.message).toBe(
      "Uploading 1 file…",
    );
  });

  it("shows progress and failures TOGETHER rather than one winning", () => {
    const summary = aggregateDropStatus(
      map({ status: "uploading", count: 2 }, { status: "error", message: "nope", at: 0 }),
    );
    expect(summary).toEqual({ tone: "error", message: "Uploading 2 files… · nope" });
  });

  it("de-duplicates identical failure messages", () => {
    const summary = aggregateDropStatus(
      map(
        { status: "error", message: "same", at: 0 },
        { status: "error", message: "same", at: 1 },
        { status: "error", message: "other", at: 2 },
      ),
    );
    expect(summary).toEqual({ tone: "error", message: "same · other" });
  });
});

describe("stripDropAnchor", () => {
  const cards = [card("a", 0), card("b", 100), card("c", 200)];
  const order = ids("a", "b", "c");

  it("appends when the drag never measured", () => {
    expect(stripDropAnchor({ order, cards: null, clientX: 10 })).toEqual({
      index: 3,
      beforeId: "c",
      afterId: null,
    });
  });

  it("lands before the first card whose midpoint the pointer has not passed", () => {
    expect(stripDropAnchor({ order, cards, clientX: 10 }).index).toBe(0);
    expect(stripDropAnchor({ order, cards, clientX: 120 }).index).toBe(1);
    expect(stripDropAnchor({ order, cards, clientX: 220 }).index).toBe(2);
  });

  it("appends past the last midpoint", () => {
    expect(stripDropAnchor({ order, cards, clientX: 290 })).toEqual({
      index: 3,
      beforeId: "c",
      afterId: null,
    });
  });

  it("records the neighbours of the gap it chose", () => {
    expect(stripDropAnchor({ order, cards, clientX: 120 })).toEqual({
      index: 1,
      beforeId: "a",
      afterId: "b",
    });
  });

  // The PL12-005 bug: in a flat run most mounted cards are not this
  // collection's children. Resolving against the SHOWN order is the fix.
  it("resolves against the shown order, so a flat run does not skip cards", () => {
    const flat = ids("a", "nested-1", "nested-2", "c");
    const flatCards = [card("a", 0), card("nested-1", 100), card("nested-2", 200), card("c", 300)];
    // Pointer just past nested-1's midpoint: the gap is before nested-2.
    expect(stripDropAnchor({ order: flat, cards: flatCards, clientX: 220 })).toEqual({
      index: 2,
      beforeId: "nested-1",
      afterId: "nested-2",
    });
  });

  it("ignores a mounted card that is absent from the order", () => {
    // `ghost` is mounted but not in the order — the scan must pass over it
    // rather than resolve to -1.
    const withGhost = [card("ghost", 0), card("b", 100), card("c", 200)];
    expect(stripDropAnchor({ order: ids("b", "c"), cards: withGhost, clientX: 10 }).index).toBe(0);
  });
});

describe("stripIndicatorX", () => {
  const cards = [card("a", 100), card("b", 200)];

  it("follows the pointer when there are no cards", () => {
    expect(stripIndicatorX({ cards: [], wrapperLeft: 50, clientX: 120 })).toBe(70);
  });

  it("snaps just before the card the drop would precede", () => {
    // Before a's midpoint (150) → a.left - wrapperLeft - 3.
    expect(stripIndicatorX({ cards, wrapperLeft: 50, clientX: 120 })).toBe(47);
  });

  it("snaps just after the last card once the pointer is past every midpoint", () => {
    // b.right (300) - wrapperLeft (50) + 3.
    expect(stripIndicatorX({ cards, wrapperLeft: 50, clientX: 400 })).toBe(253);
  });
});

describe("cellFollowingPointer", () => {
  // Two rows of two: (0,0) (100,0) / (0,80) (100,80).
  const cells = [cell("a", 0, 0), cell("b", 100, 0), cell("c", 0, 80), cell("d", 100, 80)];

  it("picks the cell to the pointer's right on the same row", () => {
    expect(cellFollowingPointer(cells, 10, 40)?.nodeId).toBe("a");
    expect(cellFollowingPointer(cells, 110, 40)?.nodeId).toBe("b");
  });

  it("picks the first cell of a row below the pointer", () => {
    // Past every midpoint on row one, but above row two.
    expect(cellFollowingPointer(cells, 190, 40)?.nodeId).toBe("c");
  });

  it("appends when nothing follows the pointer in reading order", () => {
    expect(cellFollowingPointer(cells, 190, 120)).toBeNull();
  });

  it("appends over an empty grid", () => {
    expect(cellFollowingPointer([], 10, 10)).toBeNull();
  });
});

describe("gridDropAnchor", () => {
  const cells = [cell("a", 0, 0), cell("b", 100, 0)];
  const children = ids("a", "b");

  it("appends when the drag never measured", () => {
    expect(gridDropAnchor({ children, cells: null, clientX: 0, clientY: 0 }).index).toBe(2);
  });

  it("takes its index from the graph, matched to the mounted cell by id", () => {
    expect(gridDropAnchor({ children, cells, clientX: 10, clientY: 40 })).toEqual({
      index: 0,
      beforeId: null,
      afterId: "a",
    });
  });

  it("appends when the pointer follows every cell", () => {
    expect(gridDropAnchor({ children, cells, clientX: 190, clientY: 40 }).index).toBe(2);
  });

  it("appends rather than guessing when the mounted cell is not a child", () => {
    expect(
      gridDropAnchor({ children: ids("x"), cells, clientX: 10, clientY: 40 }).index,
    ).toBe(1);
  });
});

describe("gridIndicatorGeometry", () => {
  const base = { gap: 10, wrapperLeft: 0, wrapperTop: 0 };
  // Row one: a(0,0) b(110,0). Row two: c(0,90).
  const cells = [cell("a", 0, 0), cell("b", 110, 0), cell("c", 0, 90)];

  it("is null with no cells", () => {
    expect(
      gridIndicatorGeometry({ ...base, cells: [], clientX: 0, clientY: 0 }),
    ).toBeNull();
  });

  it("draws past the last cell when appending", () => {
    // No cell follows the pointer → last.right (110... c) + halfGap - 1.
    expect(gridIndicatorGeometry({ ...base, cells, clientX: 190, clientY: 120 })).toEqual({
      x: 104,
      y: 90,
      height: 80,
    });
  });

  it("splits the gap between two cells on one row", () => {
    // before = b, previous = a, same row → (a.right 100 + b.left 110)/2 - 1.
    expect(gridIndicatorGeometry({ ...base, cells, clientX: 130, clientY: 40 })).toEqual({
      x: 104,
      y: 0,
      height: 80,
    });
  });

  it("draws before the first cell of the grid", () => {
    // before = a, no previous → a.left - halfGap - 1.
    expect(gridIndicatorGeometry({ ...base, cells, clientX: 10, clientY: 40 })).toEqual({
      x: -6,
      y: 0,
      height: 80,
    });
  });

  it("anchors at the PREVIOUS row's end when the pointer is still on that row", () => {
    // before = c (row two), previous = b (row one), pointer still within row
    // one → draw after b (right edge 210) plus half the gap, rather than
    // before c on the row below.
    expect(gridIndicatorGeometry({ ...base, cells, clientX: 250, clientY: 40 })).toEqual({
      x: 214,
      y: 0,
      height: 80,
    });
  });

  it("draws at the new row's start once the pointer has left the previous row", () => {
    // Same boundary (before = c) but the pointer is on row two.
    expect(gridIndicatorGeometry({ ...base, cells, clientX: 0, clientY: 100 })).toEqual({
      x: -6,
      y: 90,
      height: 80,
    });
  });

  it("subtracts the wrapper origin", () => {
    const shifted = gridIndicatorGeometry({
      cells,
      gap: 10,
      wrapperLeft: 40,
      wrapperTop: 20,
      clientX: 10,
      clientY: 40,
    });
    expect(shifted).toEqual({ x: -46, y: -20, height: 80 });
  });
});

describe("resolveAnchorIndex", () => {
  it("prefers the successor, which survives the predecessor being removed", () => {
    // "b" was dropped before; "a" has since gone.
    expect(resolveAnchorIndex(ids("x", "b", "c"), { beforeId: "a", afterId: "b", index: 1 })).toBe(
      1,
    );
  });

  it("falls back to the predecessor when the successor is gone", () => {
    expect(resolveAnchorIndex(ids("a", "c"), { beforeId: "a", afterId: "gone", index: 1 })).toBe(1);
  });

  it("falls back to the captured index when both neighbours are gone", () => {
    expect(
      resolveAnchorIndex(ids("x", "y", "z"), { beforeId: "a", afterId: "b", index: 2 }),
    ).toBe(2);
  });

  it("clamps a stale index to the list as it stands now", () => {
    expect(resolveAnchorIndex(ids("x"), { beforeId: null, afterId: null, index: 9 })).toBe(1);
    expect(resolveAnchorIndex(ids(), { beforeId: null, afterId: null, index: 4 })).toBe(0);
  });

  it("tracks the gap as the list is reordered around it", () => {
    // Dropped between a and b; the strip is then reordered to b, a.
    const anchor = { beforeId: "a", afterId: "b", index: 1 };
    expect(resolveAnchorIndex(ids("b", "a"), anchor)).toBe(0);
  });
});
