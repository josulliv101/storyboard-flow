import { describe, expect, it } from "vitest";

import { MIN_ITEM_WIDTH } from "./virtual-strip-geometry";
import {
  createLaneTimeMap,
  laneFlatIndex,
  laneItemPlacement,
  laneRowPosition,
  laneRowTop,
  laneStackHeight,
  resolveLaneStripIndex,
  type LaneRowLayout,
} from "./virtual-strip-lanes";

// Three 4s shots at 40px/s, separated by an 8px gutter that absorbs the
// document's 0.12s pack gap — the layout the app actually produces, and the
// one where deriving time from widths drifts.
const SHOTS = [
  { left: 0, width: 160, startSeconds: 0, durationSeconds: 4 },
  { left: 168, width: 160, startSeconds: 4.12, durationSeconds: 4 },
  { left: 336, width: 160, startSeconds: 8.24, durationSeconds: 4 },
];

describe("createLaneTimeMap", () => {
  it("returns 0 for every time when there are no slots", () => {
    const map = createLaneTimeMap([]);
    expect(map.at(0)).toBe(0);
    expect(map.at(12)).toBe(0);
  });

  it("lands exactly on a card's left edge at its start time", () => {
    const map = createLaneTimeMap(SHOTS);
    expect(map.at(0)).toBe(0);
    expect(map.at(4.12)).toBe(168);
    expect(map.at(8.24)).toBe(336);
  });

  it("lands exactly on a card's right edge at its end time", () => {
    const map = createLaneTimeMap(SHOTS);
    expect(map.at(4)).toBe(160);
    expect(map.at(12.24)).toBe(496);
  });

  it("interpolates linearly inside a card", () => {
    const map = createLaneTimeMap(SHOTS);
    expect(map.at(2)).toBe(80);
    expect(map.at(1)).toBe(40);
  });

  it("interpolates across the gutter rather than snapping to the next card", () => {
    const map = createLaneTimeMap(SHOTS);
    // The gutter spans 4s -> 4.12s in time and 160px -> 168px in x.
    expect(map.at(4.06)).toBeCloseTo(164, 6);
  });

  it("clamps before the run to the first left edge", () => {
    const map = createLaneTimeMap(SHOTS);
    expect(map.at(-10)).toBe(0);
    expect(map.at(Number.NaN)).toBe(0);
  });

  it("extrapolates PAST the run at the last card's rate", () => {
    // A lane can outlast the picture — music under a short cut. Clamping here
    // drew a 30s bed as though it ended with the last shot.
    const map = createLaneTimeMap(SHOTS);
    // The last shot runs 4s across 160px, so 40px/s past its end.
    expect(map.at(12.24)).toBe(496);
    expect(map.at(13.24)).toBeCloseTo(536, 6);
    expect(map.at(22.24)).toBeCloseTo(896, 6);
  });

  it("clamps past the run when the last card offers no rate", () => {
    const map = createLaneTimeMap([
      { left: 0, width: 160, startSeconds: 0, durationSeconds: 4 },
      { left: 168, width: 128, startSeconds: 4.12, durationSeconds: 0 },
    ]);
    expect(map.at(99)).toBe(296);
  });

  it("resolves a zero-duration card to its left edge", () => {
    // A collection card the consumer reports no span for: it owns width but no
    // interval, so there is nothing to interpolate across.
    const map = createLaneTimeMap([
      { left: 0, width: 160, startSeconds: 0, durationSeconds: 4 },
      { left: 168, width: 128, startSeconds: 4.12, durationSeconds: 0 },
      { left: 304, width: 160, startSeconds: 4.24, durationSeconds: 4 },
    ]);
    expect(map.at(4.12)).toBe(168);
  });

  it("honours a fixed-width card holding an arbitrary span", () => {
    // A collection: 100s of content inside 128px. Half way through its span is
    // half way across its card, which a duration*pps mapping could never say.
    const map = createLaneTimeMap([
      { left: 0, width: 160, startSeconds: 0, durationSeconds: 4 },
      { left: 168, width: 128, startSeconds: 4.12, durationSeconds: 100 },
    ]);
    expect(map.at(54.12)).toBe(232);
  });
});

