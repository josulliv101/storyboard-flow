"use client";

import { createContext, useContext, useMemo } from "react";

import type { CollectionItemNode, NodeId } from "../core/graph";
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
  trimRequiresSelection: boolean;
}>;

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
  trimRequiresSelection?: boolean;
}): CollectionsInteractionPolicy {
  const { clickSelection, onOpenNode, openOnClick, trimRequiresSelection } = props;
  return useMemo<CollectionsInteractionPolicy>(() => {
    if (
      clickSelection === undefined &&
      onOpenNode === undefined &&
      openOnClick === undefined &&
      trimRequiresSelection === undefined
    ) {
      return DEFAULT_POLICY;
    }
    return {
      clickSelection: clickSelection ?? "replace",
      onOpenNode,
      openOnClick,
      trimRequiresSelection: trimRequiresSelection ?? false,
    };
  }, [clickSelection, onOpenNode, openOnClick, trimRequiresSelection]);
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
  event: Readonly<{ ctrlKey: boolean; metaKey: boolean; detail: number }>;
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
  if (event.detail > 1) return;

  if (event.ctrlKey || event.metaKey) {
    store.toggleSelected(id);
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
}
