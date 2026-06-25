import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { clamp } from "../utils/math";

export type VideoTileProps = {
  src: string;
  alt: string;
  poster?: string;
  /** Seek-only preview time in the component's source-time space. */
  previewTime?: number | null;
  /** Source duration used by the timeline UI. When it differs from the real video file duration, previewTime is normalized. */
  sourceDuration?: number | null;
};

/**
 * A muted, non-interactive <video> that displays a single still frame.
 * Pass `previewTime` (in the timeline's source-time space) to seek to and
 * hold a specific frame; omit it to fall back to the poster or first frame.
 */
export function VideoTile({
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
      // `defaultMuted` mirrors the `muted` attribute so the browser keeps
      // the video muted across re-renders/reloads; it's a valid DOM
      // attribute that the React JSX types don't declare.
      {...({ defaultMuted: true } as React.VideoHTMLAttributes<HTMLVideoElement>)}
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
