"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { getChildren, type CollectionItemNode, type CollectionsGraph } from "../core/graph";
import {
  decodeDropTarget,
  encodeDropTarget,
  resolveCommandFromIntent,
  resolveDropIntent,
  type DropIntent,
  type PanelChildRect,
} from "../core/intents";
import {
  CollectionsStoreProvider,
  createCollectionsStore,
  useCollectionsSelector,
  useCollectionsStore,
  type CollectionsChange,
  type CollectionsStore,
} from "./collections-store";
import { CollectionsContainerContext } from "./container-context";
import { NodeCardGhost } from "./node-views";
import { CollectionsPointerSensor } from "./pointer-sensors";
import { useLiveAnnouncements } from "./use-announcements";
import { useCollectionsKeyboard } from "./use-keyboard-controller";
import { usePaletteDrag } from "./use-palette-drag";
import { VIRTUAL_INSERT_DATA_KEY, type VirtualInsertTarget } from "./virtual-droppable";

// Provider wiring: dnd-kit supplies the sensors, collision built-ins, and
// the DragOverlay; this file owns collision -> intent resolution and the
// node-drag lifecycle. Everything else is delegated to focused controllers
// (use-announcements, use-palette-drag, use-keyboard-controller,
// use-edge-autoscroll lives with the virtual views). Everything semantic —
// what a hover MEANS, whether a drop is legal, what mutation results —
// happens in core/ pure functions. The committed graph is never touched
// during a drag; the live preview is interaction state in the store,
// applied as a command only on drop.

export type DndCollectionsProps = Readonly<{
  initialGraph: CollectionsGraph;
  /** Patch-based change feed: fires on every committed command, undo, and redo. */
  onChange?: (change: CollectionsChange) => void;
  children: ReactNode;
}>;

export function DndCollections({ initialGraph, onChange, children }: DndCollectionsProps) {
  // The store captures its options once, but callback props must stay fresh
  // — a parent passing an inline closure over its latest state expects that
  // version to be called. Route through a ref, updated in an effect (never
  // during render): every commit lands before the next event can dispatch,
  // so the ref is current by the time onChange can fire.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // One store per component lifetime; the graph prop is intentionally
  // initial-only (the store is the source of truth thereafter).
  const [store] = useState<CollectionsStore>(() =>
    createCollectionsStore(initialGraph, {
      onChange: (change) => onChangeRef.current?.(change),
    })
  );

  return (
    <CollectionsStoreProvider value={store}>
      <DndCollectionsContext>{children}</DndCollectionsContext>
    </CollectionsStoreProvider>
  );
}

