"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type KeyboardEventHandler,
  type MouseEvent,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useDraggable, useDroppable, type DraggableAttributes } from "@dnd-kit/core";
import { twMerge } from "tailwind-merge";

import {
  getChildren,
  type CollectionItemNode,
  type MediaNode,
  type NodeId,
} from "../core/graph";
import { encodeDropTarget } from "../core/intents";
import { finitePositiveOrUndefined } from "../core/numeric";
import { useCollectionsSelector, useCollectionsStore } from "./collections-store";
import { useCollectionsContainer } from "./container-context";
import {
  handleSelectionSurfaceClick,
  useCollectionsInteractionPolicy,
} from "./interaction-policy";
import { NodeCardIndicators } from "./node-views";
import { resolveTrim, useTrimPointerDrag, type TrimSide } from "./trim-gesture";

// Compound primitives: the FULL-custom escape hatch for items whose DOM
// composition NodeCard's content slot can't express — interactive controls
// inside the card, a grip placed anywhere, trim handles embedded in custom
// chrome. Behavior stays package-owned and is delivered through context (no
// raw refs or listener bags to mis-spread); consumers own every pixel AND
// the DOM shape:
//
//   <CollectionItem.Root id={id} trimPixelsPerSecond={24}>
//     <CollectionItem.SelectionSurface>…visible card…</CollectionItem.SelectionSurface>
//     <button onClick={mute}>M</button>                 // consumer control: no select, no drag
//     <CollectionItem.DragHandle>⠿</CollectionItem.DragHandle>
//     <CollectionItem.TrimHandle side="right" />
//     <CollectionItem.DropIndicators />
//   </CollectionItem.Root>
//
// Invariants the primitives uphold so consumers don't have to: the Root is
// the draggable node AND droppable (ghost/collision rects = the whole item);
// `data-node-id` lives on the focusable SelectionSurface (FLIP, keyboard
// delegation, roving focus, and e2e all key off it); the keyboard grab
// (Enter) lives there too; the DragHandle is a pointer-only affordance; trim
// handles are pointer-only siblings of the selection button carrying
// `data-trim-handle` (the strip's pan filter skips them). The efficiency
// story holds: Root subscribes through the same narrow selectors as
// NodeCard, so a drag over one item re-renders that item alone.

type CollectionItemContextValue = Readonly<{
  id: NodeId;
  node: CollectionItemNode;
  childCount: number;
  selected: boolean;
  rejected: boolean;
  isDragSource: boolean;
  dropSide: "before" | "after" | null;
  nestState: "none" | "valid" | "invalid";
  trimPixelsPerSecond: number | undefined;
  rovingTabIndex: number | undefined;
  select: (event: MouseEvent) => void;
  // dnd-kit wiring, consumed only by the primitives — not part of the
  // public state hook.
  attributes: DraggableAttributes;
  listeners: Record<string, unknown> | undefined;
}>;

const CollectionItemContext = createContext<CollectionItemContextValue | null>(null);

function useCollectionItemContext(component: string): CollectionItemContextValue {
  const value = useContext(CollectionItemContext);
  if (!value) {
    throw new Error(`CollectionItem.${component} must be rendered inside CollectionItem.Root`);
  }
  return value;
}

/** The item's live state, for drawing fully custom indicators/chrome. */
export type CollectionItemState = Readonly<{
  id: NodeId;
  node: CollectionItemNode;
  childCount: number;
  selected: boolean;
  rejected: boolean;
  isDragSource: boolean;
  dropSide: "before" | "after" | null;
  nestState: "none" | "valid" | "invalid";
}>;

export function useCollectionItemState(): CollectionItemState {
  const ctx = useCollectionItemContext("useCollectionItemState");
  return useMemo(
    () => ({
      id: ctx.id,
      node: ctx.node,
      childCount: ctx.childCount,
      selected: ctx.selected,
      rejected: ctx.rejected,
      isDragSource: ctx.isDragSource,
      dropSide: ctx.dropSide,
      nestState: ctx.nestState,
    }),
    [ctx]
  );
}

function joinAriaIds(...ids: readonly (string | undefined)[]): string | undefined {
  const joined = ids.filter((id): id is string => !!id).join(" ");
  return joined || undefined;
}

