"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  useCollectionsSelector,
  useCollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { Check } from "lucide-react";

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/core/dropdown-menu";
import { cn } from "@/lib/utils";
import { graphClipboard } from "@/lib/graph-clipboard";
import { useClipDetail } from "./graph-details-context";
import {
  ITEM_ACTION_SPECS,
  visibleItemActions,
  type ItemActionState,
} from "@/lib/graph-item-action-specs";
import {
  GRAPH_SELECTION_EVENT,
  requestGraphItemAction,
  type GraphItemAction,
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
  const singleId = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    if (ids.size !== 1) return "";
    for (const id of ids) return id as string;
    return "";
  });
  const singleIsCollection = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    if (ids.size !== 1) return false;
    for (const id of ids) return s.graph.nodesById.get(id)?.kind === "collection";
    return false;
  });
  // A media card that REFERENCES a timeline opens too — the same rule the card
  // body uses (`openOnClick`). Subscribed per id, so unrelated hydration does
  // not re-render this.
  const singleDetail = useClipDetail(singleId);
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
    openable: singleIsCollection || singleDetail?.duplicateOfTimelineId !== undefined,
  };
}

/**
 * The overflow menu's rows.
 *
 * ONE definition for both `⋮` triggers (R7.2) — the toolbar's, and the header's
 * fallback for when the anchor card has scrolled out of view. They differ only
 * in where the trigger sits, so only the trigger is duplicated.
 */
export function SelectionOverflowItems({
  state,
  includePrimary = [],
}: Readonly<{
  state: ItemActionState;
  /**
   * Primary actions to inline ABOVE the overflow group.
   *
   * This is what makes folding lossless. The pill's width budget is its card's,
   * so on a narrow card actions drop out of the row — and an action that is in
   * neither the row nor the menu is simply gone. The pill passes whatever it
   * could not fit; the header passes ALL of them, because it is the fallback
   * for a card too narrow to show a pill at all.
   */
  includePrimary?: readonly GraphItemAction[];
}>) {
  const store = useCollectionsStore();
  const multiSelectMode = useCollectionsSelector((s) => s.interaction.multiSelectMode);

  const folded = ITEM_ACTION_SPECS.filter(
    (spec) => spec.group === "primary" && includePrimary.includes(spec.action) && spec.visible(state),
  );

  return (
    <DropdownMenuGroup>
      {folded.map((spec) => {
        const Icon = spec.icon(state);
        const reason = spec.unavailableReason(state);
        return (
          <DropdownMenuItem
            key={spec.action}
            disabled={spec.disabled(state)}
            aria-description={reason ?? undefined}
            onSelect={() => requestGraphItemAction(spec.action)}
          >
            <Icon aria-hidden="true" className="mr-2 h-4 w-4" />
            {spec.label(state)}
          </DropdownMenuItem>
        );
      })}
      {folded.length > 0 ? <DropdownMenuSeparator /> : null}
      {/* Additive-tap mode. It lives HERE rather than in the pill because it is
          rarely reached — a mouse already has Ctrl+click, and the pill is
          fighting for width in a 132px card. Touch has no modifier key at all,
          which is the case it exists for.

          Rendered as an ordinary item with its state in the label and a check,
          rather than a checkbox row: the menu wrapper has no checkbox
          primitive, and overriding Radix's `role="menuitem"` would take its
          keyboard handling with it. */}
      <DropdownMenuItem
        data-multi-select-toggle
        onSelect={() => store.setMultiSelectMode(!multiSelectMode)}
      >
        <Check
          aria-hidden="true"
          className={cn("mr-2 h-4 w-4", multiSelectMode ? "opacity-100" : "opacity-0")}
        />
        {multiSelectMode ? "Stop adding to selection" : "Add to selection by tapping"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
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
