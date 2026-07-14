import { describe, expect, it } from "vitest";

import { parseNodeId, type ImageMediaNode, type VideoMediaNode } from "../core/graph";
import { resolveMove, resolveTrim, TRIM_QUANTUM_SECONDS } from "./trim-gesture";

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
    // Over-drag the end far past the source: trim-out clamps to full - trim-in.
    const { update, live } = resolveTrim(video({ trimInSeconds: 2 }), "right", -100);
    expect(update).toEqual({ mediaKind: "video", trimOutSeconds: 8 });
    expect(live.effectiveSeconds).toBe(0);
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
