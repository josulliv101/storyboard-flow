import { describe, expect, test } from "vitest";
import {
  parseTimelineItemId,
  parseCollectionId,
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

describe("Timeline Items Branding", () => {
  test("validates timeline item and collection IDs", () => {
    const validItem = parseTimelineItemId("item-1");
    const validCol = parseCollectionId("collection-1");
    const invalidItem = parseTimelineItemId("");
    const invalidCol = parseCollectionId("");
    const whitespaceItem = parseTimelineItemId("   ");
    const whitespaceCol = parseCollectionId("   ");

    expect(validItem).toEqual({ ok: true, value: asTimelineItemId("item-1") });
    expect(validCol).toEqual({ ok: true, value: asCollectionId("collection-1") });
    expect(invalidItem).toEqual({ ok: false, error: "empty-id" });
    expect(invalidCol).toEqual({ ok: false, error: "empty-id" });
    expect(whitespaceItem).toEqual({ ok: false, error: "empty-id" });
    expect(whitespaceCol).toEqual({ ok: false, error: "empty-id" });
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
