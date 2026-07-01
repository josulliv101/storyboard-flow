import React from "react";

import type { CollectionEndpoint, TimelineClip } from "./types";
import { RepeatedMediaTile } from "./RepeatedMediaTile";

export type ClipMediaBodyProps = {
  clip: TimelineClip;
  displayWidth: number;
  itemHeight: number;
  pixelsPerSecond: number;
  previewTime?: number | null;
  onDurationLoaded?: (duration: number) => void;
  collectionEndpointSelection?: Partial<Record<CollectionEndpoint, boolean>>;
  onCollectionEndpointClick?: (endpoint: CollectionEndpoint) => void;
};

export function ClipMediaBody({
  clip,
  displayWidth,
  itemHeight,
  pixelsPerSecond,
  previewTime = null,
  onDurationLoaded,
  collectionEndpointSelection,
  onCollectionEndpointClick,
}: ClipMediaBodyProps) {
  return (
    <RepeatedMediaTile
      clip={clip}
      displayWidth={displayWidth}
      previewTime={previewTime ?? clip.trimIn}
      itemHeight={itemHeight}
      pixelsPerSecond={pixelsPerSecond}
      onDurationLoaded={onDurationLoaded}
      collectionEndpointSelection={
        clip.kind === "collection" ? collectionEndpointSelection : undefined
      }
      onCollectionEndpointClick={
        clip.kind === "collection" && onCollectionEndpointClick
          ? onCollectionEndpointClick
          : undefined
      }
    />
  );
}
