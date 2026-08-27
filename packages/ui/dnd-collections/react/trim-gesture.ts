"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  hasSourceWindow,
  mediaDurationSeconds,
  type MediaNode,
  type VideoMediaNode,
} from "@storyboard/collections-core/graph";
import { type MediaUpdate } from "@storyboard/collections-core/commands";
import { useCollectionsStore } from "./collections-store";
import {
  HOLD_DRAG_TOLERANCE_PX,
  PAN_SURFACE_ATTR,
  TRIM_ARM_DELAY_MS,
} from "./gesture-thresholds";
import { useLiveTrimPublisher } from "./live-trim";
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

/**
 * THE SHORTEST A TRIM MAY LEAVE A CLIP.
 *
 * Each edge used to be clamped only against the OTHER edge — `trimIn` up to
 * `full - trimOut`, `trimOut` up to `full - trimIn` — which forbids crossing
 * and permits MEETING. So an edge could be dragged through the middle of the
 * clip and out the far side, leaving a window of zero, and nothing else
 * stopped it: `MAX_HANDLE_SHARE` only decides whether a handle is DRAWN on a
 * short clip and does nothing to a drag already under way (PL15-015).
 *
 * ONE QUANTUM — the 0.1s grid, the smallest floor that can be expressed — and
 * it started at a quarter second before the tests said otherwise.
 *
 * 0.25 was a judgement: small enough not to refuse a real edit, large enough
 * that what is left is still a clip you can grab. `VirtualStrip.stories` then
 * failed asserting `0.10s / 10.00s`, which is a SHIPPED, TESTED trim that the
 * floor had quietly made impossible. That is the exact risk this item was
 * warned about — a floor picked for feel forbidding work somebody relies on —
 * and the test is the evidence, so the floor gives way rather than the test.
 *
 * What is left is narrow and safe: it rules out the degenerate window and
 * nothing else. If a larger floor is genuinely wanted it is this one constant,
 * but it needs to be chosen against the trims people actually make rather than
 * against how it feels to drag.
 *
 * NOT A HALFWAY STOP. The other reading of "the end cannot be dragged to the
 * middle" is that neither edge may pass the clip's midpoint, so no single edge
 * can take more than half. That is a much stronger rule and it forbids
 * legitimate work — keeping the last two seconds of a ten-second take is one
 * edge doing eighty per cent of it. Left unbuilt deliberately; it is the same
 * two lines if it turns out to be what was wanted.
 */
export const MIN_TRIM_WINDOW_SECONDS = 0.1;

/**
 * Whether a trim currently OWNS the pointer, for the pan hook's
 * `isGestureClaimed`.
 *
 * Module-scoped for the reason `interaction-policy`'s pending selection is:
 * pointer gestures are serial. One primary pointer produces one press at a
 * time, so there is never a second armed trim to track, and keeping the flag
 * here means the pan can ask without either side holding a reference to the
 * other.
 */
let armedTrimGesture = false;

export function isTrimGestureArmed(): boolean {
  return armedTrimGesture;
}

/**
 * The dwell this press owes before it may trim: the full delay on a surface
 * that pans, nothing anywhere else.
 *
 * Asked of the pressed element rather than passed in by each handle, so every
 * trim surface — the card's edge handles, the overview's window grips, a
 * consumer's own `CollectionItem.TrimHandle` — inherits the same law from
 * where it is MOUNTED. A handle inside a pannable strip dwells; the same
 * component in a panel or a grid stays instant, because there is no competing
 * gesture there to protect.
 */
function trimArmDelayFor(target: Element): number {
  return target.closest(`[${PAN_SURFACE_ATTR}]`) === null ? 0 : TRIM_ARM_DELAY_MS;
}

