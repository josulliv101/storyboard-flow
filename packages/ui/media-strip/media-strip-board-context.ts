"use client";

import { createContext, useContext } from "react";
import {
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemCommand,
  type KeyboardReorderAction,
  type DropPlacement,
} from "./core/media-strip.types";

// Split out from media-strip-board.tsx so components that only need to read
// board context (e.g. MediaStripThumbnail, which the board itself renders
// inside its drag overlay) don't have to import the board component module
// and create an import cycle.

export type MediaStripBoardStableContextType = {
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
  itemLookup: Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;
  registerCollection: (collectionId: CollectionId) => void;
  unregisterCollection: (collectionId: CollectionId) => void;
  getAdjacentCollectionId: (currentCollectionId: CollectionId, direction: "up" | "down") => CollectionId | null;
  applyCommand: (command: TimelineItemCommand) => void;
  announce: (message: string) => void;
  startKeyboardReorder: (itemId: TimelineItemId, collectionId: CollectionId, index: number) => void;
  cancelKeyboardReorder: () => void;
  confirmKeyboardReorder: () => void;
  handleKeyboardReorderAction: (itemId: TimelineItemId, action: KeyboardReorderAction) => void;
};

export type MediaStripBoardDragContextType = {
  activeDragId: TimelineItemId | null;
  activeDragSourceCollectionId: CollectionId | null;
  activeNestTargetId: CollectionId | null;
  /**
   * Live drop placement for the in-progress drag, updated on every
   * move/over. Drives the before/after "drop here" indicator bars in
   * media-strip-item.tsx. "inside" placement is intentionally not read
   * from here for that purpose — the nest hotspot overlay derives its own
   * `isOverNest` from `activeNestTargetId` instead, since that's the
   * signal that already existed before DropPlacement did.
   */
  activeDropPlacement: DropPlacement | null;
  activeDragWidth: number;
  activeKeyboardReorderId: TimelineItemId | null;
  /**
   * Id of the item whose drop was just rejected (currently: a nest-cycle
   * attempt), for ~600ms after the rejection — long enough for a brief
   * visual cue on that item's card. `null` the rest of the time, including
   * during a drag itself.
   */
  rejectedItemId: TimelineItemId | null;
};

export const MediaStripBoardStableContext = createContext<MediaStripBoardStableContextType | null>(null);
export const MediaStripBoardDragContext = createContext<MediaStripBoardDragContextType | null>(null);

export function useMediaStripBoardStable() {
  const context = useContext(MediaStripBoardStableContext);
  if (!context) {
    throw new Error("useMediaStripBoardStable must be used within a MediaStripBoard provider");
  }
  return context;
}

export function useMediaStripBoardDrag() {
  const context = useContext(MediaStripBoardDragContext);
  if (!context) {
    throw new Error("useMediaStripBoardDrag must be used within a MediaStripBoard provider");
  }
  return context;
}

export function useMediaStripBoardStableOptional() {
  return useContext(MediaStripBoardStableContext);
}
