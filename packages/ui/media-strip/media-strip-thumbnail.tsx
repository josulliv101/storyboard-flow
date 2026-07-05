import { useState, useEffect, useRef } from "react";

import type { TimelineItem } from "./media-strip.types";
import { isMediaItem } from "./media-strip.types";

type MediaStripThumbnailProps = {
  item: TimelineItem;
  variant?: "single" | "sequence";
};

export function MediaStripThumbnail({
  item,
  variant = "sequence",
}: MediaStripThumbnailProps) {
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
    item.posterSrc ??
    (item.posterSrcs && item.posterSrcs.length > 0 ? item.posterSrcs[0] : undefined) ??
    (item.kind === "image" ? item.src : undefined);

  const posterUrlsKey = item.posterSrcs ? item.posterSrcs.join(",") : "";

  return (
    <MediaStripPosterThumbnail
      key={`${item.id}:${posterUrl ?? "no-poster"}:${posterUrlsKey}`}
      posterUrl={posterUrl}
      posterUrls={item.posterSrcs}
      variant={variant}
    />
  );
}

type MediaStripPosterThumbnailProps = {
  posterUrl?: string;
  posterUrls?: readonly string[];
  variant: "single" | "sequence";
};

function MediaStripPosterThumbnail({
  posterUrl,
  posterUrls,
  variant,
}: MediaStripPosterThumbnailProps) {
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    if (variant !== "sequence") return;

    const element = containerRef.current;
    if (!element) return;

    if (typeof ResizeObserver === "undefined") return;

    const rect = element.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });

    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [variant]);

  const hasImages = (posterUrls && posterUrls.length > 0) || posterUrl;
  const showImages = hasImages && !hasError;
  const isSequence = variant === "sequence";

  const thumbnailWidth = containerSize.height || 96;
  const count =
    isSequence && containerSize.width > 0
      ? Math.max(1, Math.floor(containerSize.width / thumbnailWidth))
      : 1;

  return (
    <span
      ref={containerRef}
      className={`overflow-hidden rounded-md bg-muted h-24 w-full ${
        isSequence ? "flex flex-row" : "block"
      }`}
      data-slot="media-strip-thumbnail"
    >
      {showImages ? (
        isSequence ? (
          Array.from({ length: count }).map((_, index) => {
            const src =
              posterUrls && posterUrls.length > 0
                ? posterUrls[index % posterUrls.length]
                : posterUrl;
            return (
              <img
                key={index}
                src={src}
                alt=""
                className="h-full flex-1 min-w-0 object-cover"
                draggable={false}
                loading="lazy"
                onError={() => setHasError(true)}
              />
            );
          })
        ) : (
          <img
            src={posterUrl}
            alt=""
            className="size-full object-cover"
            draggable={false}
            loading="lazy"
            onError={() => setHasError(true)}
          />
        )
      ) : (
        <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
          No poster
        </span>
      )}
    </span>
  );
}