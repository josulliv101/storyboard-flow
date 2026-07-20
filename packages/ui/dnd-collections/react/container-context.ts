"use client";

import { createContext, useContext, type MutableRefObject, type RefObject } from "react";

import { type NodeId } from "../core/graph";

// Instance-scoped plumbing the provider exposes to descendants:
// - containerRef: the wrapper element (display: contents, layout-neutral),
//   the scope for instance-wide DOM work like the FLIP measurement sweep —
//   multiple boards on one page (possibly reusing node ids) stay isolated.
// - instructionsId: id of the hidden keyboard-usage instructions element,
//   for aria-describedby on cards and grip bars.
// - paletteInstructionsId: id of the palette-specific instructions element
//   (PaletteItem's aria-describedby — the card instructions don't apply to
//   an external drag source).
// - trashRef: a single slot a mounted <TrashTarget> registers its collection
//   id into, so the keyboard controller can offer Alt+Delete "move to trash"
//   without the provider knowing about trash. null when none is mounted.
// - announce: the instance's aria-live channel, so views outside the
//   provider's own controllers (UndoRedoControls) can speak outcomes through
//   the one live region instead of growing their own.
// - registerEdgeAutoScroll: enrolls a scroll container with the instance's
//   ONE edge auto-scroll coordinator (one pointer tracker + one frame loop
//   per provider, instead of one per mounted virtual view).

export type CollectionsContainerValue = Readonly<{
  containerRef: RefObject<HTMLElement | null>;
  instructionsId: string;
  paletteInstructionsId: string;
  trashRef: MutableRefObject<NodeId | null>;
  announce: (message: string) => void;
  registerEdgeAutoScroll: (
    el: HTMLElement,
    axis: "x" | "y",
    options?: Readonly<{ edge?: number; maxSpeed?: number }>
  ) => () => void;
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
