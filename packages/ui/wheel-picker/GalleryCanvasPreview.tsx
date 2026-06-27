import React from 'react';
import { type SceneLaunchMediaItem, VIDEO_PLACEHOLDER } from './SceneLaunchPreviewWheelV3';

const clamp = (value: number, min: number, max: number) => (
  Math.max(min, Math.min(max, value))
);

export type GalleryScrubSnapshot = {
  media: SceneLaunchMediaItem;
  sourceTimeSeconds: number;
  timelineTimeSeconds: number;
};

export type CanvasVideoElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface GalleryCanvasPreviewProps {
  snapshot: GalleryScrubSnapshot;
  isPlaying?: boolean;
}

export function GalleryCanvasPreview({
  snapshot,
  isPlaying = false,
}: GalleryCanvasPreviewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const videoRef = React.useRef<CanvasVideoElement | null>(null);
  const drawableRef = React.useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const imageCacheRef = React.useRef(new Map<string, HTMLImageElement>());
  const targetTimeRef = React.useRef(snapshot.sourceTimeSeconds);
  const mediaKeyRef = React.useRef('');
  const expectedVideoSourceRef = React.useRef('');
  const videoFrameHandleRef = React.useRef<number | null>(null);
  const animationFrameHandleRef = React.useRef<number | null>(null);
  const isPlayingRef = React.useRef(isPlaying);

  const drawCurrentFrame = React.useCallback(() => {
    const canvas = canvasRef.current;
    const drawable = drawableRef.current;
    if (!canvas || !drawable) return;

    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const renderWidth = Math.round(cssWidth * pixelRatio);
    const renderHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    if (
      drawable instanceof HTMLVideoElement &&
      (
        drawable.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        drawable.currentSrc !== expectedVideoSourceRef.current
      )
    ) return;
    const sourceWidth = drawable instanceof HTMLVideoElement ? drawable.videoWidth : drawable.naturalWidth;
    const sourceHeight = drawable instanceof HTMLVideoElement ? drawable.videoHeight : drawable.naturalHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const scale = Math.min(cssWidth / sourceWidth, cssHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = '#000';
    context.fillRect(0, 0, cssWidth, cssHeight);
    context.drawImage(
      drawable,
      (cssWidth - width) / 2,
      (cssHeight - height) / 2,
      width,
      height,
    );
  }, []);

  const stopFrameLoop = React.useCallback(() => {
    const video = videoRef.current;
    if (videoFrameHandleRef.current !== null && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(videoFrameHandleRef.current);
    }
    if (animationFrameHandleRef.current !== null) {
      window.cancelAnimationFrame(animationFrameHandleRef.current);
    }
    videoFrameHandleRef.current = null;
    animationFrameHandleRef.current = null;
  }, []);

  const startFrameLoop = React.useCallback(() => {
    stopFrameLoop();
    const video = videoRef.current;
    if (!video) return;
    const frameMediaKey = mediaKeyRef.current;
    const frameSource = expectedVideoSourceRef.current;

    if (video.requestVideoFrameCallback) {
      const drawVideoFrame = () => {
        if (mediaKeyRef.current !== frameMediaKey || video.currentSrc !== frameSource) return;
        drawCurrentFrame();
        if (!video.paused && !video.ended) {
          videoFrameHandleRef.current = video.requestVideoFrameCallback?.(drawVideoFrame) ?? null;
        }
      };
      videoFrameHandleRef.current = video.requestVideoFrameCallback(drawVideoFrame);
      return;
    }

    const drawAnimationFrame = () => {
      if (mediaKeyRef.current !== frameMediaKey || video.currentSrc !== frameSource) return;
      drawCurrentFrame();
      if (!video.paused && !video.ended) {
        animationFrameHandleRef.current = window.requestAnimationFrame(drawAnimationFrame);
      }
    };
    animationFrameHandleRef.current = window.requestAnimationFrame(drawAnimationFrame);
  }, [drawCurrentFrame, stopFrameLoop]);

  const seekToLatestTarget = React.useCallback((video: CanvasVideoElement) => {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA || video.seeking) return;

    const maximumTime = Number.isFinite(video.duration)
      ? Math.max(0, video.duration - 0.001)
      : targetTimeRef.current;
    const targetTime = clamp(targetTimeRef.current, 0, maximumTime);
    if (Math.abs(video.currentTime - targetTime) <= 0.001) {
      drawCurrentFrame();
      return;
    }
    video.currentTime = targetTime;
  }, [drawCurrentFrame]);

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(drawCurrentFrame);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawCurrentFrame]);

  React.useEffect(() => {
    const video = document.createElement('video') as CanvasVideoElement;
    video.preload = 'auto';
    video.playsInline = true;
    videoRef.current = video;
    const isCurrentSource = () => (
      expectedVideoSourceRef.current !== '' &&
      video.currentSrc === expectedVideoSourceRef.current
    );

    video.addEventListener('loadedmetadata', () => {
      if (!isCurrentSource()) return;
      seekToLatestTarget(video);
      if (isPlayingRef.current) void video.play().catch(() => undefined);
    });
    video.addEventListener('loadeddata', () => {
      if (!isCurrentSource()) return;
      if (Math.abs(video.currentTime - targetTimeRef.current) <= 0.001) drawCurrentFrame();
      else seekToLatestTarget(video);
    });
    video.addEventListener('seeked', () => {
      if (!isCurrentSource()) return;
      drawCurrentFrame();
      if (Math.abs(video.currentTime - targetTimeRef.current) > 0.001) {
        seekToLatestTarget(video);
      }
    });
    video.addEventListener('playing', startFrameLoop);
    video.addEventListener('pause', drawCurrentFrame);

    return () => {
      stopFrameLoop();
      video.pause();
      video.removeAttribute('src');
      video.load();
      videoRef.current = null;
    };
  }, [drawCurrentFrame, seekToLatestTarget, startFrameLoop, stopFrameLoop]);

  React.useLayoutEffect(() => {
    targetTimeRef.current = snapshot.sourceTimeSeconds;
    const mediaKey = `${snapshot.media.type}:${snapshot.media.id}:${snapshot.media.previewUrl}`;
    if (mediaKey === mediaKeyRef.current) {
      if (!isPlaying && snapshot.media.type === 'video' && videoRef.current) {
        seekToLatestTarget(videoRef.current);
      }
      return;
    }
    mediaKeyRef.current = mediaKey;

    const video = videoRef.current;
    if (snapshot.media.type === 'video') {
      if (!video) return;
      stopFrameLoop();
      video.pause();
      drawableRef.current = video;
      video.muted = !isPlaying;
      expectedVideoSourceRef.current = new URL(snapshot.media.previewUrl, document.baseURI).href;
      video.src = snapshot.media.previewUrl;
      video.load();
      return;
    }

    video?.pause();
    stopFrameLoop();
    expectedVideoSourceRef.current = '';
    let image = imageCacheRef.current.get(snapshot.media.previewUrl);
    if (!image) {
      image = new window.Image();
      image.decoding = 'async';
      image.src = snapshot.media.previewUrl;
      imageCacheRef.current.set(snapshot.media.previewUrl, image);
    }
    const targetImage = image;
    const drawImage = () => {
      if (mediaKeyRef.current !== mediaKey) return;
      drawableRef.current = targetImage;
      drawCurrentFrame();
    };
    if (targetImage.complete && targetImage.naturalWidth > 0) drawImage();
    else targetImage.addEventListener('load', drawImage, { once: true });
  }, [drawCurrentFrame, isPlaying, seekToLatestTarget, snapshot.media.id, snapshot.media.previewUrl, snapshot.media.type, snapshot.sourceTimeSeconds, stopFrameLoop]);

  React.useEffect(() => {
    const video = videoRef.current;
    isPlayingRef.current = isPlaying;
    if (!video || snapshot.media.type !== 'video') return;
    video.muted = !isPlaying;
    if (!isPlaying || snapshot.media.type !== 'video') {
      video.pause();
      stopFrameLoop();
      seekToLatestTarget(video);
      return;
    }

    seekToLatestTarget(video);
    void video.play().catch(() => undefined);
  }, [isPlaying, seekToLatestTarget, snapshot.media.type, startFrameLoop, stopFrameLoop]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`${snapshot.media.name} scrub preview`}
      className="block h-full w-full rounded-md bg-black"
    />
  );
}
