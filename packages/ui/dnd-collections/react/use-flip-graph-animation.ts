"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { type CollectionsGraph } from "../core/graph";
import { useCollectionsSelector } from "./collections-store";

// Post-commit FLIP animation, as its own layer ABOVE the reducer: it
// visualizes graph changes, it never decides them (the command model stays
// the single truth). One sweep per committed graph change (drop/undo/redo)
// measures every card under the container, compares against the previous
// sweep's rects, and plays inverted-transform animations for whatever moved.
//
// Why a single sweep instead of per-card effects: displaced sibling cards
// intentionally DON'T re-render (their selector slices are unchanged — the
// package's core efficiency property), so a per-card effect would never fire
// for exactly the cards that shifted. The sweep is driven by graph identity,
// runs before paint (useLayoutEffect), and measures rarely — only on
// commits, never during drag moves. The rect registry is container-global,
// which is what makes CROSS-PANEL moves animate: the card's previous rect
// is remembered from its old panel.
//
// Known, accepted gap: a panel whose own children did not change can still
// shift on screen (a panel above it grew/shrank); those cards animate too —
// the sweep is global — but content OUTSIDE the container doesn't.

const FLIP_DURATION_MS = 180;
const FLIP_EASING = "cubic-bezier(0.2, 0, 0, 1)";

export function useFlipGraphAnimation(containerRef: RefObject<HTMLElement | null>): void {
  // Subscribing to graph identity re-renders the caller once per commit —
  // that render is what schedules the layout effect below.
  const graph = useCollectionsSelector((s) => s.graph);
  const previousRects = useRef<Map<string, { x: number; y: number }> | null>(null);
  const lastGraph = useRef<CollectionsGraph | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const graphChanged = lastGraph.current !== null && lastGraph.current !== graph;
    lastGraph.current = graph;

    const prev = previousRects.current;
    const next = new Map<string, { x: number; y: number }>();
    const cards = container.querySelectorAll<HTMLElement>("[data-node-id]");

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    for (const card of cards) {
      const id = card.dataset.nodeId;
      if (!id) continue;
      const rect = card.getBoundingClientRect();
      next.set(id, { x: rect.left, y: rect.top });

      if (!graphChanged || reduceMotion || !prev) continue;
      const before = prev.get(id);
      if (!before) continue; // newly visible — nothing to invert from

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

    previousRects.current = next;
  }, [graph, containerRef]);
}
