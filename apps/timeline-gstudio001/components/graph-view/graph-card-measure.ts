"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  FRAME_COUNT_SETTLE_MS,
  settleFrameCountStep,
  visibleFrameCount,
} from "@/lib/frame-count-settle";

/** Live width/height of a card, via ResizeObserver — drives how many frames a
 *  video filmstrip shows, so it stays a sensible sequence at every zoom (R6
 *  #8) instead of tiling one still wider and wider. Zero until first measured;
 *  callers fall back to a duration-based count meanwhile. */
export function useElementSize(): [
  (element: HTMLElement | null) => void,
  { width: number; height: number },
] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      // Read the size the observer already measured — calling
      // getBoundingClientRect() here would force a second, synchronous layout
      // on every resize, and a zoom fans this callback out across every card.
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect) return;
      setSize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  return [ref, size];
}

/**
 * The measured frame count, SETTLED: the first real measurement is adopted
 * immediately — a freshly (re)mounted card, virtualization remounts included,
 * must not wait out the delay to show its filmstrip — while later changes
 * must hold for FRAME_COUNT_SETTLE_MS before they re-sample. The first
 * adoption happens during render (the repo's cascading-render-safe pattern;
 * a synchronous setState in the effect would trip the lint), so this pass
 * already returns the measured value; changes adopt from the timer, which is
 * async by nature.
 */
export function useSettledFrameCount(measured: number): number {
  const [settled, setSettled] = useState(measured);
  // The render-time adoption (the repo's cascading-render-safe pattern; a
  // synchronous setState in the effect would trip the lint). The DECISION is
  // in lib/frame-count-settle, which is unit-tested; this owns the state.
  if (settleFrameCountStep({ settled, measured }) === "adopt-now") setSettled(measured);
  useEffect(() => {
    if (settleFrameCountStep({ settled, measured }) !== "debounce") return;
    const timer = setTimeout(() => setSettled(measured), FRAME_COUNT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [measured, settled]);
  return visibleFrameCount({ settled, measured });
}
