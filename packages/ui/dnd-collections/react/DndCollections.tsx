"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type ClientRect,
  type CollisionDetection,
  type DragStartEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";

import { getChildren, type CollectionItemNode, type CollectionsGraph, type NodeId } from "../core/graph";
import {
  decodeDropTarget,
  encodeDropTarget,
  intentDestination,
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
  type CommandPolicy,
} from "./collections-store";
import {
  CollectionsComponentsContext,
  useCollectionsComponents,
  useCollectionsComponentsValue,
  type CollectionsComponents,
} from "./collections-components";
import { CollectionsContainerContext } from "./container-context";
import {
  CollectionsInteractionPolicyContext,
  useCollectionsInteractionPolicyValue,
  type CollectionsClickSelection,
} from "./interaction-policy";
import { LiveTrimChannelContext, useCreateLiveTrimChannel } from "./live-trim";
import { useFlipGraphAnimation } from "./use-flip-graph-animation";
import { NodeCardGhost } from "./node-views";
import { CollectionsPointerSensor } from "./pointer-sensors";
import { LiveAnnouncementRegion, useAnnounceChannel } from "./use-announcements";
import { useCollectionsKeyboard } from "./use-keyboard-controller";
import { usePaletteDrag } from "./use-palette-drag";
import { VIRTUAL_INSERT_DATA_KEY, isVirtualInsertTarget } from "./virtual-droppable";

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
  /** Cap the undo stack (oldest entries fall off). Positive integer; default unbounded. */
  maxHistoryEntries?: number;
  /**
   * Post-commit FLIP movement animation (drop/undo/redo), default `true`. Owned
   * here at the provider so ONE sweep animates every card under the instance —
   * panels, virtual, and custom views. Honors `prefers-reduced-motion`.
   */
  animateMoves?: boolean;
  /**
   * Consumer pixels: `ItemContent` replaces every card's visible content
   * (panels and virtual views alike; per-view `itemContent` props override
   * it), `GhostContent` replaces the drag-overlay ghost. Registering here —
   * rather than per card — is what keeps the ghost and the cards in sync
   * from one place. Components MUST be identity-stable (module scope).
   */
  components?: CollectionsComponents;
  /**
   * What a plain click on a card selects (see react/interaction-policy.ts):
   * "replace" (default) selects only the clicked card; "toggle" toggles it —
   * an unselected card becomes the sole selection, the sole-selected card
   * deselects, a card in a multi-selection collapses the selection to
   * itself. Ctrl/Cmd+click is an additive toggle in both modes.
   */
  clickSelection?: CollectionsClickSelection;
  /**
   * When set, a plain POINTER click on an open-target card (default:
   * collections; override with `openOnClick`) OPENS it — drill-in
   * navigation — instead of selecting. Ctrl/Cmd+click still
   * selection-toggles it, and keyboard activation (Space) always selects,
   * so the keyboard grammar is unchanged. Clicks only survive to this
   * handler when no drag activated and no pan engaged — a press-and-hold
   * grab released in place, a drag, or a swipe never opens.
   */
  onOpenNode?: (id: NodeId) => void;
  /** Which nodes a plain click opens (only consulted when `onOpenNode` is
   *  set). Default: `node.kind === "collection"`. */
  openOnClick?: (id: NodeId, node: CollectionItemNode) => boolean;
  /**
   * Render media trim handles only on SELECTED cards, default `false`.
   * Unselected card edges become plain card body (press = drag/click), and
   * content's `trimEnabled` follows, so duration readouts gate with the
   * handles.
   */
  trimRequiresSelection?: boolean;
  /**
   * Pre-commit application veto (see `CommandPolicy`). Consulted on EVERY
   * dispatch — pointer drop, keyboard move, trash, palette add — so a rule
   * the pure reducer cannot express ("that collection is still loading") is
   * enforced in one place, before anything commits. Blocked commands are
   * announced with the rejection's `message`.
   */
  commandPolicy?: CommandPolicy;
  /**
   * Fires when a palette drag's factory-created nodes will NEVER commit —
   * cancelled, refused (including by `commandPolicy`), or orphaned by a
   * mid-drag graph replacement. Factories mint node ids and often park
   * app-side metadata under them; this is the app's only signal that those
   * ids are dead and the metadata can be released.
   */
  onPaletteDiscard?: (nodes: readonly CollectionItemNode[]) => void;
  children: ReactNode;
}>;

