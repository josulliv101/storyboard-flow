import { type KeyboardEvent } from "react";
import {
  type TimelineItem,
  type CollectionId,
  type KeyboardReorderAction,
} from "./media-strip.types";
import { useMediaStripBoardStable } from "./media-strip-board";

type UseReorderKeyboardProps = {
  item: TimelineItem;
  items: readonly TimelineItem[];
  collectionId: CollectionId;
  isKeyboardReordering: boolean;
};

/**
 * Custom hook to translate keyboard events into abstract reorder actions
 * and swallow event propagation dynamically during active reordering.
 */
export function useReorderKeyboard({
  item,
  items,
  collectionId,
  isKeyboardReordering,
}: UseReorderKeyboardProps) {
  const {
    startKeyboardReorder,
    handleKeyboardReorderAction,
    announce,
  } = useMediaStripBoardStable();

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = items.findIndex((i) => i.id === item.id);
    if (index === -1) return;

    // Swallowed keys list. We block arrows, Home, End, Escape, Nest keys, and confirm keys (Enter & Space)
    // unconditionally so that arrow-key presses on the reorder handle do not trigger the ToggleGroup's
    // roving focus navigation, and Enter/Space trigger reorder pick-up rather than default button actions.
    const keysToBlock = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape", "n", "N", "Enter", " "];

    if (keysToBlock.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (isKeyboardReordering) {
      let action: KeyboardReorderAction | null = null;
      if (event.key === "ArrowLeft") {
        action = "move-left";
      } else if (event.key === "ArrowRight") {
        action = "move-right";
      } else if (event.key === "ArrowUp") {
        action = "move-up";
      } else if (event.key === "ArrowDown") {
        action = "move-down";
      } else if (event.key === "Home") {
        action = "move-home";
      } else if (event.key === "End") {
        action = "move-end";
      } else if (event.key.toLowerCase() === "n") {
        action = "nest";
      } else if (event.key === "Escape") {
        action = "cancel";
      } else if (event.key === "Enter" || event.key === " ") {
        action = "confirm";
      }

      if (action) {
        handleKeyboardReorderAction(item.id, action);
      }
    } else {
      if (event.key === "Enter" || event.key === " ") {
        startKeyboardReorder(item.id, collectionId, index);
        announce(
          `Picked up "${item.name}" via keyboard. Use ArrowLeft/Right to reorder, ArrowUp/Down to move between collections, Home/End to skip to edges, N to nest into adjacent collection, Enter or Space to drop, Escape to cancel.`
        );
      }
    }
  };

  return handleKeyDown;
}
