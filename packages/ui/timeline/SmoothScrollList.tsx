"use client";

import type React from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../core/button";
import { cn } from "../lib/utils";

export interface SmoothScrollListProps extends React.HTMLAttributes<HTMLDivElement> {
  itemCount?: number;
  /** Optional explicit width for the scrollable viewport. Defaults to full width. */
  viewportWidth?: number | string;
  /** Deprecated: the component is full-width by default. Use `viewportWidth` only when you want to constrain it. */
  width?: number | string;
  /** Timeline zoom level. Larger values make clips visually wider. */
  pixelsPerSecond?: number;
}

type MediaKind = "image" | "video";

type TimelineClip = {
  id: string;
  index: number;
  kind: MediaKind;
  src: string;
  alt: string;
  poster?: string;
  aspect: number;
  trackIndex: number;

  /** Absolute timeline position. */
  startTime: number;
  /** Visible duration after trimming. */
  duration: number;
  /** Total source duration available for this clip. */
  sourceDuration: number;
  /** Amount trimmed from the source beginning. */
  trimIn: number;
  /** Amount trimmed from the source end. */
  trimOut: number;
};

type TrimScrubPreview = {
  clipIndex: number;
  time: number;
};

type VideoSourceWindowEditMode = "move" | "center" | "left" | "right";

type MediaSpec =
  | { kind: "image"; aspect: number }
  | { kind: "video"; aspect: number; src: string };

const VIDEO_SOURCES = [
  "https://www.w3schools.com/html/mov_bbb.mp4",
  "https://www.w3schools.com/html/movie.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
];

const MEDIA: MediaSpec[] = [
  { kind: "image", aspect: 16 / 9 },
  { kind: "video", aspect: 16 / 9, src: VIDEO_SOURCES[0] },
  { kind: "image", aspect: 2 / 3 },
  { kind: "image", aspect: 1 },
  { kind: "video", aspect: 3 / 2, src: VIDEO_SOURCES[1] },
  { kind: "image", aspect: 16 / 9 },
  { kind: "image", aspect: 2 / 3 },
  { kind: "video", aspect: 1, src: VIDEO_SOURCES[2] },
  { kind: "image", aspect: 3 / 2 },
];

const ITEM_HEIGHT = 200;
const MIN_WIDTH = 60;
const MAX_WIDTH = 600;
const DEFAULT_PIXELS_PER_SECOND = 100;
const CLIP_GAP_SECONDS = 0.12;
const DRAG_THRESHOLD_PX = 3;
const RESIZE_KEY_STEP_PX = 10;
const VISIBLE_OVERSCAN_PX = 700;
const FILMSTRIP_HEIGHT = 38;
const FILMSTRIP_GAP = 6;
const TIMELINE_ITEM_TOP = FILMSTRIP_HEIGHT + FILMSTRIP_GAP;
const TIMELINE_HEIGHT = ITEM_HEIGHT + TIMELINE_ITEM_TOP;
const FILMSTRIP_TARGET_FRAME_WIDTH = 54;
const FILMSTRIP_MAX_FRAMES = 14;

// Gives the first clips room to grow left before hitting time 0.
// Without this, a packed sequence cannot expand a middle clip to the left
// without overlapping earlier clips.
const TIMELINE_LEADING_PADDING_SECONDS = 5;
const TIMELINE_TRAILING_PADDING_SECONDS = 5;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSourceTimeFromClientX({
  clientX,
  rectLeft,
  rectWidth,
  sourceDuration,
}: {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  sourceDuration: number;
}) {
  if (rectWidth <= 0 || sourceDuration <= 0) return 0;

  const localX = clamp(clientX - rectLeft, 0, rectWidth);
  return (localX / rectWidth) * sourceDuration;
}

function formatSeconds(value: number) {
  if (value < 0.01) return "0s";
  if (value < 10) return `${value.toFixed(2)}s`;
  return `${value.toFixed(1)}s`;
}

function getTrimHandleSourceTime(clip: TimelineClip, edge: "left" | "right") {
  // Treat the trim handles like scrubbers in source-time space:
  // left handle previews the visible in-point, right handle previews the
  // visible out-point. We only subtract a tiny epsilon at the absolute source
  // end so browsers do not clamp to a blank/unstable terminal frame.
  const frameEpsilon = Math.min(1 / 60, clip.sourceDuration / 200);
  const sourceOutTime = clip.trimIn + clip.duration;
  const rawTime = edge === "left" ? clip.trimIn : sourceOutTime;

  return clamp(rawTime, 0, Math.max(0, clip.sourceDuration - frameEpsilon));
}

function getFallbackImage(
  index: number,
  imageWidth: number,
): { src: string; alt: string } {
  return {
    src: `https://picsum.photos/seed/smooth-scroll-${index}/${imageWidth}/${ITEM_HEIGHT}`,
    alt: `Image ${index}`,
  };
}

function getSpec(index: number) {
  return MEDIA[index % MEDIA.length];
}

function baseWidth(index: number) {
  return Math.round(ITEM_HEIGHT * getSpec(index).aspect);
}

