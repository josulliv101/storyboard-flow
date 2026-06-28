"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import {
  getCollectionClipFramePreview,
  getCollectionClipSourceDuration,
} from "@/lib/timeline-documents";

import type { TimelineClip } from "./types";
import { formatSeconds } from "./utils";

type DisplayMedia = {
  key: string;
  kind: "image" | "video";
  src: string;
  poster?: string;
  alt: string;
  sourceTime: number;
  timelineTime: number;
  clipTitle: string;
};

type CachedMedia =
  | { kind: "image"; element: HTMLImageElement }
  | { kind: "video"; element: HTMLVideoElement };

type WorkbenchDisplaySurfaceProps = {
  clips: TimelineClip[];
  currentTime: number;
  onCurrentTimeChange: (time: number) => void;
  className?: string;
};

const BUFFER_WINDOW_SIZE = 4;
const DEFAULT_SURFACE_HEIGHT = 380;
const MIN_SURFACE_HEIGHT = 220;
const MIN_TIMELINE_SPACE = 300;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clipLabel(clip: TimelineClip) {
  return clip.kind === "collection" ? clip.title : clip.alt || "Clip";
}

function resolveClipMedia(clip: TimelineClip, timelineTime: number): DisplayMedia | null {
  const clipTime = Math.max(0, timelineTime - clip.startTime);
  const sourceTime = clamp(
    clip.trimIn + clipTime,
    0,
    Math.max(0, clip.sourceDuration - 0.001),
  );

  if (clip.kind === "video") {
    return {
      key: `${clip.id}:video:${clip.src}`,
      kind: "video",
      src: clip.src,
      poster: clip.poster,
      alt: clip.alt,
      sourceTime,
      timelineTime,
      clipTitle: clipLabel(clip),
    };
  }

  if (clip.kind === "image") {
    return {
      key: `${clip.id}:image:${clip.src}`,
      kind: "image",
      src: clip.src,
      poster: clip.poster,
      alt: clip.alt,
      sourceTime: 0,
      timelineTime,
      clipTitle: clipLabel(clip),
    };
  }

  const collectionPreview = getCollectionClipFramePreview(clip, clipTime);
  if (collectionPreview) {
    return {
      key: `${clip.id}:${collectionPreview.kind}:${collectionPreview.src}`,
      kind: collectionPreview.kind,
      src: collectionPreview.src,
      poster: collectionPreview.poster,
      alt: collectionPreview.alt,
      sourceTime: collectionPreview.kind === "video" ? collectionPreview.previewTime : 0,
      timelineTime,
      clipTitle: clip.title,
    };
  }

  const fallbackPreview = clip.previewItems?.[0];
  if (!fallbackPreview) return null;

  return {
    key: `${clip.id}:${fallbackPreview.kind}:${fallbackPreview.src}`,
    kind: fallbackPreview.kind,
    src: fallbackPreview.src,
    poster: fallbackPreview.poster,
    alt: fallbackPreview.alt,
    sourceTime: 0,
    timelineTime,
    clipTitle: clip.title,
  };
}

function getActiveClip(clips: TimelineClip[], currentTime: number) {
  if (clips.length === 0) return null;
  const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime || a.index - b.index);
  const lastClip = sortedClips[sortedClips.length - 1];
  if (lastClip && currentTime >= lastClip.startTime + lastClip.duration) {
    return lastClip;
  }

  return (
    sortedClips.find((clip) => currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration) ??
    sortedClips[0]
  );
}

function getTimelineDuration(clips: TimelineClip[]) {
  return clips.reduce((duration, clip) => Math.max(duration, clip.startTime + clip.duration), 0);
}

function getTimelineAdvanceScale(clip: TimelineClip) {
  if (clip.kind !== "collection") return 1;

  const sourceDuration = getCollectionClipSourceDuration(clip);
  if (sourceDuration <= clip.duration) return 1;

  return clamp(clip.duration / sourceDuration, 0.001, 1);
}

