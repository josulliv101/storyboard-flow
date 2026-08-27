"use client";

import { createContext, useContext, useMemo } from "react";

import type { CollectionItemNode, NodeId } from "@storyboard/collections-core/graph";
import type { CollectionsStore } from "./collections-store";

// The plain-click interaction policy — what a REAL click on a card's
// selection surface means. It exists because a click is only ever the
// residue the gesture arbitration leaves behind: an activated drag
// (distance, or a press-and-hold grab — even released without moving)
// stops the trailing click at the document (dnd-kit's activation click
// guard), and a surface pan squashes its own (use-pan-with-momentum). What
// reaches the card's onClick is therefore a deliberate, stationary,
// short-press CLICK — and this policy decides what it does.
//
// Configured at the provider, defaults preserving the classic behavior:
//
//   clickSelection "replace" (default): click selects only this card.
//   clickSelection "toggle": click toggles — an unselected card becomes the
//     sole selection, the sole-selected card deselects, a card inside a
//     multi-selection collapses the selection to itself. (The model for
//     selection-gated trim UIs: click shows the handles, click again hides
//     them.)
//
//   onOpenNode + openOnClick: a plain POINTER click on an open-target
//     (default: collections) OPENS it — drill-in navigation — instead of
//     selecting. Ctrl/Cmd+click still selection-toggles it (which is also
//     how open-target nodes join a multi-drag), and KEYBOARD activation
//     (Space, event.detail === 0) always selects, so the keyboard grammar
//     — Space selects, Enter grabs, the app's own key opens — is
//     untouched.
//
//   trimRequiresSelection: trim handles exist ONLY on selected media cards.
//     Unselected card edges are plain card body (press = drag/click), and
//     content's `trimEnabled` follows, so readouts gate with the handles.

export type CollectionsClickSelection = "replace" | "toggle";

export type CollectionsInteractionPolicy = Readonly<{
  clickSelection: CollectionsClickSelection;
  onOpenNode?: (id: NodeId) => void;
  openOnClick?: (id: NodeId, node: CollectionItemNode) => boolean;
  /**
   * Nodes this returns true for do not select on click 1 — the selection is
   * HELD for the double-click window and dropped if a second click arrives.
   *
   * For consumers where a double-click opens a node. The browser fires
   * `click(detail 1)` → `click(detail 2)` → `dblclick`, so by the time a
   * dblclick handler runs, click 1 has already selected AND PAINTED: the user
   * sees the card select and then unselect on its way into the drill-in. No
   * handler that runs at dblclick can fix that, because it is undoing
   * something already on screen. Holding click 1 is the only point where the
   * selection can be prevented rather than reversed.
   *
   * The cost is real and lands on the COMMON gesture: a plain click on one of
   * these nodes selects `SELECTION_DEFER_MS` later. Return false for anything
   * a double-click does not open — a media clip has no second meaning, so
   * delaying it would buy nothing.
   */
  deferSelection?: (id: NodeId, node: CollectionItemNode) => boolean;
  trimRequiresSelection: boolean;
}>;

/**
 * How long a deferred selection waits for a second click.
 *
 * A compromise, and worth knowing which way it errs. Windows' own double-click
 * threshold defaults to 500ms; matching that would make every collection click
 * feel broken. At 250ms a DELIBERATELY slow double-click can still let the
 * selection land first — the card selects, then the drill-in clears it, which
 * is the old flash. That path stays correct (the navigation handler clears the
 * selection either way); it just is not invisible.
 */
export const SELECTION_DEFER_MS = 250;