function createClip(
  index: number,
  startTime: number,
  pixelsPerSecond: number,
): TimelineClip {
  const spec = getSpec(index);
  const visibleWidth = clamp(baseWidth(index), MIN_WIDTH, MAX_WIDTH);
  const sourceWidth = MAX_WIDTH;
  const sourceDuration = sourceWidth / pixelsPerSecond;
  const duration = visibleWidth / pixelsPerSecond;

  // Demo clips have hidden source material on both sides so either handle can
  // shrink and then expand again. Real media should use real source duration,
  // trimIn, and trimOut values instead.
  const hiddenDuration = Math.max(0, sourceDuration - duration);
  const trimIn = hiddenDuration / 2;
  const trimOut = hiddenDuration - trimIn;

  if (spec.kind === "video") {
    return {
      id: `clip-${index}`,
      index,
      kind: "video",
      src: spec.src,
      alt: `Video ${index}`,
      aspect: spec.aspect,
      trackIndex: 0,
      startTime,
      duration,
      sourceDuration,
      trimIn,
      trimOut,
    };
  }

  const image = getFallbackImage(index, sourceWidth);

  return {
    id: `clip-${index}`,
    index,
    kind: "image",
    src: image.src,
    alt: image.alt,
    aspect: spec.aspect,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration,
    trimIn,
    trimOut,
  };
}

function createInitialClips(itemCount: number, pixelsPerSecond: number) {
  const clips: TimelineClip[] = [];
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;

  for (let index = 0; index < itemCount; index += 1) {
    const clip = createClip(index, nextStartTime, pixelsPerSecond);
    clips.push(clip);
    nextStartTime += clip.duration + CLIP_GAP_SECONDS;
  }

  return clips;
}

function getPackedDurationBefore(clips: TimelineClip[], anchorIndex: number) {
  let durationBefore = 0;

  for (let index = 0; index < anchorIndex; index += 1) {
    durationBefore += clips[index].duration;
    durationBefore += CLIP_GAP_SECONDS;
  }

  return durationBefore;
}

function layoutClipsAroundAnchor(
  clips: TimelineClip[],
  anchorIndex: number,
  anchorClip: TimelineClip,
) {
  const nextClips = clips.map((clip) => ({ ...clip }));
  nextClips[anchorIndex] = anchorClip;

  // Pack clips before the anchor backwards. This is the key difference from
  // the awkward version: when the left handle moves, the selected clip's left
  // edge actually moves, while earlier clips respond by sliding with it.
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const clipToRight = nextClips[index + 1];
    const endTime = clipToRight.startTime - CLIP_GAP_SECONDS;
    nextClips[index] = {
      ...nextClips[index],
      startTime: endTime - nextClips[index].duration,
    };
  }

  // Pack clips after the anchor forwards. Right trimming moves downstream clips;
  // left trimming keeps the right edge fixed, so downstream clips usually stay put.
  for (let index = anchorIndex + 1; index < nextClips.length; index += 1) {
    const clipToLeft = nextClips[index - 1];
    nextClips[index] = {
      ...nextClips[index],
      startTime: clipToLeft.startTime + clipToLeft.duration + CLIP_GAP_SECONDS,
    };
  }

  return nextClips;
}

function resizeClipsFromBaseline({
  baselineClips,
  anchorIndex,
  edge,
  deltaTime,
  minDuration,
}: {
  baselineClips: TimelineClip[];
  anchorIndex: number;
  edge: "left" | "right";
  deltaTime: number;
  minDuration: number;
}) {
  const clip = baselineClips[anchorIndex];
  if (!clip) return baselineClips;

  if (edge === "left") {
    const fixedRightTime = clip.startTime + clip.duration;
    const maxDurationFromSource = clip.sourceDuration - clip.trimOut;
    const earliestStartFromSource = fixedRightTime - maxDurationFromSource;
    const earliestStartFromLayout = getPackedDurationBefore(
      baselineClips,
      anchorIndex,
    );
    const latestStart = fixedRightTime - minDuration;

    const nextStartTime = clamp(
      clip.startTime + deltaTime,
      Math.max(earliestStartFromSource, earliestStartFromLayout),
      latestStart,
    );
    const nextDuration = fixedRightTime - nextStartTime;
    const nextTrimIn = clamp(
      clip.sourceDuration - clip.trimOut - nextDuration,
      0,
      clip.sourceDuration - clip.trimOut - minDuration,
    );

    const resizedClip: TimelineClip = {
      ...clip,
      startTime: nextStartTime,
      duration: nextDuration,
      trimIn: nextTrimIn,
    };

    return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip);
  }

  const maxDurationFromSource = clip.sourceDuration - clip.trimIn;
  const nextDuration = clamp(
    clip.duration + deltaTime,
    minDuration,
    maxDurationFromSource,
  );
  const nextTrimOut = clamp(
    clip.sourceDuration - clip.trimIn - nextDuration,
    0,
    clip.sourceDuration - clip.trimIn - minDuration,
  );

  const resizedClip: TimelineClip = {
    ...clip,
    duration: nextDuration,
    trimOut: nextTrimOut,
  };

  return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip);
}

