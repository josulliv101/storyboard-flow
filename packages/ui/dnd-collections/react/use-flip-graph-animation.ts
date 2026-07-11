"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useCollectionsSelector, useCollectionsStore } from "./collections-store";

// Post-commit FLIP animation, as its own layer ABOVE the reducer: it
// visualizes graph changes, it never decides them (the command model stays
// the single truth). One sweep per committed graph change (drop/undo/redo)
// plays inverted-transform animations for whatever moved.
//
// Why a single sweep instead of per-card effects: displaced sibling cards
// intentionally DON'T re-render (their selector slices are unchanged — the
// package's core efficiency property), so a per-card effect would never fire
// for exactly the cards that shifted. The sweep measures the DOM directly.
// The rect registry spans the whole container, which is what makes
// CROSS-PANEL moves animate: a card's FIRST rect is taken from its old panel.
//
// Measuring FIRST and LAST in the same scroll frame is what keeps this
// correct. "First" is captured synchronously the moment the graph changes —
// inside a store subscription, before React re-renders, while the DOM still
// shows the pre-commit layout — and "Last" is measured in the layout effect
// after the re-render. Both reads happen within one synchronous task, so no
// scroll can occur between them. (An earlier version stashed "first" at the
// PREVIOUS commit in viewport coordinates; any page/container scroll between
// two commits then leaked its delta into every card, sliding the whole board
// by the scroll amount on the next commit.)
//
// Scope: the container is ONE DndCollections instance's wrapper (the default
// views pass it from context). Both the query and the id-keyed registry stay
// inside it, so multiple boards on a page — even ones reusing node ids —
// never measure or animate each other's cards.
//
// Known, accepted gap: a panel whose own children did not change can still
// shift on screen (a panel above it grew/shrank); those cards animate too —
// the sweep covers the instance — but content outside the container never
// does.

const FLIP_DURATION_MS = 180;
const FLIP_EASING = "cubic-bezier(0.2, 0, 0, 1)";

type Point = Readonly<{ x: number; y: number }>;

function measureCards(container: HTMLElement): Map<string, Point> {
  const rects = new Map<string, Point>();
  for (const card of container.querySelectorAll<HTMLElement>("[data-node-id]")) {
    const id = card.dataset.nodeId;
    if (!id) continue;
    const rect = card.getBoundingClientRect();
    rects.set(id, { x: rect.left, y: rect.top });
  }
  return rects;
}

export function useFlipGraphAnimation(containerRef: RefObject<HTMLElement | null>): void {
  const store = useCollectionsStore();
  // Subscribing to graph identity re-renders the caller once per commit —
  // that render is what schedules the LAST measurement (layout effect) below.
  const graph = useCollectionsSelector((s) => s.graph);
  const firstRects = useRef<Map<string, Point> | null>(null);

  // Capture FIRST rects the instant the graph changes, before React paints
  // the new layout. This runs inside store.notify() — synchronously during
  // dispatch/undo/redo, while the DOM still shows the pre-commit positions.
  // Gated on graph identity so the flood of interaction-only notifies during
  // a drag (pointer moves, drop-intent changes) never triggers a measurement
  // — the render-efficiency contract depends on this staying quiet mid-drag.
  useEffect(() => {
    let lastGraph = store.getSnapshot().graph;
    return store.subscribe(() => {
      const nextGraph = store.getSnapshot().graph;
      if (nextGraph === lastGraph) return; // interaction-only notify — ignore
      lastGraph = nextGraph;
      const container = containerRef.current;
      firstRects.current = container ? measureCards(container) : null;
    });
  }, [store, containerRef]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Consume the first-rects captured for THIS commit (null on mount, or if
    // the container was unavailable when the graph changed).
    const first = firstRects.current;
    firstRects.current = null;
    if (!first) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    for (const card of container.querySelectorAll<HTMLElement>("[data-node-id]")) {
      const id = card.dataset.nodeId;
      if (!id) continue;
      const before = first.get(id);
      if (!before) continue; // newly visible — nothing to invert from

      const rect = card.getBoundingClientRect();
      const dx = before.x - rect.left;
      const dy = before.y - rect.top;
      if (dx === 0 && dy === 0) continue;

      // Invert & play. WAAPI cleans up after itself (no lingering styles),
      // and `composite: "replace"` supersedes any in-flight FLIP from a
      // rapid undo/redo instead of compounding with it.
      card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
        { duration: FLIP_DURATION_MS, easing: FLIP_EASING, composite: "replace" }
      );
    }
  }, [graph, containerRef]);
}
