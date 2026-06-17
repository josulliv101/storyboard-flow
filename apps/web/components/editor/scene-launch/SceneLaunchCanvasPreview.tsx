'use client';

import React from 'react';
import { Grid2X2 } from 'lucide-react';

import type { SceneLaunchMediaItem } from './useSceneLaunchBoard';

type SceneLaunchCanvasPreviewProps = {
  media: SceneLaunchMediaItem | null;
  previewTimeSeconds: number;
  isPlaying: boolean;
  isVisible: boolean;
  getPlaybackSnapshot?: () => SceneLaunchCanvasPreviewSnapshot | null;
};

export type SceneLaunchCanvasPreviewSnapshot = {
  media: SceneLaunchMediaItem | null;
  previewTimeSeconds: number;
};

type CanvasPreviewVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: unknown) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

type CanvasPreviewDebugStats = {
  canvasFps: number;
  videoFps: number | null;
  reactFps: number;
  drawMs: number;
  driftSeconds: number;
  readyState: number;
  paused: boolean;
  playback: 'idle' | 'playing' | 'blocked' | 'paused';
  rvfc: boolean;
  backingWidth: number;
  backingHeight: number;
  sourceType: 'none' | 'image' | 'video';
};

const drawContainedMedia = (
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number
) => {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  if (sourceWidth <= 0 || sourceHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return false;
  }

  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = (canvasWidth - drawWidth) / 2;
  const drawY = (canvasHeight - drawHeight) / 2;

  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  return true;
};

