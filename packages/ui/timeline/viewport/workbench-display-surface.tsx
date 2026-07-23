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

import { cn } from "../../lib/utils";
import type { CollectionFramePreview } from "../timeline-documents";
import { useTimelineDocuments } from "../timeline-document-store";

import type { CollectionTimelineClip, TimelineClip } from "../types";
import { formatSeconds } from "../utils";

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
  preferredClipId?: string | null;
};

const BUFFER_WINDOW_SIZE = 4;
const DEFAULT_SURFACE_HEIGHT = 380;
const MIN_SURFACE_HEIGHT = 120;
const MIN_TIMELINE_SPACE = 260;
/** The resize divider's own height (Tailwind h-3). Part of the sticky preview
 *  region, so the published sticky offset must include it. */
const DIVIDER_HEIGHT_PX = 12;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clipLabel(clip: TimelineClip) {
  return clip.kind === "collection" ? clip.title : clip.alt || "Clip";
}

function getClipPlaybackRate(clip: TimelineClip) {
  const sourceRange = Math.max(0.001, clip.sourceDuration - clip.trimIn - clip.trimOut);
  return clamp(sourceRange / getClipPlaybackDuration(clip), 0.0625, 16);
}

function getClipPlaybackStart(clip: TimelineClip) {
  return clip.playbackStartTime ?? clip.startTime;
}

function getClipPlaybackDuration(clip: TimelineClip) {
  return Math.max(0.001, clip.playbackDuration ?? clip.duration);
}

function getClipPlaybackProgress(clip: TimelineClip, timelineTime: number) {
  const playbackStart = getClipPlaybackStart(clip);
  return clamp(
    (timelineTime - playbackStart) / getClipPlaybackDuration(clip),
    0,
    1,
  );
}

function getCollectionPreviewClip(clip: CollectionTimelineClip): CollectionTimelineClip {
  const playbackDuration = getClipPlaybackDuration(clip);
  return {
    ...clip,
    duration: playbackDuration,
    sourceDuration: Math.max(clip.sourceDuration, playbackDuration),
  };
}

type GetCollectionClipFramePreview = (
  clip: CollectionTimelineClip,
  clipTime: number,
  visited?: Set<string>,
  parentPlaybackRate?: number,
) => CollectionFramePreview | null;

