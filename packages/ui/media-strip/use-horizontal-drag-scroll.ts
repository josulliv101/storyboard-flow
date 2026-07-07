import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DRAG_ACTIVATION_THRESHOLDS_PX } from "./media-strip.utils";
import { usePointerDragInertia } from "./use-pointer-drag-inertia";

const SCROLL_CLICK_SUPPRESSION_MS = 180;
const DRAG_CLICK_THRESHOLD_PX = DRAG_ACTIVATION_THRESHOLDS_PX.scroll;

const INERTIA_TUNING = {
  FRAME_MS_60FPS: 16.67,
  EMA_INSTANTANEOUS_WEIGHT: 0.7,
  EMA_PREVIOUS_WEIGHT: 0.3,
  MIN_VELOCITY_TO_START_INERTIA: 1,
};

/**
 * Custom hook to enable inertia scroll dragging on custom scroller components.
 * delegates actual animation rendering and velocity decay to usePointerDragInertia.
 */
export function useHorizontalDragScroll(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  viewportContentRef: React.RefObject<HTMLDivElement | null>
) {
  const maxScrollLeftRef = useRef(0);
  const suppressClickUntilRef = useRef(0);

  const { startInertia, stopInertia } = usePointerDragInertia();

  // State is used to feed any scroll layouts if needed
  const [maxScrollLeft, setMaxScrollLeft] = useState(0);

  // Drag coordinates/velocity state ref to avoid component re-renders
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startScrollLeft: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    pointerId: -1,
    didDrag: false,
  });

  // Track active window event listeners for unmount cleanup
  const activeListenersRef = useRef<{
    move: ((e: PointerEvent) => void) | null;
    up: ((e: PointerEvent) => void) | null;
    cancel: ((e: PointerEvent) => void) | null;
  }>({ move: null, up: null, cancel: null });

  const getViewport = useCallback(() => {
    return viewportRef.current;
  }, [viewportRef]);

  const updateScrollBounds = useCallback(() => {
    const viewport = getViewport();

    if (!viewport) {
      maxScrollLeftRef.current = 0;
      setMaxScrollLeft(0);
      return 0;
    }

    const nextMaxScrollLeft = Math.max(
      0,
      viewport.scrollWidth - viewport.clientWidth
    );

    maxScrollLeftRef.current = nextMaxScrollLeft;

    setMaxScrollLeft((current) =>
      current === nextMaxScrollLeft ? current : nextMaxScrollLeft
    );

    return nextMaxScrollLeft;
  }, [getViewport]);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    updateScrollBounds();

    const resizeObserver = new ResizeObserver(updateScrollBounds);
    resizeObserver.observe(viewport);

    const content = viewportContentRef.current;
    if (content) {
      resizeObserver.observe(content);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [getViewport, updateScrollBounds]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Guard against secondary pointer downs during active drags (multi-touch listener leaks)
      if (dragStateRef.current.isDragging) {
        return;
      }

      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      // Interactive element guards to prevent scroll interference with clicks or DnD handle gestures
      if (event.target instanceof Element) {
        const isInteractive =
          event.target.closest("a") ||
          event.target.closest("input") ||
          event.target.closest("select") ||
          event.target.closest("textarea") ||
          event.target.closest("[data-dnd-handle]") ||
          event.target.closest('[data-slot="scroll-area-scrollbar"]');

        if (isInteractive) {
          return;
        }
      }

      const viewport = getViewport();
      const nextMaxScrollLeft = updateScrollBounds();

      if (!viewport || nextMaxScrollLeft === 0) {
        return;
      }

      // Stop any ongoing inertia scroll
      stopInertia();

      // Capture the target DOM node immediately to fix the synthetic event currentTarget nulling bug
      const dragRoot = event.currentTarget;

      const state = dragStateRef.current;
      Object.assign(state, {
        isDragging: true,
        startX: event.clientX,
        startScrollLeft: viewport.scrollLeft,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
        pointerId: event.pointerId,
        didDrag: false,
      });

      try {
        dragRoot.setPointerCapture(event.pointerId);
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Failed to set pointer capture:", err);
        }
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== state.pointerId) return;

        const deltaX = moveEvent.clientX - state.startX;
        if (!state.didDrag && Math.abs(deltaX) > DRAG_CLICK_THRESHOLD_PX) {
          state.didDrag = true;
        }

        const maxScroll = maxScrollLeftRef.current;
        viewport.scrollLeft = Math.max(
          0,
          Math.min(state.startScrollLeft - deltaX, maxScroll)
        );

        const elapsed = moveEvent.timeStamp - state.lastTime;
        if (elapsed > 0) {
          const instantaneous =
            (-(moveEvent.clientX - state.lastX) / elapsed) * INERTIA_TUNING.FRAME_MS_60FPS;
          state.velocity =
            INERTIA_TUNING.EMA_INSTANTANEOUS_WEIGHT * instantaneous +
            INERTIA_TUNING.EMA_PREVIOUS_WEIGHT * state.velocity;
        }

        state.lastX = moveEvent.clientX;
        state.lastTime = moveEvent.timeStamp;
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);

        activeListenersRef.current.move = null;
        activeListenersRef.current.up = null;
        activeListenersRef.current.cancel = null;
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== state.pointerId) return;

        state.isDragging = false;
        try {
          if (dragRoot.hasPointerCapture(upEvent.pointerId)) {
            dragRoot.releasePointerCapture(upEvent.pointerId);
          }
        } catch (err) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("Failed to release pointer capture on pointerup:", err);
          }
        }

        cleanup();

        // Click suppression if we dragged
        if (state.didDrag) {
          suppressClickUntilRef.current =
            performance.now() + SCROLL_CLICK_SUPPRESSION_MS;
        }

        // Run inertia
        if (state.didDrag && Math.abs(state.velocity) > INERTIA_TUNING.MIN_VELOCITY_TO_START_INERTIA) {
          startInertia(state.velocity, viewport, maxScrollLeftRef.current);
        }

        state.pointerId = -1;
      };

      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== state.pointerId) return;

        state.isDragging = false;
        try {
          if (dragRoot.hasPointerCapture(cancelEvent.pointerId)) {
            dragRoot.releasePointerCapture(cancelEvent.pointerId);
          }
        } catch (err) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("Failed to release pointer capture on pointercancel:", err);
          }
        }

        cleanup();

        state.pointerId = -1;
      };

      // Store window listeners for unmount cleanup
      activeListenersRef.current.move = onPointerMove;
      activeListenersRef.current.up = onPointerUp;
      activeListenersRef.current.cancel = onPointerCancel;

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    },
    [getViewport, updateScrollBounds, stopInertia, startInertia]
  );

  const handleClickCapture = useCallback((event: React.MouseEvent) => {
    if (performance.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  // Clean up any pending window listeners and animation frames on unmount
  useEffect(() => {
    return () => {
      const listeners = activeListenersRef.current;
      if (listeners.move) window.removeEventListener("pointermove", listeners.move);
      if (listeners.up) window.removeEventListener("pointerup", listeners.up);
      if (listeners.cancel) window.removeEventListener("pointercancel", listeners.cancel);

      stopInertia();
    };
  }, [stopInertia]);

  return {
    maxScrollLeft,
    handlePointerDown,
    handleClickCapture,
  };
}
