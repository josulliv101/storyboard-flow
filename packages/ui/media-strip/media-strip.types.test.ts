import { describe, expect, test } from "vitest";
import {
  asTimelineItemId,
  asCollectionId,
  isImageItem,
  isVideoItem,
  isMediaItem,
  isCollectionItem,
  getTimelineItemEndTimeSeconds,
  getVideoVisibleDurationSeconds,
  validateTimelineItemTiming,
  validateCollectionTimelineItem,
  validateVideoTimelineItem,
  createImageTimelineItem,
  createCollectionTimelineItem,
  createVideoTimelineItem,
  updateImageTimelineItem,
  updateCollectionTimelineItem,
  updateVideoTimelineItem,
  type ImageTimelineItem,
  type VideoTimelineItem,
  type CollectionTimelineItem,
} from "./media-strip.types";

describe("Timeline Items Branding", () => {
  test("brands timeline item and collection IDs", () => {
    const itemId = asTimelineItemId("item-1");
    const collectionId = asCollectionId("collection-1");

    expect(itemId).toBe("item-1");
    expect(collectionId).toBe("collection-1");
  });
});

describe("Timeline Items Type Guards", () => {
  const imageItem: ImageTimelineItem = {
    id: asTimelineItemId("image-1"),
    name: "Test Image",
    kind: "image",
    src: "http://example.com/image.jpg",
    startTimeSeconds: 0,
    durationSeconds: 10,
  };

  const videoItem: VideoTimelineItem = {
    id: asTimelineItemId("video-1"),
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
    id: asTimelineItemId("collection-1"),
    name: "Test Collection",
    kind: "collection",
    collectionId: asCollectionId("collection-col-1"),
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
      id: asTimelineItemId("item-1"),
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
      id: asTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: 0,
      durationSeconds: 10,
    };
    expect(validateTimelineItemTiming(item as any)).toEqual({ valid: true });
  });

  test("fails timing validation for negative start time", () => {
    const item = {
      id: asTimelineItemId("item-1"),
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
      id: asTimelineItemId("item-1"),
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
      id: asTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: Infinity,
      durationSeconds: 10,
    };
    expect(validateTimelineItemTiming(itemStartInfinity as any)).toEqual({
      valid: false,
      reason: "non-finite-start-time",
    });

    const itemDurationNaN = {
      id: asTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: 0,
      durationSeconds: NaN,
    };
    expect(validateTimelineItemTiming(itemDurationNaN as any)).toEqual({
      valid: false,
      reason: "non-finite-duration",
    });
  });

  test("tolerates tiny negative times within epsilon", () => {
    const itemTinyNegativeStart = {
      id: asTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: -0.0000001,
      durationSeconds: 10,
    };
    expect(validateTimelineItemTiming(itemTinyNegativeStart as any)).toEqual({
      valid: true,
    });
  });
});

describe("Collection Timing and Integrity Validation", () => {
  const baseCollection = {
    id: asTimelineItemId("col-1"),
    name: "Col",
    kind: "collection" as const,
    collectionId: asCollectionId("c-1"),
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
    id: asTimelineItemId("vid-1"),
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
      id: asTimelineItemId("img-1"),
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
      id: asTimelineItemId("img-1"),
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
      id: asTimelineItemId("col-1"),
      name: "Col",
      collectionId: asCollectionId("c-1"),
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
      id: asTimelineItemId("vid-1"),
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
      id: asTimelineItemId("img-1"),
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
      id: asTimelineItemId("vid-1"),
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
