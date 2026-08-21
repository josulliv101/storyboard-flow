import { describe, expect, it } from "vitest";

import { buildSeamStrip } from "./graph-seam-strip";
import {
  clampPixelsPerSecond,
  collectionSeams,
  fitPixelsPerSecond,
  offsetAfterZoom,
  PPS_MAX,
  PPS_MIN,
  seamRulerTicks,
  snapToCut,
  tickStepSeconds,
  zoomByWheel,
  type SeamBarClip,
} from "./graph-seam-bar-layout";

const clip = (
  id: string,
  showingSeconds: number,
  collectionId: string,
  collectionName: string,
): SeamBarClip => ({ id, name: id.toUpperCase(), showingSeconds, collectionId, collectionName });

// Two collections, four clips: a=0..40, b=40..60 | c=60..120, d=120..140.
const CLIPS: readonly SeamBarClip[] = [
  clip("a", 4, "kitchen", "Kitchen"),
  clip("b", 2, "kitchen", "Kitchen"),
  clip("c", 6, "van", "Van Interior"),
  clip("d", 2, "van", "Van Interior"),
];
const PPS = 10;
const STRIP = buildSeamStrip(CLIPS, PPS);

describe("clampPixelsPerSecond", () => {
  it("holds the zoom inside its range", () => {
    expect(clampPixelsPerSecond(0.1)).toBe(PPS_MIN);
    expect(clampPixelsPerSecond(1000)).toBe(PPS_MAX);
    expect(clampPixelsPerSecond(12)).toBe(12);
  });

  it("answers the floor for a nonsense scale rather than passing NaN on", () => {
    expect(clampPixelsPerSecond(Number.NaN)).toBe(PPS_MIN);
  });
});

describe("zoomByWheel", () => {
  it("zooms in on a wheel-up and out on a wheel-down", () => {
    expect(zoomByWheel(10, -100)).toBeGreaterThan(10);
    expect(zoomByWheel(10, 100)).toBeLessThan(10);
  });

  it("is a RATIO, so a notch feels the same at either end of the range", () => {
    // The thing a linear step gets wrong: +2px a second is a doubling down at
    // the floor and a rounding error up at the ceiling.
    const low = zoomByWheel(4, -100) / 4;
    const high = zoomByWheel(20, -100) / 20;
    expect(Math.abs(low - high)).toBeLessThan(0.001);
  });

  it("cannot be wheeled past either limit", () => {
    expect(zoomByWheel(PPS_MAX, -5000)).toBe(PPS_MAX);
    expect(zoomByWheel(PPS_MIN, 5000)).toBe(PPS_MIN);
  });
});

describe("fitPixelsPerSecond", () => {
  it("lays the footage across MORE than one trackful", () => {
    // 60s into an 600px track at 1.65 overflow is 16.5px a second — so the
    // bar opens showing about three fifths of it, and the rest is off the
    // sides where the eye can be told it exists.
    expect(fitPixelsPerSecond(60, 600)).toBeCloseTo(16.5, 5);
  });

  it("clamps rather than proposing an unusable scale", () => {
    expect(fitPixelsPerSecond(0.01, 600)).toBe(PPS_MAX);
    expect(fitPixelsPerSecond(100_000, 600)).toBe(PPS_MIN);
  });

  it("falls back for a track that has not been measured yet", () => {
    expect(fitPixelsPerSecond(60, 0)).toBe(9);
  });
});

describe("collectionSeams", () => {
  it("names the first clip of every collection, the first one included", () => {
    expect(collectionSeams(CLIPS)).toEqual([0, 2]);
  });

  it("is one seam for one collection", () => {
    expect(collectionSeams(CLIPS.slice(0, 2))).toEqual([0]);
  });

  it("re-seams a collection the order returns to", () => {
    // The row walks playback order, which may leave a collection and come
    // back; the second run is a second landmark, not a duplicate to drop.
    const wandering = [CLIPS[0]!, CLIPS[2]!, CLIPS[1]!];
    expect(collectionSeams(wandering)).toEqual([0, 1, 2]);
  });

  it("is empty for no clips", () => {
    expect(collectionSeams([])).toEqual([]);
  });
});

