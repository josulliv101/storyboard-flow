import React, { useState, useEffect } from "react";
import { Video } from "lucide-react";

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
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!onDurationLoaded || !src) return;

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
    };
  }, [src, onDurationLoaded]);

  if (poster && !imgError) {
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

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-zinc-800 to-zinc-950 p-2 text-zinc-400 select-none border border-zinc-700/30 rounded-lg text-center overflow-hidden">
      <Video className="h-5 w-5 text-zinc-500 shrink-0" />
      <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500/80 truncate max-w-full">
        {alt || "Video"}
      </span>
    </div>
  );
}
