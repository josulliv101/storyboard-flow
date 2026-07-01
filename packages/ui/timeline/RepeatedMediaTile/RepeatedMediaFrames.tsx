import type { MediaTimelineClip, VideoTimelineClip } from "../types";
import {
  getEndpointFrameTimes,
  getThumbnailSlotCount,
  getVideoThumbnailUrl,
} from "../media-thumbnails";
import { handleImageFallback } from "./image-fallback";

type RepeatedMediaFramesProps = {
  clip: MediaTimelineClip;
  displayWidth: number;
  itemHeight: number;
  isXS: boolean;
};

export function RepeatedMediaFrames({
  clip,
  displayWidth,
  itemHeight,
  isXS,
}: RepeatedMediaFramesProps) {
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

  return (
    <div className="pointer-events-none relative h-full w-full overflow-hidden">
      <div className="absolute inset-0 flex items-center">
        {frameTimes.map((tileTime, index) => (
          <div
            key={`${clip.id}-repeat-frame-${index}`}
            className="relative shrink-0 overflow-hidden border-r border-black/35 bg-black last:border-r-0"
            style={{ width: `${frameWidth}px`, height: `${frameHeight}px` }}
          >
            <div className="h-full w-full">
              {clip.kind === "video" ? (
                <img
                  src={getVideoThumbnailUrl(clip.src, tileTime)}
                  alt={`${clip.alt} frame ${index + 1}`}
                  className="h-full w-full object-cover"
                  draggable={false}
                  onError={(event) => handleImageFallback(event, clip.poster)}
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={clip.src}
                  alt={clip.alt}
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
