import { describe, expect, it } from "vitest";

import type { TimelineClip } from "../types";
import {
  getContainingClip,
  getLiveLayerClips,
  getPictureClip,
  getTimelineDuration,
  nextPlayableTime,
  clipToPreroll,
} from "./playback-skip";

function image(
  id: string,
  startTime: number,
  duration: number,
  disabled = false,
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: `https://cdn.test/${id}.jpg`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
    ...(disabled ? { disabled: true } : {}),
  };
}

/** a: 0-4, b: 4-8 (DISABLED), c: 8-12 — the shape every skip case needs. */
const clips = [image("a", 0, 4), image("b", 4, 4, true), image("c", 8, 4)];
const duration = getTimelineDuration(clips);

describe("nextPlayableTime", () => {
  it("leaves a time inside an enabled clip alone", () => {
    expect(nextPlayableTime(clips, 2, duration)).toBeCloseTo(2, 6);
    expect(nextPlayableTime(clips, 9.5, duration)).toBeCloseTo(9.5, 6);
  });

  it("jumps the WHOLE disabled item, not one frame of it", () => {
    // Anywhere inside it lands on the same place: the next enabled clip.
    // Advancing gradually would play the span out at normal speed showing a
    // held frame, which is the freeze the whole design exists to avoid.
    expect(nextPlayableTime(clips, 4.01, duration)).toBeCloseTo(8, 6);
    expect(nextPlayableTime(clips, 6, duration)).toBeCloseTo(8, 6);
    expect(nextPlayableTime(clips, 7.99, duration)).toBeCloseTo(8, 6);
  });

  it("holds at a shared boundary, which still belongs to the enabled clip", () => {
    // Spans are inclusive at both ends, so t=4 is the last instant of "a" as
    // much as the first of "b" — and `getContainingClip` resolves ties to the
    // earlier clip. Staying is right: there is still an enabled frame to draw.
    // The very next tick is strictly inside "b" and jumps.
    expect(getContainingClip(clips, 4)?.id).toBe("a");
    expect(nextPlayableTime(clips, 4, duration)).toBeCloseTo(4, 6);
    // Only reachable with ABUTTING clips; the real packing always leaves
    // CLIP_GAP_SECONDS between them, and a time in that gap skips cleanly.
    const packed = [image("a", 0, 4), image("b", 4.5, 4, true), image("c", 9, 4)];
    expect(nextPlayableTime(packed, 4.2, getTimelineDuration(packed))).toBeCloseTo(9, 6);
  });

  it("jumps a RUN of disabled clips in one hop", () => {
    // The scan is over every enabled clip, not the immediate neighbour, so
    // consecutive disabled items need no special case.
    const run = [
      image("a", 0, 4),
      image("b", 4, 4, true),
      image("c", 8, 4, true),
      image("d", 12, 4),
    ];
    expect(nextPlayableTime(run, 5, getTimelineDuration(run))).toBeCloseTo(12, 6);
  });

  it("runs to the timeline end when nothing playable follows", () => {
    const trailing = [image("a", 0, 4), image("b", 4, 4, true)];
    const total = getTimelineDuration(trailing);
    expect(nextPlayableTime(trailing, 5, total)).toBeCloseTo(total, 6);
  });

  it("returns the end for an all-disabled timeline", () => {
    const none = [image("a", 0, 4, true), image("b", 4, 4, true)];
    const total = getTimelineDuration(none);
    expect(nextPlayableTime(none, 0, total)).toBeCloseTo(total, 6);
  });

  it("still snaps forward over a plain GAP", () => {
    // Predates disabling and must survive it: an empty span is not silence,
    // because the surface holds the last drawn frame across it.
    const gapped = [image("a", 0, 4), image("c", 8, 4)];
    expect(nextPlayableTime(gapped, 6, getTimelineDuration(gapped))).toBeCloseTo(8, 6);
  });

  it("clamps out-of-range times into the timeline", () => {
    expect(nextPlayableTime(clips, -5, duration)).toBeCloseTo(0, 6);
    expect(nextPlayableTime(clips, 99, duration)).toBeCloseTo(duration, 6);
  });

  it("resumes mid-clip when an enabled clip OVERLAPS the skipped one", () => {
    // A long enabled bed under a disabled overlay: skipping the overlay must
    // not skip the bed along with it, so playback resumes inside the bed at
    // the point the overlay ended.
    const overlapping = [image("bed", 0, 12), image("over", 4, 4, true)];
    // getContainingClip finds "bed" first here, so the skip only engages once
    // the disabled clip is what covers the time — force that by asking from
    // inside the overlay with the overlay listed first.
    const overlayFirst = [image("over", 4, 4, true), image("bed", 0, 12)];
    expect(getContainingClip(overlapping, 6)?.id).toBe("bed");
    expect(nextPlayableTime(overlayFirst, 6, getTimelineDuration(overlayFirst))).toBeCloseTo(
      8,
      6,
    );
  });

  it("is unchanged for a timeline with nothing disabled", () => {
    const plain = [image("a", 0, 4), image("b", 4, 4), image("c", 8, 4)];
    const total = getTimelineDuration(plain);
    for (const time of [0, 1.5, 4, 6, 11.9, total]) {
      expect(nextPlayableTime(plain, time, total)).toBeCloseTo(time, 6);
    }
  });
});

