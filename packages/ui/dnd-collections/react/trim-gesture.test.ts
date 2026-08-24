import { describe, expect, it } from "vitest";

import {
  parseNodeId,
  type AudioMediaNode,
  type ImageMediaNode,
  type VideoMediaNode,
} from "../core/graph";
import {
  MIN_TRIM_WINDOW_SECONDS,
  resolveMove,
  resolveTrim,
  TRIM_QUANTUM_SECONDS,
} from "./trim-gesture";

// Pure-resolver coverage for the pointer trim gesture: quantization to the
// 0.1s grid and the reducer-shared clamps. The pointer lifecycle
// (useTrimPointerDrag) is a hook exercised by the stories; the math lives here.

const video = (over: Partial<VideoMediaNode> = {}): VideoMediaNode => ({
  id: parseNodeId("v"),
  kind: "media",
  mediaKind: "video",
  name: "V",
  fullDurationSeconds: 10,
  trimInSeconds: 2,
  trimOutSeconds: 1,
  ...over,
});

const image = (over: Partial<ImageMediaNode> = {}): ImageMediaNode => ({
  id: parseNodeId("i"),
  kind: "media",
  mediaKind: "image",
  name: "I",
  durationSeconds: 4,
  ...over,
});

const audio = (over: Partial<AudioMediaNode> = {}): AudioMediaNode => ({
  id: parseNodeId("a"),
  kind: "media",
  mediaKind: "audio",
  name: "A",
  fullDurationSeconds: 10,
  trimInSeconds: 2,
  trimOutSeconds: 1,
  ...over,
});

// AUDIO IS TRIMMED LIKE VIDEO. It always could be — the node is windowed and
// the reducer accepted the update — but the gesture deliberately resolved to
// the node's CURRENT window so the drag was inert, and nothing tested that.
// These pin the behaviour that replaced it.
describe("resolveTrim on audio", () => {
  it("trims the START, which it previously could not", () => {
    const { update, live } = resolveTrim(audio(), "left", 1);
    expect(update).toEqual({ mediaKind: "audio", trimInSeconds: 3 });
    expect(live.effectiveSeconds).toBeCloseTo(6, 6);
  });

  it("trims the END", () => {
    const { update } = resolveTrim(audio(), "right", -1);
    expect(update).toEqual({ mediaKind: "audio", trimOutSeconds: 2 });
  });

  it("carries the AUDIO discriminant, never video", () => {
    // `applyMediaUpdate` rejects an update whose kind does not match the node,
    // so a copy-pasted "video" literal here would be an invalid-media-update
    // at dispatch rather than a type error.
    for (const side of ["left", "right"] as const) {
      expect(resolveTrim(audio(), side, 0.5).update.mediaKind).toBe("audio");
    }
  });

  it("quantizes and clamps exactly as video does", () => {
    expect(resolveTrim(audio(), "left", 0.04).update).toEqual({
      mediaKind: "audio",
      trimInSeconds: 2,
    });
    // Past the far end lands ON the limit rather than through it. The limit is
    // `full - trimOut - MIN_TRIM_WINDOW_SECONDS` now, not `full - trimOut`:
    // landing exactly on the far edge left a window of zero (PL15-015).
    expect(resolveTrim(audio(), "left", 99).update).toEqual({
      mediaKind: "audio",
      trimInSeconds: 8.9,
    });
  });

  it("agrees with video, given the same window", () => {
    // The two share one branch now; this is the guard against them being
    // split again and drifting.
    for (const side of ["left", "right"] as const) {
      for (const delta of [0.3, -0.7, 4, -4]) {
        const a = resolveTrim(audio(), side, delta);
        const v = resolveTrim(video(), side, delta);
        expect(a.live.effectiveSeconds).toBeCloseTo(v.live.effectiveSeconds, 6);
      }
    }
  });
});

describe("resolveTrim quantization", () => {
  it("snaps a continuous video trim-in delta to the 0.1s grid", () => {
    // A messy pixel-derived delta (e.g. 37px / 24pps) must not persist raw.
    const { update, live } = resolveTrim(video(), "left", 1.5416666666666665);
    expect(update).toEqual({ mediaKind: "video", trimInSeconds: 3.5 });
    // Effective is derived from the snapped value, so preview == commit.
    expect(live.trimInSeconds).toBe(3.5);
    expect(live.effectiveSeconds).toBe(10 - 3.5 - 1);
  });

  it("snaps a video trim-out (right handle) delta", () => {
    // Right edge inward (negative delta) trims more off the end.
    const { update } = resolveTrim(video({ trimOutSeconds: 1 }), "right", -0.9666);
    expect(update).toEqual({ mediaKind: "video", trimOutSeconds: 2 }); // 1 - (-0.9666) -> 1.9666 -> 2.0
  });

  it("snaps an image duration delta", () => {
    const { update } = resolveTrim(image({ durationSeconds: 4 }), "right", 1.2333);
    expect(update).toEqual({ mediaKind: "image", durationSeconds: 5.2 });
  });

  it("rounds a sub-half-quantum nudge to no change (reducer then rejects same-position)", () => {
    const { update } = resolveTrim(video({ trimInSeconds: 2 }), "left", 0.04);
    expect(update).toEqual({ mediaKind: "video", trimInSeconds: 2 });
  });

  it("still clamps at the physical limit after snapping", () => {
    // Over-drag the end far past the source. This used to clamp to
    // `full - trimIn` and leave `effectiveSeconds` at ZERO — the edge could be
    // dragged through the middle of the clip and out the far side, swallowing
    // it (PL15-015). The ceiling keeps a minimum window back now.
    const { update, live } = resolveTrim(video({ trimInSeconds: 2 }), "right", -100);
    expect(update).toEqual({ mediaKind: "video", trimOutSeconds: 7.9 });
    // `toBeCloseTo`: the COMMITTED value is on the grid (the ceiling is
    // quantized), but `effectiveSeconds` is `full - in - out` computed live,
    // and 10 - 2 - 7.9 is 0.09999999999999964. Grid-cleanliness is a property
    // of what is stored, not of a subtraction done for the preview.
    expect(live.effectiveSeconds).toBeCloseTo(MIN_TRIM_WINDOW_SECONDS, 6);
  });

  it("does not leave float dust on the grid", () => {
    const { update } = resolveTrim(image({ durationSeconds: 0 }), "right", 0.3);
    // 0.30000000000000004 would fail a strict equality on 0.3.
    expect((update as { durationSeconds: number }).durationSeconds).toBe(0.3);
  });
});