// The package owns ONE aria-live channel (useLiveAnnouncements) that speaks
// human node names and covers selection, drags, keyboard moves, and
// rejections. dnd-kit ships its own competing announcer whose defaults emit
// raw droppable ids ("Picked up draggable item node:alpha."), so a screen
// reader would hear every event twice, once in gibberish. Silence dnd-kit's
// by returning undefined from every handler — its announce() no-ops on a
// nullish value — leaving our channel as the single source of truth.
const SILENCED_ANNOUNCEMENTS: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

// dnd-kit's default draggable instructions say "press the space bar" to pick
// up — which contradicts our grammar (Space selects, Enter grabs). Blank
// them; our own instructions element (referenced by cards via
// aria-describedby) is the single, accurate description.
const NO_SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = { draggable: "" };

// dnd-kit's KeyboardSensor defaults to Space OR Enter for grab/drop. We
// reserve Space for SELECTION (native <button> activation → onClick) and use
// Enter alone to grab, so keyboard users can both select and drag a card.
const KEYBOARD_CODES = {
  start: ["Enter"],
  cancel: ["Escape"],
  end: ["Enter"],
};

// Max distance (px) from the pointer to any droppable's rect for the
// nearest-center fallback to still engage. Within it the pointer is "near the
// board" and a near-miss (gap, rect-edge rounding) resolves to the nearest
// target; beyond it the pointer is off the board and the drop cancels rather
// than snapping to some far-away card. One card-gap of tolerance.
const FALLBACK_MAX_DISTANCE = 48;

/** Whether the pointer is within FALLBACK_MAX_DISTANCE of some droppable's rect. */
function pointerNearAnyDroppable(
  point: Readonly<{ x: number; y: number }>,
  containers: readonly Readonly<{ id: UniqueIdentifier }>[],
  rects: ReadonlyMap<UniqueIdentifier, ClientRect>
): boolean {
  for (const container of containers) {
    const rect: ClientRect | undefined = rects.get(container.id);
    if (!rect) continue;
    // Distance from the point to the rect (0 while inside it).
    const dx = Math.max(rect.left - point.x, 0, point.x - (rect.left + rect.width));
    const dy = Math.max(rect.top - point.y, 0, point.y - (rect.top + rect.height));
    if (Math.hypot(dx, dy) <= FALLBACK_MAX_DISTANCE) return true;
  }
  return false;
}

export function DndCollections({
  initialGraph,
  onChange,
  maxHistoryEntries,
  animateMoves = true,
  components,
  clickSelection,
  onOpenNode,
  openOnClick,
  trimRequiresSelection,
  commandPolicy,
  onPaletteDiscard,
  children,
}: DndCollectionsProps) {
  const componentsValue = useCollectionsComponentsValue(components);
  const interactionPolicy = useCollectionsInteractionPolicyValue({
    clickSelection,
    onOpenNode,
    openOnClick,
    trimRequiresSelection,
  });
  // Live trim values ride a ref-backed emitter (never the store): only
  // content that opted in via useLiveTrim re-renders per trim move.
  const liveTrimChannel = useCreateLiveTrimChannel();
  // The store captures its options once, but callback props must stay fresh
  // — a parent passing an inline closure over its latest state expects that
  // version to be called. Route through a ref, updated in a layout effect
  // (never during render): it lands before paint, so the ref is current for
  // anything dispatched after this commit's layout phase. Known limit: layout
  // effects run bottom-up, so a DESCENDANT layout effect dispatching in the
  // very commit that changed `onChange` still invokes the previous callback
  // (mount is covered by the useRef seed). Accepted trade-off — the
  // alternative is a render-phase ref write, which is unsound under
  // concurrent rendering.
  const onChangeRef = useRef(onChange);
  const commandPolicyRef = useRef(commandPolicy);
  const onPaletteDiscardRef = useRef(onPaletteDiscard);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    commandPolicyRef.current = commandPolicy;
    onPaletteDiscardRef.current = onPaletteDiscard;
  });
  // Stable identity so the palette controller (and everything depending on
  // it) never rebuilds because the consumer passed an inline closure.
  const handlePaletteDiscard = useCallback(
    (nodes: readonly CollectionItemNode[]) => onPaletteDiscardRef.current?.(nodes),
    []
  );

  // One store per component lifetime; the graph prop and history cap are
  // intentionally initial-only (the store is the source of truth thereafter).
  // `commandPolicy` rides the same ref indirection as `onChange` (and inherits
  // its documented staleness limit) — a policy should read its live source at
  // call time rather than closing over render-time state, which makes the
  // closure's identity irrelevant.
  const [store] = useState<CollectionsStore>(() =>
    createCollectionsStore(initialGraph, {
      onChange: (change) => onChangeRef.current?.(change),
      maxHistoryEntries,
      commandPolicy: (command, graph) => commandPolicyRef.current?.(command, graph) ?? null,
    })
  );
  useEffect(() => () => store.destroy(), [store]);

  return (
    <CollectionsStoreProvider value={store}>
      <CollectionsComponentsContext.Provider value={componentsValue}>
        <CollectionsInteractionPolicyContext.Provider value={interactionPolicy}>
          <LiveTrimChannelContext.Provider value={liveTrimChannel}>
            <DndCollectionsContext
              animateMoves={animateMoves}
              onPaletteDiscard={handlePaletteDiscard}
            >
              {children}
            </DndCollectionsContext>
          </LiveTrimChannelContext.Provider>
        </CollectionsInteractionPolicyContext.Provider>
      </CollectionsComponentsContext.Provider>
    </CollectionsStoreProvider>
  );
}

