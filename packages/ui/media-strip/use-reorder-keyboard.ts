import { type KeyboardEvent } from "react";
import {
  type TimelineItem,
  type CollectionId,
} from "./core/media-strip.types";
import {
  getKeyboardReorderAction,
  IDLE_INTERCEPTED_KEYS,
  SESSION_INTERCEPTED_KEYS,
} from "./core/media-strip.keyboard";
import { useMediaStripBoardStable } from "./media-strip-board";
import { KEYBOARD_REORDER_INSTRUCTIONS } from "./core/media-strip.utils";

type UseReorderKeyboardProps = {
  item: TimelineItem;
  index: number;
  collectionId: CollectionId;
  isKeyboardReordering: boolean;
};

/**
 * Custom hook to translate keyboard events into abstract reorder actions
 * and swallow event propagation dynamically during active reordering.
 */
export function useReorderKeyboard({
  item,
  index,
  collectionId,
  isKeyboardReordering,
}: UseReorderKeyboardProps) {
  const {
    startKeyboardReorder,
    handleKeyboardReorderAction,
    announce,
  } = useMediaStripBoardStable();

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keysToBlock = isKeyboardReordering ? SESSION_INTERCEPTED_KEYS : IDLE_INTERCEPTED_KEYS;

    if (keysToBlock.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (isKeyboardReordering) {
      const action = getKeyboardReorderAction(event.key, isKeyboardReordering);
      if (action) {
        handleKeyboardReorderAction(item.id, action);
      }
    } else {
      if (event.key === "Enter" || event.key === " ") {
        startKeyboardReorder(item.id, collectionId, index);
        announce(
          `Picked up "${item.name}" via keyboard. ${KEYBOARD_REORDER_INSTRUCTIONS}`
        );
      }
    }
  };

  return handleKeyDown;
}