// Pointer trims capture CONTINUOUS pixels ((clientX - startX) / pps), so a raw
// commit stores values like 3.5416666666666665s. Snap the resolved trim to a
// 0.1s grid so committed durations stay round and match what the UI shows
// exactly (the display path rounds to the same 0.1s). This is an input-capture
// decision local to the pointer gesture — the keyboard path already steps whole
// seconds, and the reducer still owns the physical clamp. A sub-0.05s nudge
// snaps to no change, which the reducer then rejects as same-position (tiny
// accidental drags don't create imperceptible trims). `Math.round(x * 10) / 10`
// avoids the float dust that `Math.round(x / 0.1) * 0.1` leaves behind.
export const TRIM_QUANTUM_SECONDS = 0.1;

function quantize(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}

/** Resolve a TRIM (duration changes): a right handle on every media (image
 *  duration / video trim-out) and a left handle on video (trim-in). Returns
 *  the `update` to commit plus the `live` split to preview. */
export function resolveTrim(
  node: MediaNode,
  side: TrimSide,
  deltaSeconds: number
): { update: MediaUpdate; live: LiveTrim } {
  // ONE WINDOWED BRANCH for video and audio. They were separate while audio's
  // trim affordance was unshipped, and the audio one resolved to the node's
  // current window on purpose so the gesture was inert. Now that both trim,
  // the arithmetic is identical and the only difference is which literal the
  // update carries — so keeping two copies would only be two places for the
  // clamping to drift apart.
  if (hasSourceWindow(node)) {
    const mediaKind = node.mediaKind;
    if (side === "left") {
      // Left edge inward (right, +delta) trims MORE off the start. Snap to the
      // 0.1s grid, then clamp — effective is DERIVED from the snapped value so
      // the previewed width and the committed data agree exactly.
      const trimInSeconds = clamp(
        quantize(node.trimInSeconds + deltaSeconds),
        0,
        // Room for the window to survive: the far edge, LESS the minimum. The
        // `Math.max(0, …)` matters for a source already shorter than the
        // minimum — the ceiling must not go negative and invert the clamp,
        // which would pin the edge at 0 and make the handle feel dead.
        // QUANTIZED, like the value it bounds. `10 - 1 - 0.1` is
        // 8.899999999999999, and an un-gridded ceiling hands that straight
        // through as the committed trim — the same float dust the test below
        // pins for the value, arriving by way of the limit instead.
        quantize(Math.max(0, node.fullDurationSeconds - node.trimOutSeconds - MIN_TRIM_WINDOW_SECONDS))
      );
      return {
        update: { mediaKind, trimInSeconds },
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
      quantize(node.trimOutSeconds - deltaSeconds),
      0,
      quantize(Math.max(0, node.fullDurationSeconds - node.trimInSeconds - MIN_TRIM_WINDOW_SECONDS))
    );
    return {
      update: { mediaKind, trimOutSeconds },
      live: {
        side,
        trimInSeconds: node.trimInSeconds,
        trimOutSeconds,
        effectiveSeconds: node.fullDurationSeconds - node.trimInSeconds - trimOutSeconds,
      },
    };
  }
  // Image: the right edge sets the duration directly (outward = longer).
  const durationSeconds = Math.max(0, quantize(node.durationSeconds + deltaSeconds));
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
  // Snap trim-in to the 0.1s grid; trim-out is derived so `showing` (and the
  // clip width) stays exactly constant — the defining property of a move.
  const trimInSeconds = clamp(quantize(node.trimInSeconds - deltaSeconds), 0, room);
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
 *
 * On a surface that PANS (see `trimArmDelayFor`) the press does not begin an
 * edit until it has settled for `TRIM_ARM_DELAY_MS`: an early move drops the
 * trim and lets the pan have the pointer, and arming publishes
 * `data-trim-armed` on the pressed element so content can show that the next
 * pull will trim. Arming is also where the zero-delta preview goes out, so a
 * press that turns out to be a pan never sends the preview pane to an edge
 * frame and back — nothing at all happens until the gesture has said what it
 * is. Off a pannable surface arming is immediate and none of this is visible.
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
  // Second live-value consumer beside the view's TrimPreview: the emitter
  // consumer content opts into via useLiveTrim (live per move, null when the
  // gesture settles — abort, no-op, OR successful commit).
  const publishLive = useLiveTrimPublisher();
  const activeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      activeCleanupRef.current?.();
    },
    [node, trimPreview]
  );

  return useCallback(
    (event, pixelsPerSecond, resolve, onLive) => {
      // Only the primary pointer's left button starts a trim. A secondary
      // finger/stylus must not open a gesture (and, below, must not steer or
      // end the one the primary owns).
      if (
        !event.isPrimary ||
        event.button !== 0 ||
        !Number.isFinite(pixelsPerSecond) ||
        pixelsPerSecond <= 0
      )
        return;
      activeCleanupRef.current?.();
      // Keep the gesture off dnd-kit's item drag and (for an overview grip)
      // the overview's own move handler. NOT off the pan: that listener is
      // native and sits on the scroll container, an ancestor React dispatches
      // BELOW, so it has already run by the time this does — which is exactly
      // what the arbitration below needs. Both presses arm; only one survives.
      //
      // preventDefault stays unconditional and stays HERE, on the down. It is
      // what suppresses the compatibility click, and so what keeps a trim from
      // also opening the card it trimmed — and a click cannot be prevented
      // after the fact, so deferring it until the gesture arms would be too
      // late. A press that ends up a pan loses a click the pan would have
      // squashed anyway.
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      const pointerTarget = event.currentTarget;
      // The arm marker is written imperatively rather than through state: it
      // lives for one press, and re-rendering the pressed card mid-gesture to
      // paint it would cost more than it shows. Content styles off it (see
      // `group/trim` on the hit zone in trim-handles.tsx).
      const armTarget = pointerTarget instanceof HTMLElement ? pointerTarget : null;
      const armDelayMs = trimArmDelayFor(pointerTarget);
      const downX = event.clientX;
      const downY = event.clientY;
      // Where the trim measures its delta FROM. Re-baselined at arm time so a
      // press that drifted inside the tolerance does not open with a jump.
      let startX = downX;
      let lastX = downX;
      let armed = false;
      let armTimer = 0;
      let pending: MediaUpdate | null = null;
      let finished = false;

      function arm() {
        if (armed || finished) return;
        armed = true;
        if (armTimer) window.clearTimeout(armTimer);
        armTimer = 0;
        startX = lastX;
        armedTrimGesture = true;
        if (armTarget) armTarget.dataset.trimArmed = "true";
        try {
          pointerTarget.setPointerCapture(pointerId);
        } catch {
          /* untrusted pointer (tests) — window listeners below suffice */
        }

        // Publish the edge's CURRENT split at zero delta, so anything showing
        // the live frame has something to show from the moment the gesture
        // begins rather than from the first move.
        //
        // It matters most where it is least visible: the preview pane seeks to
        // this frame, and a cold seek near the out point can take the better
        // part of a second. Starting it here spends the pause while the user
        // is still deciding where to drag, rather than at the start of the
        // drag itself.
        //
        // ARMING, NOT THE PRESS, is where this belongs. It fired on
        // pointerdown back when a press could only mean a trim — but a press
        // that turns out to be a PAN would send the pane off to the edge frame
        // and straight back, a visible flinch from a gesture that never
        // touched the clip. The dwell is the moment the press says what it is,
        // and the warm-up is worth just as much from here, because the drag
        // still has not started.
        //
        // `pending` stays null deliberately. A press with no movement
        // therefore still takes onUp's no-op branch — nothing dispatches, and
        // the live preview clears on release exactly as an aborted gesture
        // does. This shows a frame; it does not begin an edit.
        const initial = resolve(0);
        onLive?.(initial.live);
        publishLive(node.id, initial.live);
        trimPreview.previewTrim(node.id, initial.live);
      }

      function disarm() {
        if (armTimer) window.clearTimeout(armTimer);
        armTimer = 0;
        armed = false;
        armedTrimGesture = false;
        if (armTarget) delete armTarget.dataset.trimArmed;
      }

      function removeListeners() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      }

      function releasePointerCapture() {
        try {
          if (pointerTarget.hasPointerCapture(pointerId)) {
            pointerTarget.releasePointerCapture(pointerId);
          }
        } catch {
          /* the target may already be detached or have lost capture */
        }
      }

      function clearActiveCleanup(cleanup: () => void) {
        if (activeCleanupRef.current === cleanup) activeCleanupRef.current = null;
      }

      function abortGesture() {
        if (finished) return;
        finished = true;
        disarm();
        removeListeners();
        releasePointerCapture();
        clearActiveCleanup(abortGesture);
        // Mirror onUp: the caller's local UI (e.g. the card's readout pill)
        // must also reset on an abort through the cleanup path — a keyboard
        // trim committing on this node mid-gesture would otherwise strand
        // the preview bubble with a stale number.
        onLive?.(null);
        publishLive(node.id, null);
        trimPreview.previewTrim(node.id, null);
      }

      function onMove(moveEvent: PointerEvent) {
        // Ignore every pointer but the one that started this gesture.
        if (finished || moveEvent.pointerId !== pointerId) return;
        if (!armed) {
          // Still deciding. Movement past normal jitter means the hand was
          // already travelling when it landed — a pan, not an aim — so the
          // trim stands down and the pan (armed on the same press, one pixel
          // further out) takes it. Distance, not axis: a diagonal press is
          // not a trim either, and erring toward the pan is the safe way to
          // be wrong.
          if (Math.hypot(moveEvent.clientX - downX, moveEvent.clientY - downY) >
            HOLD_DRAG_TOLERANCE_PX) {
            abortGesture();
            return;
          }
          lastX = moveEvent.clientX;
          return;
        }
        const { update, live } = resolve((moveEvent.clientX - startX) / pixelsPerSecond);
        pending = update;
        onLive?.(live);
        publishLive(node.id, live);
        trimPreview.previewTrim(node.id, live);
      }

      function onUp(upEvent: PointerEvent) {
        // A different pointer's release/cancel must not end this gesture.
        if (finished || upEvent.pointerId !== pointerId) return;
        finished = true;
        disarm();
        removeListeners();
        releasePointerCapture();
        clearActiveCleanup(abortGesture);
        onLive?.(null);
        const update = pending;
        pending = null;
        if (upEvent.type === "pointercancel" || !update) {
          // Aborted (or a no-op click): drop the live preview, snapping back.
          publishLive(node.id, null);
          trimPreview.previewTrim(node.id, null);
          return;
        }
        // Commit. The view reconciles to the new data (its last preview
        // already matches), so there is no flash.
        const dispatched = store.dispatch({ type: "update-media", nodeId: node.id, update });
        // The emitter clears on EVERY settle, success included: subscribers'
        // committed node now carries the same values the last live preview
        // showed (quantize-then-clamp parity), so there is no flash.
        publishLive(node.id, null);
        // A no-op (for example, moving away and returning to the committed
        // value before release) does not change graph identity, so views
        // cannot rely on their commit effect to clear the live preview.
        if (!dispatched.ok) trimPreview.previewTrim(node.id, null);
      }

      activeCleanupRef.current = abortGesture;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);

      // Off a pannable surface there is nothing to arbitrate against, so the
      // press owns the pointer from the first pixel — the behaviour every trim
      // surface had before the strip learned to pan. On one, it has to settle
      // first; `onMove` above is what ends the wait early.
      if (armDelayMs <= 0) arm();
      else armTimer = window.setTimeout(arm, armDelayMs);
    },
    [node, store, trimPreview, publishLive]
  );
}
