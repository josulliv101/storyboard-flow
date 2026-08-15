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

// THE LAYER FRAME. Where a lane clip draws inside the picture — the one member
// of the placement family that is an OBJECT, and the one whose write-back is
// duplicated across `graphChildrenToClips`'s two branches. Missing either is
// silent data loss on the next save rather than a crash, which is exactly the
// failure mode that needs a test rather than a reading.

const INSET = { x: 0.65, y: 0.6, width: 0.3 };

describe("a layer frame survives the round trip", () => {
  const framed: TimelineDocument = {
    id: "col",
    title: "Framed",
    clips: packTimelineClips([
      media("shot-1", 4),
      media("pip", 6, { trackIndex: 1, kind: "video", layerFrame: INSET }),
    ]),
  };

  it("comes back unchanged on a MEDIA clip", () => {
    const pip = roundTrip(framed).find((clip) => clip.id === "pip");
    expect(pip?.layerFrame).toEqual(INSET);
  });

  it("comes back unchanged on a COLLECTION clip — the other write-back", () => {
    // The branch it would be easy to wire only the first of. A whole nested
    // scene can sit under the picture, so it can carry an inset too.
    const withScene: TimelineDocument = {
      id: "col",
      title: "Framed scene",
      clips: packTimelineClips([
        media("shot-1", 4),
        {
          id: "scene",
          index: 1,
          kind: "collection",
          childTimelineId: "child",
          title: "Scene",
          alt: "scene collection",
          aspect: 16 / 9,
          trackIndex: 1,
          layerFrame: INSET,
          startTime: 0,
          duration: 5,
          sourceDuration: 5,
          trimIn: 0,
          trimOut: 0,
          itemCount: 0,
        } as TimelineClip,
      ]),
    };
    const built = buildFocusedGraph(
      {
        [withScene.id]: withScene,
        child: { id: "child", title: "Child", clips: [] },
      },
      withScene.id,
      1,
    );
    if (!built.ok) throw new Error(built.error);
    const clips = graphChildrenToClips(built.value.graph, built.value.details, withScene.id);
    expect(clips.find((clip) => clip.id === "scene")?.layerFrame).toEqual(INSET);
  });

  it("IS STABLE — a second round trip does not drift the rectangle", () => {
    const once = roundTrip(framed);
    const twice = roundTrip({ ...framed, clips: once });
    expect(twice.find((clip) => clip.id === "pip")?.layerFrame).toEqual(INSET);
  });

  it("DROPS a frame on the picture — lane 0 is not inside itself", () => {
    const onPicture: TimelineDocument = {
      id: "col",
      title: "Stale inset",
      clips: packTimelineClips([media("shot-1", 4, { layerFrame: INSET })]),
    };
    expect(roundTrip(onPicture)[0]?.layerFrame).toBeUndefined();
  });

  it("drops a rectangle that is not one, rather than storing it", () => {
    const broken: TimelineDocument = {
      id: "col",
      title: "Broken inset",
      clips: packTimelineClips([
        media("shot-1", 4),
        media("pip", 6, {
          trackIndex: 1,
          layerFrame: { x: 0.5, y: 0.5, width: 0 } as unknown as typeof INSET,
        }),
      ]),
    };
    expect(roundTrip(broken).find((clip) => clip.id === "pip")?.layerFrame).toBeUndefined();
  });

  it("leaves a document that uses no insets without the field", () => {
    for (const clip of roundTrip(layered)) {
      expect("layerFrame" in clip).toBe(false);
    }
  });
});

// A COLLECTION ON A LANE — found while carrying the frame through, and broken
// well before it.
//
// The three collection-clip spec builders carried `disabled` but not the
// placement family at all, so a layered scene lost its lane and its placed
// start on the way IN: stored `trackIndex: 1, placedStart: 3` hydrated to a
// node with neither, and the very next save wrote it back as `trackIndex: 0,
// startTime: 0`. A whole nested scene under the picture snapped onto the cut,
// and the graph node type says in as many words that it is allowed to sit
// there. Media clips were fine, which is why nothing caught it.
describe("a layered COLLECTION keeps its placement", () => {
  const scene = (over: Partial<TimelineClip>): TimelineClip =>
    ({
      id: "scene",
      index: 0,
      kind: "collection",
      childTimelineId: "child",
      title: "Scene",
      alt: "scene collection",
      aspect: 16 / 9,
      trackIndex: 0,
      startTime: 0,
      duration: 5,
      sourceDuration: 5,
      trimIn: 0,
      trimOut: 0,
      itemCount: 0,
      ...over,
    }) as TimelineClip;

  const tripScene = (clip: TimelineClip) => {
    const document: TimelineDocument = { id: "col", title: "T", clips: [clip] };
    const built = buildFocusedGraph(
      { col: document, child: { id: "child", title: "Child", clips: [] } },
      "col",
      1,
    );
    if (!built.ok) throw new Error(built.error);
    return graphChildrenToClips(built.value.graph, built.value.details, "col")[0];
  };

  it("keeps its LANE", () => {
    expect(tripScene(scene({ trackIndex: 1 }))?.trackIndex).toBe(1);
  });

  it("keeps its PLACED START, and the startTime derived from it", () => {
    const back = tripScene(scene({ trackIndex: 1, placedStart: 3, startTime: 3 }));
    expect(back?.placedStart).toBe(3);
    expect(back?.startTime).toBe(3);
  });

  it("keeps its INSET", () => {
    expect(tripScene(scene({ trackIndex: 1, layerFrame: INSET }))?.layerFrame).toEqual(INSET);
  });

  it("still puts an unlayered scene on the picture", () => {
    const back = tripScene(scene({}));
    expect(back?.trackIndex).toBe(0);
    expect(back?.layerFrame).toBeUndefined();
  });
});