function editVideoSourceWindowFromBaseline({
  baselineClips,
  anchorIndex,
  mode,
  deltaTime = 0,
  sourceTime = 0,
  minDuration,
}: {
  baselineClips: TimelineClip[];
  anchorIndex: number;
  mode: VideoSourceWindowEditMode;
  deltaTime?: number;
  sourceTime?: number;
  minDuration: number;
}) {
  const clip = baselineClips[anchorIndex];
  if (!clip || clip.kind !== "video") return baselineClips;

  if (mode === "move" || mode === "center") {
    const maxTrimIn = Math.max(0, clip.sourceDuration - clip.duration);
    const nextTrimIn =
      mode === "center"
        ? clamp(sourceTime - clip.duration / 2, 0, maxTrimIn)
        : clamp(clip.trimIn + deltaTime, 0, maxTrimIn);
    const nextTrimOut = Math.max(
      0,
      clip.sourceDuration - nextTrimIn - clip.duration,
    );

    const nextClips = baselineClips.map((currentClip) => ({ ...currentClip }));
    nextClips[anchorIndex] = {
      ...clip,
      trimIn: nextTrimIn,
      trimOut: nextTrimOut,
    };

    return nextClips;
  }

  if (mode === "left") {
    const fixedTimelineRightTime = clip.startTime + clip.duration;
    const fixedSourceOutTime = clip.sourceDuration - clip.trimOut;
    const desiredTrimIn = clamp(
      sourceTime,
      0,
      Math.max(0, fixedSourceOutTime - minDuration),
    );
    const desiredDuration = fixedSourceOutTime - desiredTrimIn;
    const desiredStartTime = fixedTimelineRightTime - desiredDuration;
    const earliestStartFromSource = fixedTimelineRightTime - fixedSourceOutTime;
    const earliestStartFromLayout = getPackedDurationBefore(
      baselineClips,
      anchorIndex,
    );
    const nextStartTime = clamp(
      desiredStartTime,
      Math.max(earliestStartFromSource, earliestStartFromLayout),
      fixedTimelineRightTime - minDuration,
    );
    const nextDuration = fixedTimelineRightTime - nextStartTime;
    const nextTrimIn = clamp(
      fixedSourceOutTime - nextDuration,
      0,
      Math.max(0, fixedSourceOutTime - minDuration),
    );

    const resizedClip: TimelineClip = {
      ...clip,
      startTime: nextStartTime,
      duration: nextDuration,
      trimIn: nextTrimIn,
    };

    return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip);
  }

  const fixedSourceInTime = clip.trimIn;
  const desiredSourceOutTime = clamp(
    sourceTime,
    fixedSourceInTime + minDuration,
    clip.sourceDuration,
  );
  const nextDuration = desiredSourceOutTime - fixedSourceInTime;
  const nextTrimOut = Math.max(0, clip.sourceDuration - desiredSourceOutTime);

  const resizedClip: TimelineClip = {
    ...clip,
    duration: nextDuration,
    trimOut: nextTrimOut,
  };

  return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip);
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
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const inertiaFrameRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingClipsRef = useRef<TimelineClip[] | null>(null);
  const windowDragCleanupRef = useRef<(() => void) | null>(null);

  const safeItemCount = Math.max(0, Math.floor(itemCount));
  const resolvedViewportWidth = viewportWidth ?? "100%";
  const safePixelsPerSecond = Math.max(20, pixelsPerSecond);
  const minDuration = MIN_WIDTH / safePixelsPerSecond;

  const [clips, setClips] = useState<TimelineClip[]>(() =>
    createInitialClips(safeItemCount, safePixelsPerSecond),
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const initialScrollLeft =
    TIMELINE_LEADING_PADDING_SECONDS * safePixelsPerSecond;

  const [scrollLeft, setScrollLeft] = useState(initialScrollLeft);
  const [viewportClientWidth, setViewportClientWidth] = useState(0);
  const [scrubPreview, setScrubPreview] = useState<TrimScrubPreview | null>(
    null,
  );

  const selectedClip = useMemo(() => {
    if (selectedIndex === null) return null;
    return clips.find((clip) => clip.index === selectedIndex) ?? null;
  }, [clips, selectedIndex]);

  const selectedVideoClip =
    selectedClip?.kind === "video" ? selectedClip : null;

  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startScrollLeft: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    moved: false,
    pointerId: -1,
    pressedIndex: null as number | null,
  });

  const resizeState = useRef({
    active: false,
    anchorIndex: -1,
    edge: "right" as "left" | "right",
    startX: 0,
    baselineClips: null as TimelineClip[] | null,
  });

  const filmStripEditState = useRef({
    active: false,
    anchorIndex: -1,
    mode: "move" as VideoSourceWindowEditMode,
    startX: 0,
    lastX: 0,
    startSourceTime: 0,
    lastSourceTime: 0,
    rectLeft: 0,
    rectWidth: 1,
    pointerId: -1,
    moved: false,
    baselineClips: null as TimelineClip[] | null,
  });

  useEffect(() => {
    setClips(createInitialClips(safeItemCount, safePixelsPerSecond));
    setSelectedIndex(null);
    setScrubPreview(null);
    const nextInitialScrollLeft =
      TIMELINE_LEADING_PADDING_SECONDS * safePixelsPerSecond;
    setScrollLeft(nextInitialScrollLeft);

    if (parentRef.current) {
      parentRef.current.scrollLeft = nextInitialScrollLeft;
    }
  }, [safeItemCount, safePixelsPerSecond]);

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

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const syncScrollState = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;

    setScrollLeft(el.scrollLeft);
    setViewportClientWidth(el.clientWidth);
  }, []);

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

  const runInertia = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;

    const friction = 0.95;
    const minVelocity = 0.1;

    const step = () => {
      const state = dragState.current;
      state.velocity *= friction;

      if (Math.abs(state.velocity) < minVelocity) {
        inertiaFrameRef.current = null;
        return;
      }

      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const next = clamp(el.scrollLeft + state.velocity, 0, maxScroll);
      el.scrollLeft = next;
      setScrollLeft(next);

      if (next === 0 || next === maxScroll) {
        state.velocity = 0;
        inertiaFrameRef.current = null;
        return;
      }

      inertiaFrameRef.current = requestAnimationFrame(step);
    };

    inertiaFrameRef.current = requestAnimationFrame(step);
  }, []);

  const scrollToClipIndex = useCallback(
    (targetIndex: number) => {
      const el = parentRef.current;
      if (!el || clips.length === 0) return;

      stopInertia();

      const index = clamp(Math.floor(targetIndex), 0, clips.length - 1);
      const clip = clips[index];
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const nextScrollLeft = clamp(
        clip.startTime * safePixelsPerSecond,
        0,
        maxScroll,
      );

      el.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
    },
    [clips, safePixelsPerSecond, stopInertia],
  );

  const cleanupWindowDragListeners = useCallback(() => {
    windowDragCleanupRef.current?.();
    windowDragCleanupRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const el = parentRef.current;
      if (!el) return;

      const target = e.target as HTMLElement;
      if (target.closest("[data-trim-handle]")) return;

      stopInertia();
      cleanupWindowDragListeners();

      const item = target.closest("[data-clip-index]") as HTMLElement | null;
      const rawIndex = item?.dataset.clipIndex;
      const pressedIndex = rawIndex === undefined ? null : Number(rawIndex);
      const normalizedPressedIndex = Number.isFinite(pressedIndex)
        ? pressedIndex
        : null;

      const state = dragState.current;
      state.isDragging = true;
      state.moved = false;
      state.startX = e.clientX;
      state.startScrollLeft = el.scrollLeft;
      state.lastX = e.clientX;
      state.lastTime = e.timeStamp;
      state.velocity = 0;
      state.pointerId = e.pointerId;
      state.pressedIndex = normalizedPressedIndex;

      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers can reject capture in edge cases; the window listeners
        // below still keep drag scrolling alive.
      }

      const moveTimeline = (clientX: number, timeStamp: number) => {
        const currentState = dragState.current;
        const currentEl = parentRef.current;
        if (!currentState.isDragging || !currentEl) return;

        const dx = clientX - currentState.startX;

        if (!currentState.moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;

        currentState.moved = true;

        const maxScroll = Math.max(
          0,
          currentEl.scrollWidth - currentEl.clientWidth,
        );
        const nextScrollLeft = clamp(
          currentState.startScrollLeft - dx,
          0,
          maxScroll,
        );
        currentEl.scrollLeft = nextScrollLeft;
        setScrollLeft(nextScrollLeft);

        const dt = timeStamp - currentState.lastTime;
        if (dt > 0) {
          const instantaneous = (-(clientX - currentState.lastX) / dt) * 16.67;
          currentState.velocity =
            0.7 * instantaneous + 0.3 * currentState.velocity;
        }

        currentState.lastX = clientX;
        currentState.lastTime = timeStamp;
      };

      const finishTimelineDrag = (pointerId: number) => {
        const currentState = dragState.current;
        const currentEl = parentRef.current;
        if (!currentState.isDragging || !currentEl) return;

        currentState.isDragging = false;

        try {
          if (currentEl.hasPointerCapture(pointerId)) {
            currentEl.releasePointerCapture(pointerId);
          }
        } catch {
          // Ignore release errors from browsers that never captured the pointer.
        }

        if (!currentState.moved && currentState.pressedIndex !== null) {
          const index = currentState.pressedIndex;
          setSelectedIndex((previous) => (previous === index ? null : index));
        } else if (Math.abs(currentState.velocity) > 1) {
          runInertia();
        }

        currentState.pointerId = -1;
        currentState.pressedIndex = null;
        cleanupWindowDragListeners();
      };

      const handleWindowPointerMove = (event: PointerEvent) => {
        if (event.pointerId !== dragState.current.pointerId) return;
        event.preventDefault();
        moveTimeline(event.clientX, event.timeStamp);
      };

      const handleWindowPointerUp = (event: PointerEvent) => {
        if (event.pointerId !== dragState.current.pointerId) return;
        finishTimelineDrag(event.pointerId);
      };

      const handleWindowPointerCancel = (event: PointerEvent) => {
        if (event.pointerId !== dragState.current.pointerId) return;
        finishTimelineDrag(event.pointerId);
      };

      window.addEventListener("pointermove", handleWindowPointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handleWindowPointerUp);
      window.addEventListener("pointercancel", handleWindowPointerCancel);

      windowDragCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleWindowPointerMove);
        window.removeEventListener("pointerup", handleWindowPointerUp);
        window.removeEventListener("pointercancel", handleWindowPointerCancel);
      };
    },
    [
      applyClipsNow,
      cleanupWindowDragListeners,
      clips,
      runInertia,
      safePixelsPerSecond,
      scheduleClips,
      selectedIndex,
      stopInertia,
    ],
  );

  const handlePointerCancel = useCallback(() => {
    const state = dragState.current;
    state.isDragging = false;
    state.pointerId = -1;
    state.pressedIndex = null;

    const filmStripState = filmStripEditState.current;
    filmStripState.active = false;
    filmStripState.anchorIndex = -1;
    filmStripState.pointerId = -1;
    filmStripState.moved = false;
    filmStripState.baselineClips = null;

    setScrubPreview(null);
    cleanupWindowDragListeners();
  }, [cleanupWindowDragListeners]);

  const handleResizeDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      clip: TimelineClip,
      edge: "left" | "right",
    ) => {
      e.stopPropagation();
      e.preventDefault();
      stopInertia();
      setSelectedIndex(clip.index);

      if (clip.kind === "video") {
        setScrubPreview({
          clipIndex: clip.index,
          time: getTrimHandleSourceTime(clip, edge),
        });
      } else {
        setScrubPreview(null);
      }

      const rs = resizeState.current;
      rs.active = true;
      rs.anchorIndex = clip.index;
      rs.edge = edge;
      rs.startX = e.clientX;
      rs.baselineClips = clips.map((currentClip) => ({ ...currentClip }));

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
    },
    [clips, stopInertia],
  );

  const handleResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current;
      if (!rs.active || !rs.baselineClips) return;

      e.stopPropagation();
      e.preventDefault();

      const deltaTime = (e.clientX - rs.startX) / safePixelsPerSecond;
      const nextClips = resizeClipsFromBaseline({
        baselineClips: rs.baselineClips,
        anchorIndex: rs.anchorIndex,
        edge: rs.edge,
        deltaTime,
        minDuration,
      });

      const previewClip = nextClips[rs.anchorIndex];
      if (previewClip?.kind === "video") {
        setScrubPreview({
          clipIndex: previewClip.index,
          time: getTrimHandleSourceTime(previewClip, rs.edge),
        });
      }

      scheduleClips(nextClips);
    },
    [minDuration, safePixelsPerSecond, scheduleClips],
  );

  const handleResizeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current;
      if (!rs.active || !rs.baselineClips) return;

      e.stopPropagation();
      e.preventDefault();

      const deltaTime = (e.clientX - rs.startX) / safePixelsPerSecond;
      const nextClips = resizeClipsFromBaseline({
        baselineClips: rs.baselineClips,
        anchorIndex: rs.anchorIndex,
        edge: rs.edge,
        deltaTime,
        minDuration,
      });

      applyClipsNow(nextClips);
      setScrubPreview(null);

      rs.active = false;
      rs.anchorIndex = -1;
      rs.baselineClips = null;

      const target = e.currentTarget as HTMLElement;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    },
    [applyClipsNow, minDuration, safePixelsPerSecond],
  );

  const handleResizeKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLDivElement>,
      clip: TimelineClip,
      edge: "left" | "right",
    ) => {
      let deltaPx = 0;

      if (e.key === "Home") {
        deltaPx = edge === "left" ? -MAX_WIDTH : -MAX_WIDTH;
      } else if (e.key === "End") {
        deltaPx = edge === "left" ? MAX_WIDTH : MAX_WIDTH;
      } else if (e.key === "ArrowLeft") {
        deltaPx = -RESIZE_KEY_STEP_PX;
      } else if (e.key === "ArrowRight") {
        deltaPx = RESIZE_KEY_STEP_PX;
      } else {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      stopInertia();
      setSelectedIndex(clip.index);
      setScrubPreview(null);

      const nextClips = resizeClipsFromBaseline({
        baselineClips: clips.map((currentClip) => ({ ...currentClip })),
        anchorIndex: clip.index,
        edge,
        deltaTime: deltaPx / safePixelsPerSecond,
        minDuration,
      });

      applyClipsNow(nextClips);
    },
    [applyClipsNow, clips, minDuration, safePixelsPerSecond, stopInertia],
  );

  const handleFilmStripPointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      clip: TimelineClip,
      mode: VideoSourceWindowEditMode,
    ) => {
      if (clip.kind !== "video") return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const filmStripElement = (e.target as HTMLElement).closest(
        "[data-video-filmstrip]",
      ) as HTMLElement | null;
      if (!filmStripElement) return;

      e.stopPropagation();
      e.preventDefault();
      stopInertia();
      cleanupWindowDragListeners();
      setSelectedIndex(clip.index);

      const rect = filmStripElement.getBoundingClientRect();
      const rectWidth = Math.max(1, rect.width);
      const startSourceTime = getSourceTimeFromClientX({
        clientX: e.clientX,
        rectLeft: rect.left,
        rectWidth,
        sourceDuration: clip.sourceDuration,
      });

      const state = filmStripEditState.current;
      state.active = true;
      state.anchorIndex = clip.index;
      state.mode = mode;
      state.startX = e.clientX;
      state.lastX = e.clientX;
      state.startSourceTime = startSourceTime;
      state.lastSourceTime = startSourceTime;
      state.rectLeft = rect.left;
      state.rectWidth = rectWidth;
      state.pointerId = e.pointerId;
      state.moved = mode === "center";
      state.baselineClips = clips.map((currentClip) => ({ ...currentClip }));

      const getEditedClips = (clientX: number) => {
        const currentState = filmStripEditState.current;
        if (!currentState.baselineClips) return clips;

        const sourceTime = getSourceTimeFromClientX({
          clientX,
          rectLeft: currentState.rectLeft,
          rectWidth: currentState.rectWidth,
          sourceDuration: clip.sourceDuration,
        });
        currentState.lastX = clientX;
        currentState.lastSourceTime = sourceTime;

        return editVideoSourceWindowFromBaseline({
          baselineClips: currentState.baselineClips,
          anchorIndex: currentState.anchorIndex,
          mode: currentState.mode,
          // Dragging the highlighted source window should move the slip
          // window in the same visual direction as the pointer. The source
          // strip itself is positioned opposite the selected clip by trimIn,
          // so invert the delta for move-mode drags.
          deltaTime:
            currentState.mode === "move"
              ? currentState.startSourceTime - sourceTime
              : sourceTime - currentState.startSourceTime,
          sourceTime,
          minDuration,
        });
      };

      const previewEditedClips = (nextClips: TimelineClip[]) => {
        const currentState = filmStripEditState.current;
        const previewClip = nextClips[currentState.anchorIndex];
        if (previewClip?.kind === "video") {
          setScrubPreview({
            clipIndex: previewClip.index,
            time: previewClip.trimIn,
          });
        }
      };

      setScrubPreview({ clipIndex: clip.index, time: clip.trimIn });

      if (mode === "center") {
        const nextClips = getEditedClips(e.clientX);
        previewEditedClips(nextClips);
        scheduleClips(nextClips);
      }

      try {
        filmStripElement.setPointerCapture(e.pointerId);
      } catch {
        // Window listeners below still keep editing alive.
      }

      const handleWindowFilmStripMove = (event: PointerEvent) => {
        const currentState = filmStripEditState.current;
        if (event.pointerId !== currentState.pointerId) return;

        event.preventDefault();

        const dx = event.clientX - currentState.startX;
        if (!currentState.moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;

        currentState.moved = true;
        const nextClips = getEditedClips(event.clientX);
        previewEditedClips(nextClips);
        scheduleClips(nextClips);
      };

      const finishFilmStripEdit = (event: PointerEvent) => {
        const currentState = filmStripEditState.current;
        if (event.pointerId !== currentState.pointerId) return;

        const nextClips = currentState.baselineClips
          ? getEditedClips(currentState.moved ? event.clientX : currentState.lastX)
          : clips;

        if (currentState.moved) {
          applyClipsNow(nextClips);
        }

        setScrubPreview(null);

        currentState.active = false;
        currentState.anchorIndex = -1;
        currentState.pointerId = -1;
        currentState.moved = false;
        currentState.baselineClips = null;

        try {
          if (filmStripElement.hasPointerCapture(event.pointerId)) {
            filmStripElement.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Ignore release errors from browsers that never captured the pointer.
        }

        cleanupWindowDragListeners();
      };

      const cancelFilmStripEdit = (event: PointerEvent) => {
        const currentState = filmStripEditState.current;
        if (event.pointerId !== currentState.pointerId) return;

        setScrubPreview(null);
        currentState.active = false;
        currentState.anchorIndex = -1;
        currentState.pointerId = -1;
        currentState.moved = false;
        currentState.baselineClips = null;
        cleanupWindowDragListeners();
      };

      window.addEventListener("pointermove", handleWindowFilmStripMove, {
        passive: false,
      });
      window.addEventListener("pointerup", finishFilmStripEdit);
      window.addEventListener("pointercancel", cancelFilmStripEdit);

      windowDragCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleWindowFilmStripMove);
        window.removeEventListener("pointerup", finishFilmStripEdit);
        window.removeEventListener("pointercancel", cancelFilmStripEdit);
      };
    },
    [
      applyClipsNow,
      cleanupWindowDragListeners,
      clips,
      minDuration,
      scheduleClips,
      stopInertia,
    ],
  );

  useEffect(() => {
    return () => {
      stopInertia();
      cleanupWindowDragListeners();

      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }

      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, [cleanupWindowDragListeners, stopInertia]);

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

type TimelineClipItemProps = {
  clip: TimelineClip;
  pixelsPerSecond: number;
  itemTop: number;
  isSelected: boolean;
  scrubPreviewTime?: number | null;
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
};

const TimelineClipItem = memo(function TimelineClipItem({
  clip,
  pixelsPerSecond,
  itemTop,
  isSelected,
  scrubPreviewTime = null,
  onResizeDown,
  onResizeMove,
  onResizeUp,
  onResizeKeyDown,
}: TimelineClipItemProps) {
  const left = clip.startTime * pixelsPerSecond;
  const width = clip.duration * pixelsPerSecond;
  const sourceWidth = clip.sourceDuration * pixelsPerSecond;
  const trimInPx = clip.trimIn * pixelsPerSecond;

  return (
    <div
      data-clip-index={clip.index}
      className="absolute"
      style={{
        top: `${itemTop}px`,
        width: `${width}px`,
        height: `${ITEM_HEIGHT}px`,
        transform: `translateX(${left}px)`,
        zIndex: isSelected ? 30 : 0,
      }}
    >
      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-shadow",
          isSelected
            ? "ring-2 ring-amber-400 shadow-lg shadow-amber-400/20"
            : "ring-1 ring-zinc-900",
        )}
      >
        {clip.kind === "video" ? (
          <RepeatedVideoTile
            clip={clip}
            displayWidth={width}
            previewTime={scrubPreviewTime ?? clip.trimIn}
          />
        ) : (
          <div
            className="pointer-events-none h-full"
            style={{
              width: `${sourceWidth}px`,
              transform: `translateX(${-trimInPx}px)`,
            }}
          >
            <img
              src={clip.src}
              alt={clip.alt}
              draggable={false}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        {clip.kind === "video" && (
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            VIDEO
          </span>
        )}

        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100">
          {clip.kind === "video"
            ? `${formatSeconds(clip.duration)} / ${formatSeconds(clip.sourceDuration)}`
            : `${Math.round(width)}px · ${clip.startTime.toFixed(1)}s`}
        </span>

        {isSelected && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
            <TrimHandle
              edge="left"
              currentWidth={width}
              onPointerDown={(e) => onResizeDown(e, clip, "left")}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onKeyDown={(e) => onResizeKeyDown(e, clip, "left")}
            />
            <TrimHandle
              edge="right"
              currentWidth={width}
              onPointerDown={(e) => onResizeDown(e, clip, "right")}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onKeyDown={(e) => onResizeKeyDown(e, clip, "right")}
            />
          </>
        )}
      </div>
    </div>
  );
});

