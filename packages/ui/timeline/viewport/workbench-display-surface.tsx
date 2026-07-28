"use client";

import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
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
import {
  clipContainsPlaybackTime,
  getClipPlaybackDuration,
  getClipPlaybackStart,
  getContainingClip,
  getTimelineDuration,
  nextPlayableTime,
} from "./playback-skip";

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

type PlaybackSurfaceRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CanvasPointEvent = {
  clientX: number;
  clientY: number;
  currentTarget: HTMLCanvasElement;
};

type WorkbenchDisplaySurfaceProps = {
  clips: TimelineClip[];
  currentTime: number;
  onCurrentTimeChange: (time: number) => void;
  className?: string;
  preferredClipId?: string | null;
  /** Controlled playback. When supplied, the surface plays iff this is true and
   *  reports intent through `onPlayingChange` (the play button and the
   *  end-of-timeline auto-stop call it) instead of holding play state itself.
   *  Omit for the default uncontrolled behavior (internal play state). */
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  /** When supplied, the surface renders a close affordance in its top-right
   *  corner. Omit and no button is drawn — a consumer that has no way to hide
   *  the preview must not show one. */
  onClose?: () => void;
};

const BUFFER_WINDOW_SIZE = 4;
const DEFAULT_SURFACE_HEIGHT = 380;
const MIN_SURFACE_HEIGHT = 120;
const MIN_TIMELINE_SPACE = 260;
/** The resize divider's own height (Tailwind h-3). The transport is centered
 *  on this stable track and may overhang it without changing layout. */
const DIVIDER_HEIGHT_PX = 12;

type WorkbenchDividerTransportProps = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  canPlay: boolean;
  canSeekPrevious: boolean;
  canSeekNext: boolean;
  previewHovered: boolean;
  onTogglePlaying: () => void;
  onSeekPrevious: () => void;
  onSeekNext: () => void;
};

