import { useState, useCallback, useRef } from "react";
import { type CollectionId } from "./core/media-strip.types";

/**
 * Custom hook to manage the collection registry inside MediaStripBoard.
 *
 * Ref-counted: if the same collection id is mounted by more than one strip
 * at once (or a strip remounts while another instance is still up, e.g.
 * StrictMode's mount→unmount→mount), a plain add/delete would drop the id
 * the moment the *first* copy unmounts even though another still needs it.
 * So the counts live in a ref (incremented per register, decremented per
 * unregister — count changes alone don't re-render), and the exposed
 * membership `Set` only changes when a count crosses 0↔1, i.e. when the id
 * genuinely appears or disappears. The registry is conceptually a *set* of
 * ids anyway — ordering comes from `visibleCollectionIds` (see
 * `getAdjacentCollectionId`).
 */
export function useBoardRegistry() {
  const countsRef = useRef<Map<CollectionId, number> | null>(null);
  if (!countsRef.current) countsRef.current = new Map();

  const [registeredCollections, setRegisteredCollections] = useState<ReadonlySet<CollectionId>>(
    () => new Set()
  );

  const registerCollection = useCallback((collectionId: CollectionId) => {
    const counts = countsRef.current!;
    const prev = counts.get(collectionId) ?? 0;
    counts.set(collectionId, prev + 1);
    if (prev > 0) return; // already present — no membership change

    setRegisteredCollections((set) => {
      if (set.has(collectionId)) return set;
      const next = new Set(set);
      next.add(collectionId);
      return next;
    });
  }, []);

  const unregisterCollection = useCallback((collectionId: CollectionId) => {
    const counts = countsRef.current!;
    const prev = counts.get(collectionId) ?? 0;
    if (prev > 1) {
      counts.set(collectionId, prev - 1); // another mount still holds it
      return;
    }

    counts.delete(collectionId);
    setRegisteredCollections((set) => {
      if (!set.has(collectionId)) return set;
      const next = new Set(set);
      next.delete(collectionId);
      return next;
    });
  }, []);

  return {
    registeredCollections,
    registerCollection,
    unregisterCollection,
  };
}
