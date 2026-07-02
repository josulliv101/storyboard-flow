import { cva } from "class-variance-authority";
import { Folder, Plus } from "lucide-react";

import { getVideoThumbnailUrl } from "../media-thumbnails";
import type {
  CollectionEndpoint,
  CollectionTimelineClip,
} from "../types";
import { handleImageFallback } from "./image-fallback";

type CollectionRepeatedMediaTileProps = {
  clip: CollectionTimelineClip;
  isXS: boolean;
  collectionEndpointSelection?: Partial<Record<CollectionEndpoint, boolean>>;
  onCollectionEndpointClick?: (endpoint: CollectionEndpoint) => void;
};

function getCollectionEndpointForSlot(
  index: number,
  previewItemCount: number,
): CollectionEndpoint | null {
  if (previewItemCount === 0) return null;
  if (index === 0) return "first";
  if (previewItemCount > 1 && index === previewItemCount - 1) return "last";
  return null;
}

const collectionRepeatedMediaTile = cva(
  "group relative flex h-full w-full select-none flex-col justify-between overflow-hidden rounded-lg border border-sky-500/20 bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 shadow-xl transition-all duration-300 hover:border-sky-500/40 hover:shadow-sky-950/20",
  {
    variants: {
      density: {
        compact: "p-2.5",
        default: "p-3.5",
      },
    },
    defaultVariants: {
      density: "default",
    },
  },
);

const collectionPreviewSlot = cva(
  "relative h-full w-full overflow-hidden rounded-[4px] border border-zinc-800/40 bg-zinc-900/60 p-0 text-left transition-all duration-200",
  {
    variants: {
      interactive: {
        true: "cursor-pointer appearance-none hover:border-amber-300/80 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2",
        false: "",
      },
      selected: {
        true: "border-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.35)] ring-2 ring-amber-300/80",
        false: "",
      },
    },
    defaultVariants: {
      interactive: false,
      selected: false,
    },
  },
);

const collectionTileFooter = cva("flex min-w-0 flex-col justify-end", {
  variants: {
    density: {
      compact: "h-full pt-0",
      default: "pt-2",
    },
  },
  defaultVariants: {
    density: "default",
  },
});

export function CollectionRepeatedMediaTile({
  clip,
  isXS,
  collectionEndpointSelection,
  onCollectionEndpointClick,
}: CollectionRepeatedMediaTileProps) {
  const previewItems = clip.previewItems ?? [];
  const density = isXS ? "compact" : "default";

  return (
    <div className={collectionRepeatedMediaTile({ density })}>
      <div className="absolute left-0 right-0 top-0 h-[2.5px] bg-gradient-to-r from-sky-400 via-indigo-500 to-transparent opacity-80" />

      {!isXS && (
        <div className="grid h-[54%] grid-cols-3 gap-1.5 rounded-lg border border-zinc-900/80 bg-zinc-950/70 p-1.5 shadow-inner">
          {Array.from({ length: 3 }).map((_, index) => {
            const item = previewItems[index];
            const endpoint = item
              ? getCollectionEndpointForSlot(index, previewItems.length)
              : null;
            const endpointSelected = endpoint
              ? Boolean(collectionEndpointSelection?.[endpoint])
              : false;
            const previewContent = item ? (
              item.kind === "video" ? (
                <img
                  src={getVideoThumbnailUrl(item.src, 0)}
                  alt={item.alt}
                  className="h-full w-full object-cover grayscale-[10%] contrast-[105%] brightness-[95%] transition-transform duration-300 group-hover:scale-105"
                  draggable={false}
                  onError={(event) => handleImageFallback(event, item.poster)}
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.src}
                  alt={item.alt}
                  draggable={false}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-800">
                <Plus className="h-3 w-3 opacity-30" />
              </div>
            );
            const isInteractiveEndpoint = Boolean(endpoint && onCollectionEndpointClick);
            const previewSlotClassName = collectionPreviewSlot({
              interactive: isInteractiveEndpoint,
              selected: endpointSelected,
            });

            if (endpoint && onCollectionEndpointClick && item) {
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid="timeline-collection-preview-endpoint"
                  data-endpoint={endpoint}
                  aria-pressed={endpointSelected}
                  aria-label={`${clip.title} ${endpoint} item`}
                  className={previewSlotClassName}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onCollectionEndpointClick(endpoint);
                  }}
                >
                  {previewContent}
                </button>
              );
            }

            return (
              <div
                key={item?.id ?? `${clip.id}-empty-preview-${index}`}
                className={previewSlotClassName}
              >
                {previewContent}
              </div>
            );
          })}
        </div>
      )}

      <div className={collectionTileFooter({ density })}>
        <h4 className="truncate text-xs font-bold tracking-wide text-zinc-100 transition-colors group-hover:text-sky-300">
          {clip.title}
        </h4>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-400">
            <Folder className="h-2.5 w-2.5 shrink-0" />
            {clip.itemCount} {clip.itemCount === 1 ? "asset" : "assets"}
          </span>
        </div>
      </div>
    </div>
  );
}
