"use client";

import { useEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { FolderUp, Trash2 } from "lucide-react";

import {
  encodeDropTarget,
  getChildren,
  parseNodeId,
  useCollectionsContainer,
  useCollectionsSelector,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { announceGraphTrashArrival } from "@/lib/graph-view-events";

// The graph's card-drag drop targets live CENTRED IN THE BREADCRUMB ROW now,
// appearing while a card is being dragged (they were the sidebar tool
// palette's morph before). Two wide rectangular zones:
//
//   - MOVE TO PARENT — drop a card to promote it one level up, into the
//     focused collection's parent. Hidden at the root (nowhere up to go).
//   - TRASH — drop a card to move it to the trash root (undoable).
//
// Both are `panel` drop targets, which DndCollections resolves to the same
// append-to-collection move the sidebar trash used — so undo restores and
// nothing is deleted. They render INSIDE the board header (inside the
// provider), so their useDroppable joins the same DndContext as every card;
// no portal is needed anymore.

type ZoneState = "idle" | "over" | "invalid";

/** The live drop state for one target collection, read off the shared drag
 *  interaction: "over" when the current intent points here, "invalid" when it
 *  points here but the engine would refuse it. */
function useZoneState(targetId: NodeId): ZoneState {
  return useCollectionsSelector((s): ZoneState => {
    const intent = s.interaction.dropIntent;
    if (intent?.type !== "append-to-collection" || intent.collectionId !== targetId) return "idle";
    return s.interaction.dropIntentInvalid ? "invalid" : "over";
  });
}

const ZONE_BASE =
  "flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-md border text-xs font-medium transition-all duration-200";

type ZoneAccent = Readonly<{ over: string; icon: string }>;

/** One wide rectangular drop zone. Always mounted (so dnd-kit measures its
 *  rect at drag start) but only VISIBLE + interactive while a card drag is
 *  live — invisible and click-through otherwise, so it never covers the
 *  breadcrumb or the toolbar controls it sits over. */
function DropZone({
  targetId,
  active,
  icon: Icon,
  label,
  accent,
  dataAttr,
}: Readonly<{
  targetId: NodeId;
  active: boolean;
  icon: typeof Trash2;
  label: string;
  accent: ZoneAccent;
  dataAttr: string;
}>) {
  const state = useZoneState(targetId);
  const { setNodeRef } = useDroppable({
    id: encodeDropTarget({ type: "panel", collectionId: targetId }),
  });

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-hidden={!active}
      {...{ [dataAttr]: targetId as string }}
      data-drop-state={state}
      className={[
        ZONE_BASE,
        active ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        state === "over"
          ? accent.over
          : state === "invalid"
            ? "border-zinc-700 bg-zinc-900/90 text-zinc-600"
            : "border-dashed border-zinc-600 bg-zinc-950/85 text-zinc-300 backdrop-blur-sm",
      ].join(" ")}
    >
      <Icon aria-hidden="true" className={["h-4 w-4", state === "over" ? accent.icon : ""].join(" ")} />
      {label}
    </div>
  );
}

/** Arms on drag start (snapshotting the trash count) and fires the sidebar
 *  drawer's arrival pop on the first count GROWTH during the armed window —
 *  the drop's commit. Ported verbatim from the old sidebar trash target so
 *  the drawer animation still plays after the target moved. */
function useTrashArrivalAnnounce(trashId: NodeId) {
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
  const count = useCollectionsSelector((s) =>
    s.graph.nodesById.get(trashId)?.kind === "collection"
      ? getChildren(s.graph, trashId).length
      : 0,
  );
  const dragStartCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (isDragging) {
      dragStartCountRef.current = count;
      return;
    }
    if (dragStartCountRef.current === null) return;
    const disarm = setTimeout(() => {
      dragStartCountRef.current = null;
    }, 400);
    return () => clearTimeout(disarm);
    // Snapshot only on the drag EDGE — mid-drag count changes must not
    // re-snapshot (that would hide the very growth this watches for).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);
  useEffect(() => {
    if (dragStartCountRef.current !== null && count > dragStartCountRef.current) {
      dragStartCountRef.current = null;
      announceGraphTrashArrival();
    }
  }, [count]);
}

/**
 * The two card-drag drop zones, centred over the board header. Renders the
 * parent-level zone (unless the focus is the root) and the trash zone, both
 * only while a card drag is live. Also registers the trash id for the keyboard
 * controller (Alt+Delete), which the old sidebar portal used to own.
 */
export function BreadcrumbDropZones({
  focusedId,
  trashId,
}: Readonly<{ focusedId: string; trashId: string | null }>) {
  const { trashRef } = useCollectionsContainer();
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
  // The focused collection's parent, if any — the "up one level" target. Null
  // at the root, where the parent zone is hidden (nowhere up to go).
  const parentId = useCollectionsSelector(
    (s) => s.graph.parentById.get(parseNodeId(focusedId)) ?? null,
  );
  const trashNodeId = trashId !== null ? parseNodeId(trashId) : null;

  // Keep the keyboard trash path (Alt+Delete) working now that the sidebar
  // portal that used to register this is gone.
  useEffect(() => {
    if (trashNodeId === null) return;
    trashRef.current = trashNodeId;
    return () => {
      if (trashRef.current === trashNodeId) trashRef.current = null;
    };
  }, [trashRef, trashNodeId]);

  useTrashArrivalAnnounce(trashNodeId ?? parseNodeId("__none__"));

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-3 px-4">
      {parentId !== null && (
        <DropZone
          targetId={parentId}
          active={isDragging}
          icon={FolderUp}
          label="Move to parent"
          dataAttr="data-graph-parent-drop"
          accent={{ over: "border-sky-300 bg-sky-800 text-sky-50", icon: "text-sky-100" }}
        />
      )}
      {trashNodeId !== null && (
        <DropZone
          targetId={trashNodeId}
          active={isDragging}
          icon={Trash2}
          label="Move to trash"
          dataAttr="data-graph-sidebar-trash"
          accent={{ over: "border-zinc-200 bg-zinc-700 text-zinc-50", icon: "text-zinc-100" }}
        />
      )}
    </div>
  );
}
