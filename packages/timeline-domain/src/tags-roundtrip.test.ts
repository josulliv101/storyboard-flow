import { describe, expect, it } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

import { buildFocusedGraph, graphChildrenToClips } from "./adapter";

// Tags live only on the DETAIL side-table — the engine never reads them, the
// same seam `sourceAsset` uses. That makes the write-back in
// graphChildrenToClips load-bearing and invisible: drop it and tags are lost on
// every save, with no type error and nothing else to notice.
//
// So this covers the full loop (clip -> graph+details -> clip) rather than
// either half, and it covers all three media kinds because the projection
// returns from a DIFFERENT branch for each one.

function clip(over: Partial<TimelineClip> & Pick<TimelineClip, "id" | "kind">): TimelineClip {
  return {
    index: 0,
    alt: "take",
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
    src: "https://example.test/take",
    ...over,
  } as TimelineClip;
}

const TAGS = ["scail-2", "wan2.1", "S02", "keeper"];

function roundTrip(doc: TimelineDocument): TimelineClip[] {
  const built = buildFocusedGraph({ [doc.id]: doc }, doc.id, 1);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.error);
  return graphChildrenToClips(built.value.graph, built.value.details, doc.id);
}

describe("tags survive the graph round-trip", () => {
  for (const kind of ["image", "video", "audio"] as const) {
    it(`for a ${kind} clip`, () => {
      const out = roundTrip({
        id: "col",
        title: "Takes",
        clips: [clip({ id: `${kind}-1`, kind, tags: [...TAGS] })],
      });
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe(kind);
      expect(out[0].tags).toEqual(TAGS);
    });
  }

  it("for a collection clip", () => {
    // Collections are tagged through a different detail builder and a
    // different return branch, so the media cases above do not cover this.
    const out = roundTrip({
      id: "col",
      title: "Takes",
      clips: [
        {
          id: "child",
          index: 0,
          kind: "collection",
          alt: "August tenth collection",
          title: "August tenth",
          childTimelineId: "child",
          itemCount: 0,
          aspect: 16 / 9,
          trackIndex: 0,
          startTime: 0,
          duration: 3,
          sourceDuration: 3,
          trimIn: 0,
          trimOut: 0,
          tags: ["dailies"],
        },
      ],
    });
    expect(out[0].tags).toEqual(["dailies"]);
  });

  it("cleans tags on the way in rather than storing them raw", () => {
    const out = roundTrip({
      id: "col",
      title: "Takes",
      clips: [clip({ id: "video-1", kind: "video", tags: ["  keeper ", "KEEPER", "", "S02"] })],
    });
    expect(out[0].tags).toEqual(["keeper", "S02"]);
  });

  it("leaves an untagged clip with no tags key at all", () => {
    // Absence is the default: a document that never uses tags must not grow
    // the field just by being loaded and saved.
    const out = roundTrip({
      id: "col",
      title: "Takes",
      clips: [clip({ id: "image-1", kind: "image" })],
    });
    expect("tags" in out[0]).toBe(false);
  });
});