function resolveClipMedia(
  clip: TimelineClip,
  timelineTime: number,
  getCollectionClipFramePreview: GetCollectionClipFramePreview,
): DisplayMedia | null {
  const progress = getClipPlaybackProgress(clip, timelineTime);
  const playbackLocalTime = progress * getClipPlaybackDuration(clip);

  if (clip.kind === "video") {
    const sourceRange = Math.max(0, clip.sourceDuration - clip.trimIn - clip.trimOut);
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

  const collectionPreview = getCollectionClipFramePreview(
    getCollectionPreviewClip(clip),
    playbackLocalTime,
  );
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

function clipContainsPlaybackTime(clip: TimelineClip, currentTime: number) {
  const playbackStart = getClipPlaybackStart(clip);
  const playbackDuration = getClipPlaybackDuration(clip);
  return currentTime >= playbackStart && currentTime <= playbackStart + playbackDuration;
}

/** The clip that literally covers this time — never one held over from
 *  earlier. Callers deciding whether a time is INSIDE playable material (as
 *  opposed to what to draw at it) must use this. */
function getContainingClip(clips: TimelineClip[], currentTime: number) {
  return clips.find((clip) => clipContainsPlaybackTime(clip, currentTime)) ?? null;
}

function getActiveClip(
  clips: TimelineClip[],
  currentTime: number,
  preferredClipId?: string | null,
) {
  if (clips.length === 0) return null;
  const preferredClip = preferredClipId
    ? clips.find((clip) => clip.id === preferredClipId)
    : null;
  if (preferredClip && clipContainsPlaybackTime(preferredClip, currentTime)) {
    return preferredClip;
  }

  const containing = getContainingClip(clips, currentTime);
  if (containing) return containing;

  // Nothing covers this time: the playhead sits in a GAP between clips, or
  // past the last one. Hold the clip that most recently started instead of
  // returning null — null renders the empty surface, so a gap flashed to
  // black mid-timeline. A gap carries no NEW frame; it is not an instruction
  // to blank what a real clip last showed. (The old special case for "past
  // the final clip" was this same rule, applied only at the tail.)
  //
  // Scans for the greatest start rather than trusting array order, so it
  // holds the right frame even for a caller that has not sorted. A leading
  // gap — before any clip has started — correctly still yields null.
  let held: TimelineClip | null = null;
  for (const clip of clips) {
    if (getClipPlaybackStart(clip) > currentTime) continue;
    if (!held || getClipPlaybackStart(clip) > getClipPlaybackStart(held)) held = clip;
  }
  return held;
}

function getTimelineDuration(clips: TimelineClip[]) {
  return clips.reduce(
    (duration, clip) => Math.max(duration, getClipPlaybackStart(clip) + getClipPlaybackDuration(clip)),
    0,
  );
}

function normalizePlaybackTime(clips: TimelineClip[], time: number, duration: number) {
  const boundedTime = clamp(time, 0, duration);
  // Containment, NOT getActiveClip: this decides whether the time needs
  // snapping forward to real material, and getActiveClip now answers "what
  // should the surface draw" — which holds a frame across gaps and would
  // make every gap look like a legitimate resting place.
  if (getContainingClip(clips, boundedTime)) return boundedTime;

  const nextClip = clips.find((clip) => getClipPlaybackStart(clip) > boundedTime);
  return nextClip ? clamp(getClipPlaybackStart(nextClip), 0, duration) : duration;
}

export function WorkbenchDisplaySurface({
  clips,
  currentTime,
  onCurrentTimeChange,
  className,
  preferredClipId,
}: WorkbenchDisplaySurfaceProps) {
  const { getCollectionClipFramePreview } = useTimelineDocuments();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef(new Map<string, CachedMedia>());
  const activeMediaRef = useRef<DisplayMedia | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timeoutFrameRef = useRef<number | null>(null);
  const pendingSeekDrawCleanupRef = useRef<(() => void) | null>(null);
  const playbackAnchorRef = useRef<{ timelineTime: number; startedAtMs: number } | null>(null);
  const lastPublishedAtRef = useRef(0);
  const lastRenderedMediaKeyRef = useRef<string | null>(null);
  const currentTimeRef = useRef(currentTime);
  const sortedClipsRef = useRef<TimelineClip[]>([]);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const sortedClips = useMemo(
    () => [...clips].sort((a, b) => getClipPlaybackStart(a) - getClipPlaybackStart(b) || a.index - b.index),
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
    () => getActiveClip(sortedClips, currentTime, preferredClipId),
    [currentTime, preferredClipId, sortedClips],
  );
  const activeClipIndex = useMemo(
    () => (activeClip ? sortedClips.findIndex((clip) => clip.id === activeClip.id) : -1),
    [activeClip, sortedClips],
  );
  const activeMedia = useMemo(
    () =>
      activeClip
        ? resolveClipMedia(
            activeClip,
            currentTime,
            getCollectionClipFramePreview,
          )
        : null,
    [activeClip, currentTime, getCollectionClipFramePreview],
  );
  const bufferedMedia = useMemo(() => {
    if (!activeClip) return [];
    const activeIndex = sortedClips.findIndex((clip) => clip.id === activeClip.id);
    if (activeIndex === -1) return activeMedia ? [activeMedia] : [];

    return sortedClips
      .slice(activeIndex, activeIndex + BUFFER_WINDOW_SIZE)
      .map((clip) =>
        resolveClipMedia(
          clip,
          Math.max(currentTime, getClipPlaybackStart(clip)),
          getCollectionClipFramePreview,
        ),
      )
      .filter((media): media is DisplayMedia => media !== null);
  }, [
    activeClip,
    activeMedia,
    currentTime,
    getCollectionClipFramePreview,
    sortedClips,
  ]);

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
      if (forceSeek || drift > maxDrift) {
        pendingSeekDrawCleanupRef.current?.();
        pendingSeekDrawCleanupRef.current = null;

        const drawAfterSeek = () => {
          pendingSeekDrawCleanupRef.current?.();
          pendingSeekDrawCleanupRef.current = null;
          drawActiveFrame();
        };

        video.addEventListener("seeked", drawAfterSeek, { once: true });
        video.addEventListener("loadeddata", drawAfterSeek, { once: true });
        pendingSeekDrawCleanupRef.current = () => {
          video.removeEventListener("seeked", drawAfterSeek);
          video.removeEventListener("loadeddata", drawAfterSeek);
        };
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
    const active = getActiveClip(sortedClipsRef.current, timelineTime, preferredClipId);
    const media = active
      ? resolveClipMedia(active, timelineTime, getCollectionClipFramePreview)
      : null;
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
    preferredClipId,
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

  // Repaint on a new CLIP LIST as well as a new time. `renderFrameAtTime`
  // reads the clips through a ref (so playback doesn't re-create it every
  // frame), which means a caller that swaps the whole list — the graph view
  // drilling into another collection — left the canvas showing the previous
  // list's frame whenever the time didn't also change (it resets to 0, and
  // 0 → 0 is not a change). Consumers worked around that by remounting the
  // pane, throwing away the canvas, the media cache and the chosen height.
  // Depending on the sorted list makes the swap repaint itself.
  useEffect(() => {
    if (isPlayingRef.current) return;
    currentTimeRef.current = currentTime;
    renderFrameAtTime(currentTime, false, true);
  }, [currentTime, renderFrameAtTime, sortedClips]);

  const seekToClip = useCallback(
    (direction: -1 | 1) => {
      if (sortedClips.length === 0) return;

      const currentIndex = activeClipIndex === -1 ? 0 : activeClipIndex;
      const nextIndex =
        direction === -1 && activeClip && currentTime > getClipPlaybackStart(activeClip) + 0.25
          ? currentIndex
          : clamp(currentIndex + direction, 0, sortedClips.length - 1);
      const nextClip = sortedClips[nextIndex];
      if (!nextClip) return;

      const nextClipStart = getClipPlaybackStart(nextClip);
      currentTimeRef.current = nextClipStart;
      playbackAnchorRef.current = null;
      renderFrameAtTime(nextClipStart, false, true);
      onCurrentTimeChange(nextClipStart);
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
      pendingSeekDrawCleanupRef.current?.();
      pendingSeekDrawCleanupRef.current = null;
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
  preferredClipId?: string | null;
  /** Read ONCE at mount for a height carried over from a previous mount (e.g.
   *  the consumer toggled this pane off and back on). Returning a number makes
   *  the pane start there and SKIP the one-time fit — a height the user chose
   *  outranks the automatic one. A getter, not a value, so the consumer can
   *  keep it in a ref instead of re-rendering on every drag frame. */
  getInitialSurfaceHeight?: () => number | undefined;
  /** Fires whenever the surface height changes, so a consumer can remember it
   *  across unmounts. Store it in a ref: this fires per pointer move during a
   *  divider drag. */
  onSurfaceHeightChange?: (height: number) => void;
};

export function WorkbenchSplitPane({
  clips,
  currentTime,
  onCurrentTimeChange,
  children,
  preferredClipId,
  getInitialSurfaceHeight,
  onSurfaceHeightChange,
}: WorkbenchSplitPaneProps) {
  // Read once, at mount. `undefined` means nothing to restore → fit instead.
  const [restoredSurfaceHeight] = useState(() => getInitialSurfaceHeight?.());
  const [surfaceHeight, setSurfaceHeight] = useState(
    () => restoredSurfaceHeight ?? DEFAULT_SURFACE_HEIGHT,
  );
  const [isDividerDragging, setIsDividerDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLButtonElement | null>(null);
  const lowerPaneRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ pointerY: number; height: number } | null>(null);
  const clampFrameRef = useRef<number | null>(null);
  const didInitialSizeRef = useRef(false);

  const getViewportBoundaryBottom = useCallback(() => {
    const root = rootRef.current;
    const boundary = root?.closest("main") as HTMLElement | null;
    const boundaryBottom = boundary?.getBoundingClientRect().bottom ?? window.innerHeight;
    const drawerHeight = Number.parseFloat(
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--asset-library-height"),
    );
    const visibleViewportBottom =
      window.innerHeight - (Number.isFinite(drawerHeight) ? drawerHeight : 0);

    // A document-sized <main> can extend far below the viewport. Sticky
    // sizing must use the part that is visible now, while a genuinely
    // shorter embedding boundary should still win.
    return Math.min(boundaryBottom, visibleViewportBottom);
  }, []);

  const getManualMaxSurfaceHeight = useCallback(() => {
    if (typeof window === "undefined") {
      return DEFAULT_SURFACE_HEIGHT;
    }

    const root = rootRef.current;
    // Once the surface is stuck, its effective top is zero even though the
    // split-pane root continues moving above the viewport.
    const rootTop = Math.max(0, root?.getBoundingClientRect().top ?? 0);
    return Math.max(
      MIN_SURFACE_HEIGHT,
      getViewportBoundaryBottom() - rootTop - MIN_TIMELINE_SPACE,
    );
  }, [getViewportBoundaryBottom]);

  const clampSurfaceHeight = useCallback((height: number, maxHeight?: number) => {
    if (typeof window === "undefined") {
      return clamp(height, MIN_SURFACE_HEIGHT, DEFAULT_SURFACE_HEIGHT);
    }

    const maxFromViewport =
      maxHeight ?? getManualMaxSurfaceHeight();
    return clamp(height, MIN_SURFACE_HEIGHT, maxFromViewport);
  }, [getManualMaxSurfaceHeight]);

  /**
   * The height the surface OPENS at: a flat third of the viewport.
   *
   * This deliberately replaces a measure-and-fill pass that took whatever
   * space the lower pane left over. That produced a surface whose opening
   * size depended on how much content happened to be below it — a tall
   * timeline opened a squashed preview, a nearly empty one opened a giant
   * preview, and neither proportion was one anybody chose. A fixed fraction
   * is predictable, and the moment the user drags the divider their height
   * takes over for good (see the restore path in the mount effect).
   */
  const initialSurfaceHeight = useCallback(() => {
    if (dragStartRef.current) return;
    if (typeof window === "undefined") return;

    const divider = dividerRef.current;
    if (!divider) return;

    const dividerHeight = divider.getBoundingClientRect().height;
    // A third of what the user can actually SEE, not of a <main> that may
    // run far below the fold — getViewportBoundaryBottom already resolves
    // that, and measuring from the root's top keeps the fraction honest
    // when the board sits below other chrome.
    const rootTop = Math.max(0, rootRef.current?.getBoundingClientRect().top ?? 0);
    const availableHeight = getViewportBoundaryBottom() - rootTop;
    const maxSurfaceHeight = Math.max(MIN_SURFACE_HEIGHT, availableHeight - dividerHeight);
    const nextHeight = clampSurfaceHeight(availableHeight / 3, maxSurfaceHeight);

    setSurfaceHeight((height) =>
      Math.abs(height - nextHeight) < 0.5 ? height : nextHeight,
    );
  }, [clampSurfaceHeight, getViewportBoundaryBottom]);

  /** Keep the current height LEGAL for the viewport without re-deriving it —
   *  a shrinking window may force it down, nothing else does. */
  const clampToViewport = useCallback(() => {
    if (dragStartRef.current) return;
    setSurfaceHeight((height) => {
      const next = clampSurfaceHeight(height);
      return Math.abs(height - next) < 0.5 ? height : next;
    });
  }, [clampSurfaceHeight]);

  const scheduleClamp = useCallback(() => {
    if (clampFrameRef.current !== null || typeof window === "undefined") return;

    clampFrameRef.current = window.requestAnimationFrame(() => {
      clampFrameRef.current = null;
      clampToViewport();
    });
  }, [clampToViewport]);

  useLayoutEffect(() => {
    // Size ONCE on mount. After that the height belongs to the user: only a
    // divider drag changes it, and a shrinking viewport may clamp it.
    if (!didInitialSizeRef.current) {
      didInitialSizeRef.current = true;
      if (restoredSurfaceHeight !== undefined) clampToViewport();
      else initialSurfaceHeight();
    }

    const root = rootRef.current;
    const boundary = root?.closest("main") as HTMLElement | null;
    // Observe the viewport boundary ONLY, and only to clamp. Watching the
    // lower pane here is what used to shrink the surface whenever the content
    // below it grew — expanding a sub-graph folder stole preview height.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleClamp);
    if (observer && boundary) observer.observe(boundary);

    window.addEventListener("resize", scheduleClamp);
    window.visualViewport?.addEventListener("resize", scheduleClamp);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleClamp);
      window.visualViewport?.removeEventListener("resize", scheduleClamp);
      if (clampFrameRef.current !== null) {
        window.cancelAnimationFrame(clampFrameRef.current);
        clampFrameRef.current = null;
      }
    };
  }, [initialSurfaceHeight, clampToViewport, scheduleClamp, restoredSurfaceHeight]);

  // Report the height so a consumer can restore it after an unmount.
  useEffect(() => {
    onSurfaceHeightChange?.(surfaceHeight);
  }, [surfaceHeight, onSurfaceHeightChange]);

  const handleDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDividerDragging(true);
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
    setIsDividerDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div
      ref={rootRef}
      // minmax(0,1fr): a bare auto track sizes to its items' MIN-CONTENT,
      // and a virtualized child timeline (whose scroll container reports its
      // full content width there) would blow the track — and the preview
      // surface with it — past the viewport. Capping the track keeps both
      // panes at the container's width; children overflow-scroll inside it.
      className="grid min-h-0 w-full grid-cols-[minmax(0,1fr)] gap-0"
      data-testid="workbench-split-pane"
      // The sticky preview region's height (surface + divider), published so a
      // descendant that wants to pin BELOW it — e.g. a sticky board header —
      // has a live offset to stick to as the divider resizes. Absent when the
      // preview is closed (this component isn't mounted then), so consumers
      // fall back to 0.
      style={
        {
          "--workbench-preview-offset": `${surfaceHeight + DIVIDER_HEIGHT_PX}px`,
        } as React.CSSProperties
      }
    >
      <div
        // z-40 (above the strip's z-30 consumer overlay) so a playhead marker
        // in a timeline scrolling underneath is occluded by the sticky
        // preview, not painted over it. At z-30 the marker tied the preview
        // and, being later in the DOM, bled through into the preview area.
        className="sticky top-0 z-40 min-w-0 bg-zinc-950"
        data-testid="workbench-preview-region"
      >
        <div
          className={cn(
            "min-h-0",
            !isDividerDragging &&
              "transition-[height] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          )}
          style={{
            height: `${surfaceHeight}px`,
            minHeight: `${MIN_SURFACE_HEIGHT}px`,
          }}
        >
          <WorkbenchDisplaySurface
            clips={clips}
            currentTime={currentTime}
            onCurrentTimeChange={onCurrentTimeChange}
            preferredClipId={preferredClipId}
            className="h-full"
          />
        </div>
        <button
          ref={dividerRef}
          type="button"
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={MIN_SURFACE_HEIGHT}
          aria-valuenow={Math.round(surfaceHeight)}
          aria-label="Resize workbench display"
          // The divider's OWN height is the only source of the gap on either
          // side of the rule: it centres the 1px line, so the space above and
          // below is h/2 each (h-3 — kept in sync with DIVIDER_HEIGHT_PX).
          // Nothing else may add padding against it — the lower pane used to
          // carry a pt-3 that made the bottom gap 22px against the top's
          // 10px, which read as a misaligned rule. Affordance: a centred
          // grip pill says "draggable" at rest, and hovering tints the whole
          // band gray (the old amber line highlight is gone; focus ring is
          // sky, matching the seek rails).
          className="group relative flex h-3 w-full cursor-row-resize items-center justify-center bg-transparent transition-colors hover:bg-zinc-800/70 active:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 focus-visible:outline-offset-2"
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onPointerCancel={handleDividerPointerUp}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-zinc-800"
          />
          <span
            aria-hidden="true"
            data-divider-grip
            className="relative h-1 w-10 rounded-full bg-zinc-600 transition-colors group-hover:bg-zinc-400 group-active:bg-zinc-300"
          />
        </button>
      </div>
      <div ref={lowerPaneRef} className="min-h-0">
        {children}
      </div>
    </div>
  );
}
