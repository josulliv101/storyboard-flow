"use client";

import type {
  CollectionEndpoint,
  TimelineClip,
} from "../types";
import { getVideoThumbnailUrl } from "../media-thumbnails";
import { CollectionRepeatedMediaTile } from "./CollectionRepeatedMediaTile";
import { RepeatedMediaFrame } from "./RepeatedMediaFrame";
import { RepeatedMediaFrames } from "./RepeatedMediaFrames";
import { useMediaFrameTimes } from "./useMediaFrameTimes";
import { useVideoDuration } from "./useVideoDuration";

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
  useVideoDuration(clip, onDurationLoaded);

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

  const { frameTimes, frameWidth, frameHeight, isVideo, mediaClip } =
    useMediaFrameTimes(clip, displayWidth, itemHeight, isXS);

  return (
    <RepeatedMediaFrames>
      {frameTimes.map((tileTime, position) => {
        const frameMedia = {
          src: mediaClip.src,
          alt: mediaClip.alt,
          fallbackSrc: mediaClip.poster,
        }
        if (isVideo) {
          frameMedia.src = getVideoThumbnailUrl(mediaClip.src, tileTime);
          frameMedia.alt = `${mediaClip.alt} frame ${position + 1}`;
        }

        return (
          <RepeatedMediaFrame
            key={`${clip.id}-repeat-frame-${tileTime}`}
            frameWidth={frameWidth}
            frameHeight={frameHeight}
            {...frameMedia}
          />
        );
      })}
    </RepeatedMediaFrames>
  );
}
