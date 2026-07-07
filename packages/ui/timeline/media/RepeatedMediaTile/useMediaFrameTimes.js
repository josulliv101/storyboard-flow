import { getEndpointFrameTimes, getThumbnailSlotCount } from "../media-thumbnails";
import { clamp } from "../../utils";
export function useMediaFrameTimes(clip, displayWidth, itemHeight, isXS, previewTime) {
    const isVideo = clip.kind === "video";
    const mediaClip = clip;
    const frameWidth = isXS ? displayWidth : Math.max(56, Math.min(itemHeight, 96));
    const frameHeight = isXS ? itemHeight : Math.max(56, Math.min(itemHeight, 96));
    const tileCount = isXS ? 1 : getThumbnailSlotCount(displayWidth, frameWidth);
    const sourceDuration = clip.sourceDuration || clip.duration || 10;
    const end = Math.max(0, sourceDuration - 0.05);
    const frameTimes = isXS && isVideo
        ? [clamp(previewTime, 0, end)]
        : getEndpointFrameTimes({
            count: tileCount,
            startTime: 0,
            endTime: end,
        });
    return { frameTimes, frameWidth, frameHeight, isVideo, mediaClip };
}
