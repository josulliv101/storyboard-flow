'use client';

import React from 'react';
import Image from 'next/image';

interface VideoFrameFilmstripProps {
  src: string;
  durationSeconds: number;
  frameCount?: number;
}

const frameCache = new Map<string, string[]>();
const MAX_CACHED_FILMSTRIPS = 24;

const cacheFrames = (key: string, frames: string[]) => {
  frameCache.delete(key);
  frameCache.set(key, frames);
  if (frameCache.size > MAX_CACHED_FILMSTRIPS) {
    const oldestKey = frameCache.keys().next().value;
    if (oldestKey) frameCache.delete(oldestKey);
  }
};

const waitForVideoData = (video: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    resolve();
    return;
  }

  const cleanup = () => {
    video.removeEventListener('loadeddata', handleLoadedData);
    video.removeEventListener('error', handleError);
  };
  const handleLoadedData = () => {
    cleanup();
    resolve();
  };
  const handleError = () => {
    cleanup();
    reject(new Error('Unable to decode video for the trim filmstrip.'));
  };

  video.addEventListener('loadeddata', handleLoadedData);
  video.addEventListener('error', handleError);
});

const seekVideo = (video: HTMLVideoElement, timeSeconds: number) => new Promise<void>((resolve, reject) => {
  if (Math.abs(video.currentTime - timeSeconds) < 0.01 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    resolve();
    return;
  }

  const cleanup = () => {
    video.removeEventListener('seeked', handleSeeked);
    video.removeEventListener('error', handleError);
  };
  const handleSeeked = () => {
    cleanup();
    resolve();
  };
  const handleError = () => {
    cleanup();
    reject(new Error('Unable to seek video for the trim filmstrip.'));
  };

  video.addEventListener('seeked', handleSeeked);
  video.addEventListener('error', handleError);
  video.currentTime = timeSeconds;
});

export function VideoFrameFilmstrip({
  src,
  durationSeconds,
  frameCount = 10,
}: VideoFrameFilmstripProps) {
  const cacheKey = `${src}|${durationSeconds}|${frameCount}`;
  const [frames, setFrames] = React.useState<string[]>(() => frameCache.get(cacheKey) ?? []);

  React.useEffect(() => {
    const cachedFrames = frameCache.get(cacheKey);
    if (cachedFrames?.length === frameCount) {
      return;
    }

    let cancelled = false;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const sampleFrames = async () => {
      try {
        video.src = src;
        await waitForVideoData(video);

        const decodedDuration = Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : durationSeconds;
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext('2d');
        if (!context) return;

        const nextFrames: string[] = [];
        for (let index = 0; index < frameCount; index += 1) {
          if (cancelled) return;

          const targetTime = Math.min(
            Math.max(0, decodedDuration - 0.05),
            decodedDuration * ((index + 0.5) / frameCount),
          );
          await seekVideo(video, targetTime);

          const scale = Math.max(
            canvas.width / Math.max(1, video.videoWidth),
            canvas.height / Math.max(1, video.videoHeight),
          );
          const width = video.videoWidth * scale;
          const height = video.videoHeight * scale;
          context.drawImage(
            video,
            (canvas.width - width) / 2,
            (canvas.height - height) / 2,
            width,
            height,
          );
          nextFrames.push(canvas.toDataURL('image/jpeg', 0.72));
          if (!cancelled) setFrames([...nextFrames]);
        }

        if (!cancelled) cacheFrames(cacheKey, nextFrames);
      } catch {
        if (!cancelled) setFrames([]);
      }
    };

    void sampleFrames();

    return () => {
      cancelled = true;
      video.removeAttribute('src');
      video.load();
    };
  }, [cacheKey, durationSeconds, frameCount, src]);

  return (
    <div aria-hidden="true" className="absolute inset-0 flex bg-zinc-900">
      {Array.from({ length: frameCount }, (_, index) => (
        <div
          key={`${src}-${index}`}
          className="relative h-full min-w-0 flex-1 overflow-hidden border-r border-black/25 last:border-r-0"
        >
          {frames[index] ? (
            <Image
              src={frames[index]}
              alt=""
              fill
              sizes={`${Math.ceil(100 / frameCount)}vw`}
              unoptimized
              className="object-cover"
            />
          ) : (
            <div className="h-full w-full animate-pulse bg-zinc-800" />
          )}
        </div>
      ))}
    </div>
  );
}
