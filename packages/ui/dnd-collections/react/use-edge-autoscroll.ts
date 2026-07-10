"use client";

import { useEffect, type RefObject } from "react";
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

export function useEdgeAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  axis: "x" | "y",
  options?: Readonly<{ edge?: number; maxSpeed?: number }>
): void {
  const edge = options?.edge ?? 48;
  const maxSpeed = options?.maxSpeed ?? 14;

  // Node drags set activeIds; palette drags have no active ids but publish
  // intents while hovering — either signal means "a drag is live".
  const dragging = useCollectionsSelector(
    (s) => s.interaction.activeIds.length > 0 || s.interaction.dropIntent !== null
  );

  useEffect(() => {
    if (!dragging) return;
    const el = containerRef.current;
    if (!el) return;

    let pointer: Readonly<{ x: number; y: number }> | null = null;
    const handleMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };

    let frame = 0;
    const step = () => {
      if (pointer) {
        const rect = el.getBoundingClientRect();
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

    window.addEventListener("pointermove", handleMove, { passive: true });
    frame = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      cancelAnimationFrame(frame);
    };
  }, [dragging, containerRef, axis, edge, maxSpeed]);
}
