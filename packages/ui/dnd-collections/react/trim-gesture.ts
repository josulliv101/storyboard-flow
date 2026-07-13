"use client";

import { useCallback, type PointerEvent as ReactPointerEvent } from "react";

import { type MediaNode, type VideoMediaNode } from "../core/graph";
import { type MediaUpdate } from "../core/commands";
import { useCollectionsStore } from "./collections-store";
import { useTrimPreview, type LiveTrim } from "./trim-preview-context";

// Shared trim-gesture core for BOTH the card edge handles (`trim-handles.tsx`)
// and the overview window handles + filmstrip move (`trim-overview.tsx`):
// convert pointer pixels to seconds at the caller's scale, publish a LIVE
// preview per move (no graph mutation), and commit ONE `update-media` on
// release (undoable) — an aborted/no-op drag snaps back. Keeping the
// pointer lifecycle here means every trim surface behaves identically.

export type TrimSide = "left" | "right";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Resolve a TRIM (duration changes): a right handle on every media (image
 *  duration / video trim-out) and a left handle on video (trim-in). Returns
 *  the `update` to commit plus the `live` split to preview. */
export function resolveTrim(
  node: MediaNode,
  side: TrimSide,
  deltaSeconds: number
): { update: MediaUpdate; live: LiveTrim } {
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
        live: {
          side,
          trimInSeconds,
          trimOutSeconds: node.trimOutSeconds,
          effectiveSeconds: node.fullDurationSeconds - trimInSeconds - node.trimOutSeconds,
        },
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
      live: {
        side,
        trimInSeconds: node.trimInSeconds,
        trimOutSeconds,
        effectiveSeconds: node.fullDurationSeconds - node.trimInSeconds - trimOutSeconds,
      },
    };
  }
  // Image: the right edge sets the duration directly (outward = longer).
  const durationSeconds = Math.max(0, node.durationSeconds + deltaSeconds);
  return {
    update: { mediaKind: "image", durationSeconds },
    live: { side, trimInSeconds: 0, trimOutSeconds: 0, effectiveSeconds: durationSeconds },
  };
}

/** Resolve a MOVE (video only): slide the source window without changing the
 *  showing duration — trim-in and trim-out shift together. Dragging the
 *  filmstrip RIGHT (+delta) reveals EARLIER frames (trim-in decreases). The
 *  effective duration (and so the card width) is unchanged. */
export function resolveMove(
  node: VideoMediaNode,
  deltaSeconds: number
): { update: MediaUpdate; live: LiveTrim } {
  const showing = Math.max(0, node.fullDurationSeconds - node.trimInSeconds - node.trimOutSeconds);
  const room = Math.max(0, node.fullDurationSeconds - showing); // trim-in + trim-out
  const trimInSeconds = clamp(node.trimInSeconds - deltaSeconds, 0, room);
  const trimOutSeconds = Math.max(0, room - trimInSeconds);
  return {
    update: { mediaKind: "video", trimInSeconds, trimOutSeconds },
    live: { side: "move", trimInSeconds, trimOutSeconds, effectiveSeconds: showing },
  };
}

/**
 * The pointer-drag lifecycle shared by every trim surface. Returns a
 * `beginDrag(event, pixelsPerSecond, resolve, onLive?)` to call from an
 * `onPointerDown`: it captures the pointer, previews each move via the view's
 * `TrimPreview`, and commits/aborts on release. `resolve` maps the drag's
 * delta-seconds to the update + live split; `onLive` is an optional hook for
 * local UI (e.g. the card's readout pill), called with the live split per
 * move and `null` on end.
 */
export function useTrimPointerDrag(
  node: MediaNode
): (
  event: ReactPointerEvent,
  pixelsPerSecond: number,
  resolve: (deltaSeconds: number) => { update: MediaUpdate; live: LiveTrim },
  onLive?: (live: LiveTrim | null) => void
) => void {
  const store = useCollectionsStore();
  const trimPreview = useTrimPreview();
  return useCallback(
    (event, pixelsPerSecond, resolve, onLive) => {
      if (event.button !== 0 || pixelsPerSecond <= 0) return;
      // Keep the gesture off dnd-kit's item drag, the strip's pan, and (for
      // an overview grip) the overview's own move handler.
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      let pending: MediaUpdate | null = null;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* untrusted pointer (tests) — window listeners below suffice */
      }

      const onMove = (moveEvent: PointerEvent) => {
        const { update, live } = resolve((moveEvent.clientX - startX) / pixelsPerSecond);
        pending = update;
        onLive?.(live);
        trimPreview.previewTrim(node.id, live);
      };
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        onLive?.(null);
        const update = pending;
        pending = null;
        if (upEvent.type === "pointercancel" || !update) {
          // Aborted (or a no-op click): drop the live preview, snapping back.
          trimPreview.previewTrim(node.id, null);
          return;
        }
        // Commit. The view reconciles to the new data (its last preview
        // already matches), so there is no flash.
        const dispatched = store.dispatch({ type: "update-media", nodeId: node.id, update });
        // A no-op (for example, moving away and returning to the committed
        // value before release) does not change graph identity, so views
        // cannot rely on their commit effect to clear the live preview.
        if (!dispatched.ok) trimPreview.previewTrim(node.id, null);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [node, store, trimPreview]
  );
}
