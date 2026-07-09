import { describe, expect, test } from "vitest";
import {
  trustedTimelineItemId,
  trustedCollectionId,
  type CollectionId,
  type TimelineCollection,
  type VideoTimelineItem,
} from "./media-strip.types";
import {
  validateTimelineItemBase,
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
  validateTimelineCollection,
  wouldCreateCollectionCycle,
} from "./media-strip.validation";

// Invalid inputs in this file are deliberately built with raw object casts:
// the smart constructors reject them, and rejecting them is exactly what
// these tests exercise.

describe("Timeline Items Base Validation", () => {
  test("validates correct base invariants", () => {
    const item = {
      id: trustedTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: 0,
      durationSeconds: 10,
    };
    expect(validateTimelineItemBase(item as any)).toEqual({ valid: true });
  });

  test("fails base validation for negative start time", () => {
    const item = {
      id: trustedTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: -1,
      durationSeconds: 10,
    };
    expect(validateTimelineItemBase(item as any)).toEqual({
      valid: false,
      reason: "negative-start-time",
    });
  });

  test("fails base validation for negative duration", () => {
    const item = {
      id: trustedTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: 0,
      durationSeconds: -5,
    };
    expect(validateTimelineItemBase(item as any)).toEqual({
      valid: false,
      reason: "negative-duration",
    });
  });

  test("fails base validation for non-finite values", () => {
    const itemStartInfinity = {
      id: trustedTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: Infinity,
      durationSeconds: 10,
    };
    expect(validateTimelineItemBase(itemStartInfinity as any)).toEqual({
      valid: false,
      reason: "non-finite-start-time",
    });

    const itemDurationNaN = {
      id: trustedTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: 0,
      durationSeconds: NaN,
    };
    expect(validateTimelineItemBase(itemDurationNaN as any)).toEqual({
      valid: false,
      reason: "non-finite-duration",
    });
  });

  test("fails base validation for empty or invalid name", () => {
    const itemEmptyName = {
      id: trustedTimelineItemId("item-1"),
      name: "",
      startTimeSeconds: 0,
      durationSeconds: 10,
    };
    expect(validateTimelineItemBase(itemEmptyName as any)).toEqual({
      valid: false,
      reason: "empty-name",
    });

    const itemWhitespaceName = {
      id: trustedTimelineItemId("item-1"),
      name: "   ",
      startTimeSeconds: 0,
      durationSeconds: 10,
    };
    expect(validateTimelineItemBase(itemWhitespaceName as any)).toEqual({
      valid: false,
      reason: "empty-name",
    });
  });

  test("tolerates tiny negative times within epsilon", () => {
    const itemTinyNegativeStart = {
      id: trustedTimelineItemId("item-1"),
      name: "Item",
      startTimeSeconds: -0.0000001,
      durationSeconds: 10,
    };
    expect(validateTimelineItemBase(itemTinyNegativeStart as any)).toEqual({
      valid: true,
    });
  });
});

