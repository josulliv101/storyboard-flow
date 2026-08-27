"use client";

import { useEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { getChildren, type NodeId } from "@storyboard/collections-core/graph";
import { encodeDropTarget } from "@storyboard/collections-core/intents";
import { useCollectionsSelector } from "./collections-store";
import { useCollectionsContainer } from "./container-context";

// Trash is MODELING, not machinery: a designated (usually hidden) root
// collection. This target is nothing but a styled panel droppable for it —
// dropping resolves append-to-collection, the standard move-nodes command
// runs (subtrees ride along, undo restores), and nothing is ever deleted.
// Mounting it also registers the id for the keyboard path (Alt+Delete on a
// focused card), so trash works without a pointer.

export function TrashTarget({ trashId }: { trashId: NodeId }) {
  const { trashRef } = useCollectionsContainer();
  // Register this instance's trash id for the keyboard controller; clear it on
  // unmount (only if we still own the slot — a later TrashTarget may have
  // replaced us).
  useEffect(() => {
    trashRef.current = trashId;
    return () => {
      if (trashRef.current === trashId) trashRef.current = null;
    };
  }, [trashRef, trashId]);

  const isCollection = useCollectionsSelector(
    (s) => s.graph.nodesById.get(trashId)?.kind === "collection"
  );
  const count = useCollectionsSelector((s) =>
    s.graph.nodesById.get(trashId)?.kind === "collection"
      ? getChildren(s.graph, trashId).length
      : 0
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

  return (
    <div
      ref={setNodeRef}
      // "group", not "region": ARIA 1.2 doesn't support aria-disabled on
      // landmark roles, so a misconfigured trash id would have no accessible
      // disabled signal. tabIndex -1 makes it a programmatic focus target —
      // Alt+Delete on a collection's LAST child lands focus here instead of
      // dropping to <body> (the trash collection itself is usually hidden).
      role="group"
      tabIndex={-1}
      aria-disabled={!isCollection}
      aria-label={`Trash${count > 0 ? `, ${count} items` : ""}. Drop items here, or press Alt+Delete on a focused item, to move it to trash.`}
      data-trash-target={trashId}
      data-trash-valid={isCollection}
      data-trash-state={state}
      className={[
        "flex h-16 items-center justify-center gap-2 rounded-md border border-dashed text-xs font-medium transition-colors",
        state === "over" ? "border-destructive bg-destructive/10 text-destructive" : "",
        state === "invalid" ? "border-destructive bg-destructive/20 text-destructive" : "",
        state === "idle" ? "border-border text-muted-foreground" : "",
      ].join(" ")}
    >
      Trash{count > 0 ? ` (${count})` : ""}
    </div>
  );
}
