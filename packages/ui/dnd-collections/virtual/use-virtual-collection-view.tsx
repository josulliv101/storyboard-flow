"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { useDroppable } from "@dnd-kit/core";

import { type NodeId } from "../core/graph";
import { focusNodeWhenMounted, isEditableKeyboardTarget } from "../react/node-dom";
import { VIRTUAL_INSERT_DATA_KEY, type VirtualInsertTarget } from "../react/virtual-droppable";

// Shared plumbing for virtualized collection views (strip + grid): the
// scroll container doubles as the virtualInsert droppable, the content
// spacer anchors boundary math (its live rect absorbs scroll AND padding),
// and focus targeting retries until the virtualizer mounts the card. Views
// keep their own layout math: they publish it into `resolveBoundaryRef`
// from an effect each render, and the droppable's data closure reads it
// lazily at drag time.

export type VirtualViewPoint = Readonly<{ x: number; y: number }>;

export function useVirtualInsertContainer(
  collectionId: NodeId,
  idPrefix: "vstrip" | "vgrid"
): Readonly<{
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  resolveBoundaryRef: RefObject<(point: VirtualViewPoint) => number>;
  setContainerRef: (el: HTMLDivElement | null) => void;
}> {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resolveBoundaryRef = useRef<(point: VirtualViewPoint) => number>(() => 0);

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `${idPrefix}:${collectionId}`,
    data: {
      [VIRTUAL_INSERT_DATA_KEY]: {
        collectionId,
        resolveBoundary: (point) => resolveBoundaryRef.current(point),
      } satisfies VirtualInsertTarget,
    },
  });

  const setContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      setDroppableRef(el);
    },
    [setDroppableRef]
  );

  return { scrollRef, contentRef, resolveBoundaryRef, setContainerRef };
}

/**
 * Publish the view's per-render layout math into the droppable's stable
 * resolver. useLayoutEffect (not useEffect) so the resolver is current before
 * paint — a drag frame landing in the gap between a commit's paint and a
 * passive effect would otherwise resolve the boundary against the PREVIOUS
 * render's math (stale offsets during e.g. an autoscroll-driven relayout).
 */
export function usePublishBoundary(
  resolveBoundaryRef: RefObject<(point: VirtualViewPoint) => number>,
  resolveBoundary: (point: VirtualViewPoint) => number
): void {
  useLayoutEffect(() => {
    resolveBoundaryRef.current = resolveBoundary;
  });
}

/**
 * Focus a node's card: scroll its slot into view (`scrollToNode` returns
 * false when the id isn't in this view), then retry across frames until
 * the virtualizer mounts the card.
 */
export function useFocusNode(
  scrollRef: RefObject<HTMLElement | null>,
  scrollToNode: (id: NodeId) => boolean
): (id: NodeId) => void {
  const pendingFocusRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      pendingFocusRef.current?.();
    },
    []
  );

  return useCallback(
    (id: NodeId) => {
      pendingFocusRef.current?.();
      pendingFocusRef.current = null;
      if (!scrollToNode(id)) return;
      const root = scrollRef.current;
      if (!root) return;
      pendingFocusRef.current = focusNodeWhenMounted(root, id);
    },
    [scrollRef, scrollToNode]
  );
}

/**
 * Roving-focus keyboard navigation for a virtualized view: the container is a
 * single tab stop, and bare arrow keys move focus through the
 * WHOLE collection — scrolling offscreen items into view and focusing them —
 * so a keyboard user can reach item 500 of 1000 that was never in the DOM.
 *
 * Deliberately separate from the two existing arrow uses: Alt+arrow MOVES the
 * item (keyboard controller), and dnd-kit's grabbed-arrows fire only after
 * Enter — so navigation stands down while a drag is live and while Alt/Ctrl/
 * Meta are held. Each view supplies `resolveNextIndex` for its own geometry
 * (1D for the strip, 2D for the grid).
 *
 * The focused node id must track whatever card ACTUALLY has focus, not just the
 * hook's own key handler — otherwise clicking or programmatically focusing a
 * card would leave the internal id stale, and the next arrow would navigate
 * from the wrong place. Views wire `onItemFocus(id)` to each card's focus.
 */
export function useVirtualRovingFocus(args: {
  itemIds: readonly NodeId[];
  indexById: ReadonlyMap<NodeId, number>;
  isDragging: () => boolean;
  /** Scroll the index into view and focus its card once the virtualizer mounts it. */
  focusByIndex: (index: number) => void;
  /** Map a key + current index to the next index, or null to ignore the key. */
  resolveNextIndex: (key: string, current: number, count: number) => number | null;
}): Readonly<{
  focusedIndex: number;
  onKeyDown: (event: ReactKeyboardEvent) => void;
  /** Wire to each card's onFocus so click / programmatic focus updates the roving item. */
  onItemFocus: (id: NodeId) => void;
}> {
  const { itemIds, indexById, isDragging, focusByIndex, resolveNextIndex } = args;
  const [focusedId, setFocusedId] = useState<NodeId | null>(() => itemIds[0] ?? null);
  const focusedIdRef = useRef<NodeId | null>(itemIds[0] ?? null);

  // Single writer for the id: keep the ref (read by the key handler) and the
  // state (drives roving tabindex) in lockstep.
  const setFocused = useCallback((id: NodeId | null) => {
    focusedIdRef.current = id;
    setFocusedId(id);
  }, []);

  // A removal can invalidate the stored id; fall back to a remaining item so
  // the next arrow navigates from a valid base.
  useEffect(() => {
    const current = focusedIdRef.current;
    if (current !== null && indexById.has(current)) return;
    setFocused(itemIds[0] ?? null);
  }, [itemIds, indexById, setFocused]);

  const storedIndex = focusedId === null ? -1 : (indexById.get(focusedId) ?? -1);
  const focusedIndex = storedIndex === -1 ? 0 : storedIndex;

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      // Alt = item move; Ctrl/Meta reserved; during a keyboard drag the sensor
      // owns the arrows.
      if (event.altKey || event.ctrlKey || event.metaKey || isDragging()) return;
      // These are BARE arrows bubbling from anywhere in the view, so an
      // <input> or contenteditable inside a card would have had its caret
      // movement swallowed by roving focus (this handler preventDefaults).
      if (isEditableKeyboardTarget(event.target)) return;
      const count = itemIds.length;
      if (count === 0) return;
      const currentId = focusedIdRef.current;
      const currentIndex = currentId === null ? -1 : (indexById.get(currentId) ?? -1);
      const next = resolveNextIndex(event.key, currentIndex === -1 ? 0 : currentIndex, count);
      if (next === null) return;
      event.preventDefault();
      const clamped = Math.max(0, Math.min(next, count - 1));
      const nextId = itemIds[clamped];
      if (!nextId) return;
      setFocused(nextId);
      focusByIndex(clamped);
    },
    [itemIds, indexById, isDragging, focusByIndex, resolveNextIndex, setFocused]
  );

  return {
    focusedIndex,
    onKeyDown,
    onItemFocus: setFocused,
  };
}

/** The empty-collection affordance shared by strip and grid. aria-hidden: a
 *  bare <p> is not a valid owned child of role="grid" (rows only), and the
 *  emptiness is already conveyed accessibly by the grid's aria-label
 *  ("<name>, 0 items"). */
export function VirtualEmptyHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <p
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-xs text-muted-foreground select-none"
    >
      Drop items here
    </p>
  );
}
