import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Folder, Video, Image, X, Play } from "lucide-react";

import {
  CLIP_GAP_SECONDS,
  FILMSTRIP_GAP,
  FILMSTRIP_HEIGHT,
  THUMBNAIL_GAP,
  TIMELINE_LEADING_PADDING_SECONDS,
} from "./constants";
import type { useTimelineInteractions } from "./hooks/use-timeline-interactions";
import { TimelineClipItem } from "./timeline-clip-item";
import {
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "./timeline-grid";
import type { TimelineClip, TrimScrubPreview, VideoTimelineClip } from "./types";
import { PassiveVideoFilmStrip, VideoSourceFilmStrip, getVideoThumbnailUrl } from "./video-source-filmstrip";
import { VideoTile } from "./video-tile";
import { formatSeconds } from "./utils";
import { getCollectionClipFramePreview } from "@/lib/timeline-documents";

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
  itemTop: number;
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
  selectedVideoClip: TimelineClip | null;
  showPlayBarArea: boolean;
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
  onDropClip?: (insertIndex: number, clip: TimelineClip, sourceTimelineId: string) => void;
  onDropSidebarClip?: (insertIndex: number, type: "collection" | "image" | "video") => void;
  onDropClipIntoCollection?: (clip: TimelineClip, targetCollectionTimelineId: string, sourceTimelineId: string) => void;
  onDropSidebarClipIntoCollection?: (type: "collection" | "image" | "video", targetCollectionTimelineId: string) => void;
  timelineId?: string;
  dragBarEnabled?: boolean;
  playheadTime?: number | null;
  onPlayheadTimeChange?: (time: number) => void;
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
  itemTop,
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
  showPlayBarArea,
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
  onDropClip,
  onDropSidebarClip,
  onDropClipIntoCollection,
  onDropSidebarClipIntoCollection,
  timelineId,
  dragBarEnabled = false,
  playheadTime: propPlayheadTime,
  onPlayheadTimeChange,
}: TimelineViewportProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const passiveScrubCleanupRef = useRef<(() => void) | null>(null);
  const [passiveScrubPreview, setPassiveScrubPreview] =
    useState<PassiveScrubPreview | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [activeCollectionHoverId, setActiveCollectionHoverId] = useState<string | null>(null);
  const [activeDropIndex, setActiveDropIndex] = useState<number | null>(null);
  const [isAnyDragActive, setIsAnyDragActive] = useState(false);

  useEffect(() => {
    const handleDragStartGlobal = (e: Event) => {
      const customEvent = e as CustomEvent<{ type: string }>;
      const type = customEvent.detail.type;
      if (type !== "timeline") {
        setIsAnyDragActive(true);
      }
    };

    const handleDragEndGlobal = () => {
      setIsAnyDragActive(false);
    };

    window.addEventListener("gstudio-drag-start", handleDragStartGlobal);
    window.addEventListener("gstudio-drag-end", handleDragEndGlobal);
    return () => {
      window.removeEventListener("gstudio-drag-start", handleDragStartGlobal);
      window.removeEventListener("gstudio-drag-end", handleDragEndGlobal);
    };
  }, []);

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
      setActiveDropIndex(null);
      setActiveCollectionHoverId(null);
    }
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

  useEffect(() => {
    const handleClipDragGlobal = (e: Event) => {
      const customEvent = e as CustomEvent<{
        clip: TimelineClip;
        sourceTimelineId: string;
        clientX: number;
        clientY: number;
        isDropping: boolean;
        handled?: boolean;
      }>;
      const { clip, sourceTimelineId, clientX, clientY, isDropping } = customEvent.detail;
      const thisTimelineId = timelineId || "";
      const isSameTimeline = sourceTimelineId === thisTimelineId;

      const rect = contentRef.current?.getBoundingClientRect();
      const isInside = rect && 
                        clientX >= rect.left && 
                        clientX <= rect.right && 
                        clientY >= rect.top && 
                        clientY <= rect.bottom;

      if (isInside) {
        let hoveredCollection: TimelineClip | null = null;
        let insertIndex = visibleClips.length;

        if (hasClips && contentRef.current) {
          const dropX = clientX - rect.left;

          // Check if hovering middle 60% of another collection clip
          for (let i = 0; i < visibleClips.length; i++) {
            const c = visibleClips[i];
            if (c.kind === "collection" && c.id !== clip.id) {
              const left = getClipLeft(c);
              const width = getClipWidth(c);
              const paddingX = width * 0.2;
              if (dropX >= left + paddingX && dropX <= left + width - paddingX) {
                hoveredCollection = c;
                break;
              }
            }
          }

          if (!hoveredCollection) {
            if (!isSameTimeline) {
              insertIndex = visibleClips.length;
              for (let i = 0; i < visibleClips.length; i++) {
                const c = visibleClips[i];
                const left = getClipLeft(c);
                const width = getClipWidth(c);
                const midpoint = left + width / 2;
                if (dropX < midpoint) {
                  insertIndex = c.index;
                  break;
                }
              }
            }
          }
        }

        if (isDropping) {
          setActiveDropIndex(null);
          setActiveCollectionHoverId(null);

          if (hoveredCollection) {
            if (hoveredCollection.kind === "collection" && onDropClipIntoCollection) {
              onDropClipIntoCollection(clip, hoveredCollection.childTimelineId, sourceTimelineId);
              customEvent.detail.handled = true;
            }
          } else {
            if (!isSameTimeline && onDropClip) {
              onDropClip(insertIndex, clip, sourceTimelineId);
              customEvent.detail.handled = true;
            }
          }
        } else {
          if (hoveredCollection) {
            setActiveCollectionHoverId(hoveredCollection.id);
            setActiveDropIndex(null);
          } else {
            setActiveCollectionHoverId(null);
            if (!isSameTimeline) {
              setActiveDropIndex(insertIndex);
            } else {
              setActiveDropIndex(null);
            }
          }
        }
      } else {
        setActiveDropIndex(null);
        setActiveCollectionHoverId(null);
      }
    };

    window.addEventListener("gstudio-clip-drag", handleClipDragGlobal);
    return () => {
      window.removeEventListener("gstudio-clip-drag", handleClipDragGlobal);
    };
  }, [timelineId, getClipLeft, getClipWidth, hasClips, visibleClips, onDropClip, onDropClipIntoCollection]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    const isFiles = e.dataTransfer.types.includes("Files");
    const isClip = e.dataTransfer.types.includes("application/json") || 
                   e.dataTransfer.types.includes("application/x-gstudio-type");

    if (!isFiles && !isClip) return;

    let hoveredCollection: TimelineClip | null = null;
    let insertIndex = 0;

    if (hasClips && contentRef.current) {
      const rect = contentRef.current.getBoundingClientRect();
      const dropX = e.clientX - rect.left;

      // Check if hovering middle 60% of any collection clip
      for (let i = 0; i < visibleClips.length; i++) {
        const c = visibleClips[i];
        if (c.kind === "collection") {
          const left = getClipLeft(c);
          const width = getClipWidth(c);
          const paddingX = width * 0.2;
          if (dropX >= left + paddingX && dropX <= left + width - paddingX) {
            hoveredCollection = c;
            break;
          }
        }
      }

      if (!hoveredCollection) {
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
    }

    if (hoveredCollection) {
      setActiveCollectionHoverId(hoveredCollection.id);
      setActiveDropIndex(null);
    } else {
      setActiveCollectionHoverId(null);
      setActiveDropIndex(insertIndex);
    }
  }, [getClipLeft, getClipWidth, hasClips, visibleClips]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      setActiveDropIndex(null);
      dragCounterRef.current = 0;

      // 1. Try parsing sidebar block drop data
      const sidebarType = e.dataTransfer.getData("application/x-gstudio-type") as "collection" | "image" | "video" | "";
      if (sidebarType && (sidebarType === "collection" || sidebarType === "image" || sidebarType === "video")) {
        if (activeCollectionHoverId) {
          const targetCol = visibleClips.find(c => c.id === activeCollectionHoverId);
          if (targetCol && targetCol.kind === "collection" && onDropSidebarClipIntoCollection) {
            onDropSidebarClipIntoCollection(sidebarType, targetCol.childTimelineId);
          }
          setActiveCollectionHoverId(null);
          return;
        }

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
        if (onDropSidebarClip) {
          onDropSidebarClip(insertIndex, sidebarType);
        }
        setActiveCollectionHoverId(null);
        return;
      }

      // 2. Try parsing drag-and-drop clip data (dragging clips between timelines)
      const rawData = e.dataTransfer.getData("application/json");
      if (rawData) {
        try {
          const data = JSON.parse(rawData);
          if (data && data.clip && data.sourceTimelineId !== undefined) {
            if (activeCollectionHoverId) {
              const targetCol = visibleClips.find(c => c.id === activeCollectionHoverId);
              if (targetCol && targetCol.kind === "collection" && onDropClipIntoCollection) {
                onDropClipIntoCollection(data.clip, targetCol.childTimelineId, data.sourceTimelineId);
              }
              setActiveCollectionHoverId(null);
              return;
            }

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

            if (onDropClip) {
              onDropClip(insertIndex, data.clip, data.sourceTimelineId);
            }
            setActiveCollectionHoverId(null);
            return;
          }
        } catch (err) {
          // not JSON, fallback to files
        }
      }

      // 3. Fallback to files drop
      if (!onDropFiles || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
        setActiveCollectionHoverId(null);
        return;
      }

      const files = Array.from(e.dataTransfer.files);
      const mediaFiles = files.filter(
        (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
      );
      if (mediaFiles.length === 0) {
        setActiveCollectionHoverId(null);
        return;
      }

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
      setActiveCollectionHoverId(null);
    },
    [getClipLeft, getClipWidth, hasClips, onDropFiles, onDropClip, onDropSidebarClip, onDropClipIntoCollection, onDropSidebarClipIntoCollection, activeCollectionHoverId, visibleClips],
  );

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
  const updatePlayheadTime = useCallback((time: number) => {
    setPlayheadTimeState(time);
    onPlayheadTimeChange?.(time);
  }, [onPlayheadTimeChange]);
  const [scrubbingState, setScrubbingState] = useState<{
    startX: number;
    startContentX: number;
    currentContentX: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  const getClipAtX = useCallback((contentX: number) => {
    if (visibleClips.length === 0) return null;
    let nearestClip = visibleClips[0];
    let minDistance = Infinity;

    for (const c of visibleClips) {
      const left = getClipLeft(c);
      const width = getClipWidth(c);
      const right = left + width;

      if (contentX >= left && contentX <= right) {
        return c;
      }

      const dist = Math.min(Math.abs(contentX - left), Math.abs(contentX - right));
      if (dist < minDistance) {
        minDistance = dist;
        nearestClip = c;
      }
    }
    return nearestClip;
  }, [visibleClips, getClipLeft, getClipWidth]);

  const getPlayheadLeft = useCallback((time: number | null) => {
    if (time === null) return null;
    const activeClip = visibleClips.find(
      (clip) => time >= clip.startTime && time <= clip.startTime + clip.duration,
    );
    if (activeClip) {
      const ratio = Math.max(
        0,
        Math.min(1, (time - activeClip.startTime) / Math.max(0.1, activeClip.duration)),
      );
      return getClipLeft(activeClip) + ratio * getClipWidth(activeClip);
    }

    if (!thumbnailMode) {
      return time * pixelsPerSecond;
    }

    return null;
  }, [thumbnailMode, pixelsPerSecond, visibleClips, getClipLeft, getClipWidth]);

  const updatePlayheadFromContentX = useCallback((contentX: number) => {
    const clip = getClipAtX(contentX);
    if (!clip) return;

    const left = getClipLeft(clip);
    const width = getClipWidth(clip);
    const ratio = Math.max(0, Math.min(1, (contentX - left) / Math.max(1, width)));
    const globalTime = thumbnailMode
      ? clip.startTime + ratio * clip.duration
      : contentX / pixelsPerSecond;
    updatePlayheadTime(globalTime);
  }, [getClipAtX, getClipLeft, getClipWidth, thumbnailMode, pixelsPerSecond, updatePlayheadTime]);

  const handlePlayBarPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const content = contentRef.current;
    if (!content) return;

    const rect = content.getBoundingClientRect();
    const initialContentX = e.clientX - rect.left;
    updatePlayheadFromContentX(initialContentX);

    setScrubbingState({
      startX: e.clientX,
      startContentX: initialContentX,
      currentContentX: initialContentX,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, [updatePlayheadFromContentX]);

  const handleDragBarPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingState) return;
    e.stopPropagation();

    const deltaX = e.clientX - scrubbingState.startX;
    const currentContentX = scrubbingState.startContentX + deltaX;

    updatePlayheadFromContentX(currentContentX);

    setScrubbingState({
      ...scrubbingState,
      currentContentX,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, [scrubbingState, updatePlayheadFromContentX]);

  const handleDragBarPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingState) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    setScrubbingState(null);
  }, [scrubbingState]);

  const getPassiveScrubTarget = useCallback(
    (clientX: number, clientY: number) => {
      const content = contentRef.current;
      if (!content) return null;

      const rect = content.getBoundingClientRect();
      const contentX = clientX - rect.left;
      const contentY = clientY - rect.top;
      const clip = visibleClips.find(
        (currentClip) => {
        if (currentClip.kind !== "video" && currentClip.kind !== "collection" && currentClip.kind !== "image") return false;
        const left = getClipLeft(currentClip);
        const top = getClipTop(currentClip);
        const filmstripTop = Math.max(0, top - itemTop);
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
      const trimIn = (clip.kind === "collection" || clip.kind === "image") ? 0 : (clip as VideoTimelineClip).trimIn || 0;
      const time = trimIn + progress * clip.duration;

      let previewClip: any = clip;
      let previewTime = time;

      if (clip.kind === "collection") {
        const activePreview = getCollectionClipFramePreview(clip, time);
        if (activePreview) {
          previewClip = {
            id: activePreview.id,
            index: clip.index,
            kind: activePreview.kind,
            src: activePreview.src,
            poster: activePreview.poster,
            sourceDuration: activePreview.sourceDuration,
          };
          previewTime = activePreview.previewTime;
        }
      }

      return {
        clip: previewClip,
        previewTime,
      };
    },
    [getClipLeft, getClipTop, getClipWidth, itemHeight, itemTop, visibleClips],
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
        let previewClip = scrubTarget?.clip ?? clip;
        const trimIn = clip.kind === "collection" ? 0 : (clip as any).trimIn || 0;
        let previewTime =
          scrubTarget?.previewTime ??
          trimIn + clip.duration / 2;

        if (scrubTarget === null && clip.kind === "collection") {
          const activePreview = getCollectionClipFramePreview(clip, previewTime);
          if (activePreview) {
            previewClip = {
              id: activePreview.id,
              index: clip.index,
              kind: activePreview.kind,
              src: activePreview.src,
              poster: activePreview.poster,
              sourceDuration: activePreview.sourceDuration,
            };
            previewTime = activePreview.previewTime;
          }
        }

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
      {passiveScrubPreview.previewClip.kind === "video" ? (
        <VideoTile
          src={passiveScrubPreview.previewClip.src}
          poster={passiveScrubPreview.previewClip.poster}
          alt=""
          previewTime={passiveScrubPreview.previewTime}
          sourceDuration={passiveScrubPreview.previewClip.sourceDuration}
          preferVideoPreview
        />
      ) : passiveScrubPreview.previewClip.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={passiveScrubPreview.previewClip.src}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-zinc-900/60 text-xs text-zinc-500 font-medium">
          Empty Collection
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/75 px-2 py-1 font-mono text-[10px] text-zinc-100">
        <span>clip {passiveScrubPreview.previewClip.index}</span>
        <span>{formatSeconds(passiveScrubPreview.previewTime)}</span>
      </div>
    </div>
  ) : null;

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
              {visibleClips.map((clip) => (
                <TimelineClipItem
                  key={clip.id}
                  clip={clip}
                  pixelsPerSecond={pixelsPerSecond}
                  itemTop={itemTop}
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
                  isCollectionHovered={activeCollectionHoverId === clip.id}
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
                  timelineId={timelineId}
                />
              ))}

              {/* Vertical Playhead line */}
              {playheadTime !== null && (() => {
                const pLeft = getPlayheadLeft(playheadTime);
                if (pLeft === null) return null;
                return (
                  <div
                    className="absolute z-40 top-0 bottom-0 w-[2.5px] bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)] pointer-events-none"
                    style={{
                      left: `${pLeft}px`,
                      top: `${itemTop}px`,
                      height: `${itemHeight}px`,
                    }}
                  />
                );
              })()}

              {dragBarEnabled && visibleClips.map((clip) => {
                const left = getClipLeft(clip);
                const top = getClipTop(clip);
                const width = getClipWidth(clip);
                const frameSize =
                  itemHeight === 80
                    ? itemHeight
                    : Math.max(56, Math.min(itemHeight, 96));
                const topInset = Math.max(0, (itemHeight - frameSize) / 2);
                const playBarHeight = topInset >= 30 ? 24 : 16;
                const playBarTop = top + Math.max(3, topInset - playBarHeight - 4);

                return (
                  <div
                    key={`${clip.id}-play-drag-overlay`}
                    data-testid="timeline-clip-play-drag-overlay"
                    data-clip-index={clip.index}
                    onPointerDown={handlePlayBarPointerDown}
                    onPointerMove={handleDragBarPointerMove}
                    onPointerUp={handleDragBarPointerUp}
                    onPointerCancel={handleDragBarPointerUp}
                    className="absolute z-[35] group/playbar cursor-ew-resize px-1.5 transition-opacity duration-150"
                    style={{
                      left: `${left}px`,
                      top: `${playBarTop}px`,
                      width: `${width}px`,
                      height: `${playBarHeight}px`,
                      touchAction: "none",
                    }}
                    title="Drag to scrub playhead"
                  >
                    <div className="relative flex h-full w-full items-center rounded-full border border-zinc-700/70 bg-zinc-950/72 px-2 shadow-md backdrop-blur-sm transition-colors duration-150 group-hover/playbar:border-amber-400/70 group-hover/playbar:bg-amber-950/70">
                      <div className="h-px flex-1 bg-zinc-600/70 transition-colors duration-150 group-hover/playbar:bg-amber-300/70" />
                      <div className="mx-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-zinc-600/80 bg-black/80 shadow-sm transition-colors duration-150 group-hover/playbar:border-amber-300">
                        <Play className="ml-[1px] h-2.5 w-2.5 fill-zinc-300 text-zinc-300 transition-colors duration-150 group-hover/playbar:fill-amber-300 group-hover/playbar:text-amber-300" />
                      </div>
                      <div className="h-px flex-1 bg-zinc-600/70 transition-colors duration-150 group-hover/playbar:bg-amber-300/70" />
                    </div>
                  </div>
                );
              })}

              {!interactions.isReordering &&
                selectedIndex === null &&
                showPlayBarArea &&
                visibleClips.map((clip) =>
                  clip.kind === "video" || clip.kind === "collection" || clip.kind === "image" ? (
                    <PassiveVideoFilmStrip
                      key={`${clip.id}-passive-filmstrip`}
                      clip={clip}
                      pixelsPerSecond={pixelsPerSecond}
                      thumbnailMode={thumbnailMode}
                      gridMetrics={gridMetrics}
                      thumbnailWidth={thumbnailWidth}
                      thumbnailGap={THUMBNAIL_GAP}
                      onPointerDown={handlePassiveFilmStripPointerDown}
                      showFilmstrip={showPassiveFilmstrips}
                    />
                  ) : null,
                )}

            </>
          )}
        </div>
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
      {activeDropIndex !== null && (
        <div
          className="absolute z-40 w-[4px] -ml-[2px] bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)] pointer-events-none transition-all duration-100"
          style={{
            left: `${getDropIndicatorLeft(activeDropIndex)}px`,
            height: `${itemHeight}px`,
            top: `${itemTop}px`,
          }}
        >
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-sky-400 w-3.5 h-3.5 flex items-center justify-center text-[9px] font-extrabold text-zinc-950 shadow-md">
            +
          </div>
        </div>
      )}
      {contextMenu && createPortal(
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <div
            className="fixed inset-0 z-[99998]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="fixed z-[99999] min-w-56 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/90 p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 ease-out"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
            }}
          >
            <div className="px-3.5 py-2 border-b border-zinc-800/40 text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-between gap-4">
              <span>
                {thumbnailMode ? `Position: Card #${contextMenu.insertIndex + 1}` : `Timeline: ${formatSeconds(contextMenu.timelineTime)}`}
              </span>
              <button
                type="button"
                onClick={() => setContextMenu(null)}
                className="p-0.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
                title="Close menu"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
              {[
                { type: "collection" as const, label: "Collection", icon: Folder, color: "text-sky-400" },
                { type: "video" as const, label: "Video Clip", icon: Video, color: "text-amber-400" },
                { type: "image" as const, label: "Image Clip", icon: Image, color: "text-emerald-400" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => {
                      if (onDropSidebarClip) {
                        onDropSidebarClip(contextMenu.insertIndex, item.type);
                      }
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center gap-3.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-300 hover:bg-zinc-800/70 hover:text-white transition-colors cursor-pointer"
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${item.color}`} />
                    <span>
                      Add {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
      {scrubbingState && (() => {
        const previewClip = getClipAtX(scrubbingState.currentContentX);
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
          const ratio = Math.max(0, Math.min(1, (scrubbingState.currentContentX - left) / Math.max(1, width)));
          mediaTime = previewClip.trimIn + ratio * previewClip.duration;
          displayTime = thumbnailMode
            ? previewClip.startTime + ratio * previewClip.duration
            : scrubbingState.currentContentX / pixelsPerSecond;

          previewKind = previewClip.kind;

          if (previewClip.kind === "video") {
            previewVideoSrc = previewClip.src;
            previewVideoTime = mediaTime;
            previewVideoDuration = previewClip.duration;
            previewSrc = previewClip.src;
          } else if (previewClip.kind === "collection") {
            const activePreview = getCollectionClipFramePreview(previewClip, mediaTime);
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
