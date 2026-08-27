"use client";

import { memo, useCallback, useRef, type KeyboardEventHandler, type MouseEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { twMerge } from "tailwind-merge";

import { getChildren, mediaDurationSeconds, type NodeId } from "@storyboard/collections-core/graph";
import { encodeDropTarget } from "@storyboard/collections-core/intents";
import { finitePositiveOrUndefined } from "@storyboard/collections-core/numeric";
import {
  useCollectionsComponents,
  type CollectionGhostContentProps,
  type CollectionItemContentComponent,
  type NodeCardDragActivation,
} from "./collections-components";
import { useCollectionsSelector, useCollectionsStore } from "./collections-store";
import { useCollectionsContainer } from "./container-context";
import { DefaultItemContent } from "./default-item-content";
import {
  handleSelectionSurfaceClick,
  useCollectionsInteractionPolicy,
} from "./interaction-policy";
import { roundSecondsForDisplay } from "./duration-format";
import { TrimHandles } from "./trim-handles";

// Default views. Each NodeCard receives ONLY its id (plus identity-stable
// configuration) — every dynamic value arrives through selector
// subscriptions returning primitives (or stable graph references), so a drag
// over one card re-renders that card alone. `memo` + constant props means
// parents mapping stable children arrays don't re-render cards either. The
// data-render-count attribute makes this efficiency claim assertable in
// tests instead of aspirational.
//
// NodeCard is a visually TRANSPARENT interaction shell: it owns behavior and
// geometry (drag/drop wiring, selection, aria, trim handles, indicators,
// the card box) and paints nothing. Pixels come from a content component —
// `DefaultItemContent` unless the consumer registered one (provider
// `components` / per-view `itemContent`) — rendered inside the card button
// with rarely-changing props only, so custom content inherits the whole
// efficiency story.
//
// FLIP movement animation is NOT owned here — it is a provider-level sweep
// (see DndCollections `animateMoves`) so one pass animates panels, virtual,
// and custom views together.

export type { NodeCardDragActivation } from "./collections-components";

export type CollectionPanelsProps = Readonly<{
  /** Which collections to render as top-level panels. Defaults to the graph's roots. */
  collectionIds?: readonly NodeId[];
  /** Per-view card pixels — overrides the provider `components` registry. */
  itemContent?: CollectionItemContentComponent;
}>;

export function CollectionPanels({ collectionIds, itemContent }: CollectionPanelsProps) {
  const rootIds = useCollectionsSelector((s) => s.graph.rootIds);
  const panelIds = collectionIds ?? rootIds;
  return (
    <div className="flex flex-col gap-6">
      {panelIds.map((id) => (
        <CollectionPanel key={id} collectionId={id} itemContent={itemContent} />
      ))}
    </div>
  );
}

export function CollectionPanel({
  collectionId,
  itemContent,
}: {
  collectionId: NodeId;
  /** Per-view card pixels — overrides the provider `components` registry. */
  itemContent?: CollectionItemContentComponent;
}) {
  const name = useCollectionsSelector(
    (s) => s.graph.nodesById.get(collectionId)?.name ?? String(collectionId)
  );
  // Stable array reference: the reducer only re-allocates children arrays of
  // collections a patch actually touched.
  const childIds = useCollectionsSelector((s) => getChildren(s.graph, collectionId));
  const panelDropState = useCollectionsSelector((s) => {
    const intent = s.interaction.dropIntent;
    if (intent?.type !== "append-to-collection" || intent.collectionId !== collectionId) {
      return "none";
    }
    return s.interaction.dropIntentInvalid ? "invalid" : "valid";
  });

  const { setNodeRef, isOver } = useDroppable({
    id: encodeDropTarget({ type: "panel", collectionId }),
  });
  void isOver; // drop styling keys off the resolved intent, not raw hover

  return (
    <section
      aria-label={name}
      data-panel-id={collectionId}
      className="rounded-lg border bg-card p-3"
    >
      <h3 className="mb-2 text-sm font-semibold text-foreground">{name}</h3>
      <div
        ref={setNodeRef}
        data-panel-droppable={collectionId}
        className={[
          "flex min-h-28 flex-row flex-wrap items-stretch gap-2 rounded-md border border-dashed p-2 transition-colors",
          panelDropState === "valid" ? "border-primary bg-primary/5" : "",
          panelDropState === "invalid" ? "border-destructive bg-destructive/5" : "",
          panelDropState === "none" ? "border-border" : "",
        ].join(" ")}
      >
        {childIds.length === 0 ? (
          <p className="self-center px-2 text-xs text-muted-foreground select-none">
            Drop items here
          </p>
        ) : (
          childIds.map((id) => <NodeCard key={id} id={id} itemContent={itemContent} />)
        )}
      </div>
    </section>
  );
}

function joinAriaIds(...ids: readonly (string | undefined)[]): string | undefined {
  const joined = ids.filter((id): id is string => !!id).join(" ");
  return joined || undefined;
}

export const NodeCard = memo(function NodeCard({
  id,
  className,
  dragActivation = "body",
  rovingTabIndex,
  trimPixelsPerSecond,
  itemContent,
}: {
  id: NodeId;
  /**
   * Merged (tailwind-merge) onto BOTH the wrapper and the card button, so
   * sizing overrides beat the h-24/w-32 defaults — virtualized views pass
   * "h-full w-full" to make cards fill their (possibly variable) slot.
   */
  className?: string;
  /**
   * Per-card pixels — overrides the provider `components` registry, falls
   * back to `DefaultItemContent`. MUST be identity-stable (module scope): a
   * new component type per render remounts the content subtree.
   */
  itemContent?: CollectionItemContentComponent;
  /**
   * How item drags start on this card:
   * - "body" (default): instant drag from anywhere on the card.
   * - "handle": a full-width grip bar across the top is the only drag
   *   activator; the body is free for surface gestures (strip panning).
   * - "hold": press-and-hold the body to drag (HoldPointerSensor); fast
   *   movement is handed to surface gestures instead.
   * In every mode the draggable NODE stays the card button, so drag
   * ghosts remain card-sized, and body clicks still select.
   */
  dragActivation?: NodeCardDragActivation;
  /**
   * Roving-tabindex value (0 or -1) for virtualized views: the container is
   * ONE tab stop and arrow keys rove between items, so exactly one mounted
   * card is `0` at a time and the rest are `-1`. When set, the grip (handle
   * mode) is also demoted to `-1` so the card button is the sole keyboard
   * stop — pointer grip-drag still works; keyboard drag uses the Alt-key
   * moves. Undefined (panels) keeps each card an independent tab stop.
   */
  rovingTabIndex?: number;
  /**
   * Enable media trim handles at the card edges, using this many pixels per
   * second to convert the drag (match the view's timeline scale — the same
   * `pixelsPerSecond` its `itemWidthFor` uses). Right handle on all media
   * (sets image duration / video trim-out); left handle on video (trim-in).
   * Omitted = no handles.
   */
  trimPixelsPerSecond?: number;
}) {
  const dragHandle = dragActivation === "handle";
  const trimScale = finitePositiveOrUndefined(trimPixelsPerSecond);
  const store = useCollectionsStore();
  const { instructionsId } = useCollectionsContainer();
  // Pixels: per-card override → provider registry → the stock look.
  // (Hook called unconditionally — `??` would skip it and break hook order.)
  const registeredContent = useCollectionsComponents().ItemContent;
  const ItemContent = itemContent ?? registeredContent ?? DefaultItemContent;

  // nodesById is never re-allocated by move patches, so this reference is
  // stable across drags — the selector only "changes" if the node itself does.
  const node = useCollectionsSelector((s) => s.graph.nodesById.get(id) ?? null);
  const childCount = useCollectionsSelector((s) =>
    s.graph.nodesById.get(id)?.kind === "collection" ? getChildren(s.graph, id).length : 0
  );
  const isSelected = useCollectionsSelector((s) => s.interaction.selectedIds.has(id));
  const isDragSource = useCollectionsSelector((s) => s.interaction.activeIdSet.has(id));
  const isRejected = useCollectionsSelector((s) => s.interaction.rejectedIdSet.has(id));
  const dropSide = useCollectionsSelector((s) => {
    const intent = s.interaction.dropIntent;
    return intent?.type === "insert-adjacent" && intent.targetId === id ? intent.side : null;
  });
  const nestState = useCollectionsSelector((s) => {
    const intent = s.interaction.dropIntent;
    if (intent?.type !== "nest-inside" || intent.collectionId !== id) return "none";
    return s.interaction.dropIntentInvalid ? "invalid" : "valid";
  });

  // Render-count probe: makes "uninvolved cards don't re-render during a
  // drag" a hard assertion in the interaction tests, not a hope.
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const dndId = encodeDropTarget({ type: "node", nodeId: id });
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({ id: dndId });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: dndId });

  // In handle mode the grip owns POINTER drags (the body stays free for
  // surface gestures), but the KEYBOARD grab must live on the card button:
  // it is the only tab stop in roving virtual views (the grip is demoted to
  // -1), and the instructions element promises "Press Enter to pick it up"
  // on every card. Attach just the KeyboardSensor activator — dnd-kit's
  // Enter handler preventDefaults on activation, so it never doubles as a
  // selection click. (One localized cast: dnd-kit types its listener map as
  // Record<string, Function>, erasing the signature — the KeyboardSensor
  // activator is a keydown handler.)
  const bodyListeners = dragHandle
    ? listeners && {
        onKeyDown: listeners.onKeyDown as KeyboardEventHandler<HTMLButtonElement>,
      }
    : listeners;

  const setRefs = useCallback(
    (element: HTMLElement | null) => {
      setDraggableRef(element);
      setDroppableRef(element);
    },
    [setDraggableRef, setDroppableRef]
  );

  const interactionPolicy = useCollectionsInteractionPolicy();
  const handleClick = useCallback(
    (event: MouseEvent) => {
      // The selector above returns null only for a removed node — in which
      // case this card is unmounting and no click can arrive; the guard is
      // for the type.
      const current = store.getSnapshot().graph.nodesById.get(id);
      if (!current) return;
      handleSelectionSurfaceClick({
        event,
        id,
        node: current,
        store,
        policy: interactionPolicy,
      });
    },
    [store, id, interactionPolicy]
  );

  if (!node) return null;

  const isCollection = node.kind === "collection";
  // Selection-gated trims: with `trimRequiresSelection`, handles (and the
  // content's trimEnabled flag) exist only on the selected card — an
  // unselected card's edges are plain card body.
  const trimActive =
    trimScale !== undefined &&
    node.kind === "media" &&
    (!interactionPolicy.trimRequiresSelection || isSelected);

  return (
    <div className={twMerge("group relative", className)} data-node-wrapper={id}>
      {/* The transparent interaction shell: sizing, cursor, focus, wiring,
          and state attributes — ZERO paint. All visible pixels (border,
          background, rings, dimming, content) belong to ItemContent. */}
      <button
        type="button"
        ref={setRefs}
        data-node-id={id}
        data-node-kind={node.kind}
        data-render-count={renderCountRef.current}
        {...(isSelected ? { "data-selected": "true" } : {})}
        {...(isRejected ? { "data-rejected": "true" } : {})}
        aria-label={`${node.name}${isCollection ? ` (collection, ${childCount} items)` : ""}`}
        onClick={handleClick}
        className={twMerge(
          [
            "flex h-24 w-32 select-none",
            dragHandle ? "" : "cursor-grab active:cursor-grabbing",
          ].join(" "),
          className
        )}
        {...(dragActivation === "hold" ? { "data-drag-activation": "hold" } : {})}
        {...(dragHandle ? {} : attributes)}
        {...bodyListeners}
        // After dnd-kit's attribute spread: dnd-kit sets aria-pressed for its
        // grabbed state; here the pressed semantic is SELECTION (and the drag
        // state is conveyed by the overlay + dimming instead).
        aria-pressed={isSelected}
        // The card button is ALWAYS a keyboard tab stop, even in handle mode:
        // it is the selection control (Space) and the anchor for Alt-key
        // moves, so keyboard users must be able to reach it. (Previously
        // handle mode gave it tabIndex -1 to keep a single stop per card,
        // which left keyboard users unable to select at all.) In handle mode
        // the grip is a second stop that carries the dnd-kit grab-drag.
        aria-describedby={
          joinAriaIds(dragHandle ? undefined : attributes["aria-describedby"], instructionsId)
        }
        // Roving tabindex (virtual views) overrides dnd-kit's tabIndex from
        // the attribute spread above — must come after it.
        {...(rovingTabIndex !== undefined ? { tabIndex: rovingTabIndex } : {})}
      >
        <ItemContent
          id={id}
          node={node}
          childCount={childCount}
          selected={isSelected}
          rejected={isRejected}
          // dnd-kit's isDragging covers the sub-frame gap between sensor
          // activation and onDragStart publishing the store's drag set.
          isDragSource={isDragging || isDragSource}
          dragActivation={dragActivation}
          trimEnabled={trimActive}
        />
      </button>

      {/* Grip bar: THE drag activator when dragHandle is on — listeners and
          dnd-kit's aria attributes live here (keyboard grab included; the
          Alt-key layer resolves the id via the data-node-wrapper host). */}
      {dragHandle && (
        <button
          type="button"
          data-drag-handle={id}
          className="absolute inset-x-0 top-0 z-10 flex h-[18px] cursor-grab items-center justify-center rounded-t-md border-b border-border bg-muted/70 text-[10px] leading-none text-muted-foreground select-none active:cursor-grabbing"
          style={{ touchAction: "none" }}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${node.name}`}
          aria-describedby={joinAriaIds(attributes["aria-describedby"], instructionsId)}
          // In a roving (virtual) view the card button is the sole tab stop;
          // keep the grip a pointer-only drag surface.
          {...(rovingTabIndex !== undefined ? { tabIndex: -1 } : {})}
        >
          ⠿
        </button>
      )}

      {trimActive && trimScale !== undefined && node.kind === "media" && (
        <TrimHandles node={node} pixelsPerSecond={trimScale} selected={isSelected} />
      )}

      <NodeCardIndicators nestState={nestState} dropSide={dropSide} />
    </div>
  );
});

/** Presentational drop-preview overlays: nest highlight + before/after bars.
 *  Shared by NodeCard and CollectionItem.DropIndicators (not exported from
 *  the package index — the compound primitive is the public seam). */
export function NodeCardIndicators({
  nestState,
  dropSide,
}: {
  nestState: "none" | "valid" | "invalid";
  dropSide: "before" | "after" | null;
}) {
  return (
    <>
      {/* Nest highlight: full-card overlay while this collection is the live nest target. */}
      {nestState !== "none" && (
        <div
          data-nest-state={nestState}
          className={[
            "pointer-events-none absolute inset-0 z-10 flex items-end justify-center rounded-md border-2 px-2 pb-2 text-xs font-bold",
            nestState === "valid"
              ? "border-primary bg-muted/70 text-foreground backdrop-blur-[2px]"
              : "border-destructive bg-destructive/20 text-destructive backdrop-blur-[1px]",
          ].join(" ")}
        >
          <span
            className={[
              "rounded-md bg-background/95 px-2 py-1 shadow-lg ring-1",
              nestState === "valid" ? "ring-primary/60" : "ring-destructive/50",
            ].join(" ")}
          >
            {nestState === "valid" ? "Drop to nest" : "Cannot drop (cycle)"}
          </span>
        </div>
      )}

      {/* Before/after drop indicator bars.

          Each bar backs out by half a gap so it lands in the MIDDLE of the gap
          it marks. The two sides read their own variable because a card's two
          gaps are not always the same: the first card in a strip (and the first
          in every grid row) has no space to its left to centre in, and pulling
          the bar out there would put it under the container's padding, where
          the scroll box clips it. That edge case belongs to the BEFORE side
          only — zeroing both, as one shared variable forced, left the bar
          jammed against the card on the side that did have a gap. Both fall
          back to the old single variable, then to half of the default gap. */}
      {dropSide === "before" && (
        <div
          aria-hidden="true"
          data-drop-indicator="before"
          className="pointer-events-none absolute inset-y-0 z-20 w-1 -translate-x-1/2 rounded-full bg-primary"
          style={{
            left: "calc(-1 * var(--dnd-drop-indicator-half-gap-before, var(--dnd-drop-indicator-half-gap, 4px)))",
          }}
        />
      )}
      {dropSide === "after" && (
        <div
          aria-hidden="true"
          data-drop-indicator="after"
          className="pointer-events-none absolute inset-y-0 z-20 w-1 translate-x-1/2 rounded-full bg-primary"
          style={{
            right: "calc(-1 * var(--dnd-drop-indicator-half-gap-after, var(--dnd-drop-indicator-half-gap, 4px)))",
          }}
        />
      )}
    </>
  );
}

/** Drag-overlay ghost: the primary card plus a "+N" badge for multi-drag.
 *  The stock `GhostContent` — consumers replace it via the provider
 *  `components` registry. */
export function NodeCardGhost({ node, extraCount }: CollectionGhostContentProps) {
  return (
    <div
      data-testid="drag-ghost"
      // Fill the DragOverlay wrapper: dnd-kit sizes it to the dragged
      // element's measured rect, so the ghost matches the card's real
      // display width — fixed OR variable (virtual strips).
      className="relative flex h-full w-full cursor-grabbing flex-col items-stretch justify-between rounded-md border border-primary bg-card p-2 text-left text-xs opacity-90 shadow-2xl select-none"
    >
      <span className="truncate font-medium text-foreground">{node.name}</span>
      <span className="text-[10px] text-muted-foreground">
        {node.kind === "collection"
          ? "Collection"
          : `${roundSecondsForDisplay(mediaDurationSeconds(node))}s`}
      </span>
      {extraCount > 0 && (
        <span
          data-testid="drag-ghost-count"
          className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground shadow"
        >
          +{extraCount}
        </span>
      )}
    </div>
  );
}
