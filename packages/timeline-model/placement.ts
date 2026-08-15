import { packTimelineClips, trackIndexOf } from "./documents";
import type { TimelineClip } from "./types";

// Where a PLACED clip actually ends up.
//
// Placing a clip at an explicit time can put it on top of something already on
// that lane. Rather than refusing the write, the placement moves UP to the
// first lane with room — so a placement never fails and two clips never share
// a span on one row. The caller reports where it landed.

/**
 * Do two spans overlap? Touching does NOT count: a clip ending exactly where
 * the next begins is the ordinary back-to-back case, and treating it as a
 * collision would bump every clip that simply follows another.
 *
 * A zero-length span is inside another one when it falls strictly within it,
 * and clear of it at either edge. Left as it falls out of the comparison
 * rather than special-cased: an instant inside a clip IS inside it, and the
 * edges — where a zero-length clip would otherwise trip the back-to-back
 * rule — already read correctly.
 */
export function spansOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type Placement = Readonly<{
  /** The lane the clip ends up on — the one asked for, or the first above it
   *  with room. Never 0. */
  lane: number;
  /** True when a collision pushed it off the lane that was asked for. */
  bumped: boolean;
}>;

/**
 * Resolve the lane a clip should land on when placed at `placedStart`.
 *
 * WHY THIS PACKS RATHER THAN COMPARING NUMBERS. Overlap can only be judged
 * against packed positions, and the packed positions depend on the very
 * placement being judged: the moment this clip leaves its old lane, the queued
 * clips behind it close up, and the moment it arrives on a new one it pushes
 * the queue there along. Testing a proposed start against the CURRENT layout
 * would therefore compare it to positions that will not exist once the write
 * lands. So each candidate lane is applied for real, packed, and measured.
 *
 * Searches UPWARD from the requested lane and never considers lane 0 — lanes
 * stack away from the picture on the board, and the picture is a cut. The
 * search is bounded by the highest lane in use plus one, which by construction
 * holds nothing, so it always terminates with room found.
 *
 * `clips` is the collection's whole child list; `clipId` must be in it (an
 * unknown id is returned unmoved, which is what a caller that has already
 * validated existence will never see).
 */
export function resolvePlacement(
  clips: readonly TimelineClip[],
  clipId: string,
  desiredLane: number,
  placedStart: number,
): Placement {
  // Never the picture, whatever was asked for.
  const from = Math.max(1, trackIndexOf({ trackIndex: desiredLane }));
  if (!clips.some((clip) => clip.id === clipId)) return { lane: from, bumped: false };

  const highest = clips.reduce((top, clip) => Math.max(top, trackIndexOf(clip)), 0);

  for (let lane = from; lane <= highest + 1; lane += 1) {
    const packed = packTimelineClips(
      clips.map((clip) =>
        clip.id === clipId ? { ...clip, trackIndex: lane, placedStart } : clip,
      ),
    );
    const moved = packed.find((clip) => clip.id === clipId);
    if (!moved) continue;
    const movedEnd = moved.startTime + moved.duration;
    const collides = packed.some(
      (other) =>
        other.id !== clipId &&
        trackIndexOf(other) === lane &&
        spansOverlap(
          moved.startTime,
          movedEnd,
          other.startTime,
          other.startTime + other.duration,
        ),
    );
    if (!collides) return { lane, bumped: lane !== from };
  }

  // Unreachable: `highest + 1` holds nothing to collide with. Returned rather
  // than thrown so a caller can still write something sane if the invariant
  // above is ever broken by a future change to packing.
  return { lane: highest + 1, bumped: highest + 1 !== from };
}
