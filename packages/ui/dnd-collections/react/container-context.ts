"use client";

import { createContext, useContext, type MutableRefObject, type RefObject } from "react";

import { type NodeId } from "../core/graph";

// Instance-scoped plumbing the provider exposes to descendants:
// - containerRef: the wrapper element (display: contents, layout-neutral),
//   the scope for instance-wide DOM work like the FLIP measurement sweep —
//   multiple boards on one page (possibly reusing node ids) stay isolated.
// - instructionsId: id of the hidden keyboard-usage instructions element,
//   for aria-describedby on cards and grip bars.
// - trashRef: a single slot a mounted <TrashTarget> registers its collection
//   id into, so the keyboard controller can offer Alt+Delete "move to trash"
//   without the provider knowing about trash. null when none is mounted.

export type CollectionsContainerValue = Readonly<{
  containerRef: RefObject<HTMLElement | null>;
  instructionsId: string;
  trashRef: MutableRefObject<NodeId | null>;
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
