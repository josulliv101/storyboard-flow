import React from "react";
import { TimelineClip, VideoTimelineClip } from "./types";
import { cn } from "@/lib/utils";
import { getVideoThumbnailUrl } from "./video-source-filmstrip";

type RepeatedMediaTileProps = {
  clip: TimelineClip;
  displayWidth: number;
  previewTime: number;
  itemHeight: number;
  pixelsPerSecond?: number;
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
  pixelsPerSecond,
  onDurationLoaded,
}: RepeatedMediaTileProps) {
  React.useEffect(() => {
    if (!onDurationLoaded || clip.kind !== "video") return;

    const videoClip = clip as VideoTimelineClip;
    if (!videoClip.src) return;

    const tempVideo = document.createElement("video");
    tempVideo.src = videoClip.src;
    tempVideo.preload = "metadata";

    const handleLoadedMetadata = () => {
      onDurationLoaded(tempVideo.duration);
    };

    tempVideo.addEventListener("loadedmetadata", handleLoadedMetadata);

    return () => {
      tempVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
      tempVideo.removeAttribute("src");
      tempVideo.load();
    };
  }, [clip, onDurationLoaded]);

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
                    <img
                      src={getVideoThumbnailUrl(item.src, 0)}
                      alt={item.alt}
                      className="h-full w-full object-cover"
                      draggable={false}
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

  const pps = pixelsPerSecond ?? 50;
  const tileDuration = naturalFrameWidth / pps;
  const sourceDuration = (clip as VideoTimelineClip).sourceDuration || clip.duration || 10;

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
          const start = (clip as VideoTimelineClip).trimIn || 0;
          const duration = clip.duration || 10;
          const progress = index / Math.max(1, tileCount - 1);
          const tileTime = Math.min(
            sourceDuration - 0.05,
            Math.max(0, start + duration * progress)
          );

          return (
            <div
              key={`${clip.id}-repeat-frame-${index}`}
              className={cn(
                "h-full shrink-0 overflow-hidden border-r border-black/35 last:border-r-0 relative bg-black",
              )}
              style={{ width: `${naturalFrameWidth}px` }}
              aria-hidden={index !== centerIndex}
            >
              <div className="h-full w-full">
                {clip.kind === "video" ? (
                  <img
                    src={getVideoThumbnailUrl(clip.src, tileTime)}
                    alt={
                      index === centerIndex
                        ? clip.alt
                        : `${clip.alt} repeated frame ${index + 1}`
                    }
                    className="h-full w-full object-cover"
                    draggable={false}
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
          );
        })}
      </div>
    </div>
  );
}
