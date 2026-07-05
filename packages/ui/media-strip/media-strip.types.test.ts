import { describe, expect, test } from "vitest";
import {
  asTimelineItemId,
  asCollectionId,
  isImageItem,
  isVideoItem,
  isMediaItem,
  isCollectionItem,
  type ImageTimelineItem,
  type VideoTimelineItem,
  type CollectionTimelineItem,
  type TimelineItemId,
  type CollectionId,
} from "./media-strip.types";

  validateTimelineItemTiming,
  validateCollectionTimelineItem,
  validateVideoTimelineItem,
  validateTimelineItem,
  validateMediaItemStrings,
  createImageTimelineItem,
  createCollectionTimelineItem,
  createVideoTimelineItem,
  updateImageTimelineItem,
  updateCollectionTimelineItem,
  updateVideoTimelineItem,
} from "./media-strip.validation";

import {
  getTimelineItemEndTimeSeconds,
  getVideoVisibleDurationSeconds,
  getItemWidth,
  formatDuration,
  areEqual,
  MIN_ITEM_WIDTH_PX,
} from "./media-strip.utils";

describe("Timeline Items Branding", () => {
  test("validates timeline item and collection IDs", () => {
    const validItem = asTimelineItemId("item-1");
    const validCol = asCollectionId("collection-1");
    const invalidItem = asTimelineItemId("");
    const invalidCol = asCollectionId("");

    expect(validItem).toEqual({ ok: true, value: "item-1" as TimelineItemId });
    expect(validCol).toEqual({ ok: true, value: "collection-1" as CollectionId });
    expect(invalidItem).toEqual({ ok: false, error: "empty-id" });
    expect(invalidCol).toEqual({ ok: false, error: "empty-id" });
  });
});

describe("Timeline Items Type Guards", () => {
  const imageItem: ImageTimelineItem = {
    id: "image-1" as TimelineItemId,
    name: "Test Image",
    kind: "image",
    src: "http://example.com/image.jpg",
    startTimeSeconds: 0,
    durationSeconds: 10,
  };

  const videoItem: VideoTimelineItem = {
    id: "video-1" as TimelineItemId,
    name: "Test Video",
    kind: "video",
    src: "http://example.com/video.mp4",
    startTimeSeconds: 10,
    durationSeconds: 20,
    sourceDurationSeconds: 30,
    trimInSeconds: 5,
    trimOutSeconds: 5,
  };

  const collectionItem: CollectionTimelineItem = {
    id: "collection-1" as TimelineItemId,
    name: "Test Collection",
    kind: "collection",
    collectionId: "collection-col-1" as CollectionId,
    itemCount: 3,
    startTimeSeconds: 5,
    durationSeconds: 15,
  };

  test("correctly identifies image items", () => {
    expect(isImageItem(imageItem)).toBe(true);
    expect(isImageItem(videoItem)).toBe(false);
    expect(isImageItem(collectionItem)).toBe(false);
  });

  test("correctly identifies video items", () => {
    expect(isVideoItem(imageItem)).toBe(false);
    expect(isVideoItem(videoItem)).toBe(true);
    expect(isVideoItem(collectionItem)).toBe(false);
  });

  test("correctly identifies media items", () => {
    expect(isMediaItem(imageItem)).toBe(true);
    expect(isMediaItem(videoItem)).toBe(true);
    expect(isMediaItem(collectionItem)).toBe(false);
  });

  test("correctly identifies collection items", () => {
    expect(isCollectionItem(imageItem)).toBe(false);
    expect(isCollectionItem(videoItem)).toBe(false);
    expect(isCollectionItem(collectionItem)).toBe(true);
  });
});

