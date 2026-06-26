"use client";

import type React from "react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  DEFAULT_PIXELS_PER_SECOND,
  ITEM_HEIGHTS,
  MIN_WIDTH,
  TIMELINE_ITEM_TOP,
  TIMELINE_LEADING_PADDING_SECONDS,
  type ItemSize,
  VIDEO_SOURCES,
} from "./constants";
import { useTimelineClipState } from "./hooks/use-timeline-clip-state";
import { useTimelineInteractions } from "./hooks/use-timeline-interactions";
import { useTimelineLayout } from "./hooks/use-timeline-layout";
import { useTimelineMediaDuration } from "./hooks/use-timeline-media-duration";
import { useTimelineOverhang } from "./hooks/use-timeline-overhang";
import { useTimelineScrollState } from "./hooks/use-timeline-scroll-state";
import { useTimelineZoom } from "./hooks/use-timeline-zoom";
import { TimelineOverhangHint } from "./timeline-overhang-hint";
import { TimelineToolbar } from "./timeline-toolbar";
import {
  getTimelineGridContentHeight,
  getTimelineGridMetrics,
} from "./timeline-grid";
import { TimelineViewport } from "./timeline-viewport";
import {
  appendTimelineViewStateToHref,
  type TimelineViewState,
} from "./timeline-view-state";
import { startTimelineFadeNavigation } from "./timeline-route-fade";
import type { TimelineClip } from "./types";
import { reindexAndPackClips } from "./hooks/use-timeline-clips";

export interface SmoothScrollListProps
  extends React.HTMLAttributes<HTMLDivElement> {
  collectionHrefPrefix?: string;
  initialClips?: TimelineClip[];
  initialViewState?: Partial<TimelineViewState>;
  itemCount?: number;
  onOpenCollection?: (timelineId: string) => void;
  timelineId?: string;
  timelineTitle?: string;
  viewportWidth?: number | string;
  width?: number | string;
  pixelsPerSecond?: number;
  syncMediaDuration?: boolean;
}

