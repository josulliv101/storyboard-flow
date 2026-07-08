import { describe, expect, test } from "vitest";
import { asCollectionId, type TimelineItem } from "./media-strip.types";
import { createImageTimelineItem } from "./media-strip.validation";
import {
  getTimelineItemEndTimeSeconds,
  getVideoVisibleDurationSeconds,
  getItemWidth,
  formatDuration,
  areEqual,
  isPointInNestHotspot,
  isPointWithinRect,
  MIN_ITEM_WIDTH_PX,
  DRAG_ACTIVATION_THRESHOLDS_PX,
  NEST_HOTSPOT_MIN_OFFSET,
  NEST_HOTSPOT_MAX_OFFSET,
} from "./media-strip.utils";

function makeImageItem(id: string, name: string): TimelineItem {
  const result = createImageTimelineItem({
    id,
    name,
    src: "img.png",
    startTimeSeconds: 0,
    durationSeconds: 10,
  });
  if (!result.ok) {
    throw new Error(`Test fixture failed to construct: ${result.error.reason}`);
  }
  return result.value;
}

describe("Timeline Items Derived Helpers", () => {
  test("calculates end time correctly", () => {
    const item = makeImageItem("item-1", "Item");
    expect(getTimelineItemEndTimeSeconds({ ...item, startTimeSeconds: 5.5, durationSeconds: 10.2 })).toBeCloseTo(15.7);
  });

  test("calculates video visible duration correctly", () => {
    const videoData = {
      sourceDurationSeconds: 120.5,
      trimInSeconds: 10.2,
      trimOutSeconds: 15.3,
    };
    expect(getVideoVisibleDurationSeconds(videoData)).toBeCloseTo(95.0);
  });
});

describe("MediaStrip formatDuration helper", () => {
  test("formats short durations under a minute", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(5)).toBe("00:05");
    expect(formatDuration(59.9)).toBe("00:59");
  });

  test("formats durations under an hour", () => {
    expect(formatDuration(60)).toBe("01:00");
    expect(formatDuration(75)).toBe("01:15");
    expect(formatDuration(3599)).toBe("59:59");
  });

  test("formats durations greater than or equal to an hour", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3665)).toBe("1:01:05");
    expect(formatDuration(7200)).toBe("2:00:00");
    expect(formatDuration(90065)).toBe("25:01:05");
  });

  test("handles non-finite values and negative inputs", () => {
    expect(formatDuration(-1)).toBe("00:00");
    expect(formatDuration(NaN)).toBe("00:00");
    expect(formatDuration(Infinity)).toBe("00:00");
  });
});

describe("MediaStrip getItemWidth helper", () => {
  test("clamps width to minimum size", () => {
    // 1s * 32px/s = 32px, clamped to MIN_ITEM_WIDTH_PX (96px)
    expect(getItemWidth({ durationSeconds: 1 }, 32)).toBe(MIN_ITEM_WIDTH_PX);
  });

  test("does not clamp width to a maximum size", () => {
    // 20s * 32px/s = 640px
    expect(getItemWidth({ durationSeconds: 20 }, 32)).toBe(640);
  });

  test("returns linearly scaled width within boundaries", () => {
    // 5s * 32px/s = 160px
    expect(getItemWidth({ durationSeconds: 5 }, 32)).toBe(160);
  });

  test("handles alternative pxPerSecond scales", () => {
    // 5s * 20px/s = 100px
    expect(getItemWidth({ durationSeconds: 5 }, 20)).toBe(100);
  });

  test("returns MIN_ITEM_WIDTH_PX on invalid inputs", () => {
    expect(getItemWidth({ durationSeconds: NaN }, 32)).toBe(MIN_ITEM_WIDTH_PX);
    expect(getItemWidth({ durationSeconds: Infinity }, 0)).toBe(MIN_ITEM_WIDTH_PX);
    expect(getItemWidth({ durationSeconds: 5 }, NaN)).toBe(MIN_ITEM_WIDTH_PX);
    expect(getItemWidth({ durationSeconds: 5 }, -32)).toBe(MIN_ITEM_WIDTH_PX);
  });
});

