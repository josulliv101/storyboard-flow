import React, { memo } from "react";
import { TimelineClip } from "./types";
import { formatSeconds } from "./utils";
import { ITEM_HEIGHT } from "./constants";
import { cn } from "@/lib/utils";
import { RepeatedMediaTile } from "./repeated-media-tile";
import { TrimHandle } from "./trim-handle";

type TimelineClipItemProps = {
  clip: TimelineClip;
  pixelsPerSecond: number;
  itemTop: number;
  thumbnailMode?: boolean;
  thumbnailWidth?: number;
  thumbnailGap?: number;
  itemHeight: number;
  isSelected: boolean;
  scrubPreviewTime?: number | null;
  isGrowingOpposite?: boolean;
  onResizeDown: (
    e: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: "left" | "right",
  ) => void;
  onResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (
    e: React.KeyboardEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: "left" | "right",
  ) => void;
  onDurationLoaded?: (index: number, duration: number) => void;
};

export const TimelineClipItem = memo(function TimelineClipItem({
  clip,
  pixelsPerSecond,
  itemTop,
  itemHeight,
  thumbnailMode = false,
  thumbnailWidth = (itemHeight * 16) / 9,
  thumbnailGap = 16,
  isSelected,
  scrubPreviewTime = null,
  isGrowingOpposite = false,
  onResizeDown,
  onResizeMove,
  onResizeUp,
  onResizeKeyDown,
  onDurationLoaded,
}: TimelineClipItemProps) {
  const left = thumbnailMode ? clip.index * (thumbnailWidth + thumbnailGap) : clip.startTime * pixelsPerSecond;
  const width = thumbnailMode ? thumbnailWidth : clip.duration * pixelsPerSecond;
  const sourceWidth = clip.sourceDuration * pixelsPerSecond;
  const trimInPx = clip.trimIn * pixelsPerSecond;

  return (
    <div
      data-clip-index={clip.index}
      className="absolute"
      style={{
        top: `${itemTop}px`,
        width: `${width}px`,
        height: `${itemHeight}px`,
        transform: `translateX(${left}px)`,
        zIndex: isSelected ? 30 : 0,
      }}
    >
      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-shadow",
          isSelected
            ? "ring-2 ring-amber-400 shadow-lg shadow-amber-400/20"
            : "ring-1 ring-zinc-900",
        )}
      >
        <RepeatedMediaTile
          clip={clip}
          displayWidth={width}
          previewTime={scrubPreviewTime ?? clip.trimIn}
          itemHeight={itemHeight}
          onDurationLoaded={onDurationLoaded ? (duration) => onDurationLoaded(clip.index, duration) : undefined}
        />

        {clip.kind === "video" && (
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            VIDEO
          </span>
        )}

        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100">
          {clip.kind === "video"
            ? `${formatSeconds(clip.duration)} / ${formatSeconds(clip.sourceDuration)}`
            : formatSeconds(clip.duration)}
        </span>

        {isGrowingOpposite && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[1px] transition-all">
            <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-black/80 px-3 py-1.5 text-xs font-medium text-amber-300 shadow-xl">
              <span>Growing Opposite</span>
              <svg className="h-4 w-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>
          </div>
        )}

        {isSelected && !thumbnailMode && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
            <TrimHandle
              edge="left"
              currentWidth={width}
              currentDuration={clip.duration}
              onPointerDown={(e) => onResizeDown(e, clip, "left")}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onKeyDown={(e) => onResizeKeyDown(e, clip, "left")}
            />
            <TrimHandle
              edge="right"
              currentWidth={width}
              currentDuration={clip.duration}
              onPointerDown={(e) => onResizeDown(e, clip, "right")}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onKeyDown={(e) => onResizeKeyDown(e, clip, "right")}
            />
          </>
        )}
        {isSelected && thumbnailMode && (
          <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
        )}
      </div>
    </div>
  );
});
