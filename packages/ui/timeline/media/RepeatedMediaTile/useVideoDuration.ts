"use client";

import { useEffect } from "react";
import type { TimelineClip, VideoTimelineClip } from "../../types";

export function useVideoDuration(
  clip: TimelineClip,
  onDurationLoaded?: (duration: number) => void,
) {
  useEffect(() => {
    if (!onDurationLoaded || clip.kind !== "video") return;

    const videoClip = clip as VideoTimelineClip;
    if (!videoClip.src) return;

    const tempVideo = document.createElement("video");
    tempVideo.src = videoClip.src;
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
  }, [clip, onDurationLoaded]);
}
