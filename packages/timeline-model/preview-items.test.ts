import { describe, expect, it } from "vitest";

import { isPreviewItem, previewItemsOf, type PreviewItemKind } from "./preview-items";
import type { MediaKind } from "./types";
import { isStoredTimelineDocument } from "./validate";

// The frame that broke deleting, copied from the batch payload the app actually
// sent. A collection of audio clips, trashed months ago, carrying a preview
// item minted before either deriver learned to skip audio.
const AUDIO_FRAME = {
  id: "audio-80b79709",
  kind: "audio",
  src: "https://res.cloudinary.com/drrxyckxi/video/upload/v1786295742/x.flac",
  alt: "Audio collection",
};

const PICTURE_FRAME = {
  id: "video-ms3r9bxk5v9z47",
  kind: "video" as const,
  src: "https://res.cloudinary.com/drrxyckxi/video/upload/v1/shot.mp4",
  poster: "https://res.cloudinary.com/drrxyckxi/video/upload/v1/shot.jpg",
  trimIn: 1.5,
  alt: "Cold open",
};

// `PreviewItemKind` restates `MediaKind` so this module stays a leaf. These two
// lines are the restatement's guard: if either union grows a member the other
// lacks, one of them stops being assignable and this file fails to compile.
type Extends<A, B> = A extends B ? true : false;
const _previewKindsAreMediaKinds: Extends<PreviewItemKind, MediaKind> = true;
const _mediaKindsArePreviewKinds: Extends<MediaKind, PreviewItemKind> = true;

describe("isPreviewItem", () => {
  it("accepts a picture, with and without its optional fields", () => {
    expect(isPreviewItem(PICTURE_FRAME)).toBe(true);
    expect(isPreviewItem({ id: "i", kind: "image", src: "s", alt: "a" })).toBe(true);
    // Optional fields tolerate null as well as undefined — Firestore
    // round-trips produce nulls, the same leniency every optional field here
    // is given.
    expect(isPreviewItem({ ...PICTURE_FRAME, poster: null, trimIn: null })).toBe(true);
  });

  it("REFUSES an audio frame", () => {
    // The whole reason this module exists. Audio has a `src`, so every check
    // except the kind passes — which is how one reached storage and stayed
    // there.
    expect(isPreviewItem(AUDIO_FRAME)).toBe(false);
  });

  it.each([
    ["a missing id", { ...PICTURE_FRAME, id: undefined }],
    ["a non-string src", { ...PICTURE_FRAME, src: 42 }],
    ["a missing alt", { ...PICTURE_FRAME, alt: undefined }],
    ["a non-string poster", { ...PICTURE_FRAME, poster: 7 }],
    ["a negative trimIn", { ...PICTURE_FRAME, trimIn: -1 }],
    ["a NaN trimIn", { ...PICTURE_FRAME, trimIn: Number.NaN }],
    ["an unknown kind", { ...PICTURE_FRAME, kind: "collection" }],
    ["null", null],
    ["a string", "video"],
  ])("refuses %s", (_name, value) => {
    expect(isPreviewItem(value)).toBe(false);
  });

  it("does NOT require id, src or alt to be non-empty", () => {
    // Deliberately as lenient as the gate was before this module existed.
    // Tightening it would start refusing documents that save fine today, which
    // is a separate decision from the one made here.
    expect(isPreviewItem({ id: "", kind: "image", src: "", alt: "" })).toBe(true);
  });
});

describe("previewItemsOf", () => {
  it("drops the unpaintable frame and keeps the rest, in order", () => {
    const kept = previewItemsOf([PICTURE_FRAME, AUDIO_FRAME, { ...PICTURE_FRAME, id: "b" }]);
    expect(kept?.map((item) => item.id)).toEqual(["video-ms3r9bxk5v9z47", "b"]);
  });

  it("returns the ORIGINAL array when nothing is dropped", () => {
    // The common path must not allocate or change identity.
    const stored = [PICTURE_FRAME];
    expect(previewItemsOf(stored)).toBe(stored);
  });

  it("keeps EMPTY and ABSENT apart", () => {
    // `resolveCollectionPreviews` chooses with `stored ?? live`, so collapsing
    // [] to undefined would change which one wins for a collection that
    // genuinely stores no frames.
    expect(previewItemsOf([])).toEqual([]);
    expect(previewItemsOf(undefined)).toBeUndefined();
    expect(previewItemsOf(null)).toBeUndefined();
  });

  it("returns an EMPTY list when every frame is unpaintable", () => {
    // Still a stored answer, and the honest one: an audio-only collection has
    // no frame, so its card goes blank rather than painting a .flac as an
    // <img> — which is what it did before.
    expect(previewItemsOf([AUDIO_FRAME])).toEqual([]);
  });

  it("treats a non-list as absent", () => {
    expect(previewItemsOf("frames")).toBeUndefined();
    expect(previewItemsOf({ 0: PICTURE_FRAME })).toBeUndefined();
  });
});

describe("the write gate and the normalizer agree", () => {
  const documentWith = (previewItems: unknown) => ({
    id: "trash-LIdEO2P4EwWsn0ux1WmRAOvTDXu2",
    title: "Trash Bin",
    clips: [
      {
        id: "timeline-msrk3310t3k7n7",
        index: 0,
        kind: "collection",
        title: "Audio collection",
        childTimelineId: "timeline-msrk3310t3k7n7",
        itemCount: 2,
        alt: "Audio collection",
        aspect: 16 / 9,
        trackIndex: 0,
        startTime: 0,
        duration: 4,
        sourceDuration: 4,
        trimIn: 0,
        trimOut: 0,
        previewItems,
      },
    ],
  });

  it("refuses the document the app could not save", () => {
    // The 400 the batch endpoint returned, reproduced. Every delete rewrites
    // the trash bin, so this one clip made deleting anything impossible.
    expect(isStoredTimelineDocument(documentWith([AUDIO_FRAME]))).toBe(false);
  });

  it("accepts the same document once the normalizer has been through it", () => {
    // The pair that matters: what the gate refuses, `previewItemsOf` removes —
    // so a write can heal the document instead of failing on it forever.
    expect(isStoredTimelineDocument(documentWith(previewItemsOf([AUDIO_FRAME])))).toBe(true);
  });
});
