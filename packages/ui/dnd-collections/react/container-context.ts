"use client";

import { createContext, useContext, type RefObject } from "react";

// The provider's wrapper element (display: contents, so layout-neutral).
// Instance-scoped DOM work — the FLIP measurement sweep — queries within
// THIS DndCollections instance instead of the whole document. That scoping
// is what keeps multiple boards on one page isolated: without it, a commit
// in one board would measure (and, with reused node ids, mis-key rects for)
// every other board's cards.

export const CollectionsContainerContext =
  createContext<RefObject<HTMLElement | null> | null>(null);

export function useCollectionsContainer(): RefObject<HTMLElement | null> {
  const ref = useContext(CollectionsContainerContext);
  if (!ref) {
    throw new Error("dnd-collections hooks must be used within <DndCollections>");
  }
  return ref;
}
