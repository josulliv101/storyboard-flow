"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { useCollectionsSelector, type NodeId } from "@storyboard/ui/dnd-collections";

import { graphClipboard } from "@/lib/graph-clipboard";
import { type ItemActionState } from "@/lib/graph-item-action-specs";
import { GRAPH_SELECTION_EVENT, type GraphSelectionDetail } from "@/lib/graph-view-events";

// What the SELECTION-scoped surfaces share: the anchor card's `⋮` and the
// header's `⋮`. Both answer to one selection, unlike the card right-click menu,
// which answers to the card under the pointer and builds its own narrowed
// state (`graph-item-context-menu.tsx`).
//
// Hooks only. The MENU these feed lives in `graph-selection-menu.tsx` — one
// definition rendered by every trigger — so there is no markup here to keep in
// sync with anything.

/**
 * Whether an async item action is in flight.
 *
 * The flag lives in `GraphItemActionsBridge`, a SIBLING of the board rather
 * than an ancestor, so there is no context to read it from — it already
 * broadcasts on the window seam and this is the one thing still listening.
 */
export function useGraphActionBusy(): boolean {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onSelection = (event: Event) => {
      setBusy((event as CustomEvent<GraphSelectionDetail>).detail.busy);
    };
    window.addEventListener(GRAPH_SELECTION_EVENT, onSelection);
    return () => window.removeEventListener(GRAPH_SELECTION_EVENT, onSelection);
  }, []);
  return busy;
}

/** The clipboard's payload size, for the header's "Paste 3 clips" label. */
export function useClipboardCount(): number {
  return useSyncExternalStore(
    graphClipboard.subscribe,
    () => graphClipboard.read().length,
    () => 0,
  );
}

/**
 * Whether a CUT is waiting for a destination.
 *
 * Distinct from "the clipboard has something in it", and the header depends on
 * the difference. A copy leaves its sources untouched, so the board stays fully
 * usable while one sits on the clipboard. A cut does not: its sources are still
 * on the board, dimmed, and they only move when a paste says where — so until
 * then the gesture is half-finished, and the only two moves that complete it
 * are paste and cancel.
 *
 * A boolean, not the Set: this drives a header that only asks "is one pending",
 * and subscribing to the Set would re-render it on every membership change.
 */
export function useHasPendingCut(): boolean {
  return useSyncExternalStore(
    graphClipboard.subscribe,
    () => graphClipboard.pendingCutIds().size > 0,
    () => false,
  );
}

/**
 * The anchor: the card hosting the pill, and the card a paste follows.
 *
 * A plain store read now. It used to be derived here from `selectedIds` with a
 * memo to keep it stable, which was right while ONE consumer asked — but every
 * card now asks "am I the anchor?", a memo per card can disagree with its
 * neighbours, and `setAnchor` (re-aiming without changing the selection) has no
 * derived answer at all. The store owns it; see `interaction.anchorId`.
 */
export function useSelectionAnchorId(): NodeId | null {
  return useCollectionsSelector((s) => s.interaction.anchorId);
}

/** The live selection as the action specs want it. */
export function useSelectionActionState(): ItemActionState {
  const busy = useGraphActionBusy();
  const selectionCount = useCollectionsSelector((s) => s.interaction.selectedIds.size);
  const allDisabled = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    if (ids.size === 0) return false;
    // No spread — this runs on every store notification, and the store notifies
    // on every drop-intent change during a drag.
    for (const id of ids) {
      if (s.graph.nodesById.get(id)?.disabled !== true) return false;
    }
    return true;
  });
  const allCollections = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    if (ids.size === 0) return false;
    for (const id of ids) {
      if (s.graph.nodesById.get(id)?.kind !== "collection") return false;
    }
    return true;
  });
  const allMedia = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    if (ids.size === 0) return false;
    for (const id of ids) {
      if (s.graph.nodesById.get(id)?.kind !== "media") return false;
    }
    return true;
  });
  const singleName = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    if (ids.size !== 1) return null;
    for (const id of ids) return s.graph.nodesById.get(id)?.name ?? null;
    return null;
  });
  const canPaste = useSyncExternalStore(
    graphClipboard.subscribe,
    () => !graphClipboard.isEmpty(),
    () => false,
  );

  return {
    hasSelection: selectionCount > 0,
    selectionCount,
    isSingleSelection: selectionCount === 1,
    canPaste,
    busy,
    allDisabled,
    allCollections,
    allMedia,
    singleName,
  };
}
