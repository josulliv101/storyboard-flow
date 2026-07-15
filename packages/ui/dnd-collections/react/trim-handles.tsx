"use client";

import { memo, useCallback, type PointerEvent as ReactPointerEvent } from "react";

import { type MediaNode } from "../core/graph";
import {
  useCollectionsComponents,
  type CollectionTrimHandleContentProps,
} from "./collections-components";
import { resolveTrim, useTrimPointerDrag, type TrimSide } from "./trim-gesture";

// Edge drag-handles that TRIM a media item: a right handle on every media
// card, plus a left handle on video (which can trim its start too). The
// gesture converts pointer pixels to seconds via `pixelsPerSecond` (the
// caller's timeline scale) and commits ONE `update-media` on release
// (undoable); the card resizes LIVE via the view's `TrimPreview`.
//
// The shell/content split applies here exactly like the card: the package
// owns the HIT ZONES — positioning, width, cursor, the pointer gesture, and
// the sibling-of-the-button DOM shape (load-bearing: a handle press must
// never reach dnd-kit's item-drag sensor or the strip's pan; they also carry
// `data-trim-handle` so the pan's surface filter skips them) — while the
// pixels INSIDE each zone come from the `TrimHandleContent` registry slot,
// defaulting to the amber grip bar below. Duration readouts (the pill, the
// live preview bubble) are CONTENT, not handle chrome: the default ones live
// in `DefaultItemContent`, driven by `useLiveTrim`.

/** The stock handle pixels: amber fill, visible-on-hover, center grip line. */
export const DefaultTrimHandleContent = memo(function DefaultTrimHandleContent({
  side,
}: CollectionTrimHandleContentProps) {
  return (
    <span
      className={[
        "flex h-full w-full items-center justify-center bg-amber-300 opacity-70 transition-opacity hover:opacity-100 group-hover:opacity-100",
        side === "left" ? "rounded-l-md" : "rounded-r-md",
      ].join(" ")}
    >
      <span className="h-4 w-0.5 rounded bg-black/45" />
    </span>
  );
});

/** Shell-owned hit zone: geometry + gesture; pixels from TrimHandleContent. */
const HIT_ZONE_CLASS = "absolute inset-y-0 z-20 w-2 cursor-ew-resize";

export function TrimHandles({
  node,
  pixelsPerSecond,
  selected,
}: {
  node: MediaNode;
  pixelsPerSecond: number;
  selected: boolean;
}) {
  const beginDrag = useTrimPointerDrag(node);
  const TrimHandleContent =
    useCollectionsComponents().TrimHandleContent ?? DefaultTrimHandleContent;

  const startTrim = useCallback(
    (side: TrimSide, event: ReactPointerEvent<HTMLDivElement>) => {
      beginDrag(event, pixelsPerSecond, (deltaSeconds) => resolveTrim(node, side, deltaSeconds));
    },
    [beginDrag, node, pixelsPerSecond]
  );

  const showLeft = node.mediaKind === "video";

  return (
    <>
      {/* Pointer-only affordances: not focusable and aria-hidden. The
          accessible way to trim is the focused card + Alt+Shift+Arrows
          (see use-keyboard-controller / the sr-only instructions). */}
      {showLeft && (
        <div
          data-trim-handle="left"
          aria-hidden="true"
          className={`${HIT_ZONE_CLASS} left-0`}
          onPointerDown={(event) => startTrim("left", event)}
        >
          <TrimHandleContent side="left" node={node} selected={selected} />
        </div>
      )}
      <div
        data-trim-handle="right"
        aria-hidden="true"
        className={`${HIT_ZONE_CLASS} right-0`}
        onPointerDown={(event) => startTrim("right", event)}
      >
        <TrimHandleContent side="right" node={node} selected={selected} />
      </div>
    </>
  );
}
