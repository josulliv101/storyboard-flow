"use client";

import { createContext, useContext, useEffect, useMemo, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";

import {
  focusNodeWhenMounted,
  getChildren,
  isEditableKeyboardTarget,
  parseNodeId,
  resolveTrashCommand,
  useCollectionsStore,
  type CollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { toast } from "@/components/core/sonner";
import {
  GRAPH_OPEN_ITEM_EVENT,
  requestGraphItemDetails,
  requestGraphRenameItem,
} from "@/lib/graph-view-events";

import type { ClipDetail } from "@storyboard/timeline-domain";

import type { GraphDetailsStore } from "@/lib/graph-details-store";

import { useGraphDetailsStore } from "./graph-details-context";
import { pressFeedbackHostFor, spawnPressFeedback } from "./press-feedback";

type GraphViewNav = Readonly<{
  /**
   * Focus a timeline, optimistically. Returns whether it took the navigation:
   * FALSE means the node's parent chain does not reach this project, so the
   * caller still owns the click. Only the breadcrumb reads it — a crumb is a
   * real <a href>, and one that resolves to nothing must fall back to letting
   * the browser follow it rather than silently eating the click.
   */
  openTimeline: (nodeId: NodeId) => boolean;
  /** The timeline currently in focus. Cards read it to tell whether they are
   *  being shown OUTSIDE their own collection — which is exactly the flat
   *  strip, and what makes a provenance label worth drawing. */
  focusedId: string;
}>;

export const GraphViewNavContext = createContext<GraphViewNav | null>(null);

export function GraphViewNavProvider({
  projectId,
  focusedId,
  openNodeRef,
  onNavigateStart,
  children,
}: Readonly<{
  projectId: string;
  focusedId: string;
  /**
   * Written with the latest openTimeline. The provider-level click-to-open
   * callback (the `onOpenNode` prop on <DndCollections>) is registered ABOVE
   * the engine provider, where this component's store isn't reachable — the
   * ref is the seam that hands it the current focus logic.
   */
  openNodeRef?: MutableRefObject<(nodeId: NodeId) => void>;
  /**
   * The focus path this navigation is heading to, published BEFORE the
   * router push. `router.push` doesn't commit the new pathname until the
   * server answers that segment's RSC request, and the view derives its focus
   * from the pathname — so without this the whole board waits on a round trip
   * it needs nothing from. The consumer renders the pending path immediately
   * and drops it when the URL catches up.
   */
  onNavigateStart?: (path: readonly string[]) => void;
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  const value = useMemo<GraphViewNav>(
    () => ({
      focusedId,
      openTimeline: (nodeId) => {
        const id = nodeId as string;
        const timelineId = detailsStore.get(id)?.duplicateOfTimelineId ?? id;
        // Already here: handled, in the sense the caller must not also act.
        if (timelineId === focusedId) return true;

        const base = `/timeline/${encodeURIComponent(projectId)}/graph`;
        if (timelineId === projectId) {
          onNavigateStart?.([]);
          router.push(base);
          return true;
        }

        const { graph } = store.getSnapshot();
        const chain: string[] = [timelineId];
        // Parse `projectId` to `NodeId` ONCE and compare `parent` against it
        // directly, rather than casting `parent` back to `string` at every
        // step of the walk.
        const projectNodeId = parseNodeId(projectId);
        // The `seen` guard matches the other two parent walks in this app
        // (`isDisabledByAncestor`, `useSelectionCount`). The graph's own
        // invariants should make a parent cycle unreachable — `buildGraph`
        // validates and the reducer refuses cycles — but this walk is the one
        // where hitting one hangs the tab on an unbounded `chain`, and having
        // two of the three guarded was the kind of split that turns into a bug
        // the first time a new graph-construction path appears.
        const seen = new Set<NodeId>();
        let parent = graph.parentById.get(parseNodeId(timelineId)) ?? null;
        while (parent !== null && parent !== projectNodeId && !seen.has(parent)) {
          seen.add(parent);
          chain.unshift(parent);
          parent = graph.parentById.get(parent) ?? null;
        }
        if (parent !== projectNodeId) return false;
        // The pending path is exactly what the URL will decode to (the push
        // below encodes these same segments), so the optimistic render and
        // the committed one can't disagree.
        onNavigateStart?.(chain);
        router.push(`${base}/${chain.map(encodeURIComponent).join("/")}`);
        return true;
      },
    }),
    [detailsStore, focusedId, onNavigateStart, projectId, router, store],
  );

  // A plain click on ANY card lands here now, so this is where the two
  // meanings of "open" part company:
  //
  //   a COLLECTION opens as a place — drill in, the focus moves.
  //   a CLIP opens as a thing — its editor, over the board you are on.
  //
  // Neither selects. Routing by kind HERE rather than in the click policy is
  // what keeps the package framework- and app-agnostic: `openOnClick` answers
  // "does a click on this open something", and what opening MEANS is the app's
  // business. The details overlay is reached by event because this provider is
  // mounted outside ItemDetailsProvider and cannot see `setOpenId`.
  useEffect(() => {
    if (!openNodeRef) return;
    openNodeRef.current = (nodeId) => {
      const node = store.getSnapshot().graph.nodesById.get(nodeId);
      // A duplicate-reference card is a clip standing in for a twice-referenced
      // timeline; `openTimeline` already resolves it to that timeline, so it
      // routes as a place despite being media in the graph.
      const opensAsPlace =
        node?.kind === "collection" ||
        detailsStore.get(nodeId as string)?.duplicateOfTimelineId !== undefined;
      if (opensAsPlace) {
        value.openTimeline(nodeId);
        return;
      }
      requestGraphItemDetails(nodeId as string);
    };
  }, [detailsStore, openNodeRef, store, value]);

  // The pill's "Open" arrives here: it is dispatched by the item-actions
  // bridge, which is a sibling of the board rather than a descendant of this
  // provider and so cannot reach `openTimeline` through context.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const nodeId = (event as CustomEvent<string>).detail;
      if (typeof nodeId === "string" && nodeId.length > 0) {
        value.openTimeline(parseNodeId(nodeId));
      }
    };
    window.addEventListener(GRAPH_OPEN_ITEM_EVENT, onOpen);
    return () => window.removeEventListener(GRAPH_OPEN_ITEM_EVENT, onOpen);
  }, [value]);

  return <GraphViewNavContext.Provider value={value}>{children}</GraphViewNavContext.Provider>;
}

