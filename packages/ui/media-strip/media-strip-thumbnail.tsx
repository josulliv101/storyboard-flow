import type { TimelineItem } from "./media-strip.types";
import { isMediaItem } from "./media-strip.types";

type MediaStripThumbnailProps = {
  item: TimelineItem;
};

export function MediaStripThumbnail({ item }: MediaStripThumbnailProps) {
  if (!isMediaItem(item)) {
    return (
      <span
        className="flex size-full items-center justify-center text-xs text-muted-foreground bg-muted rounded-md h-24 w-full overflow-hidden"
        data-slot="media-strip-thumbnail"
      >
        Collection ({item.itemCount} items)
      </span>
    );
  }

  const posterUrl = item.posterSrc || (item.kind === "image" ? item.src : undefined);

  return (
    <span
      className="block h-24 w-full overflow-hidden rounded-md bg-muted"
      data-slot="media-strip-thumbnail"
    >
      {posterUrl ? (
        <img
          src={posterUrl}
          alt={item.name}
          className="size-full object-cover"
          draggable={false}
          loading="lazy"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
          No poster
        </span>
      )}
    </span>
  );
}
