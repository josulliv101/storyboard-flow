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

  it("gates placedStart, which packing HONOURS rather than recomputes", () => {
    // Sharper than the other optionals: a bad value here does not get
    // recalculated away, it puts a clip somewhere nobody asked for.
    expect(isTimelineClip({ ...image, placedStart: 7.5 })).toBe(true);
    expect(isTimelineClip({ ...image, placedStart: 0 })).toBe(true);
    expect(isTimelineClip({ ...image, placedStart: null })).toBe(true);
    expect(isTimelineClip({ ...image, placedStart: -1 })).toBe(false);
    expect(isTimelineClip({ ...image, placedStart: Number.NaN })).toBe(false);
    expect(isTimelineClip({ ...image, placedStart: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isTimelineClip({ ...image, placedStart: "7.5" })).toBe(false);
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

// Numeric invariants (external review, 2026-07-30). Finiteness alone let a
// payload satisfy the guard and still violate the model it claims to be —
// negative spans, a fractional index, a zero aspect, trims longer than the
// source. Each was accepted, persisted, and only failed later in packing or
// hydration, a long way from the write that caused it.
//
// The ACCEPT cases matter as much as the reject ones: this guards the write
// path our own client goes through, so a rule that is merely stricter is a
// rule that stops the app saving.

describe("numeric invariants", () => {
  const clip = (over: Record<string, unknown>) => ({ ...image, ...over });

  it.each([
    ["a negative duration", { duration: -1 }],
    ["a negative start time", { startTime: -0.5 }],
    ["a negative source duration", { sourceDuration: -4 }],
    ["a negative trim in", { trimIn: -1 }],
    ["a negative trim out", { trimOut: -1 }],
    ["a negative playback duration", { playbackDuration: -2 }],
    ["a fractional index", { index: 1.5 }],
    ["a negative index", { index: -1 }],
    ["a zero aspect", { aspect: 0 }],
    ["a negative aspect", { aspect: -1.78 }],
  ])("rejects %s", (_label, over) => {
    expect(isTimelineClip(clip(over))).toBe(false);
  });

  it("rejects trims that leave nothing of the source", () => {
    // 6 + 5 > 10: the clip would have negative effective duration, which the
    // packer turns into overlapping geometry rather than an error.
    expect(isTimelineClip(clip({ sourceDuration: 10, trimIn: 6, trimOut: 5 }))).toBe(false);
  });

  it("ACCEPTS trims that exactly consume the source", () => {
    // Reachable by dragging a handle to the end. `<` would refuse a save the
    // user can perform.
    expect(isTimelineClip(clip({ sourceDuration: 10, trimIn: 4, trimOut: 6 }))).toBe(true);
  });

  it("ACCEPTS float dust past the source", () => {
    // Trims accumulate from pointer deltas; 0.1 + 0.2 is famously not 0.3.
    // The tolerance is arithmetic, not slack.
    expect(isTimelineClip(clip({ sourceDuration: 0.3, trimIn: 0.1, trimOut: 0.2 }))).toBe(true);
  });

  it("ACCEPTS a zero duration — an empty hydrated collection has no span", () => {
    expect(isTimelineClip(clip({ duration: 0, sourceDuration: 0, trimIn: 0, trimOut: 0 })))
      .toBe(true);
  });

  it("ACCEPTS a fractional trackIndex, deliberately", () => {
    // It should be an integer, but a legacy stored detail carrying a float
    // would then be unable to write itself back, and the field is inert until
    // multi-track lands. Pinned so the leniency is a decision, not a gap.
    expect(isTimelineClip(clip({ trackIndex: 0.5 }))).toBe(true);
  });

  it("rejects a fractional or negative collection itemCount", () => {
    expect(isTimelineClip({ ...collection, itemCount: 2.5 })).toBe(false);
    expect(isTimelineClip({ ...collection, itemCount: -1 })).toBe(false);
  });

  it("rejects a playable duration longer than the span it is drawn from", () => {
    // playableDuration counts the ENABLED subset, so it cannot exceed the
    // layout span that includes the disabled ones too.
    expect(isTimelineClip({ ...collection, duration: 4, playableDuration: 9 })).toBe(false);
    expect(isTimelineClip({ ...collection, duration: 9, playableDuration: 4 })).toBe(true);
  });

  it("rejects a negative preview trimIn", () => {
    expect(
      isTimelineClip({
        ...collection,
        previewItems: [
          { id: "p", kind: "image", src: "s", alt: "a", trimIn: -1 },
        ],
      }),
    ).toBe(false);
  });

  it("still rejects the whole document when one clip breaks a rule", () => {
    expect(
      isStoredTimelineDocument({
        id: "doc",
        title: "Doc",
        clips: [image, clip({ duration: -1 })],
      }),
    ).toBe(false);
  });
});