type RepeatedVideoTileProps = {
  clip: TimelineClip;
  displayWidth: number;
  previewTime: number;
};

function getOddTileCount(value: number) {
  const safeValue = Math.max(1, Math.ceil(value));
  return safeValue % 2 === 1 ? safeValue : safeValue + 1;
}

function RepeatedVideoTile({
  clip,
  displayWidth,
  previewTime,
}: RepeatedVideoTileProps) {
  // Keep each still frame close to the media's natural display aspect.
  // If a clip gets very wide, repeat the same source frame instead of
  // stretching one video element across the full item and blurring it.
  // The count is always odd so one frame is centered in the visible item,
  // with matching repeated frames extending out to both sides.
  const naturalFrameWidth = Math.max(120, Math.round(ITEM_HEIGHT * clip.aspect));
  const tileCount = getOddTileCount(displayWidth / naturalFrameWidth);
  const centerIndex = Math.floor(tileCount / 2);

  return (
    <div className="pointer-events-none relative h-full w-full overflow-hidden">
      <div
        className="absolute left-1/2 top-0 flex h-full"
        style={{
          width: `${tileCount * naturalFrameWidth}px`,
          transform: "translateX(-50%)",
        }}
      >
        {Array.from({ length: tileCount }, (_, index) => (
          <div
            key={`${clip.id}-repeat-frame-${index}`}
            className={cn(
              "h-full shrink-0 overflow-hidden border-r border-black/35 last:border-r-0 transition-opacity",
              index === centerIndex ? "opacity-100" : "opacity-10",
            )}
            style={{ width: `${naturalFrameWidth}px` }}
            aria-hidden={index !== centerIndex}
          >
            <VideoTile
              src={clip.src}
              poster={clip.poster}
              alt={
                index === centerIndex
                  ? clip.alt
                  : `${clip.alt} repeated frame ${index + 1}`
              }
              previewTime={previewTime}
              sourceDuration={clip.sourceDuration}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

type VideoSourceFilmStripProps = {
  clip: TimelineClip;
  pixelsPerSecond: number;
  onSourceWindowPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
    mode: VideoSourceWindowEditMode,
  ) => void;
};

function VideoSourceFilmStrip({
  clip,
  pixelsPerSecond,
  onSourceWindowPointerDown,
}: VideoSourceFilmStripProps) {
  const selectedLeft = clip.startTime * pixelsPerSecond;
  const selectedWidth = clip.duration * pixelsPerSecond;
  const sourceWidth = clip.sourceDuration * pixelsPerSecond;
  const trimInWidth = clip.trimIn * pixelsPerSecond;
  const sourceLeft = selectedLeft - trimInWidth;
  const frameCount = clamp(
    Math.ceil(sourceWidth / FILMSTRIP_TARGET_FRAME_WIDTH),
    2,
    FILMSTRIP_MAX_FRAMES,
  );
  const frameEpsilon = Math.min(1 / 30, clip.sourceDuration / 100);
  const lastFrameTime = Math.max(0, clip.sourceDuration - frameEpsilon);
  const frameTimes = Array.from({ length: frameCount }, (_, index) => {
    if (frameCount === 1) return 0;
    return (index / (frameCount - 1)) * lastFrameTime;
  });

  return (
    <div
      data-video-filmstrip="true"
      className="absolute left-0 top-0 touch-none rounded-md border border-zinc-600 bg-zinc-950 shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
      onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "center")}
      style={{
        width: `${sourceWidth}px`,
        height: `${FILMSTRIP_HEIGHT}px`,
        transform: `translateX(${sourceLeft}px)`,
        zIndex: 35,
      }}
      aria-label={`${clip.alt} full source filmstrip`}
    >
      <div className="absolute inset-0 flex overflow-hidden rounded-md">
        {frameTimes.map((time, index) => (
          <div
            key={`${clip.id}-film-frame-${index}`}
            className="relative h-full min-w-0 overflow-hidden border-r border-black/70 last:border-r-0"
            style={{ flex: `0 0 ${100 / frameTimes.length}%` }}
          >
            <VideoTile
              src={clip.src}
              poster={clip.poster}
              alt={`${clip.alt} source frame ${index + 1}`}
              previewTime={time}
              sourceDuration={clip.sourceDuration}
            />
            {(index === 0 || index === frameTimes.length - 1) && (
              <span
                className={cn(
                  "absolute bottom-0.5 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] text-zinc-100",
                  index === 0 ? "left-0.5" : "right-0.5",
                )}
              >
                {index === 0 ? "start" : "end"}
              </span>
            )}
          </div>
        ))}
      </div>

      <div
        className="absolute inset-y-0 cursor-grab touch-none rounded-sm border-2 border-amber-300 bg-amber-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)] active:cursor-grabbing"
        style={{
          width: `${selectedWidth}px`,
          transform: `translateX(${trimInWidth}px)`,
        }}
        onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "move")}
        title="Drag to move the source window"
      >
        <div
          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-sm bg-amber-200/90"
          onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "left")}
          title="Adjust source start"
        />
        <div
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-sm bg-amber-200/90"
          onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "right")}
          title="Adjust source end"
        />
      </div>

      <div className="pointer-events-none absolute left-1/2 top-0.5 -translate-x-1/2 rounded-full bg-black/75 px-2 py-0.5 font-mono text-[9px] text-zinc-100">
        full clip {formatSeconds(clip.sourceDuration)}
      </div>
    </div>
  );
}

