"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { useDroppable } from "@dnd-kit/core";

import { type NodeId } from "../core/graph";
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
  return useCallback(
    (id: NodeId) => {
      if (!scrollToNode(id)) return;
      let attempts = 12;
      const tryFocus = () => {
        const card = scrollRef.current?.querySelector<HTMLElement>(
          `[data-node-id="${CSS.escape(id)}"]`
        );
        if (card) {
          card.focus();
          return;
        }
        if (--attempts > 0) requestAnimationFrame(tryFocus);
      };
      requestAnimationFrame(tryFocus);
    },
    [scrollRef, scrollToNode]
  );
}

/** The empty-collection affordance shared by strip and grid. */
export function VirtualEmptyHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-xs text-muted-foreground select-none">
      Drop items here
    </p>
  );
}
