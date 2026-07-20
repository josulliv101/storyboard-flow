"use client";

import { useEffect, type RefObject } from "react";
import { useCollectionsContainer } from "./container-context";
import { type EdgeAutoScrollOptions } from "./edge-autoscroll-coordinator";

// Deterministic edge auto-scroll for the virtualized containers. dnd-kit's
// built-in auto-scroller did not engage for these scroll containers (probed
// e2e: drag active, intent resolving, pointer parked in the edge zone —
// zero scrollBy calls ever issued), so the provider drives its own: while a
// drag is live, the instance's coordinator scrolls a registered container
// when the pointer sits in its edge band, speed proportional to edge
// proximity. Scrolling feeds straight back into the pipeline — the boundary
// resolvers read scrollLeft/scrollTop live, and dnd-kit recomputes
// collisions on scroll — so the drop intent keeps tracking the content
// flying underneath.
//
// This coexists with dnd-kit's own autoScroll (left enabled): the two never
// fight because they scroll DIFFERENT elements — dnd-kit handles the window
// and ancestor scroll containers (which ours never touches), ours handles
// the virtual containers' own axes (which dnd-kit never engaged for).
//
// This hook is now only the REGISTRATION: the pointer tracker and the frame
// loop live in the provider's single EdgeAutoScrollCoordinator (see
// edge-autoscroll-coordinator.ts). Each mounted view used to run all of it
// itself, so one drag spun up O(mounted views) rAF loops — the recursive
// sub-graph tree made that multiplier real.

export function useEdgeAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  axis: "x" | "y",
  options?: EdgeAutoScrollOptions
): void {
  const { registerEdgeAutoScroll } = useCollectionsContainer();
  const edge = options?.edge;
  const maxSpeed = options?.maxSpeed;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return registerEdgeAutoScroll(el, axis, { edge, maxSpeed });
  }, [registerEdgeAutoScroll, containerRef, axis, edge, maxSpeed]);
}