/**
 * Move the current selection to the trash root as ONE undoable command — the
 * shared core of the keyboard Delete/Backspace and the sidebar's Delete
 * action, so the two can never diverge. Reads the selection from the store,
 * drops invalid picks (missing, root, already trashed) per-node via
 * resolveTrashCommand, and returns how many actually moved (0 = nothing
 * dispatched). No-op mid-drag or with no trash root.
 *
 * ONE command for the whole selection, not a per-node loop: parity with the
 * drag path means one UNDO reverses the whole delete, and the reducer's
 * multi-node handling prunes descendants of other moved nodes (a selected clip
 * inside a selected collection travels with its parent) and re-sorts into
 * graph order.
 */
export function moveSelectionToTrash(
  store: CollectionsStore,
  trashId: string | null,
  // Explicit ids for callers that snapshotted the selection BEFORE async work
  // (the sidebar Cut awaits document loads first — re-reading the live
  // selection here would trash whatever the user selected in the meantime,
  // not what they cut). Defaults to the live selection for the keyboard path.
  ids?: readonly NodeId[],
  // Optional: when supplied, each trashed clip is stamped with WHEN it went to
  // the bin and WHICH timeline it came from. Optional rather than required so
  // the trash move works unchanged from any call site that has no details
  // store — provenance is a nicety, never a precondition for deleting.
  details?: GraphDetailsStore,
): number {
  if (trashId === null || store.getSnapshot().interaction.isDragging) return 0;
  const { graph, interaction } = store.getSnapshot();
  const selected = ids ?? [...interaction.selectedIds];
  if (selected.length === 0) return 0;
  const trash = parseNodeId(trashId);
  const movable = selected.filter((nodeId) => resolveTrashCommand(graph, nodeId, trash).ok);
  if (movable.length === 0) return 0;

  // Stamp BEFORE dispatching: the persistence bridge writes the affected
  // documents from its `subscribeToChanges` callback, reading the details
  // table as it stands then — so a stamp applied after the dispatch would
  // miss the very write it is meant to ride. The parent is read here for the
  // same reason: after the move it IS the trash.
  const previousDetails: Record<string, ClipDetail> = {};
  if (details) {
    const trashedAt = new Date().toISOString();
    const stamped: Record<string, ClipDetail> = {};
    for (const nodeId of movable) {
      const existing = details.get(nodeId as string);
      // No detail entry means nothing to merge INTO — every graph node built
      // from a document has one, so this is the "shouldn't happen" branch
      // rather than a case worth inventing defaults for.
      if (!existing) continue;
      previousDetails[nodeId as string] = existing;
      const parentId = graph.parentById.get(nodeId) ?? null;
      const title = parentId === null ? undefined : graph.nodesById.get(parentId)?.name;
      stamped[nodeId as string] = {
        ...existing,
        trashedAt,
        ...(parentId !== null && title
          ? { trashedFrom: { timelineId: parentId as string, title } }
          : {}),
      };
    }
    details.merge(stamped);
  }

  const dispatched = store.dispatch({
    type: "move-nodes",
    nodeIds: movable,
    toParentId: trash,
    toIndex: getChildren(graph, trash).length,
  });
  // A refusal (the un-hydrated-target policy, a cycle) already speaks through
  // the commandPolicy's own toast — announce only what landed. Roll the stamp
  // back with it: nothing was trashed, so nothing may claim to have been.
  if (!dispatched.ok) {
    if (details && Object.keys(previousDetails).length > 0) details.merge(previousDetails);
    return 0;
  }
  toast(`Moved ${movable.length} item${movable.length === 1 ? "" : "s"} to trash.`, {
    id: "graph-delete-to-trash",
  });
  return movable.length;
}

