import React from "react";

import type { CollectionEndpoint, TimelineClip } from "../types";
import { RepeatedMediaTile } from "../media/RepeatedMediaTile";
import { useTimelineClipItemContext } from "./TimelineClipItemContext";
import type { TimelineClipMediaView } from "./TimelineClipItemModel";

export type ClipMediaBodyProps = {
  clip: TimelineClip;
  view: TimelineClipMediaView;
  onDurationLoaded?: (duration: number) => void;
  collectionHref?: string | null;
  onOpenCollection?: (timelineId: string, href: string) => void;
  onCollectionEndpointClick?: (endpoint: CollectionEndpoint) => void;
  onCollectionTitleChange?: (title: string) => void;
};

export function ClipMediaBody({
  clip,
  view,
  onDurationLoaded,
  collectionHref,
  onOpenCollection,
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
      collectionHref={clip.kind === "collection" ? collectionHref : undefined}
      onOpenCollection={
        clip.kind === "collection" && onOpenCollection
          ? onOpenCollection
          : undefined
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
