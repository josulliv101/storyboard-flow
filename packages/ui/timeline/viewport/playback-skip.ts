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

/** One array, reused. `getLiveLayerClips` runs per frame and the overwhelming
 *  majority of timelines have no lanes at all, so the common answer must not
 *  allocate. */
const NO_LAYERS: readonly TimelineClip[] = [];

/**
 * The clip the surface draws its frame FROM — the picture, and only ever the
 * picture.
 *
 * `getContainingClip` answers a different question ("is this time inside
 * material"), and its answer is right for `nextPlayableTime` and wrong here.
 * The two diverge at every cut: packing leaves `CLIP_GAP_SECONDS` between
 * picture clips, so on a timeline with a bed under it there is a ~120ms window
 * at EVERY cut that only the bed covers. Drawing what covers the time there
 * means flashing the audio stand-in three frames per cut.
 *
 * So, in order:
 *
 * - a lane-0 clip covering this time, first in array order — the common case;
 * - otherwise the most recently started lane-0 clip, HELD. A gap carries no new
 *   frame; it is not an instruction to stop showing the shot that was on
 *   screen. This is what closes the flash, and it is also the pre-existing gap
 *   rule, now restricted to the picture;
 * - otherwise, if the timeline has no lane-0 material AT ALL, whatever covers
 *   the time on any lane. A timeline of nothing but audio still has to draw its
 *   stand-in rather than an empty surface.
 *
 * Disabled clips are NOT skipped: scrubbing can rest inside one and the surface
 * draws it grayed. That is the opposite of `getLiveLayerClips` below, and the
 * asymmetry is deliberate — a disabled clip still occupies the screen, but it
 * must not make a sound.
 */
export function getPictureClip(clips: readonly TimelineClip[], currentTime: number) {
  let held: TimelineClip | null = null;
  let sawPicture = false;

  for (const clip of clips) {
    if (clip.trackIndex !== 0) continue;
    sawPicture = true;
    // First match wins, preserving the array-order rule within a lane.
    if (clipContainsPlaybackTime(clip, currentTime)) return clip;
    const start = getClipPlaybackStart(clip);
    if (start > currentTime) continue;
    if (held === null || start > getClipPlaybackStart(held)) held = clip;
  }

  if (held !== null) return held;
  // A leading gap on a real picture correctly yields null — nothing has been
  // shown yet, so there is nothing to hold.
  return sawPicture ? null : getContainingClip(clips, currentTime);
}

/**
 * Every under-layer audible at this instant: lane 1 and above, enabled, and
 * STRICTLY covering the time.
 *
 * Strict, where the picture holds. Holding a frame across a gap is right
 * because the screen cannot show nothing; holding SOUND across one would keep
 * playing a bed after it ended.
 *
 * Returned in array order rather than lane order. Draw order is the caller's
 * business and changes far less often than once a frame — sorting here would
 * allocate on every tick to answer a question that only matters when the live
 * set itself changes.
 */
export function getLiveLayerClips(
  clips: readonly TimelineClip[],
  currentTime: number,
): readonly TimelineClip[] {
  let live: TimelineClip[] | null = null;
  for (const clip of clips) {
    if (clip.trackIndex === 0) continue;
    if (clip.disabled === true) continue;
    if (!clipContainsPlaybackTime(clip, currentTime)) continue;
    (live ??= []).push(clip);
  }
  return live ?? NO_LAYERS;
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

/**
 * The clip whose media should be put in position NOW, or null.
 *
 * A cut used to cost a seek: the prefetch window downloaded the next clips but
 * left their elements paused wherever they happened to be, so the switch could
 * not show a frame until it had seeked. Measured against a steady 17ms frame
 * interval, that was 32-46ms at a cut into an untrimmed clip and 90-98ms into
 * one trimmed 1.7s in — the gap tracked the trim, which is what identified the
 * seek as the cost.
 *
 * `lead` is how far ahead to start. Only the SEEK is moved earlier by the
 * caller; the clip stays paused and silent, so nothing about when playback
 * switches changes.
 *
 * DISABLED CLIPS ARE SKIPPED, because playback skips them: pre-rolling one
 * would put an element in position for a cut that never comes, and leave the
 * clip that IS next still cold.
 */
export function clipToPreroll(
  clips: readonly TimelineClip[],
  active: TimelineClip,
  currentTime: number,
  lead: number,
): TimelineClip | null {
  const activeStart = getClipPlaybackStart(active);

  let soonest: TimelineClip | null = null;
  for (const clip of clips) {
    if (clip.disabled === true) continue;
    const start = getClipPlaybackStart(clip);
    // STRICTLY AFTER the active clip's start, so a clip sharing a start time
    // with the one on screen — a bed under the picture — is never mistaken for
    // the thing that follows it.
    if (start <= activeStart) continue;
    if (soonest === null || start < getClipPlaybackStart(soonest)) soonest = clip;
  }
  if (soonest === null) return null;

  // WHEN THE PICTURE ACTUALLY CHANGES, which is not simply the next clip's
  // start. A DISABLED span between them is skipped rather than played, so the
  // switch happens when the playhead leaves the active clip — measuring to the
  // next clip's start would put the window seconds late and never prepare it,
  // leaving precisely the cut that jumps furthest still cold. Taking the
  // EARLIER of the two is safe in the other direction too: across a real gap
  // the picture holds and this merely prepares early, which costs one seek
  // nobody is waiting on.
  const activeEnd = activeStart + getClipPlaybackDuration(active);
  const switchesNoLaterThan = Math.min(activeEnd, getClipPlaybackStart(soonest));
  const untilCut = switchesNoLaterThan - currentTime;
  // A cut already reached is not a cut to prepare for.
  if (untilCut <= 0 || untilCut > lead) return null;
  return soonest;
}
