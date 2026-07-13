"use client";

import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";

import { mediaDurationSeconds, type MediaNode } from "../core/graph";
import { resolveTrim, useTrimPointerDrag, type TrimSide } from "./trim-gesture";

// Edge drag-handles that TRIM a media item: a right handle on every media
// card, plus a left handle on video (which can trim its start too). The
// gesture converts pointer pixels to seconds via `pixelsPerSecond` (the
// caller's timeline scale — the same one its `itemWidthFor` uses) and commits
// ONE `update-media` on release (undoable). The card resizes LIVE as the
// handle drags, via the view's `TrimPreview` — a targeted single-item resize
// (no full re-measure, no per-frame graph churn). The commit lands only on
// release; an aborted drag snaps back. The pointer lifecycle is shared with
// the overview handles/move via `useTrimPointerDrag` (see trim-gesture.ts).
//
// The handles are SIBLINGS of the draggable card button (not children), so a
// pointerdown on a handle never reaches dnd-kit's item-drag sensor. They also
// carry `data-trim-handle` so the strip's pan gesture skips them.

// Amber edge handles (matching the app's source-window handles): thicker,
// with a grip line, visible-on-hover so the card stays clean at rest.
const HANDLE_CLASS =
  "absolute inset-y-0 z-20 flex w-2 cursor-ew-resize items-center justify-center bg-amber-300 opacity-70 transition-opacity hover:opacity-100 group-hover:opacity-100";

export function TrimHandles({
  node,
  pixelsPerSecond,
}: {
  node: MediaNode;
  pixelsPerSecond: number;
}) {
  const beginDrag = useTrimPointerDrag(node);
  const [preview, setPreview] = useState<number | null>(null);

  const startTrim = useCallback(
    (side: TrimSide, event: ReactPointerEvent<HTMLDivElement>) => {
      beginDrag(
        event,
        pixelsPerSecond,
        (deltaSeconds) => resolveTrim(node, side, deltaSeconds),
        (live) => setPreview(live ? live.effectiveSeconds : null)
      );
    },
    [beginDrag, node, pixelsPerSecond]
  );

  const showLeft = node.mediaKind === "video";
  const durationPill =
    node.mediaKind === "video"
      ? `${mediaDurationSeconds(node).toFixed(2)}s / ${node.fullDurationSeconds.toFixed(2)}s`
      : `${node.durationSeconds.toFixed(2)}s`;

  return (
    <>
      {showLeft && (
        <div
          data-trim-handle="left"
          className={`${HANDLE_CLASS} left-0 rounded-l-md`}
          onPointerDown={(event) => startTrim("left", event)}
        >
          <span className="h-4 w-0.5 rounded bg-black/45" />
        </div>
      )}
      <div
        data-trim-handle="right"
        className={`${HANDLE_CLASS} right-0 rounded-r-md`}
        onPointerDown={(event) => startTrim("right", event)}
      >
        <span className="h-4 w-0.5 rounded bg-black/45" />
      </div>

      {/* Showing/full readout pill (bottom-right), matching the app. */}
      <span
        data-trim-pill
        className="pointer-events-none absolute right-1 bottom-1 z-20 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-zinc-100 tabular-nums select-none"
      >
        {durationPill}
      </span>

      {preview !== null && (
        <div
          data-trim-preview={preview}
          className="pointer-events-none absolute -top-5 left-1/2 z-30 -translate-x-1/2 rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-black shadow"
        >
          {round1(preview)}s
        </div>
      )}
    </>
  );
}

function round1(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
