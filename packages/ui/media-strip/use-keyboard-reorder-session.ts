import { useState, useRef, useCallback } from "react";
import {
  type TimelineItemId,
  type CollectionId,
  type TimelineItem,
  type TimelineCollection,
  type TimelineItemCommand,
  type KeyboardReorderAction,
} from "./core/media-strip.types";
import { resolveKeyboardReorderAction } from "./core/media-strip.keyboard";

type UseKeyboardReorderSessionProps = {
  itemLookup: Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
  getAdjacentCollectionId: (currentCollectionId: CollectionId, direction: "up" | "down") => CollectionId | null;
  parentByCollectionId: ReadonlyMap<CollectionId, CollectionId>;
  applyCommand: (command: TimelineItemCommand) => void;
  announce: (message: string) => void;
  flashRejection: (itemId: TimelineItemId) => void;
};

/**
 * Custom hook to manage active keyboard reorder session state and actions.
 */
export function useKeyboardReorderSession({
  itemLookup,
  collectionsById,
  getAdjacentCollectionId,
  parentByCollectionId,
  applyCommand,
  announce,
  flashRejection,
}: UseKeyboardReorderSessionProps) {
  const [activeKeyboardReorderId, setActiveKeyboardReorderId] = useState<TimelineItemId | null>(null);
  const initialPositionRef = useRef<{ collectionId: CollectionId; index: number; itemName: string } | null>(null);

  const startKeyboardReorder = useCallback((itemId: TimelineItemId, collectionId: CollectionId, index: number) => {
    setActiveKeyboardReorderId(itemId);
    const itemName = itemLookup.get(itemId)?.item.name ?? "item";
    initialPositionRef.current = { collectionId, index, itemName };
  }, [itemLookup]);

  const cancelKeyboardReorder = useCallback(() => {
    const itemId = activeKeyboardReorderId;
    const orig = initialPositionRef.current;

    if (itemId && orig) {
      const current = itemLookup.get(itemId);
      const currentCollectionId = current ? current.collectionId : orig.collectionId;
      if (!current || current.collectionId !== orig.collectionId || current.index !== orig.index) {
        applyCommand({
          type: "move",
          itemId,
          fromCollectionId: currentCollectionId,
          toCollectionId: orig.collectionId,
          toIndex: orig.index,
        });
      }
      announce(`Reorder cancelled. Reverted "${orig.itemName}" to position ${orig.index + 1}.`);
    }

    setActiveKeyboardReorderId(null);
    initialPositionRef.current = null;
  }, [activeKeyboardReorderId, itemLookup, applyCommand, announce]);

  const confirmKeyboardReorder = useCallback(() => {
    setActiveKeyboardReorderId(null);
    initialPositionRef.current = null;
  }, []);

  const handleKeyboardReorderAction = useCallback((itemId: TimelineItemId, action: KeyboardReorderAction) => {
    if (action === "cancel") {
      cancelKeyboardReorder();
      return;
    }

    if (action === "confirm") {
      const found = itemLookup.get(itemId);
      confirmKeyboardReorder();
      if (found) {
        announce(`Dropped "${found.item.name}" at position ${found.index + 1}.`);
      }
      return;
    }

    const resolution = resolveKeyboardReorderAction({
      itemId,
      action,
      itemLookup,
      collectionsById,
      parentByCollectionId,
      getAdjacentCollectionId,
    });
    if (!resolution) return;

    switch (resolution.kind) {
      case "move": {
        applyCommand(resolution.command);
        announce(resolution.announcement);
        if (resolution.endsSession) confirmKeyboardReorder();
        break;
      }
      case "rejected": {
        announce(resolution.announcement);
        flashRejection(itemId);
        break;
      }
      case "no-op": {
        if (resolution.announcement) announce(resolution.announcement);
        break;
      }
    }
  }, [
    itemLookup,
    collectionsById,
    getAdjacentCollectionId,
    parentByCollectionId,
    applyCommand,
    announce,
    flashRejection,
    confirmKeyboardReorder,
    cancelKeyboardReorder,
  ]);

  return {
    activeKeyboardReorderId,
    startKeyboardReorder,
    cancelKeyboardReorder,
    confirmKeyboardReorder,
    handleKeyboardReorderAction,
  };
}
