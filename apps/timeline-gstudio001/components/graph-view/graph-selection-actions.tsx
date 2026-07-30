"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { useCollectionsSelector, type NodeId } from "@storyboard/ui/dnd-collections";

import { DropdownMenuGroup, DropdownMenuItem } from "@/components/core/dropdown-menu";
import { graphClipboard } from "@/lib/graph-clipboard";
import { resolveAnchorId, type SelectionAnchorMemo } from "@/lib/graph-selection-anchor";
import {
  visibleItemActions,
  type ItemActionState,
} from "@/lib/graph-item-action-specs";
import {
  GRAPH_SELECTION_EVENT,
  requestGraphItemAction,
  type GraphSelectionDetail,
} from "@/lib/graph-view-events";

// What the SELECTION-scoped surfaces share: the floating toolbar, its overflow,
// and the header's fallback overflow. All three answer to one selection, unlike
// the card right-click menu, which answers to the card under the pointer and
// builds its own narrowed state (`graph-item-context-menu.tsx`).
//
// These are plain hooks rather than a context: `GraphBoard` renders every
// consumer, so it resolves the anchor ONCE and hands it down. Two independent
// anchor hooks would each keep their own memo and could disagree about which
// card a paste follows — the toolbar pointing at one card while the header's
// label named another.

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
 * The anchor: the card the toolbar attaches to and the card a paste follows.
 *
 * Call this ONCE per board. The memo it threads is what keeps the answer stable
 * across renders that changed nothing (see `resolveAnchorId`).
 */
export function useSelectionAnchorId(): NodeId | null {
  const selectedIds = useCollectionsSelector((s) => s.interaction.selectedIds);
  const graph = useCollectionsSelector((s) => s.graph);
  const [memo, setMemo] = useState<SelectionAnchorMemo>(() => ({
    anchorId: null,
    selectedIds,
  }));

  // React's "adjust state during render": setting state on the component
  // currently rendering re-runs it immediately, before anything commits, so
  // nothing downstream ever sees a stale anchor. A ref would have been the
  // obvious way to carry the memo and is the wrong one — reading and writing
  // one during render is what makes a component miss updates.
  let current = memo;
  if (memo.selectedIds !== selectedIds) {
    current = { anchorId: resolveAnchorId(graph, selectedIds, memo), selectedIds };
    setMemo(current);
  }
  return current.anchorId;
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

/**
 * The overflow menu's rows.
 *
 * ONE definition for both `⋮` triggers (R7.2) — the toolbar's, and the header's
 * fallback for when the anchor card has scrolled out of view. They differ only
 * in where the trigger sits, so only the trigger is duplicated.
 */
export function SelectionOverflowItems({ state }: Readonly<{ state: ItemActionState }>) {
  return (
    <DropdownMenuGroup>
      {visibleItemActions(state, "overflow").map((spec) => {
        const Icon = spec.icon(state);
        const reason = spec.unavailableReason(state);
        return (
          <DropdownMenuItem
            key={spec.action}
            disabled={spec.disabled(state)}
            // The reason travels as the row's accessible description, not as a
            // tooltip: a disabled menu row is not hoverable in any useful way,
            // and a screen reader must still be told why.
            aria-description={reason ?? undefined}
            onSelect={() => requestGraphItemAction(spec.action)}
          >
            <Icon aria-hidden="true" className="mr-2 h-4 w-4" />
            {spec.label(state)}
            {reason === null ? null : (
              <span className="ml-auto pl-3 text-[11px] text-zinc-500">{reason}</span>
            )}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );
}
