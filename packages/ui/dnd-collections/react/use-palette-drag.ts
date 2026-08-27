"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { type DragStartEvent } from "@dnd-kit/core";

import { parseCollectionItemNode, type CollectionItemNode, type CollectionsGraph } from "@storyboard/collections-core/graph";
import type { AddNodesCommand } from "@storyboard/collections-core/commands";
import { resolveAddCommandFromIntent, type DropIntent } from "@storyboard/collections-core/intents";
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
  /**
   * Fires when factory-created nodes will NEVER commit — cancelled drop,
   * refused command, graph replaced mid-drag. Factories often park app-side
   * metadata keyed by the minted ids (the ids are minted inside the factory,
   * so the app has no other moment to learn they are dead); without this the
   * metadata lingers until some later event happens to clear it.
   */
  onDiscard?: (nodes: readonly CollectionItemNode[]) => void;
  /** See `mapDropCommand` on the provider. A palette drop is a DROP — it
   *  resolves its target from the same insert boundary a node drag does — so
   *  it goes through the same correction. Identity when unset. */
  mapDropCommand: (
    command: AddNodesCommand,
    intent: DropIntent,
    graph: CollectionsGraph,
  ) => AddNodesCommand;
}): Readonly<{
  /** Nodes riding the current palette drag (null when none) — feeds the ghost. */
  paletteNodes: readonly CollectionItemNode[] | null;
  startPaletteDrag: (event: DragStartEvent) => boolean;
  endPaletteDrag: () => boolean;
  clearPaletteDrag: () => void;
}> {
  const { store, intentRef, announce, onDiscard, mapDropCommand } = args;
  // State (not a ref) so the overlay ghost renders. The ref mirror lets
  // clearPaletteDrag (the provider's cancel path) discard the current nodes
  // without depending on render state.
  const [paletteNodes, setPaletteNodesState] = useState<
    readonly CollectionItemNode[] | null
  >(null);
  const paletteNodesRef = useRef<readonly CollectionItemNode[] | null>(null);
  const setPaletteNodes = useCallback((nodes: readonly CollectionItemNode[] | null) => {
    paletteNodesRef.current = nodes;
    setPaletteNodesState(nodes);
  }, []);
  // Whether the LIVE drag is a palette drag — tracked independently of
  // paletteNodes, which stays null when the factory fails. Without this, a
  // failed factory would leave endPaletteDrag unable to tell the gesture was a
  // palette drag, so the provider's node-drag path would also "cancel" it
  // (a second, contradictory announcement).
  const paletteSessionRef = useRef(false);

  const startPaletteDrag = useCallback(
    (event: DragStartEvent): boolean => {
      const factory = event.active.data.current?.[PALETTE_DATA_KEY];
      if (typeof factory !== "function") return false;
      const createPaletteNode = factory as () => unknown;
      // From here it IS a palette drag, even if creation fails.
      paletteSessionRef.current = true;
      intentRef.current = null;
      // The factory is consumer code running inside dnd-kit's onDragStart: a
      // throw would strand the gesture with the sensor armed, and a malformed
      // return would crash the `node.name` read below. Contain both, announce
      // once, and let endPaletteDrag clean up the session silently.
      let candidate: unknown;
      try {
        candidate = createPaletteNode();
      } catch {
        candidate = undefined;
      }
      const parsed = parseCollectionItemNode(candidate);
      if (!parsed.ok) {
        announce("Could not create item.");
        setPaletteNodes(null);
        return true;
      }
      const node = parsed.value;
      setPaletteNodes([node]);
      store.beginPaletteDrag();
      announce(`Picked up new "${node.name}".`);
      return true;
    },
    [store, intentRef, announce, setPaletteNodes]
  );

  const endPaletteDrag = useCallback((): boolean => {
    if (!paletteSessionRef.current) return false; // not a palette drag
    paletteSessionRef.current = false;
    const nodes = paletteNodes;
    const intent = intentRef.current;
    intentRef.current = null;
    setPaletteNodes(null);
    // The store's drag state is authoritative for whether this gesture may
    // still COMMIT: replaceGraph (async data landing mid-drag) resets it, and
    // a drop after that must not add nodes to the swapped-in graph. Read it
    // before endDrag() (which clears it unconditionally).
    const storeDragLive = store.getSnapshot().interaction.isDragging;
    // Clears the published drop intent too — without this, indicators
    // linger after the drop and drag-gated behaviors stay armed.
    store.endDrag();

    // Factory failed at pick-up: already announced, nothing to add. Consume the
    // gesture silently — no second "Cancelled drag".
    if (!nodes) return true;

    if (!storeDragLive || !intent) {
      onDiscard?.(nodes);
      announce("Cancelled drag.");
      return true;
    }
    const { graph } = store.getSnapshot();
    const resolved = resolveAddCommandFromIntent(graph, intent, nodes);
    if (!resolved.ok) {
      onDiscard?.(nodes);
      announce("Cannot add here.");
      return true;
    }
    const command = mapDropCommand(resolved.value, intent, graph);
    const dispatched = store.dispatch(command);
    if (!dispatched.ok) {
      onDiscard?.(nodes);
      // A policy veto carries the consumer's own explanation ("that
      // collection is still loading…") — node drags and the keyboard paths
      // announce it, and collapsing it to "Cannot add here." here threw away
      // the one message that tells the user what to do about it.
      announce(
        dispatched.error.reason === "blocked-by-policy" && dispatched.error.message
          ? dispatched.error.message
          : "Cannot add here."
      );
      return true;
    }
    const targetName = graph.nodesById.get(command.toParentId)?.name ?? "collection";
    // A drop always carries at least one node; naming the count is the honest
    // reading if that ever stops holding, rather than announcing "undefined".
    const firstName = nodes[0]?.name ?? `${nodes.length} items`;
    announce(`Added "${firstName}" to "${targetName}".`);
    return true;
  }, [paletteNodes, store, intentRef, announce, onDiscard, setPaletteNodes]);

  const clearPaletteDrag = useCallback(() => {
    paletteSessionRef.current = false;
    // The provider's CANCEL path (Escape, dnd-kit cancellation) lands here
    // without endPaletteDrag — the nodes die with the gesture.
    const nodes = paletteNodesRef.current;
    if (nodes) onDiscard?.(nodes);
    setPaletteNodes(null);
  }, [onDiscard, setPaletteNodes]);

  // Stable identity: the provider's drag handlers depend on this object, so
  // a fresh literal per render would rebuild them on every announcement.
  return useMemo(
    () => ({ paletteNodes, startPaletteDrag, endPaletteDrag, clearPaletteDrag }),
    [paletteNodes, startPaletteDrag, endPaletteDrag, clearPaletteDrag]
  );
}
