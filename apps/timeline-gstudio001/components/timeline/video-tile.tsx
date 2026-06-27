import React, { useState, useEffect, useRef } from "react";
import { Video } from "lucide-react";

type VideoTileProps = {
  src: string;
  alt: string;
  poster?: string;
  /** Seek-only preview time in the component's source-time space. */
  previewTime?: number | null;
  /** Source duration used by the timeline UI. When it differs from the real video file duration, previewTime is normalized. */
  sourceDuration?: number | null;
  /** Render the video element for seek previews even when a poster thumbnail is available. */
  preferVideoPreview?: boolean;
  /** Callback fired when the video metadata loads its real duration. */
  onDurationLoaded?: (duration: number) => void;
};

export function VideoTile({
  src,
  poster,
  alt,
  previewTime = null,
  sourceDuration = null,
  preferVideoPreview = false,
  onDurationLoaded,
}: VideoTileProps) {
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const shouldUsePoster = !!poster && !imgError && !preferVideoPreview;

  useEffect(() => {
    setImgError(false);
    setVideoError(false);
  }, [poster, preferVideoPreview, src]);

  useEffect(() => {
    if (!onDurationLoaded || !src || !shouldUsePoster) return;

    // In-memory background loader to resolve metadata durations
    const tempVideo = document.createElement("video");
    tempVideo.src = src;
    tempVideo.preload = "metadata";

    const handleLoadedMetadata = () => {
      onDurationLoaded(tempVideo.duration);
    };

    tempVideo.addEventListener("loadedmetadata", handleLoadedMetadata);

    return () => {
      tempVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
      tempVideo.removeAttribute("src");
      tempVideo.load();
    };
  }, [onDurationLoaded, shouldUsePoster, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || shouldUsePoster || previewTime === null) return;

    const seekPreviewFrame = () => {
      const realDuration =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      const previewSeconds = Math.max(0, previewTime);
      const normalizedTime =
        realDuration && sourceDuration && sourceDuration > 0
          ? (previewSeconds / sourceDuration) * realDuration
          : previewSeconds;
      const targetTime = realDuration
        ? Math.min(normalizedTime, Math.max(0, realDuration - 0.05))
        : normalizedTime;

      try {
        video.currentTime = targetTime;
      } catch {
        // Some codecs reject early seeks until more data is buffered.
      }
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seekPreviewFrame();
      return;
    }

    video.addEventListener("loadedmetadata", seekPreviewFrame, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", seekPreviewFrame);
    };
  }, [previewTime, shouldUsePoster, sourceDuration, src]);

  if (shouldUsePoster) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={poster}
        alt={alt}
        draggable={false}
        onError={() => setImgError(true)}
        className="pointer-events-none h-full w-full object-cover"
      />
    );
  }

  if (src && !videoError) {
    return (
      <video
        ref={videoRef}
        src={src}
        aria-label={alt}
        className="pointer-events-none h-full w-full object-cover"
        draggable={false}
        muted
        onError={() => setVideoError(true)}
        onLoadedMetadata={(event) => {
          onDurationLoaded?.(event.currentTarget.duration);
        }}
        playsInline
        preload={preferVideoPreview ? "auto" : "metadata"}
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-zinc-800 to-zinc-950 p-2 text-zinc-400 select-none border border-zinc-700/30 rounded-lg text-center overflow-hidden">
      <Video className="h-5 w-5 text-zinc-500 shrink-0" />
      <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500/80 truncate max-w-full">
        {alt || "Video"}
      </span>
    </div>
  );
}
