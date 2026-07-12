"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { type MediaNode } from "../core/graph";
import { type MediaUpdate } from "../core/commands";
import { useCollectionsStore } from "./collections-store";

// Edge drag-handles that TRIM a media item: a right handle on every media
// card, plus a left handle on video (which can trim its start too). The
// gesture converts pointer pixels to seconds via `pixelsPerSecond` (the
// caller's timeline scale — the same one its `itemWidthFor` uses), previews a
// clamped value while dragging, and commits ONE `update-media` on release
// (undoable). The card resizes on commit, not during the drag — live-resize
// would force the virtualizer to re-measure every frame, which the package
// deliberately avoids.
//
// The handles are SIBLINGS of the draggable card button (not children), so a
// pointerdown on a handle never reaches dnd-kit's item-drag sensor. They also
// carry `data-trim-handle` so the strip's pan gesture skips them.

type TrimSide = "left" | "right";

/** The clamped result of dragging a handle by `deltaSeconds`. */
function resolveTrim(
  node: MediaNode,
  side: TrimSide,
  deltaSeconds: number
): { update: MediaUpdate; effectiveSeconds: number } {
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
    };
  }
  // Image: the right edge sets the duration directly (outward = longer).
  const durationSeconds = Math.max(0, node.durationSeconds + deltaSeconds);
  return { update: { mediaKind: "image", durationSeconds }, effectiveSeconds: durationSeconds };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

const HANDLE_CLASS =
  "absolute inset-y-0 z-20 w-1.5 cursor-ew-resize bg-primary/70 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100";

export function TrimHandles({
  node,
  pixelsPerSecond,
}: {
  node: MediaNode;
  pixelsPerSecond: number;
}) {
  const store = useCollectionsStore();
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
        const { update, effectiveSeconds } = resolveTrim(startNode, side, deltaSeconds);
        pendingRef.current = update;
        setPreview(effectiveSeconds);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setPreview(null);
        const update = pendingRef.current;
        pendingRef.current = null;
        if (update) store.dispatch({ type: "update-media", nodeId: node.id, update });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [node, pixelsPerSecond, store]
  );

  const showLeft = node.mediaKind === "video";

  return (
    <>
      {showLeft && (
        <div
          data-trim-handle="left"
          className={`${HANDLE_CLASS} left-0 rounded-l-md`}
          onPointerDown={(event) => startTrim("left", event)}
        />
      )}
      <div
        data-trim-handle="right"
        className={`${HANDLE_CLASS} right-0 rounded-r-md`}
        onPointerDown={(event) => startTrim("right", event)}
      />
      {preview !== null && (
        <div
          data-trim-preview={preview}
          className="pointer-events-none absolute -top-5 left-1/2 z-30 -translate-x-1/2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground shadow"
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
