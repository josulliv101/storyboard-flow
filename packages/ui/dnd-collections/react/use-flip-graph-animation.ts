"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useCollectionsSelector, useCollectionsStore } from "./collections-store";

// Post-commit FLIP animation, as its own layer above the reducer: it
// visualizes graph changes and never decides them. A provider-level DOM sweep
// also catches displaced siblings whose selector slices did not change.

const FLIP_DURATION_MS = 180;
const FLIP_EASING = "cubic-bezier(0.2, 0, 0, 1)";

type Point = Readonly<{ x: number; y: number }>;
type Box = Readonly<{ x: number; y: number; width: number; height: number }>;
type CardRect = Readonly<{ card: HTMLElement; nodeId: string; point: Point; box: Box }>;

/**
 * Where the dragged card should APPEAR to come from on a drop: the box the
 * drag ghost occupied at release. Published by the provider's drag-end
 * handler (see DndCollections) and consumed by the next sweep.
 *
 * Without it the dropped card FLIPs from the slot it used to occupy — so the
 * motion starts wherever the item WAS, often most of the board away from the
 * pointer, while the ghost the user was watching vanishes on the spot. The
 * eye follows the ghost; the animation should continue from there.
 */
export type FlipDropOrigin = Readonly<{ nodeId: string; box: Box }>;

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
    rects.push({
      card,
      nodeId,
      point: { x: rect.left, y: rect.top },
      box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    });
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
    const onlyAfter = afterCandidates.length === 1 ? afterCandidates[0] : undefined;
    const onlyBefore = beforeCandidates?.length === 1 ? beforeCandidates[0] : undefined;
    // Read through the same length check that gates the pairing, so the "exactly
    // one on each side" rule is stated once instead of being asserted twice.
    if (onlyAfter !== undefined && onlyBefore !== undefined) {
      matches.set(onlyAfter.card, onlyBefore.point);
    }
  }

  return matches;
}

function cancelAnimations(animations: Set<Animation>): void {
  for (const animation of animations) animation.cancel();
  animations.clear();
}

export function useFlipGraphAnimation(
  containerRef: RefObject<HTMLElement | null>,
  /** Set by the drop that is about to commit; read (and cleared) by the sweep
   *  it triggers, so it can only ever affect that one commit. */
  dropOriginRef?: RefObject<FlipDropOrigin | null>,
): void {
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

    // Read and clear BEFORE the early returns below. The caller only arms this
    // for a committing drop, so a value surviving a run of this effect would
    // have to be stale — belt and braces on the same invariant.
    const dropOrigin = dropOriginRef?.current ?? null;
    if (dropOriginRef) dropOriginRef.current = null;

    const first = firstRects.current;
    firstRects.current = null;
    if (!first) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const after = measureCards(container);
    const matches = matchBeforeRects(first, after);
    for (const { card, nodeId, point, box } of after) {
      // The DROPPED card starts from the ghost the user just released — same
      // place their eye already is — scaling up from the ghost's footprint
      // into the slot. Every other card keeps the plain positional FLIP from
      // where it used to sit.
      const isDropped = dropOrigin !== null && dropOrigin.nodeId === nodeId;
      const before = isDropped ? dropOrigin.box : matches.get(card);
      if (!before) continue;

      const dx = before.x - point.x;
      const dy = before.y - point.y;
      const sx = isDropped && box.width > 0 ? dropOrigin.box.width / box.width : 1;
      const sy = isDropped && box.height > 0 ? dropOrigin.box.height / box.height : 1;
      if (dx === 0 && dy === 0 && sx === 1 && sy === 1) continue;

      const animation = card.animate(
        [
          {
            transformOrigin: "top left",
            transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          },
          { transformOrigin: "top left", transform: "translate(0, 0) scale(1, 1)" },
        ],
        { duration: FLIP_DURATION_MS, easing: FLIP_EASING, composite: "replace" }
      );
      animationsRef.current.add(animation);
      const forget = () => animationsRef.current.delete(animation);
      animation.addEventListener("finish", forget, { once: true });
      animation.addEventListener("cancel", forget, { once: true });
    }
  }, [graph, containerRef]);
}
