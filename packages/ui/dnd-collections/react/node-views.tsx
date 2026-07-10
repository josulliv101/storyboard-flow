"use client";

import { memo, useCallback, useRef, type CSSProperties, type MouseEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { getChildren, type CollectionItemNode, type NodeId } from "../core/graph";
import { encodeDropTarget } from "../core/intents";
import { useCollectionsSelector, useCollectionsStore } from "./collections-store";
import { useFlipGraphAnimation } from "./use-flip-graph-animation";

// Default views. Each NodeCard receives ONLY its id — every dynamic value
// arrives through selector subscriptions returning primitives (or stable
// graph references), so a drag over one card re-renders that card alone.
// `memo` + constant props means parents mapping stable children arrays
// don't re-render cards either. The data-render-count attribute makes this
// efficiency claim assertable in tests instead of aspirational.

export type CollectionPanelsProps = Readonly<{
  /** Which collections to render as top-level panels. Defaults to the graph's roots. */
  collectionIds?: readonly NodeId[];
  /** Post-commit FLIP movement animation (drop/undo/redo). Default on; honors prefers-reduced-motion. */
  animateMoves?: boolean;
}>;

export function CollectionPanels({ collectionIds, animateMoves = true }: CollectionPanelsProps) {
  const rootIds = useCollectionsSelector((s) => s.graph.rootIds);
  const panelIds = collectionIds ?? rootIds;
  return (
    <div className="flex flex-col gap-6">
      {animateMoves && <FlipAnimator />}
      {panelIds.map((id) => (
        <CollectionPanel key={id} collectionId={id} />
      ))}
    </div>
  );
}

/**
 * Rendered as a child so the graph subscription that drives the FLIP sweep
 * re-renders THIS empty component per commit, not the panel list itself.
 * Measures across the whole document (cards may live in sibling panels).
 */
function FlipAnimator() {
  const documentRef = useRef<HTMLElement | null>(null);
  const setProbe = useCallback((el: HTMLElement | null) => {
    documentRef.current = el ? (el.ownerDocument.body as HTMLElement) : null;
  }, []);
  useFlipGraphAnimation(documentRef);
  return <span ref={setProbe} hidden />;
}

export function CollectionPanel({ collectionId }: { collectionId: NodeId }) {
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
          childIds.map((id) => <NodeCard key={id} id={id} />)
        )}
      </div>
    </section>
  );
}

export const NodeCard = memo(function NodeCard({ id }: { id: NodeId }) {
  const store = useCollectionsStore();

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

  const setRefs = useCallback(
    (element: HTMLElement | null) => {
      setDraggableRef(element);
      setDroppableRef(element);
    },
    [setDraggableRef, setDroppableRef]
  );

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey) store.toggleSelected(id);
      else store.setSelection([id]);
    },
    [store, id]
  );

  if (!node) return null;

  const isCollection = node.kind === "collection";
  const style: CSSProperties | undefined =
    isDragging || isDragSource ? { opacity: 0.4 } : undefined;

  return (
    <div className="relative" data-node-wrapper={id}>
      <button
        type="button"
        ref={setRefs}
        style={style}
        data-node-id={id}
        data-node-kind={node.kind}
        data-render-count={renderCountRef.current}
        {...(isSelected ? { "data-selected": "true" } : {})}
        {...(isRejected ? { "data-rejected": "true" } : {})}
        aria-label={`${node.name}${isCollection ? ` (collection, ${childCount} items)` : ""}`}
        onClick={handleClick}
        className={[
          "flex h-24 w-32 cursor-grab flex-col items-stretch justify-between rounded-md border p-2 text-left text-xs transition-all select-none active:cursor-grabbing",
          isCollection ? "bg-muted/60" : "bg-background",
          isSelected ? "border-primary ring-2 ring-primary" : "border-border",
          isRejected ? "border-destructive ring-2 ring-destructive animate-pulse" : "",
        ].join(" ")}
        {...attributes}
        {...listeners}
        // After dnd-kit's attribute spread: dnd-kit sets aria-pressed for its
        // grabbed state; here the pressed semantic is SELECTION (and the drag
        // state is conveyed by the overlay + dimming instead).
        aria-pressed={isSelected}
      >
        <span className="truncate font-medium text-foreground">{node.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {isCollection ? `Collection · ${childCount} items` : `${node.durationSeconds}s`}
        </span>
      </button>

      {/* Nest highlight: full-card overlay while this collection is the live nest target. */}
      {nestState !== "none" && (
        <div
          data-nest-state={nestState}
          className={[
            "pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 text-[10px] font-bold",
            nestState === "valid"
              ? "border-primary bg-primary/15 text-primary"
              : "border-destructive bg-destructive/15 text-destructive",
          ].join(" ")}
        >
          <span className="rounded bg-background/95 px-1.5 py-0.5 shadow">
            {nestState === "valid" ? "Drop to nest" : "Cannot drop (cycle)"}
          </span>
        </div>
      )}

      {/* Before/after drop indicator bars. */}
      {dropSide === "before" && (
        <div
          aria-hidden="true"
          data-drop-indicator="before"
          className="pointer-events-none absolute inset-y-0 -left-1.5 z-20 w-1 rounded-full bg-primary"
        />
      )}
      {dropSide === "after" && (
        <div
          aria-hidden="true"
          data-drop-indicator="after"
          className="pointer-events-none absolute inset-y-0 -right-1.5 z-20 w-1 rounded-full bg-primary"
        />
      )}
    </div>
  );
});

/** Drag-overlay ghost: the primary card plus a "+N" badge for multi-drag. */
export function NodeCardGhost({
  node,
  extraCount,
}: {
  node: CollectionItemNode;
  extraCount: number;
}) {
  return (
    <div
      data-testid="drag-ghost"
      className="relative flex h-24 w-32 cursor-grabbing flex-col items-stretch justify-between rounded-md border border-primary bg-card p-2 text-left text-xs opacity-90 shadow-2xl select-none"
    >
      <span className="truncate font-medium text-foreground">{node.name}</span>
      <span className="text-[10px] text-muted-foreground">
        {node.kind === "collection" ? "Collection" : `${node.durationSeconds}s`}
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
