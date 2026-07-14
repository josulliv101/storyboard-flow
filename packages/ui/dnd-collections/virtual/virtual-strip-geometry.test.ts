import { describe, expect, it } from "vitest";

import {
  MIN_ITEM_WIDTH,
  indicatorLeftOffset,
  leftAnchorShift,
  resolveBoundaryIndex,
  slotSizeFor,
} from "./virtual-strip-geometry";

const item = (start: number, size: number, index: number) => ({ start, size, index });

describe("resolveBoundaryIndex", () => {
  it("clamps at or before the first item to 0", () => {
    expect(resolveBoundaryIndex(0, 500, 10, item(0, 50, 0))).toBe(0);
    expect(resolveBoundaryIndex(-5, 500, 10, item(0, 50, 0))).toBe(0);
  });

  it("clamps at or past the total size to the count", () => {
    expect(resolveBoundaryIndex(500, 500, 10, item(450, 50, 9))).toBe(10);
    expect(resolveBoundaryIndex(999, 500, 10, null)).toBe(10);
  });

  it("returns the count when no measured item is under the pointer", () => {
    expect(resolveBoundaryIndex(200, 500, 10, null)).toBe(10);
  });

  it("rounds to the item in its left half, index+1 in its right half", () => {
    // item 3 spans [120, 160); midpoint 140.
    expect(resolveBoundaryIndex(125, 500, 10, item(120, 40, 3))).toBe(3);
    expect(resolveBoundaryIndex(139.9, 500, 10, item(120, 40, 3))).toBe(3);
    // Exactly the midpoint rounds to the following boundary.
    expect(resolveBoundaryIndex(140, 500, 10, item(120, 40, 3))).toBe(4);
    expect(resolveBoundaryIndex(155, 500, 10, item(120, 40, 3))).toBe(4);
  });
});

describe("indicatorLeftOffset", () => {
  it("insets half a gap plus the indicator half-width", () => {
    expect(indicatorLeftOffset(120, 8)).toBe(114); // 120 - 4 - 2
  });

  it("never goes negative", () => {
    expect(indicatorLeftOffset(0, 8)).toBe(0);
    expect(indicatorLeftOffset(3, 8)).toBe(0);
  });

  it("handles a zero gap", () => {
    expect(indicatorLeftOffset(50, 0)).toBe(48);
  });
});

describe("slotSizeFor", () => {
  it("is seconds*pps plus the trailing gap", () => {
    expect(slotSizeFor(5, 24, 8)).toBe(128);
  });

  it("floors a fully trimmed clip at the clickable minimum, like the committed layout", () => {
    // The last live preview must equal the post-commit re-measure (which
    // floors at MIN_ITEM_WIDTH) or the card snaps on release.
    expect(slotSizeFor(0, 24, 8)).toBe(MIN_ITEM_WIDTH + 8);
    expect(slotSizeFor(0.2, 24, 8)).toBe(MIN_ITEM_WIDTH + 8); // 4.8px derived -> floored
  });

  it("leaves widths at or above the floor untouched", () => {
    expect(slotSizeFor(0.5, 24, 8)).toBe(20); // exactly MIN_ITEM_WIDTH
  });
});

describe("leftAnchorShift", () => {
  it("negates rightward growth so the right edge stays pinned", () => {
    expect(leftAnchorShift(140, 100)).toBe(-40); // grew 40px -> shift left 40
  });

  it("yields a positive shift when the slot shrank, and 0 for no change", () => {
    expect(leftAnchorShift(80, 100)).toBe(20);
    expect(leftAnchorShift(100, 100)).toBe(0);
  });
});
