import { describe, expect, it } from "vitest";

import type { TimelineClip } from "../types";
import { resolveOverrideMedia } from "./workbench-display-surface";

// PL14-006. `frameOverride` asks the pane to draw a specific SOURCE frame, and
// the only interesting question is how that request finds its media.
//
// It shipped matching on CLIP ID and did nothing in a real project. The pane
// plays one of two models and their ids do not agree:
//
//   projection (focused level) → clip.id IS the graph node id
//   manifest   (compiled, nested) → clip.id is `collectionPath:leafId`,
//                                   because leaf ids repeat across documents
//
// The e2e fixture never lands a manifest, so it exercised the projection alone
// and passed while the feature was dead in the app. These cases are the pair
// the e2e could not be.

const VIDEO_SRC = "https://cdn.test/take-1.mp4";

function videoClip(id: string, src = VIDEO_SRC): TimelineClip {
  return {
    id,
    index: 0,
    kind: "video",
    src,
    poster: `${src}.jpg`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 6,
    sourceDuration: 8,
    trimIn: 0,
    trimOut: 2,
  } as TimelineClip;
}

const request = { src: VIDEO_SRC, sourceTime: 3.5 };

describe("resolveOverrideMedia", () => {
  it("reuses the pane's cache key when the source is on screen (projection ids)", () => {
    const media = resolveOverrideMedia([videoClip("alpha")], request);
    // Byte-identical to what resolveClipMedia builds for that clip, which is
    // what makes this seek the already-cached element instead of loading a
    // second copy of the file.
    expect(media.key).toBe(`alpha:video:${VIDEO_SRC}`);
    expect(media.sourceTime).toBe(3.5);
  });

  it("REGRESSION: resolves against MANIFEST ids, which are path-qualified", () => {
    // The shape that broke it. Matching on id would miss this entirely and the
    // pane would draw nothing — silently, because a miss is indistinguishable
    // from "no override".
    const media = resolveOverrideMedia(
      [videoClip("scene-a/take-1:alpha"), videoClip("scene-b:beta", "https://cdn.test/other.mp4")],
      request,
    );
    expect(media.key).toBe(`scene-a/take-1:alpha:video:${VIDEO_SRC}`);
    expect(media.src).toBe(VIDEO_SRC);
  });

  it("still draws a source the pane is not currently showing", () => {
    // A miss is not a failure: the request carries its own src, so it resolves
    // to a private key rather than returning null. The earlier version treated
    // "no matching clip" as "nothing to draw".
    const media = resolveOverrideMedia([videoClip("unrelated", "https://cdn.test/x.mp4")], request);
    expect(media.key).toBe(`frame-override:video:${VIDEO_SRC}`);
    expect(media.src).toBe(VIDEO_SRC);
  });

  it("does not clamp against the clip's sourceDuration", () => {
    // The manifest SYNTHESIZES sourceDuration per leaf (sourceStart + range),
    // so clamping to it would cut a legitimate frame off a trim. The element's
    // own duration is the real bound and syncActiveVideo already clamps there.
    const media = resolveOverrideMedia([videoClip("alpha")], { src: VIDEO_SRC, sourceTime: 99 });
    expect(media.sourceTime).toBe(99);
  });

  it("floors a negative request at zero", () => {
    const media = resolveOverrideMedia([videoClip("alpha")], { src: VIDEO_SRC, sourceTime: -4 });
    expect(media.sourceTime).toBe(0);
  });

  it("ignores same-src clips of another kind", () => {
    const image = { ...videoClip("img"), kind: "image" } as TimelineClip;
    const media = resolveOverrideMedia([image, videoClip("vid")], request);
    expect(media.key).toBe(`vid:video:${VIDEO_SRC}`);
  });
});
