import React, { useRef, useCallback, useEffect } from "react";
import { clamp } from "./utils";

type VideoTileProps = {
  src: string;
  alt: string;
  poster?: string;
  /** Seek-only preview time in the component's source-time space. */
  previewTime?: number | null;
  /** Source duration used by the timeline UI. When it differs from the real video file duration, previewTime is normalized. */
  sourceDuration?: number | null;
  /** Callback fired when the video metadata loads its real duration. */
  onDurationLoaded?: (duration: number) => void;
};

export function VideoTile({
  src,
  poster,
  alt,
  previewTime = null,
  sourceDuration = null,
  onDurationLoaded,
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
      playsInline
      preload={hasPreviewTime ? "auto" : "metadata"}
      aria-label={alt}
      draggable={false}
      className="pointer-events-none h-full w-full object-cover"
      onLoadedMetadata={(e) => {
        if (hasPreviewTime) {
          seekToPreviewTime();
        } else {
          resetToPosterOrStart();
        }
        if (onDurationLoaded) {
          onDurationLoaded(e.currentTarget.duration);
        }
      }}
      onCanPlay={hasPreviewTime ? seekToPreviewTime : undefined}
    />
  );
}
