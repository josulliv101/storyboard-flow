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

import { getChildren, type CollectionsGraph, type NodeId } from "../core/graph";
import {
  decodeDropTarget,
  encodeDropTarget,
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
        const target = decodeDropTarget(String(container.id));
        if (!target) return false; // unknown droppables are never winners
        const targetNode = target.type === "node" ? target.nodeId : target.collectionId;
        return !draggedIds.has(targetNode);
      });

      // Pointer-priority: only trust nearest-center once nothing is under
      // the pointer (closestCenter has no distance cutoff — unbounded, it
      // would always find "some item, somewhere").
      const withinPointer = pointerWithin({ ...args, droppableContainers });
      const collisions = withinPointer.length
        ? withinPointer
        : closestCenter({ ...args, droppableContainers });

      const winner = collisions[0];
      if (!winner) {
        intentRef.current = null;
        return collisions;
      }

      const target = decodeDropTarget(String(winner.id));
      const rect = args.droppableRects.get(winner.id);
      if (!target || !rect) {
        intentRef.current = null;
        return collisions;
      }

      // Keyboard sensor supplies no pointer — fall back to the moving
      // collision rect's center so intents still resolve.
      const point = args.pointerCoordinates ?? {
        x: args.collisionRect.left + args.collisionRect.width / 2,
        y: args.collisionRect.top + args.collisionRect.height / 2,
      };

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
    [store, announce]
  );

  const handleDragCancel = useCallback(() => {
    intentRef.current = null;
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
  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const action = KEYBOARD_ACTION_BY_KEY[event.key];
      if (!action) return;
      const card = (event.target as HTMLElement).closest?.("[data-node-id]");
      const rawId = card?.getAttribute("data-node-id");
      if (!rawId) return;
      const nodeId = rawId as NodeId;

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

      // A cross-parent move unmounts/remounts the card (different React
      // parent), dropping focus — restore it on the moved node next frame.
      requestAnimationFrame(() => {
        containerRef.current
          ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
          ?.focus();
      });
    },
    [store, announce]
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
      <CollectionsDragOverlay />
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
};

const KEYBOARD_BOUNDARY_MESSAGES: Readonly<Record<string, string>> = {
  "missing-node": "Nothing to move.",
  "cannot-move-root": "Top-level collections cannot be moved.",
  "no-previous-sibling": "Already first in its collection.",
  "no-next-sibling": "Already last in its collection.",
  "no-neighbor-collection": "No adjacent collection to nest into.",
  "no-parent-to-move-out-to": "Already at the top level.",
};

function CollectionsDragOverlay() {
  const activeIds = useCollectionsSelector((s) => s.interaction.activeIds);
  const primaryId = activeIds[0] ?? null;
  const primaryNode = useCollectionsSelector((s) =>
    primaryId ? s.graph.nodesById.get(primaryId) ?? null : null
  );
  const extraCount = useMemo(() => Math.max(0, activeIds.length - 1), [activeIds]);

  return (
    <DragOverlay>
      {primaryNode ? <NodeCardGhost node={primaryNode} extraCount={extraCount} /> : null}
    </DragOverlay>
  );
}
