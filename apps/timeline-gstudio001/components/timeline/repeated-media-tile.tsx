import React from "react";
import { TimelineClip, VideoTimelineClip } from "./types";
import {
  getEndpointFrameTimes,
  getThumbnailSlotCount,
  getVideoThumbnailUrl,
} from "./video-source-filmstrip";
import { Folder, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type RepeatedMediaTileProps = {
  clip: TimelineClip;
  displayWidth: number;
  previewTime: number;
  itemHeight: number;
  pixelsPerSecond?: number;
  onDurationLoaded?: (duration: number) => void;
};

function handleImageFallback(
  event: React.SyntheticEvent<HTMLImageElement>,
  fallbackSrc?: string,
) {
  if (!fallbackSrc || event.currentTarget.src === fallbackSrc) return;
  event.currentTarget.src = fallbackSrc;
}


export function RepeatedMediaTile({
  clip,
  displayWidth,
  itemHeight,
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

  const isXS = itemHeight === 80;

  if (clip.kind === "collection") {
    const previewItems = clip.previewItems ?? [];

    return (
      <div className={cn(
        "group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-lg border border-sky-500/20 bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 shadow-xl transition-all duration-300 hover:border-sky-500/40 hover:shadow-sky-950/20 select-none",
        isXS ? "p-2.5" : "p-3.5"
      )}>
        {/* Glowing gradient indicator bar */}
        <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-sky-400 via-indigo-500 to-transparent opacity-80" />

        {/* Thumbnail preview collage slots */}
        {!isXS && (
          <div className="grid h-[54%] grid-cols-3 gap-1.5 rounded-lg bg-zinc-950/70 p-1.5 border border-zinc-900/80 shadow-inner">
            {Array.from({ length: 3 }).map((_, index) => {
              const item = previewItems[index];

              return (
                <div
                  key={item?.id ?? `${clip.id}-empty-preview-${index}`}
                  className="relative h-full w-full overflow-hidden rounded-[4px] bg-zinc-900/60 border border-zinc-800/40 transition-all duration-200"
                >
                  {item ? (
                    item.kind === "video" ? (
                      <img
                        src={getVideoThumbnailUrl(item.src, 0)}
                        alt={item.alt}
                        className="h-full w-full object-cover grayscale-[10%] contrast-[105%] brightness-[95%] transition-transform duration-300 group-hover:scale-105"
                        draggable={false}
                        onError={(event) => handleImageFallback(event, item.poster)}
                      />
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={item.src}
                        alt={item.alt}
                        draggable={false}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    )
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-800">
                      <Plus className="h-3 w-3 opacity-30" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Folder Header title & pill badge info */}
        <div className={cn("min-w-0 flex flex-col justify-end", isXS ? "pt-0 h-full" : "pt-2")}>
          <h4 className="truncate text-xs font-bold text-zinc-100 tracking-wide group-hover:text-sky-300 transition-colors">
            {clip.title}
          </h4>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-400 border border-sky-500/20">
              <Folder className="h-2.5 w-2.5 shrink-0" />
              {clip.itemCount} {clip.itemCount === 1 ? 'asset' : 'assets'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const frameWidth = isXS ? displayWidth : Math.max(56, Math.min(itemHeight, 96));
  const frameHeight = isXS ? itemHeight : Math.max(56, Math.min(itemHeight, 96));
  const tileCount = isXS ? 1 : getThumbnailSlotCount(displayWidth, frameWidth);
  const sourceDuration = (clip as VideoTimelineClip).sourceDuration || clip.duration || 10;
  const start = 0;
  const end = Math.max(0, sourceDuration - 0.05);
  const frameTimes = getEndpointFrameTimes({
    count: tileCount,
    startTime: start,
    endTime: end,
  });

  return (
    <div className="pointer-events-none relative h-full w-full overflow-hidden">
      <div className="absolute inset-0 flex items-center">
        {frameTimes.map((tileTime, index) => {
          return (
            <div
              key={`${clip.id}-repeat-frame-${index}`}
              className="relative shrink-0 overflow-hidden border-r border-black/35 last:border-r-0 bg-black"
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
          );
        })}
      </div>
    </div>
  );
}
