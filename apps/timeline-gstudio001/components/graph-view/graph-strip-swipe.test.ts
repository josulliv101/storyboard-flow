import { describe, expect, it } from "vitest";

import { swipeIntent, swipeOffset, type SwipeReading } from "./graph-strip-swipe";

const drag = (over: Partial<SwipeReading> = {}): SwipeReading => ({
  dx: 0,
  dy: 0,
  elapsedMs: 300,
  panelWidth: 600,
  hasPrevious: true,
  hasNext: true,
  ...over,
});

describe("swipeIntent", () => {
  it("pulls the strip the way the hand moves", () => {
    // Dragged left, so the next clip arrives from the right.
    expect(swipeIntent(drag({ dx: -140 }))).toBe("next");
    expect(swipeIntent(drag({ dx: 140 }))).toBe("previous");
  });

  it("ignores a tap or a tremor", () => {
    expect(swipeIntent(drag({ dx: -6 }))).toBeNull();
    expect(swipeIntent(drag({ dx: 0 }))).toBeNull();
  });

  it("IGNORES A MOSTLY-VERTICAL DRAG however far sideways it went", () => {
    // A thumb travelling down a phone screen covers real horizontal distance
    // on the way. Without this, every scroll starting on a picture flings the
    // strip to another clip.
    expect(swipeIntent(drag({ dx: -200, dy: 260 }))).toBeNull();
    expect(swipeIntent(drag({ dx: -200, dy: -260 }))).toBeNull();
    // Same travel, shallower angle: a swipe.
    expect(swipeIntent(drag({ dx: -200, dy: 90 }))).toBe("next");
  });

  it("takes a FLICK that never travelled far", () => {
    // 40px in 40ms — nowhere near the distance rule, and unmistakably a swipe.
    // Requiring distance AND speed would ignore the gesture people make most.
    expect(swipeIntent(drag({ dx: -40, elapsedMs: 40 }))).toBe("next");
    // The same 40px taken slowly is someone nudging, not swiping.
    expect(swipeIntent(drag({ dx: -40, elapsedMs: 600 }))).toBeNull();
  });

  it("scales the distance rule to the panel, with a floor", () => {
    // A fifth of a wide panel is a long way; the same push on a phone commits.
    expect(swipeIntent(drag({ dx: -80, elapsedMs: 600, panelWidth: 1200 }))).toBeNull();
    expect(swipeIntent(drag({ dx: -80, elapsedMs: 600, panelWidth: 320 }))).toBe("next");
  });

  it("is null when there is nothing that way", () => {
    expect(swipeIntent(drag({ dx: -140, hasNext: false }))).toBeNull();
    expect(swipeIntent(drag({ dx: 140, hasPrevious: false }))).toBeNull();
    // …and unaffected in the direction that does exist.
    expect(swipeIntent(drag({ dx: 140, hasNext: false }))).toBe("previous");
  });
});

describe("swipeOffset", () => {
  it("follows the hand in the middle of the timeline", () => {
    expect(swipeOffset(-120, true, true)).toBe(-120);
    expect(swipeOffset(120, true, true)).toBe(120);
  });

  it("RESISTS rather than refuses at the ends", () => {
    // A strip that will not budge reads as a dropped gesture; a third of the
    // travel says "there is nothing there" while still answering the hand.
    expect(swipeOffset(-120, true, false)).toBe(-40);
    expect(swipeOffset(120, false, true)).toBe(40);
  });
});
