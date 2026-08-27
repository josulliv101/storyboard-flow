"use client";

import { useContext } from "react";
import { useDraggable } from "@dnd-kit/core";
import { twMerge } from "tailwind-merge";
import { type CollectionItemNode } from "@storyboard/collections-core/graph";
import { CollectionsContainerContext } from "./container-context";

// External palette drag source: a draggable that creates a BRAND-NEW node
// when a drag starts (fresh ids per drag — the factory runs at pick-up, so
// dropping twice never collides). The provider recognizes the data key,
// previews with the ghost, and commits an add-nodes command through the
// standard intent pipeline — palette drops land anywhere a move can:
// panels, card edges, nest hotspots, virtual strips/grids.

export const PALETTE_DATA_KEY = "paletteCreate";

export type PaletteItemProps = Readonly<{
  /** Unique id among palette items (droppable-registry id, not a node id). */
  paletteId: string;
  /** Runs at drag start; must return a node whose id is new to the graph. */
  createNode: () => CollectionItemNode;
  /** Tailwind-merged onto the button, so overrides beat the defaults. */
  className?: string;
  children?: React.ReactNode;
}>;

export function PaletteItem({ paletteId, createNode, className, children }: PaletteItemProps) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `palette:${paletteId}`,
    data: { [PALETTE_DATA_KEY]: createNode },
  });
  // Nullable on purpose (headless hosting has no instructions element).
  // dnd-kit's attributes point aria-describedby at the provider-BLANKED
  // default instructions — an empty description — so override it with the
  // palette-specific text after the spread.
  const paletteInstructionsId = useContext(CollectionsContainerContext)?.paletteInstructionsId;
  return (
    <button
      type="button"
      ref={setNodeRef}
      data-palette-item={paletteId}
      className={twMerge(
        "flex h-24 w-32 cursor-grab flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/40 p-2 text-xs font-medium text-muted-foreground select-none active:cursor-grabbing",
        className
      )}
      {...attributes}
      {...listeners}
      aria-describedby={paletteInstructionsId ?? attributes["aria-describedby"]}
    >
      {children ?? paletteId}
    </button>
  );
}