describe("isPointInNestHotspot", () => {
  // A 200x100 rect at (100, 100): hotspot x in [140, 260], y in [120, 180].
  const rect = { left: 100, top: 100, width: 200, height: 100 };

  test("point at the exact center is inside the hotspot", () => {
    expect(isPointInNestHotspot(rect, { x: 200, y: 150 })).toBe(true);
  });

  test("point outside the rect entirely is outside the hotspot", () => {
    expect(isPointInNestHotspot(rect, { x: 0, y: 0 })).toBe(false);
  });

  test("point inside the rect but outside the 20%-80% band is outside the hotspot", () => {
    // x=110 is inside [100,300] but left of the hotspot's left edge (140).
    expect(isPointInNestHotspot(rect, { x: 110, y: 150 })).toBe(false);
  });

  test("point exactly on the hotspot's left/top boundary is inside (inclusive)", () => {
    const left = rect.left + rect.width * NEST_HOTSPOT_MIN_OFFSET;
    const top = rect.top + rect.height * NEST_HOTSPOT_MIN_OFFSET;
    expect(isPointInNestHotspot(rect, { x: left, y: top })).toBe(true);
  });

  test("point exactly on the hotspot's right/bottom boundary is inside (inclusive)", () => {
    const right = rect.left + rect.width * NEST_HOTSPOT_MAX_OFFSET;
    const bottom = rect.top + rect.height * NEST_HOTSPOT_MAX_OFFSET;
    expect(isPointInNestHotspot(rect, { x: right, y: bottom })).toBe(true);
  });

  test("point one unit outside either boundary is outside the hotspot", () => {
    const left = rect.left + rect.width * NEST_HOTSPOT_MIN_OFFSET;
    const bottom = rect.top + rect.height * NEST_HOTSPOT_MAX_OFFSET;
    expect(isPointInNestHotspot(rect, { x: left - 1, y: 150 })).toBe(false);
    expect(isPointInNestHotspot(rect, { x: 200, y: bottom + 1 })).toBe(false);
  });

  test("a zero-size rect has no hotspot", () => {
    const zeroRect = { left: 50, top: 50, width: 0, height: 0 };
    expect(isPointInNestHotspot(zeroRect, { x: 50, y: 50 })).toBe(true);
    expect(isPointInNestHotspot(zeroRect, { x: 51, y: 50 })).toBe(false);
  });

  test("a very small rect still resolves a well-defined hotspot band", () => {
    const smallRect = { left: 0, top: 0, width: 10, height: 10 };
    // Hotspot band: x in [2, 8], y in [2, 8].
    expect(isPointInNestHotspot(smallRect, { x: 5, y: 5 })).toBe(true);
    expect(isPointInNestHotspot(smallRect, { x: 1, y: 5 })).toBe(false);
  });
});

describe("isPointWithinRect", () => {
  const rect = { left: 100, top: 100, width: 200, height: 100 };

  test("point at the center is within the rect", () => {
    expect(isPointWithinRect(rect, { x: 200, y: 150 })).toBe(true);
  });

  test("point outside the rect is not within it", () => {
    expect(isPointWithinRect(rect, { x: 0, y: 0 })).toBe(false);
  });

  test("point exactly on each edge is within it (inclusive)", () => {
    expect(isPointWithinRect(rect, { x: 100, y: 150 })).toBe(true); // left edge
    expect(isPointWithinRect(rect, { x: 300, y: 150 })).toBe(true); // right edge
    expect(isPointWithinRect(rect, { x: 200, y: 100 })).toBe(true); // top edge
    expect(isPointWithinRect(rect, { x: 200, y: 200 })).toBe(true); // bottom edge
  });

  test("point one unit outside any edge is not within it", () => {
    expect(isPointWithinRect(rect, { x: 99, y: 150 })).toBe(false);
    expect(isPointWithinRect(rect, { x: 301, y: 150 })).toBe(false);
    expect(isPointWithinRect(rect, { x: 200, y: 99 })).toBe(false);
    expect(isPointWithinRect(rect, { x: 200, y: 201 })).toBe(false);
  });

  test("unlike isPointInNestHotspot, the whole rect counts, not just the center band", () => {
    // x=110 is inside the rect but outside the [20%,80%] nest hotspot band.
    expect(isPointWithinRect(rect, { x: 110, y: 150 })).toBe(true);
    expect(isPointInNestHotspot(rect, { x: 110, y: 150 })).toBe(false);
  });
});

