import type { MediaSpec, TimelineClip } from "./types";
import {
  CLIP_GAP_SECONDS,
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

/**
 * A PLAYHEAD'S TIME, as `m:ss.d` — 71.1s reads as `1:11.1`.
 *
 * NOT `formatSeconds`, and not a replacement for it. That one labels a
 * DURATION on a card ("4.25s", "0s"), where the unit is the point and the
 * value stands alone. This is a POSITION on a clock, read against another
 * position, where what matters is that the digits line up and that the last
 * one moves visibly under a dragging hand.
 *
 * TENTHS: frames would flicker faster than anyone can read, and hundredths
 * are two columns of noise. One place after the point changes about as fast
 * as the eye can follow it.
 *
 * ONE DEFINITION, deliberately, because the transport's readout and the
 * scrubber's hover tooltip both spend it and the spec's acceptance is that
 * they always agree. Two copies of this would agree until one of them was
 * rounded differently.
 */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  // QUANTISE FIRST, then split. Subtracting the minutes off in seconds and
  // flooring what is left is the obvious way to write this and it is wrong:
  // 71.1 - 60 is 11.099999999999994 in binary floating point, so the tenth
  // floors to 0 and the spec's own worked example renders `1:11.0`.
  //
  // FLOOR, not round, because a clock that rounds shows the next tenth before
  // it has arrived — a playhead parked exactly on a cut would read as past it.
  // The epsilon is 100 nanoseconds: far below anything a frame can express, and
  // enough to absorb the representation error that made 71.1 land just under.
  const tenths = Math.floor(safe * 10 + 1e-6);
  const minutes = Math.floor(tenths / 600);
  const whole = Math.floor(tenths / 10) % 60;
  const tenth = tenths % 10;
  return `${minutes}:${whole < 10 ? "0" : ""}${whole}.${tenth}`;
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

/**
 * Read a fixture array cyclically.
 *
 * Both callers index a non-empty literal with a modulo, so this never throws.
 * Written as a throw rather than `!` so that emptying the array fails HERE,
 * naming which array, instead of surfacing as `undefined.aspect` several
 * frames away in a caller.
 *
 * The double modulo also makes a NEGATIVE index wrap rather than miss, which
 * the bare `index % length` did not.
 */
export function cycle<T>(items: readonly T[], index: number, name: string): T {
  const value = items[((index % items.length) + items.length) % items.length];
  if (value === undefined) throw new Error(`${name} is empty`);
  return value;
}

export function getSpec(index: number) {
  return cycle(MEDIA, index, "MEDIA");
}

export function baseWidth(index: number) {
  return Math.round(ITEM_HEIGHT * getSpec(index).aspect);
}

export function getPackedDurationBefore(clips: TimelineClip[], anchorIndex: number) {
  let durationBefore = 0;

  // slice() rather than an index loop: `anchorIndex` is a caller's number and
  // may sit past the end, in which case slice simply stops — the old loop
  // would have added `undefined.duration`.
  for (const clip of clips.slice(0, Math.max(0, anchorIndex))) {
    durationBefore += clip.duration;
    durationBefore += CLIP_GAP_SECONDS;
  }

  return durationBefore;
}
