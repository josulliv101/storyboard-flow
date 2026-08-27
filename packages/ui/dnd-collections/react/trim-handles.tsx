"use client";

import { memo, useCallback, type PointerEvent as ReactPointerEvent } from "react";

import {
  hasSourceWindow, type MediaNode } from "@storyboard/collections-core/graph";
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
// defaulting to the blue grip bar below. Duration readouts (the pill, the
// live preview bubble) are CONTENT, not handle chrome: the default ones live
// in `DefaultItemContent`, driven by `useLiveTrim`.

/** The stock handle pixels: blue fill, visible-on-hover, center grip line. */
export const DefaultTrimHandleContent = memo(function DefaultTrimHandleContent({
  side,
}: CollectionTrimHandleContentProps) {
  return (
    <span
      className={[
        "flex h-full w-full items-center justify-center bg-blue-500 opacity-70 transition-opacity hover:opacity-100 group-hover:opacity-100",
        // Armed: the press settled and the next pull trims. Full opacity is
        // the smallest thing that reads as a state change without moving any
        // geometry — the handle must not resize under the finger holding it.
        "group-data-[trim-armed=true]/trim:opacity-100",
        side === "left" ? "rounded-l-md" : "rounded-r-md",
      ].join(" ")}
    >
      <span className="h-4 w-0.5 rounded bg-black/45 transition-[height] group-data-[trim-armed=true]/trim:h-full" />
    </span>
  );
});

/**
 * Shell-owned hit zone: geometry + gesture; pixels from TrimHandleContent.
 *
 * 8px is a pointer-FINE number. A thumb needs about 44, so on a coarse pointer
 * the reachable area grows to that via an `after:` pseudo while the drawn
 * handle stays 8px wide — target and ink are separate, and inflating what you
 * can SEE to thumb size would bury the clip it belongs to.
 *
 * IT GROWS INWARD, over its own clip. Clips in a strip sit flush, so a target
 * that overhung outward would land on the neighbour's — and on video, whose
 * left handle is right there at that edge, the two would be the same pixels
 * disagreeing about which one the touch meant.
 */
const HIT_ZONE_CLASS =
  // `group/trim` is the seam for the ARMED state. On a pannable surface a
  // press does not trim until it settles (see `trimArmDelayFor`), and the
  // gesture writes `data-trim-armed` here when it does; content reads it as
  // `group-data-[trim-armed=true]/trim:…`. Named so it cannot be confused with
  // the card-level group content already uses for hover. Still shell-only —
  // the shell publishes the state, content decides what it looks like.
  "group/trim absolute inset-y-0 z-20 w-2 cursor-ew-resize " +
  "after:absolute after:inset-y-0 after:w-2 after:content-[''] " +
  "[@media(pointer:coarse)]:after:w-11";

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

  // A START EDGE EXISTS FOR ANYTHING WINDOWED — video and audio both window
  // into a longer source. An image has no source length, so its only edge is
  // the right one, which sets the duration directly.
  //
  // This asked `mediaKind === "video"` while audio's trim was unshipped, which
  // left an audio card drawing a right handle that did nothing.
  const showLeft = hasSourceWindow(node);

  return (
    <>
      {/* Pointer-only affordances: not focusable and aria-hidden. The
          accessible way to trim is the focused card + Alt+Shift+Arrows
          (see use-keyboard-controller / the sr-only instructions). */}
      {showLeft && (
        <div
          data-trim-handle="left"
          aria-hidden="true"
          className={`${HIT_ZONE_CLASS} left-0 after:left-0`}
          onPointerDown={(event) => startTrim("left", event)}
        >
          <TrimHandleContent side="left" node={node} selected={selected} pixelsPerSecond={pixelsPerSecond} />
        </div>
      )}
      <div
        data-trim-handle="right"
        aria-hidden="true"
        className={`${HIT_ZONE_CLASS} right-0 after:right-0`}
        onPointerDown={(event) => startTrim("right", event)}
      >
        <TrimHandleContent side="right" node={node} selected={selected} pixelsPerSecond={pixelsPerSecond} />
      </div>
    </>
  );
}
