import { type KeyboardEvent } from "react";
import { type TimelineItem, type MediaStripMove } from "./media-strip.types";
import { useMediaStripBoard } from "./media-strip-board";

type UseReorderKeyboardProps = {
  item: TimelineItem;
  items: TimelineItem[];
  stripId: string;
  onMoveItem?: (details: MediaStripMove) => void;
  isKeyboardReordering: boolean;
};

/**
 * Custom hook to handle keyboard-based item reordering within a strip
 * and navigation across strips.
 */
export function useReorderKeyboard({
  item,
  items,
  stripId,
  onMoveItem,
  isKeyboardReordering,
}: UseReorderKeyboardProps) {
  const {
    startKeyboardReorder,
    cancelKeyboardReorder,
    confirmKeyboardReorder,
    getAdjacentStripId,
    itemsByStripId,
    announce,
    moveItem,
  } = useMediaStripBoard();

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = items.findIndex((i) => i.id === item.id);
    if (index === -1) return;

    const moveTo = (toIndex: number, message: string, boundaryMessage?: string) => {
      if (toIndex < 0 || toIndex >= items.length) {
        if (boundaryMessage) {
          announce(boundaryMessage);
        }
        return;
      }
      if (toIndex === index) return;
      moveItem(item.id, stripId, toIndex);
      announce(message);
    };

    if (isKeyboardReordering) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        moveTo(index - 1, `Moved "${item.name}" to position ${index}.`, `Already first in strip.`);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        moveTo(index + 1, `Moved "${item.name}" to position ${index + 2}.`, `Already last in strip.`);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();

        const direction = event.key === "ArrowUp" ? "up" : "down";
        const nextStripId = getAdjacentStripId(stripId, direction);

        if (nextStripId) {
          const targetList = itemsByStripId[nextStripId] || [];
          const targetIndex = Math.max(0, Math.min(index, targetList.length));

          moveItem(item.id, nextStripId, targetIndex);
          announce(`Moved "${item.name}" to strip "${nextStripId}" at position ${targetIndex + 1}.`);
        }
      } else if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        moveTo(0, `Moved "${item.name}" to start of strip.`);
      } else if (event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        moveTo(items.length - 1, `Moved "${item.name}" to end of strip.`);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelKeyboardReorder();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        confirmKeyboardReorder();
        announce(`Dropped "${item.name}" at position ${index + 1}.`);
      }
    } else {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        startKeyboardReorder(item.id, stripId, index);
        announce(
          `Picked up "${item.name}" via keyboard. Use ArrowLeft/Right to reorder, ArrowUp/Down to move between strips, Home/End to skip to edges, Enter or Space to drop, Escape to cancel.`
        );
      }
    }
  };

  return handleKeyDown;
}