describe("Drag and Scroll Activation Thresholds", () => {
  test("asserts scroll threshold is strictly less than board threshold", () => {
    // This pins the UX constraint: diagonal/small drags below 5px prioritize
    // horizontal scroll area scrolling over board-level item reordering.
    expect(DRAG_ACTIVATION_THRESHOLDS_PX.scroll).toBeLessThan(
      DRAG_ACTIVATION_THRESHOLDS_PX.board
    );
  });
});

describe("MediaStripItemButton areEqual custom comparator", () => {
  const itemA = makeImageItem("item-a", "Item A");
  const itemB = makeImageItem("item-b", "Item B");
  const index = 0;

  const baseStyle = {
    width: "100px",
    left: "10px",
    top: 4,
    height: "calc(100% - 8px)",
  };

  const baseProps = {
    item: itemA,
    index,
    isKeyboardReordering: false,
    thumbnailVariant: "sequence" as const,
    collectionId: asCollectionId("strip-1"),
    style: baseStyle,
  };

  test("returns true for identical items and matching styles", () => {
    const prev = { ...baseProps, style: { ...baseStyle } };
    const next = { ...baseProps, style: { ...baseStyle } };
    expect(areEqual(prev, next)).toBe(true);
  });

  test("returns false if items change", () => {
    const prev = { ...baseProps, item: itemA };
    const next = { ...baseProps, item: itemB };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false if style width changes", () => {
    const prev = { ...baseProps };
    const next = { ...baseProps, style: { ...baseStyle, width: "120px" } };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false if style left changes", () => {
    const prev = { ...baseProps };
    const next = { ...baseProps, style: { ...baseStyle, left: "20px" } };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false if style top changes", () => {
    const prev = { ...baseProps };
    const next = { ...baseProps, style: { ...baseStyle, top: 6 } };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false if style height changes", () => {
    const prev = { ...baseProps };
    const next = { ...baseProps, style: { ...baseStyle, height: "calc(100% - 12px)" } };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false if isKeyboardReordering changes", () => {
    const prev = { ...baseProps, isKeyboardReordering: false };
    const next = { ...baseProps, isKeyboardReordering: true };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false when thumbnailVariant changes", () => {
    const prev = { ...baseProps, thumbnailVariant: "sequence" as const };
    const next = { ...baseProps, thumbnailVariant: "single" as const };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false when collectionId changes", () => {
    const prev = { ...baseProps, collectionId: asCollectionId("strip-1") };
    const next = { ...baseProps, collectionId: asCollectionId("strip-2") };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false when index changes", () => {
    const prev = { ...baseProps, index: 0 };
    const next = { ...baseProps, index: 1 };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("handles missing or undefined style objects safely", () => {
    const prev = {
      item: itemA,
      index,
      isKeyboardReordering: false,
    };
    const next = {
      item: itemA,
      index,
      isKeyboardReordering: false,
      style: { ...baseStyle },
    };
    expect(areEqual(prev, next)).toBe(false);
    expect(areEqual(next, prev)).toBe(false);
    expect(areEqual(prev, prev)).toBe(true);
  });
});
