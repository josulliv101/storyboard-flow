"use client";

/* eslint-disable react-hooks/refs */

import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/core/button";
import { cn } from "@/lib/utils";
import { TimelineClip, TrimScrubPreview } from "./types";
import {
  DEFAULT_PIXELS_PER_SECOND,
  MIN_WIDTH,
  MAX_WIDTH,
  TIMELINE_ITEM_TOP,
  TIMELINE_LEADING_PADDING_SECONDS,
  TIMELINE_TRAILING_PADDING_SECONDS,
  VISIBLE_OVERSCAN_PX,
  ItemSize,
  ITEM_HEIGHTS,
} from "./constants";
import { clamp } from "./utils";
import { createInitialClips, packClipsLeftToRight } from "./hooks/use-timeline-clips";
import { useTimelineInteractions } from "./hooks/use-timeline-interactions";
import { TimelineClipItem } from "./timeline-clip-item";
import { VideoSourceFilmStrip } from "./video-source-filmstrip";

const THUMBNAIL_GAP = 16;

export interface SmoothScrollListProps extends React.HTMLAttributes<HTMLDivElement> {
  itemCount?: number;
  viewportWidth?: number | string;
  width?: number | string;
  pixelsPerSecond?: number;
}

export function SmoothScrollList({
  itemCount = 1000,
  viewportWidth,
  width: _deprecatedWidth,
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
  className,
  style,
  ...props
}: SmoothScrollListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingClipsRef = useRef<TimelineClip[] | null>(null);

  const safeItemCount = Math.max(0, Math.floor(itemCount));
  const resolvedViewportWidth = viewportWidth ?? "100%";
  const [zoomLevel, setZoomLevel] = useState(pixelsPerSecond);
  const safePixelsPerSecond = Math.max(20, zoomLevel);
  const minDuration = MIN_WIDTH / safePixelsPerSecond;

  const [clips, setClips] = useState<TimelineClip[]>(() =>
    createInitialClips(safeItemCount, 100),
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [manualOverhangScroll, setManualOverhangScroll] = useState(true);
  
  const [closingOverhangOffset, setClosingOverhangOffset] = useState(0);
  const [isClosingOverhang, setIsClosingOverhang] = useState(false);

  const initialScrollLeft = TIMELINE_LEADING_PADDING_SECONDS * 100;
  const [scrollLeft, setScrollLeft] = useState(initialScrollLeft);
  const [viewportClientWidth, setViewportClientWidth] = useState(0);

  const [thumbnailMode, setThumbnailMode] = useState(false);
  const [itemSize, setItemSize] = useState<ItemSize>("md");

  const itemHeight = ITEM_HEIGHTS[itemSize];
  const thumbnailWidth = (itemHeight * 16) / 9;
  const timelineHeight = itemHeight + TIMELINE_ITEM_TOP;

  const prevScrollLeftRef = useRef(initialScrollLeft);

  const [isZooming, setIsZooming] = useState(false);
  const zoomTimeoutRef = useRef<NodeJS.Timeout>(null);
  const zoomScrollTargetRef = useRef<number | null>(null);

  const handleZoomChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newZoom = Number(e.target.value);
    if (newZoom === zoomLevel) return;

    setIsZooming(true);
    if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
    zoomTimeoutRef.current = setTimeout(() => setIsZooming(false), 150);

    const el = parentRef.current;
    if (el) {
      // The timeline 0-point is offset by the first clip's overhang.
      // We need to calculate the current overhang to find the true center time.
      const firstClip = clips.length > 0 ? clips[0] : null;
      let currentOverhang = 0;
      if (firstClip && selectedIndex === 0 && firstClip.trimIn > 0) {
        if (thumbnailMode) {
           const sourceLeft = thumbnailWidth / 2 - (firstClip.trimIn * safePixelsPerSecond + firstClip.duration * safePixelsPerSecond / 2);
           currentOverhang = Math.max(0, -sourceLeft);
        } else {
           currentOverhang = firstClip.trimIn * safePixelsPerSecond;
        }
      }

      // Find where we are currently centered in "seconds" relative to the timeline start
      const centerPxRelative = el.scrollLeft + el.clientWidth / 2 - currentOverhang;
      const centerTime = thumbnailMode ? centerPxRelative / thumbnailWidth * (firstClip?.duration || 1) : centerPxRelative / safePixelsPerSecond;

      // Calculate the new overhang with the new zoom level
      const newPixelsPerSecond = Math.max(20, newZoom);
      let newOverhang = 0;
      if (firstClip && selectedIndex === 0 && firstClip.trimIn > 0) {
        if (thumbnailMode) {
           const sourceLeft = thumbnailWidth / 2 - (firstClip.trimIn * newPixelsPerSecond + firstClip.duration * newPixelsPerSecond / 2);
           newOverhang = Math.max(0, -sourceLeft);
        } else {
           newOverhang = firstClip.trimIn * newPixelsPerSecond;
        }
      }

      // Where should we be centered with the new zoom in pixel space?
      const newCenterPx = thumbnailMode ? centerTime / (firstClip?.duration || 1) * thumbnailWidth + newOverhang : centerTime * newPixelsPerSecond + newOverhang;
      const newScrollLeft = Math.max(0, newCenterPx - el.clientWidth / 2);

      setZoomLevel(newZoom);
      setScrollLeft(newScrollLeft);
      zoomScrollTargetRef.current = newScrollLeft;
    } else {
      setZoomLevel(newZoom);
    }
  }, [zoomLevel, safePixelsPerSecond, clips, selectedIndex, thumbnailMode, thumbnailWidth]);

  useLayoutEffect(() => {
    if (zoomScrollTargetRef.current !== null) {
      if (parentRef.current) {
        parentRef.current.scrollLeft = zoomScrollTargetRef.current;
        prevScrollLeftRef.current = zoomScrollTargetRef.current;
      }
      zoomScrollTargetRef.current = null;
    }
  });

  const [scrubPreview, setScrubPreview] = useState<TrimScrubPreview | null>(
    null,
  );

  const handleClipDurationLoad = useCallback((index: number, duration: number) => {
    setClips((prevClips) => {
      const clip = prevClips.find(c => c.index === index);
      if (!clip || clip.kind !== "video") return prevClips;
      // Re-normalize duration if they're close, prevent infinite loops
      if (Math.abs(clip.sourceDuration - duration) < 0.1) return prevClips;

      const newClips = prevClips.map((c) => ({ ...c }));
      const newClip = { ...clip, sourceDuration: duration };

      // Recompute the visible duration and trimming since the actual video length changed
      const visibleWidth = clamp(Math.round(itemHeight * clip.aspect), MIN_WIDTH, MAX_WIDTH);
      const targetDuration = visibleWidth / safePixelsPerSecond;
      const hiddenDuration = Math.max(0, duration - targetDuration);
      
      newClip.duration = Math.min(duration, targetDuration);
      newClip.trimIn = hiddenDuration / 2;
      newClip.trimOut = hiddenDuration - newClip.trimIn;

      newClips[index] = newClip;

      // Ensure clips are packed correctly in case the duration changed
      return packClipsLeftToRight(newClips, index, newClip);
    });
  }, [safePixelsPerSecond, itemHeight]);

  const selectedClip = useMemo(() => {
    if (selectedIndex === null) return null;
    return clips.find((clip) => clip.index === selectedIndex) ?? null;
  }, [clips, selectedIndex]);

  const selectedVideoClip =
    selectedClip?.kind === "video" ? selectedClip : null;


  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // Only recreate if itemCount changed significantly, but for simplicity
    // we'll just ignore zoom changes here.
    const newClips = createInitialClips(safeItemCount, 100);
    setClips(newClips); // We use 100 as base layout zoom
    setSelectedIndex(null);
    setScrubPreview(null);
    const nextInitialScrollLeft =
      TIMELINE_LEADING_PADDING_SECONDS * 100;
    setScrollLeft(nextInitialScrollLeft);

    if (parentRef.current) {
      parentRef.current.scrollLeft = nextInitialScrollLeft;
    }
  }, [safeItemCount]);

  const syncScrollState = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;

    setScrollLeft(el.scrollLeft);
    prevScrollLeftRef.current = el.scrollLeft;
    setViewportClientWidth(el.clientWidth);
  }, [setScrollLeft]);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncScrollState();
    });
  }, [syncScrollState]);

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    if (el.scrollLeft === 0 && initialScrollLeft > 0) {
      el.scrollLeft = initialScrollLeft;
    }

    syncScrollState();

    const observer = new ResizeObserver(() => {
      syncScrollState();
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [initialScrollLeft, syncScrollState]);

  const scheduleClips = useCallback((nextClips: TimelineClip[]) => {
    pendingClipsRef.current = nextClips;

    if (resizeFrameRef.current !== null) return;

    resizeFrameRef.current = requestAnimationFrame(() => {
      const pendingClips = pendingClipsRef.current;
      pendingClipsRef.current = null;
      resizeFrameRef.current = null;

      if (!pendingClips) return;
      setClips(pendingClips);
    });
  }, []);

  const applyClipsNow = useCallback((nextClips: TimelineClip[]) => {
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }

    pendingClipsRef.current = null;
    setClips(nextClips);
  }, []);

  const pendingScrollLeftRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingScrollLeftRef.current !== null && parentRef.current) {
      parentRef.current.scrollLeft = pendingScrollLeftRef.current;
      pendingScrollLeftRef.current = null;
    }
  }, [clips]);

  const interactions = useTimelineInteractions({
    parentRef,
    clips,
    safePixelsPerSecond,
    minDuration,
    thumbnailMode,
    thumbnailWidth,
    setScrollLeft,
    setSelectedIndex,
    setScrubPreview,
    scheduleClips,
    applyClipsNow,
    pendingScrollLeftRef,
  });

  // When the first item is a selected video whose filmstrip overhangs to the
  // left (because the source front was trimmed), add empty space at the start
  // of the timeline equal to that overhang so the filmstrip is fully visible.
  const overhangsRef = useRef({ first: 0, last: 0 });

  const freezeFirstOverhang =
    interactions.isFilmStripEditing &&
    (thumbnailMode ||
      interactions.activeFilmStripEdit?.mode === "move" ||
      interactions.activeFilmStripEdit?.mode === "center");

  const firstClipFilmstripOverhangPx = useMemo(() => {
    let val = 0;
    if (
      selectedVideoClip &&
      selectedVideoClip.index === 0 &&
      selectedVideoClip.trimIn > 0
    ) {
      if (thumbnailMode) {
        const clipCenter = thumbnailWidth / 2;
        const sourceLeft = clipCenter - (selectedVideoClip.trimIn * safePixelsPerSecond + selectedVideoClip.duration * safePixelsPerSecond / 2);
        val = Math.max(0, -sourceLeft);
      } else {
        val = selectedVideoClip.trimIn * safePixelsPerSecond;
      }
    }
    
    if (freezeFirstOverhang) {
      return overhangsRef.current.first;
    } else {
      overhangsRef.current.first = val;
      return val;
    }
  }, [selectedVideoClip, safePixelsPerSecond, freezeFirstOverhang, thumbnailMode, thumbnailWidth]);

  const freezeLastOverhang =
    interactions.isFilmStripEditing &&
    (thumbnailMode ||
      interactions.activeFilmStripEdit?.mode === "move" ||
      interactions.activeFilmStripEdit?.mode === "center");

  const lastClipFilmstripOverhangPx = useMemo(() => {
    let val = 0;
    if (
      selectedVideoClip &&
      selectedVideoClip.index === clips.length - 1
    ) {
      const trimOut = selectedVideoClip.sourceDuration - selectedVideoClip.trimIn - selectedVideoClip.duration;
      if (trimOut > 0) {
        if (thumbnailMode) {
          const clipCenter = thumbnailWidth / 2;
          const selectedWidth = selectedVideoClip.duration * safePixelsPerSecond;
          const sourceWidth = selectedVideoClip.sourceDuration * safePixelsPerSecond;
          const trimInWidth = selectedVideoClip.trimIn * safePixelsPerSecond;
          const sourceLeft = clipCenter - (trimInWidth + selectedWidth / 2);
          const sourceRight = sourceLeft + sourceWidth;
          val = Math.max(0, sourceRight - thumbnailWidth);
        } else {
          val = trimOut * safePixelsPerSecond;
        }
      }
    }
    
    if (freezeLastOverhang) {
      return overhangsRef.current.last;
    } else {
      overhangsRef.current.last = val;
      return val;
    }
  }, [selectedVideoClip, clips.length, safePixelsPerSecond, freezeLastOverhang, thumbnailMode, thumbnailWidth]);

  const prevOverhangRef = useRef(0);

  // Whether there is filmstrip overhang off-screen to the left.
  const hasOffscreenOverhang =
    manualOverhangScroll &&
    firstClipFilmstripOverhangPx > 0 &&
    scrollLeft > 0;

  const scrollToOverhang = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    el.scrollTo({ left: 0, behavior: "smooth" });
  }, []);

  // In manual mode, compensate scroll position so the viewport stays put
  // when the overhang changes (e.g. selecting/deselecting the first clip).
  // Skip during active left-edge resize of clip 0 — the content transform
  // (firstClipFilmstripOverhangPx) already keeps visuals stable; applying
  // additional scroll here would double-compensate, making the right edge
  // appear to shrink instead of the left handle moving.
  const isResizingClip0Left =
    (interactions.isResizing &&
      interactions.activeResize?.index === 0 &&
      interactions.activeResize?.edge === "left") ||
    (interactions.isFilmStripEditing &&
      interactions.activeFilmStripEdit?.index === 0 &&
      interactions.activeFilmStripEdit?.mode === "left");

  useLayoutEffect(() => {
    const oldOverhang = prevOverhangRef.current;
    const delta = firstClipFilmstripOverhangPx - oldOverhang;
    prevOverhangRef.current = firstClipFilmstripOverhangPx;

    if (!manualOverhangScroll || delta === 0 || isResizingClip0Left) return;

    const el = parentRef.current;
    if (!el) return;

    const oldScrollLeft = el.scrollLeft;
    const newScrollLeft = Math.max(0, oldScrollLeft + delta);

    if (delta < 0) {
      // The amount of scroll we COULD NOT compensate
      const targetScrollLeft = oldScrollLeft + delta;
      const uncompensated = newScrollLeft - targetScrollLeft;
      
      if (uncompensated > 0) {
        // e.g. delta was -50. target was -50. new is 0. uncompensated is 50.
        // We set offset to 50 to visually offset the shrink, then animate it away.
        setClosingOverhangOffset(uncompensated);
        setIsClosingOverhang(true);
        
        requestAnimationFrame(() => {
          setClosingOverhangOffset(0);
          setIsClosingOverhang(false);
        });
      }
    }

    el.scrollLeft = newScrollLeft;
    setScrollLeft(newScrollLeft);
  }, [firstClipFilmstripOverhangPx, manualOverhangScroll, setScrollLeft, isResizingClip0Left]);

  const prevLastOverhangRef = useRef(0);

  useLayoutEffect(() => {
    const oldLastOverhang = prevLastOverhangRef.current;
    const delta = lastClipFilmstripOverhangPx - oldLastOverhang;
    prevLastOverhangRef.current = lastClipFilmstripOverhangPx;

    if (delta >= 0 || freezeLastOverhang || interactions.isFilmStripEditing || interactions.isUnfreezing) return;

    const el = parentRef.current;
    if (!el) return;

    // When the container shrinks, the browser might synchronously clamp scrollLeft.
    // If it did, items will visually jump to the right. We want to animate that.
    const clampedDiff = prevScrollLeftRef.current - el.scrollLeft;
    if (clampedDiff > 0) {
      setClosingOverhangOffset((prev) => prev - clampedDiff);
      setIsClosingOverhang(true);
      
      requestAnimationFrame(() => {
        setClosingOverhangOffset(0);
        setIsClosingOverhang(false);
      });
      
      setScrollLeft(el.scrollLeft);
      prevScrollLeftRef.current = el.scrollLeft;
    }
  }, [lastClipFilmstripOverhangPx, freezeLastOverhang, setScrollLeft, interactions.isFilmStripEditing, interactions.isUnfreezing]);

  const baseTotalDuration = useMemo(() => {
    if (clips.length === 0) return 0;

    let maxDuration = clips.reduce(
      (max, clip) => Math.max(max, clip.startTime + clip.duration),
      0,
    );

    return maxDuration + TIMELINE_TRAILING_PADDING_SECONDS;
  }, [clips]);

  const maxDurationDuringDragRef = useRef<number | null>(null);

  let totalDuration = baseTotalDuration;
  if (interactions.isResizing) {
    if (maxDurationDuringDragRef.current === null) {
       
      maxDurationDuringDragRef.current = baseTotalDuration;
    }
     
    totalDuration = Math.max(baseTotalDuration, maxDurationDuringDragRef.current!);
  } else {
     
    maxDurationDuringDragRef.current = null;
  }

  const visibleClips = useMemo(() => {
    const offset = firstClipFilmstripOverhangPx + closingOverhangOffset;
    const visibleStartPx = scrollLeft - offset - VISIBLE_OVERSCAN_PX;
    const visibleEndPx = scrollLeft - offset + viewportClientWidth + VISIBLE_OVERSCAN_PX;

    const visibleStartTime = Math.max(0, visibleStartPx / safePixelsPerSecond);
    const visibleEndTime = visibleEndPx / safePixelsPerSecond;

    return clips.filter((clip) => {
      if (thumbnailMode) {
        const clipStartPx = clip.index * (thumbnailWidth + THUMBNAIL_GAP);
        const clipEndPx = clipStartPx + thumbnailWidth;
        return clipEndPx >= visibleStartPx && clipStartPx <= visibleEndPx;
      }
      
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      return clipEnd >= visibleStartTime && clipStart <= visibleEndTime;
    });
  }, [clips, safePixelsPerSecond, scrollLeft, viewportClientWidth, thumbnailMode, firstClipFilmstripOverhangPx, closingOverhangOffset, thumbnailWidth]);

  const timelineWidth = Math.max(
    viewportClientWidth || 1,
    (thumbnailMode ? clips.length * thumbnailWidth + Math.max(0, clips.length - 1) * THUMBNAIL_GAP : Math.ceil(totalDuration * safePixelsPerSecond)) + firstClipFilmstripOverhangPx + lastClipFilmstripOverhangPx,
  );

  const scrollToClipIndex = useCallback(
    (targetIndex: number) => {
      const el = parentRef.current;
      if (!el || clips.length === 0) return;

      interactions.stopInertia();

      const index = clamp(Math.floor(targetIndex), 0, clips.length - 1);
      const clip = clips[index];
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const nextScrollLeft = clamp(
        thumbnailMode ? clip.index * (thumbnailWidth + THUMBNAIL_GAP) : clip.startTime * safePixelsPerSecond,
        0,
        maxScroll,
      );

      el.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
    },
    [clips, safePixelsPerSecond, interactions, thumbnailMode, thumbnailWidth],
  );

  useEffect(() => {
    const currentInteractions = interactions;
    return () => {
      currentInteractions.stopInertia();
      currentInteractions.cleanupWindowDragListeners();

      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }

      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="thumbnail-mode" className="text-[10px] uppercase font-semibold text-zinc-400">Thumbnail Mode</label>
            <button
              id="thumbnail-mode"
              type="button"
              role="switch"
              aria-checked={thumbnailMode}
              onClick={() => setThumbnailMode((v) => !v)}
              className={cn(
                "relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200",
                thumbnailMode
                  ? "border-amber-400 bg-amber-400/30"
                  : "border-zinc-600 bg-zinc-800",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none block h-3 w-3 rounded-full shadow-sm transition-transform duration-200",
                  thumbnailMode
                    ? "translate-x-[18px] bg-amber-400"
                    : "translate-x-[2px] bg-zinc-400",
                )}
              />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="size-select" className="text-[10px] uppercase font-semibold text-zinc-400">Size</label>
            <select
              id="size-select"
              value={itemSize}
              onChange={(e) => setItemSize(e.target.value as ItemSize)}
              className="h-6 rounded border border-zinc-700 bg-zinc-800 px-2 text-xs font-medium text-zinc-200 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            >
              <option value="sm">SM</option>
              <option value="md">MD</option>
              <option value="lg">LG</option>
              <option value="xl">XL</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="zoom-slider" className="text-[10px] uppercase font-semibold text-zinc-400">Zoom</label>
            <input
              id="zoom-slider"
              type="range"
              min="20"
              max="300"
              step="1"
              value={zoomLevel}
              onChange={handleZoomChange}
              className="w-24 accent-amber-400"
            />
          </div>
          <button
            id="pin-scroll-toggle"
            type="button"
            role="switch"
            aria-checked={manualOverhangScroll}
            title={manualOverhangScroll
              ? "Pin scroll is ON — selecting the first video clip keeps the viewport in place. Scroll left manually to reveal the filmstrip overhang."
              : "Pin scroll is OFF — selecting the first video clip auto-scrolls to reveal the filmstrip overhang."
            }
            onClick={() => setManualOverhangScroll((v) => !v)}
            className={cn(
              "relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200",
              manualOverhangScroll
                ? "border-amber-400 bg-amber-400/30"
                : "border-zinc-600 bg-zinc-800",
            )}
          >
            <span
              className={cn(
                "pointer-events-none block h-3 w-3 rounded-full shadow-sm transition-transform duration-200",
                manualOverhangScroll
                  ? "translate-x-[18px] bg-amber-400"
                  : "translate-x-[2px] bg-zinc-400",
              )}
            />
          </button>
          <label
            htmlFor="pin-scroll-toggle"
            className="text-[10px] uppercase font-semibold text-zinc-400 cursor-pointer select-none"
            title={manualOverhangScroll
              ? "Pin scroll is ON — selecting the first video clip keeps the viewport in place."
              : "Pin scroll is OFF — selecting the first video clip auto-scrolls to reveal the filmstrip overhang."
            }
          >
            Pin scroll
          </label>
          <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
            {visibleClips.length}/{clips.length} rendered
          </span>
        </div>
      </div>

      <p className="-mt-1 w-full min-w-0 text-[11px] leading-relaxed text-zinc-500">
        Drag the timeline or any clip body to scroll. Click a clip to select
        it. For a selected video, use the filmstrip above the item to move or
        resize the source window; drag the item handles to trim the timeline
        edges.
      </p>

      <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="min-w-0">
          <Button
            variant="outline"
            size="sm"
            id="scroll-to-100"
            className="w-full min-w-0"
            disabled={clips.length === 0}
            onClick={() => scrollToClipIndex(100)}
          >
            To 100
          </Button>
        </div>
        <div className="min-w-0">
          <Button
            variant="outline"
            size="sm"
            id="scroll-to-800"
            className="w-full min-w-0"
            disabled={clips.length === 0}
            onClick={() => scrollToClipIndex(800)}
          >
            To 800
          </Button>
        </div>
        <div className="min-w-0">
          <Button
            variant="outline"
            size="sm"
            id="scroll-to-0"
            className="w-full min-w-0"
            disabled={clips.length === 0}
            onClick={() => scrollToClipIndex(0)}
          >
            Start
          </Button>
        </div>
      </div>

      <div className="relative w-full max-w-full min-w-0">
        <div
          ref={parentRef}
          onScroll={handleScroll}
          onPointerDown={interactions.handlePointerDown}
          onPointerCancel={interactions.handlePointerCancel}
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
              height: `${timelineHeight}px`,
              boxSizing: "border-box",

              transform: `translateX(${interactions.trackTranslateX}px)`,
              transition:
                interactions.isResizing || interactions.isSnappingBack || interactions.isFilmStripEditing || interactions.isUnfreezing || isClosingOverhang || isZooming
                  ? "none"
                  : "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), width 0.35s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {clips.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                No items
              </div>
            ) : (
              <div
                className="relative"
                style={{
                  width: "100%",
                  height: "100%",
                  transform: `translateX(${firstClipFilmstripOverhangPx + closingOverhangOffset}px)`,
                  transition:
                    interactions.isResizing || interactions.isFilmStripEditing || interactions.isUnfreezing || isResizingClip0Left || isClosingOverhang || isZooming
                    // Pin scroll ON + overhang growing (selecting): appear instantly
                     
                    || (manualOverhangScroll && firstClipFilmstripOverhangPx > prevOverhangRef.current)
                    // Pin scroll ON + overhang shrinking but off-screen (user never scrolled to see it): snap closed
                    // 1px tolerance handles browser scrollLeft rounding
                     
                    || (manualOverhangScroll && firstClipFilmstripOverhangPx < prevOverhangRef.current && scrollLeft >= prevOverhangRef.current - 1)
                      ? "none"
                      : "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                {visibleClips.map((clip) => (
                  <TimelineClipItem
                    key={clip.id}
                    clip={clip}
                    pixelsPerSecond={safePixelsPerSecond}
                    itemTop={TIMELINE_ITEM_TOP}
                    itemHeight={itemHeight}
                    thumbnailMode={thumbnailMode}
                    thumbnailWidth={thumbnailWidth}
                    thumbnailGap={THUMBNAIL_GAP}
                    isSelected={selectedIndex === clip.index}
                    isGrowingOpposite={interactions.activeResize?.index === 0 && interactions.activeResize?.edge === "left" && clip.index === 0}
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
                    pixelsPerSecond={safePixelsPerSecond}
                    thumbnailMode={thumbnailMode}
                    thumbnailWidth={thumbnailWidth}
                    thumbnailGap={THUMBNAIL_GAP}
                    editingMode={
                      (interactions.isFilmStripEditing && interactions.activeFilmStripEdit?.index === selectedVideoClip.index)
                        ? interactions.activeFilmStripEdit.mode
                        : (interactions.isResizing && interactions.activeResize?.index === selectedVideoClip.index)
                          ? interactions.activeResize.edge
                          : null
                    }
                    onSourceWindowPointerDown={interactions.handleFilmStripPointerDown}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Helper arrow indicating filmstrip content off-screen to the left */}
        {hasOffscreenOverhang && (
          <button
            type="button"
            onClick={scrollToOverhang}
            title="Filmstrip extends beyond the visible area. Click to scroll and reveal the full source filmstrip."
            className="absolute left-1.5 top-1/2 z-50 flex -translate-y-1/2 items-center gap-1 rounded-full border border-amber-400/40 bg-zinc-900/90 px-2 py-1 text-amber-400 shadow-lg shadow-black/40 backdrop-blur-sm transition-all hover:border-amber-400/70 hover:bg-zinc-800/90 hover:shadow-amber-400/10 active:scale-95"
          >
            <svg
              className="h-3.5 w-3.5 animate-pulse"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="text-[9px] font-semibold uppercase tracking-wide">Source</span>
          </button>
        )}
      </div>
    </div>
  );
}
