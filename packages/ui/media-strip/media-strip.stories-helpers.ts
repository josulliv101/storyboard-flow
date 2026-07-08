import { expect, waitFor } from "storybook/test";

import { type TimelineItemResult } from "./core/media-strip.types";
import { createImageTimelineItem } from "./core/media-strip.validation";

/** Unwraps a `TimelineItemResult`, throwing on failure — story fixtures are static, so a failure is a bug in the story. */
export function unwrapResult<T, E>(result: TimelineItemResult<T, E>): T {
  if (!result.ok) {
    throw new Error(`Failed to construct timeline item: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

export const createThumbnail = (color: string, label: string) =>
  `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" rx="18" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="white" font-family="Arial, sans-serif" font-size="32" font-weight="700" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;

export const createPhotoThumbnail = (seed: string) =>
  createThumbnail(
    `#${Array.from(seed)
      .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 0xffffff, 0)
      .toString(16)
      .padStart(6, "0")}`,
    seed
      .split("-")
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join(""),
  );

/** Builds a valid image timeline item with a generated SVG thumbnail. */
export const createImg = (id: string, name: string, color: string, duration: number) => {
  const thumb = createThumbnail(color, name);

  // The factory accepts an unbranded string id and validates it internally.
  return unwrapResult(
    createImageTimelineItem({
      id,
      name,
      src: thumb,
      posterSrcs: [thumb],
      startTimeSeconds: 0,
      durationSeconds: duration,
    })
  );
};

export const waitForLayout = async (element: HTMLElement) => {
  await waitFor(() => {
    const rect = element.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
};

// Helper functions for programmatic PointerEvent simulation in headless story tests

type PointerSequenceStep = {
  element: EventTarget;
  type: "pointerdown" | "pointermove" | "pointerup";
  clientX: number;
  clientY: number;
  /** Overrides merged on top of the shared defaults below (e.g. `cancelable`, `isPrimary`). */
  eventInit?: PointerEventInit;
  /** How long to wait after dispatching this step before dispatching the next one. */
  delayAfterMs?: number;
};

const DEFAULT_POINTER_EVENT_INIT: PointerEventInit = {
  bubbles: true,
  button: 0,
  buttons: 1,
  pointerId: 1,
};

/** Dispatches a sequence of PointerEvents with per-step delays, sharing one set of event defaults. */
export const dispatchPointerSequence = async (steps: readonly PointerSequenceStep[]) => {
  for (const step of steps) {
    step.element.dispatchEvent(
      new PointerEvent(step.type, {
        ...DEFAULT_POINTER_EVENT_INIT,
        ...step.eventInit,
        clientX: step.clientX,
        clientY: step.clientY,
      })
    );
    if (step.delayAfterMs) {
      await new Promise((resolve) => setTimeout(resolve, step.delayAfterMs));
    }
  }
};

/**
 * Drags `handle` and releases at an explicit viewport point, rather than the
 * center of a target element — needed to land on a specific side of an item
 * (e.g. its right quarter, to assert "drop after" placement) instead of
 * always landing dead-center like `simulatePointerDrag` does.
 */
export const simulatePointerDragToPoint = async (
  handle: HTMLElement,
  point: { x: number; y: number }
) => {
  await waitForLayout(handle);

  const startRect = handle.getBoundingClientRect();
  const eventInit: PointerEventInit = { cancelable: true, isPrimary: true };

  await dispatchPointerSequence([
    // 1. Pointer Down
    { element: handle, type: "pointerdown", clientX: startRect.left + 5, clientY: startRect.top + 5, eventInit },
    // 2. Drag slightly to trigger dnd-kit pointer sensor activation constraint (> 5px)
    { element: document, type: "pointermove", clientX: startRect.left + 20, clientY: startRect.top + 5, eventInit, delayAfterMs: 100 },
    // 3. Drag to the target point
    { element: document, type: "pointermove", clientX: point.x, clientY: point.y, eventInit, delayAfterMs: 100 },
    // 4. Release mouse button (Pointer Up)
    { element: document, type: "pointerup", clientX: point.x, clientY: point.y, eventInit, delayAfterMs: 50 },
  ]);
};

export const simulatePointerDrag = async (handle: HTMLElement, target: HTMLElement) => {
  await waitForLayout(target);

  const targetRect = target.getBoundingClientRect();
  await simulatePointerDragToPoint(handle, {
    x: targetRect.left + targetRect.width / 2,
    y: targetRect.top + targetRect.height / 2,
  });
};

/**
 * Starts a drag and holds the pointer at `point` for `holdMs` without
 * releasing — used to give edge-autoscroll time to actually move
 * `scrollLeft` before the drag completes. Pair with `releasePointerDragAt`
 * to end the drag once the hold assertion is done — do not call
 * `simulatePointerDrag*` again while a hold is active, since that would
 * dispatch a second `pointerdown` mid-drag instead of a plain release.
 */
export const simulatePointerDragHoldAt = async (
  handle: HTMLElement,
  point: { x: number; y: number },
  holdMs: number
) => {
  await waitForLayout(handle);

  const startRect = handle.getBoundingClientRect();
  const eventInit: PointerEventInit = { cancelable: true, isPrimary: true };

  await dispatchPointerSequence([
    { element: handle, type: "pointerdown", clientX: startRect.left + 5, clientY: startRect.top + 5, eventInit },
    { element: document, type: "pointermove", clientX: startRect.left + 20, clientY: startRect.top + 5, eventInit, delayAfterMs: 100 },
    { element: document, type: "pointermove", clientX: point.x, clientY: point.y, eventInit, delayAfterMs: holdMs },
  ]);
};

/** Releases a drag started by `simulatePointerDragHoldAt`, at the given point. */
export const releasePointerDragAt = async (point: { x: number; y: number }) => {
  await dispatchPointerSequence([
    { element: document, type: "pointerup", clientX: point.x, clientY: point.y, eventInit: { cancelable: true, isPrimary: true }, delayAfterMs: 50 },
  ]);
};

export const simulateDragOscillation = async (handle: HTMLElement, target: HTMLElement) => {
  await waitForLayout(handle);
  await waitForLayout(target);

  const startRect = handle.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;

  await dispatchPointerSequence([
    // 1. Pointer Down
    { element: handle, type: "pointerdown", clientX: startRect.left + 5, clientY: startRect.top + 5 },
    // 2. Move past threshold
    { element: document, type: "pointermove", clientX: startRect.left + 20, clientY: startRect.top + 5, delayAfterMs: 50 },
    // 3. Move to target
    { element: document, type: "pointermove", clientX: targetCenterX, clientY: targetCenterY, delayAfterMs: 50 },
    // 4. Oscillate back and forth to trigger multiple collision detection runs
    ...Array.from({ length: 5 }, (_, i) => ({
      element: document as EventTarget,
      type: "pointermove" as const,
      clientX: targetCenterX + (i % 2 === 0 ? 5 : -5),
      clientY: targetCenterY,
      delayAfterMs: 20,
    })),
    // 5. Pointer Up
    { element: document, type: "pointerup", clientX: targetCenterX, clientY: targetCenterY, delayAfterMs: 50 },
  ]);
};

// Helper functions for programmatic native HTML5 DragEvent simulation.
// Unlike dnd-kit (PointerEvent-driven), the native-html5 adapter is built
// directly on the browser's native Drag and Drop API, so PointerEvents
// never reach it — it needs a real dragstart/dragenter/dragover/drop/dragend
// sequence with a DataTransfer instead. (The pragmatic adapter also sits on
// native DnD, but its own internal event handling doesn't reliably respond
// to this simulation — see the doc comment on simulateNativeDragToPoint.)

type NativeDragSequenceStep = {
  element: EventTarget;
  type: "dragstart" | "dragenter" | "dragover" | "drop" | "dragend";
  clientX: number;
  clientY: number;
  dataTransfer: DataTransfer;
  delayAfterMs?: number;
};

/** Dispatches a sequence of native DragEvents sharing one DataTransfer, with per-step delays. */
export const dispatchNativeDragSequence = async (steps: readonly NativeDragSequenceStep[]) => {
  for (const step of steps) {
    step.element.dispatchEvent(
      new DragEvent(step.type, {
        bubbles: true,
        cancelable: true,
        clientX: step.clientX,
        clientY: step.clientY,
        dataTransfer: step.dataTransfer,
      })
    );
    if (step.delayAfterMs) {
      await new Promise((resolve) => setTimeout(resolve, step.delayAfterMs));
    }
  }
};

/**
 * Simulates a native HTML5 drag from `handle` (the reorder handle, which is
 * where `draggable`/`dragstart`/`dragend` are wired up) to an explicit
 * viewport point — needed to land on a specific side of an item (e.g. its
 * right quarter, to assert "drop after" placement) rather than always
 * landing dead-center.
 *
 * Verified working against the **native-html5** adapter. The pragmatic
 * adapter (`@atlaskit/pragmatic-drag-and-drop`) does NOT reliably respond to
 * this — it re-derives the element under the pointer via its own internal
 * `elementFromPoint`-based "honey pot" mechanism rather than relying solely
 * on which element the dispatched event bubbles through, so a same-strip
 * drag via this helper silently no-ops against it. See ARCHITECTURE.md's
 * "Known gaps" for the current state of pragmatic's test coverage.
 */
export const simulateNativeDragToPoint = async (
  handle: HTMLElement,
  target: HTMLElement,
  point: { x: number; y: number }
) => {
  await waitForLayout(handle);
  await waitForLayout(target);

  const startRect = handle.getBoundingClientRect();
  const dataTransfer = new DataTransfer();

  await dispatchNativeDragSequence([
    { element: handle, type: "dragstart", clientX: startRect.left + 5, clientY: startRect.top + 5, dataTransfer, delayAfterMs: 50 },
    { element: target, type: "dragenter", clientX: point.x, clientY: point.y, dataTransfer },
    { element: target, type: "dragover", clientX: point.x, clientY: point.y, dataTransfer, delayAfterMs: 50 },
    { element: target, type: "drop", clientX: point.x, clientY: point.y, dataTransfer },
    { element: handle, type: "dragend", clientX: point.x, clientY: point.y, dataTransfer, delayAfterMs: 50 },
  ]);
};

export const simulateNativeDrag = async (handle: HTMLElement, target: HTMLElement) => {
  await waitForLayout(target);

  const targetRect = target.getBoundingClientRect();
  await simulateNativeDragToPoint(handle, target, {
    x: targetRect.left + targetRect.width / 2,
    y: targetRect.top + targetRect.height / 2,
  });
};

/**
 * Starts a native drag and ends it without ever dispatching `drop` — the
 * native-html5 adapter's `endDrag` treats "dragend without a prior drop" as
 * a cancelled drag, same as a real user releasing outside any drop target.
 */
export const simulateNativeDragCancel = async (handle: HTMLElement) => {
  await waitForLayout(handle);

  const startRect = handle.getBoundingClientRect();
  const dataTransfer = new DataTransfer();

  await dispatchNativeDragSequence([
    { element: handle, type: "dragstart", clientX: startRect.left + 5, clientY: startRect.top + 5, dataTransfer, delayAfterMs: 50 },
    { element: handle, type: "dragend", clientX: startRect.left + 5, clientY: startRect.top + 5, dataTransfer, delayAfterMs: 50 },
  ]);
};

export const simulateScrollAreaDrag = async (scrollArea: HTMLElement) => {
  await waitForLayout(scrollArea);

  const rect = scrollArea.getBoundingClientRect();

  await dispatchPointerSequence([
    { element: scrollArea, type: "pointerdown", clientX: rect.left + 100, clientY: rect.top + 50 },
    { element: document, type: "pointermove", clientX: rect.left + 50, clientY: rect.top + 50, delayAfterMs: 50 },
    { element: document, type: "pointerup", clientX: rect.left + 50, clientY: rect.top + 50 },
  ]);
};
