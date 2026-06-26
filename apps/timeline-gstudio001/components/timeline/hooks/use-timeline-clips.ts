import { TimelineClip, VideoSourceWindowEditMode } from "../types";
import {
  baseWidth,
  clamp,
  getPackedDurationBefore,
  getSpec,
} from "../utils";
import {
  CLIP_GAP_SECONDS,
  MAX_WIDTH,
  MIN_WIDTH,
  TIMELINE_LEADING_PADDING_SECONDS,
  VIDEO_SOURCES,
} from "../constants";

export function createClip(
  index: number,
  startTime: number,
  pixelsPerSecond: number,
  forceVideo?: boolean,
): TimelineClip {
  let spec = getSpec(index);
  
  if (forceVideo && spec.kind !== "video") {
    spec = {
      ...spec,
      kind: "video",
      src: VIDEO_SOURCES[index % VIDEO_SOURCES.length],
      duration: 15,
    };
  }

  const visibleWidth = clamp(baseWidth(index), MIN_WIDTH, MAX_WIDTH);
  const sourceDuration = spec.kind === "video" && spec.duration ? spec.duration : 60;
  const sourceWidth = sourceDuration * pixelsPerSecond;
  const duration = visibleWidth / pixelsPerSecond;

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

  return {
    id: `clip-${index}`,
    index,
    kind: "image",
    src: `https://picsum.photos/seed/smooth-scroll-${index}/${Math.min(Math.round(sourceWidth), 1920)}/200`,
    alt: `Image ${index}`,
    aspect: spec.aspect,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration,
    trimIn,
    trimOut,
  };
}

export function createInitialClips(itemCount: number, pixelsPerSecond: number) {
  const clips: TimelineClip[] = [];
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;

  for (let index = 0; index < itemCount; index += 1) {
    const isFirst = index === 0;
    const isLast = index === itemCount - 1;
    const forceVideo = isFirst || isLast;
    
    const clip = createClip(index, nextStartTime, pixelsPerSecond, forceVideo);
    clips.push(clip);
    nextStartTime += clip.duration + CLIP_GAP_SECONDS;
  }

  return clips;
}

export function layoutClipsAroundAnchor(
  clips: TimelineClip[],
  anchorIndex: number,
  anchorClip: TimelineClip,
) {
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

export function resizeClipsFromBaseline({
  baselineClips,
  anchorIndex,
  edge,
  deltaTime,
  minDuration,
}: {
  baselineClips: TimelineClip[];
  anchorIndex: number;
  edge: "left" | "right";
  deltaTime: number;
  minDuration: number;
}) {
  const clip = baselineClips[anchorIndex];
  if (!clip) return baselineClips;

  if (edge === "left") {
    const maxDurationFromSource = clip.sourceDuration - clip.trimOut;
    // We are dragging the left edge, so decreasing trimIn and increasing duration.
    // deltaTime is negative when dragging left.
    const nextDuration = clamp(
      clip.duration - deltaTime,
      minDuration,
      maxDurationFromSource,
    );
    const nextTrimIn = clamp(
      clip.sourceDuration - clip.trimOut - nextDuration,
      0,
      clip.sourceDuration - clip.trimOut - minDuration,
    );

    const resizedClip: TimelineClip = {
      ...clip,
      duration: nextDuration,
      trimIn: nextTrimIn,
    };

    return packClipsLeftToRight(baselineClips, anchorIndex, resizedClip);
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

  return packClipsLeftToRight(baselineClips, anchorIndex, resizedClip);
}

export function packClipsLeftToRight(
  clips: TimelineClip[],
  anchorIndex: number,
  anchorClip: TimelineClip,
) {
  const nextClips = clips.map((clip) => ({ ...clip }));
  nextClips[anchorIndex] = anchorClip;

  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;
  for (let index = 0; index < nextClips.length; index += 1) {
    nextClips[index] = {
      ...nextClips[index],
      startTime: nextStartTime,
    };
    nextStartTime += nextClips[index].duration + CLIP_GAP_SECONDS;
  }

  return nextClips;
}

export function reindexAndPackClips(clips: TimelineClip[]) {
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;

  return clips.map((clip, index) => {
    const nextClip = {
      ...clip,
      index,
      startTime: nextStartTime,
    };
    nextStartTime += nextClip.duration + CLIP_GAP_SECONDS;
    return nextClip;
  });
}

export function reorderClipsFromBaseline({
  activeClipId,
  baselineClips,
  targetIndex,
}: {
  activeClipId: string;
  baselineClips: TimelineClip[];
  targetIndex: number;
}) {
  const sourceIndex = baselineClips.findIndex((clip) => clip.id === activeClipId);
  if (sourceIndex === -1) return baselineClips;

  const nextClips = baselineClips.map((clip) => ({ ...clip }));
  const [activeClip] = nextClips.splice(sourceIndex, 1);
  nextClips.splice(clamp(Math.floor(targetIndex), 0, nextClips.length), 0, activeClip);

  return reindexAndPackClips(nextClips);
}

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
}) {
  const clip = baselineClips[anchorIndex];
  if (!clip || clip.kind !== "video") return baselineClips;

  if (mode === "move" || mode === "center") {
    const maxTrimIn = Math.max(0, clip.sourceDuration - clip.duration);
    const nextTrimIn = clamp(clip.trimIn - deltaTime, 0, maxTrimIn);
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
    const maxTrimIn = Math.max(0, clip.sourceDuration - clip.trimOut - minDuration);
    const nextTrimIn = clamp(clip.trimIn + deltaTime, 0, maxTrimIn);
    const trimDiff = nextTrimIn - clip.trimIn;

    const resizedClip: TimelineClip = {
      ...clip,
      trimIn: nextTrimIn,
      duration: clip.duration - trimDiff,
    };

    return packClipsLeftToRight(baselineClips, anchorIndex, resizedClip);
  }

  if (mode === "right") {
    const maxDuration = clip.sourceDuration - clip.trimIn;
    const nextDuration = clamp(clip.duration + deltaTime, minDuration, maxDuration);
    const nextTrimOut = Math.max(0, clip.sourceDuration - clip.trimIn - nextDuration);

    const resizedClip: TimelineClip = {
      ...clip,
      duration: nextDuration,
      trimOut: nextTrimOut,
    };

    return packClipsLeftToRight(baselineClips, anchorIndex, resizedClip);
  }

  return baselineClips;
}
