"use client";

import { memo, useCallback, type PointerEvent as ReactPointerEvent } from "react";

import { type VideoMediaNode } from "../core/graph";
import {
  useCollectionsComponents,
  type CollectionTrimOverviewContentProps,
} from "./collections-components";
import { resolveMove, resolveTrim, useTrimPointerDrag, type TrimSide } from "./trim-gesture";

// Source-window overview for a SELECTED video: the FULL source rendered as a
// poster filmstrip, with an amber window marking what's currently showing
// (positioned by the trim-in offset, sized to the showing duration) and the
// trimmed room dimmed on each side. Mirrors the app's video-source-filmstrip.
//
// It renders its content at its own origin (width = full source); the caller
// (VirtualStrip) positions it — as a floating tooltip above the clip — so its
// amber window's left/right edges land on the clip's rendered edges. The
// window sits `trimInSeconds * pixelsPerSecond` in from this component's left,
// so the caller places the left edge at `clipLeft - trimInSeconds * pps`.
// `trimInSeconds`/`trimOutSeconds` are passed in (not read from the node) so a
// live drag can override the committed values before they land.
//
// It's interactive: the window's amber grips TRIM (left = trim-in, right =
// trim-out — the same `update-media` the card handles dispatch, via the same
// shared gesture), and dragging the filmstrip elsewhere MOVES the source
// window (trim-in/out together, showing constant). Because the window sits at
// `anchorLeft + trimInWidth == clipLeft` for any trim-in, a move keeps the
// window locked on the clip while the source slides under it.

const fmt1 = (s: number) => `${(Math.round(s * 10) / 10).toFixed(1)}s`;

// The strip is `h-11` (44px) tall; square frames are that wide too. Frames are
// fixed-size and the strip clips the partial last one (overflow-hidden), so
// each thumbnail keeps a 1:1 aspect instead of stretching to fill the width.
const FRAME_SIZE = 44;

/** The stock overview background: the full-source poster filmstrip plus the
 *  "full clip" readout. Consumers replace it via the `OverviewContent`
 *  registry slot; the dims/window/grips/move gesture stay package-owned.
 *
 *  Memo comparator: the contract carries live trimIn/trimOut (changing per
 *  pointer move during a drag), but THIS renderer reads only `node` and
 *  `fullWidth` — a shallow memo would reconcile up to 40 <img> elements per
 *  move for nothing. Custom OverviewContent components that DO read the trim
 *  values get standard shallow memo semantics (they registered their own
 *  component, not this one). */
const defaultOverviewPropsEqual = (
  prev: CollectionTrimOverviewContentProps,
  next: CollectionTrimOverviewContentProps
): boolean =>
  prev.node === next.node &&
  prev.pixelsPerSecond === next.pixelsPerSecond &&
  prev.fullWidth === next.fullWidth;

export const DefaultTrimOverviewContent = memo(function DefaultTrimOverviewContent({
  node,
  fullWidth,
}: CollectionTrimOverviewContentProps) {
  const posters = node.posterSrcs ?? [];
  // Enough square frames to cover the strip width (ceil so the row fills; the
  // container clips the overflow), capped so a long source stays bounded.
  const frameCount = Math.max(1, Math.min(40, Math.ceil(fullWidth / FRAME_SIZE)));
  return (
    <>
      {/* Full-source filmstrip. */}
      <div className="flex h-full w-full">
        {posters.length === 0 ? (
          <span className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground select-none">
            No preview frames
          </span>
        ) : (
          Array.from({ length: frameCount }).map((_, i) => (
            <img
              key={i}
              src={posters[i % posters.length]}
              alt=""
              draggable={false}
              style={{ width: FRAME_SIZE }}
              className="h-full shrink-0 border-r border-black/60 object-cover last:border-r-0"
            />
          ))
        )}
      </div>

      {/* Full-clip readout. */}
      <span className="pointer-events-none absolute top-0.5 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-2 py-0.5 font-mono text-[9px] text-zinc-100 select-none">
        full clip {fmt1(Math.max(0, node.fullDurationSeconds))}
      </span>
    </>
  );
}, defaultOverviewPropsEqual);

