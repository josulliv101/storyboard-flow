"use client";

import { useCallback, useState } from "react";
import { type DragStartEvent } from "@dnd-kit/core";

import { type CollectionItemNode } from "../core/graph";
import { resolveAddCommandFromIntent, type DropIntent } from "../core/intents";
import { type CollectionsStore } from "./collections-store";
import { PALETTE_DATA_KEY } from "./palette";

// Palette-drag controller: brand-new nodes created at pick-up (the palette
// item's factory runs once per drag), previewed via the shared overlay, and
// committed as an add-nodes command through the standard intent pipeline.
// The provider calls `start`/`end`/`clear` from its dnd-kit handlers; a
// `true` return means "this was a palette drag — handled".

export function usePaletteDrag(args: {
  store: CollectionsStore;
  intentRef: { current: DropIntent | null };
  announce: (message: string) => void;
}): Readonly<{
  /** Nodes riding the current palette drag (null when none) — feeds the ghost. */
  paletteNodes: readonly CollectionItemNode[] | null;
  startPaletteDrag: (event: DragStartEvent) => boolean;
  endPaletteDrag: () => boolean;
  clearPaletteDrag: () => void;
}> {
  const { store, intentRef, announce } = args;
  // State (not a ref) so the overlay ghost renders.
  const [paletteNodes, setPaletteNodes] = useState<readonly CollectionItemNode[] | null>(null);

  const startPaletteDrag = useCallback(
    (event: DragStartEvent): boolean => {
      const createPaletteNode = event.active.data.current?.[PALETTE_DATA_KEY] as
        | (() => CollectionItemNode)
        | undefined;
      if (!createPaletteNode) return false;
      intentRef.current = null;
      const node = createPaletteNode();
      setPaletteNodes([node]);
      store.beginPaletteDrag();
      announce(`Picked up new "${node.name}".`);
      return true;
    },
    [store, intentRef, announce]
  );

  const endPaletteDrag = useCallback((): boolean => {
    if (!paletteNodes) return false;
    const intent = intentRef.current;
    intentRef.current = null;
    setPaletteNodes(null);
    // Clears the published drop intent too — without this, indicators
    // linger after the drop and drag-gated behaviors stay armed.
    store.endDrag();

    if (!intent) {
      announce("Cancelled drag.");
      return true;
    }
    const { graph } = store.getSnapshot();
    const resolved = resolveAddCommandFromIntent(graph, intent, paletteNodes);
    if (!resolved.ok || !store.dispatch(resolved.value).ok) {
      announce("Cannot add here.");
      return true;
    }
    const targetName = graph.nodesById.get(resolved.value.toParentId)?.name ?? "collection";
    announce(`Added "${paletteNodes[0].name}" to "${targetName}".`);
    return true;
  }, [paletteNodes, store, intentRef, announce]);

  const clearPaletteDrag = useCallback(() => {
    setPaletteNodes(null);
  }, []);

  return { paletteNodes, startPaletteDrag, endPaletteDrag, clearPaletteDrag };
}
