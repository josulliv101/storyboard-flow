import type { TimelineClip, VideoSourceWindowEditMode } from "../types";
import { clamp } from "../utils/math";
import { getPackedDurationBefore, layoutClipsAroundAnchor } from "./layout";

/**
 * Edits which window of a video's source material is mapped onto its
 * (fixed-duration) timeline slot, or moves/resizes that slot.
 *
 * - "move" / "center": shifts trimIn/trimOut without changing duration or
 *   timeline position.
 * - "left" / "right": behaves like a timeline trim but expressed in
 *   source-time coordinates, so it can also slide the slot.
 */
export function editVideoSourceWindowFromBaseline({
  baselineClips,
  anchorIndex,
  mode,
  deltaTime = 0,
  sourceTime = 0,
  minDuration,
}: {
  baselineClips: TimelineClip[];
  anchorIndex: number;
  mode: VideoSourceWindowEditMode;
  deltaTime?: number;
  sourceTime?: number;
  minDuration: number;
}): TimelineClip[] {
  const clip = baselineClips[anchorIndex];
  if (!clip || clip.kind !== "video") return baselineClips;

  if (mode === "move" || mode === "center") {
    const maxTrimIn = Math.max(0, clip.sourceDuration - clip.duration);
    const nextTrimIn =
      mode === "center"
        ? clamp(sourceTime - clip.duration / 2, 0, maxTrimIn)
        : clamp(clip.trimIn + deltaTime, 0, maxTrimIn);
    const nextTrimOut = Math.max(
      0,
      clip.sourceDuration - nextTrimIn - clip.duration,
    );

    const nextClips = baselineClips.map((currentClip) => ({ ...currentClip }));
    nextClips[anchorIndex] = {
      ...clip,
      trimIn: nextTrimIn,
      trimOut: nextTrimOut,
    };

    return nextClips;
  }

  if (mode === "left") {
    const fixedTimelineRightTime = clip.startTime + clip.duration;
    const fixedSourceOutTime = clip.sourceDuration - clip.trimOut;
    const desiredTrimIn = clamp(
      sourceTime,
      0,
      Math.max(0, fixedSourceOutTime - minDuration),
    );
    const desiredDuration = fixedSourceOutTime - desiredTrimIn;
    const desiredStartTime = fixedTimelineRightTime - desiredDuration;
    const earliestStartFromSource = fixedTimelineRightTime - fixedSourceOutTime;
    const earliestStartFromLayout = getPackedDurationBefore(
      baselineClips,
      anchorIndex,
    );
    const nextStartTime = clamp(
      desiredStartTime,
      Math.max(earliestStartFromSource, earliestStartFromLayout),
      fixedTimelineRightTime - minDuration,
    );
    const nextDuration = fixedTimelineRightTime - nextStartTime;
    const nextTrimIn = clamp(
      fixedSourceOutTime - nextDuration,
      0,
      Math.max(0, fixedSourceOutTime - minDuration),
    );

    const resizedClip: TimelineClip = {
      ...clip,
      startTime: nextStartTime,
      duration: nextDuration,
      trimIn: nextTrimIn,
    };

    return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip);
  }

  // mode === "right"
  const fixedSourceInTime = clip.trimIn;
  const desiredSourceOutTime = clamp(
    sourceTime,
    fixedSourceInTime + minDuration,
    clip.sourceDuration,
  );
  const nextDuration = desiredSourceOutTime - fixedSourceInTime;
  const nextTrimOut = Math.max(0, clip.sourceDuration - desiredSourceOutTime);

  const resizedClip: TimelineClip = {
    ...clip,
    duration: nextDuration,
    trimOut: nextTrimOut,
  };

  return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip);
}
