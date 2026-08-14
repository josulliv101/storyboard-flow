"use client";

import { useSyncExternalStore } from "react";

import { acceptsDragTypes } from "./graph-native-drop-model";

/**
 * "A droppable drag is somewhere over the page right now" — the signal every
 * drop zone lights up on, so the targets announce themselves BEFORE the
 * pointer finds one. Kept module-level and reference-counted because the
 * answer is global while the subscribers are many (the focused surface plus
 * every rendered sub-timeline); one window listener serves all of them.
 *
 * ITS OWN MODULE for that reason: a module-level singleton with window
 * listeners is exactly the shape that must not sit in a cycle, since a cycle
 * around one fails at EVALUATION time rather than at the type level.
 *
 * Armed by `dragover` rather than tracked with dragenter/dragleave pairs:
 * those fire in a well-known flickering interleave as the pointer crosses
 * child elements, and every counter-based fix leaks a stuck state on some
 * path (drag out of the window, drop on another app, ESC). `dragover` fires
 * continuously while a drag is over the page, so a short expiry that each
 * event refreshes is self-healing — nothing can leave it stuck on.
 *
 * dnd-kit card drags are POINTER drags and emit no HTML5 drag events at all,
 * so they never arm this.
 */
const NATIVE_DRAG_IDLE_MS = 200;

const nativeDragSignal = {
  active: false,
  listeners: new Set<() => void>(),
  timer: null as ReturnType<typeof setTimeout> | null,
  detach: null as (() => void) | null,
};

function setNativeDragActive(next: boolean): void {
  if (nativeDragSignal.active === next) return;
  nativeDragSignal.active = next;
  for (const listener of nativeDragSignal.listeners) listener();
}

function clearNativeDragTimer(): void {
  if (nativeDragSignal.timer !== null) {
    clearTimeout(nativeDragSignal.timer);
    nativeDragSignal.timer = null;
  }
}

function subscribeNativeDrag(listener: () => void): () => void {
  nativeDragSignal.listeners.add(listener);
  if (nativeDragSignal.detach === null && typeof window !== "undefined") {
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!acceptsDragTypes(event.dataTransfer?.types)) return;
      setNativeDragActive(true);
      clearNativeDragTimer();
      nativeDragSignal.timer = setTimeout(() => {
        nativeDragSignal.timer = null;
        setNativeDragActive(false);
      }, NATIVE_DRAG_IDLE_MS);
    };
    const onEnd = () => {
      clearNativeDragTimer();
      setNativeDragActive(false);
    };
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onEnd, true);
    window.addEventListener("dragend", onEnd, true);
    nativeDragSignal.detach = () => {
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onEnd, true);
      window.removeEventListener("dragend", onEnd, true);
    };
  }
  return () => {
    nativeDragSignal.listeners.delete(listener);
    if (nativeDragSignal.listeners.size === 0) {
      nativeDragSignal.detach?.();
      nativeDragSignal.detach = null;
      clearNativeDragTimer();
      nativeDragSignal.active = false;
    }
  };
}

/** True while a droppable native drag is over the page. */
export function useNativeDragArmed(): boolean {
  return useSyncExternalStore(
    subscribeNativeDrag,
    () => nativeDragSignal.active,
    () => false,
  );
}
