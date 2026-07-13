"use client";

import { useDroppable } from "@dnd-kit/core";
import { getChildren, type NodeId } from "../core/graph";
import { encodeDropTarget } from "../core/intents";
import { useCollectionsSelector } from "./collections-store";

// Trash is MODELING, not machinery: a designated (usually hidden) root
// collection. This target is nothing but a styled panel droppable for it —
// dropping resolves append-to-collection, the standard move-nodes command
// runs (subtrees ride along, undo restores), and nothing is ever deleted.

export function TrashTarget({ trashId }: { trashId: NodeId }) {
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
      role="region"
      aria-disabled={!isCollection}
      aria-label={`Trash${count > 0 ? `, ${count} items` : ""}. Drop items here to move them to trash.`}
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
