import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { isEditableKeyboardTarget } from "./node-dom";
import type { CollectionsStore } from "./collections-store";

/**
 * How far the pointer may travel between press and release and still count as
 * a CLICK on the background. Past it the gesture was a pan (or the tail of a
 * card drag that ended over empty space), and a pan must not silently drop the
 * user's selection.
 */
const BACKGROUND_CLICK_SLOP_PX = 4;

/**
 * Targets inside a surface that own their own press even though they are not
 * cards: the trim affordances, and anything a consumer marked as its own
 * gesture. Cards are excluded separately by `[data-node-id]`.
 */
const NON_BACKGROUND_SELECTOR =
  "[data-node-id], [data-drag-handle], [data-trim-handle], [data-trim-overview], button, a, input, textarea, select, [role='slider']";

/**
 * Clicking empty space in a surface clears the selection — the counterpart to
 * the card grammar in `interaction-policy`, and the only way to reach "nothing
 * selected" with the mouse.
 *
 * The press position is remembered so a PAN cannot be mistaken for a click:
 * both end with a `click` event on the scroll container, and only the one that
 * stayed put means "I clicked the background". A double-click's second click
 * is ignored for the same reason the card grammar ignores it — the gesture is
 * already committed to something else.
 */
export function useBackgroundSelectionClear(store: CollectionsStore): Readonly<{
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
}> {
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    originRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const origin = originRef.current;
      originRef.current = null;

      if (event.detail > 1) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(NON_BACKGROUND_SELECTOR)) return;
      if (isEditableKeyboardTarget(target)) return;

      // Keyboard activation reports 0/0 and no preceding pointerdown; a real
      // background click always has one.
      if (!origin) return;
      if (
        Math.abs(event.clientX - origin.x) > BACKGROUND_CLICK_SLOP_PX ||
        Math.abs(event.clientY - origin.y) > BACKGROUND_CLICK_SLOP_PX
      ) {
        return;
      }

      if (store.getSnapshot().interaction.selectedIds.size === 0) return;
      store.clearSelection();
    },
    [store],
  );

  return { onPointerDown, onClick };
}
