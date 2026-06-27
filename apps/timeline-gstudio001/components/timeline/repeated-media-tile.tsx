import React from "react";
import { TimelineClip } from "./types";
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
  if (clip.kind === "collection") {
    const previewItems = clip.previewItems ?? [];

    return (
      <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-zinc-900 p-3">
        <div className="grid h-[58%] grid-cols-3 gap-1 overflow-hidden rounded">
          {Array.from({ length: 3 }).map((_, index) => {
            const item = previewItems[index];

            return (
              <div
                key={item?.id ?? `${clip.id}-empty-preview-${index}`}
                className="relative overflow-hidden rounded-sm bg-zinc-800"
              >
                {item ? (
                  item.kind === "video" ? (
                    <VideoTile
                      src={item.src}
                      poster={item.poster}
                      alt={item.alt}
                      previewTime={0}
                    />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.src}
                      alt={item.alt}
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  )
                ) : (
                  <div className="h-full w-full bg-zinc-800" />
                )}
              </div>
            );
          })}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-zinc-100">
            {clip.title}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-400">
            {clip.itemCount} nested items
          </div>
        </div>
      </div>
    );
  }

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
