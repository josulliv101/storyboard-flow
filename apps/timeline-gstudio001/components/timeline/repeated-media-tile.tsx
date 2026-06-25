import React from "react";
import { TimelineClip } from "./types";
import { ITEM_HEIGHT } from "./constants";
import { cn } from "@/lib/utils";
import { VideoTile } from "./video-tile";

type RepeatedMediaTileProps = {
  clip: TimelineClip;
  displayWidth: number;
  previewTime: number;
  itemHeight: number;
  onDurationLoaded?: (duration: number) => void;
};

function getOddTileCount(value: number) {
  const safeValue = Math.max(1, Math.ceil(value));
  return safeValue % 2 === 1 ? safeValue : safeValue + 1;
}

export function RepeatedMediaTile({
  clip,
  displayWidth,
  previewTime,
  itemHeight,
  onDurationLoaded,
}: RepeatedMediaTileProps) {
  const naturalAspect = clip.kind === "image" ? 16 / 9 : clip.aspect;
  const naturalFrameWidth = Math.max(120, Math.round(itemHeight * naturalAspect));
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
        {Array.from({ length: tileCount }, (_, index) => {
          const diff = Math.abs(index - centerIndex);
          const opacity = diff === 0 ? 1 : Math.max(0.1, 1 - diff * 0.45);

          return (
            <div
              key={`${clip.id}-repeat-frame-${index}`}
              className={cn(
                "h-full shrink-0 overflow-hidden border-r border-black/35 last:border-r-0 transition-opacity relative bg-black",
              )}
              style={{ width: `${naturalFrameWidth}px` }}
              aria-hidden={index !== centerIndex}
            >
              <div className="h-full w-full" style={{ opacity }}>
                {clip.kind === "video" ? (
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
                    onDurationLoaded={index === centerIndex ? onDurationLoaded : undefined}
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
              {diff > 0 && (
                <div className="absolute inset-0 flex items-center justify-center gap-4">
                  {Array.from({ length: diff }).map((_, i) => (
                    <div key={i} className="h-8 w-8 rounded-full bg-black/60" />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
