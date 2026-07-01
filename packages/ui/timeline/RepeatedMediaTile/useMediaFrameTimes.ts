import type { MediaTimelineClip, TimelineClip, VideoTimelineClip } from "../types";
import { getEndpointFrameTimes, getThumbnailSlotCount } from "../media-thumbnails";

export type MediaFrameTimesResult = {
  frameTimes: number[];
  frameWidth: number;
  frameHeight: number;
  isVideo: boolean;
  mediaClip: MediaTimelineClip;
};

export function useMediaFrameTimes(
  clip: TimelineClip,
  displayWidth: number,
  itemHeight: number,
  isXS: boolean,
): MediaFrameTimesResult {
  const isVideo = clip.kind === "video";
  const mediaClip = clip as MediaTimelineClip;
  const frameWidth = isXS ? displayWidth : Math.max(56, Math.min(itemHeight, 96));
  const frameHeight = isXS ? itemHeight : Math.max(56, Math.min(itemHeight, 96));
  const tileCount = isXS ? 1 : getThumbnailSlotCount(displayWidth, frameWidth);
  const sourceDuration =
    (clip as VideoTimelineClip).sourceDuration || clip.duration || 10;
  const end = Math.max(0, sourceDuration - 0.05);
  const frameTimes = getEndpointFrameTimes({
    count: tileCount,
    startTime: 0,
    endTime: end,
  });

  return { frameTimes, frameWidth, frameHeight, isVideo, mediaClip };
}
