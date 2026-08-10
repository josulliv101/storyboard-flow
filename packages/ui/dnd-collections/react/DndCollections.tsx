"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  closestCenter,
  pointerWithin,
  useDndContext,
  useSensor,
  useSensors,
  type Announcements,
  type ClientRect,
  type CollisionDetection,
  type DragStartEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";

import { getChildren, type CollectionItemNode, type CollectionsGraph, type NodeId } from "../core/graph";
import type { AddNodesCommand, MoveNodesCommand } from "../core/commands";
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
import {
  useFlipGraphAnimation,
  type FlipDropOrigin,
} from "./use-flip-graph-animation";
import { NodeCardGhost } from "./node-views";
import { CollectionsPointerSensor } from "./pointer-sensors";
import { LiveAnnouncementRegion, useAnnounceChannel } from "./use-announcements";
import { useCollectionsKeyboard } from "./use-keyboard-controller";
import { usePaletteDrag } from "./use-palette-drag";
import { createEdgeAutoScrollCoordinator } from "./edge-autoscroll-coordinator";
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
   * Hold these nodes' click-selection for the double-click window, for
   * consumers where a DOUBLE-click opens a node. Without it the card visibly
   * selects and then unselects on its way into the drill-in — click 1 paints
   * before any dblclick handler can run. Costs a short delay on the single
   * click, so return false for anything a double-click does not open.
   * See `SELECTION_DEFER_MS`.
   */
  deferSelection?: (id: NodeId, node: CollectionItemNode) => boolean;
  /**
   * Render media trim handles only on SELECTED cards, default `false`.
   * Unselected card edges become plain card body (press = drag/click), and
   * content's `trimEnabled` follows, so duration readouts gate with the
   * handles.
   */
  trimRequiresSelection?: boolean;
  /**
   * Let additive-tap mode stay armed while the selection is EMPTY.
   *
   * Off by default: the mode's usual control is the anchor card's menu, which
   * exists only while something is selected, so an armed-and-empty mode would
   * be invisible and unreachable. Pass this when the consumer gives the mode a
   * control that is always on screen — a toolbar toggle — which makes "arm it,
   * then pick" the ordinary way in. The consumer then owns the way OUT too.
   */
  keepMultiSelectModeWhenEmpty?: boolean;
  /**
   * Pre-commit application veto (see `CommandPolicy`). Consulted on EVERY
   * dispatch — pointer drop, keyboard move, trash, palette add — so a rule
   * the pure reducer cannot express ("that collection is still loading") is
   * enforced in one place, before anything commits. Blocked commands are
   * announced with the rejection's `message`.
   */
  commandPolicy?: CommandPolicy;
  /**
   * Rewrite the command a POINTER DROP resolved to, before it is dispatched.
   *
   * The escape hatch for a view whose boundaries do not mean what the intent
   * assumes. A drop names its target as (collection, index), taken from the
   * insert container the pointer was over — which is right for a strip showing
   * one collection's children, and wrong for a FLAT strip, whose boundaries
   * index a run spanning many parents. Such a view can map (flat index) →
   * (real parent, real index) here.
   *
   * POINTER DROPS ONLY — node drags AND palette drags, since both resolve
   * their target from the same insert boundary and both would be wrong in the
   * same way. KEYBOARD moves and trash are not routed through this: they name
   * their target directly rather than reading it off a boundary, so there is
   * nothing to correct.
   *
   * Runs BEFORE `commandPolicy`, so a rewritten command is still subject to
   * every application rule; returning the command unchanged is a no-op.
   */
  mapDropCommand?: (
    command: MoveNodesCommand | AddNodesCommand,
    intent: DropIntent,
    /** The committed graph the drop resolved against — handed over so a
     *  mapper can re-derive whatever its view's boundaries mean without
     *  reaching for a store it may not be able to see. */
    graph: CollectionsGraph,
  ) => MoveNodesCommand | AddNodesCommand;
  /**
   * Fires when a palette drag's factory-created nodes will NEVER commit —
   * cancelled, refused (including by `commandPolicy`), or orphaned by a
   * mid-drag graph replacement. Factories mint node ids and often park
   * app-side metadata under them; this is the app's only signal that those
   * ids are dead and the metadata can be released.
   */
  onPaletteDiscard?: (nodes: readonly CollectionItemNode[]) => void;
  /**
   * Scale the drag ghost to this fraction of the card's size on pickup,
   * default `1` (no scaling — every existing consumer is unchanged). A value
   * below 1 shrinks the ghost so the drop target underneath stays visible —
   * the difference between "can I see the collection I'm aiming at" and not.
   *
   * The shrink animates, and grows FROM the grab point: transform-origin is
   * the pointer's offset within the card, so the exact pixel under the cursor
   * at pickup stays under the cursor at every size. No positional jump, and
   * drop accuracy is unchanged.
   */
  dragGhostScale?: number;
  /**
   * Render the drag ghost at this FIXED width in px, independent of the source
   * card's width. Strip cards are as wide as their clip is long, so dragging a
   * long clip produced an enormous ghost that buried the drop targets below it;
   * a fixed width keeps every ghost compact and legible regardless of duration.
   * Takes precedence over `dragGhostScale` when both are set.
   *
   * The ghost re-centres horizontally on the grabbed pixel — the overlay box's
   * top-left tracks (card top-left + pointer delta), so pinning the ghost's
   * centre to the pointer's offset within it keeps the ghost under the cursor
   * with no positional jump. Card height is kept (row height is not
   * duration-relative). Omit to size the ghost to the whole card as before.
   */
  dragGhostWidth?: number;
  /**
   * Render the drag ghost at this FIXED height in px as well, centred
   * VERTICALLY on the grabbed pixel — pair it with `dragGhostWidth` for a
   * fixed-SIZE (e.g. square) ghost. Use it with a `GhostContent` that paints
   * the item's own artwork so the drag preview is a compact thumbnail of what
   * is being moved rather than a duration-shaped card. Requires
   * `dragGhostWidth`; ignored on its own. Omit to keep the ghost as tall as
   * the source card (height fills the overlay box).
   */
  dragGhostHeight?: number;
  /**
   * Extra keyboard-usage sentences appended to the shared card instructions
   * element (referenced by every card via `aria-describedby`). The package has
   * no "open" or "rename" concept — those are HOST keyboard boundaries — so a
   * consumer documents its own card shortcuts here to keep them discoverable to
   * screen-reader users alongside the built-in select/move grammar.
   */
  itemInstructions?: ReactNode;
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
  deferSelection,
  trimRequiresSelection,
  keepMultiSelectModeWhenEmpty,
  commandPolicy,
  mapDropCommand,
  onPaletteDiscard,
  dragGhostScale = 1,
  dragGhostWidth,
  dragGhostHeight,
  itemInstructions,
  children,
}: DndCollectionsProps) {
  const componentsValue = useCollectionsComponentsValue(components);
  const interactionPolicy = useCollectionsInteractionPolicyValue({
    clickSelection,
    onOpenNode,
    openOnClick,
    deferSelection,
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
  const mapDropCommandRef = useRef(mapDropCommand);
  const onPaletteDiscardRef = useRef(onPaletteDiscard);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    commandPolicyRef.current = commandPolicy;
    mapDropCommandRef.current = mapDropCommand;
    onPaletteDiscardRef.current = onPaletteDiscard;
  });
  // Stable identity so the palette controller (and everything depending on
  // it) never rebuilds because the consumer passed an inline closure.
  const handlePaletteDiscard = useCallback(
    (nodes: readonly CollectionItemNode[]) => onPaletteDiscardRef.current?.(nodes),
    []
  );
  // Same treatment: a stable identity over the ref, so a consumer rebuilding
  // its mapper per render never re-creates the drop handler mid-drag. Unset
  // means identity — the command commits exactly as resolved.
  const handleMapDropCommand = useCallback(
    (command: MoveNodesCommand | AddNodesCommand, intent: DropIntent, graph: CollectionsGraph) =>
      mapDropCommandRef.current?.(command, intent, graph) ?? command,
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
      keepMultiSelectModeWhenEmpty,
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
              mapDropCommand={handleMapDropCommand}
              onPaletteDiscard={handlePaletteDiscard}
              dragGhostScale={dragGhostScale}
              dragGhostWidth={dragGhostWidth}
              dragGhostHeight={dragGhostHeight}
              itemInstructions={itemInstructions}
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
function FlipAnimator({
  containerRef,
  dropOriginRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
  dropOriginRef: RefObject<FlipDropOrigin | null>;
}) {
  useFlipGraphAnimation(containerRef, dropOriginRef);
  return null;
}

function DndCollectionsContext({
  children,
  animateMoves,
  mapDropCommand,
  onPaletteDiscard,
  dragGhostScale,
  dragGhostWidth,
  dragGhostHeight,
  itemInstructions,
}: {
  children: ReactNode;
  animateMoves: boolean;
  /** Already ref-indirected by the outer component — a stable identity, safe
   *  to read inside the drop handler without re-creating it. */
  mapDropCommand: (
    command: MoveNodesCommand | AddNodesCommand,
    intent: DropIntent,
    graph: CollectionsGraph,
  ) => MoveNodesCommand | AddNodesCommand;
  onPaletteDiscard: (nodes: readonly CollectionItemNode[]) => void;
  dragGhostScale: number;
  dragGhostWidth: number | undefined;
  dragGhostHeight: number | undefined;
  itemInstructions: ReactNode;
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

  const palette = usePaletteDrag({
    store,
    intentRef,
    announce,
    onDiscard: onPaletteDiscard,
    // A palette drop is a drop: same boundary, same correction. Narrowed to
    // the add variant, which is all this path can ever produce.
    mapDropCommand: (command, intent, graph) =>
      mapDropCommand(command, intent, graph) as AddNodesCommand,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  // The live drag ghost element, and the box it occupied at the moment of a
  // drop — the FLIP sweep animates the dropped card out of that box instead
  // of out of the slot it used to sit in (see FlipDropOrigin).
  const ghostRef = useRef<HTMLElement | null>(null);
  const dropOriginRef = useRef<FlipDropOrigin | null>(null);
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
  // ONE edge auto-scroll driver for every virtual view under this provider —
  // views enroll their containers through the context; the coordinator owns
  // the single pointer tracker and drag-gated frame loop. Construction is
  // side-effect-free; the window listeners attach in the effect (StrictMode's
  // double-invoke and SSR both stay clean).
  const [edgeAutoScroll] = useState(() => createEdgeAutoScrollCoordinator(store));
  useEffect(() => edgeAutoScroll.attach(), [edgeAutoScroll]);
  const containerValue = useMemo(
    () => ({
      containerRef,
      instructionsId,
      paletteInstructionsId,
      trashRef,
      announce,
      registerEdgeAutoScroll: edgeAutoScroll.register,
    }),
    [instructionsId, paletteInstructionsId, announce, edgeAutoScroll]
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
      // A view whose boundaries index something other than the target
      // collection's own children gets to correct the target here — see
      // `mapDropCommand`. Read through the ref so a consumer that rebuilds the
      // callback per render never leaves a stale mapping armed mid-drag.
      const command = mapDropCommand(commandResult.value, intent, graph);

      // Measure the ghost BEFORE the commit — dispatching unmounts the
      // overlay, and this box is where the dropped card's motion should
      // start. Only the primary dragged node gets it; the rest of a
      // multi-select FLIPs from their own previous slots.
      const ghostBox = ghostRef.current?.getBoundingClientRect() ?? null;
      dropOriginRef.current =
        ghostBox && ghostBox.width > 0 && ghostBox.height > 0
          ? {
              nodeId: activeIds[0] as string,
              box: {
                x: ghostBox.left,
                y: ghostBox.top,
                width: ghostBox.width,
                height: ghostBox.height,
              },
            }
          : null;

      const dispatched = store.dispatch(command);
      store.endDrag();

      if (dispatched.ok) {
        const targetName = graph.nodesById.get(command.toParentId)?.name ?? "collection";
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
      {animateMoves && (
        <FlipAnimator containerRef={containerRef} dropOriginRef={dropOriginRef} />
      )}
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
        {itemInstructions ? <> {itemInstructions}</> : null}
      </p>
      {/* Palette items are external drag sources — the card instructions
          above (selection, Alt-moves) don't apply, so they reference this
          one instead of dnd-kit's blanked default. */}
      <p id={paletteInstructionsId} className="sr-only">
        Press Enter to pick up a new item, then use the Arrow keys to choose where it goes and
        Enter to drop it, or Escape to cancel.
      </p>
      <CollectionsDragOverlay
        paletteNodes={palette.paletteNodes}
        ghostScale={dragGhostScale}
        ghostWidth={dragGhostWidth ?? null}
        ghostHeight={dragGhostHeight ?? null}
        ghostRef={ghostRef}
      />
      <LiveAnnouncementRegion channel={announceChannel} />
    </DndContext>
  );
}

function CollectionsDragOverlay({
  paletteNodes,
  ghostScale,
  ghostWidth,
  ghostHeight,
  ghostRef,
}: {
  paletteNodes: readonly CollectionItemNode[] | null;
  ghostScale: number;
  ghostWidth: number | null;
  ghostHeight: number | null;
  /** Receives the ghost's outer element, so a drop can measure where it was. */
  ghostRef: MutableRefObject<HTMLElement | null>;
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

  const ghost = node ? <GhostContent node={node} extraCount={extraCount} /> : null;

  // A fixed ghost width wins over proportional scaling: it's the stronger
  // remedy for the "long clip → giant ghost" problem, so honour it first.
  const wrapped =
    ghostWidth !== null ? (
      <FixedWidthGhost width={ghostWidth} height={ghostHeight} elementRef={ghostRef}>
        {ghost}
      </FixedWidthGhost>
    ) : ghostScale < 1 ? (
      <ScaledGhost scale={ghostScale} elementRef={ghostRef}>
        {ghost}
      </ScaledGhost>
    ) : (
      // Unwrapped, the ghost is consumer pixels with no element of ours to
      // measure — a plain box that fills dnd-kit's overlay (which is sized to
      // the source card) gives the drop the same handle in every variant.
      <div ref={ghostRef as MutableRefObject<HTMLDivElement | null>} className="h-full w-full">
        {ghost}
      </div>
    );

  // `dropAnimation={null}`: dnd-kit's default flies the overlay from the
  // release point BACK to where the drag started (250ms, translate3d), which
  // on a successful drop is the wrong direction entirely — the user watched
  // the ghost travel to a new slot, and it then retreated to the old one
  // while the real card FLIPped forward past it. The two motions crossed.
  // The ghost now simply hands off: it disappears at release and the dropped
  // card animates out of the box it left behind (see FlipDropOrigin).
  return <DragOverlay dropAnimation={null}>{wrapped}</DragOverlay>;
}

/**
 * Shrinks the ghost to `scale`, growing FROM the pixel the pointer grabbed.
 *
 * dnd-kit sizes the DragOverlay to the source card and keeps its top-left
 * pinned to (card top-left + pointer delta). So the pointer sits at a fixed
 * offset inside this box for the whole drag — set that offset as the
 * transform-origin and the grabbed pixel stays under the cursor at any scale,
 * with no positional jump to correct. A first-frame 1→scale transition makes
 * the shrink a motion, not a snap; reduced-motion users get the end state
 * with no animation.
 */
function ScaledGhost({
  scale,
  elementRef,
  children,
}: {
  scale: number;
  elementRef: MutableRefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const { activatorEvent, activeNodeRect } = useDndContext();
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEngaged(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const origin = (() => {
    const point = activatorEvent ? getEventCoordinates(activatorEvent) : null;
    if (!point || !activeNodeRect) return "center";
    // Clamp into the card: a grab exactly on the edge still reads as inside.
    const x = Math.min(Math.max(point.x - activeNodeRect.left, 0), activeNodeRect.width);
    const y = Math.min(Math.max(point.y - activeNodeRect.top, 0), activeNodeRect.height);
    return `${x}px ${y}px`;
  })();

  return (
    <div
      ref={elementRef as MutableRefObject<HTMLDivElement | null>}
      data-drag-ghost-scale={scale}
      style={{
        transformOrigin: origin,
        transform: `scale(${engaged ? scale : 1})`,
        transition: "transform 160ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      className="motion-reduce:transition-none"
    >
      {children}
    </div>
  );
}

/**
 * Renders the ghost at a FIXED `width`, ignoring the source card's width.
 *
 * dnd-kit sizes the DragOverlay box to the source card and pins its top-left to
 * (card top-left + pointer delta), so the pointer holds a constant offset
 * inside the box for the whole drag. A strip card is as wide as its clip is
 * long, so the box — and the old ghost — grew with duration and buried the drop
 * targets. Here the ghost is absolutely positioned inside that box at the fixed
 * width, horizontally centred on the pointer's offset: the compact ghost rides
 * under the cursor with no positional jump, whatever the card's width. Height
 * fills the box (row height is not duration-relative). A first-frame scale-in
 * makes it a motion, not a snap; reduced-motion users get the end state.
 */
function FixedWidthGhost({
  width,
  height,
  elementRef,
  children,
}: {
  width: number;
  height: number | null;
  elementRef: MutableRefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const { activatorEvent, activeNodeRect } = useDndContext();
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEngaged(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // The pointer's offset inside the (card-sized) overlay box. Centre the
  // fixed-size ghost on it so the grabbed pixel stays under the cursor — on x
  // always, and on y too when a fixed height is given (otherwise the ghost
  // fills the box height and pins to its top, as before).
  const point = activatorEvent ? getEventCoordinates(activatorEvent) : null;
  const grabX =
    point && activeNodeRect
      ? Math.min(Math.max(point.x - activeNodeRect.left, 0), activeNodeRect.width)
      : null;
  const left = grabX === null ? 0 : grabX - width / 2;

  const grabY =
    height !== null && point && activeNodeRect
      ? Math.min(Math.max(point.y - activeNodeRect.top, 0), activeNodeRect.height)
      : null;
  const top = height === null ? 0 : grabY === null ? 0 : grabY - height / 2;

  return (
    <div
      ref={elementRef as MutableRefObject<HTMLDivElement | null>}
      data-drag-ghost-width={width}
      data-drag-ghost-height={height ?? undefined}
      style={{
        position: "absolute",
        top,
        left,
        width,
        height: height === null ? "100%" : height,
        transformOrigin: height === null ? `${width / 2}px 0` : `${width / 2}px ${height / 2}px`,
        transform: `scale(${engaged ? 1 : 0.92})`,
        transition: "transform 160ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      className="motion-reduce:transition-none"
    >
      {children}
    </div>
  );
}