function advanceTimelineTime(
  clips: TimelineClip[],
  currentTime: number,
  elapsedSeconds: number,
  duration: number,
) {
  let nextTime = clamp(currentTime, 0, duration);
  let remainingSeconds = Math.max(0, elapsedSeconds);

  while (remainingSeconds > 0 && nextTime < duration) {
    const activeClip = clips.find(
      (clip) => nextTime >= clip.startTime && nextTime < clip.startTime + clip.duration,
    );

    if (activeClip) {
      const clipEndTime = activeClip.startTime + activeClip.duration;
      const scale = getTimelineAdvanceScale(activeClip);
      const realSecondsToClipEnd = (clipEndTime - nextTime) / scale;

      if (remainingSeconds <= realSecondsToClipEnd) {
        return clamp(nextTime + remainingSeconds * scale, 0, duration);
      }

      nextTime = clipEndTime;
      remainingSeconds -= realSecondsToClipEnd;
      continue;
    }

    const nextClip = clips.find((clip) => clip.startTime > nextTime);
    const segmentEndTime = nextClip ? nextClip.startTime : duration;
    const realSecondsToSegmentEnd = segmentEndTime - nextTime;

    if (remainingSeconds <= realSecondsToSegmentEnd) {
      return clamp(nextTime + remainingSeconds, 0, duration);
    }

    nextTime = segmentEndTime;
    remainingSeconds -= realSecondsToSegmentEnd;
  }

  return clamp(nextTime, 0, duration);
}

