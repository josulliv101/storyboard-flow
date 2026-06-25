import type { TimelineClip, TrimEdge } from "../types";
import { clamp } from "../utils/math";
import { getPackedDurationBefore, layoutClipsAroundAnchor } from "./layout";

/**
 * Resizes a clip's visible timeline edge (left or right trim handle) and
 * repacks neighboring clips around it.
 *
 * - Right edge: only changes duration/trimOut. Downstream clips follow.
 * - Left edge: moves startTime and duration together while the right edge
 *   stays fixed, then earlier clips are packed backwards to make room.
 */
export function resizeClipsFromBaseline({
  baselineClips,
  anchorIndex,
  edge,
  deltaTime,
  minDuration,
}: {
  baselineClips: TimelineClip[];
  anchorIndex: number;
  edge: TrimEdge;
  deltaTime: number;
  minDuration: number;
}): TimelineClip[] {
  const clip = baselineClips[anchorIndex];
  if (!clip) return baselineClips;

  if (edge === "left") {
    const fixedRightTime = clip.startTime + clip.duration;
    const maxDurationFromSource = clip.sourceDuration - clip.trimOut;
    const earliestStartFromSource = fixedRightTime - maxDurationFromSource;
    const earliestStartFromLayout = getPackedDurationBefore(
      baselineClips,
      anchorIndex,
    );
    const latestStart = fixedRightTime - minDuration;

    const nextStartTime = clamp(
      clip.startTime + deltaTime,
      Math.max(earliestStartFromSource, earliestStartFromLayout),
      latestStart,
    );
    const nextDuration = fixedRightTime - nextStartTime;
    const nextTrimIn = clamp(
      clip.sourceDuration - clip.trimOut - nextDuration,
      0,
      clip.sourceDuration - clip.trimOut - minDuration,
    );

    const resizedClip: TimelineClip = {
      ...clip,
      startTime: nextStartTime,
      duration: nextDuration,
      trimIn: nextTrimIn,
    };

    return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip);
  }

  const maxDurationFromSource = clip.sourceDuration - clip.trimIn;
  const nextDuration = clamp(
    clip.duration + deltaTime,
    minDuration,
    maxDurationFromSource,
  );
  const nextTrimOut = clamp(
    clip.sourceDuration - clip.trimIn - nextDuration,
    0,
    clip.sourceDuration - clip.trimIn - minDuration,
  );

  const resizedClip: TimelineClip = {
    ...clip,
    duration: nextDuration,
    trimOut: nextTrimOut,
  };

  return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip);
}

/**
 * Returns the source-time position a trim handle should preview/scrub to.
 * Left handle previews the visible in-point; right handle previews the
 * visible out-point. Subtracts a tiny epsilon at the absolute source end so
 * browsers don't clamp to a blank/unstable terminal frame.
 */
export function getTrimHandleSourceTime(
  clip: TimelineClip,
  edge: TrimEdge,
): number {
  const frameEpsilon = Math.min(1 / 60, clip.sourceDuration / 200);
  const sourceOutTime = clip.trimIn + clip.duration;
  const rawTime = edge === "left" ? clip.trimIn : sourceOutTime;

  return clamp(rawTime, 0, Math.max(0, clip.sourceDuration - frameEpsilon));
}
