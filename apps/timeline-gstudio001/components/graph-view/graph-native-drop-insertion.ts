"use client";

import { useCallback } from "react";

import {
  parseNodeId,
  useCollectionsStore,
  type CollectionItemNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { type SidebarTool } from "./graph-native-drop-model";
import { parkPendingDetail, unparkPendingDetail } from "./graph-pending-details";

/** Mint an id with a time-ordered prefix. */
export function mintId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Mint-and-insert, shared by every way a collection can arrive: a native DROP
 * (which carries a pointer-derived index), the Add item menu's answer at a drop
 * point, its plain CLICK (which appends), and the trailing slot. Extracted so
 * the keyboard path runs exactly the same code as the drop — an accessible
 * route that quietly diverges from the pointer one is how they drift apart.
 *
 * There used to be a fifth caller here, `SidebarToolInsertBridge`: a window-event
 * listener that inserted next to the SELECTION via `resolveInsertPlacement`. Its
 * one dispatcher was the collection button in the controls row, and that button
 * is now Add item, which appends. Nothing dispatched to it any more, so it went
 * — a listener with no sender reads as live and is not. `resolveInsertPlacement`
 * itself stays: PASTE uses it, which is where landing beside what you picked is
 * unambiguously the right rule.
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
