"use client";

import { useEffect, useRef, useState } from "react";

import type { TimelineDocument } from "@storyboard/timeline-model/types";
import {
  getChildren,
  isEditableKeyboardTarget,
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
import { resolveInsertPlacement } from "@/lib/graph-insert-placement";
import { cloneNodeForInsert, type CloneForInsert } from "@/lib/graph-node-clone";
import {
  GRAPH_ITEM_ACTION_EVENT,
  GRAPH_RESTORE_ITEM_EVENT,
  broadcastGraphRestoreResult,
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
 * Commit a batch of clones into `parentId` at `toIndex` as ONE add-nodes
 * dispatch — the shared tail of Duplicate and Paste, and the reason a
 * multi-item gesture is a single undo step (the delete-path rule). Mirrors the
 * palette insert: park each detail so the persistence bridge claims it on the
 * add patch, dispatch, then seed each cloned collection's document (revision-0
 * create + content write) so a drill-in into a copy never 404s. Returns the
 * new node ids — empty when the dispatch was refused (details rolled back).
 */
function insertClones(
  store: CollectionsStore,
  clones: readonly CloneForInsert[],
  parentId: NodeId,
  toIndex: number,
): readonly NodeId[] {
  if (clones.length === 0) return [];
  for (const clone of clones) {
    if (clone.detail) parkPendingDetail(clone.node.id as string, clone.detail);
  }
  const dispatched = store.dispatch({
    type: "add-nodes",
    nodes: clones.map((clone) => clone.node),
    toParentId: parentId,
    toIndex,
  });
  if (!dispatched.ok) {
    for (const clone of clones) unparkPendingDetail(clone.node.id as string);
    return [];
  }
  for (const clone of clones) {
    for (const document of clone.newDocuments) {
      graphDocumentsGateway.seed(document);
      graphDocumentsGateway.writeClips(document.id, document.clips);
    }
  }
  return clones.map((clone) => clone.node.id);
}

/**
 * Build (but don't insert) the clone of one source node — the async half of
 * Duplicate: a collection ensures its whole document subtree first. Null when
 * the source vanished or its tree couldn't load (toasted).
 */
async function buildClone(
  store: CollectionsStore,
  details: GraphDetailsStore,
  sourceId: NodeId,
): Promise<CloneForInsert | null> {
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
  return cloneNodeForInsert(node, detail, {
    readDocument: (timelineId) => graphDocumentsGateway.peek(timelineId),
    mintId,
  });
}

/**
 * Snapshot the selection onto the clipboard (Copy / Cut). Each collection's
 * whole document tree is ensured then deep-copied, so the clipboard is
 * independent of the source thereafter. The write is guarded by the clipboard
 * GENERATION observed before the (async) loads: if the clipboard was rebound
 * to a different user mid-capture, the stale write is refused. Returns false
 * (and toasts, for load failures) if nothing landed.
 */
async function captureSelection(
  store: CollectionsStore,
  details: GraphDetailsStore,
  selected: readonly NodeId[],
): Promise<boolean> {
  const atGeneration = graphClipboard.generation();
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
  return graphClipboard.set(entries, atGeneration);
}

/**
 * Paste the clipboard — ONE `add-nodes` dispatch for every entry, so a
 * multi-item paste is a single undoable step and a single persisted batch (the
 * same rule the delete path documents, and the same shape as the multi-file
 * drop commit). Documents seed only after the dispatch commits; a refusal
 * rolls back the parked details and returns [] with the clipboard untouched,
 * so the user can retry.
 *
 * WHERE it lands is `resolveInsertPlacement` — shared with the Collection
 * tool, so the view's two pointerless inserts obey one rule: after the
 * selected card when that card is on the board under the focused collection,
 * appended to the focused collection otherwise. The subtree half matters most
 * here: the copy → drill-in → Paste flow keeps the source SELECTED across the
 * navigation, and a bare "after the selection" would fire the paste back into
 * the timeline the user just left.
 */
function pasteFromClipboard(store: CollectionsStore, focusedId: string): readonly NodeId[] {
  const entries = graphClipboard.read();
  if (entries.length === 0) return [];
  const snapshot = store.getSnapshot();
  const { parentId, toIndex } = resolveInsertPlacement(
    snapshot.graph,
    snapshot.interaction.selectedIds,
    focusedId,
  );
  const clones = entries.map((entry) =>
    cloneNodeForInsert(entry.node, entry.detail, {
      readDocument: (timelineId) => entry.documents[timelineId] ?? null,
      mintId,
    }),
  );
  return insertClones(store, clones, parentId, toIndex);
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
 *   - Paste → clone the clipboard in after the selected card (or append to the
 *             focused collection), then clear the clipboard + selection.
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
  // Returns a PRIMITIVE, per the store's selector contract — allocating here
  // (an array of the selected nodes, say) would re-render on every snapshot.
  // A mixed selection is false, so the toggle's next press disables the rest
  // rather than flipping each item independently.
  const allDisabled = useCollectionsSelector((s) => {
    const selected = s.interaction.selectedIds;
    if (selected.size === 0) return false;
    for (const id of selected) {
      if (s.graph.nodesById.get(id)?.disabled !== true) return false;
    }
    return true;
  });
  // True while an async action (copy/cut/duplicate loading documents) runs.
  // State so the broadcast below re-fires; the REF is what the (stable) event
  // listener consults, so the guard needs no effect re-subscription.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Session-lifetime guard for the async actions below. This bridge is
  // remounted with a fresh store whenever the graph's session key changes
  // (project / user / trash-generation switch), so ONE mount == ONE session:
  // the ref flips false only on a true unmount, and NEVER on the intra-session
  // dep changes (focusedId / trashId navigation) that merely re-run the action
  // effect — those keep the same live store, so an in-flight Duplicate is still
  // valid across them. An async action consults it before touching the store
  // or the SINGLETON documents gateway; see `duplicateSelection`.
  const sessionAliveRef = useRef(true);
  useEffect(() => {
    sessionAliveRef.current = true;
    return () => {
      sessionAliveRef.current = false;
    };
  }, []);

  // Graph → sidebar: mirror the live selection size + busy (on mount and every
  // change) — and zero it on unmount, so a later graph session doesn't flash
  // the previous session's stale item-mode cluster before its own first
  // broadcast lands.
  useEffect(() => {
    broadcastGraphSelection({ count: selectionSize, busy, allDisabled });
  }, [selectionSize, busy, allDisabled]);
  useEffect(
    () => () => broadcastGraphSelection({ count: 0, busy: false, allDisabled: false }),
    [],
  );

  // Trash drawer → graph: put a deleted item back into the OPEN timeline.
  //
  // Restoring is the delete command run backwards — one `move-nodes` out of
  // the trash root — so it undoes, persists, and animates like any other move.
  // The destination is wherever the user is now, which is also how they choose
  // it: navigate to the timeline you want it in, then restore. It shares the
  // Paste/Collection-tool placement rule, so a selected card in the focused
  // subtree puts it right after that card instead of at the end.
  //
  // The drawer knows items by their stored CLIP id. The graph may hold the
  // same item under a different node id — a collection is keyed by its child
  // timeline, and a duplicate media id is demoted to a synthetic one — so the
  // node is resolved against the trash root's children by id OR by the
  // detail's `sourceClipId`, which is exactly what the hydration path records
  // for both of those cases.
  useEffect(() => {
    const onRestore = (event: Event) => {
      const clipId = (event as CustomEvent<string>).detail;
      if (typeof clipId !== "string" || clipId.length === 0) return;
      const answer = (ok: boolean, message: string) =>
        broadcastGraphRestoreResult({ clipId, ok, message });

      if (trashId === null) return answer(false, "The trash isn't loaded in this project.");
      const snapshot = store.getSnapshot();
      if (snapshot.interaction.isDragging) return answer(false, "Finish the drag first.");

      const graph = snapshot.graph;
      const trashNode = parseNodeId(trashId);
      const nodeId = getChildren(graph, trashNode).find(
        (id) => (id as string) === clipId || details.get(id as string)?.sourceClipId === clipId,
      );
      if (nodeId === undefined) {
        return answer(false, "That item is no longer in this project's trash.");
      }

      const { parentId, toIndex } = resolveInsertPlacement(
        graph,
        snapshot.interaction.selectedIds,
        focusedId,
      );
      // Clear the trash stamp BEFORE dispatching, for the same reason the
      // stamp is WRITTEN before its dispatch: the persistence bridge writes
      // the affected documents from its `subscribeToChanges` callback, which
      // runs during the dispatch. Clearing afterwards updates the in-memory
      // table but misses the write, so the restored clip lands back in its
      // timeline still carrying "deleted from X, 2h ago" — stale metadata on
      // a live clip, and a wrong date the next time it IS deleted.
      const stampedDetail = details.get(nodeId as string);
      const hadStamp =
        stampedDetail !== undefined &&
        (stampedDetail.trashedAt !== undefined || stampedDetail.trashedFrom !== undefined);
      if (hadStamp && stampedDetail) {
        const { trashedAt: _at, trashedFrom: _from, ...rest } = stampedDetail;
        details.merge({ [nodeId as string]: rest });
      }

      const dispatched = store.dispatch({
        type: "move-nodes",
        nodeIds: [nodeId],
        toParentId: parentId,
        toIndex,
      });
      // A refusal already speaks through the commandPolicy's own toast; the
      // drawer only needs to know the row is still trashed. Put the stamp
      // back with it — the clip is still in the bin, so it must still say so.
      if (!dispatched.ok) {
        if (hadStamp && stampedDetail) details.merge({ [nodeId as string]: stampedDetail });
        return answer(false, "Couldn't restore that item here.");
      }

      const name = graph.nodesById.get(nodeId)?.name ?? "Item";
      const target = graph.nodesById.get(parentId)?.name ?? "this timeline";
      answer(true, `Restored "${name}" to "${target}".`);
    };

    window.addEventListener(GRAPH_RESTORE_ITEM_EVENT, onRestore);
    return () => window.removeEventListener(GRAPH_RESTORE_ITEM_EVENT, onRestore);
  }, [store, details, trashId, focusedId]);

  // Sidebar → graph: run the requested action against the current selection.
  useEffect(() => {
    // ONE action at a time: the sidebar disables its buttons while busy, but
    // the guard here is what actually prevents a double-fire (a second click
    // landing before the broadcast round-trips, or any stray event).
    const runExclusive = async (action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await action();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    };

    const duplicateSelection = async () => {
      const selected = [...store.getSnapshot().interaction.selectedIds];
      if (selected.length === 0) return;
      // Build every clone FIRST (the async ensure), then insert with ONE
      // add-nodes per parent — a multi-duplicate inside one parent is a single
      // undo step (the delete-path rule; the old per-source loop left N
      // entries behind one gesture). One command inserts contiguously, so the
      // block lands right after the LAST selected source in that parent, with
      // the copies keeping the sources' relative order; the common single-item
      // case keeps its exact after-the-source placement. Sources in DIFFERENT
      // parents still cost one entry per parent — a single cross-parent
      // command doesn't exist in the engine.
      type Built = Readonly<{ sourceId: NodeId; clone: CloneForInsert }>;
      const built: Built[] = [];
      for (const id of selected) {
        const clone = await buildClone(store, details, id);
        // The session can be torn down (project switch) while a clone's
        // document tree loads. Bail the moment it is — before loading more.
        if (!sessionAliveRef.current) return;
        if (clone !== null) built.push({ sourceId: id, clone });
      }
      if (built.length === 0) return;

      // The safety-critical check: everything below dispatches into `store`
      // and, via `insertClones`, seeds + writes cloned child documents through
      // the singleton gateway. If the session died during the loads above,
      // those writes would seed timelines into a project that no longer exists
      // — orphans with no graph path to reach them. No awaits follow, so this
      // one guard covers the whole side-effecting section.
      if (!sessionAliveRef.current) return;

      const liveGraph = store.getSnapshot().graph;
      const groups = new Map<NodeId, Built[]>();
      for (const item of built) {
        const parentId = liveGraph.parentById.get(item.sourceId);
        // A root has no parent and can't take a sibling — skip (roots aren't
        // duplicable anyway); likewise a source deleted during the loads.
        if (parentId === undefined || parentId === null) continue;
        const group = groups.get(parentId);
        if (group) group.push(item);
        else groups.set(parentId, [item]);
      }

      const newIds: NodeId[] = [];
      for (const [parentId, group] of groups) {
        const siblings = getChildren(store.getSnapshot().graph, parentId);
        const at = (item: Built) => siblings.indexOf(item.sourceId);
        group.sort((a, b) => at(a) - at(b));
        const lastAt = at(group[group.length - 1]);
        const toIndex = lastAt >= 0 ? lastAt + 1 : siblings.length;
        newIds.push(
          ...insertClones(
            store,
            group.map((item) => item.clone),
            parentId,
            toIndex,
          ),
        );
      }
      // Select the copies, so the user sees what they made and can act again.
      if (newIds.length > 0) store.setSelection(newIds);
    };

    const cutSelection = async () => {
      // Snapshot the ids BEFORE the async capture: the user can change the
      // selection while documents load, and the trash move below must remove
      // exactly what was captured — not whatever is selected by then.
      const selected = [...store.getSnapshot().interaction.selectedIds];
      if (selected.length === 0) return;
      if (!(await captureSelection(store, details, selected))) return;
      // The capture awaited documents; the session can be torn down (project
      // switch) meanwhile — the same guard Duplicate uses. Without it the move
      // below dispatches into a dead store, leaving the clipboard populated
      // while the originals were never actually removed in the live session.
      if (!sessionAliveRef.current) return;
      // Remove the originals (recoverable in trash); the clipboard holds an
      // independent snapshot, so Paste still relocates them. Item mode stays
      // alive because the clipboard is now non-empty (Paste remains available).
      //
      // Clear the selection ONLY if the move actually landed: a drag starting
      // mid-capture makes moveSelectionToTrash a no-op (returns 0, isDragging),
      // and clearing anyway would leave Cut silently behaving like Copy —
      // clipboard set, nothing trashed, selection gone.
      const moved = moveSelectionToTrash(store, trashId, selected, details);
      if (moved > 0) store.clearSelection();
    };

    const pasteSelection = () => {
      const pasted = pasteFromClipboard(store, focusedId);
      // Nothing landed (refused dispatch): keep the clipboard so the user can
      // paste somewhere valid instead of silently losing what they copied.
      if (pasted.length === 0) return;
      // Paste returns to the normal controls: drop the clipboard and selection.
      graphClipboard.clear();
      store.clearSelection();
    };

    // The ONE funnel every trigger goes through — the sidebar's buttons (via
    // the window event) and the keyboard shortcuts below — so the busy guard,
    // clipboard rules, and undo shapes can never differ by input method.
    const perform = (action: GraphItemAction) => {
      // Sync actions honour the same one-at-a-time rule: a paste or delete
      // landing mid-cut would race the capture's trash move.
      if (busyRef.current) return;
      switch (action) {
        case "copy":
          void runExclusive(async () => {
            const selected = [...store.getSnapshot().interaction.selectedIds];
            if (await captureSelection(store, details, selected)) {
              // Copy changes nothing visible on the board — say it landed
              // (both entry points; the keyboard one especially needs it).
              toast(`Copied ${selected.length} item${selected.length === 1 ? "" : "s"}.`, {
                id: "graph-item-copy",
              });
            }
          });
          break;
        case "cut":
          void runExclusive(cutSelection);
          break;
        case "paste":
          pasteSelection();
          break;
        case "duplicate":
          void runExclusive(duplicateSelection);
          break;
        case "delete":
          moveSelectionToTrash(store, trashId, undefined, details);
          store.clearSelection();
          break;
        case "toggle-disabled": {
          const selected = [...store.getSnapshot().interaction.selectedIds];
          if (selected.length === 0) break;
          // One command per node, but ONE decision for the whole selection:
          // every node goes to the same state, so a mixed selection resolves
          // instead of each item flipping its own way. Re-read `disabled`
          // from the live graph rather than trusting the sidebar's broadcast,
          // which is a frame behind.
          const graph = store.getSnapshot().graph;
          const nextDisabled = selected.some(
            (id) => graph.nodesById.get(id)?.disabled !== true,
          );
          let changed = 0;
          for (const nodeId of selected) {
            // A node already in the target state is refused as `same-position`
            // and never enters history — so this loop cannot pad undo with
            // no-ops when only part of the selection needs changing.
            if (store.dispatch({ type: "set-node-disabled", nodeId, disabled: nextDisabled }).ok) {
              changed += 1;
            }
          }
          if (changed > 0) {
            toast(
              `${nextDisabled ? "Disabled" : "Enabled"} ${changed} item${changed === 1 ? "" : "s"}.`,
              { id: "graph-item-disable" },
            );
          }
          break;
        }
        case "cancel":
          graphClipboard.clear();
          store.clearSelection();
          break;
        default:
          break;
      }
    };

    const onAction = (event: Event) => {
      perform((event as CustomEvent<GraphItemAction>).detail);
    };

    // Keyboard: Ctrl/Cmd+C, X, V, D — window-level (not a React boundary on
    // the board) because paste's moment of need is right AFTER a drill-in,
    // when the navigation dropped focus to <body> and a subtree listener
    // would never hear the key. Every guard fails OPEN to the browser: the
    // shortcut is claimed (preventDefault — Ctrl+D would bookmark) only when
    // it will actually act on the graph.
    const KEY_TO_ACTION: Readonly<Record<string, GraphItemAction>> = {
      c: "copy",
      x: "cut",
      v: "paste",
      d: "duplicate",
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const action = KEY_TO_ACTION[event.key.toLowerCase()];
      if (action === undefined) return;
      if (event.repeat || event.defaultPrevented) return;
      // Inputs and the rename editor own their clipboard keys (the package's
      // shared keyboard policy).
      if (isEditableKeyboardTarget(event.target)) return;
      const snapshot = store.getSnapshot();
      if (snapshot.interaction.isDragging) return;
      // A real TEXT selection means the user wants the browser's copy/cut.
      if (
        (action === "copy" || action === "cut") &&
        (window.getSelection()?.toString() ?? "") !== ""
      ) {
        return;
      }
      const hasSelection = snapshot.interaction.selectedIds.size > 0;
      if (action === "paste" ? graphClipboard.isEmpty() : !hasSelection) return;
      event.preventDefault();
      perform(action);
    };

    window.addEventListener(GRAPH_ITEM_ACTION_EVENT, onAction);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(GRAPH_ITEM_ACTION_EVENT, onAction);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store, details, trashId, focusedId]);

  return null;
}
