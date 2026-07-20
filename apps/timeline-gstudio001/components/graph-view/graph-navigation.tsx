"use client";

import { createContext, useContext, useEffect, useMemo, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";

import {
  isEditableKeyboardTarget,
  parseNodeId,
  resolveTrashCommand,
  useCollectionsStore,
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
        const timelineId =
          detailsStore.get(nodeId as string)?.duplicateOfTimelineId ?? (nodeId as string);
        if (timelineId === focusedId) return;

        const base = `/timeline/${encodeURIComponent(projectId)}/graph`;
        if (timelineId === projectId) {
          router.push(base);
          return;
        }

        const { graph } = store.getSnapshot();
        const chain: string[] = [timelineId];
        let parent = graph.parentById.get(parseNodeId(timelineId)) ?? null;
        while (parent !== null && (parent as string) !== projectId) {
          chain.unshift(parent as string);
          parent = graph.parentById.get(parent) ?? null;
        }
        if ((parent as string | null) !== projectId) return;
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

    const node = store.getSnapshot().graph.nodesById.get(parseNodeId(id));
    const opensTimeline =
      node?.kind === "collection" || detailsStore.get(id)?.duplicateOfTimelineId !== undefined;
    if (!opensTimeline) return;

    event.preventDefault();
    nav?.openTimeline(parseNodeId(id));
  };

  // Plain Delete/Backspace trashes EVERY selected card — the pointer twin of
  // dragging a multi-selection onto the trash target, and the unmodified
  // sibling of the package's Alt+Delete (which trashes only the focused card).
  // Moves go one command at a time against a fresh snapshot so the toIndex and
  // per-node validation (roots, already-in-trash, cycle) stay correct as the
  // graph shrinks; each is undoable.
  const trashSelection = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (trashId === null || store.getSnapshot().interaction.isDragging) return;
    const selected = [...store.getSnapshot().interaction.selectedIds];
    if (selected.length === 0) return;

    event.preventDefault();
    const trash = parseNodeId(trashId);
    let moved = 0;
    for (const nodeId of selected) {
      const command = resolveTrashCommand(store.getSnapshot().graph, nodeId, trash);
      if (command.ok && store.dispatch(command.value).ok) moved += 1;
    }
    if (moved > 0) {
      toast(`Moved ${moved} item${moved === 1 ? "" : "s"} to trash.`, {
        id: "graph-delete-to-trash",
      });
    }
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
