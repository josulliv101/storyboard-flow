import type React from "react";
import { memo } from "react";
import type { TimelineClip, TrimEdge } from "../types";
import { ITEM_HEIGHT } from "../constants";
import { formatSeconds } from "../utils/math";
import { cn } from "../../lib/utils";
import { RepeatedVideoTile } from "./RepeatedVideoTile";
import { TrimHandle } from "./TrimHandle";

export type TimelineClipItemProps = {
  clip: TimelineClip;
  pixelsPerSecond: number;
  itemTop: number;
  isSelected: boolean;
  scrubPreviewTime?: number | null;
  onResizeDown: (
    e: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: TrimEdge,
  ) => void;
  onResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (
    e: React.KeyboardEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: TrimEdge,
  ) => void;
};

export const TimelineClipItem = memo(function TimelineClipItem({
  clip,
  pixelsPerSecond,
  itemTop,
  isSelected,
  scrubPreviewTime = null,
  onResizeDown,
  onResizeMove,
  onResizeUp,
  onResizeKeyDown,
}: TimelineClipItemProps) {
  const left = clip.startTime * pixelsPerSecond;
  const width = clip.duration * pixelsPerSecond;
  const sourceWidth = clip.sourceDuration * pixelsPerSecond;
  const trimInPx = clip.trimIn * pixelsPerSecond;

  return (
    <div
      data-clip-index={clip.index}
      className="absolute"
      style={{
        top: `${itemTop}px`,
        width: `${width}px`,
        height: `${ITEM_HEIGHT}px`,
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
        {clip.kind === "video" ? (
          <RepeatedVideoTile
            clip={clip}
            displayWidth={width}
            previewTime={scrubPreviewTime ?? clip.trimIn}
          />
        ) : (
          <div
            className="pointer-events-none h-full"
            style={{
              width: `${sourceWidth}px`,
              transform: `translateX(${-trimInPx}px)`,
            }}
          >
            <img
              src={clip.src}
              alt={clip.alt}
              draggable={false}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        {clip.kind === "video" && (
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            VIDEO
          </span>
        )}

        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100">
          {clip.kind === "video"
            ? `${formatSeconds(clip.duration)} / ${formatSeconds(clip.sourceDuration)}`
            : `${Math.round(width)}px · ${clip.startTime.toFixed(1)}s`}
        </span>

        {isSelected && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
            <TrimHandle
              edge="left"
              currentWidth={width}
              onPointerDown={(e) => onResizeDown(e, clip, "left")}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onKeyDown={(e) => onResizeKeyDown(e, clip, "left")}
            />
            <TrimHandle
              edge="right"
              currentWidth={width}
              onPointerDown={(e) => onResizeDown(e, clip, "right")}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onKeyDown={(e) => onResizeKeyDown(e, clip, "right")}
            />
          </>
        )}
      </div>
    </div>
  );
});
