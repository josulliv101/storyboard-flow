import type { TimelineClip } from "../types";
import { MAX_WIDTH, MIN_WIDTH, TIMELINE_LEADING_PADDING_SECONDS, CLIP_GAP_SECONDS } from "../constants";
import { clamp } from "../utils/math";
import { baseWidth, getFallbackImage, getSpec } from "../demo-media";

export function createClip(
  index: number,
  startTime: number,
  pixelsPerSecond: number,
): TimelineClip {
  const spec = getSpec(index);
  const visibleWidth = clamp(baseWidth(index), MIN_WIDTH, MAX_WIDTH);
  const sourceWidth = MAX_WIDTH;
  const sourceDuration = sourceWidth / pixelsPerSecond;
  const duration = visibleWidth / pixelsPerSecond;

  // Demo clips have hidden source material on both sides so either handle can
  // shrink and then expand again. Real media should use real source duration,
  // trimIn, and trimOut values instead.
  const hiddenDuration = Math.max(0, sourceDuration - duration);
  const trimIn = hiddenDuration / 2;
  const trimOut = hiddenDuration - trimIn;

  if (spec.kind === "video") {
    return {
      id: `clip-${index}`,
      index,
      kind: "video",
      src: spec.src,
      alt: `Video ${index}`,
      aspect: spec.aspect,
      trackIndex: 0,
      startTime,
      duration,
      sourceDuration,
      trimIn,
      trimOut,
    };
  }

  const image = getFallbackImage(index, sourceWidth);

  return {
    id: `clip-${index}`,
    index,
    kind: "image",
    src: image.src,
    alt: image.alt,
    aspect: spec.aspect,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration,
    trimIn,
    trimOut,
  };
}

export function createInitialClips(
  itemCount: number,
  pixelsPerSecond: number,
): TimelineClip[] {
  const clips: TimelineClip[] = [];
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;

  for (let index = 0; index < itemCount; index += 1) {
    const clip = createClip(index, nextStartTime, pixelsPerSecond);
    clips.push(clip);
    nextStartTime += clip.duration + CLIP_GAP_SECONDS;
  }

  return clips;
}
