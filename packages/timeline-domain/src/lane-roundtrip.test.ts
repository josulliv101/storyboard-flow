import { describe, expect, it } from "vitest";

import { CLIP_GAP_SECONDS } from "@storyboard/timeline-model/constants";
import { packTimelineClips } from "@storyboard/timeline-model/documents";
import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

import { buildFocusedGraph, graphChildrenToClips } from "./adapter";

// THE TWIN-MATH TEST.
//
// `graphChildrenToClips` re-derives startTime with "packing math identical to
// packTimelineClips" — the module comment says so, and nothing enforced it.
// Two answers to "where does this clip start" is not a cosmetic drift: the
// graph write path runs on every save, so a document whose lanes the model
// packed one way and the adapter another would MOVE its own clips the moment
// it was touched.
//
// One sequence hid the problem, because with everything on track 0 both
// implementations reduce to the same accumulator. Lanes are what make them
// separable, so this is where the agreement has to be pinned.

function media(
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

/** A picture lane of two shots, with a bed running under both on lane 1. */
const layered: TimelineDocument = {
  id: "col",
  title: "Layered",
  clips: packTimelineClips([
    media("shot-1", 4),
    media("shot-2", 4),
    media("bed", 30, { trackIndex: 1, kind: "audio", src: "https://cdn.test/bed.wav" }),
  ]),
};

function roundTrip(document: TimelineDocument): TimelineClip[] {
  const built = buildFocusedGraph({ [document.id]: document }, document.id, 1);
  if (!built.ok) throw new Error(built.error);
  return graphChildrenToClips(built.value.graph, built.value.details, document.id);
}

describe("lanes survive the graph round trip", () => {
  it("the stored document starts each lane at zero", () => {
    // The premise the round trip is checked against — if this changed, the
    // assertions below would pass while meaning nothing.
    expect(layered.clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ["shot-1", 0],
      ["shot-2", 4 + CLIP_GAP_SECONDS],
      ["bed", 0],
    ]);
  });

  it("REPRODUCES the same startTimes the model packed", () => {
    const out = roundTrip(layered);
    expect(out.map((clip) => [clip.id, clip.startTime])).toEqual([
      ["shot-1", 0],
      ["shot-2", 4 + CLIP_GAP_SECONDS],
      ["bed", 0],
    ]);
  });

  it("keeps each clip in its own lane", () => {
    const out = roundTrip(layered);
    expect(out.map((clip) => [clip.id, clip.trackIndex])).toEqual([
      ["shot-1", 0],
      ["shot-2", 0],
      ["bed", 1],
    ]);
  });

  it("IS STABLE — a second round trip moves nothing", () => {
    // The failure this guards is cumulative: a document that shifts a little
    // on every save looks fine once and is unrecoverable after a week.
    const once = roundTrip(layered);
    const twice = roundTrip({ ...layered, clips: once });
    expect(twice.map((c) => [c.id, c.startTime, c.trackIndex])).toEqual(
      once.map((c) => [c.id, c.startTime, c.trackIndex]),
    );
  });

  it("still agrees on a single-lane document — the compatibility case", () => {
    const flat: TimelineDocument = {
      id: "col",
      title: "Flat",
      clips: packTimelineClips([media("a", 4), media("b", 2), media("c", 3)]),
    };
    expect(roundTrip(flat).map((c) => c.startTime)).toEqual(
      flat.clips.map((c) => c.startTime),
    );
  });

  it("carries a PLACED start through unchanged", () => {
    // The twin-math risk lands hardest on this field: it is the one input that
    // overrides the cursor, so an adapter that dropped it would re-queue every
    // placed clip on the next save — silently, and only for layered documents.
    const placed: TimelineDocument = {
      id: "col",
      title: "Placed",
      clips: packTimelineClips([
        media("shot", 30),
        media("vo", 2, { trackIndex: 1, placedStart: 7.5 }),
      ]),
    };
    expect(roundTrip(placed).map((c) => [c.id, c.startTime, c.placedStart])).toEqual([
      ["shot", 0, undefined],
      ["vo", 7.5, 7.5],
    ]);
  });

  it("keeps a placed start stable across a SECOND round trip", () => {
    const placed: TimelineDocument = {
      id: "col",
      title: "Placed",
      clips: packTimelineClips([
        media("shot", 30),
        media("vo", 2, { trackIndex: 1, placedStart: 7.5 }),
        media("next", 2, { trackIndex: 1 }),
      ]),
    };
    const once = roundTrip(placed);
    const twice = roundTrip({ ...placed, clips: once });
    expect(twice.map((c) => [c.id, c.startTime])).toEqual(
      once.map((c) => [c.id, c.startTime]),
    );
    // And the queued clip behind it still clears it.
    expect(once.find((c) => c.id === "next")?.startTime).toBe(9.5 + CLIP_GAP_SECONDS);
  });

  it("agrees that a placement on the PICTURE is ignored", () => {
    const onPicture: TimelineDocument = {
      id: "col",
      title: "Picture",
      clips: packTimelineClips([media("a", 4), media("b", 2, { placedStart: 30 })]),
    };
    expect(roundTrip(onPicture).map((c) => c.startTime)).toEqual([
      0,
      4 + CLIP_GAP_SECONDS,
    ]);
  });

  it("normalises a phantom lane the same way on both sides", () => {
    // `validate` admits any finite number; both implementations must send a
    // non-integer to lane 0 or they disagree about where it starts.
    const odd: TimelineDocument = {
      id: "col",
      title: "Odd",
      clips: packTimelineClips([media("a", 4), media("b", 2, { trackIndex: 1.5 })]),
    };
    expect(roundTrip(odd).map((c) => [c.startTime, c.trackIndex])).toEqual([
      [0, 0],
      [4 + CLIP_GAP_SECONDS, 0],
    ]);
  });
});
