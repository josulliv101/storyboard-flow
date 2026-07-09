"use client";

import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import {
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type DropPlacement,
  isCollectionItem,
} from "./core/media-strip.types";

// Per-move drag state lives in an external store, not React context, so an
// item only re-renders when ITS slice changes. Reading the whole drag state
// from context (the previous design) re-rendered every mounted item on every
// pointer move, since context has no selector granularity. Here each item
// subscribes via `useSyncExternalStore` to a selector that returns a
// primitive — so React's `Object.is` check skips the re-render whenever that
// item's derived value is unchanged.

export type MediaStripDragSnapshot = Readonly<{
  activeDragId: TimelineItemId | null;
  activeNestTargetId: CollectionId | null;
  /** Whether nesting into `activeNestTargetId` would form a cycle. */
  activeNestTargetInvalid: boolean;
  activeDropPlacement: DropPlacement | null;
  activeKeyboardReorderId: TimelineItemId | null;
  rejectedItemId: TimelineItemId | null;
}>;

export const EMPTY_DRAG_SNAPSHOT: MediaStripDragSnapshot = {
  activeDragId: null,
  activeNestTargetId: null,
  activeNestTargetInvalid: false,
  activeDropPlacement: null,
  activeKeyboardReorderId: null,
  rejectedItemId: null,
};

export type MediaStripDragStore = Readonly<{
  getSnapshot: () => MediaStripDragSnapshot;
  set: (next: MediaStripDragSnapshot) => void;
  subscribe: (listener: () => void) => () => void;
}>;

export function createMediaStripDragStore(): MediaStripDragStore {
  let snapshot: MediaStripDragSnapshot = EMPTY_DRAG_SNAPSHOT;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    set: (next) => {
      snapshot = next;
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

/** One store per board lifetime, stable across the board's re-renders. */
export function useMediaStripDragStoreInstance(): MediaStripDragStore {
  const ref = useRef<MediaStripDragStore | null>(null);
  if (!ref.current) ref.current = createMediaStripDragStore();
  return ref.current;
}

const MediaStripDragStoreContext = createContext<MediaStripDragStore | null>(null);
export const MediaStripDragStoreProvider = MediaStripDragStoreContext.Provider;

function useDragStore(): MediaStripDragStore {
  const store = useContext(MediaStripDragStoreContext);
  if (!store) {
    throw new Error("MediaStrip drag selectors must be used within a MediaStripBoard provider");
  }
  return store;
}

/**
 * The reorder "drop here" side for this item during a drag: `"before"` /
 * `"after"` / `null`. Null (and thus no re-render) for every item except the
 * one the pointer's placement currently references. `"inside"` (nesting) is
 * intentionally not reported here — see `useMediaStripItemNestState`.
 */
export function useMediaStripItemDropSide(itemId: TimelineItemId): "before" | "after" | null {
  const store = useDragStore();
  return useSyncExternalStore(store.subscribe, () => {
    const s = store.getSnapshot();
    if (!s.activeDragId || s.activeDragId === itemId) return null;
    const placement = s.activeDropPlacement;
    if (placement && (placement.kind === "before" || placement.kind === "after") && placement.itemId === itemId) {
      return placement.kind;
    }
    return null;
  });
}

/**
 * Nest-overlay state for a (collection) item: `"none"` when it isn't the
 * active nest target, else `"valid"` / `"invalid"` (would form a cycle).
 * `"none"` for non-collection items and for every collection except the one
 * currently hovered — so only that one re-renders as the target changes.
 */
export function useMediaStripItemNestState(item: TimelineItem): "none" | "valid" | "invalid" {
  const store = useDragStore();
  const collectionId = isCollectionItem(item) ? item.collectionId : null;
  const itemId = item.id;
  return useSyncExternalStore(store.subscribe, () => {
    const s = store.getSnapshot();
    if (!collectionId || !s.activeDragId || s.activeDragId === itemId) return "none";
    if (s.activeNestTargetId !== collectionId) return "none";
    return s.activeNestTargetInvalid ? "invalid" : "valid";
  });
}

/** Whether this item is currently flashing a rejected-drop cue. */
export function useMediaStripItemRejected(itemId: TimelineItemId): boolean {
  const store = useDragStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().rejectedItemId === itemId
  );
}

/**
 * Whether this item is the one currently being dragged. Used to dim the
 * drag *source* in place (a placeholder cue) for adapters that keep it
 * mounted during a drag — native-html5 binds `dragend` to the source DOM
 * node, so it can't unmount it into a placeholder the way dnd-kit/pragmatic
 * do (they report `isDragging` and swap the card out). Changes only on drag
 * start/end.
 */
export function useMediaStripItemIsActiveDragSource(itemId: TimelineItemId): boolean {
  const store = useDragStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().activeDragId === itemId
  );
}

/**
 * The id of the item in an active keyboard-reorder session, or `null`.
 * Changes only on keyboard pick-up/drop, so a consumer of this (the strip,
 * to flag its reordering item) doesn't re-render on pointer-drag moves.
 */
export function useMediaStripActiveKeyboardReorderId(): TimelineItemId | null {
  const store = useDragStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().activeKeyboardReorderId
  );
}