describe("laneItemPlacement", () => {
  const map = createLaneTimeMap(SHOTS);

  it("spans the shots a bed covers, gutters included", () => {
    // A bed running under all three shots: 0 -> 12.24s.
    expect(laneItemPlacement(map, { startSeconds: 0, durationSeconds: 12.24 })).toEqual({
      left: 0,
      width: 496,
    });
  });

  it("is wider than duration*pps by exactly the gutters it spans", () => {
    const bed = laneItemPlacement(map, { startSeconds: 0, durationSeconds: 12.24 });
    // 12.24s at 40px/s is 489.6px; the two 8px gutters make up the rest.
    expect(bed.width - 12.24 * 40).toBeCloseTo(6.4, 6);
  });

  it("places a voiceover that starts mid-shot", () => {
    expect(laneItemPlacement(map, { startSeconds: 2, durationSeconds: 2 })).toEqual({
      left: 80,
      width: 80,
    });
  });

  it("places a card that lines up with NOTHING on any other row", () => {
    // A lane is not tied to the picture's cuts: audio can start and end at any
    // timestamp. This one starts inside shot 2, crosses a gutter, and ends
    // inside shot 3 — no edge it touches is a card edge.
    //   5.5s  -> shot 2 (4.12-8.12) at 34.5% -> 168 + 55.2 = 223.2
    //   9.1s  -> shot 3 (8.24-12.24) at 21.5% -> 336 + 34.4 = 370.4
    const placement = laneItemPlacement(map, { startSeconds: 5.5, durationSeconds: 3.6 });
    expect(placement.left).toBeCloseTo(223.2, 6);
    expect(placement.width).toBeCloseTo(147.2, 6);
  });

  it("places two cards on one lane that neither touch nor tile", () => {
    // Nothing requires a lane to be a contiguous run — a gap between two
    // voiceovers is just silence, and the geometry has no opinion about it.
    const first = laneItemPlacement(map, { startSeconds: 0.5, durationSeconds: 1 });
    const second = laneItemPlacement(map, { startSeconds: 9, durationSeconds: 1 });
    expect(first.left + first.width).toBeLessThan(second.left);
  });

  it("draws a bed that OUTLASTS the picture at its true length", () => {
    // 30s of music under a 12.24s cut. Clamping past the last shot drew this
    // as 496px — the picture's width — which reads as a bed that stops when
    // the picture does.
    const bed = laneItemPlacement(map, { startSeconds: 0, durationSeconds: 30 });
    expect(bed.left).toBe(0);
    // 12.24s of picture (496px) plus 17.76s past it at the last card's 40px/s.
    expect(bed.width).toBeCloseTo(496 + 17.76 * 40, 6);
  });

  it("draws a card that starts after the picture has ended", () => {
    const placement = laneItemPlacement(map, { startSeconds: 20, durationSeconds: 5 });
    expect(placement.left).toBeCloseTo(496 + 7.76 * 40, 6);
    expect(placement.width).toBeCloseTo(200, 6);
  });

  it("floors a near-zero layer card at the clickable minimum", () => {
    const placement = laneItemPlacement(map, { startSeconds: 1, durationSeconds: 0 });
    expect(placement.width).toBe(MIN_ITEM_WIDTH);
  });

  it("treats a negative duration as zero rather than inverting the card", () => {
    const placement = laneItemPlacement(map, { startSeconds: 4, durationSeconds: -5 });
    expect(placement.width).toBe(MIN_ITEM_WIDTH);
  });
});

describe("laneRowTop / laneStackHeight", () => {
  it("puts the picture at the top", () => {
    expect(laneRowTop(0, 132, 40, 6)).toBe(0);
  });

  it("stacks each layer under the picture, gap first", () => {
    expect(laneRowTop(1, 132, 40, 6)).toBe(138);
    expect(laneRowTop(2, 132, 40, 6)).toBe(184);
  });

  it("is exactly the item height when there are no layers", () => {
    expect(laneStackHeight(132, 40, 6, 0)).toBe(132);
  });

  it("grows by a gap plus a row per layer", () => {
    expect(laneStackHeight(132, 40, 6, 1)).toBe(178);
    expect(laneStackHeight(132, 40, 6, 2)).toBe(224);
  });

  it("leaves the last row's bottom flush with the stack height", () => {
    expect(laneRowTop(2, 132, 40, 6) + 40).toBe(laneStackHeight(132, 40, 6, 2));
  });
});

describe("laneRowPosition / laneFlatIndex", () => {
  const rows: LaneRowLayout = [
    [
      { startSeconds: 0, durationSeconds: 4 },
      { startSeconds: 4.12, durationSeconds: 4 },
    ],
    [{ startSeconds: 0, durationSeconds: 8 }],
  ];

  it("maps the concatenated list back to a row and column", () => {
    expect(laneRowPosition(0, rows)).toEqual({ row: 0, column: 0 });
    expect(laneRowPosition(1, rows)).toEqual({ row: 0, column: 1 });
    expect(laneRowPosition(2, rows)).toEqual({ row: 1, column: 0 });
  });

  it("returns null past the end and for a nonsense index", () => {
    expect(laneRowPosition(3, rows)).toBeNull();
    expect(laneRowPosition(-1, rows)).toBeNull();
    expect(laneRowPosition(1.5, rows)).toBeNull();
  });

  it("round-trips", () => {
    for (let flat = 0; flat < 3; flat += 1) {
      const position = laneRowPosition(flat, rows);
      expect(position).not.toBeNull();
      expect(laneFlatIndex(position!.row, position!.column, rows)).toBe(flat);
    }
  });

  it("skips over an empty row when numbering", () => {
    const withEmpty: LaneRowLayout = [[{ startSeconds: 0, durationSeconds: 4 }], [], [
      { startSeconds: 0, durationSeconds: 8 },
    ]];
    expect(laneRowPosition(1, withEmpty)).toEqual({ row: 2, column: 0 });
    expect(laneFlatIndex(2, 0, withEmpty)).toBe(1);
  });
});

