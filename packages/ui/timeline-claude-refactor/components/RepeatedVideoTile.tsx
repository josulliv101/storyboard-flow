import type { TimelineClip } from "../types";
import { ITEM_HEIGHT } from "../constants";
import { cn } from "../../lib/utils";
import { VideoTile } from "./VideoTile";

export type RepeatedVideoTileProps = {
  clip: TimelineClip;
  displayWidth: number;
  previewTime: number;
};

function getOddTileCount(value: number) {
  const safeValue = Math.max(1, Math.ceil(value));
  return safeValue % 2 === 1 ? safeValue : safeValue + 1;
}

/**
 * Keep each still frame close to the media's natural display aspect. If a
 * clip gets very wide, repeat the same source frame instead of stretching
 * one video element across the full item and blurring it. The count is
 * always odd so one frame is centered in the visible item, with matching
 * repeated frames extending out to both sides.
 */
export function RepeatedVideoTile({
  clip,
  displayWidth,
  previewTime,
}: RepeatedVideoTileProps) {
  const naturalFrameWidth = Math.max(120, Math.round(ITEM_HEIGHT * clip.aspect));
  const tileCount = getOddTileCount(displayWidth / naturalFrameWidth);
  const centerIndex = Math.floor(tileCount / 2);

  return (
    <div className="pointer-events-none relative h-full w-full overflow-hidden">
      <div
        className="absolute left-1/2 top-0 flex h-full"
        style={{
          width: `${tileCount * naturalFrameWidth}px`,
          transform: "translateX(-50%)",
        }}
      >
        {Array.from({ length: tileCount }, (_, index) => (
          <div
            key={`${clip.id}-repeat-frame-${index}`}
            className={cn(
              "h-full shrink-0 overflow-hidden border-r border-black/35 last:border-r-0 transition-opacity",
              index === centerIndex ? "opacity-100" : "opacity-10",
            )}
            style={{ width: `${naturalFrameWidth}px` }}
            aria-hidden={index !== centerIndex}
          >
            <VideoTile
              src={clip.src}
              poster={clip.poster}
              alt={
                index === centerIndex
                  ? clip.alt
                  : `${clip.alt} repeated frame ${index + 1}`
              }
              previewTime={previewTime}
              sourceDuration={clip.sourceDuration}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