export function WorkbenchDisplaySurface({
  clips,
  currentTime,
  onCurrentTimeChange,
  className,
}: WorkbenchDisplaySurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef(new Map<string, CachedMedia>());
  const activeMediaRef = useRef<DisplayMedia | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const playbackLastFrameRef = useRef<number | null>(null);
  const currentTimeRef = useRef(currentTime);
  const [isPlaying, setIsPlaying] = useState(false);

  const sortedClips = useMemo(
    () => [...clips].sort((a, b) => a.startTime - b.startTime || a.index - b.index),
    [clips],
  );
  const duration = useMemo(() => getTimelineDuration(sortedClips), [sortedClips]);
  const activeClip = useMemo(
    () => getActiveClip(sortedClips, currentTime),
    [currentTime, sortedClips],
  );
  const activeClipIndex = useMemo(
    () => (activeClip ? sortedClips.findIndex((clip) => clip.id === activeClip.id) : -1),
    [activeClip, sortedClips],
  );
  const activeMedia = useMemo(
    () => (activeClip ? resolveClipMedia(activeClip, currentTime) : null),
    [activeClip, currentTime],
  );
  const bufferedMedia = useMemo(() => {
    if (!activeClip) return [];
    const activeIndex = sortedClips.findIndex((clip) => clip.id === activeClip.id);
    if (activeIndex === -1) return activeMedia ? [activeMedia] : [];

    return sortedClips
      .slice(activeIndex, activeIndex + BUFFER_WINDOW_SIZE)
      .map((clip) => resolveClipMedia(clip, Math.max(currentTime, clip.startTime)))
      .filter((media): media is DisplayMedia => media !== null);
  }, [activeClip, activeMedia, currentTime, sortedClips]);

  const ensureCachedMedia = useCallback((media: DisplayMedia) => {
    const cached = cacheRef.current.get(media.key);
    if (cached) return cached;

    if (media.kind === "video") {
      const video = document.createElement("video");
      video.preload = "auto";
      video.playsInline = true;
      video.muted = true;
      if (media.poster) video.poster = media.poster;
      video.src = media.src;
      video.load();
      const nextCached: CachedMedia = { kind: "video", element: video };
      cacheRef.current.set(media.key, nextCached);
      return nextCached;
    }

    const image = new window.Image();
    image.decoding = "async";
    image.src = media.src;
    const nextCached: CachedMedia = { kind: "image", element: image };
    cacheRef.current.set(media.key, nextCached);
    return nextCached;
  }, []);

  const drawDrawable = useCallback((drawable: HTMLImageElement | HTMLVideoElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const renderWidth = Math.round(cssWidth * pixelRatio);
    const renderHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    const sourceWidth = drawable instanceof HTMLVideoElement ? drawable.videoWidth : drawable.naturalWidth;
    const sourceHeight = drawable instanceof HTMLVideoElement ? drawable.videoHeight : drawable.naturalHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const scale = Math.min(cssWidth / sourceWidth, cssHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, cssWidth, cssHeight);
    context.drawImage(drawable, (cssWidth - width) / 2, (cssHeight - height) / 2, width, height);
  }, []);

  const drawActiveFrame = useCallback(() => {
    const media = activeMediaRef.current;
    if (!media) return;
    const cached = cacheRef.current.get(media.key);
    if (!cached) return;

    if (cached.kind === "image") {
      if (cached.element.complete && cached.element.naturalWidth > 0) {
        drawDrawable(cached.element);
      }
      return;
    }

    if (cached.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      drawDrawable(cached.element);
    }
  }, [drawDrawable]);

  const syncActiveVideo = useCallback((media: DisplayMedia, shouldPlay: boolean) => {
    const cached = ensureCachedMedia(media);
    if (cached.kind !== "video") return;

    const video = cached.element;
    const seek = () => {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA || video.seeking) return;
      const maxTime = Number.isFinite(video.duration)
        ? Math.max(0, video.duration - 0.001)
        : media.sourceTime;
      const targetTime = clamp(media.sourceTime, 0, maxTime);
      const drift = Math.abs(video.currentTime - targetTime);
      if (drift > (shouldPlay ? 0.45 : 0.05)) {
        video.currentTime = targetTime;
      }
      if (shouldPlay && video.paused) {
        void video.play().catch(() => undefined);
      } else if (!shouldPlay) {
        video.pause();
      }
      drawActiveFrame();
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seek();
      return;
    }

    video.addEventListener("loadedmetadata", seek, { once: true });
    video.addEventListener("loadeddata", drawActiveFrame, { once: true });
  }, [drawActiveFrame, ensureCachedMedia]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(drawActiveFrame);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawActiveFrame]);

  useEffect(() => {
    bufferedMedia.forEach((media) => {
      const cached = ensureCachedMedia(media);
      if (cached.kind === "image" && !cached.element.complete) {
        cached.element.addEventListener("load", drawActiveFrame, { once: true });
      }
    });
  }, [bufferedMedia, drawActiveFrame, ensureCachedMedia]);

  useEffect(() => {
    activeMediaRef.current = activeMedia;
    if (!activeMedia) return;

    const cached = ensureCachedMedia(activeMedia);
    if (cached.kind === "image") {
      if (cached.element.complete && cached.element.naturalWidth > 0) {
        drawActiveFrame();
      } else {
        cached.element.addEventListener("load", drawActiveFrame, { once: true });
      }
      return;
    }

    syncActiveVideo(activeMedia, isPlaying);
  }, [activeMedia, drawActiveFrame, ensureCachedMedia, isPlaying, syncActiveVideo]);

  useEffect(() => {
    if (!activeMedia || activeMedia.kind !== "video") return;
    syncActiveVideo(activeMedia, isPlaying);
  }, [activeMedia, isPlaying, syncActiveVideo]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const seekToClip = useCallback(
    (direction: -1 | 1) => {
      if (sortedClips.length === 0) return;

      const currentIndex = activeClipIndex === -1 ? 0 : activeClipIndex;
      const nextIndex =
        direction === -1 && activeClip && currentTime > activeClip.startTime + 0.25
          ? currentIndex
          : clamp(currentIndex + direction, 0, sortedClips.length - 1);
      const nextClip = sortedClips[nextIndex];
      if (!nextClip) return;

      currentTimeRef.current = nextClip.startTime;
      onCurrentTimeChange(nextClip.startTime);
    },
    [activeClip, activeClipIndex, currentTime, onCurrentTimeChange, sortedClips],
  );

  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      playbackLastFrameRef.current = null;
      return;
    }

    playbackLastFrameRef.current = performance.now();
    const tick = (now: number) => {
      const previousFrameTime = playbackLastFrameRef.current ?? now;
      playbackLastFrameRef.current = now;

      const nextTime = advanceTimelineTime(
        sortedClips,
        currentTimeRef.current,
        (now - previousFrameTime) / 1000,
        duration,
      );
      currentTimeRef.current = nextTime;
      onCurrentTimeChange(nextTime);
      drawActiveFrame();

      if (nextTime >= duration) {
        setIsPlaying(false);
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [drawActiveFrame, duration, isPlaying, onCurrentTimeChange, sortedClips]);

  useEffect(() => {
    const mediaCache = cacheRef.current;
    return () => {
      mediaCache.forEach((cached) => {
        if (cached.kind === "video") {
          cached.element.pause();
          cached.element.removeAttribute("src");
          cached.element.load();
        }
      });
      mediaCache.clear();
    };
  }, []);

  const canPlay = duration > 0 && activeMedia !== null;
  const canSeekPrevious = sortedClips.length > 0 && currentTime > 0;
  const canSeekNext = sortedClips.length > 0 && activeClipIndex < sortedClips.length - 1;

  return (
    <section
      aria-label="Workbench display surface"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl",
        className,
      )}
      data-testid="workbench-display-surface"
      data-buffered-media-count={bufferedMedia.length}
    >
      <div className="min-h-0 flex-1 bg-black">
        <canvas
          ref={canvasRef}
          className="block h-full w-full bg-black"
          role="img"
          aria-label={activeMedia ? `${activeMedia.clipTitle} preview` : "Empty workbench preview"}
          data-testid="workbench-display-canvas"
        />
      </div>
      <div className="relative flex shrink-0 items-center justify-center border-t border-zinc-800 bg-zinc-950 px-4 py-2 text-xs text-zinc-200">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => seekToClip(-1)}
            disabled={!canSeekPrevious}
            className="grid size-8 place-items-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Previous workbench clip"
            title="Previous clip"
          >
            <SkipBack className="h-3.5 w-3.5 fill-current" />
          </button>
          <button
            type="button"
            onClick={() => setIsPlaying((value) => !value)}
            disabled={!canPlay}
            className="grid size-9 place-items-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-100 transition-colors hover:border-amber-400 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={isPlaying ? "Pause workbench preview" : "Play workbench preview"}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />}
          </button>
          <button
            type="button"
            onClick={() => seekToClip(1)}
            disabled={!canSeekNext}
            className="grid size-8 place-items-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Next workbench clip"
            title="Next clip"
          >
            <SkipForward className="h-3.5 w-3.5 fill-current" />
          </button>
        </div>
        <div className="absolute right-4 shrink-0 font-mono text-[11px] text-zinc-300">
          {formatSeconds(currentTime)} / {formatSeconds(duration)}
        </div>
      </div>
    </section>
  );
}