function DndCollectionsContext({ children }: { children: ReactNode }) {
  const store = useCollectionsStore();
  const { announcement, announce } = useLiveAnnouncements(store);

  // Pointer activation is per-TARGET (see react/pointer-sensors.ts):
  // instant distance activation everywhere, press-and-hold on card bodies
  // marked data-drag-activation="hold" — tolerance hands fast movements to
  // pan-to-scroll instead of starting a drag. One sensor by necessity:
  // dnd-kit keys synthetic listeners by event name, so a second pointer
  // sensor would replace the first, not join it.
  const sensors = useSensors(
    useSensor(CollectionsPointerSensor),
    useSensor(KeyboardSensor)
  );

  // Latest resolved intent, written during collision detection (the one
  // callback that receives pointer coordinates) and published to the store
  // from onDragMove/onDragOver.
  const intentRef = useRef<DropIntent | null>(null);

  const palette = usePaletteDrag({ store, intentRef, announce });

  const containerRef = useRef<HTMLDivElement>(null);
  const { handleKeyDownCapture } = useCollectionsKeyboard({ store, announce, containerRef });

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const { graph, interaction } = store.getSnapshot();
      const activeIds = interaction.activeIds;

      // The dragged nodes' OWN cards are not drop targets (they sit dimmed
      // in place, so their droppable rects are stationary and hoverable) —
      // filter them so the fallback finds the real target underneath.
      // Descendants of a dragged collection REMAIN targetable: hovering
      // them resolves an intent the store flags as invalid (cycle), which
      // drives the "Cannot drop" preview instead of dead silence.
      const draggedIds = new Set<string>(activeIds);
      const droppableContainers = args.droppableContainers.filter((container) => {
        // Virtualized containers carry their own resolver (see
        // react/virtual-droppable.ts) instead of an encoded target id.
        if (container.data.current?.[VIRTUAL_INSERT_DATA_KEY]) return true;
        const target = decodeDropTarget(String(container.id));
        if (!target) return false; // unknown droppables are never winners
        const targetNode = target.type === "node" ? target.nodeId : target.collectionId;
        return !draggedIds.has(targetNode);
      });

      // Pointer-priority: only trust nearest-center once nothing is under
      // the pointer (closestCenter has no distance cutoff — unbounded, it
      // would always find "some item, somewhere").
      const withinPointer = pointerWithin({ ...args, droppableContainers });
      let collisions = withinPointer.length
        ? withinPointer
        : closestCenter({ ...args, droppableContainers });

      // Cards sit visually ON TOP of their containers (panels, virtual
      // strips), but pointerWithin ranks by distance-to-center with no
      // notion of z-order — a wide container's center can be nearer than
      // the hovered card's. Among pointer hits, a node card always beats a
      // container, so container-level intents (append, insert-at-index)
      // apply only where no card is under the pointer. The closestCenter
      // fallback is left alone: with nothing under the pointer, nearest
      // really is the best guess.
      if (withinPointer.length > 1) {
        const nodeHit = collisions.find(
          (collision) => decodeDropTarget(String(collision.id))?.type === "node"
        );
        if (nodeHit && nodeHit !== collisions[0]) {
          collisions = [nodeHit, ...collisions.filter((c) => c !== nodeHit)];
        }
      }

      const winner = collisions[0];
      if (!winner) {
        intentRef.current = null;
        return collisions;
      }

      // Keyboard sensor supplies no pointer — fall back to the moving
      // collision rect's center so intents still resolve.
      const point = args.pointerCoordinates ?? {
        x: args.collisionRect.left + args.collisionRect.width / 2,
        y: args.collisionRect.top + args.collisionRect.height / 2,
      };

      // A virtualized container resolves by its own layout math — most of
      // its cards aren't mounted, so card rects can't decide the boundary.
      const winnerContainer = droppableContainers.find((c) => c.id === winner.id);
      const virtualInsert = winnerContainer?.data.current?.[VIRTUAL_INSERT_DATA_KEY] as
        | VirtualInsertTarget
        | undefined;
      if (virtualInsert) {
        intentRef.current = {
          type: "insert-at-index",
          collectionId: virtualInsert.collectionId,
          index: virtualInsert.resolveBoundary(point),
        };
        return collisions;
      }

      const target = decodeDropTarget(String(winner.id));
      const rect = args.droppableRects.get(winner.id);
      if (!target || !rect) {
        intentRef.current = null;
        return collisions;
      }

      // Panel wins whenever the pointer is inside the panel but over no
      // card — including the GAP between two cards. Hand the resolver the
      // panel's child rects so that case lands between the flanking cards
      // instead of degrading to append-at-end.
      let panelChildRects: PanelChildRect[] | undefined;
      if (target.type === "panel") {
        panelChildRects = [];
        for (const childId of getChildren(graph, target.collectionId)) {
          const childRect = args.droppableRects.get(
            encodeDropTarget({ type: "node", nodeId: childId })
          );
          if (childRect) panelChildRects.push({ id: childId, rect: childRect });
        }
      }

      intentRef.current = resolveDropIntent({
        graph,
        target,
        targetRect: rect,
        point,
        activeIds,
        panelChildRects,
      });
      return collisions;
    },
    [store]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (palette.startPaletteDrag(event)) return;

      const target = decodeDropTarget(String(event.active.id));
      if (!target || target.type !== "node") return;
      intentRef.current = null;
      store.beginDrag(target.nodeId);
      const { interaction, graph } = store.getSnapshot();
      const count = interaction.activeIds.length;
      const name = graph.nodesById.get(target.nodeId)?.name ?? "item";
      announce(count > 1 ? `Picked up ${count} items.` : `Picked up "${name}".`);
    },
    [store, announce, palette]
  );

  const publishIntent = useCallback(() => {
    store.setDropIntent(intentRef.current);
  }, [store]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (palette.endPaletteDrag()) return;

      const intent = intentRef.current;
      intentRef.current = null;
      const { graph, interaction } = store.getSnapshot();
      const activeIds = interaction.activeIds;
      void event;

      if (!intent || activeIds.length === 0) {
        store.endDrag();
        announce("Cancelled drag.");
        return;
      }

      const commandResult = resolveCommandFromIntent(graph, intent, activeIds);
      if (!commandResult.ok) {
        store.endDrag();
        announce("Cancelled drag.");
        return;
      }

      const dispatched = store.dispatch(commandResult.value);
      store.endDrag();

      if (dispatched.ok) {
        const targetName = graph.nodesById.get(commandResult.value.toParentId)?.name ?? "collection";
        announce(
          activeIds.length > 1
            ? `Moved ${activeIds.length} items to "${targetName}".`
            : `Moved item to "${targetName}".`
        );
        return;
      }

      if (dispatched.error.reason === "would-create-cycle") {
        store.flashRejection(activeIds);
        announce("Cannot move a collection into itself or one of its nested collections.");
        return;
      }
      // same-position and friends: a quiet settle, mirroring pointer UX.
      announce("Dropped in place.");
    },
    [store, announce, palette]
  );

  const handleDragCancel = useCallback(() => {
    intentRef.current = null;
    palette.clearPaletteDrag();
    store.endDrag();
    announce("Cancelled drag.");
  }, [store, announce, palette]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={publishIntent}
      onDragOver={publishIntent}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* The wrapper doubles as the instance boundary: keyboard delegation
          here, and (via context) the scope for the FLIP measurement sweep. */}
      <CollectionsContainerContext.Provider value={containerRef}>
        <div ref={containerRef} onKeyDownCapture={handleKeyDownCapture} style={{ display: "contents" }}>
          {children}
        </div>
      </CollectionsContainerContext.Provider>
      <CollectionsDragOverlay paletteNodes={palette.paletteNodes} />
      <div
        aria-live="polite"
        role="status"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {announcement}
      </div>
    </DndContext>
  );
}

function CollectionsDragOverlay({
  paletteNodes,
}: {
  paletteNodes: readonly CollectionItemNode[] | null;
}) {
  const activeIds = useCollectionsSelector((s) => s.interaction.activeIds);
  const primaryId = activeIds[0] ?? null;
  const primaryNode = useCollectionsSelector((s) =>
    primaryId ? s.graph.nodesById.get(primaryId) ?? null : null
  );
  const node = paletteNodes?.[0] ?? primaryNode;
  const extraCount = useMemo(
    () => Math.max(0, (paletteNodes ? paletteNodes.length : activeIds.length) - 1),
    [paletteNodes, activeIds]
  );

  return (
    <DragOverlay>{node ? <NodeCardGhost node={node} extraCount={extraCount} /> : null}</DragOverlay>
  );
}