type VideoTileProps = {
  src: string;
  alt: string;
  poster?: string;
  /** Seek-only preview time in the component's source-time space. */
  previewTime?: number | null;
  /** Source duration used by the timeline UI. When it differs from the real video file duration, previewTime is normalized. */
  sourceDuration?: number | null;
};

function VideoTile({
  src,
  poster,
  alt,
  previewTime = null,
  sourceDuration = null,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasPreviewTime = previewTime !== null && Number.isFinite(previewTime);

  const resetToPosterOrStart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();

    try {
      video.currentTime = 0;
    } catch {
      // Some browsers can reject seeking before metadata is available.
    }

    // Only use the poster fallback when the caller does not provide a source
    // time. Timeline clips pass trimIn so the still frame matches the current
    // visible start frame even when nothing is being dragged.
    if (poster) {
      video.load();
    }
  }, [poster]);

  const seekToPreviewTime = useCallback(() => {
    const video = videoRef.current;
    if (!video || previewTime === null || !Number.isFinite(previewTime)) return;

    video.pause();

    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : null;
    const hasTimelineSourceDuration =
      sourceDuration !== null && Number.isFinite(sourceDuration) && sourceDuration > 0;

    // The timeline may model a source as wider/longer than the demo media file.
    // Map the UI source time proportionally into the real video duration so
    // left and right trim handles scrub in exact visual sync with the UI.
    const requestedTime =
      duration !== null && hasTimelineSourceDuration
        ? (previewTime / sourceDuration) * duration
        : previewTime;
    const frameEpsilon = duration === null ? 1 / 60 : Math.min(1 / 60, duration / 200);
    const maxTime =
      duration === null ? requestedTime : Math.max(0, duration - frameEpsilon);
    const nextTime = clamp(requestedTime, 0, maxTime);

    try {
      if (Math.abs(video.currentTime - nextTime) > 0.001) {
        video.currentTime = nextTime;
      }
    } catch {
      // Metadata may not be ready yet. onLoadedMetadata retries the seek.
    }
  }, [previewTime, sourceDuration]);

  useEffect(() => {
    if (hasPreviewTime) {
      seekToPreviewTime();
      return;
    }

    resetToPosterOrStart();
  }, [hasPreviewTime, resetToPosterOrStart, seekToPreviewTime]);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      muted
      defaultMuted
      playsInline
      preload={hasPreviewTime ? "auto" : "metadata"}
      aria-label={alt}
      draggable={false}
      className="pointer-events-none h-full w-full object-cover"
      onLoadedMetadata={
        hasPreviewTime ? seekToPreviewTime : resetToPosterOrStart
      }
      onCanPlay={hasPreviewTime ? seekToPreviewTime : undefined}
    />
  );
}

type TrimHandleProps = {
  edge: "left" | "right";
  currentWidth: number;
} & Pick<
  React.HTMLAttributes<HTMLDivElement>,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onKeyDown"
>;

function TrimHandle({ edge, currentWidth, ...handlers }: TrimHandleProps) {
  return (
    <div
      data-trim-handle="true"
      role="slider"
      tabIndex={0}
      aria-label={`Trim ${edge} edge`}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={Math.round(currentWidth)}
      className={cn(
        "absolute top-0 z-10 flex h-full w-4 cursor-ew-resize touch-none items-center justify-center bg-amber-400 outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        edge === "left" ? "left-0 rounded-l-md" : "right-0 rounded-r-md",
      )}
      onClick={(e) => e.stopPropagation()}
      {...handlers}
    >
      <span className="h-8 w-0.5 rounded bg-zinc-900/70" />
    </div>
  );
}