type WorkbenchSplitPaneProps = {
  clips: TimelineClip[];
  currentTime: number;
  onCurrentTimeChange: (time: number) => void;
  children: ReactNode;
};

export function WorkbenchSplitPane({
  clips,
  currentTime,
  onCurrentTimeChange,
  children,
}: WorkbenchSplitPaneProps) {
  const [surfaceHeight, setSurfaceHeight] = useState(DEFAULT_SURFACE_HEIGHT);
  const dragStartRef = useRef<{ pointerY: number; height: number } | null>(null);

  const clampSurfaceHeight = useCallback((height: number) => {
    if (typeof window === "undefined") {
      return clamp(height, MIN_SURFACE_HEIGHT, DEFAULT_SURFACE_HEIGHT);
    }

    const maxFromViewport = Math.max(
      MIN_SURFACE_HEIGHT,
      window.innerHeight - MIN_TIMELINE_SPACE,
    );
    return clamp(height, MIN_SURFACE_HEIGHT, maxFromViewport);
  }, []);

  useLayoutEffect(() => {
    const handleResize = () => {
      setSurfaceHeight((height) => clampSurfaceHeight(height));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampSurfaceHeight]);

  const handleDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStartRef.current = {
        pointerY: event.clientY,
        height: surfaceHeight,
      };
    },
    [surfaceHeight],
  );

  const handleDividerPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;

      const nextHeight = dragStart.height + event.clientY - dragStart.pointerY;
      setSurfaceHeight(clampSurfaceHeight(nextHeight));
    },
    [clampSurfaceHeight],
  );

  const handleDividerPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div className="grid min-h-0 w-full gap-0">
      <div
        className="min-h-0"
        style={{
          height: `${surfaceHeight}px`,
          maxHeight: `calc(100dvh - ${MIN_TIMELINE_SPACE}px)`,
          minHeight: `${MIN_SURFACE_HEIGHT}px`,
        }}
      >
        <WorkbenchDisplaySurface
          clips={clips}
          currentTime={currentTime}
          onCurrentTimeChange={onCurrentTimeChange}
          className="h-full"
        />
      </div>
      <button
        type="button"
        role="separator"
        aria-orientation="horizontal"
        aria-valuemin={MIN_SURFACE_HEIGHT}
        aria-valuenow={Math.round(surfaceHeight)}
        aria-label="Resize workbench display"
        className="group flex h-5 w-full cursor-row-resize items-center justify-center bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
        onPointerDown={handleDividerPointerDown}
        onPointerMove={handleDividerPointerMove}
        onPointerUp={handleDividerPointerUp}
        onPointerCancel={handleDividerPointerUp}
      >
        <span className="h-px w-full bg-zinc-800 transition-colors group-hover:bg-amber-400/70 group-active:bg-amber-400" />
      </button>
      <div className="min-h-0 pt-3">
        {children}
      </div>
    </div>
  );
}
