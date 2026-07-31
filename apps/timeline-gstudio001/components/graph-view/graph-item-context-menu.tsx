"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  useCollectionsSelector,
  useCollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/core/context-menu";
import { graphClipboard } from "@/lib/graph-clipboard";
import { type ItemActionState } from "@/lib/graph-item-action-specs";
import {
  CONTEXT_MENU_PARTS,
  SELECTION_MENU_CONTENT_CLASS,
  SelectionMenuItems,
} from "./graph-selection-menu";

// Right-click a card, get the actions the rail offers (PL14-007).
//
// Rendered from `ITEM_ACTION_SPECS`, the same list the rail's contextual
// cluster renders, so the two cannot drift into disagreeing about what an item
// can do. Same order, so muscle memory transfers.
//
// SELECTION SEMANTICS, which the punch-list item left open and which are the
// only real decision here. Both follow the convention every file manager and
// editor uses, because a context menu that behaves unusually is worse than one
// that behaves plainly:
//
//   right-click an UNSELECTED item  → select it first, then act on it
//   right-click INSIDE a selection  → leave the selection, act on all of it
//
// The second is why this does not simply select the clicked node: doing that
// would silently collapse a six-item selection to one at the exact moment the
// user reached for "Delete" on all six.

function useItemActionState(nodeId: NodeId): ItemActionState {
  // PRIMITIVES, not the Set. `setSelection` builds a new Set on every change,
  // so subscribing to the reference re-renders this component whenever the
  // selection changes ANYWHERE — and this component wraps every card on the
  // board. That is the package's render-efficiency invariant
  // (dnd-collections/CLAUDE.md: selectors must return primitives or references
  // stable while the slice is unchanged), and reading the Set broke it.
  //
  // Two booleans and a number instead: each re-renders only when its own value
  // changes, and a selection moving between two OTHER cards changes none of
  // them.
  // Each selector answers the question ALREADY NARROWED to this node, so an
  // uninvolved card's values do not move when the selection changes elsewhere.
  //
  // Returning a primitive is not enough on its own: `selectedIds.size` is a
  // number and still goes 0 → 1 when some other card is selected, which would
  // re-render every card just as subscribing to the Set did. What makes these
  // quiet is that an unselected node's answer does not depend on the selection
  // at all.
  const selectionCount = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    // Not in the selection: opening the menu will make this node the whole of
    // it, so one item — whatever anyone else has selected. `ids.size` on its
    // own would be a number that still moves 0 → 1 for every card on the board.
    return ids.has(nodeId) ? ids.size : 1;
  });
  const isSingleSelection = selectionCount === 1;
  // Both false for a MIXED selection, which is what dims the type-specific
  // actions. Narrowed like the rest: outside the selection the honest answer is
  // this node's own kind, since that is what the menu is about to act on.
  const allCollections = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    if (!ids.has(nodeId)) return s.graph.nodesById.get(nodeId)?.kind === "collection";
    for (const id of ids) {
      if (s.graph.nodesById.get(id)?.kind !== "collection") return false;
    }
    return true;
  });
  const allMedia = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    if (!ids.has(nodeId)) return s.graph.nodesById.get(nodeId)?.kind === "media";
    for (const id of ids) {
      if (s.graph.nodesById.get(id)?.kind !== "media") return false;
    }
    return true;
  });
  // Only ever this node's own name: a single selection containing this node IS
  // this node, and outside the selection the menu is about to make it so.
  const ownName = useCollectionsSelector((s) => s.graph.nodesById.get(nodeId)?.name ?? "");
  const allDisabled = useCollectionsSelector((s) => {
    const ids = s.interaction.selectedIds;
    // Same narrowing: outside the selection the honest answer is this node's
    // own state, which is also what the menu is about to act on.
    if (!ids.has(nodeId)) return s.graph.nodesById.get(nodeId)?.disabled === true;
    // No spread — this runs per card per store notification, and the store
    // notifies on every drop-intent change during a drag.
    for (const id of ids) {
      if (s.graph.nodesById.get(id)?.disabled !== true) return false;
    }
    return true;
  });
  // The clipboard is a module singleton, not store state — subscribe so the
  // menu's Copy/Cut↔Paste swap is right the moment it opens.
  const canPaste = useSyncExternalStore(
    graphClipboard.subscribe,
    () => !graphClipboard.isEmpty(),
    () => false,
  );

  return {
    // Right-clicking always gives the menu something to act on: this node, if
    // nothing else. Never zero, so never a menu of dead rows.
    hasSelection: true,
    selectionCount,
    isSingleSelection,
    canPaste,
    // Not modelled. The receiving side already refuses an action while one is
    // in flight (`busyRef` in GraphItemActionsBridge), and a menu is open for
    // a moment rather than a session — mirroring the flag here would mean a
    // second subscription for a state this surface can barely observe.
    busy: false,
    allDisabled,
    allCollections,
    allMedia,
    singleName: isSingleSelection ? ownName : null,
  };
}

export function GraphItemContextMenu({
  nodeId,
  children,
}: Readonly<{ nodeId: NodeId; children: React.ReactNode }>) {
  const store = useCollectionsStore();
  const state = useItemActionState(nodeId);

  const claimSelection = useCallback(() => {
    // Outside the selection: this node becomes it. Inside it, the selection is
    // what the user meant and must survive the click — but the ANCHOR moves to
    // the clicked card (R4.11).
    //
    // That is the point of right-clicking a card that is already selected:
    // "act on all of this, but aim at that one". The anchor decides where a
    // paste lands and which card hosts the pill, and before `setAnchor` there
    // was no way to steer it without deselecting everything else.
    if (store.getSnapshot().interaction.selectedIds.has(nodeId)) {
      store.setAnchor(nodeId);
      return;
    }
    store.setSelection([nodeId]);
  }, [store, nodeId]);

  return (
    <ContextMenu>
      {/* `display: contents` so the trigger generates no box: this sits inside
          a virtualized strip that measures item widths, and an extra layout
          box here would change them. Events still bubble to it, which is all a
          context menu needs — its position comes from the pointer, not from
          the trigger's rect. */}
      <ContextMenuTrigger className="contents" onContextMenu={claimSelection}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        data-graph-item-context-menu={nodeId as string}
        className={SELECTION_MENU_CONTENT_CLASS}
      >
        {/* The SAME menu the anchor's `⋮` and the header's `⋮` open (R7) —
            same rows, same order, same counted labels, same dimmed reasons.
            Only the trigger differs. */}
        <SelectionMenuItems parts={CONTEXT_MENU_PARTS} state={state} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