// Drives the post-commit FLIP sweep at the PROVIDER level (not per view), so a
// single sweep animates every card under the instance — panels, virtual
// views, and custom views alike — and multiple views never each run their own.
// A dedicated child so its graph subscription re-renders ONLY this null
// component per commit, never the provider subtree (which would re-render
// every view and defeat the efficiency model).
function FlipAnimator({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  useFlipGraphAnimation(containerRef);
  return null;
}

function DndCollectionsContext({
  children,
  animateMoves,
  onPaletteDiscard,
}: {
  children: ReactNode;
  animateMoves: boolean;
  onPaletteDiscard: (nodes: readonly CollectionItemNode[]) => void;
}) {
  const store = useCollectionsStore();
  // Ref-backed channel: speaking must never set state HERE — this component
  // renders <DndContext>, and a re-render fans out to every card through
  // dnd-kit's internal context. Only <LiveAnnouncementRegion> re-renders.
  const announceChannel = useAnnounceChannel();
  const announce = announceChannel.announce;

  // Pointer activation is per-TARGET (see react/pointer-sensors.ts):
  // instant distance activation everywhere, press-and-hold on card bodies
  // marked data-drag-activation="hold" — tolerance hands fast movements to
  // pan-to-scroll instead of starting a drag. One sensor by necessity:
  // dnd-kit keys synthetic listeners by event name, so a second pointer
  // sensor would replace the first, not join it.
  const sensors = useSensors(
    useSensor(CollectionsPointerSensor),
    useSensor(KeyboardSensor, { keyboardCodes: KEYBOARD_CODES })
  );

  // Latest resolved intent, written during collision detection (the one
  // callback that receives pointer coordinates) and published to the store
  // from onDragMove/onDragOver.
  const intentRef = useRef<DropIntent | null>(null);

  const palette = usePaletteDrag({ store, intentRef, announce, onDiscard: onPaletteDiscard });

  const containerRef = useRef<HTMLDivElement>(null);
  // A mounted <TrashTarget> registers its collection id here (see
  // container-context) so Alt+Delete can move the focused card to trash.
  const trashRef = useRef<NodeId | null>(null);
  const { handleKeyDownCapture } = useCollectionsKeyboard({
    store,
    announce,
    containerRef,
    trashRef,
  });
  const instructionsId = useId();
  const paletteInstructionsId = useId();
  const containerValue = useMemo(
    () => ({ containerRef, instructionsId, paletteInstructionsId, trashRef, announce }),
    [instructionsId, paletteInstructionsId, announce]
  );

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
        const virtualInsert = container.data.current?.[VIRTUAL_INSERT_DATA_KEY];
        if (isVirtualInsertTarget(virtualInsert)) {
          return graph.nodesById.get(virtualInsert.collectionId)?.kind === "collection";
        }
        const target = decodeDropTarget(String(container.id));
        if (!target) return false; // unknown droppables are never winners
        const targetNode = target.type === "node" ? target.nodeId : target.collectionId;
        const node = graph.nodesById.get(targetNode);
        if (!node || (target.type === "panel" && node.kind !== "collection")) return false;
        return !draggedIds.has(targetNode);
      });

      // Pointer-priority: for pointer drags, nothing under the pointer means
      // NO target. closestCenter has no distance cutoff — unbounded, it
      // always finds "some item, somewhere", which would let a release far
      // outside the board commit a move to whatever card happened to be
      // nearest (drag-to-nowhere must cancel, not act — see
      // ReleaseOutsideBoardCancels). Only keyboard drags, which have no
      // pointer to test containment with, fall back to nearest-center.
      const withinPointer = pointerWithin({ ...args, droppableContainers });
      let collisions = withinPointer;
      if (!withinPointer.length) {
        const point = args.pointerCoordinates;
        // Keyboard drags have no pointer — fall back to nearest-center so an
        // intent still resolves. Pointer drags fall back ONLY while the
        // pointer is still near some droppable: releasing out in open space
        // (far from every target) must CANCEL, not snap to "some card,
        // somewhere" — unbounded closestCenter's failure mode, which let a
        // release well outside the board commit a move (see
        // ReleaseOutsideBoardCancels).
        collisions =
          !point ||
          pointerNearAnyDroppable(point, droppableContainers, args.droppableRects)
            ? closestCenter({ ...args, droppableContainers })
            : [];
      }

      // Cards sit visually ON TOP of their containers (panels, virtual
      // strips), but pointerWithin ranks by distance-to-center with no
      // notion of z-order — a wide container's center can be nearer than
      // the hovered card's. Among pointer hits, a node card always beats a
      // container, so container-level intents (append, insert-at-index)
      // apply only where no card is under the pointer. The keyboard-only
      // closestCenter fallback is left alone: with no pointer at all,
      // nearest really is the best guess.
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
      const virtualInsert = winnerContainer?.data.current?.[VIRTUAL_INSERT_DATA_KEY];
      if (isVirtualInsertTarget(virtualInsert)) {
        let index: number;
        try {
          index = virtualInsert.resolveBoundary(point);
        } catch {
          intentRef.current = null;
          return collisions;
        }
        if (!Number.isInteger(index)) {
          intentRef.current = null;
          return collisions;
        }
        intentRef.current = {
          type: "insert-at-index",
          collectionId: virtualInsert.collectionId,
          index,
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
      spokenTargetRef.current = null;
      store.beginDrag(target.nodeId);
      const { interaction, graph } = store.getSnapshot();
      const count = interaction.activeIds.length;
      const name = graph.nodesById.get(target.nodeId)?.name ?? "item";
      announce(count > 1 ? `Picked up ${count} items.` : `Picked up "${name}".`);
    },
    [store, announce, palette]
  );

  // The spoken drop target of the live drag: `<destinationId>:<invalid>` —
  // dnd-kit's own onDragOver announcements are silenced (they speak raw
  // droppable ids), so THIS is the replacement mid-drag feedback. Announcing
  // at destination-collection granularity (not per boundary index) keeps a
  // keyboard grab-drag informative without per-arrow spam.
  const spokenTargetRef = useRef<string | null>(null);

  const publishIntent = useCallback(() => {
    const intent = intentRef.current;
    store.setDropIntent(intent);

    const { graph, interaction } = store.getSnapshot();
    if (!interaction.isDragging) return;
    if (!intent) {
      // Off every target: reset so re-entering the same collection speaks again.
      spokenTargetRef.current = null;
      return;
    }
    const destination = intentDestination(graph, intent);
    if (destination === null) return;
    const spoken = `${destination}:${interaction.dropIntentInvalid}`;
    if (spokenTargetRef.current === spoken) return;
    spokenTargetRef.current = spoken;
    const name = graph.nodesById.get(destination)?.name ?? "collection";
    announce(
      interaction.dropIntentInvalid
        ? `Over "${name}" — cannot drop (cycle).`
        : `Over "${name}".`
    );
  }, [store, announce]);

  const handleDragEnd = useCallback(
    () => {
      if (palette.endPaletteDrag()) return;

      const intent = intentRef.current;
      intentRef.current = null;
      spokenTargetRef.current = null;
      const { graph, interaction } = store.getSnapshot();
      const activeIds = interaction.activeIds;

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
      if (dispatched.error.reason === "blocked-by-policy") {
        // Refused before it committed, so the cards never moved — the flash
        // is the whole visible feedback.
        store.flashRejection(activeIds);
        if (dispatched.error.message) announce(dispatched.error.message);
        return;
      }
      if (dispatched.error.reason === "same-position") {
        // A quiet settle, mirroring pointer UX: the drop landed where it started.
        announce("Dropped in place.");
        return;
      }
      // missing-node and friends: the command was REJECTED — announcing
      // "dropped in place" would claim success for a refused move.
      announce("Could not move.");
    },
    [store, announce, palette]
  );

  const handleDragCancel = useCallback(() => {
    intentRef.current = null;
    spokenTargetRef.current = null;
    palette.clearPaletteDrag();
    store.endDrag();
    announce("Cancelled drag.");
  }, [store, announce, palette]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{
        announcements: SILENCED_ANNOUNCEMENTS,
        screenReaderInstructions: NO_SCREEN_READER_INSTRUCTIONS,
      }}
      onDragStart={handleDragStart}
      onDragMove={publishIntent}
      onDragOver={publishIntent}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* The wrapper doubles as the instance boundary: keyboard delegation
          here, and (via context) the scope for the FLIP measurement sweep. */}
      <CollectionsContainerContext.Provider value={containerValue}>
        <div ref={containerRef} onKeyDownCapture={handleKeyDownCapture} style={{ display: "contents" }}>
          {children}
        </div>
      </CollectionsContainerContext.Provider>
      {/* Instance-wide FLIP sweep (opt out with animateMoves={false}). */}
      {animateMoves && <FlipAnimator containerRef={containerRef} />}
      {/* The single keyboard-usage description, referenced by cards via
          aria-describedby (dnd-kit's own instructions are blanked above). It
          must match the real grammar EXACTLY — every chord here is verified
          against use-keyboard-controller and the sensor config: Space
          selects, Enter grabs for a free-form drag, and Alt+keys are the
          quick semantic moves. */}
      <p id={instructionsId} className="sr-only">
        Press Space to select this item, or Control or Command plus Space to add it to a
        multi-selection. Press Enter to pick it up, then use the Arrow keys to move it and Enter
        to drop, or Escape to cancel. Alt plus Arrow keys move it one step at a time, and Alt plus
        Home or End moves it to the start or end. Alt plus Down nests it into a neighboring
        collection and Alt plus Up moves it out; Alt plus Enter and Alt plus Backspace do the same
        nesting and un-nesting anywhere, including inside a grid, where Alt plus Up and Down move
        between rows instead. For media, Alt plus Shift plus Left or Right trims the end and Alt
        plus Shift plus Up or Down trims the start of a video, and Alt plus Shift plus Home or End
        slides a video&apos;s source window earlier or later without changing its length. Press Alt
        plus Delete to move it to trash.
      </p>
      {/* Palette items are external drag sources — the card instructions
          above (selection, Alt-moves) don't apply, so they reference this
          one instead of dnd-kit's blanked default. */}
      <p id={paletteInstructionsId} className="sr-only">
        Press Enter to pick up a new item, then use the Arrow keys to choose where it goes and
        Enter to drop it, or Escape to cancel.
      </p>
      <CollectionsDragOverlay paletteNodes={palette.paletteNodes} />
      <LiveAnnouncementRegion channel={announceChannel} />
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
  const extraCount = Math.max(0, (paletteNodes ? paletteNodes.length : activeIds.length) - 1);
  // Consumer ghost pixels, falling back to the stock ghost — registered at
  // the provider so cards and their drag preview stay in sync in one place.
  const GhostContent = useCollectionsComponents().GhostContent ?? NodeCardGhost;

  return (
    <DragOverlay>{node ? <GhostContent node={node} extraCount={extraCount} /> : null}</DragOverlay>
  );
}
