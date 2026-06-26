import { MediaSpec, TimelineClip } from "./types";
import {
  CLIP_GAP_SECONDS,
  MAX_WIDTH,
  MIN_WIDTH,
  VIDEO_SOURCES,
  ITEM_HEIGHT,
} from "./constants";

export const MEDIA: MediaSpec[] = [
  { kind: "image", aspect: 16 / 9 },
  { kind: "video", aspect: 16 / 9, src: VIDEO_SOURCES[0], duration: 10 },
  { kind: "video", aspect: 4 / 3, src: VIDEO_SOURCES[3], duration: 12 },
  { kind: "image", aspect: 2 / 3 },
  { kind: "image", aspect: 1 },
  { kind: "video", aspect: 3 / 2, src: VIDEO_SOURCES[1], duration: 9 },
  { kind: "video", aspect: 16 / 9, src: VIDEO_SOURCES[4], duration: 11 },
  { kind: "image", aspect: 16 / 9 },
  { kind: "image", aspect: 2 / 3 },
  { kind: "video", aspect: 1, src: VIDEO_SOURCES[2], duration: 8 },
  { kind: "video", aspect: 16 / 9, src: VIDEO_SOURCES[5], duration: 12 },
  { kind: "image", aspect: 3 / 2 },
  { kind: "video", aspect: 4 / 3, src: VIDEO_SOURCES[6], duration: 10 },
];

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getSourceTimeFromClientX({
  clientX,
  rectLeft,
  rectWidth,
  sourceDuration,
}: {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  sourceDuration: number;
}) {
  if (rectWidth <= 0 || sourceDuration <= 0) return 0;

  const localX = clamp(clientX - rectLeft, 0, rectWidth);
  return (localX / rectWidth) * sourceDuration;
}

export function formatSeconds(value: number) {
  if (value < 0.01) return "0s";
  if (value < 10) return `${value.toFixed(2)}s`;
  return `${value.toFixed(1)}s`;
}

export function getTrimHandleSourceTime(clip: TimelineClip, edge: "left" | "right") {
  const frameEpsilon = Math.min(1 / 60, clip.sourceDuration / 200);
  const sourceOutTime = clip.trimIn + clip.duration;
  const rawTime = edge === "left" ? clip.trimIn : sourceOutTime;

  return clamp(rawTime, 0, Math.max(0, clip.sourceDuration - frameEpsilon));
}

export function getFallbackImage(
  index: number,
  imageWidth: number,
): { src: string; alt: string } {
  return {
    src: `https://picsum.photos/seed/smooth-scroll-${index}/${imageWidth}/${ITEM_HEIGHT}`,
    alt: `Image ${index}`,
  };
}

export function getSpec(index: number) {
  return MEDIA[index % MEDIA.length];
}

export function baseWidth(index: number) {
  return Math.round(ITEM_HEIGHT * getSpec(index).aspect);
}

export function getPackedDurationBefore(clips: TimelineClip[], anchorIndex: number) {
  let durationBefore = 0;

  for (let index = 0; index < anchorIndex; index += 1) {
    durationBefore += clips[index].duration;
    durationBefore += CLIP_GAP_SECONDS;
  }

  return durationBefore;
}
