import { describe, expect, it } from "vitest";

import {
  buildSeamTimeline,
  seamAt,
  seamStripProgress,
  seamSpanFor,
  type SeamClip,
} from "./graph-seam-scrub";

const clip = (id: string, showingSeconds: number): SeamClip => ({ id, showingSeconds });

const LEAD = 2;

describe("buildSeamTimeline", () => {
  it("leads in, plays the whole middle, leads out", () => {
    const timeline = buildSeamTimeline(clip("a", 9), [clip("b", 4)], clip("c", 6), LEAD);
    expect(timeline.totalSeconds).toBe(2 + 4 + 2);
    expect(timeline.centreStart).toBe(2);
    expect(timeline.spans).toEqual([
      // Joined near its END — seven seconds into a nine-second shot.
      { clipId: "a", from: 0, to: 2, sourceOffset: 7 },
      { clipId: "b", from: 2, to: 6, sourceOffset: 0 },
      { clipId: "c", from: 6, to: 8, sourceOffset: 0 },
    ]);
  });

  it("gives EVERY fully visible clip its whole length", () => {
    // THE RULE. Five panels on screen means three whole clips between the two
    // truncated edges, and a clip you can see all of is one you can scrub all
    // of — anything else makes the bar disagree with the picture.
    const timeline = buildSeamTimeline(
      clip("a", 9),
      [clip("b", 4), clip("c", 3), clip("d", 5)],
      clip("e", 6),
      LEAD,
      1,
    );
    expect(timeline.totalSeconds).toBe(2 + 4 + 3 + 5 + 2);
    // The bar rests on the SUBJECT, which here is the middle of the three.
    expect(timeline.centreStart).toBe(2 + 4);
    expect(timeline.spans.map((s) => [s.clipId, s.from, s.to])).toEqual([
      ["a", 0, 2],
      ["b", 2, 6],
      ["c", 6, 9],
      ["d", 9, 14],
      ["e", 14, 16],
    ]);
  });

  it("CLAMPS the leads to what the edge clips actually have", () => {
    // A two-second lead into a half-second clip is half a second. Bar time
    // that cannot be played is worse than a shorter bar.
    const timeline = buildSeamTimeline(clip("a", 0.5), [clip("b", 4)], clip("c", 0.25), LEAD);
    expect(timeline.spans[0]).toEqual({ clipId: "a", from: 0, to: 0.5, sourceOffset: 0 });
    expect(timeline.totalSeconds).toBe(0.5 + 4 + 0.25);
  });

  it("gives a missing edge no bar at all", () => {
    // At the start of a timeline the bar simply begins at the first whole
    // clip, rather than opening with two seconds of nothing to drag through.
    const timeline = buildSeamTimeline(null, [clip("b", 4)], clip("c", 6), LEAD);
    expect(timeline.centreStart).toBe(0);
    expect(timeline.spans[0]!.clipId).toBe("b");
    expect(timeline.totalSeconds).toBe(6);
  });

  it("is empty with nothing whole to play", () => {
    expect(buildSeamTimeline(clip("a", 3), [], clip("c", 3), LEAD).spans).toEqual([]);
    expect(buildSeamTimeline(clip("a", 3), [clip("b", 0)], clip("c", 3), LEAD).spans).toEqual([]);
  });
});

describe("seamAt", () => {
  const timeline = buildSeamTimeline(clip("a", 9), [clip("b", 4)], clip("c", 6), LEAD);

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
    expect(seamAt(buildSeamTimeline(null, [], null, LEAD), 0)).toBeNull();
  });
});

describe("seamStripProgress", () => {
  const timeline = buildSeamTimeline(clip("a", 9), [clip("b", 4)], clip("c", 6), LEAD);

  it("STAYS INSIDE THE TRIMMED WINDOW on the strip", () => {
    // THE BUG THIS PINS. The strip draws the whole 20s source with the showing
    // 4s marked on it as an amber window from 0.25 to 0.45 of its width. The
    // playhead must travel that fifth of the strip and no more; measured
    // against the showing range it swept 0 to 1 — the entire strip, dimmed
    // trimmed-off material included — which looks exactly like being able to
    // scrub past the trim.
    const trimmed: SeamClip = {
      id: "b",
      showingSeconds: 4,
      trimInSeconds: 5,
      fullSeconds: 20,
    };
    expect(seamStripProgress(timeline, trimmed, 2)).toBeCloseTo(5 / 20, 5);
    expect(seamStripProgress(timeline, trimmed, 4)).toBeCloseTo(7 / 20, 5);
    expect(seamStripProgress(timeline, trimmed, 6)).toBeCloseTo(9 / 20, 5);
  });

  it("puts the run-up near its window's RIGHT-HAND end", () => {
    // The run-up covers `a`'s last two showing seconds, so the line belongs at
    // the far end of its window — not at the start of it.
    const previous: SeamClip = { id: "a", showingSeconds: 9, trimInSeconds: 1, fullSeconds: 12 };
    expect(seamStripProgress(timeline, previous, 0)).toBeCloseTo((1 + 7) / 12, 5);
    expect(seamStripProgress(timeline, previous, 2)).toBeCloseTo((1 + 9) / 12, 5);
  });

  it("spans the whole strip only when nothing is trimmed", () => {
    expect(seamStripProgress(timeline, clip("b", 4), 2)).toBe(0);
    expect(seamStripProgress(timeline, clip("b", 4), 4)).toBe(0.5);
    expect(seamStripProgress(timeline, clip("b", 4), 6)).toBe(1);
  });

  it("is NULL outside the clip rather than pinned to an edge", () => {
    expect(seamStripProgress(timeline, clip("c", 6), 3)).toBeNull();
    expect(seamStripProgress(timeline, clip("a", 9), 5)).toBeNull();
  });

  it("is null for a clip the bar does not contain", () => {
    expect(seamStripProgress(timeline, clip("elsewhere", 4), 3)).toBeNull();
  });
});

describe("seamSpanFor", () => {
  it("finds a clip's stretch of bar", () => {
    const timeline = buildSeamTimeline(clip("a", 9), [clip("b", 4)], clip("c", 6), LEAD);
    expect(seamSpanFor(timeline, "b")).toMatchObject({ from: 2, to: 6 });
    expect(seamSpanFor(timeline, "nope")).toBeNull();
  });
});
