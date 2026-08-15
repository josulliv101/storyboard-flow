// Where the playhead is allowed to REST while playing — the pure half of the
// display surface's clock. No React, no DOM: the surface imports these and
// the unit suite exercises them directly.
//
// Disabled clips reach the player intact, occupying their full span (see
// timeline-domain/playback-manifest). That is deliberate — the span is what
// the board draws, what the ruler measures, and what a scrub can land inside.
// Skipping them is a PLAY-TIME decision, made here, because only the player
// knows the difference between playing (jump the span) and scrubbing (draw it
// grayed). Compiling them away instead would leave nothing to jump over.

import type { TimelineClip } from "../types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getClipPlaybackStart(clip: TimelineClip) {
  return clip.playbackStartTime ?? clip.startTime;
}

export function getClipPlaybackDuration(clip: TimelineClip) {
  return Math.max(0.001, clip.playbackDuration ?? clip.duration);
}

export function clipContainsPlaybackTime(clip: TimelineClip, currentTime: number) {
  const playbackStart = getClipPlaybackStart(clip);
  const playbackDuration = getClipPlaybackDuration(clip);
  return currentTime >= playbackStart && currentTime <= playbackStart + playbackDuration;
}

/**
 * The clip that literally covers this time — never one held over from
 * earlier. Callers deciding whether a time is INSIDE material (as opposed to
 * what to draw at it) must use this.
 *
 * THE LOWEST LANE WINS when several cover the same instant, which is what
 * lanes made possible. This used to take the first match in array order, and
 * the array is sorted by start time — so a bed starting at 0 could be found
 * before the shot starting at 0, and the surface would try to draw a clip
 * that has no picture. Lane 0 IS the picture; anything above it is running
 * underneath and is never what a frame comes from.
 *
 * `reduce` rather than a sort: this runs per frame while playing, and the
 * answer is one element.
 */
export function getContainingClip(clips: readonly TimelineClip[], currentTime: number) {
  let best: TimelineClip | null = null;
  for (const clip of clips) {
    if (!clipContainsPlaybackTime(clip, currentTime)) continue;
    // Strictly lower, so the FIRST clip on a given lane still wins ties —
    // preserving the old array-order behaviour within a lane.
    if (best === null || clip.trackIndex < best.trackIndex) best = clip;
  }
  return best;
}

export function getTimelineDuration(clips: readonly TimelineClip[]) {
  return clips.reduce(
    (duration, clip) =>
      Math.max(duration, getClipPlaybackStart(clip) + getClipPlaybackDuration(clip)),
    0,
  );
}

/**
 * The time playback should actually run at, given where the clock has reached.
 *
 * Three cases collapse into one rule — resume at the earliest moment from here
 * on that sits inside an ENABLED clip:
 *
 * - inside an enabled clip: stay put, the common case;
 * - inside a DISABLED clip: jump the whole item, landing on the next enabled
 *   clip rather than crawling through a span that will not be drawn;
 * - in a gap, or past the last clip: snap forward to the next enabled clip,
 *   or to the timeline's end when nothing playable follows.
 *
 * The gap rule predates disabling and is load-bearing: an empty span is not
 * silence, because the surface HOLDS the last drawn frame across it, so
 * dwelling in a gap freeze-frames instead of advancing.
 *
 * Consecutive disabled clips need no special handling — the scan is over every
 * enabled clip, not the immediate neighbour, so a run of them is one jump.
 *
 * PLAY PATH ONLY. Scrubbing deliberately does not call this: the user can put
 * the playhead anywhere, including inside a disabled clip, and the surface
 * draws that frame grayed.
 */
export function nextPlayableTime(
  clips: readonly TimelineClip[],
  time: number,
  duration: number,
): number {
  const bounded = clamp(time, 0, duration);
  const containing = getContainingClip(clips, bounded);
  if (containing && containing.disabled !== true) return bounded;

  // Past the end of a disabled clip we are skipping, or from here if the time
  // was in a gap to begin with.
  const from = containing
    ? getClipPlaybackStart(containing) + getClipPlaybackDuration(containing)
    : bounded;

  let earliest: number | null = null;
  for (const clip of clips) {
    if (clip.disabled === true) continue;
    const start = getClipPlaybackStart(clip);
    const end = start + getClipPlaybackDuration(clip);
    // Still ahead of us, or already under way and running past `from` — an
    // enabled clip that merely OVERLAPS the skipped one resumes mid-clip
    // rather than being jumped along with it.
    if (end < from) continue;
    const candidate = Math.max(start, from);
    if (earliest === null || candidate < earliest) earliest = candidate;
  }

  return earliest === null ? duration : clamp(earliest, 0, duration);
}