export function SmoothScrollList({
  collectionHrefPrefix = "/timeline",
  initialClips,
  initialViewState,
  itemCount = 1000,
  onOpenCollection,
  timelineId,
  timelineTitle,
  viewportWidth,
  width: _deprecatedWidth,
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
  syncMediaDuration = true,
  className,
  style,
  ...props
}: SmoothScrollListProps) {
  const router = useRouter();
  const parentRef = useRef<HTMLDivElement>(null);
  const safeItemCount = initialClips
    ? initialClips.length
    : Math.max(0, Math.floor(itemCount));
  const resolvedViewportWidth = viewportWidth ?? "100%";
  const initialScrollLeft = TIMELINE_LEADING_PADDING_SECONDS * 100;
  const timelineResetKey = useMemo(
    () =>
      initialClips
        ? (timelineId ?? initialClips.map((clip) => clip.id).join("|"))
        : `generated:${safeItemCount}`,
    [initialClips, safeItemCount, timelineId],
  );

  const [thumbnailMode, setThumbnailMode] = useState(
    initialViewState?.thumbnailMode ?? false,
  );
  const [gridMode, setGridMode] = useState(
    initialViewState?.gridMode ?? false,
  );
  const [itemSize, setItemSize] = useState<ItemSize>(
    initialViewState?.itemSize ?? "md",
  );
  const [manualOverhangScroll, setManualOverhangScroll] = useState(
    initialViewState?.manualOverhangScroll ?? true,
  );
  const [showPassiveFilmstrips, setShowPassiveFilmstrips] = useState(
    initialViewState?.showPassiveFilmstrips ?? false,
  );

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
    initialClips,
    itemCount: safeItemCount,
    parentRef,
    pendingScrollLeftRef: scrollState.pendingScrollLeftRef,
    resetKey: timelineResetKey,
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

  const handleOpenCollection = useCallback(
    (nextTimelineId: string, href: string) => {
      if (onOpenCollection) {
        onOpenCollection(nextTimelineId);
        return;
      }

      startTimelineFadeNavigation({
        navigate: () => router.push(href),
      });
    },
    [onOpenCollection, router],
  );

  const handleThumbnailModeChange = useCallback((enabled: boolean) => {
    setThumbnailMode(enabled);
    if (!enabled) {
      setGridMode(false);
    }
  }, []);

  const zoom = useTimelineZoom({
    clips: clipState.clips,
    initialZoom: initialViewState?.zoom ?? pixelsPerSecond,
    parentRef,
    prevScrollLeftRef: scrollState.prevScrollLeftRef,
    selectedIndex: clipState.selectedIndex,
    setScrollLeft: scrollState.setScrollLeft,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
  });

  const getCollectionHref = useCallback(
    (nextTimelineId: string) => {
      const basePath = collectionHrefPrefix.replace(/\/$/, "");
      const href = `${basePath}/${encodeURIComponent(nextTimelineId)}`;

      return appendTimelineViewStateToHref(href, {
        thumbnailMode,
        gridMode,
        itemSize,
        manualOverhangScroll,
        showPassiveFilmstrips,
        zoom: zoom.zoomLevel,
      });
    },
    [
      collectionHrefPrefix,
      gridMode,
      itemSize,
      manualOverhangScroll,
      showPassiveFilmstrips,
      thumbnailMode,
      zoom.zoomLevel,
    ],
  );

  const minDuration = MIN_WIDTH / zoom.safePixelsPerSecond;
  const handleClipDurationLoad = useTimelineMediaDuration({
    itemHeight,
    pixelsPerSecond: zoom.safePixelsPerSecond,
    setClips: clipState.setClips,
  });

  const handleDropFiles = useCallback(
    async (insertIndex: number, files: File[]) => {
      const getMediaDuration = (file: File): Promise<number> => {
        return new Promise((resolve) => {
          if (file.type.startsWith("video/")) {
            const video = document.createElement("video");
            video.preload = "metadata";
            video.onloadedmetadata = () => {
              resolve(video.duration);
            };
            video.onerror = () => {
              resolve(5); // fallback
            };
            video.src = URL.createObjectURL(file);
          } else {
            resolve(4); // default duration for images
          }
        });
      };

      const newClipsPromises = files.map(async (file, idx) => {
        const isVideo = file.type.startsWith("video/");
        const isImage = file.type.startsWith("image/");
        if (!isVideo && !isImage) return null;

        const duration = await getMediaDuration(file);
        const uniqueId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        if (isVideo) {
          const clipDuration = Math.min(12, duration);
          return {
            id: uniqueId,
            index: insertIndex + idx,
            kind: "video",
            src: URL.createObjectURL(file),
            alt: file.name,
            aspect: 16 / 9,
            trackIndex: 0,
            startTime: 0,
            duration: clipDuration,
            sourceDuration: duration,
            trimIn: 0,
            trimOut: Math.max(0, duration - clipDuration),
          } as TimelineClip;
        } else {
          return {
            id: uniqueId,
            index: insertIndex + idx,
            kind: "image",
            src: URL.createObjectURL(file),
            alt: file.name,
            aspect: 16 / 9,
            trackIndex: 0,
            startTime: 0,
            duration: 4,
            sourceDuration: 4,
            trimIn: 0,
            trimOut: 0,
          } as TimelineClip;
        }
      });

      const newClips = (await Promise.all(newClipsPromises)).filter(
        (clip): clip is TimelineClip => clip !== null
      );

      if (newClips.length === 0) return;

      const nextClips = [...clipState.clips];
      nextClips.splice(insertIndex, 0, ...newClips);

      const packedClips = reindexAndPackClips(nextClips);
      clipState.applyClipsNow(packedClips);
    },
    [clipState],
  );

  const handleDropClip = useCallback(
    (insertIndex: number, clip: TimelineClip, sourceTimelineId: string) => {
      const thisTimelineId = timelineId || "";

      if (sourceTimelineId === thisTimelineId) {
        // Reordering within the same timeline
        const sourceIndex = clipState.clips.findIndex((c) => c.id === clip.id);
        if (sourceIndex === -1) return;

        const nextClips = [...clipState.clips];
        const [removed] = nextClips.splice(sourceIndex, 1);

        // Adjust target index if inserting after the source position
        let targetIndex = insertIndex;
        if (sourceIndex < insertIndex) {
          targetIndex = insertIndex - 1;
        }

        nextClips.splice(targetIndex, 0, removed);
        const packed = reindexAndPackClips(nextClips);
        clipState.applyClipsNow(packed);
      } else {
        // Dragged from another timeline to this timeline
        // 1. Insert clip locally
        const nextClips = [...clipState.clips];
        const newClip = {
          ...clip,
          index: insertIndex,
        };

        nextClips.splice(insertIndex, 0, newClip);
        const packed = reindexAndPackClips(nextClips);
        clipState.applyClipsNow(packed);

        // 2. Notify the source timeline to remove it
        window.dispatchEvent(
          new CustomEvent("timeline-clip-moved", {
            detail: {
              clipId: clip.id,
              sourceTimelineId,
              targetTimelineId: thisTimelineId,
            },
          })
        );
      }
    },
    [clipState, timelineId],
  );

  const handleDropSidebarClip = useCallback(
    (insertIndex: number, type: "collection" | "image" | "video") => {
      const uniqueId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      let newClip: TimelineClip;

      if (type === "collection") {
        newClip = {
          id: uniqueId,
          index: insertIndex,
          kind: "collection",
          title: "New Collection",
          childTimelineId: `timeline-${Date.now()}`,
          itemCount: 0,
          duration: 3,
          sourceDuration: 3,
          trimIn: 0,
          trimOut: 0,
          alt: "New Collection",
          aspect: 16 / 9,
          trackIndex: 0,
          startTime: 0,
        };
      } else if (type === "image") {
        newClip = {
          id: uniqueId,
          index: insertIndex,
          kind: "image",
          src: `https://picsum.photos/seed/${uniqueId}/360/200`,
          alt: "New Image",
          aspect: 16 / 9,
          trackIndex: 0,
          startTime: 0,
          duration: 4,
          sourceDuration: 4,
          trimIn: 0,
          trimOut: 0,
        };
      } else {
        // video
        newClip = {
          id: uniqueId,
          index: insertIndex,
          kind: "video",
          src: VIDEO_SOURCES[0],
          alt: "New Video",
          aspect: 16 / 9,
          trackIndex: 0,
          startTime: 0,
          duration: 5,
          sourceDuration: 12,
          trimIn: 0,
          trimOut: 7,
        };
      }

      const nextClips = [...clipState.clips];
      nextClips.splice(insertIndex, 0, newClip);

      const packedClips = reindexAndPackClips(nextClips);
      clipState.applyClipsNow(packedClips);
    },
    [clipState],
  );

  useEffect(() => {
    const handleClipMoved = (e: Event) => {
      const customEvent = e as CustomEvent<{
        clipId: string;
        sourceTimelineId: string;
        targetTimelineId: string;
      }>;
      const { clipId, sourceTimelineId, targetTimelineId } = customEvent.detail;
      const thisTimelineId = timelineId || "";

      if (sourceTimelineId === thisTimelineId && targetTimelineId !== thisTimelineId) {
        const nextClips = clipState.clips.filter((c) => c.id !== clipId);
        const packed = reindexAndPackClips(nextClips);
        clipState.applyClipsNow(packed);
      }
    };

    window.addEventListener("timeline-clip-moved", handleClipMoved);
    return () => {
      window.removeEventListener("timeline-clip-moved", handleClipMoved);
    };
  }, [clipState, timelineId]);


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
    timelineId,
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
      data-timeline-id={timelineId ?? ""}
      data-timeline-title={timelineTitle ?? ""}
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
        title={timelineTitle}
        gridMode={gridModeEnabled}
        onItemSizeChange={setItemSize}
        onGridModeChange={setGridMode}
        onManualOverhangScrollChange={setManualOverhangScroll}
        onPassiveFilmstripsChange={setShowPassiveFilmstrips}
        onThumbnailModeChange={handleThumbnailModeChange}
        onZoomChange={zoom.handleZoomChange}
        renderedCount={layout.visibleClips.length}
        thumbnailMode={thumbnailMode}
        totalCount={clipState.clips.length}
        zoomLevel={zoom.zoomLevel}
        timelineId={timelineId}
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
          getCollectionHref={getCollectionHref}
          onOpenCollection={handleOpenCollection}
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
          onDropFiles={handleDropFiles}
          onDropClip={handleDropClip}
          onDropSidebarClip={handleDropSidebarClip}
          timelineId={timelineId}
        />

        {overhang.hasOffscreenOverhang && (
          <TimelineOverhangHint onClick={overhang.scrollToOverhang} />
        )}
      </div>
    </div>
  );
}