export function SceneLaunchCanvasPreview({
  media,
  previewTimeSeconds,
  isPlaying,
  isVisible,
  getPlaybackSnapshot,
}: SceneLaunchCanvasPreviewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const activeMediaRef = React.useRef<SceneLaunchMediaItem | null>(null);
  const activeMediaKeyRef = React.useRef<string | null>(null);
  const cleanupActiveMediaRef = React.useRef<(() => void) | null>(null);
  const fallbackMediaRef = React.useRef<SceneLaunchMediaItem | null>(media);
  const fallbackPreviewTimeRef = React.useRef(previewTimeSeconds);
  const getPlaybackSnapshotRef = React.useRef<typeof getPlaybackSnapshot>(getPlaybackSnapshot);

  const animationFrameRef = React.useRef<number | null>(null);
  const videoFrameCallbackRef = React.useRef<number | null>(null);
  const videoFrameCallbackOwnerRef = React.useRef<CanvasPreviewVideo | null>(null);
  const drawFrameRef = React.useRef<(() => void) | null>(null);

  const previewTimeRef = React.useRef(previewTimeSeconds);
  const playbackStateRef = React.useRef<'idle' | 'playing' | 'blocked' | 'paused'>('idle');

  const hasDrawnFrameRef = React.useRef(false);
  const canvasFrameCountRef = React.useRef(0);
  const videoFrameCountRef = React.useRef(0);
  const reactUpdateCountRef = React.useRef(0);

  const lastDrawMsRef = React.useRef(0);
  const driftSecondsRef = React.useRef(0);
  const readyStateRef = React.useRef(0);

  const [showDebugStats, setShowDebugStats] = React.useState(false);
  const [debugStats, setDebugStats] = React.useState<CanvasPreviewDebugStats>({
    canvasFps: 0,
    videoFps: null,
    reactFps: 0,
    drawMs: 0,
    driftSeconds: 0,
    readyState: 0,
    paused: true,
    playback: 'idle',
    rvfc: false,
    backingWidth: 0,
    backingHeight: 0,
    sourceType: 'none',
  });

  React.useEffect(() => {
    fallbackMediaRef.current = media;
    fallbackPreviewTimeRef.current = previewTimeSeconds;
    getPlaybackSnapshotRef.current = getPlaybackSnapshot;
  }, [getPlaybackSnapshot, media, previewTimeSeconds]);

  const getCurrentSnapshot = React.useCallback((): SceneLaunchCanvasPreviewSnapshot => {
    const snapshot = getPlaybackSnapshotRef.current?.();
    return snapshot ?? {
      media: fallbackMediaRef.current,
      previewTimeSeconds: fallbackPreviewTimeRef.current,
    };
  }, []);

  const getMediaKey = React.useCallback((item: SceneLaunchMediaItem | null) => (
    item ? `${item.type}:${item.id}:${item.previewUrl}` : null
  ), []);

  const getMediaTrimRange = React.useCallback((item: SceneLaunchMediaItem) => {
    const sourceDuration = item.mediaDurationSeconds ?? item.durationSeconds ?? 3;
    const start = Math.max(0, item.trimStartSeconds ?? 0);
    const fallbackDuration = Math.max(0.5, sourceDuration - start);
    const requestedDuration = item.durationSeconds ?? fallbackDuration;
    const duration = Math.max(0.5, Math.min(requestedDuration, Math.max(0.5, sourceDuration - start)));

    return {
      start,
      end: start + duration,
    };
  }, []);

  React.useEffect(() => {
    const previousPreviewTime = previewTimeRef.current;
    const snapshot = getCurrentSnapshot();
    previewTimeRef.current = snapshot.previewTimeSeconds;
    reactUpdateCountRef.current += 1;

    if (!snapshot.media || snapshot.media.type !== 'video' || !isVisible) {
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const trimRange = getMediaTrimRange(snapshot.media);
    const targetTime = Math.max(
      trimRange.start,
      Math.min(trimRange.end - 0.001, snapshot.previewTimeSeconds)
    );
    const didLoopBack = snapshot.previewTimeSeconds + 0.05 < previousPreviewTime;
    const isOutsideTrimRange =
      video.currentTime < trimRange.start - 0.05 ||
      video.currentTime >= trimRange.end;
    const drift = Math.abs(video.currentTime - targetTime);
    const shouldSeek =
      video.readyState >= HTMLMediaElement.HAVE_METADATA &&
      Number.isFinite(targetTime) &&
      (didLoopBack || isOutsideTrimRange || drift > (isPlaying ? 0.45 : 0.05));

    if (shouldSeek) {
      video.currentTime = targetTime;
    }

    if (isPlaying && (video.paused || video.ended)) {
      playbackStateRef.current = 'playing';
      video.play().catch(() => {
        playbackStateRef.current = 'blocked';
      });
    }

    requestAnimationFrame(() => drawFrameRef.current?.());
  }, [previewTimeSeconds, media, isPlaying, isVisible, getCurrentSnapshot, getMediaTrimRange]);

  React.useEffect(() => {
    const shouldShowStats =
      process.env.NODE_ENV !== 'production' ||
      new URLSearchParams(window.location.search).get('debugPreview') === '1';

    setShowDebugStats(shouldShowStats);
  }, []);

  React.useEffect(() => {
    if (!showDebugStats) return;

    let lastSampleTime = performance.now();
    let lastCanvasCount = canvasFrameCountRef.current;
    let lastVideoCount = videoFrameCountRef.current;
    let lastReactCount = reactUpdateCountRef.current;

    const sampleId = window.setInterval(() => {
      const now = performance.now();
      const elapsedSeconds = Math.max(0.001, (now - lastSampleTime) / 1000);

      const canvasCount = canvasFrameCountRef.current;
      const videoCount = videoFrameCountRef.current;
      const reactCount = reactUpdateCountRef.current;
      const canvas = canvasRef.current;
      const video = videoRef.current as CanvasPreviewVideo | null;

      setDebugStats({
        canvasFps: (canvasCount - lastCanvasCount) / elapsedSeconds,
        videoFps: video?.requestVideoFrameCallback
          ? (videoCount - lastVideoCount) / elapsedSeconds
          : null,
        reactFps: (reactCount - lastReactCount) / elapsedSeconds,
        drawMs: lastDrawMsRef.current,
        driftSeconds: driftSecondsRef.current,
        readyState: readyStateRef.current,
        paused: video?.paused ?? true,
        playback: playbackStateRef.current,
        rvfc: !!video?.requestVideoFrameCallback,
        backingWidth: canvas?.width ?? 0,
        backingHeight: canvas?.height ?? 0,
        sourceType: activeMediaRef.current?.type ?? 'none',
      });

      lastSampleTime = now;
      lastCanvasCount = canvasCount;
      lastVideoCount = videoCount;
      lastReactCount = reactCount;
    }, 500);

    return () => window.clearInterval(sampleId);
  }, [media?.type, showDebugStats]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      const rawWidth = Math.max(1, Math.round(rect.width * dpr));
      const rawHeight = Math.max(1, Math.round(rect.height * dpr));

      const maxPreviewPixels = 1920 * 1080;
      const scale = Math.min(1, Math.sqrt(maxPreviewPixels / (rawWidth * rawHeight)));

      const width = Math.max(1, Math.round(rawWidth * scale));
      const height = Math.max(1, Math.round(rawHeight * scale));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        requestAnimationFrame(() => drawFrameRef.current?.());
      }
    };

    resizeCanvas();

    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);

    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false });

    if (!canvas || !context) return;

    const cancelAnimation = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      const video = videoFrameCallbackOwnerRef.current;

      if (videoFrameCallbackRef.current !== null && video?.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(videoFrameCallbackRef.current);
      }

      videoFrameCallbackRef.current = null;
      videoFrameCallbackOwnerRef.current = null;
    };

    const ensureMediaSource = (nextMedia: SceneLaunchMediaItem | null) => {
      const nextKey = getMediaKey(nextMedia);
      if (nextKey === activeMediaKeyRef.current) return;

      cleanupActiveMediaRef.current?.();
      cleanupActiveMediaRef.current = null;
      activeMediaKeyRef.current = nextKey;
      activeMediaRef.current = nextMedia;
      videoRef.current = null;
      imageRef.current = null;
      cancelAnimation();

      if (!nextMedia) return;

      if (nextMedia.type === 'video') {
        const video = document.createElement('video');
        video.src = nextMedia.previewUrl;
        video.muted = true;
        video.defaultMuted = true;
        video.loop = false;
        video.playsInline = true;
        video.preload = 'auto';

        const drawLoadedFrame = () => drawFrameRef.current?.();
        const seekToCurrentPreviewTime = () => {
          const trimRange = getMediaTrimRange(nextMedia);
          const targetTime = Math.max(
            trimRange.start,
            Math.min(trimRange.end - 0.001, previewTimeRef.current)
          );
          if (
            video.readyState >= HTMLMediaElement.HAVE_METADATA &&
            Number.isFinite(targetTime) &&
            Math.abs(video.currentTime - targetTime) > 0.02
          ) {
            video.currentTime = targetTime;
          }
        };

        video.addEventListener('loadedmetadata', seekToCurrentPreviewTime);
        video.addEventListener('loadeddata', drawLoadedFrame);
        video.addEventListener('canplay', drawLoadedFrame);
        video.addEventListener('seeked', drawLoadedFrame);
        videoRef.current = video;

        if (isPlaying) {
          playbackStateRef.current = 'playing';
          video.play().catch(() => {
            playbackStateRef.current = 'blocked';
          });
        }

        cleanupActiveMediaRef.current = () => {
          video.removeEventListener('loadedmetadata', seekToCurrentPreviewTime);
          video.removeEventListener('loadeddata', drawLoadedFrame);
          video.removeEventListener('canplay', drawLoadedFrame);
          video.removeEventListener('seeked', drawLoadedFrame);
          video.pause();
          video.removeAttribute('src');
          video.load();
          if (videoRef.current === video) {
            videoRef.current = null;
          }
        };

        return;
      }

      const image = new Image();
      const drawLoadedFrame = () => drawFrameRef.current?.();
      image.addEventListener('load', drawLoadedFrame);
      image.src = nextMedia.previewUrl;
      imageRef.current = image;

      cleanupActiveMediaRef.current = () => {
        image.removeEventListener('load', drawLoadedFrame);
        if (imageRef.current === image) {
          imageRef.current = null;
        }
      };
    };

    const drawEmpty = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawFrame = () => {
      const snapshot = getCurrentSnapshot();
      const snapshotMedia = snapshot.media;
      previewTimeRef.current = snapshot.previewTimeSeconds;
      ensureMediaSource(snapshotMedia);

      if (!snapshotMedia || !isVisible) {
        drawEmpty();
        hasDrawnFrameRef.current = false;
        return;
      }

      if (snapshotMedia.type === 'image') {
        const image = imageRef.current;

        readyStateRef.current = image?.complete ? 4 : 0;

        if (image?.complete && image.naturalWidth > 0) {
          const drawStart = performance.now();

          const didDraw = drawContainedMedia(
            context,
            image,
            image.naturalWidth,
            image.naturalHeight,
            canvas.width,
            canvas.height
          );

          if (didDraw) {
            canvasFrameCountRef.current += 1;
            lastDrawMsRef.current = performance.now() - drawStart;
            hasDrawnFrameRef.current = true;
          }
        }

        /**
         * Do not draw black if the new image is not ready.
         * Keep the previous canvas frame.
         */
        return;
      }

      const video = videoRef.current;

      if (!video) {
        readyStateRef.current = 0;

        /**
         * Do not draw black during video replacement.
         * Keep previous frame to prevent flicker.
         */
        return;
      }

      readyStateRef.current = video.readyState;

      const targetTime = previewTimeRef.current;
      driftSecondsRef.current = Number.isFinite(targetTime)
        ? video.currentTime - targetTime
        : 0;
      const trimRange = getMediaTrimRange(snapshotMedia);

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        if (video.currentTime < trimRange.start - 0.05 || video.currentTime >= trimRange.end) {
          video.currentTime = Number.isFinite(targetTime)
            ? Math.max(trimRange.start, Math.min(trimRange.end - 0.001, targetTime))
            : trimRange.start;
          if (isPlaying && (video.paused || video.ended)) {
            playbackStateRef.current = 'playing';
            video.play().catch(() => {
              playbackStateRef.current = 'blocked';
            });
          }
          requestAnimationFrame(() => drawFrameRef.current?.());
          return;
        }

        const drawStart = performance.now();

        const didDraw = drawContainedMedia(
          context,
          video,
          video.videoWidth,
          video.videoHeight,
          canvas.width,
          canvas.height
        );

        if (didDraw) {
          canvasFrameCountRef.current += 1;
          lastDrawMsRef.current = performance.now() - drawStart;
          hasDrawnFrameRef.current = true;
        }
      }

      /**
       * Do not draw black if video is not ready yet.
       * This is the main black-flicker fix.
       */
    };

    drawFrameRef.current = drawFrame;

    const renderRafLoop = () => {
      drawFrame();
      animationFrameRef.current = requestAnimationFrame(renderRafLoop);
    };

    const renderVideoFrameLoop = () => {
      const video = videoRef.current as CanvasPreviewVideo | null;

      if (!video || videoFrameCallbackOwnerRef.current !== video) {
        videoFrameCallbackRef.current = null;
        videoFrameCallbackOwnerRef.current = null;
        return;
      }

      videoFrameCountRef.current += 1;
      drawFrame();

      const nextVideo = videoRef.current as CanvasPreviewVideo | null;

      if (nextVideo?.requestVideoFrameCallback && isVisible && isPlaying) {
        videoFrameCallbackOwnerRef.current = nextVideo;
        videoFrameCallbackRef.current =
          nextVideo.requestVideoFrameCallback(renderVideoFrameLoop);
      }
    };

    cancelAnimation();
    drawFrame();

    if (activeMediaRef.current?.type === 'video' && isVisible && isPlaying) {
      const video = videoRef.current as CanvasPreviewVideo | null;

      if (video?.requestVideoFrameCallback) {
        videoFrameCallbackOwnerRef.current = video;
        videoFrameCallbackRef.current =
          video.requestVideoFrameCallback(renderVideoFrameLoop);
      } else {
        animationFrameRef.current = requestAnimationFrame(renderRafLoop);
      }
    }

    return () => {
      if (drawFrameRef.current === drawFrame) {
        drawFrameRef.current = null;
      }

      cleanupActiveMediaRef.current?.();
      cleanupActiveMediaRef.current = null;
      activeMediaKeyRef.current = null;
      activeMediaRef.current = null;
      cancelAnimation();
    };
  }, [isPlaying, isVisible, getCurrentSnapshot, getMediaKey, getMediaTrimRange]);
  React.useEffect(() => {
    const video = videoRef.current;
    const snapshot = getCurrentSnapshot();

    if (!video || !snapshot.media || snapshot.media.type !== 'video' || !isVisible) {
      videoRef.current?.pause();
      playbackStateRef.current = 'idle';
      return;
    }

    const targetTime = snapshot.previewTimeSeconds;
    const trimRange = getMediaTrimRange(snapshot.media);
    const seekThreshold = isPlaying ? 0.35 : 0.05;

    if (
      video.readyState >= HTMLMediaElement.HAVE_METADATA &&
      Number.isFinite(targetTime) &&
      Math.abs(video.currentTime - targetTime) > seekThreshold
    ) {
      video.currentTime = Math.max(trimRange.start, Math.min(trimRange.end - 0.001, targetTime));
    }

    if (isPlaying) {
      playbackStateRef.current = 'playing';

      video.play()
        .then(() => {
          playbackStateRef.current = 'playing';
        })
        .catch(() => {
          playbackStateRef.current = 'blocked';
        });
    } else {
      video.pause();
      playbackStateRef.current = 'paused';
      requestAnimationFrame(() => drawFrameRef.current?.());
    }
  }, [isPlaying, isVisible, media, getCurrentSnapshot, getMediaTrimRange]);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        aria-label={media ? `${media.name} preview` : 'Timeline preview'}
      />

      {!media && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <Grid2X2 className="h-12 w-12 text-zinc-700" />
          <div className="mt-4 text-sm font-semibold text-zinc-500">
            Nothing to preview yet
          </div>
          <p className="mt-2 max-w-sm text-xs leading-5 text-zinc-700">
            Add media or collections to the timeline, then play preview again.
          </p>
        </div>
      )}

      {showDebugStats && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-black/75 px-2.5 py-2 font-mono text-[10px] leading-4 text-zinc-200 shadow-lg backdrop-blur">
          <div className="grid grid-cols-[auto_auto] gap-x-3">
            <span className="text-zinc-500">canvas</span>
            <span>{debugStats.canvasFps.toFixed(0)} fps</span>

            <span className="text-zinc-500">video</span>
            <span>
              {debugStats.videoFps === null ? '--' : debugStats.videoFps.toFixed(0)} fps
            </span>

            <span className="text-zinc-500">react</span>
            <span>{debugStats.reactFps.toFixed(0)} fps</span>

            <span className="text-zinc-500">draw</span>
            <span>{debugStats.drawMs.toFixed(1)} ms</span>

            <span className="text-zinc-500">drift</span>
            <span>{debugStats.driftSeconds.toFixed(2)} s</span>

            <span className="text-zinc-500">ready</span>
            <span>{debugStats.readyState}</span>

            <span className="text-zinc-500">state</span>
            <span>
              {debugStats.playback}
              {debugStats.paused ? '/paused' : ''}
            </span>

            <span className="text-zinc-500">rvfc</span>
            <span>{debugStats.rvfc ? 'yes' : 'no'}</span>

            <span className="text-zinc-500">buffer</span>
            <span>
              {debugStats.backingWidth}x{debugStats.backingHeight}
            </span>

            <span className="text-zinc-500">source</span>
            <span>{debugStats.sourceType}</span>
          </div>
        </div>
      )}
    </div>
  );
}
