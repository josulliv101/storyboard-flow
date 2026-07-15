import { describe, expect, it } from "vitest";

import { buildGraph, parseNodeId, type CollectionsGraph } from "../core/graph";
import {
  MIN_ITEM_WIDTH,
  durationToWidth,
  indicatorLeftOffset,
  leftAnchorShift,
  resolveBoundaryIndex,
  slotSizeFor,
  timeToOffset,
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

describe("durationToWidth", () => {
  it("is seconds*pps, floored at the clickable minimum", () => {
    expect(durationToWidth(5, 24)).toBe(120);
    expect(durationToWidth(0, 24)).toBe(MIN_ITEM_WIDTH);
    expect(durationToWidth(0.2, 24)).toBe(MIN_ITEM_WIDTH); // 4.8px derived
  });

  it("honors an explicit minimum and rejects non-finite math", () => {
    expect(durationToWidth(0, 24, 40)).toBe(40);
    expect(durationToWidth(Number.NaN, 24)).toBe(MIN_ITEM_WIDTH);
    expect(durationToWidth(5, Number.POSITIVE_INFINITY)).toBe(MIN_ITEM_WIDTH);
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

describe("timeToOffset", () => {
  // [img 4s][folder (no time)][vid 10-2-1=7s][tiny 0.2s (floored)]
  function fixture(): CollectionsGraph {
    const result = buildGraph([
      {
        kind: "collection",
        id: "strip",
        name: "Strip",
        children: [
          { kind: "media", id: "img", name: "Img", durationSeconds: 4 },
          { kind: "collection", id: "folder", name: "Folder", children: [] },
          {
            kind: "media",
            mediaKind: "video",
            id: "vid",
            name: "Vid",
            fullDurationSeconds: 10,
            trimInSeconds: 2,
            trimOutSeconds: 1,
          },
          { kind: "media", id: "tiny", name: "Tiny", durationSeconds: 0.2 },
        ],
      },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  }
  const strip = parseNodeId("strip");
  const at = (t: number) =>
    timeToOffset({ graph: fixture(), collectionId: strip, timeSeconds: t, pixelsPerSecond: 24 });
  // Layout at pps 24, gap 8, itemWidth 128:
  // img [0, 96) · folder [104, 232) · vid [240, 408) · tiny [416, 428) (floored)

  it("maps times inside a clip linearly from its content start", () => {
    expect(at(0)).toBe(0);
    expect(at(2)).toBe(48);
  });

  it("skips non-media widths without advancing the clock", () => {
    // t=4 is the start of the SECOND media item, after the folder's slot.
    expect(at(4)).toBe(240);
    expect(at(4 + 3.5)).toBe(240 + 84);
  });

  it("caps inside a floored clip at its right edge and clamps at the ends", () => {
    // tiny starts at t=11; its 0.2s spans 4.8px of its 12px slot.
    expect(at(11.1)).toBeCloseTo(416 + 2.4, 5);
    expect(at(-1)).toBe(0);
    // Past the total duration: the last media item's right edge.
    expect(at(999)).toBe(428);
  });

  it("returns 0 for an unknown or empty collection", () => {
    expect(
      timeToOffset({
        graph: fixture(),
        collectionId: parseNodeId("nope"),
        timeSeconds: 5,
        pixelsPerSecond: 24,
      })
    ).toBe(0);
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
