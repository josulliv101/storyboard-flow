import { describe, expect, it } from "vitest";

import {
  getCollectionClipFramePreview,
  registerTimelineDocument,
} from "../../lib/timeline-documents";
import type { CollectionTimelineClip, TimelineClip } from "./types";

function mediaClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: "media-clip",
    index: 0,
    kind: "video",
    src: "/fixture.mp4",
    alt: "Fixture",
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 8,
    sourceDuration: 8,
    trimIn: 0,
    trimOut: 0,
    ...overrides,
  } as TimelineClip;
}

function collectionClip(overrides: Partial<CollectionTimelineClip> = {}): CollectionTimelineClip {
  return {
    id: "collection-clip",
    index: 0,
    kind: "collection",
    title: "Collection",
    childTimelineId: "test-collection-source",
    itemCount: 1,
    alt: "Collection",
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 8,
    trimIn: 0,
    trimOut: 0,
    ...overrides,
  };
}

describe("collection timeline playback mapping", () => {
  it("maps collection clip time onto source timeline time and playback rate", () => {
    registerTimelineDocument({
      id: "test-collection-source",
      title: "Test collection source",
      clips: [mediaClip()],
    });

    const preview = getCollectionClipFramePreview(collectionClip(), 2);

    expect(preview?.id).toBe("media-clip");
    expect(preview?.previewTime).toBeCloseTo(4);
    expect(preview?.playbackRate).toBeCloseTo(2);
  });

  it("holds the previous child frame while scrubbing collection timeline gaps", () => {
    registerTimelineDocument({
      id: "test-collection-source",
      title: "Test collection source",
      clips: [
        mediaClip({
          id: "first-child",
          startTime: 0,
          duration: 1,
          sourceDuration: 1,
          alt: "First child",
        }),
        mediaClip({
          id: "second-child",
          startTime: 3,
          duration: 1,
          sourceDuration: 1,
          alt: "Second child",
        }),
      ],
    });

    const preview = getCollectionClipFramePreview(
      collectionClip({ duration: 4, sourceDuration: 4 }),
      2.5,
    );

    expect(preview?.id).toBe("first-child");
    expect(preview?.previewTime).toBeCloseTo(0.999);
  });
});
