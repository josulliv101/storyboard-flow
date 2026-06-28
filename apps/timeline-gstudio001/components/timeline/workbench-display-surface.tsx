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
import { getCollectionClipFramePreview } from "@/lib/timeline-documents";

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
  playbackRate: number;
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

function getClipPlaybackRate(clip: TimelineClip) {
  const sourceRange = Math.max(0.001, clip.sourceDuration - clip.trimIn - clip.trimOut);
  return clamp(sourceRange / Math.max(0.001, clip.duration), 0.0625, 16);
}

function resolveClipMedia(clip: TimelineClip, timelineTime: number): DisplayMedia | null {
  const clipTime = Math.max(0, timelineTime - clip.startTime);

  if (clip.kind === "video") {
    const sourceRange = Math.max(0, clip.sourceDuration - clip.trimIn - clip.trimOut);
    const progress = clip.duration > 0 ? clamp(clipTime / clip.duration, 0, 1) : 0;
    const sourceTime = clamp(
      clip.trimIn + progress * sourceRange,
      0,
      Math.max(0, clip.sourceDuration - 0.001),
    );

    return {
      key: `${clip.id}:video:${clip.src}`,
      kind: "video",
      src: clip.src,
      poster: clip.poster,
      alt: clip.alt,
      sourceTime,
      timelineTime,
      clipTitle: clipLabel(clip),
      playbackRate: getClipPlaybackRate(clip),
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
      playbackRate: 1,
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
      playbackRate: clamp(collectionPreview.playbackRate, 0.0625, 16),
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
    playbackRate: 1,
  };
}

function getActiveClip(clips: TimelineClip[], currentTime: number) {
  if (clips.length === 0) return null;
  const lastClip = clips[clips.length - 1];
  if (lastClip && currentTime >= lastClip.startTime + lastClip.duration) {
    return lastClip;
  }

  return clips.find((clip) => currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration) ?? null;
}

function getTimelineDuration(clips: TimelineClip[]) {
  return clips.reduce((duration, clip) => Math.max(duration, clip.startTime + clip.duration), 0);
}

function normalizePlaybackTime(clips: TimelineClip[], time: number, duration: number) {
  const boundedTime = clamp(time, 0, duration);
  if (getActiveClip(clips, boundedTime)) return boundedTime;

  const nextClip = clips.find((clip) => clip.startTime > boundedTime);
  return nextClip ? clamp(nextClip.startTime, 0, duration) : duration;
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
  const timeoutFrameRef = useRef<number | null>(null);
  const playbackAnchorRef = useRef<{ timelineTime: number; startedAtMs: number } | null>(null);
  const lastPublishedAtRef = useRef(0);
  const lastRenderedMediaKeyRef = useRef<string | null>(null);
  const currentTimeRef = useRef(currentTime);
  const sortedClipsRef = useRef<TimelineClip[]>([]);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const sortedClips = useMemo(
    () => [...clips].sort((a, b) => a.startTime - b.startTime || a.index - b.index),
    [clips],
  );
  const duration = useMemo(() => getTimelineDuration(sortedClips), [sortedClips]);
  useEffect(() => {
    sortedClipsRef.current = sortedClips;
    durationRef.current = duration;
  }, [duration, sortedClips]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
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

  const drawEmptyFrame = useCallback(() => {
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
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, cssWidth, cssHeight);
  }, []);

  const drawActiveFrame = useCallback(() => {
    const media = activeMediaRef.current;
    if (!media) {
      drawEmptyFrame();
      return;
    }
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
  }, [drawDrawable, drawEmptyFrame]);

  const pauseInactiveVideos = useCallback((activeKey: string | null) => {
    cacheRef.current.forEach((cached, key) => {
      if (cached.kind === "video" && key !== activeKey) {
        cached.element.pause();
      }
    });
  }, []);

  const syncActiveVideo = useCallback((media: DisplayMedia, shouldPlay: boolean, forceSeek = false) => {
    const cached = ensureCachedMedia(media);
    if (cached.kind !== "video") return;

    const video = cached.element;
    const seek = () => {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
      const maxTime = Number.isFinite(video.duration)
        ? Math.max(0, video.duration - 0.001)
        : media.sourceTime;
      const targetTime = clamp(media.sourceTime, 0, maxTime);
      const drift = Math.abs(video.currentTime - targetTime);
      const maxDrift = shouldPlay ? 0.18 : 0.05;
      if (Number.isFinite(media.playbackRate) && media.playbackRate > 0) {
        video.playbackRate = clamp(media.playbackRate, 0.0625, 16);
      }
      if ((forceSeek || drift > maxDrift) && !video.seeking) {
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

  const renderFrameAtTime = useCallback((timelineTime: number, shouldPlay: boolean, forceSeek = false) => {
    const active = getActiveClip(sortedClipsRef.current, timelineTime);
    const media = active ? resolveClipMedia(active, timelineTime) : null;
    const mediaChanged = media?.key !== lastRenderedMediaKeyRef.current;

    activeMediaRef.current = media;
    lastRenderedMediaKeyRef.current = media?.key ?? null;

    if (!media) {
      pauseInactiveVideos(null);
      drawEmptyFrame();
      return;
    }

    pauseInactiveVideos(media.key);
    const cached = ensureCachedMedia(media);

    if (cached.kind === "image") {
      if (cached.element.complete && cached.element.naturalWidth > 0) {
        drawDrawable(cached.element);
      } else {
        cached.element.addEventListener("load", drawActiveFrame, { once: true });
      }
      return;
    }

    syncActiveVideo(media, shouldPlay, forceSeek || mediaChanged);
  }, [
    drawActiveFrame,
    drawDrawable,
    drawEmptyFrame,
    ensureCachedMedia,
    pauseInactiveVideos,
    syncActiveVideo,
  ]);

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
    if (isPlayingRef.current) return;
    currentTimeRef.current = currentTime;
    renderFrameAtTime(currentTime, false, true);
  }, [currentTime, renderFrameAtTime]);

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
      playbackAnchorRef.current = null;
      renderFrameAtTime(nextClip.startTime, false, true);
      onCurrentTimeChange(nextClip.startTime);
    },
    [activeClip, activeClipIndex, currentTime, onCurrentTimeChange, renderFrameAtTime, sortedClips],
  );

  useEffect(() => {
    const cancelQueuedFrame = () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (timeoutFrameRef.current !== null) {
        window.clearTimeout(timeoutFrameRef.current);
        timeoutFrameRef.current = null;
      }
    };

    if (!isPlaying) {
      cancelQueuedFrame();
      playbackAnchorRef.current = null;
      renderFrameAtTime(currentTimeRef.current, false, true);
      return;
    }

    const clipsRef = sortedClipsRef;
    const startTime = normalizePlaybackTime(clipsRef.current, currentTimeRef.current, durationRef.current);
    currentTimeRef.current = startTime;
    playbackAnchorRef.current = {
      timelineTime: startTime,
      startedAtMs: performance.now(),
    };
    lastPublishedAtRef.current = 0;
    renderFrameAtTime(startTime, true, true);
    onCurrentTimeChange(startTime);

    const resetAnchor = (timelineTime: number, now: number) => {
      playbackAnchorRef.current = {
        timelineTime,
        startedAtMs: now,
      };
    };

    const publishTime = (timelineTime: number, now: number, force = false) => {
      if (!force && now - lastPublishedAtRef.current < 1000 / 30) return;
      lastPublishedAtRef.current = now;
      onCurrentTimeChange(timelineTime);
    };

    const queueNextFrame = () => {
      if (document.visibilityState === "hidden") {
        timeoutFrameRef.current = window.setTimeout(() => tick(performance.now()), 100);
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    const tick = (now: number) => {
      const anchor = playbackAnchorRef.current ?? {
        timelineTime: currentTimeRef.current,
        startedAtMs: now,
      };
      const rawTime = anchor.timelineTime + (now - anchor.startedAtMs) / 1000;
      const nextTime = normalizePlaybackTime(clipsRef.current, rawTime, durationRef.current);
      if (Math.abs(nextTime - rawTime) > 0.001) {
        resetAnchor(nextTime, now);
      }

      currentTimeRef.current = nextTime;
      renderFrameAtTime(nextTime, true);
      publishTime(nextTime, now);

      if (nextTime >= durationRef.current) {
        publishTime(durationRef.current, now, true);
        renderFrameAtTime(durationRef.current, false, true);
        setIsPlaying(false);
        return;
      }

      queueNextFrame();
    };

    const handleVisibilityChange = () => {
      cancelQueuedFrame();
      tick(performance.now());
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    queueNextFrame();

    return () => {
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelQueuedFrame();
    };
  }, [isPlaying, onCurrentTimeChange, renderFrameAtTime]);

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

  const canPlay = duration > 0 && sortedClips.length > 0;
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