// ── LANES ───────────────────────────────────────────────────────────────────
//
// Several clips can cover one instant now: lane 0 is the picture, anything
// above it runs underneath. The surface draws frames from what this returns,
// so picking an under-layer means trying to draw a clip with no picture.

function onLane(clip: TimelineClip, trackIndex: number): TimelineClip {
  return { ...clip, trackIndex };
}

describe("getContainingClip with lanes", () => {
  it("prefers the PICTURE when a layer covers the same instant", () => {
    // The array is sorted by start time, so a bed starting at 0 is found
    // before a shot starting at 0 — the old array-order rule drew the bed.
    const bed = onLane(image("bed", 0, 30), 1);
    const shot = image("shot", 0, 4);
    expect(getContainingClip([bed, shot], 2)?.id).toBe("shot");
  });

  it("picks the picture whichever order they arrive in", () => {
    const bed = onLane(image("bed", 0, 30), 1);
    const shot = image("shot", 0, 4);
    expect(getContainingClip([shot, bed], 2)?.id).toBe("shot");
  });

  it("prefers the LOWEST lane, not merely lane 0", () => {
    const vo = onLane(image("vo", 0, 10), 2);
    const bed = onLane(image("bed", 0, 10), 1);
    expect(getContainingClip([vo, bed], 5)?.id).toBe("bed");
  });

  it("still returns a layer when nothing else covers the time", () => {
    // Past the picture, a bed is all there is — and the caller needs to know
    // the time is inside material rather than in a gap.
    const bed = onLane(image("bed", 0, 30), 1);
    const shot = image("shot", 0, 4);
    expect(getContainingClip([bed, shot], 20)?.id).toBe("bed");
  });

  it("keeps ARRAY ORDER within a single lane", () => {
    // Two clips on the picture overlapping is not something packing produces,
    // but the old behaviour was first-wins and nothing should change for it.
    const first = image("first", 0, 10);
    const second = image("second", 0, 10);
    expect(getContainingClip([first, second], 5)?.id).toBe("first");
  });

  it("is unchanged for a timeline that uses no lanes", () => {
    expect(getContainingClip(clips, 2)?.id).toBe("a");
    expect(getContainingClip(clips, 9)?.id).toBe("c");
    expect(getContainingClip(clips, 30)).toBeNull();
  });

  it("RETURNS THE BED IN A PICTURE GAP — correct here, wrong to draw", () => {
    // Packing leaves CLIP_GAP_SECONDS between every two picture clips, so this
    // is the shape of every cut on a timeline that has a bed under it. Asking
    // "is this time inside material" the answer really is the bed, and
    // nextPlayableTime needs that or it would snap the clock across the gap
    // while the bed is still playing.
    //
    // It is the WRONG answer to "what do I draw", which is why the surface
    // resolves the picture through getPictureClip instead.
    const shots = [image("a", 0, 4), image("c", 4.12, 4)];
    const bed = onLane(image("bed", 0, 30), 1);
    expect(getContainingClip([...shots, bed], 4.06)?.id).toBe("bed");
  });
});

// ── WHAT DRAWS, AND WHAT MERELY PLAYS ───────────────────────────────────────
//
// Two questions, previously answered by one function. getContainingClip stays
// the answer to "is this time inside material" (nextPlayableTime's question).
// These two split out the surface's question: exactly one clip supplies the
// frame, and any number of others are simultaneously audible underneath it.

describe("getPictureClip", () => {
  it("is the lane-0 clip covering the time", () => {
    const bed = onLane(image("bed", 0, 30), 1);
    const shot = image("shot", 0, 4);
    expect(getPictureClip([bed, shot], 2)?.id).toBe("shot");
  });

  it("HOLDS THE OUTGOING SHOT ACROSS A PICTURE GAP, bed or no bed", () => {
    // The bug this function exists for. Packing puts CLIP_GAP_SECONDS between
    // every two picture clips, so with a bed under the cut there is a 120ms
    // window at EVERY cut that only the bed covers — and drawing the bed means
    // flashing the audio stand-in three frames per cut.
    //
    // A gap carries no new frame. It is not an instruction to stop showing the
    // shot that was on screen.
    const shots = [image("a", 0, 4), image("c", 4.12, 4)];
    const bed = onLane(image("bed", 0, 30), 1);
    expect(getPictureClip([...shots, bed], 4.06)?.id).toBe("a");
    expect(getPictureClip(shots, 4.06)?.id).toBe("a");
  });

  it("holds the last shot past the end of the picture", () => {
    const shot = image("shot", 0, 4);
    const bed = onLane(image("bed", 0, 30), 1);
    expect(getPictureClip([shot, bed], 20)?.id).toBe("shot");
  });

  it("draws nothing in a LEADING gap, before any shot has started", () => {
    // Nothing has been shown yet, so there is nothing to hold.
    expect(getPictureClip([image("shot", 4, 4)], 1)).toBeNull();
  });

  it("falls back to any lane when the timeline has NO picture at all", () => {
    // A timeline of nothing but audio still has to draw its stand-in rather
    // than an empty surface — there is no picture to prefer or to hold.
    const vo = onLane(image("vo", 0, 10), 1);
    const bed = onLane(image("bed", 0, 10), 2);
    expect(getPictureClip([bed, vo], 5)?.id).toBe("vo");
  });

  it("prefers a real picture over a lane clip that started earlier", () => {
    const bed = onLane(image("bed", 0, 30), 1);
    const shot = image("shot", 10, 4);
    expect(getPictureClip([bed, shot], 12)?.id).toBe("shot");
  });
});

