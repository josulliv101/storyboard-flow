import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { isEditableKeyboardTarget } from "./node-dom";
import { useCollectionsStore, type CollectionsStore } from "./collections-store";

/**
 * How far the pointer may travel between press and release and still count as
 * a CLICK on the background. Past it the gesture was a pan (or the tail of a
 * card drag that ended over empty space), and a pan must not silently drop the
 * user's selection.
 */
const BACKGROUND_CLICK_SLOP_PX = 4;

/**
 * What counts as an ACTION rather than background. Anything a click here would
 * already do something with — a control, a card, a gesture affordance — leaves
 * the selection alone; everything else is "clicking away".
 *
 * Roles are matched as well as tags because a control is often neither: the
 * app's menus, toggles, and tabs are divs with a role, and a click that opens
 * a menu must not also clear behind it.
 */
const NON_BACKGROUND_SELECTOR = [
  "[data-node-id]",
  "[data-drag-handle]",
  "[data-trim-handle]",
  "[data-trim-overview]",
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='slider']",
  "[role='menuitem']",
  "[role='menuitemradio']",
  "[role='menuitemcheckbox']",
  "[role='option']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='separator']",
  // A toolbar's BUTTONS are already covered above, but its padding and its
  // separators are not — and a toolbar that floats over the surface (a
  // consumer's contextual selection toolbar, say) is exactly where a stray
  // click lands. Clearing there would dismiss the toolbar out from under the
  // click that was aimed at it.
  "[role='toolbar']",
].join(", ");

/**
 * Layers that own the whole screen while they are open. A click anywhere with
 * one of these up is DISMISSING it — an action, and the only thing that click
 * does. Menus and dialogs also mount an invisible full-screen dismiss layer,
 * so the click's target is that layer rather than anything meaningful; without
 * this the first click that closed a menu also silently cleared the selection
 * behind it, which unmounted the very controls the menu belonged to.
 */
const DISMISSABLE_LAYER_SELECTOR =
  "[role='menu'], [role='dialog'], [role='alertdialog'], [role='listbox']";

/** True when a click on `target` is an action, not a click on the background. */
function isActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(NON_BACKGROUND_SELECTOR)) return true;
  if (target.ownerDocument.querySelector(DISMISSABLE_LAYER_SELECTOR)) return true;
  return isEditableKeyboardTarget(target);
}

/**
 * The shared decision, for both the container-scoped hook and the page-wide
 * component below: does this click mean "deselect"?
 *
 * The press position is remembered so a PAN or a drag cannot be mistaken for a
 * click — both end with a `click` event too, and only the one that stayed put
 * means "I clicked the background". A double-click's second click is ignored
 * for the same reason the card grammar ignores it: the gesture is already
 * committed to something else.
 */
function shouldClear(
  store: CollectionsStore,
  target: EventTarget | null,
  detail: number,
  clientX: number,
  clientY: number,
  origin: { x: number; y: number } | null,
): boolean {
  if (detail > 1) return false;
  if (isActionTarget(target)) return false;
  // Keyboard activation reports 0/0 and no preceding pointerdown; a real
  // background click always has one.
  if (!origin) return false;
  if (
    Math.abs(clientX - origin.x) > BACKGROUND_CLICK_SLOP_PX ||
    Math.abs(clientY - origin.y) > BACKGROUND_CLICK_SLOP_PX
  ) {
    return false;
  }
  return store.getSnapshot().interaction.selectedIds.size > 0;
}

/**
 * Clicking empty space in a SURFACE clears the selection — the counterpart to
 * the card grammar in `interaction-policy`, and the only way to reach "nothing
 * selected" with the mouse.
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
      if (
        shouldClear(store, event.target, event.detail, event.clientX, event.clientY, origin)
      ) {
        store.clearSelection();
      }
    },
    [store],
  );

  return { onPointerDown, onClick };
}

/**
 * The same rule, widened to the whole PAGE: any click that is not an action
 * clears the selection, wherever it lands — the board's padding, the header,
 * the space beside the surfaces, another panel entirely.
 *
 * Mounted by the CONSUMER rather than by the provider, because "the page" is
 * the consumer's idea, not the package's: an app embedding a small collections
 * widget in a larger screen would not want clicks elsewhere reaching into it.
 * Render it inside the provider on the screen the collection owns.
 *
 * The click is read in the BUBBLE phase, deliberately. A click that something
 * else has already claimed is not a click-away, and the claim shows up as
 * stopped propagation — most importantly dnd-kit's, which eats the trailing
 * click after a drag or a hold-grab from a capture-phase listener on this same
 * document. Listening in capture ran BEFORE that suppressor (listeners fire in
 * registration order, and this one mounts first), so releasing a hold-grab in
 * place cleared the selection the grab was holding.
 */
export function ClearSelectionOnOutsideClick(): null {
  const store = useCollectionsStore();

  useEffect(() => {
    if (typeof document === "undefined") return;
    let origin: { x: number; y: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      origin = { x: event.clientX, y: event.clientY };
    };
    const onClick = (event: MouseEvent) => {
      const pressed = origin;
      origin = null;
      if (
        shouldClear(store, event.target, event.detail, event.clientX, event.clientY, pressed)
      ) {
        store.clearSelection();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick);
    };
  }, [store]);

  return null;
}