describe("snapToCut", () => {
  it("pulls onto a nearby cut", () => {
    expect(snapToCut(STRIP, 43)).toBe(40);
    expect(snapToCut(STRIP, 57)).toBe(60);
  });

  it("leaves a press in the middle of a clip alone", () => {
    expect(snapToCut(STRIP, 20)).toBe(20);
  });

  it("snaps to the far end of the timeline as well as to interior cuts", () => {
    expect(snapToCut(STRIP, 137)).toBe(140);
  });

  it("takes the NEARER of two cuts inside tolerance", () => {
    const tight = buildSeamStrip(
      [clip("a", 0.4, "k", "K"), clip("b", 0.4, "k", "K"), clip("c", 4, "k", "K")],
      10,
    );
    // Cuts at 0, 4 and 8. From 5 the nearer is 4, not 8.
    expect(snapToCut(tight, 5, 7)).toBe(4);
  });

  it("measures in PIXELS, so the same tolerance survives a zoom", () => {
    // 3px from a cut is inside tolerance at both scales, even though at 40px
    // a second that is a tenth of the seconds it is at 4.
    const wide = buildSeamStrip(CLIPS, 40);
    const narrow = buildSeamStrip(CLIPS, 4);
    expect(snapToCut(wide, 40 * 4 + 3)).toBe(160);
    expect(snapToCut(narrow, 4 * 4 + 3)).toBe(16);
  });
});

describe("offsetAfterZoom", () => {
  it("keeps the time under the cursor under the cursor", () => {
    // Cursor 300px into the track, strip pushed 100px left: the cursor is on
    // strip x 400, which at 10px a second is 40s. At 20 that second is at 800,
    // so the strip has to sit at 300 - 800 = -500 for it not to move.
    expect(offsetAfterZoom({ anchorLocalX: 300, offset: -100, from: 10, to: 20 })).toBe(-500);
  });

  it("is a no-op when the scale does not change", () => {
    expect(offsetAfterZoom({ anchorLocalX: 300, offset: -100, from: 10, to: 10 })).toBe(-100);
  });

  it("refuses to divide by a scale of zero", () => {
    expect(offsetAfterZoom({ anchorLocalX: 300, offset: -100, from: 0, to: 20 })).toBe(-100);
  });
});

describe("tickStepSeconds", () => {
  it("climbs the ladder as the bar is pulled back", () => {
    // 46px minimum spacing: at 50px a second a 1s step already clears it; at
    // 2.5 nothing under 30s does.
    expect(tickStepSeconds(50)).toBe(1);
    expect(tickStepSeconds(10)).toBe(5);
    expect(tickStepSeconds(2.5)).toBe(30);
  });

  it("answers its coarsest step rather than dividing by nothing", () => {
    expect(tickStepSeconds(0)).toBe(300);
  });
});

describe("seamRulerTicks", () => {
  it("labels each collection where it starts", () => {
    const collections = seamRulerTicks({ strip: STRIP, clips: CLIPS }).filter(
      (tick) => tick.kind === "collection",
    );
    expect(collections).toEqual([
      { x: 0, label: "Kitchen", kind: "collection" },
      { x: 60, label: "Van Interior", kind: "collection" },
    ]);
  });

  it("clears the whole WIDTH of a collection label, not just its mark", () => {
    // The label is left-aligned on its tick, so it reaches to the RIGHT — and
    // a clash zone measured around the mark alone let the next time tick print
    // straight through the end of the word. Forty seconds at 10px a second:
    // the 5s ladder wants a tick every 50px, "Van Interior" starts at x=200
    // and reaches about 75px past it, so the two ticks inside that reach give
    // way and the one beyond it does not.
    const clips: readonly SeamBarClip[] = [
      clip("a", 20, "kitchen", "Kitchen"),
      clip("b", 20, "van", "Van Interior"),
    ];
    const times = seamRulerTicks({ strip: buildSeamStrip(clips, 10), clips })
      .filter((tick) => tick.kind === "time")
      .map((tick) => tick.x);
    expect(times).not.toContain(200);
    expect(times).not.toContain(250);
    expect(times).toContain(300);
  });

  it("gives way to a collection tick on its own mark as well", () => {
    const times = seamRulerTicks({ strip: STRIP, clips: CLIPS })
      .filter((tick) => tick.kind === "time")
      .map((tick) => tick.x);
    // 60 is the seam itself; 50 is inside the mark's own clash zone.
    expect(times).not.toContain(60);
    expect(times).not.toContain(50);
  });

  it("never runs a tick past the end of the strip", () => {
    const xs = seamRulerTicks({ strip: STRIP, clips: CLIPS }).map((tick) => tick.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(STRIP.totalPx);
  });

  it("is empty for an empty strip rather than looping forever", () => {
    expect(seamRulerTicks({ strip: buildSeamStrip([], 10), clips: [] })).toEqual([]);
  });

  it("skips a collection with no name instead of labelling it blank", () => {
    const unnamed: readonly SeamBarClip[] = [
      { id: "a", name: "A", showingSeconds: 4, collectionId: "x", collectionName: null },
    ];
    expect(
      seamRulerTicks({ strip: buildSeamStrip(unnamed, 10), clips: unnamed }).filter(
        (tick) => tick.kind === "collection",
      ),
    ).toEqual([]);
  });
});
