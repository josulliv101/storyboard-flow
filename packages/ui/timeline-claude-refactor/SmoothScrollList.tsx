"use client";

import type React from "react";
import { useMemo } from "react";
import { cn } from "../lib/utils";
import {
  DEFAULT_PIXELS_PER_SECOND,
  MIN_WIDTH,
  TIMELINE_HEIGHT,
  TIMELINE_ITEM_TOP,
  TIMELINE_LEADING_PADDING_SECONDS,
  TIMELINE_TRAILING_PADDING_SECONDS,
  VISIBLE_OVERSCAN_PX,
} from "./constants";
import {
  useClipResize,
  useFilmStripEdit,
  useInertialScroll,
  useScrollToClip,
  useTimelineClips,
  useViewportTracking,
} from "./hooks";
import {
  TimelineClipItem,
  TimelineToolbar,
  VideoSourceFilmStrip,
} from "./components";

export interface SmoothScrollListProps extends React.HTMLAttributes<HTMLDivElement> {
  itemCount?: number;
  /** Optional explicit width for the scrollable viewport. Defaults to full width. */
  viewportWidth?: number | string;
  /** Deprecated: the component is full-width by default. Use `viewportWidth` only when you want to constrain it. */
  width?: number | string;
  /** Timeline zoom level. Larger values make clips visually wider. */
  pixelsPerSecond?: number;
}