const Root = memo(function CollectionItemRoot({
  id,
  className,
  trimPixelsPerSecond,
  rovingTabIndex,
  children,
}: {
  id: NodeId;
  /** Merged onto the root div (position: relative host for your layout). */
  className?: string;
  /** Enables TrimHandle children at this timeline scale (px per second). */
  trimPixelsPerSecond?: number;
  /** Single-tab-stop roving value (0 or -1) for custom virtualized views. */
  rovingTabIndex?: number;
  children: ReactNode;
}) {
  const store = useCollectionsStore();
  const trimScale = finitePositiveOrUndefined(trimPixelsPerSecond);

  // The same narrow subscriptions NodeCard uses — this is what keeps the
  // no-bystander-re-render guarantee intact for compound items.
  const node = useCollectionsSelector((s) => s.graph.nodesById.get(id) ?? null);
  const childCount = useCollectionsSelector((s) =>
    s.graph.nodesById.get(id)?.kind === "collection" ? getChildren(s.graph, id).length : 0
  );
  const selected = useCollectionsSelector((s) => s.interaction.selectedIds.has(id));
  const isDragSource = useCollectionsSelector((s) => s.interaction.activeIdSet.has(id));
  const rejected = useCollectionsSelector((s) => s.interaction.rejectedIdSet.has(id));
  const dropSide = useCollectionsSelector((s) => {
    const intent = s.interaction.dropIntent;
    return intent?.type === "insert-adjacent" && intent.targetId === id ? intent.side : null;
  });
  const nestState = useCollectionsSelector((s) => {
    const intent = s.interaction.dropIntent;
    if (intent?.type !== "nest-inside" || intent.collectionId !== id) return "none";
    return s.interaction.dropIntentInvalid ? "invalid" : "valid";
  });

  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const dndId = encodeDropTarget({ type: "node", nodeId: id });
  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
    id: dndId,
  });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: dndId });
  const setRefs = useCallback(
    (element: HTMLElement | null) => {
      setDraggableRef(element);
      setDroppableRef(element);
    },
    [setDraggableRef, setDroppableRef]
  );

  const interactionPolicy = useCollectionsInteractionPolicy();
  const select = useCallback(
    (event: MouseEvent) => {
      // Same click grammar as NodeCard — one policy for both shells.
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

  const dragSource = isDragging || isDragSource;
  const value = useMemo<CollectionItemContextValue | null>(
    () =>
      node === null
        ? null
        : {
            id,
            node,
            childCount,
            selected,
            rejected,
            isDragSource: dragSource,
            dropSide,
            nestState,
            trimPixelsPerSecond: trimScale,
            rovingTabIndex,
            select,
            attributes,
            listeners,
          },
    [
      id,
      node,
      childCount,
      selected,
      rejected,
      dragSource,
      dropSide,
      nestState,
      trimScale,
      rovingTabIndex,
      select,
      attributes,
      listeners,
    ]
  );

  if (!node || !value) return null;

  return (
    <CollectionItemContext.Provider value={value}>
      <div
        ref={setRefs}
        data-node-wrapper={id}
        data-render-count={renderCountRef.current}
        className={twMerge("group relative", className)}
      >
        {children}
      </div>
    </CollectionItemContext.Provider>
  );
});

const SelectionSurface = memo(function CollectionItemSelectionSurface({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const ctx = useCollectionItemContext("SelectionSurface");
  const { instructionsId } = useCollectionsContainer();
  const isCollection = ctx.node.kind === "collection";
  return (
    <button
      type="button"
      data-node-id={ctx.id}
      data-node-kind={ctx.node.kind}
      {...(ctx.selected ? { "data-selected": "true" } : {})}
      {...(ctx.rejected ? { "data-rejected": "true" } : {})}
      aria-label={`${ctx.node.name}${isCollection ? ` (collection, ${ctx.childCount} items)` : ""}`}
      aria-pressed={ctx.selected}
      aria-describedby={joinAriaIds(instructionsId)}
      onClick={ctx.select}
      // The KEYBOARD grab (Enter) always lives on the selection button — the
      // one guaranteed tab stop — matching NodeCard's grammar. (Localized
      // cast: dnd-kit types its listener map as Record<string, Function>.)
      onKeyDown={ctx.listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined}
      {...(ctx.rovingTabIndex !== undefined ? { tabIndex: ctx.rovingTabIndex } : {})}
      className={twMerge("select-none text-left", className)}
    >
      {children}
    </button>
  );
});

const DragHandle = memo(function CollectionItemDragHandle({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const ctx = useCollectionItemContext("DragHandle");
  return (
    <span
      // Pointer-only affordance: keyboard grab lives on SelectionSurface, so
      // this never becomes a redundant tab stop. data-drag-handle keeps the
      // strip's pan-surface filter treating it as drag territory.
      aria-hidden="true"
      data-drag-handle={ctx.id}
      style={{ touchAction: "none" }}
      onPointerDown={ctx.listeners?.onPointerDown as PointerEventHandler<HTMLSpanElement> | undefined}
      className={twMerge("cursor-grab select-none active:cursor-grabbing", className)}
    >
      {children}
    </span>
  );
});

const TrimHandle = memo(function CollectionItemTrimHandle({
  side,
  children,
  className,
}: {
  side: TrimSide;
  children?: ReactNode;
  className?: string;
}) {
  const ctx = useCollectionItemContext("TrimHandle");
  const interactionPolicy = useCollectionsInteractionPolicy();
  // Hooks run unconditionally; the render below bails for non-trimmable
  // configurations. The cast is safe: beginDrag is only reachable from a
  // rendered handle, which requires a media node.
  const beginDrag = useTrimPointerDrag(ctx.node as MediaNode);
  const trimScale = ctx.trimPixelsPerSecond;
  const node = ctx.node;

  const onPointerDown = useCallback(
    (event: Parameters<typeof beginDrag>[0]) => {
      if (node.kind !== "media" || trimScale === undefined) return;
      beginDrag(event, trimScale, (deltaSeconds) =>
        resolveTrim(node, side, deltaSeconds)
      );
    },
    [beginDrag, node, trimScale, side]
  );

  if (
    node.kind !== "media" ||
    trimScale === undefined ||
    (side === "left" && node.mediaKind !== "video") ||
    // Selection-gated trims: the handle (hit zone included) exists only on
    // the selected item — same policy as NodeCard's stock handles.
    (interactionPolicy.trimRequiresSelection && !ctx.selected)
  ) {
    return null;
  }

  return (
    <div
      data-trim-handle={side}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      // Default hit-zone geometry mirrors the stock handles; override via
      // className. Pixels come from children.
      className={twMerge(
        `absolute inset-y-0 z-20 w-2 cursor-ew-resize ${side === "left" ? "left-0" : "right-0"}`,
        className
      )}
    >
      {children}
    </div>
  );
});

function DropIndicators() {
  const ctx = useCollectionItemContext("DropIndicators");
  return <NodeCardIndicators nestState={ctx.nestState} dropSide={ctx.dropSide} />;
}

/**
 * The compound-item namespace. All primitives must render inside `Root`;
 * everything else about the DOM shape is yours.
 */
export const CollectionItem = {
  Root,
  SelectionSurface,
  DragHandle,
  TrimHandle,
  DropIndicators,
} as const;
