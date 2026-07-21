"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDroppable } from "@dnd-kit/core";
import { Trash2 } from "lucide-react";

import {
  encodeDropTarget,
  getChildren,
  parseNodeId,
  useCollectionsContainer,
  useCollectionsSelector,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { announceGraphTrashArrival } from "@/lib/graph-view-events";

// The graph's trash drop target lives in the SIDEBAR now, taking the tool
// palette's place while a card is being dragged (the "add" tools are useless
// mid-drag). It is:
//   - defined inside the board's <DndCollections> so its useDroppable joins the
//     same DndContext (and the shared @dnd-kit/core instance) as every card;
//   - PORTALED into a slot the global sidebar renders, which sits outside the
//     collections provider entirely.
// The dropTarget id is the SAME `panel`/trashId the old bottom-right target
// used, so DndCollections' drag-end resolves it to the identical move-to-trash
// command — undo restores, nothing is deleted.

/** Id of the sidebar DOM node the board portals the trash target into. */
export const SIDEBAR_TRASH_SLOT_ID = "graph-sidebar-trash-slot";

function SidebarGraphTrashTarget({ trashId }: Readonly<{ trashId: NodeId }>) {
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
  const isCollection = useCollectionsSelector(
    (s) => s.graph.nodesById.get(trashId)?.kind === "collection",
  );
  const count = useCollectionsSelector((s) =>
    s.graph.nodesById.get(trashId)?.kind === "collection"
      ? getChildren(s.graph, trashId).length
      : 0,
  );
  const state = useCollectionsSelector((s) => {
    const intent = s.interaction.dropIntent;
    if (intent?.type !== "append-to-collection" || intent.collectionId !== trashId) return "idle";
    return s.interaction.dropIntentInvalid ? "invalid" : "over";
  });

  const { setNodeRef } = useDroppable({
    id: encodeDropTarget({ type: "panel", collectionId: trashId }),
    disabled: !isCollection,
  });

  // Arrival signal for the sidebar's trash DRAWER button: arm on drag start
  // (snapshotting the count), announce on the first armed count GROWTH — the
  // drop's commit — then disarm. Armed only across the drag lifecycle (plus a
  // short grace after release, since the drop's commit and the drag-end flag
  // can land in either order), so boot hydration growing the count (0 → N,
  // no drag) never fires it.
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
    // Snapshot only on the drag EDGE — count changing mid-drag must not
    // re-snapshot (that would hide the very growth this watches for).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);
  useEffect(() => {
    if (dragStartCountRef.current !== null && count > dragStartCountRef.current) {
      dragStartCountRef.current = null;
      announceGraphTrashArrival();
    }
  }, [count]);

  return (
    <div
      ref={setNodeRef}
      role="group"
      // A pointer affordance shown only mid-drag; the keyboard trash path is
      // Alt+Delete / Delete, wired separately.
      aria-hidden={!isDragging}
      data-graph-sidebar-trash={trashId}
      data-trash-state={state}
      className={[
        "absolute inset-0 flex items-center justify-center rounded-lg border",
        // The morph: idle it is invisible and lets tool clicks through; a drag
        // fades + scales it in over the tools. transition covers both ways.
        "transition-all duration-200 ease-out",
        isDragging ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0",
        // Icon-only, but LOUD while armed: a pulsing red glow says "drop zone"
        // from across the board; hover locks on — solid, steady, brighter.
        state === "over"
          ? "border-red-300 bg-red-500/35 shadow-[0_0_18px_rgba(248,113,113,0.55)]"
          : state === "invalid"
            ? "border-red-500 bg-red-500/40"
            : "border-dashed border-red-400/70 bg-red-950/80 shadow-[0_0_14px_rgba(248,113,113,0.35)] motion-safe:animate-pulse",
      ].join(" ")}
    >
      <Trash2
        aria-hidden="true"
        className={[
          "transition-transform duration-200",
          state === "over" ? "h-7 w-7 scale-110 text-red-100" : "h-6 w-6 text-red-300",
        ].join(" ")}
      />
    </div>
  );
}

/**
 * Mounted inside the board. Registers the trash id for the keyboard controller
 * (so Alt+Delete keeps working after the old bottom-right target is gone), then
 * portals the drop target into the sidebar slot once that slot exists. The
 * target is always rendered while the slot is present, so dnd-kit measures it
 * at drag start even though it is invisible until a drag begins.
 */
export function SidebarGraphTrashPortal({ trashId }: Readonly<{ trashId: string | null }>) {
  const { trashRef } = useCollectionsContainer();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const trashNodeId = trashId !== null ? parseNodeId(trashId) : null;

  useEffect(() => {
    if (trashNodeId === null) return;
    trashRef.current = trashNodeId;
    return () => {
      if (trashRef.current === trashNodeId) trashRef.current = null;
    };
  }, [trashRef, trashNodeId]);

  useEffect(() => {
    // The sidebar (global chrome, outside this provider) renders the slot. Find
    // it on the next frame — deferred through rAF, never a synchronous setState
    // in the effect — retrying a few frames to cover the mount-order race.
    let raf = 0;
    let tries = 0;
    const find = () => {
      const el = document.getElementById(SIDEBAR_TRASH_SLOT_ID);
      if (el) {
        setSlot(el);
        return;
      }
      if (tries++ < 120) raf = requestAnimationFrame(find);
    };
    raf = requestAnimationFrame(find);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (trashNodeId === null || slot === null) return null;
  return createPortal(<SidebarGraphTrashTarget trashId={trashNodeId} />, slot);
}