describe("Media Items String Validation", () => {
  test("validates correct string values", () => {
    const item = {
      src: "https://example.com/video.mp4",
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

  test("fails for empty or whitespace src", () => {
    const itemEmpty = { src: "" };
    expect(validateMediaItemStrings(itemEmpty as any)).toEqual({
      valid: false,
      reason: "invalid-src",
    });

    const itemWhitespace = { src: "   " };
    expect(validateMediaItemStrings(itemWhitespace as any)).toEqual({
      valid: false,
      reason: "invalid-src",
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

    const itemEmptyElement = {
      src: "https://example.com/video.mp4",
      posterSrcs: ["https://example.com/frame1.jpg", ""],
    };
    expect(validateMediaItemStrings(itemEmptyElement as any)).toEqual({
      valid: false,
      reason: "invalid-poster-srcs",
    });
  });
});

describe("Collection Timing and Integrity Validation", () => {
  const baseCollection = {
    id: trustedTimelineItemId("col-1"),
    name: "Col",
    kind: "collection" as const,
    collectionId: trustedCollectionId("c-1"),
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

  test("fails for empty collectionId with a distinct reason", () => {
    expect(
      validateCollectionTimelineItem({
        ...baseCollection,
        // Deliberate cast: an invalid ID can't be produced via trustedCollectionId,
        // and rejecting it is exactly what this test exercises.
        collectionId: "" as CollectionId,
      })
    ).toEqual({ valid: false, reason: "empty-collection-id" });
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
    id: trustedTimelineItemId("vid-1"),
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
      id: "img-1",
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
      id: "img-1",
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
      id: "col-1",
      name: "Col",
      collectionId: "c-1",
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

  test("fails creating collection item with an empty collectionId", () => {
    const result = createCollectionTimelineItem({
      id: "col-1",
      name: "Col",
      collectionId: "   ",
      startTimeSeconds: 0,
      durationSeconds: 10,
      itemCount: 4,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("empty-collection-id");
    }
  });

  test("creates video item and automatically calculates duration", () => {
    const result = createVideoTimelineItem({
      id: "vid-1",
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
      id: "img-1",
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
      id: "vid-1",
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

describe("validateTimelineItem dynamic dispatcher", () => {
  test("correctly dispatches validation to image timeline items", () => {
    const image = {
      id: trustedTimelineItemId("img-1"),
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
      id: trustedTimelineItemId("vid-1"),
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
      id: trustedTimelineItemId("col-1"),
      kind: "collection",
      name: "Col",
      startTimeSeconds: 0,
      durationSeconds: 10,
      collectionId: trustedCollectionId("col-id"),
      itemCount: 5,
    } as any;
    expect(validateTimelineItem(collection)).toEqual({ valid: true });

    const invalidCollection = { ...collection, itemCount: -1 };
    expect(validateTimelineItem(invalidCollection)).toEqual({
      valid: false,
      reason: "negative-item-count",
    });
  });

  test("throws a readable error for an unrecognized kind rather than a raw TypeError", () => {
    // Only reachable when the input isn't really a TimelineItem — an invalid
    // `kind` from a bad cast or `unknown` data that skipped the parse
    // boundary. It's documented as throwing (parse* is the safe path), but
    // the assertNever guard makes it a "Unexpected value" message instead of
    // "validator is not a function".
    const bogus = { id: "x", kind: "audio", name: "Nope", startTimeSeconds: 0, durationSeconds: 1 } as any;
    expect(() => validateTimelineItem(bogus)).toThrow(/Unexpected value/);
  });
});

describe("Video Constructor Failure Ordering & Trim Validation", () => {
  test("createVideoTimelineItem returns trim-exceeds-source when derived duration would be negative", () => {
    const result = createVideoTimelineItem({
      id: "vid-1",
      name: "Vid",
      src: "vid.mp4",
      startTimeSeconds: 0,
      sourceDurationSeconds: 10,
      trimInSeconds: 8,
      trimOutSeconds: 8,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("trim-exceeds-source");
    }
  });

  test("updateVideoTimelineItem rejects invalid trim updates", () => {
    const video = {
      id: trustedTimelineItemId("vid-1"),
      name: "Video",
      kind: "video" as const,
      src: "vid.mp4",
      startTimeSeconds: 0,
      sourceDurationSeconds: 10,
      trimInSeconds: 2,
      trimOutSeconds: 2,
      durationSeconds: 6,
    };

    // trimInSeconds: -1
    const res1 = updateVideoTimelineItem(video, { trimInSeconds: -1 });
    expect(res1.ok).toBe(false);

    // trimOutSeconds: -1
    const res2 = updateVideoTimelineItem(video, { trimOutSeconds: -1 });
    expect(res2.ok).toBe(false);

    // trimInSeconds + trimOutSeconds > sourceDurationSeconds
    const res3 = updateVideoTimelineItem(video, { trimInSeconds: 6, trimOutSeconds: 6 });
    expect(res3.ok).toBe(false);
    if (!res3.ok) {
      expect(res3.error.reason).toBe("trim-exceeds-source");
    }

    // sourceDurationSeconds: NaN
    const res4 = updateVideoTimelineItem(video, { sourceDurationSeconds: NaN });
    expect(res4.ok).toBe(false);
  });
});

describe("Tiny Negative Normalization for all constructors", () => {
  test("normalizes tiny negative startTimeSeconds for collection timeline items", () => {
    const result = createCollectionTimelineItem({
      id: "col-1",
      name: "Collection",
      collectionId: "collection-col",
      itemCount: 5,
      startTimeSeconds: -0.0000001,
      durationSeconds: 10,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startTimeSeconds).toBe(0);
    }
  });

  test("normalizes tiny negative trimInSeconds for video timeline items", () => {
    const result = createVideoTimelineItem({
      id: "vid-1",
      name: "Video",
      src: "vid.mp4",
      startTimeSeconds: 0,
      sourceDurationSeconds: 10,
      trimInSeconds: -0.0000001,
      trimOutSeconds: 2,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trimInSeconds).toBe(0);
    }
  });
});

describe("updateCollectionTimelineItem failure cases", () => {
  const collection = {
    id: trustedTimelineItemId("col-1"),
    name: "Collection",
    kind: "collection" as const,
    collectionId: trustedCollectionId("collection-col"),
    itemCount: 5,
    startTimeSeconds: 0,
    durationSeconds: 10,
  };

  test("rejects negative itemCount", () => {
    const result = updateCollectionTimelineItem(collection, { itemCount: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("negative-item-count");
    }
  });

  test("rejects non-integer itemCount", () => {
    const result = updateCollectionTimelineItem(collection, { itemCount: 1.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("non-integer-item-count");
    }
  });

  test("rejects empty collectionId with a distinct reason", () => {
    const result = updateCollectionTimelineItem(collection, { collectionId: "" as any });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("empty-collection-id");
    }
  });

  test("rejects negative durationSeconds", () => {
    const result = updateCollectionTimelineItem(collection, { durationSeconds: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("negative-duration");
    }
  });
});

describe("Cycle Detection for Nested Collections", () => {
  const colA: TimelineCollection = {
    id: trustedCollectionId("col-a"),
    name: "Collection A",
    items: [
      {
        id: trustedTimelineItemId("item-a"),
        name: "Pointer to B",
        kind: "collection",
        collectionId: trustedCollectionId("col-b"),
        itemCount: 0,
        startTimeSeconds: 0,
        durationSeconds: 10,
      },
    ],
  };

  const colB: TimelineCollection = {
    id: trustedCollectionId("col-b"),
    name: "Collection B",
    items: [],
  };

  const collections = new Map<CollectionId, TimelineCollection>([
    [trustedCollectionId("col-a"), colA],
    [trustedCollectionId("col-b"), colB],
  ]);

  test("detects when nesting creates a cycle", () => {
    expect(
      wouldCreateCollectionCycle({
        movingCollectionId: trustedCollectionId("col-a"),
        targetCollectionId: trustedCollectionId("col-b"),
        collectionsById: collections,
      })
    ).toBe(true);

    expect(
      wouldCreateCollectionCycle({
        movingCollectionId: trustedCollectionId("col-b"),
        targetCollectionId: trustedCollectionId("col-a"),
        collectionsById: collections,
      })
    ).toBe(false);
  });
});

describe("Timeline Collection Validation", () => {
  test("validates a collection correctly", () => {
    const validCol: TimelineCollection = {
      id: trustedCollectionId("col-1"),
      name: "Valid Collection",
      items: [
        {
          id: trustedTimelineItemId("item-1"),
          name: "Image Item",
          kind: "image",
          src: "image.jpg",
          startTimeSeconds: 0,
          durationSeconds: 10,
        },
      ],
    };
    expect(validateTimelineCollection(validCol).valid).toBe(true);

    const invalidCol: TimelineCollection = {
      // Deliberate cast: an invalid ID can't be produced via trustedCollectionId,
      // and rejecting it is exactly what this test exercises.
      id: "" as CollectionId,
      name: "",
      items: [],
    };
    expect(validateTimelineCollection(invalidCol).valid).toBe(false);
  });
});
