"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { mediaDurationSeconds, type MediaNode } from "../core/graph";
import { type MediaUpdate } from "../core/commands";
import { useCollectionsStore } from "./collections-store";
import { useTrimPreview, type LiveTrim } from "./trim-preview-context";

// Edge drag-handles that TRIM a media item: a right handle on every media
// card, plus a left handle on video (which can trim its start too). The
// gesture converts pointer pixels to seconds via `pixelsPerSecond` (the
// caller's timeline scale — the same one its `itemWidthFor` uses) and commits
// ONE `update-media` on release (undoable). The card resizes LIVE as the
// handle drags, via the view's `TrimPreview` — a targeted single-item resize
// (no full re-measure, no per-frame graph churn). The commit lands only on
// release; an aborted drag snaps back.
//
// The handles are SIBLINGS of the draggable card button (not children), so a
// pointerdown on a handle never reaches dnd-kit's item-drag sensor. They also
// carry `data-trim-handle` so the strip's pan gesture skips them.

type TrimSide = "left" | "right";

/** The clamped result of dragging a handle by `deltaSeconds`. `trimInSeconds`/
 *  `trimOutSeconds` are the full pair (video only; 0 for images) — needed so a
 *  view can position trim-in-dependent UI (the overview window) live, not
 *  just react to the resulting effective duration. */
function resolveTrim(
  node: MediaNode,
  side: TrimSide,
  deltaSeconds: number
): {
  update: MediaUpdate;
  effectiveSeconds: number;
  trimInSeconds: number;
  trimOutSeconds: number;
} {
  if (node.mediaKind === "video") {
    if (side === "left") {
      // Left edge inward (right, +delta) trims MORE off the start.
      const trimInSeconds = clamp(
        node.trimInSeconds + deltaSeconds,
        0,
        node.fullDurationSeconds - node.trimOutSeconds
      );
      return {
        update: { mediaKind: "video", trimInSeconds },
        effectiveSeconds: node.fullDurationSeconds - trimInSeconds - node.trimOutSeconds,
        trimInSeconds,
        trimOutSeconds: node.trimOutSeconds,
      };
    }
    // Right edge inward (left, -delta) trims MORE off the end.
    const trimOutSeconds = clamp(
      node.trimOutSeconds - deltaSeconds,
      0,
      node.fullDurationSeconds - node.trimInSeconds
    );
    return {
      update: { mediaKind: "video", trimOutSeconds },
      effectiveSeconds: node.fullDurationSeconds - node.trimInSeconds - trimOutSeconds,
      trimInSeconds: node.trimInSeconds,
      trimOutSeconds,
    };
  }
  // Image: the right edge sets the duration directly (outward = longer).
  const durationSeconds = Math.max(0, node.durationSeconds + deltaSeconds);
  return {
    update: { mediaKind: "image", durationSeconds },
    effectiveSeconds: durationSeconds,
    trimInSeconds: 0,
    trimOutSeconds: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

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
  const store = useCollectionsStore();
  const trimPreview = useTrimPreview();
  const [preview, setPreview] = useState<number | null>(null);
  // Holds the latest resolved update across pointermove callbacks, committed
  // once on pointerup.
  const pendingRef = useRef<MediaUpdate | null>(null);

  const startTrim = useCallback(
    (side: TrimSide, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || pixelsPerSecond <= 0) return;
      // Keep the gesture off dnd-kit's item drag and the strip's pan.
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startNode = node; // snapshot — the graph doesn't change until commit
      pendingRef.current = null;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* untrusted pointer (tests) — window listeners below suffice */
      }

      const onMove = (moveEvent: PointerEvent) => {
        const deltaSeconds = (moveEvent.clientX - startX) / pixelsPerSecond;
        const { update, effectiveSeconds, trimInSeconds, trimOutSeconds } = resolveTrim(
          startNode,
          side,
          deltaSeconds
        );
        pendingRef.current = update;
        setPreview(effectiveSeconds);
        // Live-resize the card AND publish the live trim split (view state
        // only; the graph commits on release).
        trimPreview.previewTrim(node.id, { trimInSeconds, trimOutSeconds, effectiveSeconds });
      };
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setPreview(null);
        const update = pendingRef.current;
        pendingRef.current = null;
        if (upEvent.type === "pointercancel" || !update) {
          // Aborted (or a no-op): drop the live preview, snapping the card
          // back to its committed size — nothing is dispatched.
          trimPreview.previewTrim(node.id, null);
          return;
        }
        // Commit. The view reconciles the card to the new data (its last
        // preview size already matches), so there is no resize flash.
        store.dispatch({ type: "update-media", nodeId: node.id, update });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [node, pixelsPerSecond, store, trimPreview]
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
