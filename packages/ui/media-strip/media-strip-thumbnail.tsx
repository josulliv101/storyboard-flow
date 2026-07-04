import type { MediaStripItem } from "./media-strip.types";

type MediaStripThumbnailProps = {
  item: MediaStripItem;
};

export function MediaStripThumbnail({ item }: MediaStripThumbnailProps) {
  return (
    <span
      className="block h-24 w-full overflow-hidden rounded-md bg-muted"
      data-slot="media-strip-thumbnail"
    >
      {item.thumbnailUrl ? (
        <img
          src={item.thumbnailUrl}
          alt={item.alt ?? item.title}
          className="size-full object-cover"
          draggable={false}
          loading="lazy"
        />
      ) : item.videoSrc ? (
        <video
          src={item.videoSrc}
          aria-hidden="true"
          className="size-full object-cover"
          draggable={false}
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
          No poster
        </span>
      )}
    </span>
  );
}
