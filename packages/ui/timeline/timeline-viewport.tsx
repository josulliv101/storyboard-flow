import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { TimelineClipItem } from "./TimelineClipItem";
import { TimelineClipItemProvider } from "./TimelineClipItemContext";
import { Play } from "lucide-react";

import {
  CLIP_GAP_SECONDS,
  FILMSTRIP_GAP,
  FILMSTRIP_HEIGHT,
  THUMBNAIL_GAP,
  TIMELINE_LEADING_PADDING_SECONDS,
} from "./constants";
import {
  useTimelineDropTargets,
  type TimelineDropHandlers,
} from "./hooks/use-timeline-drop-targets";
import type { useTimelineInteractions } from "./hooks/use-timeline-interactions";
import {
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "./timeline-grid";
import { TimelineContextMenu } from "./timeline-context-menu";
import {
  TimelineDropIndicator,
  TimelineDropOverlay,
} from "./timeline-drop-overlays";
import { TimelinePlayhead } from "./timeline-playhead";
import type {
  CollectionEndpoint,
  CollectionTimelineClip,
  TimelineClip,
  TrimScrubPreview,
} from "./types";
import { PassiveVideoFilmStrip, VideoSourceFilmStrip } from "./video-source-filmstrip";
import { formatSeconds } from "./utils";
import { VideoTile } from "./video-tile";
import { getCollectionClipFramePreview } from "./timeline-documents";

type TimelineInteractions = ReturnType<typeof useTimelineInteractions>;

type TimelineViewportFrame = {
  handleScroll: () => void;
  parentRef: RefObject<HTMLDivElement | null>;
  resolvedViewportWidth: number | string;
  scrollLeft: number;
  scrollTop: number;
  timelineHeight: number;
  timelineWidth: number;
};

type TimelineViewportLayout = {
  gridMetrics: TimelineGridMetrics;
  hasClips: boolean;
  itemHeight: number;
  itemTop: number;
  pixelsPerSecond: number;
  thumbnailMode: boolean;
  thumbnailWidth: number;
  visibleClips: TimelineClip[];
};

type TimelineViewportOverhang = {
  closingOverhangOffset: number;
  firstOverhang: number;
  isClosingOverhang: boolean;
  isResizingFirstClipLeft: boolean;
  manualOverhangScroll: boolean;
  prevFirstOverhang: number;
};

type TimelineViewportSelection = {
  handleClipDurationLoad?: (index: number, duration: number) => void;
  scrubPreview: TrimScrubPreview | null;
  selectedIndex: number | null;
};

type TimelineViewportCollections = {
  expandedCollectionIds?: ReadonlySet<string>;
  exposedCollectionEndpointIds?: ReadonlySet<string>;
  getCollectionHref?: (timelineId: string) => string;
  onOpenCollection?: (timelineId: string, href: string) => void;
  onToggleCollectionEndpoint?: (
    clip: CollectionTimelineClip,
    endpoint: CollectionEndpoint,
  ) => void;
  onToggleCollectionExpanded?: (clip: CollectionTimelineClip) => void;
  onRenameCollection?: (clip: CollectionTimelineClip, title: string) => void;
};

type TimelineViewportPlayback = {
  onPlayheadTimeChange?: (
    time: number,
    clips?: TimelineClip[],
    activeClipId?: string,
  ) => void;
  playheadTime?: number | null;
  previewLargeSurface?: boolean;
  selectedVideoClip: TimelineClip | null;
  showPassiveFilmstrips: boolean;
  showPlayBarArea: boolean;
};

type TimelineViewportProps = {
  collections?: TimelineViewportCollections;
  dropHandlers?: TimelineDropHandlers;
  frame: TimelineViewportFrame;
  interactions: TimelineInteractions;
  isZooming: boolean;
  layout: TimelineViewportLayout;
  overhang: TimelineViewportOverhang;
  playback: TimelineViewportPlayback;
  selection: TimelineViewportSelection;
  timelineId?: string;
};

export function TimelineViewport({
  collections,
  dropHandlers,
  frame,
  interactions,
  isZooming,
  layout,
  overhang,
  playback,
  selection,
  timelineId,
}: TimelineViewportProps) {
  const {
    handleScroll,
    parentRef,
    resolvedViewportWidth,
    scrollLeft,
    scrollTop,
    timelineHeight,
    timelineWidth,
  } = frame;
  const {
    gridMetrics,
    hasClips,
    itemHeight,
    itemTop,
    pixelsPerSecond,
    thumbnailMode,
    thumbnailWidth,
    visibleClips,
  } = layout;
  const {
    closingOverhangOffset,
    firstOverhang,
    isClosingOverhang,
    isResizingFirstClipLeft,
    manualOverhangScroll,
    prevFirstOverhang,
  } = overhang;
  const { handleClipDurationLoad, scrubPreview, selectedIndex } = selection;
  const {
    expandedCollectionIds,
    exposedCollectionEndpointIds,
    getCollectionHref,
    onOpenCollection,
    onRenameCollection,
    onToggleCollectionEndpoint,
    onToggleCollectionExpanded,
  } = collections ?? {};
  const {
    onDropClip,
    onDropClipIntoCollection,
    onDropFiles,
    onDropSidebarClip,
    onDropSidebarClipIntoCollection,
  } = dropHandlers ?? {};
  const {
    onPlayheadTimeChange,
    playheadTime: propPlayheadTime,
    previewLargeSurface = false,
    selectedVideoClip,
    showPassiveFilmstrips,
    showPlayBarArea,
  } = playback;
  const contentRef = useRef<HTMLDivElement>(null);

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
        ? itemTop +
          (gridMetrics.enabled
            ? getTimelineGridItemLayout(clip.index, gridMetrics).top
            : 0)
        : itemTop,
    [gridMetrics, itemTop, thumbnailMode],
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
  const getClipPlaybackStart = useCallback(
    (clip: TimelineClip) => clip.playbackStartTime ?? clip.startTime,
    [],
  );
  const getClipPlaybackDuration = useCallback(
    (clip: TimelineClip) => Math.max(0.001, clip.playbackDuration ?? clip.duration),
    [],
  );
  const getClipPlaybackTimeAtX = useCallback(
    (clip: TimelineClip, contentX: number) => {
      const left = getClipLeft(clip);
      const width = getClipWidth(clip);
      const ratio = Math.max(0, Math.min(1, (contentX - left) / Math.max(1, width)));
      return getClipPlaybackStart(clip) + ratio * getClipPlaybackDuration(clip);
    },
    [getClipLeft, getClipPlaybackDuration, getClipPlaybackStart, getClipWidth],
  );
  const getCollectionPreviewClip = useCallback(
    (clip: CollectionTimelineClip): CollectionTimelineClip => {
      const playbackDuration = getClipPlaybackDuration(clip);
      return {
        ...clip,
        duration: playbackDuration,
        sourceDuration: Math.max(clip.sourceDuration, playbackDuration),
      };
    },
    [getClipPlaybackDuration],
  );
  const getDropIndicatorLeft = useCallback(
    (index: number) => {
      if (visibleClips.length === 0) {
        return TIMELINE_LEADING_PADDING_SECONDS * pixelsPerSecond;
      }
      if (index === 0) {
        return getClipLeft(visibleClips[0]);
      }
      if (index >= visibleClips.length) {
        const lastClip = visibleClips[visibleClips.length - 1];
        return getClipLeft(lastClip) + getClipWidth(lastClip) + CLIP_GAP_SECONDS * pixelsPerSecond;
      }
      const prevClip = visibleClips[index - 1];
      const nextClip = visibleClips[index];
      const prevRight = getClipLeft(prevClip) + getClipWidth(prevClip);
      const nextLeft = getClipLeft(nextClip);
      return prevRight + (nextLeft - prevRight) / 2;
    },
    [getClipLeft, getClipWidth, pixelsPerSecond, visibleClips],
  );

  const {
    activeCollectionHoverId,
    activeDropIndex,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    isAnyDragActive,
    isDragOver,
  } = useTimelineDropTargets({
    contentRef,
    getClipLeft,
    getClipWidth,
    hasClips,
    onDropClip,
    onDropClipIntoCollection,
    onDropFiles,
    onDropSidebarClip,
    onDropSidebarClipIntoCollection,
    timelineId,
    visibleClips,
  });

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    timelineTime: number;
    insertIndex: number;
  } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!contentRef.current) return;

    const rect = contentRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const timelineTime = Math.max(0, clickX / pixelsPerSecond);

    let insertIndex = visibleClips.length;
    for (let i = 0; i < visibleClips.length; i++) {
      const clip = visibleClips[i];
      const left = getClipLeft(clip);
      const width = getClipWidth(clip);
      const midpoint = left + width / 2;
      if (clickX < midpoint) {
        insertIndex = clip.index;
        break;
      }
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      timelineTime,
      insertIndex,
    });
  }, [visibleClips, getClipLeft, getClipWidth, pixelsPerSecond]);

  useEffect(() => {
    if (!contextMenu) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const [playheadTimeState, setPlayheadTimeState] = useState<number | null>(null);
  const playheadTime = propPlayheadTime ?? playheadTimeState;
  const updatePlayheadTime = useCallback((time: number, activeClipId?: string) => {
    setPlayheadTimeState(time);
    onPlayheadTimeChange?.(time, visibleClips, activeClipId);
  }, [onPlayheadTimeChange, visibleClips]);
  const [scrubbingState, setScrubbingState] = useState<{
    startX: number;
    startContentX: number;
    currentContentX: number;
    resolvedContentX: number;
    resolvedPlayheadTime: number;
    activeClipId: string;
    clientX: number;
    clientY: number;
  } | null>(null);
  const showFloatingDragPreview = !previewLargeSurface;

  const getClipContainingX = useCallback((contentX: number) => {
    return visibleClips.find((clip) => {
      const left = getClipLeft(clip);
      const right = left + getClipWidth(clip);
      return contentX >= left && contentX <= right;
    }) ?? null;
  }, [getClipLeft, getClipWidth, visibleClips]);

  const getPlayBarScrubSample = useCallback((
    contentX: number,
  ) => {
    const clip = getClipContainingX(contentX);
    if (!clip) return null;

    const left = getClipLeft(clip);
    const right = left + getClipWidth(clip);
    const resolvedContentX = Math.max(left, Math.min(right, contentX));
    return {
      clip,
      contentX: resolvedContentX,
    };
  }, [getClipContainingX, getClipLeft, getClipWidth]);

  const getPlayheadLeft = useCallback((time: number | null) => {
    if (time === null) return null;
    const activeClip = visibleClips.find(
      (clip) => {
        const playbackStart = getClipPlaybackStart(clip);
        const playbackDuration = getClipPlaybackDuration(clip);
        return time >= playbackStart && time <= playbackStart + playbackDuration;
      },
    );
    if (activeClip) {
      const playbackStart = getClipPlaybackStart(activeClip);
      const playbackDuration = getClipPlaybackDuration(activeClip);
      const ratio = Math.max(
        0,
        Math.min(1, (time - playbackStart) / playbackDuration),
      );
      return getClipLeft(activeClip) + ratio * getClipWidth(activeClip);
    }

    if (!thumbnailMode) {
      return time * pixelsPerSecond;
    }

    return null;
  }, [thumbnailMode, pixelsPerSecond, visibleClips, getClipLeft, getClipPlaybackDuration, getClipPlaybackStart, getClipWidth]);

  const updatePlayheadFromScrubSample = useCallback((sample: {
    clip: TimelineClip;
    contentX: number;
  }) => {
    const playheadTime = getClipPlaybackTimeAtX(sample.clip, sample.contentX);
    updatePlayheadTime(playheadTime, sample.clip.id);
    return playheadTime;
  }, [getClipPlaybackTimeAtX, updatePlayheadTime]);

  const handlePlayBarPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const content = contentRef.current;
    if (!content) return;

    const rect = content.getBoundingClientRect();
    const initialContentX = e.clientX - rect.left;
    const sample = getPlayBarScrubSample(initialContentX);
    if (!sample) return;

    const resolvedPlayheadTime = updatePlayheadFromScrubSample(sample);

    setScrubbingState({
      startX: e.clientX,
      startContentX: initialContentX,
      currentContentX: initialContentX,
      resolvedContentX: sample.contentX,
      resolvedPlayheadTime,
      activeClipId: sample.clip.id,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, [getPlayBarScrubSample, updatePlayheadFromScrubSample]);

  const handleDragBarPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingState) return;
    e.stopPropagation();

    const deltaX = e.clientX - scrubbingState.startX;
    const currentContentX = scrubbingState.startContentX + deltaX;
    const sample = getPlayBarScrubSample(currentContentX);

    if (sample) {
      const resolvedPlayheadTime = updatePlayheadFromScrubSample(sample);
      setScrubbingState({
        ...scrubbingState,
        currentContentX,
        resolvedContentX: sample.contentX,
        resolvedPlayheadTime,
        activeClipId: sample.clip.id,
        clientX: e.clientX,
        clientY: e.clientY,
      });
      return;
    }

    setScrubbingState({
      ...scrubbingState,
      currentContentX,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, [getPlayBarScrubSample, scrubbingState, updatePlayheadFromScrubSample]);

  const handleDragBarPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingState) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    setScrubbingState(null);
  }, [scrubbingState]);

  const clipItemProviderValue = useMemo(() => ({
    metrics: {
      pixelsPerSecond,
      itemTop,
      itemHeight,
      thumbnailMode,
      gridMetrics,
      thumbnailWidth,
      thumbnailGap: THUMBNAIL_GAP,
    },
    resizeHandlers: {
      onResizeDown: interactions.handleResizeDown,
      onResizeMove: interactions.handleResizeMove,
      onResizeUp: interactions.handleResizeUp,
      onResizeKeyDown: interactions.handleResizeKeyDown,
    },
    mediaActions: {
      onDurationLoaded: handleClipDurationLoad,
    },
    collectionActions: {
      getCollectionHref,
      onOpenCollection,
      onRenameCollection,
      onToggleCollectionExpanded,
      onToggleCollectionEndpoint,
    },
  }), [
    getCollectionHref,
    gridMetrics,
    handleClipDurationLoad,
    interactions.handleResizeDown,
    interactions.handleResizeKeyDown,
    interactions.handleResizeMove,
    interactions.handleResizeUp,
    itemHeight,
    itemTop,
    onOpenCollection,
    onRenameCollection,
    onToggleCollectionEndpoint,
    onToggleCollectionExpanded,
    pixelsPerSecond,
    thumbnailMode,
    thumbnailWidth,
  ]);

  const selectedFilmstripOverlay =
    showPlayBarArea && selectedVideoClip && !interactions.isReordering ? (
      <div
        className="pointer-events-none absolute inset-0 z-[45]"
        style={{
          clipPath: `inset(-${FILMSTRIP_HEIGHT + FILMSTRIP_GAP + 12}px 0 -12px 0)`,
        }}
      >
        <VideoSourceFilmStrip
          key={`filmstrip-${selectedVideoClip.id}`}
          clip={selectedVideoClip}
          pixelsPerSecond={pixelsPerSecond}
          leftOffset={firstOverhang + closingOverhangOffset + interactions.trackTranslateX - scrollLeft}
          thumbnailMode={thumbnailMode}
          gridMetrics={gridMetrics}
          thumbnailWidth={thumbnailWidth}
          thumbnailGap={THUMBNAIL_GAP}
          topOffset={
            itemTop +
            (thumbnailMode && gridMetrics.enabled
              ? getTimelineGridItemLayout(selectedVideoClip.index, gridMetrics).top
              : 0) -
            FILMSTRIP_HEIGHT -
            FILMSTRIP_GAP
          }
          editingMode={
            interactions.isFilmStripEditing &&
            interactions.activeFilmStripEdit?.index === selectedVideoClip.index
              ? interactions.activeFilmStripEdit.mode
              : interactions.isResizing &&
                  interactions.activeResize?.index === selectedVideoClip.index
                ? interactions.activeResize.edge
                : null
          }
          onSourceWindowPointerDown={interactions.handleFilmStripPointerDown}
        />
      </div>
    ) : null;

  const viewportWrapperStyle: CSSProperties = {
    width: resolvedViewportWidth,
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
  };
  return (
    <div
      className="relative block w-full max-w-full min-w-0"
      style={viewportWrapperStyle}
    >
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
        isDragOver
          ? "border-sky-500 bg-sky-950/20 ring-2 ring-sky-500/50"
          : isAnyDragActive
          ? "border-dashed border-sky-400 bg-sky-950/5 animate-pulse"
          : "border-zinc-800 bg-zinc-950"
      } ${
        gridMetrics.enabled
          ? "overflow-x-clip overflow-y-visible"
          : "cursor-grab touch-none overflow-x-scroll overflow-y-hidden pb-1.5 active:cursor-grabbing"
      }`}
      onContextMenu={handleContextMenu}
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
        <div
          ref={contentRef}
          className="relative w-full h-full"
          style={{
            transform: `translateX(${firstOverhang + closingOverhangOffset}px)`,
            transition: contentTransition,
          }}
        >
          {!hasClips ? (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
              No items
            </div>
          ) : (
            <>
              <TimelineClipItemProvider value={clipItemProviderValue}>
                {visibleClips.map((clip) => (
                  <TimelineClipItem
                    key={clip.id}
                    clip={clip}
                    state={{
                      isSelected: selectedIndex === clip.index,
                      isGrowingOpposite:
                        interactions.activeResize?.index === 0 &&
                        interactions.activeResize.edge === "left" &&
                        clip.index === 0,
                      scrubPreviewTime:
                        scrubPreview?.clipIndex === clip.index
                          ? scrubPreview.time
                          : null,
                      isReordering: interactions.isReordering,
                      isCollectionHovered: activeCollectionHoverId === clip.id,
                      reorderPreview:
                        interactions.reorderPreview?.activeClipId === clip.id
                          ? interactions.reorderPreview
                          : null,
                      isCollectionExpanded:
                        clip.kind === "collection" &&
                        Boolean(expandedCollectionIds?.has(clip.viewExpansionKey ?? clip.id)),
                      collectionEndpointSelection:
                        clip.kind === "collection"
                          ? {
                              first: Boolean(
                                exposedCollectionEndpointIds?.has(
                                  `${clip.viewExpansionKey ?? clip.id}::first`,
                                ),
                              ),
                              last: Boolean(
                                exposedCollectionEndpointIds?.has(
                                  `${clip.viewExpansionKey ?? clip.id}::last`,
                                ),
                              ),
                            }
                          : undefined,
                    }}
                  />
                ))}
              </TimelineClipItemProvider>

              {/* Vertical Playhead line */}
              {playheadTime !== null && (() => {
                const pLeft = getPlayheadLeft(playheadTime);
                if (pLeft === null) return null;
                return (
                  <TimelinePlayhead
                    itemHeight={itemHeight}
                    itemTop={itemTop}
                    left={pLeft}
                  />
                );
              })()}

              {!interactions.isReordering &&
                selectedIndex === null &&
                showPlayBarArea &&
                visibleClips.map((clip) =>
                  clip.kind === "video" || clip.kind === "image" ? (
                    <PassiveVideoFilmStrip
                      key={`${clip.id}-passive-filmstrip`}
                      clip={clip}
                      pixelsPerSecond={pixelsPerSecond}
                      thumbnailMode={thumbnailMode}
                      gridMetrics={gridMetrics}
                      thumbnailWidth={thumbnailWidth}
                      thumbnailGap={THUMBNAIL_GAP}
                      onPointerDown={(event) => handlePlayBarPointerDown(event)}
                      onPointerMove={(event) => handleDragBarPointerMove(event)}
                      onPointerUp={(event) => handleDragBarPointerUp(event)}
                      onPointerCancel={(event) => handleDragBarPointerUp(event)}
                      showFilmstrip={showPassiveFilmstrips}
                    />
                  ) : null,
                )}

            </>
          )}
        </div>
      </div>
      <TimelineDropOverlay isVisible={isDragOver} />
      {activeDropIndex !== null && (
        <TimelineDropIndicator
          itemHeight={itemHeight}
          itemTop={itemTop}
          left={getDropIndicatorLeft(activeDropIndex)}
        />
      )}
      {contextMenu && createPortal(
        <TimelineContextMenu
          insertIndex={contextMenu.insertIndex}
          onAddClip={onDropSidebarClip}
          onClose={() => setContextMenu(null)}
          thumbnailMode={thumbnailMode}
          timelineTime={contextMenu.timelineTime}
          x={contextMenu.x}
          y={contextMenu.y}
        />,
        document.body
      )}
      {scrubbingState && showFloatingDragPreview && (() => {
        const previewClip =
          visibleClips.find((clip) => clip.id === scrubbingState.activeClipId);
        let previewSrc = "";
        let mediaTime = 0;
        let displayTime = 0;
        let previewKind: "video" | "image" | "collection" | null = null;
        let previewVideoSrc = "";
        let previewVideoTime = 0;
        let previewVideoDuration = 0;

        if (previewClip) {
          const left = getClipLeft(previewClip);
          const width = getClipWidth(previewClip);
          const ratio = Math.max(0, Math.min(1, (scrubbingState.resolvedContentX - left) / Math.max(1, width)));
          mediaTime = previewClip.kind === "collection"
            ? ratio * getClipPlaybackDuration(previewClip)
            : previewClip.trimIn + ratio * previewClip.duration;
          displayTime = scrubbingState.resolvedPlayheadTime;

          previewKind = previewClip.kind;

          if (previewClip.kind === "video") {
            previewVideoSrc = previewClip.src;
            previewVideoTime = mediaTime;
            previewVideoDuration = previewClip.duration;
            previewSrc = previewClip.src;
          } else if (previewClip.kind === "collection") {
            const activePreview = getCollectionClipFramePreview(getCollectionPreviewClip(previewClip), mediaTime);
            if (activePreview) {
              if (activePreview.kind === "video") {
                previewKind = "video";
                previewVideoSrc = activePreview.src;
                previewVideoTime = activePreview.previewTime;
                previewVideoDuration = activePreview.sourceDuration || 6;
                previewSrc = activePreview.src;
              } else {
                previewKind = "image";
                previewSrc = activePreview.src;
              }
            } else {
              const firstItem = previewClip.previewItems?.[0];
              if (firstItem) {
                if (firstItem.kind === "video") {
                  previewKind = "video";
                  previewVideoSrc = firstItem.src;
                  previewVideoTime = 0;
                  previewVideoDuration = 6;
                  previewSrc = firstItem.src;
                } else {
                  previewKind = "image";
                  previewSrc = firstItem.src;
                }
              }
            }
          } else if (previewClip.kind === "image") {
            previewSrc = previewClip.src;
          }
        }

        return createPortal(
          <div
            className="fixed z-[99999] rounded-xl bg-zinc-950/95 border border-zinc-800 p-2 shadow-2xl backdrop-blur-md text-[10px] font-bold text-zinc-100 flex flex-col items-center gap-2 animate-in fade-in zoom-in-95 duration-100 w-44 select-none"
            style={{
              left: `${scrubbingState.clientX}px`,
              top: `${scrubbingState.clientY - 145}px`,
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }}
          >
            {/* Visual Frame Thumbnail */}
            <div className="w-full aspect-video bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800/80 relative flex items-center justify-center">
              {previewSrc ? (
                previewKind === "video" ? (
                  <VideoTile
                    src={previewVideoSrc}
                    alt="Video preview"
                    previewTime={previewVideoTime}
                    sourceDuration={previewVideoDuration}
                    preferVideoPreview={true}
                  />
                ) : (
                  <img
                    src={previewSrc}
                    alt="Scrub frame preview"
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                )
              ) : (
                <div className="flex flex-col items-center justify-center text-zinc-600 gap-1">
                  <Play className="h-4 w-4 opacity-40" />
                  <span className="text-[8px] uppercase tracking-wider">No Media</span>
                </div>
              )}
            </div>

            {/* Time label info */}
            <div className="flex w-full items-center justify-between px-1">
              <span className="text-amber-400 font-extrabold uppercase tracking-wide">
                {previewClip ? `${previewClip.kind} #${previewClip.index + 1}` : "Playhead"}
              </span>
              <span className="text-zinc-300 font-extrabold">
                {formatSeconds(displayTime)}
              </span>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
    {selectedFilmstripOverlay}
    </div>
  );
}
