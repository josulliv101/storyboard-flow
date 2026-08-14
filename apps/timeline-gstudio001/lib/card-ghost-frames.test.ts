import { describe, expect, it } from "vitest";

import type { CollectionPreviewFrame } from "@storyboard/timeline-domain";

import {
  OVERVIEW_FRAME_CAP,
  OVERVIEW_FRAME_SIZE,
  ghostPreviewFrames,
  mediaGhostSrc,
  overviewFrameCount,
} from "./card-ghost-frames";

// #281: these were pure all along, just unreachable — the app's vitest cannot
// parse `.tsx`, so nothing in graph-item-content had ever been unit-tested.

const frame = (id: string): CollectionPreviewFrame => ({
  id,
  kind: "image",
  src: `https://example.test/${id}.jpg`,
  alt: id,
});

describe("mediaGhostSrc", () => {
  it("gives an image its own src", () => {
    expect(mediaGhostSrc({ kind: "media", mediaKind: "image", src: "a.jpg" })).toBe("a.jpg");
  });

  it("gives a video its first POSTER, never the movie file", () => {
    // `src` is an mp4; an <img> pointing at it draws a broken tile.
    expect(
      mediaGhostSrc({
        kind: "media",
        mediaKind: "video",
        src: "clip.mp4",
        posterSrcs: ["p0.jpg", "p1.jpg"],
      }),
    ).toBe("p0.jpg");
  });

  it("refuses AUDIO even though it has a src", () => {
    // THE REGRESSION GUARD. Audio has a `src`, so every "does it have a
    // source?" test waves it through — and a .flac in an <img> is a broken
    // ghost. The package's NodeThumbnail shipped exactly this omission.
    expect(mediaGhostSrc({ kind: "media", mediaKind: "audio", src: "take.flac" })).toBeNull();
  });

  it("returns null for a collection, which has no frame of its own", () => {
    expect(mediaGhostSrc({ kind: "collection" })).toBeNull();
  });

  it("returns null for a poster-less video rather than falling back to src", () => {
    expect(mediaGhostSrc({ kind: "media", mediaKind: "video", src: "clip.mp4" })).toBeNull();
  });
});

describe("ghostPreviewFrames", () => {
  it("takes FIRST and LAST, not first/middle/last", () => {
    const all = ["a", "b", "c", "d"].map(frame);
    expect(ghostPreviewFrames(all).map((f) => f.id)).toEqual(["a", "d"]);
  });

  it("passes a single frame through untouched", () => {
    expect(ghostPreviewFrames([frame("only")]).map((f) => f.id)).toEqual(["only"]);
  });

  it("is empty for no frames, so the ghost falls back to its labelled tile", () => {
    expect(ghostPreviewFrames([])).toEqual([]);
  });

  it("returns two frames for exactly two, not a duplicate of one", () => {
    expect(ghostPreviewFrames([frame("a"), frame("b")]).map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("overviewFrameCount", () => {
  it("ceils so the row fills its strip", () => {
    // 100 / 44 = 2.27 — three frames, with the container clipping the overflow.
    expect(overviewFrameCount(100)).toBe(3);
  });

  it("is exact on a whole multiple", () => {
    expect(overviewFrameCount(OVERVIEW_FRAME_SIZE * 4)).toBe(4);
  });

  it("caps a long source", () => {
    expect(overviewFrameCount(100_000)).toBe(OVERVIEW_FRAME_CAP);
  });

  it("never drops below one — a zero-frame band reads as a failed load", () => {
    expect(overviewFrameCount(0)).toBe(1);
    expect(overviewFrameCount(-50)).toBe(1);
  });

  it("survives an unmeasured width instead of returning NaN frames", () => {
    // A pre-layout read can hand this NaN; `Array.from({length: NaN})` would
    // silently render nothing.
    expect(overviewFrameCount(Number.NaN)).toBe(1);
  });
});
