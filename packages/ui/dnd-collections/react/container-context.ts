"use client";

import { createContext, useContext, type RefObject } from "react";

// Instance-scoped plumbing the provider exposes to descendants:
// - containerRef: the wrapper element (display: contents, layout-neutral),
//   the scope for instance-wide DOM work like the FLIP measurement sweep —
//   multiple boards on one page (possibly reusing node ids) stay isolated.
// - instructionsId: id of the hidden keyboard-usage instructions element,
//   for aria-describedby on cards and grip bars.

export type CollectionsContainerValue = Readonly<{
  containerRef: RefObject<HTMLElement | null>;
  instructionsId: string;
}>;

export const CollectionsContainerContext =
  createContext<CollectionsContainerValue | null>(null);

export function useCollectionsContainer(): CollectionsContainerValue {
  const value = useContext(CollectionsContainerContext);
  if (!value) {
    throw new Error("dnd-collections hooks must be used within <DndCollections>");
  }
  return value;
}
