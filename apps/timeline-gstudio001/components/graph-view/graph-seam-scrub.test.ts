import { describe, expect, it } from "vitest";

import {
  buildSeamTimeline,
  seamAt,
  seamProgressWithin,
  seamSpanFor,
  type SeamClip,
} from "./graph-seam-scrub";

const clip = (id: string, showingSeconds: number): SeamClip => ({ id, showingSeconds });

const LEAD = 2;

describe("buildSeamTimeline", () => {
  it("runs up through the previous clip, across the centre, and out into the next", () => {
    const timeline = buildSeamTimeline(clip("a", 9), clip("b", 4), clip("c", 6), LEAD);
    expect(timeline.totalSeconds).toBe(2 + 4 + 2);
    expect(timeline.centreStart).toBe(2);
    expect(timeline.spans).toEqual([
      // Joined near its END — seven seconds into a nine-second shot.
      { clipId: "a", from: 0, to: 2, sourceOffset: 7 },
      { clipId: "b", from: 2, to: 6, sourceOffset: 0 },
      { clipId: "c", from: 6, to: 8, sourceOffset: 0 },
    ]);
  });

  it("CLAMPS the run-up to what the neighbour actually has", () => {
    // A two-second lead into a half-second clip is half a second. Bar time that
    // cannot be played is worse than a shorter bar.
    const timeline = buildSeamTimeline(clip("a", 0.5), clip("b", 4), clip("c", 0.25), LEAD);
    expect(timeline.spans[0]).toEqual({ clipId: "a", from: 0, to: 0.5, sourceOffset: 0 });
    expect(timeline.totalSeconds).toBe(0.5 + 4 + 0.25);
  });

  it("gives a missing neighbour no bar at all", () => {
    // At the start of a timeline the bar simply begins at the centre clip,
    // rather than opening with two seconds of nothing to drag through.
    const timeline = buildSeamTimeline(null, clip("b", 4), clip("c", 6), LEAD);
    expect(timeline.centreStart).toBe(0);
    expect(timeline.spans[0]!.clipId).toBe("b");
    expect(timeline.totalSeconds).toBe(6);
  });

  it("is empty without a centre clip", () => {
    expect(buildSeamTimeline(clip("a", 3), null, clip("c", 3), LEAD).spans).toEqual([]);
  });
});

describe("seamAt", () => {
  const timeline = buildSeamTimeline(clip("a", 9), clip("b", 4), clip("c", 6), LEAD);

  it("reads the run-up as the END of the previous clip", () => {
    // 0.5s into the bar is 7.5s into `a`, not 0.5s into it. Getting this wrong
    // plays the wrong part of the shot and still looks plausible.
    expect(seamAt(timeline, 0.5)).toEqual({ clipId: "a", clipSeconds: 7.5 });
  });

  it("gives a seam to the clip that STARTS there", () => {
    // Landing exactly on the cut shows the incoming clip's first frame, which
    // is what someone dragging to a cut is looking for. The other rule makes
    // every cut appear one frame late.
    expect(seamAt(timeline, 2)).toEqual({ clipId: "b", clipSeconds: 0 });
    expect(seamAt(timeline, 6)).toEqual({ clipId: "c", clipSeconds: 0 });
  });

  it("reads a time inside the centre clip", () => {
    expect(seamAt(timeline, 4.25)).toEqual({ clipId: "b", clipSeconds: 2.25 });
  });

  it("clamps past either end rather than returning nothing", () => {
    expect(seamAt(timeline, -5)?.clipId).toBe("a");
    const end = seamAt(timeline, 999);
    // The final moment of the last clip's span — there is no next span to hand
    // the very end to.
    expect(end).toEqual({ clipId: "c", clipSeconds: 2 });
  });

  it("is null for an empty timeline", () => {
    expect(seamAt(buildSeamTimeline(null, null, null, LEAD), 0)).toBeNull();
  });
});

describe("seamProgressWithin", () => {
  const timeline = buildSeamTimeline(clip("a", 9), clip("b", 4), clip("c", 6), LEAD);

  it("measures against the clip's WHOLE showing range, not the span", () => {
    // The line is drawn on a trim strip showing all nine seconds of `a`, so a
    // run-up covering its last two must put the line near the right-hand end.
    // Against the span it would read 0 and claim the shot was starting.
    expect(seamProgressWithin(timeline, clip("a", 9), 0)).toBeCloseTo(7 / 9, 5);
    expect(seamProgressWithin(timeline, clip("a", 9), 2)).toBeCloseTo(1, 5);
  });

  it("runs 0 to 1 across the centre clip", () => {
    expect(seamProgressWithin(timeline, clip("b", 4), 2)).toBe(0);
    expect(seamProgressWithin(timeline, clip("b", 4), 4)).toBe(0.5);
    expect(seamProgressWithin(timeline, clip("b", 4), 6)).toBe(1);
  });

  it("is NULL outside the clip rather than pinned to an edge", () => {
    // A line parked at a clip's start reads as "playing here, at the very
    // beginning", which is a different claim from "not playing here".
    expect(seamProgressWithin(timeline, clip("c", 6), 3)).toBeNull();
    expect(seamProgressWithin(timeline, clip("a", 9), 5)).toBeNull();
  });

  it("is null for a clip the bar does not contain", () => {
    expect(seamProgressWithin(timeline, clip("elsewhere", 4), 3)).toBeNull();
  });
});

describe("seamSpanFor", () => {
  it("finds a clip's stretch of bar", () => {
    const timeline = buildSeamTimeline(clip("a", 9), clip("b", 4), clip("c", 6), LEAD);
    expect(seamSpanFor(timeline, "b")).toMatchObject({ from: 2, to: 6 });
    expect(seamSpanFor(timeline, "nope")).toBeNull();
  });
});
