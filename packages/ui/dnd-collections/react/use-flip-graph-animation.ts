"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useCollectionsSelector, useCollectionsStore } from "./collections-store";

// Post-commit FLIP animation, as its own layer above the reducer: it
// visualizes graph changes and never decides them. A provider-level DOM sweep
// also catches displaced siblings whose selector slices did not change.

const FLIP_DURATION_MS = 180;
const FLIP_EASING = "cubic-bezier(0.2, 0, 0, 1)";

type Point = Readonly<{ x: number; y: number }>;
type CardRect = Readonly<{ card: HTMLElement; nodeId: string; point: Point }>;

function measureCards(container: HTMLElement): CardRect[] {
  const rects: CardRect[] = [];
  for (const idElement of container.querySelectorAll<HTMLElement>("[data-node-id]")) {
    const nodeId = idElement.dataset.nodeId;
    if (!nodeId) continue;
    // Animate the WHOLE item, not just the element carrying the id: both
    // NodeCard and CollectionItem.Root put `data-node-id` on the focusable
    // selection button, whose SIBLINGS (grip bar, trim handles, consumer
    // controls in compound items, indicators) live in the `data-node-wrapper`
    // host — translating only the button would teleport everything else to
    // the final position while the button glides. Identity stays keyed by
    // the id element; custom views without a wrapper animate the id element
    // itself, preserving the documented contract.
    const card = idElement.closest<HTMLElement>("[data-node-wrapper]") ?? idElement;
    const rect = card.getBoundingClientRect();
    rects.push({ card, nodeId, point: { x: rect.left, y: rect.top } });
  }
  return rects;
}

/**
 * Pair current cards with their pre-commit positions without conflating two
 * views that render the same node. A surviving element is always
 * unambiguous. If React recreated an element during a cross-parent move, use
 * node identity only when exactly one unmatched instance exists on each side.
 */
function matchBeforeRects(
  before: readonly CardRect[],
  after: readonly CardRect[]
): ReadonlyMap<HTMLElement, Point> {
  const beforeByElement = new Map(before.map((rect) => [rect.card, rect]));
  const matchedBefore = new Set<HTMLElement>();
  const matches = new Map<HTMLElement, Point>();
  const unmatchedAfterById = new Map<string, CardRect[]>();

  for (const rect of after) {
    const exact = beforeByElement.get(rect.card);
    if (exact) {
      matchedBefore.add(exact.card);
      matches.set(rect.card, exact.point);
      continue;
    }
    const candidates = unmatchedAfterById.get(rect.nodeId) ?? [];
    candidates.push(rect);
    unmatchedAfterById.set(rect.nodeId, candidates);
  }

  const unmatchedBeforeById = new Map<string, CardRect[]>();
  for (const rect of before) {
    if (matchedBefore.has(rect.card)) continue;
    const candidates = unmatchedBeforeById.get(rect.nodeId) ?? [];
    candidates.push(rect);
    unmatchedBeforeById.set(rect.nodeId, candidates);
  }

  for (const [nodeId, afterCandidates] of unmatchedAfterById) {
    const beforeCandidates = unmatchedBeforeById.get(nodeId);
    if (beforeCandidates?.length === 1 && afterCandidates.length === 1) {
      matches.set(afterCandidates[0].card, beforeCandidates[0].point);
    }
  }

  return matches;
}

function cancelAnimations(animations: Set<Animation>): void {
  for (const animation of animations) animation.cancel();
  animations.clear();
}

export function useFlipGraphAnimation(containerRef: RefObject<HTMLElement | null>): void {
  const store = useCollectionsStore();
  const graph = useCollectionsSelector((state) => state.graph);
  const firstRects = useRef<readonly CardRect[] | null>(null);
  const animationsRef = useRef(new Set<Animation>());

  useEffect(
    () => () => {
      cancelAnimations(animationsRef.current);
    },
    []
  );

  // Capture FIRST synchronously from the store notification, before React
  // renders the committed graph. Interaction-only notifications are ignored.
  useEffect(() => {
    let lastGraph = store.getSnapshot().graph;
    return store.subscribe(() => {
      const nextGraph = store.getSnapshot().graph;
      if (nextGraph === lastGraph) return;
      lastGraph = nextGraph;
      const container = containerRef.current;
      firstRects.current = container ? measureCards(container) : null;
    });
  }, [store, containerRef]);

  useLayoutEffect(() => {
    cancelAnimations(animationsRef.current);

    const container = containerRef.current;
    if (!container) return;

    const first = firstRects.current;
    firstRects.current = null;
    if (!first) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const after = measureCards(container);
    const matches = matchBeforeRects(first, after);
    for (const { card, point } of after) {
      const before = matches.get(card);
      if (!before) continue;

      const dx = before.x - point.x;
      const dy = before.y - point.y;
      if (dx === 0 && dy === 0) continue;

      const animation = card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
        { duration: FLIP_DURATION_MS, easing: FLIP_EASING, composite: "replace" }
      );
      animationsRef.current.add(animation);
      const forget = () => animationsRef.current.delete(animation);
      animation.addEventListener("finish", forget, { once: true });
      animation.addEventListener("cancel", forget, { once: true });
    }
  }, [graph, containerRef]);
}
