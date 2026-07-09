"use client";

import { useCallback, useEffect, useRef } from "react";

// Shared store machinery for the manual-overlay adapters (native-html5,
// pragmatic). Both must track per-pointer-move state (overlay position,
// current over-target) WITHOUT routing it through React state in the
// provider — a `useState` there re-renders every runtime-context consumer
// (the whole strip subtree) on every pointer move. Instead: an external
// store that only the leaf subscribed via `useSyncExternalStore` (the drag
// overlay) re-renders for, with writes batched to animation frames.

export type ExternalStore<T> = Readonly<{
  getSnapshot: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}>;

export function createExternalStore<T>(initialValue: T): ExternalStore<T> {
  let value = initialValue;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => value,
    set: (nextValue) => {
      if (Object.is(value, nextValue)) return;
      value = nextValue;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** One store instance per component lifetime, independent of re-renders. */
export function useConstantStore<T>(initialValue: T): ExternalStore<T> {
  const storeRef = useRef<ExternalStore<T> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createExternalStore(initialValue);
  }
  return storeRef.current;
}

/**
 * rAF-batched writes to an external store: `schedule` records the latest
 * value and commits it once per animation frame, so a burst of pointer
 * events collapses into at most one store notification per frame.
 * `cancelScheduled` drops any not-yet-committed value (use before setting
 * the store directly, e.g. clearing on drag end). The pending frame is
 * cancelled automatically on unmount.
 */
export function useRafBatchedStoreSetter<T>(store: ExternalStore<T>): {
  schedule: (value: T) => void;
  cancelScheduled: () => void;
} {
  const pendingRef = useRef<T>(store.getSnapshot());
  const frameRef = useRef<number | null>(null);

  const cancelScheduled = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const schedule = useCallback((value: T) => {
    pendingRef.current = value;

    if (frameRef.current !== null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      store.set(pendingRef.current);
    });
  }, [store]);

  useEffect(() => cancelScheduled, [cancelScheduled]);

  return { schedule, cancelScheduled };
}
