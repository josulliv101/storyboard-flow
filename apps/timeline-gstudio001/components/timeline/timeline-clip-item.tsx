import React, { memo } from "react";
import Link from "next/link";
import { TimelineClip } from "./types";
import { formatSeconds } from "./utils";
import { ITEM_HEIGHT } from "./constants";
import { cn } from "@/lib/utils";
import { RepeatedMediaTile } from "./repeated-media-tile";
import { TrimHandle } from "./trim-handle";
import type { ReorderPreview } from "./hooks/use-timeline-pan";
import {
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "./timeline-grid";

type TimelineClipItemProps = {
  clip: TimelineClip;
  pixelsPerSecond: number;
  itemTop: number;
  gridMetrics?: TimelineGridMetrics;
  thumbnailMode?: boolean;
  thumbnailWidth?: number;
  thumbnailGap?: number;
  itemHeight: number;
  isSelected: boolean;
  scrubPreviewTime?: number | null;
  isGrowingOpposite?: boolean;
  isReordering?: boolean;
  isCollectionHovered?: boolean;
  reorderPreview?: ReorderPreview | null;
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
  getCollectionHref?: (timelineId: string) => string;
  onOpenCollection?: (timelineId: string, href: string) => void;
  timelineId?: string;
};

export const TimelineClipItem = memo(function TimelineClipItem({
  clip,
  pixelsPerSecond,
  itemTop,
  gridMetrics,
  itemHeight,
  thumbnailMode = false,
  thumbnailWidth = (itemHeight * 16) / 9,
  thumbnailGap = 16,
  isSelected,
  scrubPreviewTime = null,
  isGrowingOpposite = false,
  isReordering = false,
  isCollectionHovered = false,
  reorderPreview = null,
  onResizeDown,
  onResizeMove,
  onResizeUp,
  onResizeKeyDown,
  onDurationLoaded,
  getCollectionHref,
  onOpenCollection,
  timelineId,
}: TimelineClipItemProps) {
  const gridLayout =
    thumbnailMode && gridMetrics?.enabled
      ? getTimelineGridItemLayout(clip.index, gridMetrics)
      : null;
  const left = gridLayout
    ? gridLayout.left
    : thumbnailMode
    ? clip.index * (thumbnailWidth + thumbnailGap)
    : clip.startTime * pixelsPerSecond;
  const top = itemTop + (gridLayout?.top ?? 0);
  const width = gridLayout
    ? gridLayout.width
    : thumbnailMode
    ? thumbnailWidth
    : clip.duration * pixelsPerSecond;
  const isLifted = reorderPreview !== null;
  const collectionHref =
    clip.kind === "collection" ? getCollectionHref?.(clip.childTimelineId) : null;

  return (
    <div
      data-clip-index={clip.index}
      data-testid={`timeline-clip-${clip.index}`}
      data-clip-id={clip.id}
      data-start-time={clip.startTime}
      data-duration={clip.duration}
      data-source-duration={clip.sourceDuration}
      data-trim-in={clip.trimIn}
      data-trim-out={clip.trimOut}
      data-selected={isSelected}
      data-reordering={isLifted}
      data-is-first={clip.index === 0}
      draggable={false}
      className={cn(
        "absolute cursor-grab active:cursor-grabbing",
        isReordering && !isLifted && "transition-transform duration-200 ease-out",
        isLifted && "pointer-events-none opacity-0",
        isCollectionHovered && "scale-[1.03] z-50 transition-transform duration-200",
      )}
      style={{
        top: isLifted ? 0 : `${top}px`,
        width: `${width}px`,
        height: `${itemHeight}px`,
        transform: isLifted
          ? `translate(${reorderPreview.dragLeft}px, ${reorderPreview.dragTop}px) scale(1.03)`
          : `translateX(${left}px)`,
        zIndex: isLifted ? 60 : isSelected ? 30 : 0,
      }}
    >
      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-all duration-200",
          isLifted
            ? "ring-2 ring-sky-300 shadow-2xl shadow-sky-400/30"
            : isCollectionHovered
            ? "ring-2 ring-sky-400 bg-sky-950/20 shadow-lg shadow-sky-400/40"
            : isSelected
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

        {clip.kind === "collection" && (
          <>
            <span className="absolute left-1 top-1 rounded bg-sky-950/80 px-1.5 py-0.5 text-[10px] font-medium text-sky-200">
              COLLECTION
            </span>
            {collectionHref ? (
              <Link
                href={collectionHref}
                className="absolute bottom-1 left-1 rounded border border-sky-300/40 bg-black/75 px-2 py-1 text-[10px] font-semibold text-sky-100 shadow"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (
                    !onOpenCollection ||
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }

                  event.preventDefault();
                  onOpenCollection(clip.childTimelineId, collectionHref);
                }}
              >
                Open timeline
              </Link>
            ) : null}
          </>
        )}

        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100">
          {clip.kind === "video"
            ? `${formatSeconds(clip.duration)} / ${formatSeconds(clip.sourceDuration)}`
            : clip.kind === "collection"
            ? `${clip.itemCount} items`
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