// Module-scoped because clicks are SERIAL: a pointer produces one click
// sequence at a time, so there is never more than one selection in flight, and
// keeping it here means both card shells share the same pending slot without
// threading state through either of them.
let pendingSelection: { timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * Drop a held selection before it lands. Idempotent.
 *
 * Called on a second click (see `handleSelectionSurfaceClick`) and exported for
 * the consumer's own drill-in paths — a keyboard open or a chevron click during
 * the window should not be followed by a selection appearing behind it.
 */
export function cancelPendingSelection(): void {
  if (pendingSelection === null) return;
  clearTimeout(pendingSelection.timer);
  pendingSelection = null;
}

function schedulePendingSelection(id: NodeId, apply: () => void): void {
  cancelPendingSelection();
  const timer = setTimeout(() => {
    pendingSelection = null;
    apply();
  }, SELECTION_DEFER_MS);
  pendingSelection = { timer };
}

const DEFAULT_POLICY: CollectionsInteractionPolicy = {
  clickSelection: "replace",
  trimRequiresSelection: false,
};

export const CollectionsInteractionPolicyContext =
  createContext<CollectionsInteractionPolicy>(DEFAULT_POLICY);

export function useCollectionsInteractionPolicy(): CollectionsInteractionPolicy {
  return useContext(CollectionsInteractionPolicyContext);
}

/** Normalizes the provider's policy props into a context value keyed on the
 *  fields, so an unchanged policy never invalidates consumers. */
export function useCollectionsInteractionPolicyValue(props: {
  clickSelection?: CollectionsClickSelection;
  onOpenNode?: (id: NodeId) => void;
  openOnClick?: (id: NodeId, node: CollectionItemNode) => boolean;
  deferSelection?: (id: NodeId, node: CollectionItemNode) => boolean;
  trimRequiresSelection?: boolean;
}): CollectionsInteractionPolicy {
  const { clickSelection, onOpenNode, openOnClick, deferSelection, trimRequiresSelection } = props;
  return useMemo<CollectionsInteractionPolicy>(() => {
    if (
      clickSelection === undefined &&
      onOpenNode === undefined &&
      openOnClick === undefined &&
      deferSelection === undefined &&
      trimRequiresSelection === undefined
    ) {
      return DEFAULT_POLICY;
    }
    return {
      clickSelection: clickSelection ?? "replace",
      onOpenNode,
      openOnClick,
      deferSelection,
      trimRequiresSelection: trimRequiresSelection ?? false,
    };
  }, [clickSelection, onOpenNode, openOnClick, deferSelection, trimRequiresSelection]);
}

/**
 * The one click grammar both card shells share (NodeCard and
 * CollectionItem.Root):
 *
 *   Ctrl/Cmd+click  → additive selection toggle, always.
 *   pointer click   → open, when the policy marks this node an open target.
 *   otherwise       → select, per `clickSelection`.
 */
export function handleSelectionSurfaceClick(args: {
  event: Readonly<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; detail: number }>;
  id: NodeId;
  node: CollectionItemNode;
  store: CollectionsStore;
  policy: CollectionsInteractionPolicy;
}): void {
  const { event, id, node, store, policy } = args;

  // Only the FIRST click of a sequence carries selection intent. A
  // double-click's second click (detail === 2) is the residue of a
  // rename-in-place gesture (dblclick), not a deliberate re-toggle — and in
  // toggle mode letting it run was destructive: a double-click on a card in a
  // multi-selection collapsed the selection to that card on click 1, then
  // CLEARED it on click 2, so the user began renaming with nothing selected.
  // Keyboard activation (detail === 0) and a plain single click (detail === 1)
  // both fall through.
  //
  // The cancel is what makes `deferSelection` work: this is the earliest point
  // at which a second click is KNOWN, so it is where a pending selection from
  // click 1 gets called off before it can paint.
  if (event.detail > 1) {
    cancelPendingSelection();
    return;
  }

  // Additive-tap MODE is the same branch as the modifier, deliberately: a
  // touchscreen has no Ctrl to hold, so the mode is how that gesture is
  // reached at all, and it must behave identically or it becomes a second
  // thing to learn rather than a way in to the first.
  if (event.ctrlKey || event.metaKey || store.getSnapshot().interaction.multiSelectMode) {
    store.toggleSelected(id);
    return;
  }

  // Shift = extend from the pivot, in the order the parent renders its
  // children — which is the order on screen in both the grid and the strip.
  //
  // Checked AFTER Ctrl/Cmd so Ctrl+Shift+click stays a plain toggle rather
  // than becoming a third gesture nobody asked for, and BEFORE the open
  // branch: shift-clicking a collection must extend the selection, not drill
  // into it. Losing a five-card range to an accidental navigation is a worse
  // outcome than a shift+click that failed to open something.
  if (event.shiftKey) {
    store.selectRange(id);
    return;
  }

  // detail === 0 is keyboard activation (Space on the <button>): keyboard
  // users select here and open through their own key, so only a real
  // pointer click routes to open.
  if (
    event.detail > 0 &&
    policy.onOpenNode !== undefined &&
    (policy.openOnClick ? policy.openOnClick(id, node) : node.kind === "collection")
  ) {
    policy.onOpenNode(id);
    return;
  }

  // The plain-select branches, applied NOW or held for the double-click
  // window — see `deferSelection`. Ctrl/Cmd and Shift above never defer: those
  // are explicit multi-select gestures with no double-click meaning, and making
  // the user wait for a modifier-click to land would be pure cost.
  const apply = () => {
    if (policy.clickSelection === "toggle") {
      const selected = store.getSnapshot().interaction.selectedIds;
      if (selected.has(id) && selected.size === 1) {
        store.clearSelection();
      } else {
        store.setSelection([id]);
      }
      return;
    }
    store.setSelection([id]);
  };

  if (policy.deferSelection?.(id, node) === true) {
    schedulePendingSelection(id, apply);
    return;
  }
  apply();
}
