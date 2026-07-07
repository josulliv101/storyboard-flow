"use client";
import { useEffect } from "react";
export function useVideoDuration(clip, onDurationLoaded) {
    useEffect(() => {
        if (!onDurationLoaded || clip.kind !== "video")
            return;
        const videoClip = clip;
        if (!videoClip.src)
            return;
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