function WorkbenchDividerTransport({
  currentTime,
  duration,
  isPlaying,
  canPlay,
  canSeekPrevious,
  canSeekNext,
  previewHovered,
  onTogglePlaying,
  onSeekPrevious,
  onSeekNext,
}: WorkbenchDividerTransportProps) {
  return (
    <div
      role="group"
      aria-label="Preview transport"
      className="pointer-events-none absolute inset-x-0 top-full z-50 h-0"
      data-testid="workbench-preview-controls"
      data-transport-layout="static"
    >
      <div
        className="pointer-events-auto absolute left-1/2 flex h-11 w-[8.25rem] items-center justify-center"
        data-transport-button-group
        style={{ top: DIVIDER_HEIGHT_PX / 2, transform: "translate(-50%, -50%)" }}
        onPointerDown={(event) => {
          // The transport visually occupies the divider, but remains its own
          // interaction island. A transport press must never begin a resize.
          event.stopPropagation();
        }}
      >
        <button
          type="button"
          onClick={onSeekPrevious}
          disabled={!canSeekPrevious}
          className="group/previous relative z-10 grid size-11 shrink-0 place-items-center text-zinc-400 transition-colors hover:text-white focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Previous workbench clip"
          title="Previous clip"
        >
          <span className="grid size-5 translate-x-2 place-items-center rounded-full transition-colors group-focus-visible/previous:ring-2 group-focus-visible/previous:ring-sky-400 group-focus-visible/previous:ring-offset-2 group-focus-visible/previous:ring-offset-zinc-950">
            <SkipBack className="size-3 fill-current" />
          </span>
        </button>

        <button
          type="button"
          onClick={onTogglePlaying}
          disabled={!canPlay}
          className="group/play relative z-10 grid size-11 shrink-0 place-items-center text-zinc-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={isPlaying ? "Pause workbench preview" : "Play workbench preview"}
          title={isPlaying ? "Pause" : "Play"}
        >
          <span
            className={cn(
              "grid size-5 place-items-center rounded-full transition-colors group-hover/play:text-white group-focus-visible/play:ring-2 group-focus-visible/play:ring-sky-400 group-focus-visible/play:ring-offset-2 group-focus-visible/play:ring-offset-zinc-950",
              previewHovered && "text-white",
            )}
            data-transport-primary-control
          >
            {isPlaying ? (
              <Pause className="size-2.5 fill-current" />
            ) : (
              <Play className="ml-0.5 size-2.5 fill-current" />
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={onSeekNext}
          disabled={!canSeekNext}
          className="group/next relative z-10 grid size-11 shrink-0 place-items-center text-zinc-400 transition-colors hover:text-white focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Next workbench clip"
          title="Next clip"
        >
          <span className="grid size-5 -translate-x-2 place-items-center rounded-full transition-colors group-focus-visible/next:ring-2 group-focus-visible/next:ring-sky-400 group-focus-visible/next:ring-offset-2 group-focus-visible/next:ring-offset-zinc-950">
            <SkipForward className="size-3 fill-current" />
          </span>
        </button>
      </div>

      <span
        className="absolute right-3 max-w-[calc(50%_-_5rem)] overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-zinc-900/90 px-2 py-0.5 font-mono text-[10px] text-zinc-400 shadow-sm"
        aria-label={`Preview time ${formatSeconds(currentTime)} of ${formatSeconds(duration)}`}
        data-testid="workbench-preview-time"
        style={{ top: DIVIDER_HEIGHT_PX / 2, transform: "translateY(-50%)" }}
      >
        <span className="sm:hidden">{formatSeconds(currentTime)}</span>
        <span className="hidden sm:inline">
          {formatSeconds(currentTime)} / {formatSeconds(duration)}
        </span>
      </span>
    </div>
  );
}

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

// getClipPlaybackStart / getClipPlaybackDuration / clipContainsPlaybackTime /
// getContainingClip / getTimelineDuration now live in ./playback-skip, beside
// the skip rule that reads them — pure, and unit-tested without React.

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

// normalizePlaybackTime is `nextPlayableTime` (./playback-skip): it decides
// whether the clock needs snapping forward to material that will actually be
// drawn — over a gap, or over a DISABLED clip's whole span. Deliberately not
// getActiveClip, which answers "what should the surface draw" and holds a
// frame across gaps, making every gap look like a legitimate resting place.

export function WorkbenchDisplaySurface({
  clips,
  currentTime,
  onCurrentTimeChange,
  className,
  preferredClipId,
  playing,
  onPlayingChange,
  onClose,
}: WorkbenchDisplaySurfaceProps) {
  const { getCollectionClipFramePreview } = useTimelineDocuments();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackSurfaceRectRef = useRef<PlaybackSurfaceRect | null>(null);
  const cacheRef = useRef(new Map<string, CachedMedia>());
  const activeMediaRef = useRef<DisplayMedia | null>(null);
  const activeClipDisabledRef = useRef(false);
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
  // Controlled when `playing` is supplied; otherwise the surface owns the state
  // (the default, preserving every existing consumer's behavior).
  const isControlledPlayback = playing !== undefined;
  const [uncontrolledPlaying, setUncontrolledPlaying] = useState(false);
  const [previewHovered, setPreviewHovered] = useState(false);
  const isPlaying = playing ?? uncontrolledPlaying;
  const setPlaying = useCallback(
    (next: boolean) => {
      if (isControlledPlayback) onPlayingChange?.(next);
      else setUncontrolledPlaying(next);
    },
    [isControlledPlayback, onPlayingChange],
  );

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
    const left = (cssWidth - width) / 2;
    const top = (cssHeight - height) / 2;
    playbackSurfaceRectRef.current = { left, top, width, height };
    canvas.dataset.previewPlaybackSurfaceReady = "true";

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, cssWidth, cssHeight);
    // A disabled clip is reachable only by scrubbing, and it draws GRAYED so
    // the frame reads as "here, but not in the cut" — the same grayscale the
    // card wears on the board, on the same content. Filter is set around the
    // one drawImage and reset immediately: the backdrop fill above must stay
    // its true black, and a leaked filter would tint the next frame drawn.
    if (activeClipDisabledRef.current) context.filter = "grayscale(1) opacity(0.45)";
    context.drawImage(drawable, left, top, width, height);
    context.filter = "none";
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
    playbackSurfaceRectRef.current = null;
    canvas.dataset.previewPlaybackSurfaceReady = "false";
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
    // A REF, not a draw argument: `drawDrawable` is reached from half a dozen
    // async listeners (image load, video seeked/loadeddata) that have no idea
    // which clip they belong to. Setting it here — the one place the active
    // clip is resolved — makes every one of those redraws inherit the right
    // treatment.
    //
    // Only reachable while SCRUBBING: playing snaps the clock out of a
    // disabled span before anything is drawn (see nextPlayableTime).
    activeClipDisabledRef.current = active?.disabled === true;

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
    const startTime = nextPlayableTime(clipsRef.current, currentTimeRef.current, durationRef.current);
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
      const nextTime = nextPlayableTime(clipsRef.current, rawTime, durationRef.current);
      if (Math.abs(nextTime - rawTime) > 0.001) {
        resetAnchor(nextTime, now);
      }

      currentTimeRef.current = nextTime;
      renderFrameAtTime(nextTime, true);
      publishTime(nextTime, now);

      if (nextTime >= durationRef.current) {
        publishTime(durationRef.current, now, true);
        renderFrameAtTime(durationRef.current, false, true);
        setPlaying(false);
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
  }, [isPlaying, onCurrentTimeChange, renderFrameAtTime, setPlaying]);

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

  const isPointerOverPlaybackSurface = useCallback(
    (event: CanvasPointEvent) => {
      const playbackSurface = playbackSurfaceRectRef.current;
      if (!canPlay || !playbackSurface) return false;

      const canvasBounds = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - canvasBounds.left;
      const pointerY = event.clientY - canvasBounds.top;
      return (
        pointerX >= playbackSurface.left &&
        pointerX <= playbackSurface.left + playbackSurface.width &&
        pointerY >= playbackSurface.top &&
        pointerY <= playbackSurface.top + playbackSurface.height
      );
    },
    [canPlay],
  );

  return (
    <section
      aria-label="Workbench display surface"
      className={cn(
        "relative flex min-h-0 flex-col overflow-visible rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl",
        className,
      )}
      data-testid="workbench-display-surface"
      data-buffered-media-count={bufferedMedia.length}
      data-preview-playing={isPlaying}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[inherit] bg-black">
        <canvas
          ref={canvasRef}
          className={cn(
            "block h-full w-full bg-black",
            previewHovered ? "cursor-pointer" : "cursor-default",
          )}
          role="img"
          aria-label={activeMedia ? `${activeMedia.clipTitle} preview` : "Empty workbench preview"}
          data-testid="workbench-display-canvas"
          data-preview-playback-shortcut={canPlay}
          onPointerEnter={(event) => {
            setPreviewHovered(isPointerOverPlaybackSurface(event));
          }}
          onPointerMove={(event) => {
            const nextHovered = isPointerOverPlaybackSurface(event);
            setPreviewHovered((wasHovered) =>
              wasHovered === nextHovered ? wasHovered : nextHovered,
            );
          }}
          onPointerLeave={() => setPreviewHovered(false)}
          onClick={(event) => {
            if (isPointerOverPlaybackSurface(event)) setPlaying(!isPlaying);
          }}
        />
        {/* Names what the grayed frame means. Only ever visible while
            SCRUBBING — playing jumps the span, so the clock never rests here.
            Top-LEFT: the close button owns the right corner. */}
        {activeClip?.disabled === true && (
          <span
            className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold tracking-[0.08em] text-amber-300 ring-1 ring-amber-400/40"
            data-testid="workbench-display-disabled"
          >
            DISABLED
          </span>
        )}
        {/* Second way out of the preview, next to the sidebar's toggle. Pinned
            to the canvas's far-right corner, which is LETTERBOX: the frame is
            drawn centred at `min` scale, so this sits in the black gutter
            rather than over the picture. */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-400 backdrop-blur-sm transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 focus-visible:outline-offset-2"
            aria-label="Close preview"
            title="Close preview"
            data-testid="workbench-preview-close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <WorkbenchDividerTransport
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        canPlay={canPlay}
        canSeekPrevious={canSeekPrevious}
        canSeekNext={canSeekNext}
        previewHovered={canPlay && previewHovered}
        onTogglePlaying={() => setPlaying(!isPlaying)}
        onSeekPrevious={() => seekToClip(-1)}
        onSeekNext={() => seekToClip(1)}
      />
    </section>
  );
}

type WorkbenchSplitPaneProps = {
  /**
   * Upper-pane content. Pass `null` to close it while keeping the lower pane
   * mounted, preserving stateful content such as a virtual strip's scroll.
   */
  surface: ReactNode | null;
  children: ReactNode;
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
  surface,
  children,
  getInitialSurfaceHeight,
  onSurfaceHeightChange,
}: WorkbenchSplitPaneProps) {
  const hasSurface = surface !== null;
  // Read once, at mount. `undefined` means nothing to restore → fit instead.
  const [restoredSurfaceHeight] = useState(() => getInitialSurfaceHeight?.());
  const [surfaceHeight, setSurfaceHeight] = useState(
    () => restoredSurfaceHeight ?? DEFAULT_SURFACE_HEIGHT,
  );
  const [isDividerDragging, setIsDividerDragging] = useState(false);
  // False until the opening height has been measured AND painted (see the
  // double-rAF below), so the pane appears at its size instead of animating
  // into it.
  const [heightAnimated, setHeightAnimated] = useState(false);
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

  // Arm the height transition only once the opening size has been painted.
  // The sizing pass below runs in a layout effect and its inputs (the
  // divider's box, the viewport boundary, the asset-drawer variable) settle
  // over the first frames, so the height can land a frame or two after the
  // first paint — late enough for the browser to have a before-change style
  // and animate the difference. Two frames is "after the next paint" without
  // guessing at a duration.
  useEffect(() => {
    if (!hasSurface) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setHeightAnimated(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [hasSurface]);

  useLayoutEffect(() => {
    // Size ONCE, when the surface first opens. The split pane itself may have
    // mounted earlier with only its lower pane so that the lower content keeps
    // its DOM identity and scroll position across this toggle.
    if (hasSurface && !didInitialSizeRef.current) {
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
  }, [
    initialSurfaceHeight,
    clampToViewport,
    scheduleClamp,
    restoredSurfaceHeight,
    hasSurface,
  ]);

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
      // has a live offset to stick to as the divider resizes. The split pane
      // remains mounted while closed, so publish an explicit zero then.
      style={
        {
          "--workbench-preview-offset": hasSurface
            ? `${surfaceHeight + DIVIDER_HEIGHT_PX}px`
            : "0px",
        } as React.CSSProperties
      }
    >
      {hasSurface ? (
        <div
        // z-40 (above the strip's z-30 consumer overlay) so a playhead marker
        // in a timeline scrolling underneath is occluded by the sticky
        // preview, not painted over it. At z-30 the marker tied the preview
        // and, being later in the DOM, bled through into the preview area.
        className="sticky top-0 z-40 min-w-0 overflow-visible bg-zinc-950"
        data-testid="workbench-preview-region"
      >
        {/* A seek thumb is intentionally centered on the timeline edge, so
            half of it sits outside the split pane. These narrow side masks
            hide that overhang only while it passes BEHIND the sticky preview.
            Clipping the split pane itself also cut the thumb off after it
            scrolled below the preview, where it should be fully visible. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-full w-2 bg-zinc-950"
          data-preview-edge-occluder="start"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-full w-2 bg-zinc-950"
          data-preview-edge-occluder="end"
        />
        <div
          className={cn(
            "min-h-0",
            // The transition is for LATER height changes (a shrinking
            // viewport clamping the pane). It must not run against the
            // mount-time sizing pass, which starts from a placeholder height
            // and measures the real one — that played as a visible shrink
            // every first open, and only the first, since a reopen restores
            // the remembered height and never re-measures.
            heightAnimated &&
              !isDividerDragging &&
              "transition-[height] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          )}
          style={{
            height: `${surfaceHeight}px`,
            minHeight: `${MIN_SURFACE_HEIGHT}px`,
          }}
          >
            {surface}
          </div>
        <button
          ref={dividerRef}
          type="button"
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={MIN_SURFACE_HEIGHT}
          aria-valuenow={Math.round(surfaceHeight)}
          aria-label="Resize workbench display"
          // The divider keeps a 12px interaction track while its one-pixel
          // centerline runs directly through the transport controls.
          className="group relative block h-3 w-full cursor-row-resize bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 focus-visible:outline-offset-2"
          data-workbench-divider
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onPointerCancel={handleDividerPointerUp}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-zinc-800 transition-colors group-hover:bg-zinc-600 group-active:bg-zinc-500"
            data-divider-line
          />
        </button>
        </div>
      ) : null}
      {/* Keep every lower-pane layer in one z-0 stacking context. Virtual
          strips intentionally use z-50 for local overlays; without this
          boundary those later layers could cover the transport where it
          grows below the divider. */}
      <div
        ref={lowerPaneRef}
        className="relative z-0 min-h-0 isolate"
        data-testid="workbench-lower-pane"
      >
        {children}
      </div>
    </div>
  );
}
