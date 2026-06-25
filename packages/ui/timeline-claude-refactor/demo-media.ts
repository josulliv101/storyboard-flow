import type { MediaSpec } from "./types";
import { ITEM_HEIGHT } from "./constants";

const VIDEO_SOURCES = [
  "https://www.w3schools.com/html/mov_bbb.mp4",
  "https://www.w3schools.com/html/movie.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
];

export const MEDIA: MediaSpec[] = [
  { kind: "image", aspect: 16 / 9 },
  { kind: "video", aspect: 16 / 9, src: VIDEO_SOURCES[0] },
  { kind: "image", aspect: 2 / 3 },
  { kind: "image", aspect: 1 },
  { kind: "video", aspect: 3 / 2, src: VIDEO_SOURCES[1] },
  { kind: "image", aspect: 16 / 9 },
  { kind: "image", aspect: 2 / 3 },
  { kind: "video", aspect: 1, src: VIDEO_SOURCES[2] },
  { kind: "image", aspect: 3 / 2 },
];

export function getSpec(index: number): MediaSpec {
  return MEDIA[index % MEDIA.length];
}

export function baseWidth(index: number): number {
  return Math.round(ITEM_HEIGHT * getSpec(index).aspect);
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