describe("resolveMove quantization", () => {
  it("snaps trim-in while holding the showing duration exactly constant", () => {
    // full 10, in 2, out 1.5 -> showing 6.5, room 3.5. Drag right +delta
    // reveals earlier frames (trim-in decreases).
    const node = video({ trimInSeconds: 2, trimOutSeconds: 1.5 });
    const { update, live } = resolveMove(node, 0.966); // in -> ~1.034 -> 1.0
    expect(update).toEqual({ mediaKind: "video", trimInSeconds: 1, trimOutSeconds: 2.5 });
    expect(live.effectiveSeconds).toBe(6.5); // showing unchanged — the move invariant
  });
});

describe("TRIM_QUANTUM_SECONDS", () => {
  it("is the 0.1s grid the display path also rounds to", () => {
    expect(TRIM_QUANTUM_SECONDS).toBe(0.1);
  });
});

// A TRIM MAY NOT SWALLOW ITS CLIP (PL15-015). Each edge used to be clamped
// only against the other, which forbids CROSSING and permits MEETING — so a
// drag could leave a window of zero and the clip would still be there,
// occupying no time and impossible to grab back.
describe("the minimum trim window", () => {
  it("stops the LEFT edge short of the right one", () => {
    const { update, live } = resolveTrim(video({ trimInSeconds: 0, trimOutSeconds: 1 }), "left", 100);
    // 10 full, 1 trimmed off the end, so the left edge stops a quarter second
    // before what is left of the source rather than at it.
    expect(update).toEqual({ mediaKind: "video", trimInSeconds: 8.9 });
    // `toBeCloseTo`: the COMMITTED value is on the grid (the ceiling is
    // quantized), but `effectiveSeconds` is `full - in - out` computed live,
    // and 10 - 2 - 7.9 is 0.09999999999999964. Grid-cleanliness is a property
    // of what is stored, not of a subtraction done for the preview.
    expect(live.effectiveSeconds).toBeCloseTo(MIN_TRIM_WINDOW_SECONDS, 6);
  });

  it("stops the RIGHT edge short of the left one", () => {
    const { update, live } = resolveTrim(video({ trimInSeconds: 3, trimOutSeconds: 0 }), "right", -100);
    expect(update).toEqual({ mediaKind: "video", trimOutSeconds: 6.9 });
    // `toBeCloseTo`: the COMMITTED value is on the grid (the ceiling is
    // quantized), but `effectiveSeconds` is `full - in - out` computed live,
    // and 10 - 2 - 7.9 is 0.09999999999999964. Grid-cleanliness is a property
    // of what is stored, not of a subtraction done for the preview.
    expect(live.effectiveSeconds).toBeCloseTo(MIN_TRIM_WINDOW_SECONDS, 6);
  });

  it("applies to audio, which shares the windowed branch", () => {
    const { live } = resolveTrim(audio({ trimInSeconds: 0, trimOutSeconds: 0 }), "left", 100);
    // `toBeCloseTo`: the COMMITTED value is on the grid (the ceiling is
    // quantized), but `effectiveSeconds` is `full - in - out` computed live,
    // and 10 - 2 - 7.9 is 0.09999999999999964. Grid-cleanliness is a property
    // of what is stored, not of a subtraction done for the preview.
    expect(live.effectiveSeconds).toBeCloseTo(MIN_TRIM_WINDOW_SECONDS, 6);
  });

  it("leaves an ordinary trim untouched", () => {
    // The floor must only bite at the extreme. A one-second pull on a
    // seven-second window is not near it and must resolve exactly.
    const { update } = resolveTrim(video({ trimInSeconds: 2, trimOutSeconds: 1 }), "left", 1);
    expect(update).toEqual({ mediaKind: "video", trimInSeconds: 3 });
  });

  it("does not invert the clamp on a source SHORTER than the minimum", () => {
    // The ceiling is `full - other - minimum`, which goes negative here. Left
    // unguarded that is a max BELOW the min, and `clamp` would pin the edge at
    // the ceiling — dragging the handle backwards. It floors at zero instead,
    // so the edge simply cannot move.
    const { update } = resolveTrim(
      video({ fullDurationSeconds: 0.05, trimInSeconds: 0, trimOutSeconds: 0 }),
      "left",
      100,
    );
    expect(update).toEqual({ mediaKind: "video", trimInSeconds: 0 });
  });
});