export function SmoothScrollList({
  itemCount = 100,
  viewportWidth,
  width: _deprecatedWidth,
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
  className,
  style,
  ...props
}: SmoothScrollListProps) {
  const safeItemCount = Math.max(0, Math.floor(itemCount));
  const resolvedViewportWidth = viewportWidth ?? "100%";
  const safePixelsPerSecond = Math.max(20, pixelsPerSecond);
  const minDuration = MIN_WIDTH / safePixelsPerSecond;
  const initialScrollLeft = TIMELINE_LEADING_PADDING_SECONDS * safePixelsPerSecond;

  const {
    clips,
    selectedIndex,
    setSelectedIndex,
    scrubPreview,
    setScrubPreview,
    scheduleClips,
    applyClipsNow,
  } = useTimelineClips(safeItemCount, safePixelsPerSecond);

  const {
    elementRef: parentRef,
    scrollLeft,
    setScrollLeft,
    viewportClientWidth,
    handleScroll,
  } = useViewportTracking(initialScrollLeft);

  const selectedClip = useMemo(() => {
    if (selectedIndex === null) return null;
    return clips.find((clip) => clip.index === selectedIndex) ?? null;
  }, [clips, selectedIndex]);

  const selectedVideoClip = selectedClip?.kind === "video" ? selectedClip : null;

  const {
    handlePointerDown,
    handlePointerCancel: handleScrollPointerCancel,
    stopInertia,
    cleanupWindowListeners: cleanupScrollDragListeners,
  } = useInertialScroll({
    elementRef: parentRef,
    setScrollLeft,
    onClipPress: (clipIndex) =>
      setSelectedIndex((previous) => (previous === clipIndex ? null : clipIndex)),
  });

  const { handleResizeDown, handleResizeMove, handleResizeUp, handleResizeKeyDown } =
    useClipResize({
      clips,
      minDuration,
      pixelsPerSecond: safePixelsPerSecond,
      setSelectedIndex,
      setScrubPreview,
      scheduleClips,
      applyClipsNow,
      stopInertia,
    });

  const { handleFilmStripPointerDown, cancelActiveEdit } = useFilmStripEdit({
    clips,
    minDuration,
    setSelectedIndex,
    setScrubPreview,
    scheduleClips,
    applyClipsNow,
    stopInertia,
    cleanupOtherDragListeners: cleanupScrollDragListeners,
  });

  const scrollToClipIndex = useScrollToClip(
    parentRef,
    clips,
    safePixelsPerSecond,
    stopInertia,
  );

  const handlePointerCancel = () => {
    handleScrollPointerCancel();
    cancelActiveEdit();
    setScrubPreview(null);
  };

  const totalDuration = useMemo(() => {
    if (clips.length === 0) return 0;

    let maxDuration = clips.reduce(
      (max, clip) => Math.max(max, clip.startTime + clip.duration),
      0,
    );

    // The selected video filmstrip represents the full source and can extend
    // past the visible timeline item, so leave enough scrollable width for it.
    if (selectedVideoClip) {
      maxDuration = Math.max(
        maxDuration,
        selectedVideoClip.startTime +
        selectedVideoClip.duration +
        selectedVideoClip.trimOut,
      );
    }

    return maxDuration + TIMELINE_TRAILING_PADDING_SECONDS;
  }, [clips, selectedVideoClip]);

  const timelineWidth = Math.max(
    viewportClientWidth || 1,
    Math.ceil(totalDuration * safePixelsPerSecond),
  );

  const visibleClips = useMemo(() => {
    const visibleStartTime = Math.max(
      0,
      (scrollLeft - VISIBLE_OVERSCAN_PX) / safePixelsPerSecond,
    );
    const visibleEndTime =
      (scrollLeft + viewportClientWidth + VISIBLE_OVERSCAN_PX) /
      safePixelsPerSecond;

    return clips.filter((clip) => {
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      return clipEnd >= visibleStartTime && clipStart <= visibleEndTime;
    });
  }, [clips, safePixelsPerSecond, scrollLeft, viewportClientWidth]);

  return (
    <div
      {...props}
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
      <div className="flex w-full min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 truncate text-sm font-semibold text-zinc-200">
          Anchored Timeline Trim
        </h3>
        <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
          {visibleClips.length}/{clips.length} rendered
        </span>
      </div>

      <p className="-mt-1 w-full min-w-0 text-[11px] leading-relaxed text-zinc-500">
        Drag the timeline or any clip body to scroll. Click a clip to select
        it. For a selected video, use the filmstrip above the item to move or
        resize the source window; drag the item handles to trim the timeline
        edges.
      </p>

      <TimelineToolbar
        disabled={clips.length === 0}
        onScrollToIndex={scrollToClipIndex}
      />

      <div className="w-full max-w-full min-w-0">
        <div
          ref={parentRef}
          onScroll={handleScroll}
          onPointerDown={handlePointerDown}
          onPointerCancel={handlePointerCancel}
          onDragStart={(event) => event.preventDefault()}
          className="relative block w-full max-w-full min-w-0 cursor-grab touch-none select-none overflow-x-scroll overflow-y-hidden rounded-lg border border-zinc-800 bg-zinc-950 active:cursor-grabbing"
          style={{
            width: resolvedViewportWidth,
            maxWidth: "100%",
            minWidth: 0,
            boxSizing: "border-box",
            scrollbarGutter: "stable both-edges",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
            className="relative block"
            style={{
              width: `${timelineWidth}px`,
              minWidth: `${timelineWidth}px`,
              maxWidth: "none",
              height: `${TIMELINE_HEIGHT}px`,
              boxSizing: "border-box",
            }}
          >
            {clips.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                No items
              </div>
            ) : (
              <>
                {visibleClips.map((clip) => (
                  <TimelineClipItem
                    key={clip.id}
                    clip={clip}
                    pixelsPerSecond={safePixelsPerSecond}
                    itemTop={TIMELINE_ITEM_TOP}
                    isSelected={selectedIndex === clip.index}
                    scrubPreviewTime={
                      scrubPreview?.clipIndex === clip.index
                        ? scrubPreview.time
                        : null
                    }
                    onResizeDown={handleResizeDown}
                    onResizeMove={handleResizeMove}
                    onResizeUp={handleResizeUp}
                    onResizeKeyDown={handleResizeKeyDown}
                  />
                ))}

                {selectedVideoClip && (
                  <VideoSourceFilmStrip
                    clip={selectedVideoClip}
                    pixelsPerSecond={safePixelsPerSecond}
                    onSourceWindowPointerDown={handleFilmStripPointerDown}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
