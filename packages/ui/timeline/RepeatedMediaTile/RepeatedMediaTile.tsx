import React from "react";
import type {
  CollectionEndpoint,
  TimelineClip,
  VideoTimelineClip,
} from "../types";
import { CollectionRepeatedMediaTile } from "./CollectionRepeatedMediaTile";
import { RepeatedMediaFrames } from "./RepeatedMediaFrames";

export type RepeatedMediaTileProps = {
  clip: TimelineClip;
  displayWidth: number;
  previewTime: number;
  itemHeight: number;
  pixelsPerSecond?: number;
  onDurationLoaded?: (duration: number) => void;
  collectionEndpointSelection?: Partial<Record<CollectionEndpoint, boolean>>;
  onCollectionEndpointClick?: (endpoint: CollectionEndpoint) => void;
};

export function RepeatedMediaTile({
  clip,
  displayWidth,
  itemHeight,
  onDurationLoaded,
  collectionEndpointSelection,
  onCollectionEndpointClick,
}: RepeatedMediaTileProps) {
  React.useEffect(() => {
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

  const isXS = itemHeight === 80;

  if (clip.kind === "collection") {
    return (
      <CollectionRepeatedMediaTile
        clip={clip}
        isXS={isXS}
        collectionEndpointSelection={collectionEndpointSelection}
        onCollectionEndpointClick={onCollectionEndpointClick}
      />
    );
  }

  return (
    <RepeatedMediaFrames
      clip={clip}
      displayWidth={displayWidth}
      itemHeight={itemHeight}
      isXS={isXS}
    />
  );
}
