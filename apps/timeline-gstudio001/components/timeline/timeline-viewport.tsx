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
import type { TimelineClip, TrimScrubPreview, VideoTimelineClip } from "./types";
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
  previewClip: VideoTimelineClip;
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
  scrollTop: number;
  selectedIndex: number | null;
  selectedVideoClip: VideoTimelineClip | null;
  showPassiveFilmstrips: boolean;
  gridMetrics: TimelineGridMetrics;
  getCollectionHref?: (timelineId: string) => string;
  onOpenCollection?: (timelineId: string, href: string) => void;
  thumbnailMode: boolean;
  thumbnailWidth: number;
  timelineHeight: number;
  timelineWidth: number;
  visibleClips: TimelineClip[];
  onDropFiles?: (insertIndex: number, files: File[]) => void;
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
  scrollTop,
  selectedIndex,
  selectedVideoClip,
  showPassiveFilmstrips,
  gridMetrics,
  getCollectionHref,
  onOpenCollection,
  thumbnailMode,
  thumbnailWidth,
  timelineHeight,
  timelineWidth,
  visibleClips,
  onDropFiles,
}: TimelineViewportProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const passiveScrubCleanupRef = useRef<(() => void) | null>(null);
  const [passiveScrubPreview, setPassiveScrubPreview] =
    useState<PassiveScrubPreview | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);


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
    scrollbarGutter: gridMetrics.enabled ? undefined : "stable both-edges",
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
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      dragCounterRef.current = 0;

      if (!onDropFiles || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

      const files = Array.from(e.dataTransfer.files);
      const mediaFiles = files.filter(
        (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
      );
      if (mediaFiles.length === 0) return;

      let insertIndex = 0;
      if (hasClips && contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect();
        const dropX = e.clientX - rect.left;

        insertIndex = visibleClips.length;
        for (let i = 0; i < visibleClips.length; i++) {
          const clip = visibleClips[i];
          const left = getClipLeft(clip);
          const width = getClipWidth(clip);
          const midpoint = left + width / 2;
          if (dropX < midpoint) {
            insertIndex = clip.index;
            break;
          }
        }
      }

      onDropFiles(insertIndex, mediaFiles);
    },
    [getClipLeft, getClipWidth, hasClips, onDropFiles, visibleClips],
  );


  const getPassiveScrubTarget = useCallback(
    (clientX: number, clientY: number) => {
      const content = contentRef.current;
      if (!content) return null;

      const rect = content.getBoundingClientRect();
      const contentX = clientX - rect.left;
      const contentY = clientY - rect.top;
      const clip = visibleClips.find(
        (currentClip): currentClip is VideoTimelineClip => {
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
        },
      );
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
      clip: VideoTimelineClip,
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
      data-scroll-top={scrollTop}
      onScroll={handleScroll}
      onPointerDown={interactions.handlePointerDown}
      onPointerCancel={interactions.handlePointerCancel}
      onDragStart={(event) => event.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative block w-full max-w-full min-w-0 select-none rounded-lg border transition-all duration-200 ${
        isDragOver ? "border-sky-500 bg-sky-950/20 ring-2 ring-sky-500/50" : "border-zinc-800 bg-zinc-950"
      } ${
        gridMetrics.enabled
          ? "overflow-x-clip overflow-y-visible"
          : "cursor-grab touch-none overflow-x-scroll overflow-y-hidden pb-1.5 active:cursor-grabbing"
      }`}
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
                getCollectionHref={getCollectionHref}
                onOpenCollection={onOpenCollection}
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
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-sky-400 bg-sky-950/40 backdrop-blur-sm transition-all duration-300">
          <div className="flex flex-col items-center gap-2 p-6 text-center text-sky-200 pointer-events-none">
            <svg
              className="h-10 w-10 animate-bounce text-sky-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            <p className="font-semibold text-sm">Drop to insert media</p>
            <p className="text-xs text-sky-300/80">Images or Video clips (clamped to max 12s)</p>
          </div>
        </div>
      )}
    </div>
  );
}
