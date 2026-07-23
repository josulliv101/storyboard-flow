"use client";

import { createContext, useContext, useEffect, useMemo, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";

import {
  getChildren,
  isEditableKeyboardTarget,
  parseNodeId,
  resolveTrashCommand,
  useCollectionsStore,
  type CollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { toast } from "@/components/core/sonner";

import { useGraphDetailsStore } from "./graph-details-context";

type GraphViewNav = Readonly<{
  openTimeline: (nodeId: NodeId) => void;
}>;

export const GraphViewNavContext = createContext<GraphViewNav | null>(null);

export function GraphViewNavProvider({
  projectId,
  focusedId,
  openNodeRef,
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
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  const value = useMemo<GraphViewNav>(
    () => ({
      openTimeline: (nodeId) => {
        const id = nodeId as string;
        const timelineId = detailsStore.get(id)?.duplicateOfTimelineId ?? id;
        if (timelineId === focusedId) return;

        const base = `/timeline/${encodeURIComponent(projectId)}/graph`;
        if (timelineId === projectId) {
          router.push(base);
          return;
        }

        const { graph } = store.getSnapshot();
        const chain: string[] = [timelineId];
        // Parse `projectId` to `NodeId` ONCE and compare `parent` against it
        // directly, rather than casting `parent` back to `string` at every
        // step of the walk.
        const projectNodeId = parseNodeId(projectId);
        let parent = graph.parentById.get(parseNodeId(timelineId)) ?? null;
        while (parent !== null && parent !== projectNodeId) {
          chain.unshift(parent);
          parent = graph.parentById.get(parent) ?? null;
        }
        if (parent !== projectNodeId) return;
        router.push(`${base}/${chain.map(encodeURIComponent).join("/")}`);
      },
    }),
    [detailsStore, focusedId, projectId, router, store],
  );

  useEffect(() => {
    if (openNodeRef) openNodeRef.current = value.openTimeline;
  }, [openNodeRef, value]);

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
): number {
  if (trashId === null || store.getSnapshot().interaction.isDragging) return 0;
  const { graph, interaction } = store.getSnapshot();
  const selected = ids ?? [...interaction.selectedIds];
  if (selected.length === 0) return 0;
  const trash = parseNodeId(trashId);
  const movable = selected.filter((nodeId) => resolveTrashCommand(graph, nodeId, trash).ok);
  if (movable.length === 0) return 0;
  const dispatched = store.dispatch({
    type: "move-nodes",
    nodeIds: movable,
    toParentId: trash,
    toIndex: getChildren(graph, trash).length,
  });
  // A refusal (the un-hydrated-target policy, a cycle) already speaks through
  // the commandPolicy's own toast — announce only what landed.
  if (!dispatched.ok) return 0;
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

    const nodeId = parseNodeId(id);
    const node = store.getSnapshot().graph.nodesById.get(nodeId);
    const opensTimeline =
      node?.kind === "collection" || detailsStore.get(id)?.duplicateOfTimelineId !== undefined;
    if (!opensTimeline) return;

    event.preventDefault();
    nav?.openTimeline(nodeId);
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
    moveSelectionToTrash(store, trashId);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // A control inside a card owns its own keys (inputs, the rename field) —
    // never steal Delete/O from them (the package's shared policy).
    if (isEditableKeyboardTarget(event.target)) return;

    if (event.key === "o" || event.key === "O") openFromKey(event);
    else if (event.key === "Delete" || event.key === "Backspace") trashSelection(event);
  };

  return (
    <div style={{ display: "contents" }} onKeyDown={handleKeyDown}>
      {children}
    </div>
  );
}
