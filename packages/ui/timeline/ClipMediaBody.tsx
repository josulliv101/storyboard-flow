import React from "react";

import type { CollectionEndpoint, TimelineClip } from "./types";
import { RepeatedMediaTile } from "./RepeatedMediaTile";
import { useTimelineClipItemContext } from "./TimelineClipItemContext";
import type { TimelineClipMediaView } from "./TimelineClipItemModel";

export type ClipMediaBodyProps = {
  clip: TimelineClip;
  view: TimelineClipMediaView;
  onDurationLoaded?: (duration: number) => void;
  onCollectionEndpointClick?: (endpoint: CollectionEndpoint) => void;
  onCollectionTitleChange?: (title: string) => void;
};

export function ClipMediaBody({
  clip,
  view,
  onDurationLoaded,
  onCollectionEndpointClick,
  onCollectionTitleChange,
}: ClipMediaBodyProps) {
  const { metrics } = useTimelineClipItemContext();

  return (
    <RepeatedMediaTile
      clip={clip}
      displayWidth={view.displayWidth}
      previewTime={view.previewTime ?? clip.trimIn}
      itemHeight={metrics.itemHeight}
      onDurationLoaded={onDurationLoaded}
      collectionEndpointSelection={
        clip.kind === "collection" ? view.collectionEndpointSelection : undefined
      }
      onCollectionEndpointClick={
        clip.kind === "collection" && onCollectionEndpointClick
          ? onCollectionEndpointClick
          : undefined
      }
      onCollectionTitleChange={
        clip.kind === "collection" && onCollectionTitleChange
          ? onCollectionTitleChange
          : undefined
      }
    />
  );
}
