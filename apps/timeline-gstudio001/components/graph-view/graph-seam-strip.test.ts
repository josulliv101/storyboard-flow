import { describe, expect, it } from "vitest";

import {
  buildSeamStrip,
  segmentFor,
  stripCentreOffset,
  stripPositionAt,
  stripXFor,
  type SeamStripClip,
} from "./graph-seam-strip";

const clips: readonly SeamStripClip[] = [
  { id: "a", showingSeconds: 4 },
  { id: "b", showingSeconds: 2 },
  { id: "c", showingSeconds: 6 },
];

// 10px a second keeps the arithmetic readable: a=0..40, b=40..60, c=60..120.
const PPS = 10;

describe("buildSeamStrip", () => {
  it("lays clips end to end at the given scale", () => {
    const strip = buildSeamStrip(clips, PPS);
    expect(strip.segments.map((s) => [s.leftPx, s.widthPx])).toEqual([
      [0, 40],
      [40, 20],
      [60, 60],
    ]);
    expect(strip.totalPx).toBe(120);
  });

  it("keeps a zero-length clip as a position rather than dropping it", () => {
    // A clip trimmed to nothing is still a clip the row can land on, so the
    // segment list has to stay index-aligned with the caller's id list.
    const strip = buildSeamStrip(
      [{ id: "a", showingSeconds: 4 }, { id: "gone", showingSeconds: 0 }, { id: "c", showingSeconds: 6 }],
      PPS,
    );
    expect(strip.segments.map((s) => s.clipId)).toEqual(["a", "gone", "c"]);
    expect(segmentFor(strip, "gone")).toEqual({ clipId: "gone", leftPx: 40, widthPx: 0 });
  });

  it("is empty for a nonsense scale rather than producing NaN geometry", () => {
    expect(buildSeamStrip(clips, 0).segments).toEqual([]);
    expect(buildSeamStrip(clips, Number.NaN).totalPx).toBe(0);
  });
});

describe("stripCentreOffset", () => {
  it("puts the named clip's middle at the container's middle", () => {
    const strip = buildSeamStrip(clips, PPS);
    // c spans 60..120, middle 90; a 300px container's middle is 150.
    expect(stripCentreOffset(strip, "c", 300)).toBe(60);
    // b spans 40..60, middle 50.
    expect(stripCentreOffset(strip, "b", 300)).toBe(100);
  });

  it("translates RIGHT for an early clip, leaving the truth of empty space", () => {
    // THE CASE THAT MUST NOT BE CLAMPED. The first clip's middle is 20px in,
    // so centring it means pushing the strip right by 130 — there is nothing
    // before it, and clamping to 0 would centre the wrong box over the card.
    const strip = buildSeamStrip(clips, PPS);
    expect(stripCentreOffset(strip, "a", 300)).toBe(130);
  });

  it("does not move for a clip it has never heard of", () => {
    expect(stripCentreOffset(buildSeamStrip(clips, PPS), "nope", 300)).toBe(0);
  });
});

describe("stripXFor", () => {
  it("reads a clock position across into strip pixels", () => {
    const strip = buildSeamStrip(clips, PPS);
    expect(stripXFor(strip, "b", 0)).toBe(40);
    expect(stripXFor(strip, "b", 1)).toBe(50);
    expect(stripXFor(strip, "c", 3)).toBe(90);
  });

  it("clamps inside its own segment rather than running into the next clip", () => {
    // The clock and the strip can disagree by a frame at a seam; the playhead
    // must not answer that by drawing itself over the following clip.
    const strip = buildSeamStrip(clips, PPS);
    expect(stripXFor(strip, "b", 99)).toBe(60);
    expect(stripXFor(strip, "b", -5)).toBe(40);
  });

  it("returns null for a clip outside the strip", () => {
    expect(stripXFor(buildSeamStrip(clips, PPS), "nope", 1)).toBeNull();
  });
});

describe("stripPositionAt", () => {
  it("finds the clip under a pixel and how far into it", () => {
    const strip = buildSeamStrip(clips, PPS);
    expect(stripPositionAt(strip, 0)).toEqual({ clipId: "a", secondsIntoClip: 0 });
    expect(stripPositionAt(strip, 45)).toEqual({ clipId: "b", secondsIntoClip: 0.5 });
    expect(stripPositionAt(strip, 119)).toEqual({ clipId: "c", secondsIntoClip: 5.9 });
  });

  it("treats a seam as belonging to the clip that starts there", () => {
    const strip = buildSeamStrip(clips, PPS);
    expect(stripPositionAt(strip, 40)?.clipId).toBe("b");
    expect(stripPositionAt(strip, 60)?.clipId).toBe("c");
  });

  it("lands the far end on the last clip rather than falling through", () => {
    const strip = buildSeamStrip(clips, PPS);
    expect(stripPositionAt(strip, 120)).toEqual({ clipId: "c", secondsIntoClip: 6 });
  });

  it("is null outside the timeline instead of clamping to an end", () => {
    // A press past the end is not a request to jump to the last frame.
    const strip = buildSeamStrip(clips, PPS);
    expect(stripPositionAt(strip, -1)).toBeNull();
    expect(stripPositionAt(strip, 121)).toBeNull();
  });

  it("skips zero-width segments when resolving a pixel", () => {
    const strip = buildSeamStrip(
      [{ id: "a", showingSeconds: 4 }, { id: "gone", showingSeconds: 0 }, { id: "c", showingSeconds: 6 }],
      PPS,
    );
    expect(stripPositionAt(strip, 40)?.clipId).toBe("c");
  });
});
