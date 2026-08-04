import { describe, expect, it } from "vitest";

import type { TimelineClip } from "@storyboard/timeline-model/types";

import { clipWidthAt, collectionCardWidth } from "./preview-card-geometry";
import { TIMELINE_PPS } from "./graph-view-config";

// FIRST COVERAGE. Pure width math that was unreachable by a unit test while it
// sat inside graph-preview.tsx — this app's vitest cannot parse `.tsx`.
//
// The invariant worth protecting: the strip's `itemWidth` prop and the
// playhead's width model must read the SAME number. Disagreement does not
// throw, it just walks the marker off the cards it points at, which is the kind
// of drift only a test notices.

function media(duration: number): TimelineClip {
  return {
    id: "m",
    index: 0,
    kind: "image",
    src: "x.jpg",
    alt: "m",
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

function collection(): TimelineClip {
  return {
    id: "c",
    index: 0,
    kind: "collection",
    title: "c",
    childTimelineId: "c",
    alt: "c collection",
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    itemCount: 2,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  };
}

describe("collectionCardWidth", () => {
  it("is 128px at the default zoom — a ~3.2s-equivalent slot", () => {
    // Card height 0 takes the aspect floor out of play, isolating the zoom term.
    expect(collectionCardWidth(TIMELINE_PPS, 0)).toBe(128);
  });

  it("tracks pixels-per-second so collections zoom with the clips beside them", () => {
    // The whole point of the change that introduced this: a collection used to
    // sit frozen while the media around it grew and shrank.
    expect(collectionCardWidth(TIMELINE_PPS * 2, 0)).toBe(256);
    expect(collectionCardWidth(TIMELINE_PPS / 2, 0)).toBe(64);
  });

  it("never renders narrower than a 16:9 box against the card height", () => {
    // Zooming out used to squeeze collections into unreadable, unhittable
    // slivers. The floor scales with item size, so xs and xl rows each get a
    // proportionate minimum rather than one flat pixel count.
    const tall = collectionCardWidth(1, 90);
    expect(tall).toBe(90 * (16 / 9));
    expect(tall).toBeGreaterThan(collectionCardWidth(1, 40));
  });

  it("keeps a hard pixel floor even when the card height is tiny", () => {
    // Both floors are live at once; neither alone keeps a zoomed-out card
    // clickable.
    expect(collectionCardWidth(0.001, 0)).toBeGreaterThan(0);
  });
});

describe("clipWidthAt", () => {
  it("gives EVERY collection the same width, whatever its duration says", () => {
    // Collections carry no single duration to lay out by — a uniform width is
    // the deliberate answer, and it must not read `clip.duration`.
    const width = clipWidthAt(TIMELINE_PPS, 0);
    expect(width(collection())).toBe(collectionCardWidth(TIMELINE_PPS, 0));
  });

  it("sizes media BY duration, so two clips differ in width", () => {
    const width = clipWidthAt(TIMELINE_PPS, 0);
    expect(width(media(8))).toBeGreaterThan(width(media(4)));
  });

  it("agrees with collectionCardWidth at every zoom — the drift that matters", () => {
    for (const pps of [6, 20, TIMELINE_PPS, 120]) {
      expect(clipWidthAt(pps, 64)(collection())).toBe(collectionCardWidth(pps, 64));
    }
  });
});
