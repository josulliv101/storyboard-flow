import { type KeyboardEvent } from "react";
import {
  type TimelineItem,
  type CollectionId,
  type TimelineItemMove,
  type TimelineItemDrop,
  type CollectionTimelineItem,
  isCollectionItem,
} from "./media-strip.types";
import { useMediaStripBoard } from "./media-strip-board";
import { wouldCreateCollectionCycle } from "./media-strip.validation";

type UseReorderKeyboardProps = {
  item: TimelineItem;
  items: readonly TimelineItem[];
  collectionId: CollectionId;
  onMoveItem?: (details: TimelineItemMove | TimelineItemDrop) => void;
  isKeyboardReordering: boolean;
};

/**
 * Custom hook to handle keyboard-based item reordering within a collection
 * and navigation across collections.
 */
export function useReorderKeyboard({
  item,
  items,
  collectionId,
  onMoveItem,
  isKeyboardReordering,
}: UseReorderKeyboardProps) {
  const {
    startKeyboardReorder,
    cancelKeyboardReorder,
    confirmKeyboardReorder,
    getAdjacentCollectionId,
    collectionsById,
    announce,
    moveItem,
    nestItem,
  } = useMediaStripBoard();

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = items.findIndex((i) => i.id === item.id);
    if (index === -1) return;

    // Block reorder navigation keys from bubbling up to parent containers (like ToggleGroup)
    // to prevent triggering roving tabindex selection focus changes.
    const keysToBlock = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape", "n", "N"];
    if (keysToBlock.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }

    const moveTo = (toIndex: number, message: string, boundaryMessage?: string) => {
      if (toIndex < 0 || toIndex >= items.length) {
        if (boundaryMessage) {
          announce(boundaryMessage);
        }
        return;
      }
      if (toIndex === index) return;
      moveItem(item.id, collectionId, toIndex);
      announce(message);
    };

    if (isKeyboardReordering) {
      if (event.key === "ArrowLeft") {
        moveTo(index - 1, `Moved "${item.name}" to position ${index}.`, `Already first in collection.`);
      } else if (event.key === "ArrowRight") {
        moveTo(index + 1, `Moved "${item.name}" to position ${index + 2}.`, `Already last in collection.`);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const direction = event.key === "ArrowUp" ? "up" : "down";
        const nextCollectionId = getAdjacentCollectionId(collectionId, direction);

        if (nextCollectionId) {
          const targetCol = collectionsById[nextCollectionId];
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

          moveItem(item.id, nextCollectionId, targetIndex);
          announce(`Moved "${item.name}" to collection "${nextCollectionId}" at position ${targetIndex + 1}.`);
        } else {
          announce(direction === "up" ? "Already at the top collection." : "Already at the bottom collection.");
        }
      } else if (event.key === "Home") {
        moveTo(0, `Moved "${item.name}" to start of collection.`);
      } else if (event.key === "End") {
        moveTo(items.length - 1, `Moved "${item.name}" to end of collection.`);
      } else if (event.key.toLowerCase() === "n") {
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

          nestItem(item.id, targetCollectionId);
          announce(`Moved "${item.name}" into collection "${targetColItem.name}".`);
          confirmKeyboardReorder();
        } else {
          announce("No adjacent collection to nest into.");
        }
      } else if (event.key === "Escape") {
        cancelKeyboardReorder();
      } else if (event.key === "Enter" || event.key === " ") {
        confirmKeyboardReorder();
        announce(`Dropped "${item.name}" at position ${index + 1}.`);
      }
    } else {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        startKeyboardReorder(item.id, collectionId, index);
        announce(
          `Picked up "${item.name}" via keyboard. Use ArrowLeft/Right to reorder, ArrowUp/Down to move between collections, Home/End to skip to edges, N to nest into adjacent collection, Enter or Space to drop, Escape to cancel.`
        );
      }
    }
  };

  return handleKeyDown;
}