describe("resolveLaneStripIndex", () => {
  // Picture: three 4s shots. Layer: two back-to-back beds, 0-6s and 6-12s.
  const rows: LaneRowLayout = [
    [
      { startSeconds: 0, durationSeconds: 4 },
      { startSeconds: 4.12, durationSeconds: 4 },
      { startSeconds: 8.24, durationSeconds: 4 },
    ],
    [
      { startSeconds: 0, durationSeconds: 6 },
      { startSeconds: 6, durationSeconds: 6.24 },
    ],
  ];
  const singleRow: LaneRowLayout = [rows[0]!];

  it("steps within the row and stops at its ends", () => {
    expect(resolveLaneStripIndex("ArrowRight", 0, rows)).toBe(1);
    expect(resolveLaneStripIndex("ArrowLeft", 1, rows)).toBe(0);
    expect(resolveLaneStripIndex("ArrowLeft", 0, rows)).toBe(0);
  });

  it("does NOT spill off the end of the picture row into the first layer", () => {
    // The whole reason this resolver clamps per row: index 2 is the last shot,
    // and an unclamped current+1 would be the first bed.
    expect(resolveLaneStripIndex("ArrowRight", 2, rows)).toBe(2);
  });

  it("sends Home/End to the current row's ends, not the list's", () => {
    expect(resolveLaneStripIndex("Home", 4, rows)).toBe(3);
    expect(resolveLaneStripIndex("End", 3, rows)).toBe(4);
    expect(resolveLaneStripIndex("Home", 1, rows)).toBe(0);
    expect(resolveLaneStripIndex("End", 1, rows)).toBe(2);
  });

  it("crosses rows at the nearest time", () => {
    // Shot 1 (0-4s) sits over the first bed (0-6s).
    expect(resolveLaneStripIndex("ArrowDown", 0, rows)).toBe(3);
    // Shot 3 (8.24-12.24s) sits over the second bed (6-12.24s).
    expect(resolveLaneStripIndex("ArrowDown", 2, rows)).toBe(4);
  });

  it("goes back up to whatever is playing at the layer card's own start", () => {
    // Not necessarily the shot you came down from: the second bed starts at
    // 6s, which is inside shot 2 (4.12-8.12s), so Up from it lands on shot 2
    // even though Down from shot 3 reached it. The anchor is the card's start
    // time, and up/down is not required to be an inverse when the rows are
    // cut differently — which is the normal case for a bed.
    expect(resolveLaneStripIndex("ArrowUp", 4, rows)).toBe(1);
  });

  it("prefers the window that CONTAINS the time over the nearest start", () => {
    // Shot 2 starts at 4.12s, inside the first bed (0-6s). Nearest-start alone
    // would pick the second bed (|6 - 4.12| < |0 - 4.12|) — the wrong one.
    expect(resolveLaneStripIndex("ArrowDown", 1, rows)).toBe(3);
  });

  it("ignores vertical arrows on a plain single-row strip", () => {
    // Returning the current index instead would have the hook preventDefault
    // the key, and vertical arrows are how the page scrolls over a strip.
    expect(resolveLaneStripIndex("ArrowDown", 0, singleRow)).toBeNull();
    expect(resolveLaneStripIndex("ArrowUp", 0, singleRow)).toBeNull();
  });

  it("ignores a vertical arrow at the top and bottom of the stack", () => {
    expect(resolveLaneStripIndex("ArrowUp", 0, rows)).toBeNull();
    expect(resolveLaneStripIndex("ArrowDown", 3, rows)).toBeNull();
  });

  it("skips an empty layer rather than landing nowhere", () => {
    const withEmpty: LaneRowLayout = [rows[0]!, [], rows[1]!];
    expect(resolveLaneStripIndex("ArrowDown", 0, withEmpty)).toBe(3);
  });

  it("matches the old 1D behaviour on a single row", () => {
    expect(resolveLaneStripIndex("ArrowRight", 0, singleRow)).toBe(1);
    expect(resolveLaneStripIndex("ArrowLeft", 2, singleRow)).toBe(1);
    expect(resolveLaneStripIndex("Home", 2, singleRow)).toBe(0);
    expect(resolveLaneStripIndex("End", 0, singleRow)).toBe(2);
  });

  it("ignores keys it does not own, and an out-of-range index", () => {
    expect(resolveLaneStripIndex("PageDown", 0, rows)).toBeNull();
    expect(resolveLaneStripIndex("ArrowRight", 99, rows)).toBeNull();
    expect(resolveLaneStripIndex("ArrowRight", 0, [])).toBeNull();
  });
});
