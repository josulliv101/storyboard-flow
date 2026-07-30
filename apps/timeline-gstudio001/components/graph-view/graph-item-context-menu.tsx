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
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/core/context-menu";
import { graphClipboard } from "@/lib/graph-clipboard";
import { requestGraphItemAction } from "@/lib/graph-view-events";
import { visibleItemActions, type ItemActionState } from "@/lib/graph-item-action-specs";

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
  const selectedIds = useCollectionsSelector((s) => s.interaction.selectedIds);
  const allDisabled = useCollectionsSelector((s) => {
    const ids = [...s.interaction.selectedIds];
    if (ids.length === 0) return false;
    return ids.every((id) => s.graph.nodesById.get(id)?.disabled === true);
  });
  // The clipboard is a module singleton, not store state — subscribe so the
  // menu's Copy/Cut↔Paste swap is right the moment it opens.
  const canPaste = useSyncExternalStore(
    graphClipboard.subscribe,
    () => !graphClipboard.isEmpty(),
    () => false,
  );

  // The count the menu should describe is the selection it will ACT on, which
  // for an unselected node is the one about to be selected (see the note
  // above) — otherwise the menu opens describing "no selection" and disables
  // everything on a card the user just right-clicked.
  const willActOnSelection = selectedIds.has(nodeId) ? selectedIds.size : 1;

  return {
    hasSelection: willActOnSelection > 0,
    isSingleSelection: willActOnSelection === 1,
    canPaste,
    // Not modelled. The receiving side already refuses an action while one is
    // in flight (`busyRef` in GraphItemActionsBridge), and a menu is open for
    // a moment rather than a session — mirroring the flag here would mean a
    // second subscription for a state this surface can barely observe.
    busy: false,
    allDisabled: selectedIds.has(nodeId) ? allDisabled : false,
  };
}

export function GraphItemContextMenu({
  nodeId,
  children,
}: Readonly<{ nodeId: NodeId; children: React.ReactNode }>) {
  const store = useCollectionsStore();
  const state = useItemActionState(nodeId);
  const actions = visibleItemActions(state);

  const claimSelection = useCallback(() => {
    // Only when the node is OUTSIDE the current selection. Inside it, the
    // selection is what the user meant and must survive the click.
    if (store.getSnapshot().interaction.selectedIds.has(nodeId)) return;
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
      <ContextMenuContent data-graph-item-context-menu={nodeId as string}>
        {actions.map((spec) => {
          const Icon = spec.icon(state);
          return (
            <ContextMenuItem
              key={spec.action}
              disabled={spec.disabled(state)}
              onSelect={() => requestGraphItemAction(spec.action)}
            >
              <Icon aria-hidden="true" className="mr-2 h-4 w-4" />
              {spec.label(state)}
            </ContextMenuItem>
          );
        })}
      </ContextMenuContent>
    </ContextMenu>
  );
}
