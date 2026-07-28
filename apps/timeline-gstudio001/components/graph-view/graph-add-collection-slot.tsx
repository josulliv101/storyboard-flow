"use client";

import { FolderPlus } from "lucide-react";

import { getChildren, parseNodeId, useCollectionsSelector } from "@storyboard/ui/dnd-collections";

import { useAppendCollection } from "./graph-native-drop";

/**
 * The trailing "add a timeline here" slot, at the end of a strip or grid.
 *
 * Adding a nested timeline used to mean reaching for the sidebar's collection
 * tool, which lands next to the SELECTION — fine when you are working on a
 * card, wrong when what you want is "one more, at the end of this timeline".
 * This appends to the surface it sits in, whatever is selected elsewhere.
 *
 * Deliberately not a card: dashed, muted, and no drag, selection or trim
 * behaviour. The surfaces render it past their own content extent, so it is
 * not an item to any of the index math either (see `trailingSlot`).
 */
export function AddCollectionSlot({
  collectionId,
}: Readonly<{ collectionId: string }>) {
  const append = useAppendCollection(collectionId);
  // Append means "after the last child", and the count is the index. Read
  // live so a drop or an undo elsewhere cannot leave this pointing at a
  // stale position.
  const childCount = useCollectionsSelector(
    (snapshot) => getChildren(snapshot.graph, parseNodeId(collectionId)).length,
  );

  return (
    <button
      type="button"
      data-add-collection-slot={collectionId}
      aria-label="Add a timeline to the end"
      title="Add a timeline here"
      onClick={() => append(childCount)}
      className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-zinc-700 bg-zinc-900/30 text-zinc-500 transition-colors hover:border-sky-500/60 hover:bg-sky-500/[0.06] hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
    >
      <FolderPlus aria-hidden="true" className="h-4 w-4" />
      <span className="text-[10px] font-medium">Add timeline</span>
    </button>
  );
}
