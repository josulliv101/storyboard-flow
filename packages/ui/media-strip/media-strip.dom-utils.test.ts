import { describe, expect, test } from "vitest";
import { trustedCollectionId, type TimelineItem } from "./core/media-strip.types";
import { createImageTimelineItem } from "./core/media-strip.validation";
import { areEqual } from "./media-strip.dom-utils";

// areEqual is a React memo comparator but is pure object comparison at
// runtime, so it still runs under the Node-environment unit project —
// isElementFullyVisibleInScrollArea (real DOM measurement) is covered by the
// story interaction tests instead.

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
    collectionId: trustedCollectionId("strip-1"),
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
    const prev = { ...baseProps, collectionId: trustedCollectionId("strip-1") };
    const next = { ...baseProps, collectionId: trustedCollectionId("strip-2") };
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
