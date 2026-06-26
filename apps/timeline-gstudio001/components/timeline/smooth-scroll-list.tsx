"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  DEFAULT_PIXELS_PER_SECOND,
  ITEM_HEIGHTS,
  MIN_WIDTH,
  THUMBNAIL_GAP,
  TIMELINE_ITEM_TOP,
  TIMELINE_LEADING_PADDING_SECONDS,
  type ItemSize,
} from "./constants";
import { useTimelineClipState } from "./hooks/use-timeline-clip-state";
import { useTimelineInteractions } from "./hooks/use-timeline-interactions";
import { useTimelineLayout } from "./hooks/use-timeline-layout";
import { useTimelineMediaDuration } from "./hooks/use-timeline-media-duration";
import { useTimelineOverhang } from "./hooks/use-timeline-overhang";
import { useTimelineScrollState } from "./hooks/use-timeline-scroll-state";
import { useTimelineZoom } from "./hooks/use-timeline-zoom";
import { TimelineNavigation } from "./timeline-navigation";
import { TimelineOverhangHint } from "./timeline-overhang-hint";
import { TimelineToolbar } from "./timeline-toolbar";
import {
  getTimelineGridContentHeight,
  getTimelineGridItemLayout,
  getTimelineGridMetrics,
} from "./timeline-grid";
import { TimelineViewport } from "./timeline-viewport";
import { clamp } from "./utils";

export interface SmoothScrollListProps
  extends React.HTMLAttributes<HTMLDivElement> {
  itemCount?: number;
  viewportWidth?: number | string;
  width?: number | string;
  pixelsPerSecond?: number;
  syncMediaDuration?: boolean;
}