export const TrimOverviewStrip = memo(function TrimOverviewStrip({
  node,
  pixelsPerSecond,
  trimInSeconds,
  trimOutSeconds,
  width,
}: {
  node: VideoMediaNode;
  /** The timeline scale. Optional only because `width` replaces it: a fitted
   *  strip derives its own scale and never reads this. */
  pixelsPerSecond?: number;
  /** Live values during a drag override the node's committed trim. */
  trimInSeconds: number;
  trimOutSeconds: number;
  /**
   * FITTED mode: render the whole source into exactly this many pixels, at a
   * scale of its own (`width / fullDuration`) instead of the timeline's.
   *
   * Unset keeps the original behavior — source at timeline scale, which makes
   * the amber window exactly as wide as the clip on the strip and lets the
   * caller lay the two on top of each other. That alignment is the reason the
   * strip is otherwise unbounded: width grows with source duration, so a long
   * source runs off the viewport in both directions and the one thing the
   * overview exists to show (the WHOLE source) is the thing you cannot see.
   * A fitted strip trades the alignment for always fitting, which is why the
   * consumer that fits it also has to place the frame preview itself — see
   * the graph view's trim panel.
   */
  width?: number;
}) {
  const full = Math.max(0, node.fullDurationSeconds);
  const trimIn = Math.max(0, trimInSeconds);
  const trimOut = Math.max(0, trimOutSeconds);
  const showing = Math.max(0, full - trimIn - trimOut);

  const fitted = width !== undefined && width > 0;
  const fullWidth = fitted ? width : Math.max(1, full * (pixelsPerSecond ?? 0));
  // Seconds→pixels for EVERYTHING this component draws and drags. Fitted, one
  // pixel covers more source, so gestures here are coarser by exactly the
  // ratio the picture shrank by — the pointer keeps landing where it looks
  // like it lands, which is the property that has to hold.
  const scale = fitted && full > 0 ? fullWidth / full : (pixelsPerSecond ?? 0);
  const trimInWidth = trimIn * scale;
  const windowWidth = Math.max(2, showing * scale);

  const OverviewContent =
    useCollectionsComponents().OverviewContent ?? DefaultTrimOverviewContent;

  const beginDrag = useTrimPointerDrag(node);
  const startTrim = useCallback(
    (side: TrimSide) => (event: ReactPointerEvent) =>
      beginDrag(event, scale, (delta) => resolveTrim(node, side, delta)),
    [beginDrag, node, scale]
  );
  const startMove = useCallback(
    (event: ReactPointerEvent) =>
      // Same command, opposite sign, because the two modes move different
      // things. Unfitted, the caller keeps the WINDOW pinned over the clip and
      // this whole element slides, so the gesture is "drag the film": pull the
      // film left and a later part of the source ends up in the window.
      // Fitted, the film is nailed to the panel and the window is what moves,
      // so the same pull-left would send the window right — backwards from
      // what the picture says. Here the gesture is direct manipulation of the
      // window instead: drag right, window goes right.
      beginDrag(event, scale, (delta) => resolveMove(node, fitted ? -delta : delta)),
    [beginDrag, node, scale, fitted]
  );

  return (
    <div
      data-trim-overview={node.id}
      // Pointer-only source-window visualization: aria-hidden so assistive
      // tech isn't led into an unlabeled filmstrip. Every operation it
      // offers has a keyboard equivalent on the focused card: Alt+Shift+
      // Arrows trim the edges, Alt+Shift+Home/End slide the source window.
      aria-hidden="true"
      // Dragging the filmstrip (anywhere but the amber grips, which
      // stopPropagation) MOVES the source window.
      onPointerDown={startMove}
      className="relative h-11 cursor-grab touch-none overflow-hidden rounded-md select-none active:cursor-grabbing"
      style={{ width: fullWidth }}
    >
      {/* Background pixels (filmstrip + labels): the OverviewContent slot. */}
      <OverviewContent
        node={node}
        pixelsPerSecond={scale}
        trimInSeconds={trimIn}
        trimOutSeconds={trimOut}
        fullWidth={fullWidth}
      />

      {/* Dim the trimmed room on each side.
          Lighter when FITTED, because the proportions invert: at timeline
          scale the room is a margin around the window, but fitted, a short
          clip of a long source means the room is nearly the whole strip — and
          at 55% over dark frames that reads as an empty black bar, which is
          the one thing this control cannot afford to look like. The amber
          window's border and tint carry the distinction there. */}
      <div
        className={fitted ? "absolute inset-y-0 left-0 bg-background/30" : "absolute inset-y-0 left-0 bg-background/55"}
        style={{ width: trimInWidth }}
      />
      <div
        className={fitted ? "absolute inset-y-0 right-0 bg-background/30" : "absolute inset-y-0 right-0 bg-background/55"}
        style={{ width: trimOut * scale }}
      />

      {/* The amber "showing" window, with draggable trim grips on each edge. */}
      <div
        data-trim-overview-window
        className="absolute inset-y-0 rounded-sm border-2 border-amber-300 bg-amber-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ width: windowWidth, transform: `translateX(${trimInWidth}px)` }}
      >
        <span
          data-trim-overview-handle="left"
          onPointerDown={startTrim("left")}
          className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize rounded-l-sm bg-amber-200/90"
        />
        <span
          data-trim-overview-handle="right"
          onPointerDown={startTrim("right")}
          className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-r-sm bg-amber-200/90"
        />
      </div>
    </div>
  );
});
