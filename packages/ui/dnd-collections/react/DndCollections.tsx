"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import {
  getChildren,
  type CollectionItemNode,
  type CollectionsGraph,
  type NodeId,
} from "../core/graph";
import {
  decodeDropTarget,
  encodeDropTarget,
  resolveAddCommandFromIntent,
  resolveCommandFromIntent,
  resolveDropIntent,
  type DropIntent,
  type PanelChildRect,
} from "../core/intents";
import { resolveKeyboardCommand, type KeyboardMoveAction } from "../core/keyboard";
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
import { PALETTE_DATA_KEY } from "./palette";
import { VIRTUAL_INSERT_DATA_KEY, type VirtualInsertTarget } from "./virtual-droppable";

// Provider wiring: dnd-kit supplies the sensors, its own collision built-ins
// (pointerWithin with a closestCenter fallback — pointer-priority first, so
// hovering an empty panel can't lose to a nearer item somewhere else), and
// the DragOverlay. Everything semantic — what a hover MEANS, whether a drop
// is legal, what mutation results — happens in core/ pure functions. The
// committed graph is never touched during a drag; the live preview is
// interaction state in the store, applied as a command only on drop.

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
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((message: string) => {
    // Toggle a trailing zero-width space so repeating the same message still
    // re-announces (aria-live only fires on content changes).
    setAnnouncement((prev) => (prev === message ? `${message}​` : message));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  // Latest resolved intent, written during collision detection (the one
  // callback that receives pointer coordinates) and published to the store
  // from onDragMove/onDragOver.
  const intentRef = useRef<DropIntent | null>(null);

  // §20: selection changes are announced. Set identity only changes on real
  // selection changes (the store no-ops same-set updates), so this effect
  // is quiet during drags and reorders.
  const selectedIds = useCollectionsSelector((s) => s.interaction.selectedIds);
  const previousSelectionRef = useRef<ReadonlySet<NodeId> | null>(null);
  useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = selectedIds;
    if (previous === null || previous === selectedIds) return; // mount / no change
    if (selectedIds.size === 0) {
      announce("Selection cleared.");
    } else if (selectedIds.size === 1) {
      const [onlyId] = selectedIds;
      const name = store.getSnapshot().graph.nodesById.get(onlyId)?.name ?? "item";
      announce(`"${name}" selected.`);
    } else {
      announce(`${selectedIds.size} items selected.`);
    }
  }, [selectedIds, announce, store]);

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

  // Live palette drag: brand-new nodes created at pick-up, committed as an
  // add-nodes command on drop. State (not a ref) so the overlay ghost renders.
  const [paletteDragNodes, setPaletteDragNodes] =
    useState<readonly CollectionItemNode[] | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const createPaletteNode = event.active.data.current?.[PALETTE_DATA_KEY] as
        | (() => CollectionItemNode)
        | undefined;
      if (createPaletteNode) {
        intentRef.current = null;
        const node = createPaletteNode();
        setPaletteDragNodes([node]);
        announce(`Picked up new "${node.name}".`);
        return;
      }

      const target = decodeDropTarget(String(event.active.id));
      if (!target || target.type !== "node") return;
      intentRef.current = null;
      store.beginDrag(target.nodeId);
      const { interaction, graph } = store.getSnapshot();
      const count = interaction.activeIds.length;
      const name = graph.nodesById.get(target.nodeId)?.name ?? "item";
      announce(count > 1 ? `Picked up ${count} items.` : `Picked up "${name}".`);
    },
    [store, announce]
  );

  const publishIntent = useCallback(() => {
    store.setDropIntent(intentRef.current);
  }, [store]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (paletteDragNodes) {
        const intent = intentRef.current;
        intentRef.current = null;
        setPaletteDragNodes(null);
        void event;
        if (!intent) {
          announce("Cancelled drag.");
          return;
        }
        const { graph } = store.getSnapshot();
        const resolved = resolveAddCommandFromIntent(graph, intent, paletteDragNodes);
        if (!resolved.ok || !store.dispatch(resolved.value).ok) {
          announce("Cannot add here.");
          return;
        }
        const targetName = graph.nodesById.get(resolved.value.toParentId)?.name ?? "collection";
        announce(`Added "${paletteDragNodes[0].name}" to "${targetName}".`);
        return;
      }

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
    [store, announce, paletteDragNodes]
  );

  const handleDragCancel = useCallback(() => {
    intentRef.current = null;
    setPaletteDragNodes(null);
    store.endDrag();
    announce("Cancelled drag.");
  }, [store, announce]);

  // Semantic keyboard moves (Alt+Arrows/Home/End on a focused card), by
  // event delegation on the wrapper so no per-card wiring is needed. Alt
  // combos deliberately avoid dnd-kit's KeyboardSensor grammar (Enter/Space
  // to grab, bare arrows while grabbed) — the two coexist. Each action
  // resolves through core/keyboard.ts into the SAME move-nodes command the
  // pointer path dispatches, so validation/undo/announcements are shared.
  const containerRef = useRef<HTMLDivElement>(null);

  const restoreFocus = useCallback((nodeId: NodeId) => {
    // A move can unmount/remount the card (different React parent or
    // virtual slot), dropping focus — restore it on the next frame.
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
        ?.focus();
    });
  }, []);

  const handleGridRowMove = useCallback(
    (nodeId: NodeId, key: "ArrowUp" | "ArrowDown", columns: number) => {
      if (!Number.isFinite(columns) || columns < 1) return;
      const { graph } = store.getSnapshot();
      const parentId = graph.parentById.get(nodeId);
      if (parentId === undefined || parentId === null) return;
      const siblings = graph.childrenById.get(parentId) ?? [];
      const index = siblings.indexOf(nodeId);
      if (index === -1) return;

      if (key === "ArrowUp" && index < columns) {
        announce("Already in the first row.");
        return;
      }
      const lastRowStart = Math.floor((siblings.length - 1) / columns) * columns;
      if (key === "ArrowDown" && index >= lastRowStart) {
        announce("Already in the last row.");
        return;
      }

      // Visible boundary that lands the card one row away in the SAME
      // column (post-removal conversion happens in the intent resolver);
      // a shorter last row clamps to the end.
      const boundary =
        key === "ArrowUp" ? index - columns : Math.min(index + columns + 1, siblings.length);
      const resolved = resolveCommandFromIntent(
        graph,
        { type: "insert-at-index", collectionId: parentId, index: boundary },
        [nodeId]
      );
      if (!resolved.ok) return;
      const dispatched = store.dispatch(resolved.value);
      if (!dispatched.ok) return;

      const name = graph.nodesById.get(nodeId)?.name ?? "item";
      announce(`Moved "${name}" ${key === "ArrowUp" ? "up" : "down"} one row.`);
      restoreFocus(nodeId);
    },
    [store, announce, restoreFocus]
  );

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const card = (event.target as HTMLElement).closest?.("[data-node-id]");
      const rawId = card?.getAttribute("data-node-id");
      if (!rawId) return;
      const nodeId = rawId as NodeId;

      // Inside a grid container, Alt+ArrowUp/Down mean ROW moves (± the
      // grid's column count) instead of the global nest/move-out — the
      // grid declares its scope (and live column count) on the container.
      const gridEl = card?.closest?.("[data-grid-columns]");
      if (gridEl && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        event.stopPropagation();
        handleGridRowMove(nodeId, event.key, Number(gridEl.getAttribute("data-grid-columns")));
        return;
      }

      const action = KEYBOARD_ACTION_BY_KEY[event.key];
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();

      const { graph } = store.getSnapshot();
      const name = graph.nodesById.get(nodeId)?.name ?? "item";
      const resolved = resolveKeyboardCommand(graph, nodeId, action);
      if (!resolved.ok) {
        announce(KEYBOARD_BOUNDARY_MESSAGES[resolved.error.reason]);
        return;
      }

      const dispatched = store.dispatch(resolved.value);
      if (!dispatched.ok) {
        if (dispatched.error.reason === "would-create-cycle") {
          store.flashRejection([nodeId]);
          announce("Cannot move a collection into itself or one of its nested collections.");
        }
        return;
      }

      const targetName =
        graph.nodesById.get(resolved.value.toParentId)?.name ?? "collection";
      announce(`Moved "${name}" in "${targetName}".`);

      restoreFocus(nodeId);
    },
    [store, announce, handleGridRowMove, restoreFocus]
  );

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
      <CollectionsDragOverlay paletteNodes={paletteDragNodes} />
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

const KEYBOARD_ACTION_BY_KEY: Readonly<Record<string, KeyboardMoveAction | undefined>> = {
  ArrowLeft: "move-prev",
  ArrowRight: "move-next",
  Home: "move-home",
  End: "move-end",
  ArrowDown: "nest-in-neighbor",
  ArrowUp: "move-out",
  // Arrow-free synonyms — the only nest/move-out bindings available inside
  // grids, where Alt+Arrows are row moves.
  Enter: "nest-in-neighbor",
  Backspace: "move-out",
};

const KEYBOARD_BOUNDARY_MESSAGES: Readonly<Record<string, string>> = {
  "missing-node": "Nothing to move.",
  "cannot-move-root": "Top-level collections cannot be moved.",
  "no-previous-sibling": "Already first in its collection.",
  "no-next-sibling": "Already last in its collection.",
  "no-neighbor-collection": "No adjacent collection to nest into.",
  "no-parent-to-move-out-to": "Already at the top level.",
};

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
