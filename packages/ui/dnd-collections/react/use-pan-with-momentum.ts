"use client";

import { useEffect, type RefObject } from "react";

import {
  finiteNonNegativeOr,
  finitePositiveOr,
  openUnitIntervalOr,
} from "../core/numeric";
import { PAN_START_SLOP_PX } from "./gesture-thresholds";

// Pan-to-scroll with momentum for a scroll container: drag the surface to
// scroll it directly; on release, velocity (sampled over a trailing window)
// keeps the scroll gliding under exponential decay. Store-agnostic and
// generic — the caller's `shouldStartPan` predicate decides which
// pointerdowns are pans (VirtualStrip excludes card/grip surfaces so
// dnd-kit item drags never compete). The container stays a NATIVE scroll
// element: wheel, scrollbars, scrollToIndex, and the virtualizer all keep
// working, and every pan frame is an ordinary scroll event downstream.

export type PanWithMomentumOptions = Readonly<{
  /** Pointerdowns for which panning may engage. Default: everything. */
  shouldStartPan?: (target: Element) => boolean;
  /**
   * Checked before a press commits to panning: when true, another gesture
   * owns this pointer (e.g. hold-to-drag fired) and the pan stands down.
   */
  isGestureClaimed?: () => boolean;
  /** Movement (px) before a press becomes a pan — keeps plain clicks intact. */
  slop?: number;
  /** Per-millisecond velocity decay factor for the inertia glide. */
  friction?: number;
  /** Glide stops below this speed (px/ms). */
  minVelocity?: number;
  /** Release velocity is clamped to this magnitude (px/ms). */
  maxVelocity?: number;
  disabled?: boolean;
}>;

const SAMPLE_WINDOW_MS = 120;

