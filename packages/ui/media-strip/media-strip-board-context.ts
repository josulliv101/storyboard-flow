"use client";

import { createContext, useContext } from "react";
import {
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemCommand,
  type KeyboardReorderAction,
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

// Per-move drag state (drop placement, nest target, rejection flash) does
// NOT live in context — it's in an external selector store
// (media-strip-drag-store.ts) so an item re-renders only when its own slice
// changes, not on every pointer move. This context holds only stable,
// board-level values.

export const MediaStripBoardStableContext = createContext<MediaStripBoardStableContextType | null>(null);

export function useMediaStripBoardStable() {
  const context = useContext(MediaStripBoardStableContext);
  if (!context) {
    throw new Error("useMediaStripBoardStable must be used within a MediaStripBoard provider");
  }
  return context;
}

export function useMediaStripBoardStableOptional() {
  return useContext(MediaStripBoardStableContext);
}