describe("Timeline Items Derived Helpers", () => {
  test("calculates end time correctly", () => {
    const item = {
      id: "item-1" as TimelineItemId,
      name: "Item",
      startTimeSeconds: 5.5,
      durationSeconds: 10.2,
    };
    expect(getTimelineItemEndTimeSeconds(item as any)).toBeCloseTo(15.7);
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

describe("Timeline Items Timing Validation", () => {
  test("validates correct timing", () => {
    const item = {
      id: "item-1" as TimelineItemId,
      name: "Item",
      startTimeSeconds: 0,
      durationSeconds: 10,
    };
    expect(validateTimelineItemTiming(item as any)).toEqual({ valid: true });
  });

  test("fails timing validation for negative start time", () => {
    const item = {
      id: "item-1" as TimelineItemId,
      name: "Item",
      startTimeSeconds: -1,
      durationSeconds: 10,
    };
    expect(validateTimelineItemTiming(item as any)).toEqual({
      valid: false,
      reason: "negative-start-time",
    });
  });

  test("fails timing validation for negative duration", () => {
    const item = {
      id: "item-1" as TimelineItemId,
      name: "Item",
      startTimeSeconds: 0,
      durationSeconds: -5,
    };
    expect(validateTimelineItemTiming(item as any)).toEqual({
      valid: false,
      reason: "negative-duration",
    });
  });

  test("fails timing validation for non-finite values", () => {
    const itemStartInfinity = {
      id: "item-1" as TimelineItemId,
      name: "Item",
      startTimeSeconds: Infinity,
      durationSeconds: 10,
    };
    expect(validateTimelineItemTiming(itemStartInfinity as any)).toEqual({
      valid: false,
      reason: "non-finite-start-time",
    });

    const itemDurationNaN = {
      id: "item-1" as TimelineItemId,
      name: "Item",
      startTimeSeconds: 0,
      durationSeconds: NaN,
    };
    expect(validateTimelineItemTiming(itemDurationNaN as any)).toEqual({
      valid: false,
      reason: "non-finite-duration",
    });
  });

  test("fails timing validation for empty or invalid name", () => {
    const itemEmptyName = {
      id: "item-1" as TimelineItemId,
      name: "",
      startTimeSeconds: 0,
      durationSeconds: 10,
    };
    expect(validateTimelineItemTiming(itemEmptyName as any)).toEqual({
      valid: false,
      reason: "empty-name",
    });

    const itemWhitespaceName = {
      id: "item-1" as TimelineItemId,
      name: "   ",
      startTimeSeconds: 0,
      durationSeconds: 10,
    };
    expect(validateTimelineItemTiming(itemWhitespaceName as any)).toEqual({
      valid: false,
      reason: "empty-name",
    });
  });

  test("tolerates tiny negative times within epsilon", () => {
    const itemTinyNegativeStart = {
      id: "item-1" as TimelineItemId,
      name: "Item",
      startTimeSeconds: -0.0000001,
      durationSeconds: 10,
    };
    expect(validateTimelineItemTiming(itemTinyNegativeStart as any)).toEqual({
      valid: true,
    });
  });
});

describe("Media Items String Validation", () => {
  test("validates correct string values", () => {
    const item = {
      src: "https://example.com/video.mp4",
      posterSrc: "https://example.com/poster.jpg",
      posterSrcs: ["https://example.com/frame1.jpg", "https://example.com/frame2.jpg"],
    };
    expect(validateMediaItemStrings(item as any)).toEqual({ valid: true });
  });

  test("fails for invalid src type", () => {
    const item = {
      src: 123,
    };
    expect(validateMediaItemStrings(item as any)).toEqual({
      valid: false,
      reason: "invalid-src",
    });
  });

  test("fails for invalid posterSrc type", () => {
    const item = {
      src: "https://example.com/video.mp4",
      posterSrc: 123,
    };
    expect(validateMediaItemStrings(item as any)).toEqual({
      valid: false,
      reason: "invalid-poster-src",
    });
  });

  test("fails for invalid posterSrcs array or elements", () => {
    const itemNotArray = {
      src: "https://example.com/video.mp4",
      posterSrcs: "not-an-array",
    };
    expect(validateMediaItemStrings(itemNotArray as any)).toEqual({
      valid: false,
      reason: "invalid-poster-srcs",
    });

    const itemInvalidElements = {
      src: "https://example.com/video.mp4",
      posterSrcs: ["https://example.com/frame1.jpg", 123],
    };
    expect(validateMediaItemStrings(itemInvalidElements as any)).toEqual({
      valid: false,
      reason: "invalid-poster-srcs",
    });
  });
});

describe("Collection Timing and Integrity Validation", () => {
  const baseCollection = {
    id: "col-1" as TimelineItemId,
    name: "Col",
    kind: "collection" as const,
    collectionId: "c-1" as CollectionId,
    startTimeSeconds: 0,
    durationSeconds: 10,
    itemCount: 5,
  };

  test("validates correct collection", () => {
    expect(validateCollectionTimelineItem(baseCollection)).toEqual({ valid: true });
  });

  test("fails for invalid timing in collection", () => {
    expect(
      validateCollectionTimelineItem({
        ...baseCollection,
        startTimeSeconds: -1,
      })
    ).toEqual({ valid: false, reason: "negative-start-time" });
  });

  test("fails for invalid item counts", () => {
    expect(
      validateCollectionTimelineItem({
        ...baseCollection,
        itemCount: -5,
      })
    ).toEqual({ valid: false, reason: "negative-item-count" });

    expect(
      validateCollectionTimelineItem({
        ...baseCollection,
        itemCount: 2.5,
      })
    ).toEqual({ valid: false, reason: "non-integer-item-count" });

    expect(
      validateCollectionTimelineItem({
        ...baseCollection,
        itemCount: Infinity,
      })
    ).toEqual({ valid: false, reason: "non-finite-item-count" });
  });
});

describe("Video Timing and Integrity Validation", () => {
  const baseVideo: VideoTimelineItem = {
    id: "vid-1" as TimelineItemId,
    name: "Vid",
    kind: "video",
    src: "vid.mp4",
    startTimeSeconds: 0,
    durationSeconds: 10,
    sourceDurationSeconds: 20,
    trimInSeconds: 5,
    trimOutSeconds: 5,
  };

  test("validates correct video", () => {
    expect(validateVideoTimelineItem(baseVideo)).toEqual({ valid: true });
  });

  test("fails for negative trim/duration values", () => {
    expect(
      validateVideoTimelineItem({
        ...baseVideo,
        sourceDurationSeconds: -20,
        durationSeconds: 0,
        trimInSeconds: 0,
        trimOutSeconds: 20,
      })
    ).toEqual({ valid: false, reason: "negative-source-duration" });

    expect(
      validateVideoTimelineItem({
        ...baseVideo,
        trimInSeconds: -2,
        durationSeconds: 12,
      })
    ).toEqual({ valid: false, reason: "negative-trim-in" });
  });

  test("fails if trim exceeds source duration", () => {
    expect(
      validateVideoTimelineItem({
        ...baseVideo,
        trimInSeconds: 15,
        trimOutSeconds: 10,
        durationSeconds: 0,
      })
    ).toEqual({ valid: false, reason: "trim-exceeds-source" });
  });

  test("fails if duration mismatch occurs", () => {
    expect(
      validateVideoTimelineItem({
        ...baseVideo,
        durationSeconds: 8, // Should be 10 (20 - 5 - 5)
      })
    ).toEqual({
      valid: false,
      reason: "duration-mismatch",
      expectedDurationSeconds: 10,
    });
  });
});

describe("Timeline Items Smart Constructors", () => {
  test("creates image item successfully", () => {
    const result = createImageTimelineItem({
      id: "img-1" as TimelineItemId,
      name: "Img",
      src: "img.png",
      startTimeSeconds: -0.0000001, // normalized to 0
      durationSeconds: 15,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startTimeSeconds).toBe(0);
      expect(result.value.kind).toBe("image");
    }
  });

  test("fails creating image item on validation error", () => {
    const result = createImageTimelineItem({
      id: "img-1" as TimelineItemId,
      name: "Img",
      src: "img.png",
      startTimeSeconds: -5,
      durationSeconds: 15,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("negative-start-time");
    }
  });

  test("creates collection item successfully", () => {
    const result = createCollectionTimelineItem({
      id: "col-1" as TimelineItemId,
      name: "Col",
      collectionId: "c-1" as CollectionId,
      startTimeSeconds: 0,
      durationSeconds: 10,
      itemCount: 4,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.itemCount).toBe(4);
      expect(result.value.kind).toBe("collection");
    }
  });

  test("creates video item and automatically calculates duration", () => {
    const result = createVideoTimelineItem({
      id: "vid-1" as TimelineItemId,
      name: "Vid",
      src: "vid.mp4",
      startTimeSeconds: 2,
      sourceDurationSeconds: 50,
      trimInSeconds: 10.5,
      trimOutSeconds: 9.5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.durationSeconds).toBe(30); // 50 - 10.5 - 9.5
      expect(result.value.kind).toBe("video");
    }
  });
});

describe("Timeline Items Update Helpers", () => {
  test("updates image item and normalizes timings", () => {
    const image = createImageTimelineItem({
      id: "img-1" as TimelineItemId,
      name: "Img",
      src: "img.png",
      startTimeSeconds: 0,
      durationSeconds: 10,
    });

    expect(image.ok).toBe(true);
    if (image.ok) {
      const updated = updateImageTimelineItem(image.value, {
        startTimeSeconds: 5,
        durationSeconds: 20,
      });
      expect(updated.ok).toBe(true);
      if (updated.ok) {
        expect(updated.value.startTimeSeconds).toBe(5);
        expect(updated.value.durationSeconds).toBe(20);
        expect(updated.value.name).toBe("Img");
      }
    }
  });

  test("updates video item and recalculates duration", () => {
    const video = createVideoTimelineItem({
      id: "vid-1" as TimelineItemId,
      name: "Vid",
      src: "vid.mp4",
      startTimeSeconds: 0,
      sourceDurationSeconds: 100,
      trimInSeconds: 10,
      trimOutSeconds: 10,
    });

    expect(video.ok).toBe(true);
    if (video.ok) {
      const updated = updateVideoTimelineItem(video.value, {
        trimInSeconds: 20,
        trimOutSeconds: 30,
      });
      expect(updated.ok).toBe(true);
      if (updated.ok) {
        expect(updated.value.durationSeconds).toBe(50); // 100 - 20 - 30
      }
    }
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
});

describe("MediaStrip getItemWidth helper", () => {
  test("clamps width to minimum size", () => {
    const item = { durationSeconds: 1 } as any;
    // 1s * 32px/s = 32px, clamped to MIN_ITEM_WIDTH_PX (96px)
    expect(getItemWidth(item, 32)).toBe(MIN_ITEM_WIDTH_PX);
  });

  test("does not clamp width to a maximum size", () => {
    const item = { durationSeconds: 20 } as any;
    // 20s * 32px/s = 640px
    expect(getItemWidth(item, 32)).toBe(640);
  });

  test("returns linearly scaled width within boundaries", () => {
    const item = { durationSeconds: 5 } as any;
    // 5s * 32px/s = 160px
    expect(getItemWidth(item, 32)).toBe(160);
  });

  test("handles alternative pxPerSecond scales", () => {
    const item = { durationSeconds: 5 } as any;
    // 5s * 20px/s = 100px
    expect(getItemWidth(item, 20)).toBe(100);
  });
});

describe("MediaStripItemButton areEqual custom comparator", () => {
  const itemA = { id: "item-a" as TimelineItemId, name: "Item A" } as any;
  const itemB = { id: "item-b" as TimelineItemId, name: "Item B" } as any;

  test("returns true for identical items and matching styles", () => {
    const prev = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    const next = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    expect(areEqual(prev, next)).toBe(true);
  });

  test("returns false if items change", () => {
    const prev = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    const next = {
      item: itemB,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false if style width changes", () => {
    const prev = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    const next = {
      item: itemA,
      style: {
        width: "120px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false if style transform changes", () => {
    const prev = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    const next = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(20px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false if style top changes", () => {
    const prev = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    const next = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 6,
        height: "calc(100% - 8px)",
      },
    };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("returns false if style height changes", () => {
    const prev = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    const next = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 12px)",
      },
    };
    expect(areEqual(prev, next)).toBe(false);
  });

  test("handles missing or undefined style objects safely", () => {
    const prev = {
      item: itemA,
    };
    const next = {
      item: itemA,
      style: {
        width: "100px",
        transform: "translateX(10px)",
        top: 4,
        height: "calc(100% - 8px)",
      },
    };
    expect(areEqual(prev, next)).toBe(false);
    expect(areEqual(next, prev)).toBe(false);
    expect(areEqual(prev, prev)).toBe(true);
  });
});

describe("validateTimelineItem dynamic dispatcher", () => {
  test("correctly dispatches validation to image timeline items", () => {
    const image = {
      id: "img-1" as TimelineItemId,
      kind: "image",
      name: "Img",
      src: "img.jpg",
      startTimeSeconds: 0,
      durationSeconds: 10,
    } as any;
    expect(validateTimelineItem(image)).toEqual({ valid: true });

    const invalidImage = { ...image, startTimeSeconds: -5 };
    expect(validateTimelineItem(invalidImage)).toEqual({
      valid: false,
      reason: "negative-start-time",
    });
  });

  test("correctly dispatches validation to video timeline items", () => {
    const video = {
      id: "vid-1" as TimelineItemId,
      kind: "video",
      name: "Vid",
      src: "vid.mp4",
      startTimeSeconds: 0,
      durationSeconds: 10,
      sourceDurationSeconds: 100,
      trimInSeconds: 10,
      trimOutSeconds: 80,
    } as any;
    expect(validateTimelineItem(video)).toEqual({ valid: true });

    const invalidVideo = { ...video, trimInSeconds: -5 };
    expect(validateTimelineItem(invalidVideo)).toEqual({
      valid: false,
      reason: "negative-trim-in",
    });
  });

  test("correctly dispatches validation to collection timeline items", () => {
    const collection = {
      id: "col-1" as TimelineItemId,
      kind: "collection",
      name: "Col",
      startTimeSeconds: 0,
      durationSeconds: 10,
      collectionId: "col-id" as CollectionId,
      itemCount: 5,
    } as any;
    expect(validateTimelineItem(collection)).toEqual({ valid: true });

    const invalidCollection = { ...collection, itemCount: -1 };
    expect(validateTimelineItem(invalidCollection)).toEqual({
      valid: false,
      reason: "negative-item-count",
    });
  });
});
