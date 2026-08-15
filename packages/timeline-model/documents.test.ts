import { describe, expect, it } from "vitest";

import { CLIP_GAP_SECONDS } from "./constants";
import {
  collectionSpanSeconds,
  effectiveDocument,
  packTimelineClips,
  trackIndexOf,
} from "./documents";
import type { TimelineClip, TimelineDocument } from "./types";

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

const starts = (clips: readonly TimelineClip[]) => clips.map((c) => c.startTime);

describe("trackIndexOf", () => {
  it("takes a non-negative integer at face value", () => {
    expect(trackIndexOf({ trackIndex: 0 })).toBe(0);
    expect(trackIndexOf({ trackIndex: 3 })).toBe(3);
  });

  it("sends anything that could mint a PHANTOM lane to track 0", () => {
    // `validate` deliberately admits any finite number, so stored data can
    // carry these. A lane nothing can author or see is worse than lane 0.
    for (const track of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(trackIndexOf({ trackIndex: track })).toBe(0);
    }
    expect(trackIndexOf({ trackIndex: undefined as unknown as number })).toBe(0);
  });
});

describe("packTimelineClips", () => {
  it("packs one lane end to end, with the gap between", () => {
    const packed = packTimelineClips([clip("a", 4), clip("b", 2), clip("c", 3)]);
    expect(starts(packed)).toEqual([0, 4 + CLIP_GAP_SECONDS, 4 + 2 + CLIP_GAP_SECONDS * 2]);
  });

  it("numbers clips by ARRAY position", () => {
    const packed = packTimelineClips([clip("a", 4), clip("b", 2)]);
    expect(packed.map((c) => c.index)).toEqual([0, 1]);
  });

  it("is UNCHANGED for a document that has never used lanes", () => {
    // Every document written before lanes is entirely on track 0, so this is
    // the compatibility guarantee the whole change rests on.
    const clips = [clip("a", 4), clip("b", 2), clip("c", 3)];
    expect(starts(packTimelineClips(clips))).toEqual([
      0,
      4 + CLIP_GAP_SECONDS,
      4 + 2 + CLIP_GAP_SECONDS * 2,
    ]);
  });

  it("STARTS EVERY LANE AT ZERO, so a bed runs under the picture", () => {
    // The whole point: track 1 must not queue up behind track 0.
    const packed = packTimelineClips([
      clip("shot-1", 4),
      clip("shot-2", 4),
      clip("vo", 8, { trackIndex: 1 }),
    ]);
    expect(starts(packed)).toEqual([0, 4 + CLIP_GAP_SECONDS, 0]);
  });

  it("packs each lane independently, in its own order", () => {
    const packed = packTimelineClips([
      clip("v1", 4),
      clip("a1", 1, { trackIndex: 1 }),
      clip("v2", 4),
      clip("a2", 1, { trackIndex: 1 }),
    ]);
    expect(starts(packed)).toEqual([0, 0, 4 + CLIP_GAP_SECONDS, 1 + CLIP_GAP_SECONDS]);
  });

  it("does not care whether lanes are contiguous or in order", () => {
    const packed = packTimelineClips([
      clip("music", 10, { trackIndex: 5 }),
      clip("shot", 4),
    ]);
    expect(starts(packed)).toEqual([0, 0]);
  });

  it("treats a phantom lane index as track 0, packing it in sequence", () => {
    const packed = packTimelineClips([clip("a", 4), clip("b", 2, { trackIndex: -1 })]);
    expect(starts(packed)).toEqual([0, 4 + CLIP_GAP_SECONDS]);
  });

  it("is empty for no clips", () => {
    expect(packTimelineClips([])).toEqual([]);
  });
});

describe("collectionSpanSeconds", () => {
  it("is the floor for an empty collection, so its card can be clicked", () => {
    expect(collectionSpanSeconds([])).toBe(3);
  });

  it("reaches the end of a single lane", () => {
    const packed = packTimelineClips([clip("a", 4), clip("b", 2)]);
    expect(collectionSpanSeconds(packed)).toBe(4 + CLIP_GAP_SECONDS + 2);
  });

  it("REACHES THE FURTHEST END, not the last clip's", () => {
    // A bed on track 1 outlasts the picture while sitting EARLIER in the
    // array. Reading the last element would report a collection shorter than
    // its own contents — shrinking its card and clipping the tail off a render.
    const packed = packTimelineClips([
      clip("bed", 30, { trackIndex: 1 }),
      clip("shot-1", 4),
      clip("shot-2", 4),
    ]);
    expect(collectionSpanSeconds(packed)).toBe(30);
  });

  it("still follows the picture when IT is the longer lane", () => {
    const packed = packTimelineClips([
      clip("sting", 2, { trackIndex: 1 }),
      clip("shot-1", 10),
      clip("shot-2", 10),
    ]);
    expect(collectionSpanSeconds(packed)).toBe(10 + CLIP_GAP_SECONDS + 10);
  });
});

describe("effectiveDocument with lanes", () => {
  const doc = (clips: TimelineClip[]): TimelineDocument => ({
    id: "t1",
    title: "T",
    clips,
  });

  it("closes the gap a disabled clip leaves IN ITS OWN LANE ONLY", () => {
    const packed = packTimelineClips([
      clip("v1", 4),
      clip("v2", 4, { disabled: true }),
      clip("v3", 4),
      clip("bed", 20, { trackIndex: 1 }),
    ]);
    const effective = effectiveDocument(doc(packed));
    // v3 moves up into v2's place; the bed is untouched and still starts at 0.
    expect(effective.clips.map((c) => [c.id, c.startTime])).toEqual([
      ["v1", 0],
      ["v3", 4 + CLIP_GAP_SECONDS],
      ["bed", 0],
    ]);
  });

  it("leaves a document with nothing disabled exactly as it was", () => {
    const packed = packTimelineClips([clip("a", 4), clip("bed", 9, { trackIndex: 1 })]);
    expect(effectiveDocument(doc(packed)).clips).toBe(packed);
  });
});
