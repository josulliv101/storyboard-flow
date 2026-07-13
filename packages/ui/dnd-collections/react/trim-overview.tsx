"use client";

import { memo, useCallback, type PointerEvent as ReactPointerEvent } from "react";

import { type VideoMediaNode } from "../core/graph";
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

export const TrimOverviewStrip = memo(function TrimOverviewStrip({
  node,
  pixelsPerSecond,
  trimInSeconds,
  trimOutSeconds,
}: {
  node: VideoMediaNode;
  pixelsPerSecond: number;
  /** Live values during a drag override the node's committed trim. */
  trimInSeconds: number;
  trimOutSeconds: number;
}) {
  const full = Math.max(0, node.fullDurationSeconds);
  const trimIn = Math.max(0, trimInSeconds);
  const trimOut = Math.max(0, trimOutSeconds);
  const showing = Math.max(0, full - trimIn - trimOut);

  const fullWidth = Math.max(1, full * pixelsPerSecond);
  const trimInWidth = trimIn * pixelsPerSecond;
  const windowWidth = Math.max(2, showing * pixelsPerSecond);

  const posters = node.posterSrcs ?? [];
  // Enough square frames to cover the strip width (ceil so the row fills; the
  // container clips the overflow), capped so a long source stays bounded.
  const frameCount = Math.max(1, Math.min(40, Math.ceil(fullWidth / FRAME_SIZE)));

  const beginDrag = useTrimPointerDrag(node);
  const startTrim = useCallback(
    (side: TrimSide) => (event: ReactPointerEvent) =>
      beginDrag(event, pixelsPerSecond, (delta) => resolveTrim(node, side, delta)),
    [beginDrag, node, pixelsPerSecond]
  );
  const startMove = useCallback(
    (event: ReactPointerEvent) => beginDrag(event, pixelsPerSecond, (delta) => resolveMove(node, delta)),
    [beginDrag, node, pixelsPerSecond]
  );

  return (
    <div
      data-trim-overview={node.id}
      // Dragging the filmstrip (anywhere but the amber grips, which
      // stopPropagation) MOVES the source window.
      onPointerDown={startMove}
      className="relative h-11 cursor-grab touch-none overflow-hidden rounded-md select-none active:cursor-grabbing"
      style={{ width: fullWidth }}
    >
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

      {/* Dim the trimmed room on each side. */}
      <div className="absolute inset-y-0 left-0 bg-background/55" style={{ width: trimInWidth }} />
      <div
        className="absolute inset-y-0 right-0 bg-background/55"
        style={{ width: trimOut * pixelsPerSecond }}
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

      {/* Full-clip readout. */}
      <span className="pointer-events-none absolute top-0.5 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-2 py-0.5 font-mono text-[9px] text-zinc-100 select-none">
        full clip {fmt1(full)}
      </span>
    </div>
  );
});
