"use client";

import { memo, useState } from "react";

import {
  mediaDurationSeconds,
  type CollectionGhostContentProps,
} from "@storyboard/ui/dnd-collections";
import {
  resolveCollectionPreviews,
  type CollectionPreviewFrame,
} from "@storyboard/timeline-domain";

import { ghostPreviewFrames, mediaGhostSrc } from "@/lib/card-ghost-frames";
import { formatSeconds } from "@/lib/format-duration";
import { collectionPreviewFrameUrl } from "@/lib/video-frame-url";

import { useClipDetail } from "./graph-details-context";
import { CollectionGhostGlyph } from "./graph-card-placeholders";
import { useHydratedCollectionPreviews } from "./graph-card-derivations";

/**
 * The drag ghost: a SQUARE thumbnail of the item being moved (the provider
 * sizes the overlay box square via `dragGhostWidth`/`dragGhostHeight`), so the
 * preview reads as "this picture" rather than a duration-shaped card. A media
 * clip shows its own frame; a COLLECTION shows the same child preview frames
 * its card paints, derived from the LIVE graph — which is available inside the
 * drag overlay even though the details side-table is not. A poster-less clip,
 * or a collection with no media to show, falls back to a labelled tile so the
 * ghost is never empty or broken.
 */
export const GraphGhost = memo(function GraphGhost({
  node,
  extraCount,
}: CollectionGhostContentProps) {
  const isCollection = node.kind === "collection";
  // Mirror the CARD (GraphCollectionItemParts) exactly, so the ghost shows what
  // the card shows: a HYDRATED collection uses its live recursive preview
  // frames; a placeholder falls back to the stored summary in the details
  // side-table — reachable here now that the provider wraps the drag overlay.
  const detail = useClipDetail(node.id as string);
  const hydrated = detail?.hydrated === true;
  const livePreviews = useHydratedCollectionPreviews(node.id as string, isCollection && hydrated);
  const all: readonly CollectionPreviewFrame[] = isCollection
    ? hydrated
      ? resolveCollectionPreviews(livePreviews, detail?.previewItems)
      : (detail?.previewItems ?? [])
    : [];
  // FIRST and LAST only (or the single frame) — never three, exactly as the
  // card picks its representative frames.
  const chosen = ghostPreviewFrames(all);
  const derivedFrames: string[] = isCollection
    ? chosen.map((preview) => collectionPreviewFrameUrl(preview)).filter(Boolean)
    : (() => {
        const src = mediaGhostSrc(node);
        return src ? [src] : [];
      })();
  // STICKY for the life of the ghost. A collection's frames are derived from
  // the LIVE graph plus the details table, and both move under us mid-drag:
  // dragging over an un-hydrated collection hydrates it, which re-runs this
  // derivation. Any moment where it yields fewer frames (or none) swapped the
  // thumbnail for the grey fallback tile and back — the flicker into a
  // "disabled-looking" ghost. The ghost is a transient, read-only picture of
  // what is being dragged, so it may only ever GAIN detail, never lose it.
  // (State adjusted during render, not a ref: reading or writing a ref while
  // rendering is a lint error here, and this is the documented pattern.)
  const [bestFrames, setBestFrames] = useState(derivedFrames);
  if (derivedFrames.length > bestFrames.length) setBestFrames(derivedFrames);
  const frames = derivedFrames.length >= bestFrames.length ? derivedFrames : bestFrames;

  return (
    // Slightly transparent so the breadcrumb drop zones read THROUGH the ghost
    // while dragging over them — the user can see where they're aiming.
    <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-zinc-900 opacity-80 shadow-2xl ring-2 ring-blue-500">
      {frames.length > 0 ? (
        <span className="flex h-full w-full gap-px">
          {frames.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={src}
              alt=""
              draggable={false}
              className="h-full min-w-0 flex-1 object-cover"
            />
          ))}
        </span>
      ) : isCollection ? (
        <span
          data-empty-collection-ghost
          className="flex h-full w-full items-center justify-center"
        >
          <CollectionGhostGlyph className="h-7 w-7 text-sky-200" />
        </span>
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <span className="truncate text-[11px] font-semibold text-zinc-100">{node.name}</span>
          <span className="font-mono text-[11px] text-zinc-400">
            {formatSeconds(mediaDurationSeconds(node))}
          </span>
        </span>
      )}
      {extraCount > 0 && (
        <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-blue-500 px-1 text-[11px] font-bold text-black shadow">
          +{extraCount}
        </span>
      )}
    </span>
  );
});
