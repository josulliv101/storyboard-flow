import React, { memo } from "react";
import { createPortal } from "react-dom";
import { Folder, FolderOpen } from "lucide-react";

import type {
  CollectionEndpoint,
  CollectionTimelineClip,
  TimelineClip,
} from "./types";
import { formatSeconds } from "./utils";
import { cn } from "../lib/utils";
import { RepeatedMediaTile } from "./RepeatedMediaTile";
import { TrimHandle } from "./TrimHandle";
import {
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "./timeline-grid";

export type TimelineReorderPreview = {
  activeClipId: string;
  dragLeft: number;
  dragTop: number;
  dragOffsetY: number;
  targetIndex: number;
  clientX: number;
  clientY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
};

export type TimelineClipItemProps = {
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
  reorderPreview?: TimelineReorderPreview | null;
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
  isCollectionExpanded?: boolean;
  onToggleCollectionExpanded?: (clip: CollectionTimelineClip) => void;
  collectionEndpointSelection?: Partial<Record<CollectionEndpoint, boolean>>;
  onToggleCollectionEndpoint?: (
    clip: CollectionTimelineClip,
    endpoint: CollectionEndpoint,
  ) => void;
  timelineId?: string;
};

const collectionBreadcrumbShapes = [
  {
    fill: "bg-amber-400",
    shape: "rounded-full",
  },
  {
    fill: "bg-sky-400",
    shape: "rounded-[2px]",
  },
  {
    fill: "bg-emerald-400",
    shape: "rotate-45 rounded-[2px]",
  },
  {
    fill: "bg-violet-400",
    shape: "rounded-sm",
  },
];

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
  isCollectionExpanded = false,
  onToggleCollectionExpanded,
  collectionEndpointSelection,
  onToggleCollectionEndpoint,
  timelineId,
}: TimelineClipItemProps) {
  const [isMounted, setIsMounted] = React.useState(false);
  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  const effectiveThumbnailMode = thumbnailMode;

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
    : effectiveThumbnailMode
    ? thumbnailWidth
    : clip.duration * pixelsPerSecond;
  const isLifted = reorderPreview !== null;
  const isCollectionCollapseCard =
    clip.kind === "collection" && clip.viewRole === "collection-collapse";
  const hasCollectionBreadcrumb = Boolean(clip.viewRole);
  const breadcrumbLevelCount = hasCollectionBreadcrumb
    ? Math.max(
        1,
        clip.viewRole === "collection-collapse"
          ? (clip.viewDepth ?? 0) + 1
          : (clip.viewDepth ?? 1),
      )
    : 0;
  const breadcrumbLevels = Array.from(
    {
      length: Math.min(
        breadcrumbLevelCount,
        collectionBreadcrumbShapes.length,
      ),
    },
    (_, level) => level,
  );
  const collectionHref =
    clip.kind === "collection" ? getCollectionHref?.(clip.childTimelineId) : null;

  const innerContent = (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-all duration-200",
        isCollectionCollapseCard
          ? "ring-2 ring-sky-400/70 border border-dashed border-sky-300/40 bg-sky-950/20 shadow-lg shadow-sky-400/15"
          : isLifted
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
        pixelsPerSecond={pixelsPerSecond}
        onDurationLoaded={onDurationLoaded ? (duration) => onDurationLoaded(clip.index, duration) : undefined}
        collectionEndpointSelection={
          clip.kind === "collection" ? collectionEndpointSelection : undefined
        }
        onCollectionEndpointClick={
          clip.kind === "collection" && onToggleCollectionEndpoint
            ? (endpoint) => onToggleCollectionEndpoint(clip, endpoint)
            : undefined
        }
      />

      {clip.kind === "video" && (
        <span className="absolute left-1 top-1 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
          VIDEO
        </span>
      )}

      {clip.kind === "collection" && (
        <>
          <span className="absolute left-1 top-1 z-20 rounded bg-sky-950/80 px-1.5 py-0.5 text-[10px] font-medium text-sky-200">
            COLLECTION
          </span>
          {onToggleCollectionExpanded ? (
            <button
              type="button"
              data-testid="timeline-collection-expand-toggle"
              aria-expanded={isCollectionExpanded}
              aria-label={`${clip.title} children`}
              title={isCollectionExpanded ? "Collapse collection" : "Expand collection"}
              className={cn(
                "absolute right-1 top-1 z-30 flex h-7 w-7 items-center justify-center rounded border text-sky-100 shadow transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2",
                isCollectionExpanded
                  ? "border-sky-300/50 bg-sky-500/35 hover:bg-sky-500/45"
                  : "border-sky-300/35 bg-black/75 hover:bg-sky-950/85",
              )}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleCollectionExpanded(clip);
              }}
            >
              {isCollectionExpanded ? (
                <Folder className="h-4 w-4" aria-hidden="true" />
              ) : (
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          ) : null}
          {collectionHref ? (
            <a
              href={collectionHref}
              className={cn(
                "absolute left-1 z-20 rounded border border-sky-300/40 bg-black/75 px-2 py-1 text-[10px] font-semibold text-sky-100 shadow",
                hasCollectionBreadcrumb ? "bottom-6" : "bottom-1",
              )}
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
            </a>
          ) : null}
        </>
      )}

      {hasCollectionBreadcrumb ? (
        <div
          data-testid="timeline-expanded-collection-breadcrumb"
          data-depth={breadcrumbLevelCount}
          className="pointer-events-none absolute bottom-1 left-1 z-30 flex items-center gap-1 rounded border border-zinc-600 bg-zinc-950 px-1.5 py-0.5 shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
          aria-label={`Expanded collection depth ${breadcrumbLevelCount}`}
        >
          {breadcrumbLevels.map((level, index) => {
            const levelShape = collectionBreadcrumbShapes[level];

            return (
              <React.Fragment key={`${clip.id}-breadcrumb-${level}`}>
                {index > 0 ? (
                  <span
                    className="font-mono text-[9px] leading-none text-zinc-400"
                    aria-hidden="true"
                  >
                    &gt;
                  </span>
                ) : null}
                <span
                  data-testid="timeline-expanded-collection-breadcrumb-shape"
                  data-depth-level={level}
                  className={cn(
                    "h-2 w-2 shrink-0",
                    levelShape.fill,
                    levelShape.shape,
                  )}
                  aria-hidden="true"
                />
              </React.Fragment>
            );
          })}
        </div>
      ) : null}

      <span className="absolute bottom-1 right-1 z-20 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100">
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

      {isSelected && !effectiveThumbnailMode && (
        <>
          <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
          {!isCollectionCollapseCard ? (
            <>
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
          ) : null}
        </>
      )}
      {isSelected && effectiveThumbnailMode && (
        <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
      )}
    </div>
  );

  return (
    <>
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
        data-view-role={clip.viewRole ?? ""}
        data-view-endpoint={clip.viewEndpoint ?? ""}
        data-expansion-key={clip.viewExpansionKey ?? ""}
        data-source-timeline-id={clip.viewSourceTimelineId ?? ""}
        data-source-clip-id={clip.viewSourceClipId ?? ""}
        data-view-depth={clip.viewDepth ?? ""}
        draggable={false}
        className={cn(
          "absolute cursor-grab active:cursor-grabbing",
          isReordering && !isLifted && "transition-transform duration-200 ease-out",
          isLifted ? "pointer-events-none opacity-25" : "",
          isCollectionHovered && "scale-[1.03] z-50 transition-transform duration-200",
        )}
        style={{
          top: `${top}px`,
          width: `${width}px`,
          height: `${itemHeight}px`,
          transform: `translateX(${left}px)`,
          zIndex: isSelected ? 40 : isCollectionHovered ? 35 : 10,
        }}
      >
        {innerContent}
      </div>

      {isLifted && isMounted && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed pointer-events-none z-[9999]"
          style={{
            left: `${reorderPreview.clientX - reorderPreview.pointerOffsetX}px`,
            top: `${reorderPreview.clientY - reorderPreview.pointerOffsetY}px`,
            width: `${width}px`,
            height: `${itemHeight}px`,
            transform: 'scale(1.03)',
          }}
        >
          {innerContent}
        </div>,
        document.body
      )}
    </>
  );
});
