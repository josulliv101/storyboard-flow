import { useCallback, useRef } from "react";
import { FRAME_DURATION_60FPS_MS } from "./core/media-strip.utils";

const INERTIA_TUNING = {
  VELOCITY_DECAY: 0.95,
  MIN_VELOCITY_THRESHOLD: 0.1,
};

/**
 * Custom hook to handle inertia animation frame execution and velocity decay.
 * isolates the animation timing loop from gesture tracking events.
 */
export function usePointerDragInertia() {
  const inertiaFrameRef = useRef<number | null>(null);

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const startInertia = useCallback((
    initialVelocity: number,
    element: HTMLElement | null,
    maxScrollLeft: number
  ) => {
    stopInertia();
    if (!element || Math.abs(initialVelocity) < INERTIA_TUNING.MIN_VELOCITY_THRESHOLD) {
      return;
    }

    let velocity = initialVelocity;
    let lastFrameTime = performance.now();

    const step = (now: number) => {
      const dt = (now - lastFrameTime) / FRAME_DURATION_60FPS_MS;
      lastFrameTime = now;

      // Decay velocity over elapsed time
      velocity *= Math.pow(INERTIA_TUNING.VELOCITY_DECAY, dt);

      if (Math.abs(velocity) < INERTIA_TUNING.MIN_VELOCITY_THRESHOLD) {
        inertiaFrameRef.current = null;
        return;
      }

      const nextScrollLeft = Math.max(
        0,
        Math.min(element.scrollLeft + velocity, maxScrollLeft)
      );

      element.scrollLeft = nextScrollLeft;

      if (nextScrollLeft === 0 || nextScrollLeft === maxScrollLeft) {
        inertiaFrameRef.current = null;
        return;
      }

      inertiaFrameRef.current = requestAnimationFrame(step);
    };

    inertiaFrameRef.current = requestAnimationFrame(step);
  }, [stopInertia]);

  return { startInertia, stopInertia };
}
