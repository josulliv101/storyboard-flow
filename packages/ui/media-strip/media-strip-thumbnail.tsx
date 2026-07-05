import { useState } from "react";

import type { TimelineItem } from "./media-strip.types";
import { isMediaItem } from "./media-strip.types";

type MediaStripThumbnailProps = {
  item: TimelineItem;
};

export function MediaStripThumbnail({ item }: MediaStripThumbnailProps) {
  if (!isMediaItem(item)) {
    return (
      <span
        className="flex size-full h-24 w-full items-center justify-center overflow-hidden rounded-md bg-muted text-xs text-muted-foreground"
        data-slot="media-strip-thumbnail"
      >
        Collection ({item.itemCount} items)
      </span>
    );
  }

  const posterUrl =
    item.posterSrc ?? (item.kind === "image" ? item.src : undefined);

  return (
    <MediaStripPosterThumbnail
      key={`${item.id}:${posterUrl ?? "no-poster"}`}
      posterUrl={posterUrl}
    />
  );
}

type MediaStripPosterThumbnailProps = {
  posterUrl?: string;
};

function MediaStripPosterThumbnail({
  posterUrl,
}: MediaStripPosterThumbnailProps) {
  const [hasError, setHasError] = useState(false);

  return (
    <span
      className="block h-24 w-full overflow-hidden rounded-md bg-muted"
      data-slot="media-strip-thumbnail"
    >
      {posterUrl && !hasError ? (
        <img
          src={posterUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
          loading="lazy"
          onError={() => setHasError(true)}
        />
      ) : (
        <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
          No poster
        </span>
      )}
    </span>
  );
}