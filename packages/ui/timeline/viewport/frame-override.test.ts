import { describe, expect, it } from "vitest";

import type { TimelineClip } from "../types";
import {
  OVERRIDE_SEEK_EPSILON_SECONDS,
  overrideSeekStep,
  resolveOverrideMedia,
} from "./workbench-display-surface";

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

/**
 * PL15-030. The override's seek loop runs once per animation frame and decides
 * two things: ask the element for a new frame, and paint.
 *
 * It shipped painting ONLY when the full-size element had finished seeking, so
 * the picture changed at the rate seeks completed rather than the rate the hand
 * moved — measured in the app, 7.7 paints a second against a playhead moving 13
 * times a second, reported as scrubbing feeling laggy with the preview open.
 * The scrub proxy was already chasing the target and the draw already prefers
 * it mid-seek; nothing was asking it to paint. Measured after: 41.1 a second.
 */
describe("overrideSeekStep", () => {
  it("PAINTS WHILE THE ELEMENT IS STILL SEEKING, and does not pile on a second seek", () => {
    // The long-seek case, and the one the lag was made of: a cold seek can take
    // the better part of a second, and every frame of it used to draw nothing.
    expect(overrideSeekStep({ seeking: true, currentTime: 0.5 }, 9)).toEqual({
      issueSeek: false,
      draw: true,
    });
  });

  it("asks for the frame AND paints when the element is idle and out of position", () => {
    expect(overrideSeekStep({ seeking: false, currentTime: 0.5 }, 9)).toEqual({
      issueSeek: true,
      draw: true,
    });
  });

  it("paints without re-asking once it has arrived", () => {
    expect(overrideSeekStep({ seeking: false, currentTime: 9 }, 9)).toEqual({
      issueSeek: false,
      draw: true,
    });
  });

  it("treats a hair off as arrived, because `currentTime` reads back as the target", () => {
    const closeEnough = 9 + OVERRIDE_SEEK_EPSILON_SECONDS / 2;
    expect(overrideSeekStep({ seeking: false, currentTime: closeEnough }, 9).issueSeek).toBe(false);
    const tooFar = 9 + OVERRIDE_SEEK_EPSILON_SECONDS * 2;
    expect(overrideSeekStep({ seeking: false, currentTime: tooFar }, 9).issueSeek).toBe(true);
  });

  it("DRAWS IN EVERY CASE — the invariant an early return would break", () => {
    const cases = [
      { seeking: true, currentTime: 0 },
      { seeking: true, currentTime: 9 },
      { seeking: false, currentTime: 0 },
      { seeking: false, currentTime: 9 },
    ];
    for (const video of cases) {
      expect(overrideSeekStep(video, 9).draw).toBe(true);
    }
  });
});
