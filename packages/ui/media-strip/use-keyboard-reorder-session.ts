import { useState, useRef, useCallback } from "react";
import {
  type TimelineItemId,
  type CollectionId,
  type TimelineItem,
  type TimelineCollection,
  type TimelineItemCommand,
  type KeyboardReorderAction,
  type CollectionTimelineItem,
  isCollectionItem,
} from "./core/media-strip.types";
import { wouldCreateCollectionCycle } from "./core/media-strip.validation";

type UseKeyboardReorderSessionProps = {
  itemLookup: Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
  getAdjacentCollectionId: (currentCollectionId: CollectionId, direction: "up" | "down") => CollectionId | null;
  applyCommand: (command: TimelineItemCommand) => void;
  announce: (message: string) => void;
};

/**
 * Custom hook to manage active keyboard reorder session state and actions.
 */
export function useKeyboardReorderSession({
  itemLookup,
  collectionsById,
  getAdjacentCollectionId,
  applyCommand,
  announce,
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
    const found = itemLookup.get(itemId);
    if (!found) return;
    const { collectionId, index, item } = found;

    const col = collectionsById.get(collectionId);
    if (!col) return;
    const items = col.items;

    const moveTo = (toIndex: number, message: string, boundaryMessage?: string) => {
      if (toIndex < 0 || toIndex >= items.length) {
        if (boundaryMessage) {
          announce(boundaryMessage);
        }
        return;
      }
      if (toIndex === index) return;
      applyCommand({
        type: "move",
        itemId,
        fromCollectionId: collectionId,
        toCollectionId: collectionId,
        toIndex,
      });
      announce(message);
    };

    switch (action) {
      case "move-left": {
        moveTo(index - 1, `Moved "${item.name}" to position ${index}.`, `Already first in collection.`);
        break;
      }
      case "move-right": {
        moveTo(index + 1, `Moved "${item.name}" to position ${index + 2}.`, `Already last in collection.`);
        break;
      }
      case "move-home": {
        moveTo(0, `Moved "${item.name}" to start of collection.`);
        break;
      }
      case "move-end": {
        moveTo(items.length - 1, `Moved "${item.name}" to end of collection.`);
        break;
      }
      case "move-up":
      case "move-down": {
        const direction = action === "move-up" ? "up" : "down";
        const nextCollectionId = getAdjacentCollectionId(collectionId, direction);
        if (nextCollectionId) {
          const targetCol = collectionsById.get(nextCollectionId);
          const targetColName = targetCol ? targetCol.name : String(nextCollectionId);
          const targetList = targetCol ? targetCol.items : [];
          const targetIndex = Math.max(0, Math.min(index, targetList.length));

          if (isCollectionItem(item)) {
            if (wouldCreateCollectionCycle({
              movingCollectionId: item.collectionId,
              targetCollectionId: nextCollectionId,
              collectionsById,
            })) {
              announce("Cannot move a collection into itself or one of its nested collections.");
              return;
            }
          }

          applyCommand({
            type: "move",
            itemId,
            fromCollectionId: collectionId,
            toCollectionId: nextCollectionId,
            toIndex: targetIndex,
          });
          announce(`Moved "${item.name}" to collection "${targetColName}" at position ${targetIndex + 1}.`);
        } else {
          announce(direction === "up" ? "Already at the top collection." : "Already at the bottom collection.");
        }
        break;
      }
      case "nest": {
        const prevItem = index > 0 ? items[index - 1] : null;
        const nextItem = index < items.length - 1 ? items[index + 1] : null;

        let targetColItem: CollectionTimelineItem | null = null;
        if (nextItem && nextItem.kind === "collection") {
          targetColItem = nextItem;
        } else if (prevItem && prevItem.kind === "collection") {
          targetColItem = prevItem;
        }

        if (targetColItem) {
          const targetCollectionId = targetColItem.collectionId;

          if (isCollectionItem(item)) {
            if (wouldCreateCollectionCycle({
              movingCollectionId: item.collectionId,
              targetCollectionId,
              collectionsById,
            })) {
              announce("Cannot move a collection into itself or one of its nested collections.");
              return;
            }
          }

          applyCommand({
            type: "nest",
            itemId,
            fromCollectionId: collectionId,
            targetCollectionId,
          });
          announce(`Moved "${item.name}" into collection "${targetColItem.name}".`);
          confirmKeyboardReorder();
        } else {
          announce("No adjacent collection to nest into.");
        }
        break;
      }
      case "confirm": {
        confirmKeyboardReorder();
        announce(`Dropped "${item.name}" at position ${index + 1}.`);
        break;
      }
      case "cancel": {
        cancelKeyboardReorder();
        break;
      }
    }
  }, [
    itemLookup,
    collectionsById,
    getAdjacentCollectionId,
    applyCommand,
    announce,
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
