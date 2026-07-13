"use client";

import { useEffect, useRef, type RefObject } from "react";
import { finiteNonNegativeOr, finitePositiveOr } from "../core/numeric";
import { useCollectionsSelector } from "./collections-store";

// Deterministic edge auto-scroll for the virtualized containers. dnd-kit's
// built-in auto-scroller did not engage for these scroll containers (probed
// e2e: drag active, intent resolving, pointer parked in the edge zone —
// zero scrollBy calls ever issued), so the views drive their own: while a
// drag is live, a rAF loop scrolls the container when the pointer sits in
// an edge band, speed proportional to edge proximity. Scrolling feeds
// straight back into the pipeline — the boundary resolvers read
// scrollLeft/scrollTop live, and dnd-kit recomputes collisions on scroll —
// so the drop intent keeps tracking the content flying underneath.
//
// This coexists with dnd-kit's own autoScroll (left enabled): the two never
// fight because they scroll DIFFERENT elements — dnd-kit handles the window
// and ancestor scroll containers (which our hook never touches), this hook
// handles the virtual container's own axis (which dnd-kit never engaged for).
//
// The container's viewport rect is cached, not measured per frame: scrolling
// the container itself does not move its box (only its content), so the rect
// changes only on ancestor scroll or resize — refresh it there.

export function useEdgeAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  axis: "x" | "y",
  options?: Readonly<{ edge?: number; maxSpeed?: number }>
): void {
  const edge = finitePositiveOr(options?.edge, 48);
  const maxSpeed = finiteNonNegativeOr(options?.maxSpeed, 14);
  const pointerRef = useRef<Readonly<{ id: number; x: number; y: number }> | null>(null);

  // Observe the active pointer before dnd-kit publishes drag state. The move
  // that crosses the activation threshold may be the final pointer event
  // before the user parks at an edge; installing this listener only after
  // `dragging` becomes true would miss that position. Tracking from
  // pointerdown also keeps keyboard drags from inheriting stale mouse data.
  useEffect(() => {
    const handleDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const handleMove = (event: PointerEvent) => {
      if (pointerRef.current?.id !== event.pointerId) return;
      pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const handleEnd = (event: PointerEvent) => {
      if (pointerRef.current?.id === event.pointerId) pointerRef.current = null;
    };
    window.addEventListener("pointerdown", handleDown, { passive: true });
    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerup", handleEnd, { passive: true });
    window.addEventListener("pointercancel", handleEnd, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      pointerRef.current = null;
    };
  }, []);

  // Explicit drag-live flag: set by beginDrag/beginPaletteDrag, cleared by
  // endDrag — never inferred from intents, which can be null mid-drag over
  // dead zones (and, inversely, must never leak past a drop).
  const dragging = useCollectionsSelector((s) => s.interaction.isDragging);

  useEffect(() => {
    if (!dragging) return;
    const el = containerRef.current;
    if (!el) return;

    // Cached container rect. The container scrolling itself (which this loop
    // does every frame) does NOT move its box, so remeasure only when an
    // ancestor scrolls or the window resizes — skip the container's own
    // scroll events, which are the frequent ones.
    let rect = el.getBoundingClientRect();
    const remeasure = (event: Event) => {
      if (event.target === el) return;
      rect = el.getBoundingClientRect();
    };

    let frame = 0;
    const step = () => {
      const pointer = pointerRef.current;
      if (pointer) {
        const inCrossAxis =
          axis === "x"
            ? pointer.y >= rect.top && pointer.y <= rect.bottom
            : pointer.x >= rect.left && pointer.x <= rect.right;
        const [position, start, end] =
          axis === "x" ? [pointer.x, rect.left, rect.right] : [pointer.y, rect.top, rect.bottom];

        if (inCrossAxis && position > start && position < end) {
          let velocity = 0;
          if (position < start + edge) {
            velocity = -maxSpeed * (1 - (position - start) / edge);
          } else if (position > end - edge) {
            velocity = maxSpeed * (1 - (end - position) / edge);
          }
          if (velocity !== 0) {
            if (axis === "x") el.scrollLeft += velocity;
            else el.scrollTop += velocity;
          }
        }
      }
      frame = requestAnimationFrame(step);
    };

    window.addEventListener("scroll", remeasure, { passive: true, capture: true });
    window.addEventListener("resize", remeasure, { passive: true });
    frame = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("scroll", remeasure, { capture: true });
      window.removeEventListener("resize", remeasure);
      cancelAnimationFrame(frame);
    };
  }, [dragging, containerRef, axis, edge, maxSpeed]);
}
