import type { CSSProperties, RefObject } from "react";

import { THUMBNAIL_GAP, TIMELINE_ITEM_TOP } from "./constants";
import type { useTimelineInteractions } from "./hooks/use-timeline-interactions";
import { TimelineClipItem } from "./timeline-clip-item";
import type { TimelineClip, TrimScrubPreview } from "./types";
import { VideoSourceFilmStrip } from "./video-source-filmstrip";

type TimelineInteractions = ReturnType<typeof useTimelineInteractions>;

type TimelineViewportProps = {
  closingOverhangOffset: number;
  firstOverhang: number;
  handleClipDurationLoad?: (index: number, duration: number) => void;
  handleScroll: () => void;
  interactions: TimelineInteractions;
  isClosingOverhang: boolean;
  isResizingFirstClipLeft: boolean;
  isZooming: boolean;
  itemHeight: number;
  hasClips: boolean;
  manualOverhangScroll: boolean;
  parentRef: RefObject<HTMLDivElement | null>;
  pixelsPerSecond: number;
  prevFirstOverhang: number;
  resolvedViewportWidth: number | string;
  scrubPreview: TrimScrubPreview | null;
  scrollLeft: number;
  selectedIndex: number | null;
  selectedVideoClip: TimelineClip | null;
  thumbnailMode: boolean;
  thumbnailWidth: number;
  timelineHeight: number;
  timelineWidth: number;
  visibleClips: TimelineClip[];
};

export function TimelineViewport({
  closingOverhangOffset,
  firstOverhang,
  handleClipDurationLoad,
  handleScroll,
  interactions,
  isClosingOverhang,
  isResizingFirstClipLeft,
  isZooming,
  itemHeight,
  hasClips,
  manualOverhangScroll,
  parentRef,
  pixelsPerSecond,
  prevFirstOverhang,
  resolvedViewportWidth,
  scrubPreview,
  scrollLeft,
  selectedIndex,
  selectedVideoClip,
  thumbnailMode,
  thumbnailWidth,
  timelineHeight,
  timelineWidth,
  visibleClips,
}: TimelineViewportProps) {
  const trackTransition =
    interactions.isResizing ||
    interactions.isSnappingBack ||
    interactions.isFilmStripEditing ||
    interactions.isUnfreezing ||
    isClosingOverhang ||
    isZooming
      ? "none"
      : "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), width 0.35s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.35s cubic-bezier(0.16, 1, 0.3, 1)";

  const overhangIsGrowing =
    manualOverhangScroll && firstOverhang > prevFirstOverhang;
  const hiddenOverhangIsClosing =
    manualOverhangScroll &&
    firstOverhang < prevFirstOverhang &&
    scrollLeft >= prevFirstOverhang - 1;
  const contentTransition =
    interactions.isResizing ||
    interactions.isFilmStripEditing ||
    interactions.isUnfreezing ||
    isResizingFirstClipLeft ||
    isClosingOverhang ||
    isZooming ||
    overhangIsGrowing ||
    hiddenOverhangIsClosing
      ? "none"
      : "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)";

  const viewportStyle: CSSProperties = {
    width: resolvedViewportWidth,
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    scrollbarGutter: "stable both-edges",
    WebkitOverflowScrolling: "touch",
  };

  return (
    <div
      ref={parentRef}
      data-testid="timeline-scroll-viewport"
      data-scroll-left={scrollLeft}
      onScroll={handleScroll}
      onPointerDown={interactions.handlePointerDown}
      onPointerCancel={interactions.handlePointerCancel}
      onDragStart={(event) => event.preventDefault()}
      className="relative block w-full max-w-full min-w-0 cursor-grab touch-none select-none overflow-x-scroll overflow-y-hidden rounded-lg border border-zinc-800 bg-zinc-950 active:cursor-grabbing"
      style={viewportStyle}
    >
      <div
        className="relative block"
        style={{
          width: `${timelineWidth}px`,
          minWidth: `${timelineWidth}px`,
          maxWidth: "none",
          height: `${timelineHeight}px`,
          boxSizing: "border-box",
          transform: `translateX(${interactions.trackTranslateX}px)`,
          transition: trackTransition,
        }}
      >
        {!hasClips ? (
          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
            No items
          </div>
        ) : (
          <div
            className="relative"
            style={{
              width: "100%",
              height: "100%",
              transform: `translateX(${firstOverhang + closingOverhangOffset}px)`,
              transition: contentTransition,
            }}
          >
            {visibleClips.map((clip) => (
              <TimelineClipItem
                key={clip.id}
                clip={clip}
                pixelsPerSecond={pixelsPerSecond}
                itemTop={TIMELINE_ITEM_TOP}
                itemHeight={itemHeight}
                thumbnailMode={thumbnailMode}
                thumbnailWidth={thumbnailWidth}
                thumbnailGap={THUMBNAIL_GAP}
                isSelected={selectedIndex === clip.index}
                isGrowingOpposite={
                  interactions.activeResize?.index === 0 &&
                  interactions.activeResize.edge === "left" &&
                  clip.index === 0
                }
                scrubPreviewTime={
                  scrubPreview?.clipIndex === clip.index
                    ? scrubPreview.time
                    : null
                }
                onResizeDown={interactions.handleResizeDown}
                onResizeMove={interactions.handleResizeMove}
                onResizeUp={interactions.handleResizeUp}
                onResizeKeyDown={interactions.handleResizeKeyDown}
                onDurationLoaded={handleClipDurationLoad}
              />
            ))}

            {selectedVideoClip && (
              <VideoSourceFilmStrip
                key={`filmstrip-${selectedVideoClip.id}`}
                clip={selectedVideoClip}
                pixelsPerSecond={pixelsPerSecond}
                thumbnailMode={thumbnailMode}
                thumbnailWidth={thumbnailWidth}
                thumbnailGap={THUMBNAIL_GAP}
                editingMode={
                  interactions.isFilmStripEditing &&
                  interactions.activeFilmStripEdit?.index ===
                    selectedVideoClip.index
                    ? interactions.activeFilmStripEdit.mode
                    : interactions.isResizing &&
                        interactions.activeResize?.index ===
                          selectedVideoClip.index
                      ? interactions.activeResize.edge
                      : null
                }
                onSourceWindowPointerDown={
                  interactions.handleFilmStripPointerDown
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
