"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
  // Whether the LIVE drag is a palette drag — tracked independently of
  // paletteNodes, which stays null when the factory fails. Without this, a
  // failed factory would leave endPaletteDrag unable to tell the gesture was a
  // palette drag, so the provider's node-drag path would also "cancel" it
  // (a second, contradictory announcement).
  const paletteSessionRef = useRef(false);

  const startPaletteDrag = useCallback(
    (event: DragStartEvent): boolean => {
      const createPaletteNode = event.active.data.current?.[PALETTE_DATA_KEY] as
        | (() => CollectionItemNode)
        | undefined;
      if (!createPaletteNode) return false;
      // From here it IS a palette drag, even if creation fails.
      paletteSessionRef.current = true;
      intentRef.current = null;
      // The factory is consumer code running inside dnd-kit's onDragStart: a
      // throw would strand the gesture with the sensor armed, and a malformed
      // return would crash the `node.name` read below. Contain both, announce
      // once, and let endPaletteDrag clean up the session silently.
      let node: CollectionItemNode | undefined;
      try {
        node = createPaletteNode();
      } catch {
        node = undefined;
      }
      if (
        !node ||
        typeof node !== "object" ||
        typeof node.id !== "string" ||
        typeof node.name !== "string"
      ) {
        announce("Could not create item.");
        setPaletteNodes(null);
        return true;
      }
      setPaletteNodes([node]);
      store.beginPaletteDrag();
      announce(`Picked up new "${node.name}".`);
      return true;
    },
    [store, intentRef, announce]
  );

  const endPaletteDrag = useCallback((): boolean => {
    if (!paletteSessionRef.current) return false; // not a palette drag
    paletteSessionRef.current = false;
    const nodes = paletteNodes;
    const intent = intentRef.current;
    intentRef.current = null;
    setPaletteNodes(null);
    // Clears the published drop intent too — without this, indicators
    // linger after the drop and drag-gated behaviors stay armed.
    store.endDrag();

    // Factory failed at pick-up: already announced, nothing to add. Consume the
    // gesture silently — no second "Cancelled drag".
    if (!nodes) return true;

    if (!intent) {
      announce("Cancelled drag.");
      return true;
    }
    const { graph } = store.getSnapshot();
    const resolved = resolveAddCommandFromIntent(graph, intent, nodes);
    if (!resolved.ok || !store.dispatch(resolved.value).ok) {
      announce("Cannot add here.");
      return true;
    }
    const targetName = graph.nodesById.get(resolved.value.toParentId)?.name ?? "collection";
    announce(`Added "${nodes[0].name}" to "${targetName}".`);
    return true;
  }, [paletteNodes, store, intentRef, announce]);

  const clearPaletteDrag = useCallback(() => {
    paletteSessionRef.current = false;
    setPaletteNodes(null);
  }, []);

  // Stable identity: the provider's drag handlers depend on this object, so
  // a fresh literal per render would rebuild them on every announcement.
  return useMemo(
    () => ({ paletteNodes, startPaletteDrag, endPaletteDrag, clearPaletteDrag }),
    [paletteNodes, startPaletteDrag, endPaletteDrag, clearPaletteDrag]
  );
}