describe("getLiveLayerClips", () => {
  it("is every lane clip covering the time, and never the picture", () => {
    const shot = image("shot", 0, 10);
    const bed = onLane(image("bed", 0, 30), 1);
    const vo = onLane(image("vo", 2, 4), 2);
    expect(getLiveLayerClips([shot, bed, vo], 3).map((clip) => clip.id)).toEqual(["bed", "vo"]);
  });

  it("DOES NOT HOLD a finished layer — a bed that ended is silent", () => {
    // The opposite rule to the picture. Holding a frame across a gap is right
    // because the screen cannot show nothing; holding SOUND across one would
    // keep playing a bed that ended.
    const shot = image("shot", 0, 30);
    const bed = onLane(image("bed", 0, 4), 1);
    expect(getLiveLayerClips([shot, bed], 10)).toEqual([]);
  });

  it("leaves out a disabled layer", () => {
    const bed = onLane(image("bed", 0, 30, true), 1);
    const vo = onLane(image("vo", 0, 30), 2);
    expect(getLiveLayerClips([bed, vo], 5).map((clip) => clip.id)).toEqual(["vo"]);
  });

  it("is empty for a timeline that uses no lanes", () => {
    expect(getLiveLayerClips(clips, 2)).toEqual([]);
  });

  it("returns the SAME empty array every time, since this runs per frame", () => {
    // Allocating a fresh [] 60 times a second for the overwhelmingly common
    // case — a timeline with no lanes at all — is the kind of per-frame garbage
    // getContainingClip's manual loop exists to avoid.
    expect(getLiveLayerClips(clips, 2)).toBe(getLiveLayerClips(clips, 5));
  });
});

describe("clipToPreroll", () => {
  // a: 0-4, b: 4-8 (disabled), c: 8-12 — the same fixture the rest of this
  // file uses, so the disabled-clip case is the one already modelled here.
  const LEAD = 1;

  it("names the next clip once the cut is inside the lead", () => {
    expect(clipToPreroll(clips, clips[0]!, 3.5, LEAD)?.id).toBe("c");
  });

  it("is null while the cut is still far off", () => {
    // Seeking a clip four seconds early buys nothing and takes a decoder off
    // the one that is playing.
    expect(clipToPreroll(clips, clips[0]!, 2.5, LEAD)).toBeNull();
  });

  it("SKIPS A DISABLED CLIP, because playback skips it too", () => {
    // `b` starts at 4 and would be the next clip by position. Preparing it
    // would put an element in position for a cut that never comes AND leave
    // `c` — the clip actually next — still cold, which is the failure this
    // whole change exists to remove.
    const at = clipToPreroll(clips, clips[0]!, 3.5, LEAD);
    expect(at?.id).not.toBe("b");
  });

  it("ignores a cut already reached", () => {
    // Exactly on the boundary the clip is the ACTIVE one, not the next one;
    // returning it here would re-seek the element that is currently playing.
    expect(clipToPreroll(clips, clips[0]!, 8, LEAD)).toBeNull();
  });

  it("never looks backwards", () => {
    // Late in the timeline there is nothing ahead to prepare.
    expect(clipToPreroll(clips, clips[2]!, 11.5, LEAD)).toBeNull();
  });

  it("takes the SOONEST cut when several are in the window", () => {
    const dense = [image("a", 0, 4), image("x", 4.5, 1), image("y", 4.2, 1)];
    expect(clipToPreroll(dense, dense[0]!, 3.6, LEAD)?.id).toBe("y");
  });

  it("does not mistake a clip sharing the active clip's start for the next one", () => {
    // A layered timeline has clips starting together; the one under the
    // picture is not the thing after it.
    const layered = [image("pic", 0, 4), image("bed", 0, 4), image("next", 4, 4)];
    expect(clipToPreroll(layered, layered[0]!, 3.5, LEAD)?.id).toBe("next");
  });
});
