import { describe, expect, it } from "vitest";

import { CLIP_GAP_SECONDS } from "./constants";
import { resolvePlacement, spansOverlap } from "./placement";
import type { TimelineClip } from "./types";

function clip(
  id: string,
  duration: number,
  over: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: `https://cdn.test/${id}.png`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
    ...over,
  } as TimelineClip;
}

describe("spansOverlap", () => {
  it("is true when they genuinely share time", () => {
    expect(spansOverlap(0, 5, 4, 9)).toBe(true);
    expect(spansOverlap(4, 9, 0, 5)).toBe(true);
    // Fully contained.
    expect(spansOverlap(2, 3, 0, 10)).toBe(true);
  });

  it("is FALSE for spans that merely touch", () => {
    // The ordinary back-to-back case. Counting it would bump every clip that
    // simply follows another.
    expect(spansOverlap(0, 4, 4, 8)).toBe(false);
    expect(spansOverlap(4, 8, 0, 4)).toBe(false);
  });

  it("is false when they are apart", () => {
    expect(spansOverlap(0, 4, 10, 12)).toBe(false);
  });

  it("puts a zero-length span INSIDE another one in collision", () => {
    // Not an edge case worth special-casing away: an instant inside a clip is
    // inside it. What matters is that it does not collide at the edges, which
    // is where a zero-length clip would otherwise trip the back-to-back rule.
    expect(spansOverlap(5, 5, 0, 10)).toBe(true);
    expect(spansOverlap(0, 0, 0, 10)).toBe(false);
    expect(spansOverlap(10, 10, 0, 10)).toBe(false);
  });
});

describe("resolvePlacement", () => {
  it("keeps the requested lane when there is room", () => {
    const clips = [clip("shot", 30), clip("vo", 2, { trackIndex: 1 })];
    expect(resolvePlacement(clips, "vo", 1, 7.5)).toEqual({ lane: 1, bumped: false });
  });

  it("bumps to the next lane when the placement lands on a neighbour", () => {
    // `bed` occupies lane 1 from 0 to 10; placing `vo` at 5 collides.
    const clips = [
      clip("shot", 30),
      clip("bed", 10, { trackIndex: 1 }),
      clip("vo", 2, { trackIndex: 1 }),
    ];
    expect(resolvePlacement(clips, "vo", 1, 5)).toEqual({ lane: 2, bumped: true });
  });

  it("does NOT bump when the placement merely touches a neighbour", () => {
    const clips = [
      clip("shot", 30),
      clip("bed", 10, { trackIndex: 1 }),
      clip("vo", 2, { trackIndex: 1 }),
    ];
    expect(resolvePlacement(clips, "vo", 1, 10)).toEqual({ lane: 1, bumped: false });
  });

  it("escalates past several occupied lanes", () => {
    const clips = [
      clip("shot", 30),
      clip("a", 10, { trackIndex: 1 }),
      clip("b", 10, { trackIndex: 2 }),
      clip("c", 10, { trackIndex: 3 }),
      clip("vo", 2, { trackIndex: 1 }),
    ];
    expect(resolvePlacement(clips, "vo", 1, 5)).toEqual({ lane: 4, bumped: true });
  });

  it("measures against the layout the write would PRODUCE, not the current one", () => {
    // `vo` sits on lane 1 today, queued behind `bed` at 10.12s. Placing it at
    // 5 must be judged against a lane 1 where `vo` is no longer queued behind
    // anything — the queue closes up the moment it moves. Comparing to its
    // present position (10.12) would see no collision and leave it on top of
    // the bed.
    const clips = [
      clip("shot", 30),
      clip("bed", 10, { trackIndex: 1 }),
      clip("vo", 2, { trackIndex: 1 }),
    ];
    expect(clips[2]?.startTime).toBe(0);
    expect(resolvePlacement(clips, "vo", 1, 5).bumped).toBe(true);
  });

  it("never returns the picture, whatever lane was asked for", () => {
    const clips = [clip("shot", 30), clip("vo", 2, { trackIndex: 1 })];
    for (const asked of [0, -3, 0.5, Number.NaN]) {
      expect(resolvePlacement(clips, "vo", asked, 7.5).lane).toBeGreaterThanOrEqual(1);
    }
  });

  it("starts from the lane asked for rather than the lowest free one", () => {
    // Lane 1 is wide open, but the caller asked for 3 — honour it.
    const clips = [clip("shot", 30), clip("vo", 2, { trackIndex: 3 })];
    expect(resolvePlacement(clips, "vo", 3, 7.5)).toEqual({ lane: 3, bumped: false });
  });

  it("ignores clips on OTHER lanes when judging a collision", () => {
    const clips = [
      clip("shot", 30),
      clip("bed", 30, { trackIndex: 2 }),
      clip("vo", 2, { trackIndex: 1 }),
    ];
    expect(resolvePlacement(clips, "vo", 1, 5)).toEqual({ lane: 1, bumped: false });
  });

  it("ignores the PICTURE when judging a collision", () => {
    // The picture runs the whole time; a lane clip is meant to sit under it.
    const clips = [clip("shot", 30), clip("vo", 2, { trackIndex: 1 })];
    expect(resolvePlacement(clips, "vo", 1, 5)).toEqual({ lane: 1, bumped: false });
  });

  it("finds room above a lane whose queued clips fill it", () => {
    const clips = [
      clip("shot", 60),
      clip("q1", 10, { trackIndex: 1 }),
      clip("q2", 10, { trackIndex: 1 }),
      clip("vo", 2, { trackIndex: 1 }),
    ];
    // q1 [0,10], q2 [10.12, 20.12] — placing at 15 collides with q2.
    expect(resolvePlacement(clips, "vo", 1, 15)).toEqual({ lane: 2, bumped: true });
    // The SEAM between them is only CLIP_GAP_SECONDS wide, so a 2s clip does
    // not fit in it — placing at 10 runs to 12, well inside q2.
    expect(CLIP_GAP_SECONDS).toBeLessThan(2);
    expect(resolvePlacement(clips, "vo", 1, 10)).toEqual({ lane: 2, bumped: true });
    // Past the end of the queue there is room, and touching q2's end is fine.
    expect(resolvePlacement(clips, "vo", 1, 20.12)).toEqual({ lane: 1, bumped: false });
  });

  it("returns an unknown id unmoved rather than throwing", () => {
    const clips = [clip("shot", 30)];
    expect(resolvePlacement(clips, "nope", 2, 5)).toEqual({ lane: 2, bumped: false });
  });

  it("places into an empty collection", () => {
    expect(resolvePlacement([clip("vo", 2, { trackIndex: 1 })], "vo", 1, 7.5)).toEqual({
      lane: 1,
      bumped: false,
    });
  });
});
