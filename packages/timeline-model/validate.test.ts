import { describe, expect, it } from "vitest";

import { isStoredTimelineDocument, isTimelineClip } from "./validate";

const image = {
  id: "img-1",
  index: 0,
  kind: "image",
  src: "https://cdn.test/img.jpg",
  alt: "img",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 4,
  sourceDuration: 4,
  trimIn: 0,
  trimOut: 0,
};

const video = {
  ...image,
  id: "vid-1",
  kind: "video",
  src: "https://cdn.test/vid.mp4",
  poster: "https://cdn.test/vid.jpg",
  sourceDuration: 10,
  trimOut: 6,
};

const collection = {
  id: "col-1",
  index: 1,
  kind: "collection",
  title: "Scene",
  childTimelineId: "timeline-1",
  itemCount: 3,
  previewItems: [
    { id: "p1", kind: "image", src: "https://cdn.test/p1.jpg", alt: "p1" },
  ],
  alt: "Scene collection",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 4.12,
  duration: 3,
  sourceDuration: 3,
  trimIn: 0,
  trimOut: 0,
};

describe("isTimelineClip", () => {
  it("accepts every stored clip kind", () => {
    expect(isTimelineClip(image)).toBe(true);
    expect(isTimelineClip(video)).toBe(true);
    expect(isTimelineClip(collection)).toBe(true);
  });

  it("tolerates null optionals (Firestore round-trips produce them)", () => {
    expect(isTimelineClip({ ...video, poster: null })).toBe(true);
    expect(isTimelineClip({ ...collection, previewItems: null })).toBe(true);
    expect(isTimelineClip({ ...image, playbackStartTime: null })).toBe(true);
    expect(isTimelineClip({ ...image, sourceAsset: null })).toBe(true);
  });

  it("accepts a finite preview trim and rejects malformed preview trims", () => {
    const preview = collection.previewItems[0];
    expect(
      isTimelineClip({
        ...collection,
        previewItems: [{ ...preview, kind: "video", trimIn: 2.5 }],
      }),
    ).toBe(true);
    expect(
      isTimelineClip({
        ...collection,
        previewItems: [{ ...preview, kind: "video", trimIn: "2.5" }],
      }),
    ).toBe(false);
    expect(
      isTimelineClip({
        ...collection,
        previewItems: [{ ...preview, kind: "video", trimIn: Number.NaN }],
      }),
    ).toBe(false);
  });

  it("accepts a whole sourceAsset ref and rejects a half-recorded one", () => {
    const ref = { providerId: "cloudinary", assetId: "gstudio/u/pic-1" };
    expect(isTimelineClip({ ...image, sourceAsset: ref })).toBe(true);
    expect(isTimelineClip({ ...video, sourceAsset: ref })).toBe(true);
    // Half a ref would send re-resolution to the wrong provider — worse
    // than none, so it fails the clip.
    expect(isTimelineClip({ ...image, sourceAsset: { providerId: "cloudinary" } })).toBe(false);
    expect(isTimelineClip({ ...image, sourceAsset: { providerId: "", assetId: "x" } })).toBe(false);
    expect(isTimelineClip({ ...image, sourceAsset: { providerId: "p", assetId: "" } })).toBe(false);
    expect(isTimelineClip({ ...image, sourceAsset: "cloudinary:pic-1" })).toBe(false);
  });

  it("rejects the shapes the shallow guard let through", () => {
    expect(isTimelineClip({ ...image, kind: "gif" })).toBe(false); // unknown kind
    expect(isTimelineClip({ ...image, src: undefined })).toBe(false); // media without src
    expect(isTimelineClip({ ...image, duration: Number.NaN })).toBe(false); // NaN poisons packing
    expect(isTimelineClip({ ...image, startTime: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isTimelineClip({ ...image, id: "" })).toBe(false);
    expect(isTimelineClip({ ...collection, childTimelineId: "" })).toBe(false);
    expect(isTimelineClip({ ...collection, itemCount: "3" })).toBe(false);
    expect(isTimelineClip({ ...collection, previewItems: [{ id: 1 }] })).toBe(false);
    expect(isTimelineClip("not a clip")).toBe(false);
    expect(isTimelineClip(null)).toBe(false);
  });
});

describe("isStoredTimelineDocument", () => {
  it("accepts a document whose every clip validates", () => {
    expect(
      isStoredTimelineDocument({ id: "doc", title: "Doc", clips: [image, video, collection] }),
    ).toBe(true);
    expect(isStoredTimelineDocument({ id: "doc", title: "", clips: [] })).toBe(true);
    expect(
      isStoredTimelineDocument({ id: "doc", title: "Doc", description: null, clips: [] }),
    ).toBe(true);
  });

  it("accepts `disabled` only as a boolean", () => {
    // The write gate is the last place a bad value can be stopped: the
    // playback and summary passes read this flag as "skip this clip", so a
    // stored string would silently drop a clip from the timeline.
    expect(isTimelineClip({ ...image, disabled: true })).toBe(true);
    expect(isTimelineClip({ ...image, disabled: false })).toBe(true);
    expect(isTimelineClip(image)).toBe(true);
    expect(isTimelineClip({ ...image, disabled: "false" })).toBe(false);
    expect(isTimelineClip({ ...image, disabled: 1 })).toBe(false);
    expect(isTimelineClip({ ...image, disabled: null })).toBe(false);
  });

  it("rejects a document containing ONE malformed clip", () => {
    expect(
      isStoredTimelineDocument({
        id: "doc",
        title: "Doc",
        clips: [image, { ...video, duration: "6" }],
      }),
    ).toBe(false);
    expect(isStoredTimelineDocument({ id: "doc", title: "Doc", clips: "nope" })).toBe(false);
    expect(isStoredTimelineDocument({ id: "", title: "Doc", clips: [] })).toBe(false);
  });
});