export function SmoothScrollList({
  itemCount = 1000,
  viewportWidth,
  width: _deprecatedWidth,
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
  syncMediaDuration = true,
  className,
  style,
  ...props
}: SmoothScrollListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const safeItemCount = Math.max(0, Math.floor(itemCount));
  const resolvedViewportWidth = viewportWidth ?? "100%";
  const initialScrollLeft = TIMELINE_LEADING_PADDING_SECONDS * 100;

  const [thumbnailMode, setThumbnailMode] = useState(false);
  const [gridMode, setGridMode] = useState(false);
  const [itemSize, setItemSize] = useState<ItemSize>("md");
  const [manualOverhangScroll, setManualOverhangScroll] = useState(true);
  const [showPassiveFilmstrips, setShowPassiveFilmstrips] = useState(false);

  const itemHeight = ITEM_HEIGHTS[itemSize];
  const thumbnailWidth = (itemHeight * 16) / 9;

  const scrollState = useTimelineScrollState({
    initialScrollLeft,
    parentRef,
  });

  const gridModeEnabled = thumbnailMode && gridMode;
  const gridMetrics = useMemo(
    () =>
      getTimelineGridMetrics({
        enabled: gridModeEnabled,
        fallbackItemWidth: thumbnailWidth,
        itemHeight,
        itemCount: safeItemCount,
        viewportWidth: scrollState.viewportClientWidth,
      }),
    [
      gridModeEnabled,
      itemHeight,
      safeItemCount,
      scrollState.viewportClientWidth,
      thumbnailWidth,
    ],
  );
  const effectiveThumbnailWidth = gridModeEnabled
    ? gridMetrics.itemWidth
    : thumbnailWidth;
  const timelineHeight = gridModeEnabled
    ? getTimelineGridContentHeight(gridMetrics)
    : itemHeight + TIMELINE_ITEM_TOP;

  const clipState = useTimelineClipState({
    itemCount: safeItemCount,
    parentRef,
    pendingScrollLeftRef: scrollState.pendingScrollLeftRef,
    setScrollLeft: scrollState.setScrollLeft,
  });

  const selectedClip = useMemo(() => {
    if (clipState.selectedIndex === null) return null;
    return (
      clipState.clips.find(
        (clip) => clip.index === clipState.selectedIndex,
      ) ?? null
    );
  }, [clipState.clips, clipState.selectedIndex]);
  const selectedVideoClip =
    selectedClip?.kind === "video" ? selectedClip : null;

  const zoom = useTimelineZoom({
    clips: clipState.clips,
    initialZoom: pixelsPerSecond,
    parentRef,
    prevScrollLeftRef: scrollState.prevScrollLeftRef,
    selectedIndex: clipState.selectedIndex,
    setScrollLeft: scrollState.setScrollLeft,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
  });

  const minDuration = MIN_WIDTH / zoom.safePixelsPerSecond;
  const handleClipDurationLoad = useTimelineMediaDuration({
    itemHeight,
    pixelsPerSecond: zoom.safePixelsPerSecond,
    setClips: clipState.setClips,
  });

  const interactions = useTimelineInteractions({
    parentRef,
    clips: clipState.clips,
    safePixelsPerSecond: zoom.safePixelsPerSecond,
    minDuration,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
    gridMetrics,
    setScrollLeft: scrollState.setScrollLeft,
    setSelectedIndex: clipState.setSelectedIndex,
    setScrubPreview: clipState.setScrubPreview,
    scheduleClips: clipState.scheduleClips,
    applyClipsNow: clipState.applyClipsNow,
    pendingScrollLeftRef: scrollState.pendingScrollLeftRef,
  });

  const overhang = useTimelineOverhang({
    activeFilmStripEdit: interactions.activeFilmStripEdit,
    activeResize: interactions.activeResize,
    clipsLength: clipState.clips.length,
    isFilmStripEditing: interactions.isFilmStripEditing,
    isResizing: interactions.isResizing,
    isUnfreezing: interactions.isUnfreezing,
    manualOverhangScroll,
    parentRef,
    pixelsPerSecond: zoom.safePixelsPerSecond,
    prevScrollLeftRef: scrollState.prevScrollLeftRef,
    scrollLeft: scrollState.scrollLeft,
    selectedVideoClip,
    setScrollLeft: scrollState.setScrollLeft,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
  });

  const layout = useTimelineLayout({
    clips: clipState.clips,
    closingOverhangOffset: overhang.closingOverhangOffset,
    firstOverhang: overhang.firstOverhang,
    isResizing: interactions.isResizing,
    lastOverhang: overhang.lastOverhang,
    pixelsPerSecond: zoom.safePixelsPerSecond,
    scrollLeft: scrollState.scrollLeft,
    scrollTop: gridModeEnabled ? scrollState.pageScrollTop : scrollState.scrollTop,
    gridMetrics,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
    viewportClientHeight: gridModeEnabled
      ? scrollState.pageViewportHeight
      : scrollState.viewportClientHeight,
    viewportClientWidth: scrollState.viewportClientWidth,
  });

  const scrollToClipIndex = useCallback(
    (targetIndex: number) => {
      const element = parentRef.current;
      if (!element || clipState.clips.length === 0) return;

      interactions.stopInertia();
      const index = clamp(
        Math.floor(targetIndex),
        0,
        clipState.clips.length - 1,
      );
      const clip = clipState.clips[index];
      const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
      const gridLayout =
        gridModeEnabled && thumbnailMode
          ? getTimelineGridItemLayout(clip.index, gridMetrics)
          : null;
      if (gridLayout) {
        const rect = element.getBoundingClientRect();
        window.scrollTo({
          top: window.scrollY + rect.top + gridLayout.top,
          behavior: "smooth",
        });
        return;
      }

      const nextScrollLeft = clamp(
        thumbnailMode
          ? clip.index * (effectiveThumbnailWidth + THUMBNAIL_GAP)
          : clip.startTime * zoom.safePixelsPerSecond,
        0,
        maxScroll,
      );
      element.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
    },
    [
      clipState.clips,
      effectiveThumbnailWidth,
      gridMetrics,
      gridModeEnabled,
      interactions,
      thumbnailMode,
      zoom.safePixelsPerSecond,
    ],
  );

  useEffect(() => {
    if (!thumbnailMode && gridMode) {
      setGridMode(false);
    }
  }, [gridMode, thumbnailMode]);

  useEffect(() => {
    const currentInteractions = interactions;
    return () => {
      currentInteractions.stopInertia();
      currentInteractions.cleanupWindowDragListeners();
      scrollState.cleanupScrollFrame();
      clipState.cleanupClipFrames();
    };
    // These callbacks are stable; cleanup should only register once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      {...props}
      data-testid="timeline-editor"
      data-selected-index={clipState.selectedIndex ?? ""}
      data-zoom={zoom.safePixelsPerSecond}
      data-thumbnail-mode={thumbnailMode}
      data-grid-mode={gridModeEnabled}
      data-grid-columns={gridMetrics.columnsPerPage}
      data-grid-rows={gridMetrics.rowsPerPage}
      data-passive-filmstrips={showPassiveFilmstrips}
      data-item-count={clipState.clips.length}
      data-first-overhang={overhang.firstOverhang}
      data-last-overhang={overhang.lastOverhang}
      data-reordering={interactions.isReordering}
      data-reorder-target-index={interactions.reorderPreview?.targetIndex ?? ""}
      data-timeline-width={layout.timelineWidth}
      data-viewport-width={scrollState.viewportClientWidth}
      data-scroll-top={
        gridModeEnabled ? scrollState.pageScrollTop : scrollState.scrollTop
      }
      data-viewport-height={
        gridModeEnabled
          ? scrollState.pageViewportHeight
          : scrollState.viewportClientHeight
      }
      data-timeline-height={timelineHeight}
      data-max-scroll={Math.max(
        0,
        layout.timelineWidth - scrollState.viewportClientWidth,
      )}
      data-max-scroll-top={Math.max(
        0,
        timelineHeight -
          (gridModeEnabled
            ? scrollState.pageViewportHeight
            : scrollState.viewportClientHeight),
      )}
      className={cn(
        "box-border grid w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 font-sans shadow-2xl",
        className,
      )}
      style={{
        width: "100%",
        maxWidth: "min(100%, calc(100vw - 2rem))",
        minWidth: 0,
        boxSizing: "border-box",
        ...style,
      }}
    >
      <TimelineToolbar
        itemSize={itemSize}
        manualOverhangScroll={manualOverhangScroll}
        showPassiveFilmstrips={showPassiveFilmstrips}
        gridMode={gridModeEnabled}
        onItemSizeChange={setItemSize}
        onGridModeChange={setGridMode}
        onManualOverhangScrollChange={setManualOverhangScroll}
        onPassiveFilmstripsChange={setShowPassiveFilmstrips}
        onThumbnailModeChange={setThumbnailMode}
        onZoomChange={zoom.handleZoomChange}
        renderedCount={layout.visibleClips.length}
        thumbnailMode={thumbnailMode}
        totalCount={clipState.clips.length}
        zoomLevel={zoom.zoomLevel}
      />

      <TimelineNavigation
        disabled={clipState.clips.length === 0}
        onScrollToIndex={scrollToClipIndex}
      />

      <div className="relative w-full max-w-full min-w-0">
        <TimelineViewport
          closingOverhangOffset={overhang.closingOverhangOffset}
          firstOverhang={overhang.firstOverhang}
          handleClipDurationLoad={
            syncMediaDuration ? handleClipDurationLoad : undefined
          }
          handleScroll={scrollState.handleScroll}
          hasClips={clipState.clips.length > 0}
          interactions={interactions}
          isClosingOverhang={overhang.isClosingOverhang}
          isResizingFirstClipLeft={overhang.isResizingFirstClipLeft}
          isZooming={zoom.isZooming}
          itemHeight={itemHeight}
          manualOverhangScroll={manualOverhangScroll}
          parentRef={parentRef}
          pixelsPerSecond={zoom.safePixelsPerSecond}
          prevFirstOverhang={overhang.prevFirstOverhangRef.current}
          resolvedViewportWidth={resolvedViewportWidth}
          scrubPreview={clipState.scrubPreview}
          scrollLeft={scrollState.scrollLeft}
          scrollTop={
            gridModeEnabled ? scrollState.pageScrollTop : scrollState.scrollTop
          }
          selectedIndex={clipState.selectedIndex}
          selectedVideoClip={selectedVideoClip}
          showPassiveFilmstrips={showPassiveFilmstrips}
          gridMetrics={gridMetrics}
          thumbnailMode={thumbnailMode}
          thumbnailWidth={effectiveThumbnailWidth}
          timelineHeight={timelineHeight}
          timelineWidth={layout.timelineWidth}
          visibleClips={layout.visibleClips}
        />

        {overhang.hasOffscreenOverhang && (
          <TimelineOverhangHint onClick={overhang.scrollToOverhang} />
        )}
      </div>
    </div>
  );
}
