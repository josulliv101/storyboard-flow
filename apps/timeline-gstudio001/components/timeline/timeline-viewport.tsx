import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { THUMBNAIL_GAP, TIMELINE_ITEM_TOP } from "./constants";
import type { useTimelineInteractions } from "./hooks/use-timeline-interactions";
import { TimelineClipItem } from "./timeline-clip-item";
import {
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "./timeline-grid";
import type { TimelineClip, TrimScrubPreview } from "./types";
import { PassiveVideoFilmStrip, VideoSourceFilmStrip } from "./video-source-filmstrip";
import { VideoTile } from "./video-tile";
import { formatSeconds } from "./utils";

type TimelineInteractions = ReturnType<typeof useTimelineInteractions>;

const PASSIVE_SCRUB_OVERLAY_WIDTH = 360;
const PASSIVE_SCRUB_OVERLAY_HEIGHT = 220;
const PASSIVE_SCRUB_OVERLAY_GAP = 12;

type PassiveScrubPreview = {
  anchorClipId: string;
  anchorClipIndex: number;
  overlayLeft: number;
  overlayTop: number;
  previewClip: TimelineClip;
  previewTime: number;
};

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
  showPassiveFilmstrips: boolean;
  gridMetrics: TimelineGridMetrics;
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
  showPassiveFilmstrips,
  gridMetrics,
  thumbnailMode,
  thumbnailWidth,
  timelineHeight,
  timelineWidth,
  visibleClips,
}: TimelineViewportProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const passiveScrubCleanupRef = useRef<(() => void) | null>(null);
  const [passiveScrubPreview, setPassiveScrubPreview] =
    useState<PassiveScrubPreview | null>(null);

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

  const getClipLeft = useCallback(
    (clip: TimelineClip) =>
      thumbnailMode && gridMetrics.enabled
        ? getTimelineGridItemLayout(clip.index, gridMetrics).left
        : thumbnailMode
        ? clip.index * (thumbnailWidth + THUMBNAIL_GAP)
        : clip.startTime * pixelsPerSecond,
    [gridMetrics, pixelsPerSecond, thumbnailMode, thumbnailWidth],
  );

  const getClipTop = useCallback(
    (clip: TimelineClip) =>
      thumbnailMode
        ? TIMELINE_ITEM_TOP +
          (gridMetrics.enabled
            ? getTimelineGridItemLayout(clip.index, gridMetrics).top
            : 0)
        : TIMELINE_ITEM_TOP,
    [gridMetrics, thumbnailMode],
  );

  const getClipWidth = useCallback(
    (clip: TimelineClip) =>
      thumbnailMode && gridMetrics.enabled
        ? getTimelineGridItemLayout(clip.index, gridMetrics).width
        : thumbnailMode
        ? thumbnailWidth
        : clip.duration * pixelsPerSecond,
    [gridMetrics, pixelsPerSecond, thumbnailMode, thumbnailWidth],
  );

  const getPassiveScrubTarget = useCallback(
    (clientX: number, clientY: number) => {
      const content = contentRef.current;
      if (!content) return null;

      const rect = content.getBoundingClientRect();
      const contentX = clientX - rect.left;
      const contentY = clientY - rect.top;
      const clip = visibleClips.find((currentClip) => {
        if (currentClip.kind !== "video") return false;
        const left = getClipLeft(currentClip);
        const top = getClipTop(currentClip);
        const filmstripTop = top - TIMELINE_ITEM_TOP;
        const width = getClipWidth(currentClip);
        return (
          contentX >= left &&
          contentX <= left + width &&
          contentY >= filmstripTop &&
          contentY <= top + itemHeight
        );
      });
      if (!clip) return null;

      const left = getClipLeft(clip);
      const width = Math.max(1, getClipWidth(clip));
      const progress = Math.min(Math.max((contentX - left) / width, 0), 1);

      return {
        clip,
        previewTime: clip.trimIn + progress * clip.duration,
      };
    },
    [getClipLeft, getClipTop, getClipWidth, itemHeight, visibleClips],
  );

  const cleanupPassiveScrub = useCallback(() => {
    passiveScrubCleanupRef.current?.();
    passiveScrubCleanupRef.current = null;
    setPassiveScrubPreview(null);
  }, []);

  const handlePassiveFilmStripPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLDivElement>,
      clip: TimelineClip,
    ) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;

      event.stopPropagation();
      event.preventDefault();
      cleanupPassiveScrub();

      const targetElement = event.currentTarget;
      const anchorRect = targetElement.getBoundingClientRect();
      const overlayLeft = Math.min(
        Math.max(
          anchorRect.left +
            anchorRect.width / 2 -
            PASSIVE_SCRUB_OVERLAY_WIDTH / 2,
          8,
        ),
        Math.max(8, window.innerWidth - PASSIVE_SCRUB_OVERLAY_WIDTH - 8),
      );
      const overlayTop = Math.max(
        8,
        anchorRect.top -
          PASSIVE_SCRUB_OVERLAY_HEIGHT -
          PASSIVE_SCRUB_OVERLAY_GAP,
      );

      const updatePreview = (clientX: number, clientY: number) => {
        const scrubTarget = getPassiveScrubTarget(clientX, clientY);
        const previewClip = scrubTarget?.clip ?? clip;
        const previewTime =
          scrubTarget?.previewTime ??
          clip.trimIn + clip.duration / 2;

        setPassiveScrubPreview({
          anchorClipId: clip.id,
          anchorClipIndex: clip.index,
          overlayLeft,
          overlayTop,
          previewClip,
          previewTime,
        });
      };

      updatePreview(event.clientX, event.clientY);

      try {
        targetElement.setPointerCapture(event.pointerId);
      } catch {}

      const onPointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        pointerEvent.preventDefault();
        updatePreview(pointerEvent.clientX, pointerEvent.clientY);
      };

      const finishScrub = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        try {
          if (targetElement.hasPointerCapture(pointerEvent.pointerId)) {
            targetElement.releasePointerCapture(pointerEvent.pointerId);
          }
        } catch {}
        cleanupPassiveScrub();
      };

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", finishScrub);
      window.addEventListener("pointercancel", finishScrub);
      passiveScrubCleanupRef.current = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finishScrub);
        window.removeEventListener("pointercancel", finishScrub);
      };
    },
    [
      cleanupPassiveScrub,
      getClipLeft,
      getClipTop,
      getClipWidth,
      getPassiveScrubTarget,
    ],
  );

  useEffect(() => cleanupPassiveScrub, [cleanupPassiveScrub]);

  const passiveScrubOverlay = passiveScrubPreview ? (
    <div
      data-testid="timeline-passive-scrub-overlay"
      data-anchor-clip-index={passiveScrubPreview.anchorClipIndex}
      data-anchor-clip-id={passiveScrubPreview.anchorClipId}
      data-preview-clip-index={passiveScrubPreview.previewClip.index}
      data-preview-time={passiveScrubPreview.previewTime}
      className="pointer-events-none fixed overflow-hidden rounded-lg border border-sky-300 bg-zinc-950 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
      style={{
        width: `${PASSIVE_SCRUB_OVERLAY_WIDTH}px`,
        height: `${PASSIVE_SCRUB_OVERLAY_HEIGHT}px`,
        left: `${passiveScrubPreview.overlayLeft}px`,
        top: `${passiveScrubPreview.overlayTop}px`,
        zIndex: 70,
      }}
    >
      <VideoTile
        src={passiveScrubPreview.previewClip.src}
        poster={passiveScrubPreview.previewClip.poster}
        alt=""
        previewTime={passiveScrubPreview.previewTime}
        sourceDuration={passiveScrubPreview.previewClip.sourceDuration}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/75 px-2 py-1 font-mono text-[10px] text-zinc-100">
        <span>clip {passiveScrubPreview.previewClip.index}</span>
        <span>{formatSeconds(passiveScrubPreview.previewTime)}</span>
      </div>
    </div>
  ) : null;

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
            ref={contentRef}
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
                gridMetrics={gridMetrics}
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
                isReordering={interactions.isReordering}
                reorderPreview={
                  interactions.reorderPreview?.activeClipId === clip.id
                    ? interactions.reorderPreview
                    : null
                }
                onResizeDown={interactions.handleResizeDown}
                onResizeMove={interactions.handleResizeMove}
                onResizeUp={interactions.handleResizeUp}
                onResizeKeyDown={interactions.handleResizeKeyDown}
                onDurationLoaded={handleClipDurationLoad}
              />
            ))}

            {showPassiveFilmstrips &&
              !interactions.isReordering &&
              selectedIndex === null &&
              visibleClips.map((clip) =>
                clip.kind === "video" ? (
                  <PassiveVideoFilmStrip
                    key={`${clip.id}-passive-filmstrip`}
                    clip={clip}
                    pixelsPerSecond={pixelsPerSecond}
                    thumbnailMode={thumbnailMode}
                    gridMetrics={gridMetrics}
                    thumbnailWidth={thumbnailWidth}
                    thumbnailGap={THUMBNAIL_GAP}
                    onPointerDown={handlePassiveFilmStripPointerDown}
                  />
                ) : null,
              )}

            {selectedVideoClip && !interactions.isReordering && (
              <VideoSourceFilmStrip
                key={`filmstrip-${selectedVideoClip.id}`}
                clip={selectedVideoClip}
                pixelsPerSecond={pixelsPerSecond}
                thumbnailMode={thumbnailMode}
                gridMetrics={gridMetrics}
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
      {passiveScrubOverlay}
    </div>
  );
}