export function usePanWithMomentum(
  containerRef: RefObject<HTMLElement | null>,
  axis: "x" | "y",
  options?: PanWithMomentumOptions
): void {
  const shouldStartPan = options?.shouldStartPan;
  const isGestureClaimed = options?.isGestureClaimed;
  const slop = finiteNonNegativeOr(options?.slop, PAN_START_SLOP_PX);
  const friction = openUnitIntervalOr(options?.friction, 0.995);
  const minVelocity = finiteNonNegativeOr(options?.minVelocity, 0.02);
  const maxVelocity = Math.max(finitePositiveOr(options?.maxVelocity, 5), minVelocity);
  const disabled = options?.disabled ?? false;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    let glideFrame = 0;
    const stopGlide = () => {
      if (glideFrame) cancelAnimationFrame(glideFrame);
      glideFrame = 0;
    };

    // Teardown for a pending post-pan click squash (see endPan). Tracked at
    // effect scope so it's removed on unmount too, not just when it fires.
    let squashCleanup: (() => void) | null = null;

    const scrollPosition = () => (axis === "x" ? el.scrollLeft : el.scrollTop);
    const scrollBy = (delta: number) => {
      if (axis === "x") el.scrollLeft += delta;
      else el.scrollTop += delta;
    };
    const maxScroll = () =>
      axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;

    const startGlide = (initialVelocity: number) => {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) return;
      let velocity = Math.max(-maxVelocity, Math.min(initialVelocity, maxVelocity));
      if (Math.abs(velocity) < minVelocity) return;
      let lastTime = performance.now();
      const step = (time: number) => {
        const dt = time - lastTime;
        lastTime = time;
        scrollBy(velocity * dt);
        velocity *= Math.pow(friction, dt);
        const position = scrollPosition();
        const hitBound =
          (velocity < 0 && position <= 0) || (velocity > 0 && position >= maxScroll());
        if (Math.abs(velocity) < minVelocity || hitBound) {
          glideFrame = 0;
          return;
        }
        glideFrame = requestAnimationFrame(step);
      };
      glideFrame = requestAnimationFrame(step);
    };

    // One live pan at a time.
    let pointerId: number | null = null;
    let panning = false;
    let downPosition = 0;
    let lastPosition = 0;
    let samples: Array<{ t: number; p: number }> = [];

    const pointerAxis = (event: PointerEvent) => (axis === "x" ? event.clientX : event.clientY);

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const position = pointerAxis(event);
      if (!panning) {
        // Hold-to-drag fired during this press: the drag owns the pointer.
        if (isGestureClaimed?.()) {
          pointerId = null;
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", endPan);
          window.removeEventListener("pointercancel", endPan);
          return;
        }
        if (Math.abs(position - downPosition) < slop) return;
        panning = true; // past the slop: this press is a pan, not a click
      }
      scrollBy(lastPosition - position); // content follows the pointer
      lastPosition = position;
      const now = performance.now();
      samples.push({ t: now, p: position });
      while (samples.length > 1 && now - samples[0].t > SAMPLE_WINDOW_MS) samples.shift();
    };

    const endPan = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", endPan);
      window.removeEventListener("pointercancel", endPan);
      if (!panning) return;
      panning = false;

      // A pointercancel (browser/OS took over the gesture) fires no click and
      // shouldn't fling — only a real release does either.
      if (event.type !== "pointerup") return;

      // A pan is not a click: swallow the click the browser fires after
      // pointerup so a body-pan can't select the card it started on — but
      // only clicks INSIDE this container, so an unrelated click elsewhere on
      // the page within the window isn't eaten.
      squashCleanup?.();
      const squashClick = (clickEvent: MouseEvent) => {
        const target = clickEvent.target;
        if (!(target instanceof Node) || !el.contains(target)) return;
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
        squashCleanup?.();
      };
      window.addEventListener("click", squashClick, { capture: true });
      const timer = window.setTimeout(() => squashCleanup?.(), 120);
      squashCleanup = () => {
        window.removeEventListener("click", squashClick, { capture: true });
        clearTimeout(timer);
        squashCleanup = null;
      };

      const last = samples[samples.length - 1];
      const first = samples[0];
      // A release after a stationary HOLD must not fling: samples are only
      // appended/pruned on movement, so once the pointer stops the window
      // still describes the pre-hold motion (and nothing trims it). "Pan
      // fast, stop dead, hold, release" is the universal kill-momentum
      // gesture — if the newest sample is older than the sampling window,
      // the pointer has been still at least that long; treat it as a stop.
      const stale = last !== undefined && performance.now() - last.t > SAMPLE_WINDOW_MS;
      if (!stale && last && first && last.t > first.t) {
        const pointerVelocity = (last.p - first.p) / (last.t - first.t);
        startGlide(-pointerVelocity); // scroll continues opposite the pointer
      }
    };

    const handleDown = (event: PointerEvent) => {
      stopGlide(); // any press interrupts a glide
      if (!event.isPrimary || event.button !== 0 || pointerId !== null) return;
      if (isGestureClaimed?.()) return;
      if (shouldStartPan && !(event.target instanceof Element && shouldStartPan(event.target))) {
        return;
      }
      pointerId = event.pointerId;
      panning = false;
      downPosition = pointerAxis(event);
      lastPosition = downPosition;
      samples = [{ t: performance.now(), p: downPosition }];
      // Capture keeps real pointers delivering outside the container;
      // synthetic pointers (tests) have no active pointer to capture.
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* untrusted pointer — window listeners below suffice */
      }
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", endPan);
      window.addEventListener("pointercancel", endPan);
    };

    const handleWheel = () => stopGlide();

    el.addEventListener("pointerdown", handleDown);
    el.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", handleDown);
      el.removeEventListener("wheel", handleWheel);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", endPan);
      window.removeEventListener("pointercancel", endPan);
      stopGlide();
      squashCleanup?.();
    };
  }, [
    containerRef,
    axis,
    shouldStartPan,
    isGestureClaimed,
    slop,
    friction,
    minVelocity,
    maxVelocity,
    disabled,
  ]);
}