/**
 * Keyboard boundary for the board: the O key drills into a collection or
 * duplicate-reference card, and plain Delete/Backspace moves the whole current
 * selection to trash.
 */
export function OpenKeyBoundary({
  children,
  trashId,
}: Readonly<{ children: React.ReactNode; trashId: string | null }>) {
  const nav = useContext(GraphViewNavContext);
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  const openFromKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (store.getSnapshot().interaction.isDragging) return;
    const target = event.target as HTMLElement;
    const id = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!id) return;

    const graph = store.getSnapshot().graph;
    const nodeId = parseNodeId(id);
    const node = graph.nodesById.get(nodeId);
    const opensTimeline =
      node?.kind === "collection" || detailsStore.get(id)?.duplicateOfTimelineId !== undefined;
    if (opensTimeline) {
      event.preventDefault();
      nav?.openTimeline(nodeId);
      return;
    }

    // A card shown OUTSIDE its own collection — the flat strip — opens the
    // collection it lives in. Same verb ("take me to where this is"), and the
    // keyboard twin of double-clicking its provenance label, which cannot be a
    // button because it renders inside the card's selection button.
    // Null as well as undefined: a ROOT has an explicit null parent, and it is
    // the one node with nowhere to reveal.
    const parentId = graph.parentById.get(nodeId);
    if (parentId == null || (parentId as string) === nav?.focusedId) return;
    event.preventDefault();
    nav?.openTimeline(parentId);
  };

  // F2 opens the focused card's inline rename editor — the keyboard twin of
  // double-clicking its label, so rename isn't pointer-only. Collections AND
  // media both carry one now (PL11-005): a media clip's name is its `title`,
  // and naming a handful of similar-looking clips should not mean a modal
  // round-trip each time.
  const renameFromKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (store.getSnapshot().interaction.isDragging) return;
    const target = event.target as HTMLElement;
    const id = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!id) return;
    const node = store.getSnapshot().graph.nodesById.get(parseNodeId(id));
    if (node?.kind !== "collection" && node?.kind !== "media") return;
    event.preventDefault();
    // F2 is pressed ON a card, so the card is what should open — the id was
    // resolved from the focused card's own element above.
    requestGraphRenameItem(id, "card");
  };

  // Plain Delete/Backspace trashes EVERY selected card — the pointer twin of
  // dragging a multi-selection onto the trash target, and the unmodified
  // sibling of the package's Alt+Delete (which trashes only the focused card).
  // The command itself is `moveSelectionToTrash` (shared with the sidebar's
  // Delete action); here we only gate the keypress and claim it.
  const trashSelection = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (trashId === null || store.getSnapshot().interaction.isDragging) return;
    if (store.getSnapshot().interaction.selectedIds.size === 0) return;
    event.preventDefault();
    moveSelectionToTrash(store, trashId, undefined, detailsStore);
  };

  /**
   * Escape backs out of selecting (R4.7).
   *
   * It lives here, with the board's other card keys, because nothing else owns
   * it. The v2 pill handled Escape itself — it rendered INSIDE the card, so a
   * focused card's Escape reached it by bubbling — and deleting the pill took
   * that with it. The package does not claim the key either: its keyboard
   * controller passes a bare Escape through deliberately.
   *
   * It backs out of ONE thing at a time, outermost first, which is what Escape
   * means everywhere else:
   *
   *   in select MODE — leave the mode, dropping whatever it collected. The mode
   *     is the outer state; clearing the selection but staying armed would look
   *     like nothing happened, since the row it painted is still there.
   *   otherwise      — clear the selection, as it always did.
   *
   * Note the mode branch has to run even with NOTHING selected. Arming select
   * mode and picking nothing is an ordinary place to end up (it is the state
   * you are in the instant you press Select), and the old guard returned early
   * on an empty selection — which would have left Escape doing nothing at all
   * in the one state a user is most likely to want out of.
   *
   * Two things it must not do. It must not fight dnd-kit, which uses Escape to
   * CANCEL a keyboard drag — hence the isDragging guard. And it must not fire
   * while a menu is open (R10.6): Radix portals its menus outside this
   * subtree, so their Escape never bubbles here, which is why that needs no
   * guard of its own.
   */
  const clearFromKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { interaction } = store.getSnapshot();
    if (interaction.isDragging) return;
    if (!interaction.multiSelectMode && interaction.selectedIds.size === 0) return;
    event.preventDefault();
    // Focus goes back to the card that was anchored, not to wherever the key
    // was pressed — the anchor is the card the user was working on, and the
    // control they may have been standing on is about to unmount.
    const anchorId = interaction.anchorId;
    store.clearSelection();
    if (interaction.multiSelectMode) store.setMultiSelectMode(false);
    if (anchorId !== null) focusNodeWhenMounted(document.body, anchorId);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // A control inside a card owns its own keys (inputs, the rename field) —
    // never steal Delete/O from them (the package's shared policy).
    if (isEditableKeyboardTarget(event.target)) return;

    if (event.key === "o" || event.key === "O") openFromKey(event);
    else if (event.key === "F2") renameFromKey(event);
    else if (event.key === "Delete" || event.key === "Backspace") trashSelection(event);
    else if (event.key === "Escape") clearFromKey(event);
  };

  // Double-click-to-open (R10.5) is GONE, with the double-click drill-in it
  // backstopped. It existed because the anchor card traded its drill chevron
  // for the `⋮`, which left the one card the user was working on with no
  // pointer route in; a plain click opens every collection now, anchor
  // included, so there is nothing left for it to cover. (The chevron has since
  // been removed outright, which retires the trade as well as the backstop.)
  //
  // Removed rather than left harmlessly redundant, because it was neither.
  // Click 1 navigates and unmounts the card, so the second click of a habitual
  // double-click lands on whatever now occupies that spot — and this handler
  // would have read THAT card's id and drilled a second level down, clearing
  // the selection on its way. In select mode it would also have thrown away a
  // selection the user was still assembling.

  /**
   * Acknowledge the press IMMEDIATELY, whatever the click turns out to mean.
   *
   * A collection's selection is deliberately held for the double-click window
   * so a drill-in never paints a selection first — which leaves a stretch where
   * the click has landed and nothing has changed, and that reads as a missed
   * click. The ripple covers it: it starts on POINTERDOWN, before the gesture
   * is resolved, so the feedback cannot be late by construction.
   *
   * ONE listener here rather than per card, and this is not just economy: the
   * collection card's root is `CollectionItem.SelectionSurface`, a package
   * primitive with an explicit prop list and no rest spread, so there is no
   * per-card seam to hang a handler on for collections at all. Delegating from
   * above covers every card shape identically.
   *
   * Never stops propagation — the press still has to reach the drag sensor
   * underneath.
   */
  const acknowledgePress = (event: React.PointerEvent<HTMLDivElement>) => {
    // Secondary buttons open menus rather than acting on the card.
    if (event.button !== 0) return;
    if (store.getSnapshot().interaction.isDragging) return;
    const host = pressFeedbackHostFor(event.target);
    if (host) spawnPressFeedback(host);
  };

  return (
    <div
      style={{ display: "contents" }}
      onKeyDown={handleKeyDown}
      onPointerDown={acknowledgePress}
    >
      {children}
    </div>
  );
}
