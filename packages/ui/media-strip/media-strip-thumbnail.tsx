import { useState, useEffect, useLayoutEffect, useRef, useMemo, memo, useContext } from "react";

import type { TimelineItem, MediaTimelineItem } from "./media-strip.types";
import { isMediaItem } from "./media-strip.types";
import { THUMBNAIL_HEIGHT_PX } from "./media-strip.utils";
import { useMediaStripBoardStableOptional } from "./media-strip-board";

type MediaStripThumbnailProps = {
  item: TimelineItem;
  variant?: "single" | "sequence";
};

export const MediaStripThumbnail = memo(
  function MediaStripThumbnail({
    item,
    variant = "sequence",
  }: MediaStripThumbnailProps) {
    const board = useMediaStripBoardStableOptional();

    if (!isMediaItem(item)) {
      const derivedCount = board?.collectionsById?.get(item.collectionId)?.items.length ?? item.itemCount;

      return (
        <span
          style={{ height: THUMBNAIL_HEIGHT_PX }}
          className="flex size-full w-full items-center justify-center overflow-hidden rounded-md bg-muted text-xs text-muted-foreground"
          data-slot="media-strip-thumbnail"
        >
          Collection ({derivedCount} items)
        </span>
      );
    }

    // Render poster thumbnail layout without forcing a component remount via keys
    return (
      <MediaStripPosterThumbnail
        item={item}
        variant={variant}
      />
    );
  }
);

const MediaStripPosterThumbnail = memo(
  function MediaStripPosterThumbnail({
    item,
    variant,
  }: {
    item: MediaTimelineItem;
    variant: "single" | "sequence";
  }) {
    // Track failed URLs individually so one bad link does not break the entire sequence
    const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

    const containerRef = useRef<HTMLSpanElement>(null);
    const [containerSize, setContainerSize] = useState<{ width: number }>({
      width: 0,
    });

    const posterUrlsKey = useMemo(() => item.posterSrcs ? item.posterSrcs.join(",") : "", [item.posterSrcs]);

    // Reset errors when the timeline item changes, its list of poster URLs changes, or its src changes
    useEffect(() => {
      setFailedUrls(new Set());
    }, [item.id, posterUrlsKey, item.src]);

    useLayoutEffect(() => {
      if (variant !== "sequence") return;

      const element = containerRef.current;
      if (!element) return;

      if (typeof ResizeObserver === "undefined") return;

      const rect = element.getBoundingClientRect();
      setContainerSize({ width: Math.round(rect.width) });

      const observer = new ResizeObserver((entries) => {
        if (!entries || entries.length === 0) return;
        const { width } = entries[0].contentRect;
        const roundedWidth = Math.round(width);

        // Prevent redundant state updates on micro-pixel variations
        setContainerSize((prev) => {
          if (prev.width === roundedWidth) {
            return prev;
          }
          return { width: roundedWidth };
        });
      });

      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }, [variant, item.id]);

    const posterUrls = item.posterSrcs;
    const isSequence = variant === "sequence";

    // Restrict fallback URL to image items only. A video item's source (.mp4 or other video files)
    // must never be rendered inside a fallback <img> element, avoiding browser image loading errors.
    const fallbackUrl = item.kind === "image" ? item.src : undefined;

    // Helper to filter out broken URLs
    const getImageUrl = (url?: string): string | null => {
      if (!url || failedUrls.has(url)) return null;
      return url;
    };

    // Before ResizeObserver runs and updates containerSize, containerSize.width starts at 0.
    // This causes count to temporarily fallback to 1 during the initial render tick,
    // briefly flashing a single thumbnail before re-flowing to the actual layout once dimensions
    // are measured. This is an accepted tradeoff to ensure SSR safety and avoid layout thrashing.
    const thumbnailWidth = THUMBNAIL_HEIGHT_PX;
    const count =
      isSequence && containerSize.width > 0
        ? Math.max(1, Math.floor(containerSize.width / thumbnailWidth))
        : 1;

    if (isSequence) {
      return (
        <span
          ref={containerRef}
          style={{ height: THUMBNAIL_HEIGHT_PX }}
          className="overflow-hidden rounded-md bg-muted w-full flex flex-row"
          data-slot="media-strip-thumbnail"
        >
          {Array.from({ length: count }).map((_, index) => {
            const originalSrc =
              posterUrls && posterUrls.length > 0
                ? posterUrls[index % posterUrls.length]
                : fallbackUrl;

            const src = getImageUrl(originalSrc);

            if (src) {
              return (
                <img
                  key={index}
                  src={src}
                  alt=""
                  className="h-full flex-1 min-w-0 object-cover"
                  draggable={false}
                  loading="lazy"
                  onError={() => {
                    setFailedUrls((prev) => {
                      const next = new Set(prev);
                      next.add(src);
                      return next;
                    });
                  }}
                />
              );
            }

            return (
              <span
                key={index}
                className="flex h-full flex-1 min-w-0 items-center justify-center bg-muted text-[10px] text-muted-foreground border-r last:border-r-0 border-background select-none font-medium"
              >
                No poster
              </span>
            );
          })}
        </span>
      );
    }

    // Single poster layout
    const originalSrc =
      (posterUrls && posterUrls.length > 0 ? posterUrls[0] : undefined) ?? fallbackUrl;

    const src = getImageUrl(originalSrc);

    return (
      <span
        ref={containerRef}
        style={{ height: THUMBNAIL_HEIGHT_PX }}
        className="overflow-hidden rounded-md bg-muted w-full block"
        data-slot="media-strip-thumbnail"
      >
        {src ? (
          <img
            src={src}
            alt=""
            className="size-full object-cover"
            draggable={false}
            loading="lazy"
            onError={() => {
              setFailedUrls((prev) => {
                const next = new Set(prev);
                next.add(src);
                return next;
              });
            }}
          />
        ) : (
          <span className="flex size-full items-center justify-center text-xs text-muted-foreground select-none font-medium">
            No poster
          </span>
        )}
      </span>
    );
  }
);