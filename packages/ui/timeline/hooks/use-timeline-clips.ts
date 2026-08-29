import { TimelineClip, VideoSourceWindowEditMode } from "../types";
import {
  baseWidth,
  clamp,
  cycle,
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
      src: cycle(VIDEO_SOURCES, index, "VIDEO_SOURCES"),
      duration: 12,
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

  // Walking OUTWARD from the anchor, so each step's neighbour was written by
  // the previous one and `current` is inside the array by the loop bound. Both
  // are read into consts and checked rather than indexed three times each: a
  // hole here would silently produce `NaN` startTimes that pack every later
  // clip on top of its neighbour, which is far harder to trace than a stop.
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const clipToRight = nextClips[index + 1];
    const current = nextClips[index];
    if (clipToRight === undefined || current === undefined) break;
    const endTime = clipToRight.startTime - CLIP_GAP_SECONDS;
    nextClips[index] = { ...current, startTime: endTime - current.duration };
  }

  for (let index = anchorIndex + 1; index < nextClips.length; index += 1) {
    const clipToLeft = nextClips[index - 1];
    const current = nextClips[index];
    if (clipToLeft === undefined || current === undefined) break;
    nextClips[index] = {
      ...current,
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

  if (clip.kind === "image") {
    const nextDuration = Math.max(
      minDuration,
      edge === "left" ? clip.duration - deltaTime : clip.duration + deltaTime,
    );
    const resizedClip: TimelineClip = {
      ...clip,
      duration: nextDuration,
      sourceDuration: Math.max(clip.sourceDuration, nextDuration),
      trimIn: 0,
      trimOut: 0,
    };

    return packClipsLeftToRight(baselineClips, anchorIndex, resizedClip);
  }

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

  // entries() rather than an index: the loop only ever wanted each clip and
  // its position, and indexing three times per iteration is what made this
  // read as three separate lookups that could disagree.
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;
  for (const [index, clip] of nextClips.entries()) {
    nextClips[index] = { ...clip, startTime: nextStartTime };
    nextStartTime += clip.duration + CLIP_GAP_SECONDS;
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
  // `findIndex` found it above, so the splice removed exactly one — but the
  // destructure cannot know that. Returning the baseline unchanged is the same
  // answer the not-found branch already gives.
  if (activeClip === undefined) return baselineClips;
  nextClips.splice(clamp(Math.floor(targetIndex), 0, nextClips.length), 0, activeClip);

  return reindexAndPackClips(nextClips);
}

export function editVideoSourceWindowFromBaseline({
  baselineClips,
  anchorIndex,
  mode,
  deltaTime = 0,
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
  if (!clip || (clip.kind !== "video" && clip.kind !== "collection" && clip.kind !== "image")) return baselineClips;

  if (clip.kind === "image") {
    if (mode !== "left" && mode !== "right") return baselineClips;

    if (mode === "left") {
      const nextDuration = Math.max(minDuration, clip.duration - deltaTime);
      const resizedClip: TimelineClip = {
        ...clip,
        duration: nextDuration,
        sourceDuration: Math.max(clip.sourceDuration, nextDuration),
        trimIn: 0,
        trimOut: 0,
      };
      return packClipsLeftToRight(baselineClips, anchorIndex, resizedClip);
    }

    const nextDuration = Math.max(minDuration, clip.duration + deltaTime);
    const resizedClip: TimelineClip = {
      ...clip,
      duration: nextDuration,
      sourceDuration: Math.max(clip.sourceDuration, nextDuration),
      trimIn: 0,
      trimOut: 0,
    };
    return packClipsLeftToRight(baselineClips, anchorIndex, resizedClip);
  }

  if (clip.kind === "collection") {
    if (mode !== "left" && mode !== "right") return baselineClips;

    const sourceDuration = Math.max(clip.sourceDuration, clip.duration);

    if (mode === "left") {
      const maxTrimIn = Math.max(0, sourceDuration - clip.trimOut - minDuration);
      const nextTrimIn = clamp(clip.trimIn + deltaTime, 0, maxTrimIn);
      const trimDiff = nextTrimIn - clip.trimIn;
      const resizedClip: TimelineClip = {
        ...clip,
        sourceDuration,
        trimIn: nextTrimIn,
        duration: clip.duration - trimDiff,
      };
      return packClipsLeftToRight(baselineClips, anchorIndex, resizedClip);
    }

    const maxDuration = sourceDuration - clip.trimIn;
    const nextDuration = clamp(clip.duration + deltaTime, minDuration, maxDuration);
    const resizedClip: TimelineClip = {
      ...clip,
      sourceDuration,
      duration: nextDuration,
      trimOut: Math.max(0, sourceDuration - clip.trimIn - nextDuration),
    };
    return packClipsLeftToRight(baselineClips, anchorIndex, resizedClip);
  }

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
