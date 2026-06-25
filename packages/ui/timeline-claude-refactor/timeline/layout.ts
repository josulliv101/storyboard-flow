import type { TimelineClip } from "../types";
import { CLIP_GAP_SECONDS } from "../constants";

export function getPackedDurationBefore(
  clips: TimelineClip[],
  anchorIndex: number,
): number {
  let durationBefore = 0;

  for (let index = 0; index < anchorIndex; index += 1) {
    durationBefore += clips[index].duration;
    durationBefore += CLIP_GAP_SECONDS;
  }

  return durationBefore;
}

/**
 * Repacks every clip around a single anchor clip whose geometry has already
 * been decided by the caller (e.g. after a resize or source-window edit).
 *
 * Clips before the anchor are packed backwards so earlier clips slide with a
 * moving left edge. Clips after the anchor are packed forwards so later
 * clips follow a moving right edge.
 */
export function layoutClipsAroundAnchor(
  clips: TimelineClip[],
  anchorIndex: number,
  anchorClip: TimelineClip,
): TimelineClip[] {
  const nextClips = clips.map((clip) => ({ ...clip }));
  nextClips[anchorIndex] = anchorClip;

  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const clipToRight = nextClips[index + 1];
    const endTime = clipToRight.startTime - CLIP_GAP_SECONDS;
    nextClips[index] = {
      ...nextClips[index],
      startTime: endTime - nextClips[index].duration,
    };
  }

  for (let index = anchorIndex + 1; index < nextClips.length; index += 1) {
    const clipToLeft = nextClips[index - 1];
    nextClips[index] = {
      ...nextClips[index],
      startTime: clipToLeft.startTime + clipToLeft.duration + CLIP_GAP_SECONDS,
    };
  }

  return nextClips;
}
