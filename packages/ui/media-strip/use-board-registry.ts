import { useState, useCallback } from "react";
import { type CollectionId } from "./core/media-strip.types";

/**
 * Custom hook to manage the collection registry inside MediaStripBoard.
 */
export function useBoardRegistry() {
  const [registeredCollections, setRegisteredCollections] = useState<CollectionId[]>([]);

  const registerCollection = useCallback((collectionId: CollectionId) => {
    setRegisteredCollections((prev) => (prev.includes(collectionId) ? prev : [...prev, collectionId]));
  }, []);

  const unregisterCollection = useCallback((collectionId: CollectionId) => {
    setRegisteredCollections((prev) => prev.filter((id) => id !== collectionId));
  }, []);

  return {
    registeredCollections,
    registerCollection,
    unregisterCollection,
  };
}
