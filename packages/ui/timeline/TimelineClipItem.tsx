"use client";

import React, { memo } from "react";

import type {
  CollectionEndpoint,
  CollectionTimelineClip,
  TimelineClip,
} from "./types";
import { cn } from "../lib/utils";
import { DragPreviewPortal, type DragPreviewCoordinates } from "../drag-drop";
import {
  TimelineClipItemContent,
  getClipItemContentRing,
} from "./TimelineClipItemContent";
import {
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "./timeline-grid";

export type TimelineReorderPreview = DragPreviewCoordinates & {
  activeClipId: string;
  dragLeft: number;
  dragTop: number;
  dragOffsetY: number;
  targetIndex: number;
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
  children?: React.ReactNode;
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
  children,
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
    { length: Math.min(breadcrumbLevelCount, 4) },
    (_, level) => level,
  );
  const collectionHref =
    clip.kind === "collection" ? getCollectionHref?.(clip.childTimelineId) : null;

  const ring = getClipItemContentRing({
    isCollectionCollapseCard,
    isLifted,
    isCollectionHovered,
    isSelected,
  });

  const innerContent = children ?? (
    <TimelineClipItemContent
      clip={clip}
      width={width}
      itemHeight={itemHeight}
      pixelsPerSecond={pixelsPerSecond}
      scrubPreviewTime={scrubPreviewTime}
      isSelected={isSelected}
      isCollectionHovered={isCollectionHovered}
      isGrowingOpposite={isGrowingOpposite}
      thumbnailMode={thumbnailMode}
      isCollectionCollapseCard={isCollectionCollapseCard}
      hasCollectionBreadcrumb={hasCollectionBreadcrumb}
      breadcrumbLevels={breadcrumbLevels}
      collectionHref={collectionHref}
      onDurationLoaded={
        onDurationLoaded ? (duration) => onDurationLoaded(clip.index, duration) : undefined
      }
      collectionEndpointSelection={collectionEndpointSelection}
      onCollectionEndpointClick={
        clip.kind === "collection" && onToggleCollectionEndpoint
          ? (endpoint) => onToggleCollectionEndpoint(clip as CollectionTimelineClip, endpoint)
          : undefined
      }
      isCollectionExpanded={isCollectionExpanded}
      onToggleCollectionExpanded={onToggleCollectionExpanded}
      onOpenCollection={onOpenCollection}
      onResizeDown={onResizeDown}
      onResizeMove={onResizeMove}
      onResizeUp={onResizeUp}
      onResizeKeyDown={onResizeKeyDown}
      ring={ring}
    />
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

      <DragPreviewPortal
        preview={reorderPreview}
        width={width}
        height={itemHeight}
        testId="timeline-reorder-preview"
      >
        {innerContent}
      </DragPreviewPortal>
    </>
  );
});
