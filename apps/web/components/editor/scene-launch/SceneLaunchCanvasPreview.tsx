'use client';

import React from 'react';
import { Grid2X2 } from 'lucide-react';

import type { SceneLaunchMediaItem } from './useSceneLaunchBoard';

type SceneLaunchCanvasPreviewProps = {
  media: SceneLaunchMediaItem | null;
  previewTimeSeconds: number;
  isPlaying: boolean;
  isVisible: boolean;
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
}: SceneLaunchCanvasPreviewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);

  const animationFrameRef = React.useRef<number | null>(null);
  const videoFrameCallbackRef = React.useRef<number | null>(null);
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
    previewTimeRef.current = previewTimeSeconds;
    reactUpdateCountRef.current += 1;
  }, [previewTimeSeconds]);

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
        sourceType: media?.type ?? 'none',
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
    if (!media || media.type !== 'video') {
      videoRef.current?.pause();
      videoRef.current = null;
      return;
    }

    const video = document.createElement('video');
    video.src = media.previewUrl;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';

    videoRef.current = video;

    /**
     * Important:
     * Do NOT reset hasDrawnFrameRef here.
     * During clip switches, we want to keep the previous canvas frame visible
     * until the new video has a real decoded frame.
     */

    const drawLoadedFrame = () => drawFrameRef.current?.();

    video.addEventListener('loadeddata', drawLoadedFrame);
    video.addEventListener('canplay', drawLoadedFrame);
    video.addEventListener('seeked', drawLoadedFrame);

    return () => {
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
  }, [media?.id, media?.previewUrl, media?.type]);

  React.useEffect(() => {
    if (!media || media.type !== 'image') {
      imageRef.current = null;
      return;
    }

    const image = new Image();
    image.src = media.previewUrl;
    imageRef.current = image;

    /**
     * Same idea as video:
     * Keep old canvas content until the new image has loaded.
     */

    return () => {
      if (imageRef.current === image) {
        imageRef.current = null;
      }
    };
  }, [media?.id, media?.previewUrl, media?.type]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false });

    if (!canvas || !context) return;

    const cancelAnimation = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      const video = videoRef.current as CanvasPreviewVideo | null;

      if (videoFrameCallbackRef.current !== null && video?.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(videoFrameCallbackRef.current);
      }

      videoFrameCallbackRef.current = null;
    };

    const drawEmpty = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawFrame = () => {
      if (!media || !isVisible) {
        drawEmpty();
        hasDrawnFrameRef.current = false;
        return;
      }

      if (media.type === 'image') {
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

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
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
      videoFrameCountRef.current += 1;
      drawFrame();

      const video = videoRef.current as CanvasPreviewVideo | null;

      if (video?.requestVideoFrameCallback && isVisible && isPlaying) {
        videoFrameCallbackRef.current =
          video.requestVideoFrameCallback(renderVideoFrameLoop);
      }
    };

    cancelAnimation();
    drawFrame();

    if (media?.type === 'video' && isVisible && isPlaying) {
      const video = videoRef.current as CanvasPreviewVideo | null;

      if (video?.requestVideoFrameCallback) {
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

      cancelAnimation();
    };
  }, [isPlaying, isVisible, media?.id, media?.type]);

  React.useEffect(() => {
    const video = videoRef.current;

    if (!video || !media || media.type !== 'video' || !isVisible) {
      videoRef.current?.pause();
      playbackStateRef.current = 'idle';
      return;
    }

    const targetTime = previewTimeRef.current;
    const seekThreshold = isPlaying ? 0.35 : 0.05;

    if (
      video.readyState >= HTMLMediaElement.HAVE_METADATA &&
      Number.isFinite(targetTime) &&
      Math.abs(video.currentTime - targetTime) > seekThreshold
    ) {
      video.currentTime = targetTime;
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
  }, [isPlaying, isVisible, media?.id, media?.type]);

  React.useEffect(() => {
    if (!media || media.type !== 'image') return;

    const image = imageRef.current;
    if (!image) return;

    const handleLoad = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d', { alpha: false });

      if (!canvas || !context) return;

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
    };

    image.addEventListener('load', handleLoad);

    if (image.complete) {
      handleLoad();
    }

    return () => image.removeEventListener('load', handleLoad);
  }, [media?.id, media?.type]);

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