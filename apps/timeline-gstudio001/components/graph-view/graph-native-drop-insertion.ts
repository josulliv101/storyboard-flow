"use client";

import { useCallback, useEffect } from "react";

import {
  parseNodeId,
  useCollectionsContainer,
  useCollectionsStore,
  type CollectionItemNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { resolveInsertPlacement } from "@/lib/graph-insert-placement";
import {
  GRAPH_INSERT_TOOL_EVENT,
  isGraphInsertTool,
  type GraphInsertToolDetail,
} from "@/lib/graph-view-events";

import { TOOL_LABELS, type SidebarTool } from "./graph-native-drop-model";
import { parkPendingDetail, unparkPendingDetail } from "./graph-pending-details";

/** Mint an id with a time-ordered prefix. */
export function mintId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Mint-and-insert for the sidebar's tool palette, shared by the two ways a
 * tool can arrive: a native DRAG (which carries a pointer-derived index) and
 * plain ACTIVATION of the sidebar button (which appends). Extracted so the
 * keyboard path runs exactly the same code as the drop — an accessible route
 * that quietly diverges from the pointer one is how they drift apart.
 */
export function useToolInsertion(collectionId: string) {
  const store = useCollectionsStore();

  const addNodes = useCallback(
    (
      nodes: readonly CollectionItemNode[],
      toIndex: number,
      // Default: the hook's own collection (every drop path). The insert
      // bridge overrides it to land next to a selection in ANOTHER strip.
      toParentId: NodeId = parseNodeId(collectionId),
    ): boolean => {
      const result = store.dispatch({
        type: "add-nodes",
        nodes,
        toParentId,
        toIndex,
      });
      // Every refusal — including the un-hydrated-target veto — now comes
      // back from dispatch itself, because the policy runs BEFORE the commit.
      // Nothing landed in the graph, so there is no post-commit state to
      // inspect; just release the details parked for nodes that will never
      // exist.
      if (!result.ok) {
        for (const node of nodes) unparkPendingDetail(node.id as string);
        return false;
      }
      return true;
    },
    [store, collectionId],
  );

  /** Returns whether the tool actually landed, so callers can announce the
   *  truth rather than assuming success. */
  const insertTool = useCallback(
    (_tool: SidebarTool, toIndex: number, toParentId?: NodeId): boolean => {
      const childId = mintId("timeline");
      // hydrated: true — the collection is BRAND-NEW and empty, so drops
      // into it must not bounce and writes may touch its document.
      parkPendingDetail(childId, {
        alt: "New Timeline collection",
        aspect: 16 / 9,
        trackIndex: 0,
        itemCount: 0,
        duration: 3,
        sourceDuration: 3,
        trimIn: 0,
        trimOut: 0,
        hydrated: true,
      });
      const added = addNodes(
        [{ id: parseNodeId(childId), kind: "collection", name: "New Timeline" }],
        toIndex,
        toParentId,
      );
      if (added) {
        // Create the child document itself: seed the cache (expected
        // revision 0 = compare-and-set create) and queue an empty write —
        // it joins the same atomic batch as the parent's update, so a
        // drill-in never 404s on a half-created collection.
        graphDocumentsGateway.seed({ id: childId, title: "New Timeline", clips: [] });
        graphDocumentsGateway.writeClips(childId, []);
      }
      return added;
    },
    [addNodes],
  );

  return { addNodes, insertTool };
}

/**
 * Append a fresh nested timeline to `collectionId`, at the index the caller
 * names. The trailing add slot's route in — the same mint-and-insert the
 * sidebar tool and the native tool drop use, so a timeline added this way is
 * indistinguishable from one added any other way (undo, persistence, the
 * pending-detail bookkeeping all come along).
 *
 * Deliberately NOT routed through `resolveInsertPlacement` like the sidebar
 * button: that rule lands next to the SELECTION, and a control sitting at the
 * end of one particular surface plainly means "here".
 */
export function useAppendCollection(collectionId: string): (toIndex: number) => boolean {
  const { insertTool } = useToolInsertion(collectionId);
  return useCallback((toIndex: number) => insertTool("collection", toIndex), [insertTool]);
}

/**
 * The KEYBOARD/click path for the sidebar tool palette. The sidebar is app
 * chrome living outside this provider, so it hands the tool off through a
 * window event (same pattern as the Assets launcher). SELECTION-AWARE via the
 * shared `resolveInsertPlacement`: the tool lands right after the most
 * recently selected card, inside THAT card's own timeline (any strip the
 * board is showing under the focused collection — clicking the tool never
 * clears selection, so this works for mouse and keyboard alike). With nothing
 * selected — or with a selection left BEHIND by a drill-in, which survives the
 * navigation and would otherwise plant the collection in the timeline the user
 * just left — it appends to the focused collection, the one spot that needs no
 * explanation. Dragging the tool remains the pointer-precision path either way.
 *
 * Mounted for BOTH surfaces, deliberately: `NativeDropStrip` only wraps the
 * strip, and an accessible control that silently does nothing in grid mode
 * would be worse than no control at all.
 */
export function SidebarToolInsertBridge({
  collectionId,
}: Readonly<{ collectionId: string }>) {
  const store = useCollectionsStore();
  const { insertTool } = useToolInsertion(collectionId);
  const { announce } = useCollectionsContainer();

  useEffect(() => {
    const handleInsert = (event: Event) => {
      const tool = (event as CustomEvent<GraphInsertToolDetail>).detail?.tool;
      if (!tool || !isGraphInsertTool(tool)) return;
      const snapshot = store.getSnapshot();
      const graph = snapshot.graph;
      const { parentId, toIndex, afterId } = resolveInsertPlacement(
        graph,
        snapshot.interaction.selectedIds,
        collectionId,
      );
      const landed = insertTool(tool, toIndex, parentId);
      const target = graph.nodesById.get(parentId)?.name ?? "the timeline";
      const afterName =
        afterId !== null ? (graph.nodesById.get(afterId)?.name ?? "the selected clip") : null;
      announce(
        landed
          ? afterName !== null
            ? `Added a ${TOOL_LABELS[tool]} after "${afterName}" in "${target}".`
            : `Added a ${TOOL_LABELS[tool]} to the end of "${target}".`
          : `Could not add a ${TOOL_LABELS[tool]} to "${target}".`,
      );
    };
    window.addEventListener(GRAPH_INSERT_TOOL_EVENT, handleInsert);
    return () => window.removeEventListener(GRAPH_INSERT_TOOL_EVENT, handleInsert);
  }, [store, collectionId, insertTool, announce]);

  return null;
}
