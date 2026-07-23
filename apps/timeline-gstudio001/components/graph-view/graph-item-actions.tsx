"use client";

import { useEffect } from "react";

import type { TimelineDocument } from "@storyboard/timeline-model/types";
import {
  getChildren,
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
  type CollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { toast } from "@/components/core/sonner";
import { graphClipboard, type ClipboardEntry } from "@/lib/graph-clipboard";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import type { GraphDetailsStore } from "@/lib/graph-details-store";
import { cloneNodeForInsert, type CloneForInsert } from "@/lib/graph-node-clone";
import {
  GRAPH_ITEM_ACTION_EVENT,
  broadcastGraphSelection,
  type GraphItemAction,
} from "@/lib/graph-view-events";

import { moveSelectionToTrash } from "./graph-navigation";
import { parkPendingDetail, unparkPendingDetail } from "./graph-pending-details";
import { useGraphDetailsStore } from "./graph-details-context";

/** A fresh, graph-unique id — the same shape the native-drop/tool paths mint. */
function mintId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ensure a collection's WHOLE document subtree is cached before a clone reads
 * it — a placeholder collection's document (and its nested ones) may not be
 * loaded, since a card's summary comes from its PARENT's clip, not from
 * loading the child. Returns false if any document fails to load (network),
 * so the caller can abort rather than clone half a tree.
 */
async function ensureDocumentTree(rootTimelineId: string): Promise<boolean> {
  const seen = new Set<string>();
  const walk = async (timelineId: string): Promise<boolean> => {
    if (seen.has(timelineId)) return true;
    seen.add(timelineId);
    const doc = await graphDocumentsGateway.ensure(timelineId);
    if (doc === null) return false;
    for (const clip of doc.clips) {
      if (clip.kind === "collection" && !(await walk(clip.childTimelineId))) return false;
    }
    return true;
  };
  return walk(rootTimelineId);
}

/**
 * Deep-copy a collection's document tree out of the cache, keyed by original
 * id — the copy-time snapshot the clipboard holds. `structuredClone` so a
 * later edit to the source (or a Cut that trashes it) can't change what Paste
 * later produces. Caller must `ensureDocumentTree` first.
 */
function captureDocumentTree(rootTimelineId: string): Record<string, TimelineDocument> {
  const out: Record<string, TimelineDocument> = {};
  const walk = (timelineId: string) => {
    if (out[timelineId] !== undefined) return;
    const doc = graphDocumentsGateway.peek(timelineId);
    if (doc === null) return;
    out[timelineId] = structuredClone(doc);
    for (const clip of doc.clips) {
      if (clip.kind === "collection") walk(clip.childTimelineId);
    }
  };
  walk(rootTimelineId);
  return out;
}

/**
 * Commit one clone into `parentId` at `toIndex` — the shared tail of Duplicate
 * and Paste. Mirrors the palette insert: park the detail so the persistence
 * bridge claims it on the add patch, dispatch add-nodes, then seed each cloned
 * collection's document (revision-0 create + content write) so a drill-in into
 * the copy never 404s. Returns the new node id, or null if the add was refused.
 */
function insertClone(
  store: CollectionsStore,
  clone: CloneForInsert,
  parentId: NodeId,
  toIndex: number,
): NodeId | null {
  if (clone.detail) parkPendingDetail(clone.node.id as string, clone.detail);
  const dispatched = store.dispatch({
    type: "add-nodes",
    nodes: [clone.node],
    toParentId: parentId,
    toIndex,
  });
  if (!dispatched.ok) {
    unparkPendingDetail(clone.node.id as string);
    return null;
  }
  for (const document of clone.newDocuments) {
    graphDocumentsGateway.seed(document);
    graphDocumentsGateway.writeClips(document.id, document.clips);
  }
  return clone.node.id;
}

/**
 * Duplicate one source node right AFTER it in its own parent. A collection
 * deep-clones its document tree first (ensuring its subtree is loaded). Returns
 * the new node's id, or null if nothing landed.
 */
async function duplicateOne(
  store: CollectionsStore,
  details: GraphDetailsStore,
  sourceId: NodeId,
): Promise<NodeId | null> {
  const node = store.getSnapshot().graph.nodesById.get(sourceId);
  if (!node) return null;
  const detail = details.get(sourceId as string);

  if (node.kind === "collection") {
    const rootTimelineId = detail?.duplicateOfTimelineId ?? (sourceId as string);
    if (!(await ensureDocumentTree(rootTimelineId))) {
      toast("Couldn't load the timeline to duplicate.", { id: "graph-duplicate-load" });
      return null;
    }
  }

  const clone = cloneNodeForInsert(node, detail, {
    readDocument: (timelineId) => graphDocumentsGateway.peek(timelineId),
    mintId,
  });

  // Re-read the live graph: an earlier duplicate in this batch may have shifted
  // the source's parent's children.
  const liveGraph = store.getSnapshot().graph;
  const parentId = liveGraph.parentById.get(sourceId);
  // A root has a null parent and can't take a sibling — skip it (roots aren't
  // duplicable anyway).
  if (parentId === undefined || parentId === null) return null;
  const siblings = getChildren(liveGraph, parentId);
  const at = siblings.indexOf(sourceId);
  const toIndex = at >= 0 ? at + 1 : siblings.length;
  return insertClone(store, clone, parentId, toIndex);
}

/**
 * Snapshot the selection onto the clipboard (Copy / Cut). Each collection's
 * whole document tree is ensured then deep-copied, so the clipboard is
 * independent of the source thereafter. Returns false (and toasts) if a
 * collection's tree can't be loaded.
 */
async function captureSelection(
  store: CollectionsStore,
  details: GraphDetailsStore,
  selected: readonly NodeId[],
): Promise<boolean> {
  const graph = store.getSnapshot().graph;
  const entries: ClipboardEntry[] = [];
  for (const id of selected) {
    const node = graph.nodesById.get(id);
    if (!node) continue;
    const detail = details.get(id as string);
    let documents: Record<string, TimelineDocument> = {};
    if (node.kind === "collection") {
      const rootTimelineId = detail?.duplicateOfTimelineId ?? (id as string);
      if (!(await ensureDocumentTree(rootTimelineId))) {
        toast("Couldn't load the timeline to copy.", { id: "graph-copy-load" });
        return false;
      }
      documents = captureDocumentTree(rootTimelineId);
    }
    entries.push({ node, detail, documents });
  }
  if (entries.length === 0) return false;
  graphClipboard.set(entries);
  return true;
}

/**
 * Paste the clipboard into the focused collection, appended. Clones fresh ids
 * from the copy-time snapshot each time. Returns the new node ids.
 */
function pasteIntoFocused(store: CollectionsStore, focusedId: string): NodeId[] {
  const entries = graphClipboard.read();
  if (entries.length === 0) return [];
  const focusedParent = parseNodeId(focusedId);
  const newIds: NodeId[] = [];
  for (const entry of entries) {
    const clone = cloneNodeForInsert(entry.node, entry.detail, {
      readDocument: (timelineId) => entry.documents[timelineId] ?? null,
      mintId,
    });
    const toIndex = getChildren(store.getSnapshot().graph, focusedParent).length;
    const newId = insertClone(store, clone, focusedParent, toIndex);
    if (newId !== null) newIds.push(newId);
  }
  return newIds;
}

/**
 * Bridges the sidebar's item-actions cluster to the live selection. The
 * sidebar is app chrome living OUTSIDE this provider, so — like the tool
 * palette and the view-state controls — it talks through a window event.
 * Rendered INSIDE `<DndCollections>` (next to PersistenceBridge) so it can
 * reach the engine store and the details side-table, this bridge broadcasts
 * the selection size and performs the picked action:
 *
 *   - Copy  → snapshot the selection to the clipboard (stays in item mode).
 *   - Cut   → snapshot, then trash the originals; the clipboard keeps an
 *             independent copy, so Paste still relocates them (a move).
 *   - Paste → clone the clipboard into the focused collection, then clear the
 *             clipboard + selection (back to normal).
 *   - Duplicate → clone each selection in place (after its source).
 *   - Delete → `moveSelectionToTrash` (shared with the keyboard Delete).
 *   - Cancel → clear the selection AND the clipboard (back to normal).
 */
export function GraphItemActionsBridge({
  trashId,
  focusedId,
}: Readonly<{ trashId: string | null; focusedId: string }>) {
  const store = useCollectionsStore();
  const details = useGraphDetailsStore();
  const selectionSize = useCollectionsSelector((s) => s.interaction.selectedIds.size);

  // Graph → sidebar: mirror the live selection size (on mount and every change).
  useEffect(() => {
    broadcastGraphSelection({ count: selectionSize });
  }, [selectionSize]);

  // Sidebar → graph: run the requested action against the current selection.
  useEffect(() => {
    const duplicateSelection = async () => {
      const selected = [...store.getSnapshot().interaction.selectedIds];
      if (selected.length === 0) return;
      const newIds: NodeId[] = [];
      for (const id of selected) {
        const newId = await duplicateOne(store, details, id);
        if (newId !== null) newIds.push(newId);
      }
      if (newIds.length > 0) store.setSelection(newIds);
    };

    const cutSelection = async () => {
      const selected = [...store.getSnapshot().interaction.selectedIds];
      if (selected.length === 0) return;
      if (!(await captureSelection(store, details, selected))) return;
      // Remove the originals (recoverable in trash); the clipboard holds an
      // independent snapshot, so Paste still relocates them. Item mode stays
      // alive because the clipboard is now non-empty (Paste remains available).
      moveSelectionToTrash(store, trashId);
      store.clearSelection();
    };

    const pasteSelection = () => {
      pasteIntoFocused(store, focusedId);
      // Paste returns to the normal controls: drop the clipboard and selection.
      graphClipboard.clear();
      store.clearSelection();
    };

    const onAction = (event: Event) => {
      const action = (event as CustomEvent<GraphItemAction>).detail;
      switch (action) {
        case "copy":
          void captureSelection(store, details, [...store.getSnapshot().interaction.selectedIds]);
          break;
        case "cut":
          void cutSelection();
          break;
        case "paste":
          pasteSelection();
          break;
        case "duplicate":
          void duplicateSelection();
          break;
        case "delete":
          moveSelectionToTrash(store, trashId);
          store.clearSelection();
          break;
        case "cancel":
          graphClipboard.clear();
          store.clearSelection();
          break;
        default:
          break;
      }
    };
    window.addEventListener(GRAPH_ITEM_ACTION_EVENT, onAction);
    return () => window.removeEventListener(GRAPH_ITEM_ACTION_EVENT, onAction);
  }, [store, details, trashId, focusedId]);

  return null;
}
