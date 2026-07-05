import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

const SCROLL_CLICK_SUPPRESSION_MS = 180;
const DRAG_CLICK_THRESHOLD_PX = 4;

export function useHorizontalDragScroll(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  viewportContentRef: React.RefObject<HTMLDivElement | null>
) {
  const didDragRef = useRef(false);
  const maxScrollLeftRef = useRef(0);
  const suppressClickUntilRef = useRef(0);

  // Inertia animation frame ref
  const inertiaFrameRef = useRef<number | null>(null);

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
  });

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

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const runInertia = useCallback(() => {
    const element = getViewport();
    if (!element) return;

    const step = () => {
      const state = dragStateRef.current;
      state.velocity *= 0.95; // Decay factor

      if (Math.abs(state.velocity) < 0.1) {
        inertiaFrameRef.current = null;
        return;
      }

      const maxScroll = maxScrollLeftRef.current;
      const nextScrollLeft = Math.max(
        0,
        Math.min(element.scrollLeft + state.velocity, maxScroll)
      );

      element.scrollLeft = nextScrollLeft;

      if (nextScrollLeft === 0 || nextScrollLeft === maxScroll) {
        state.velocity = 0;
        inertiaFrameRef.current = null;
        return;
      }

      inertiaFrameRef.current = requestAnimationFrame(step);
    };

    inertiaFrameRef.current = requestAnimationFrame(step);
  }, [getViewport]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[data-slot="scroll-area-scrollbar"]')
      ) {
        return;
      }

      const viewport = getViewport();
      const nextMaxScrollLeft = updateScrollBounds();

      if (!viewport || nextMaxScrollLeft === 0) {
        return;
      }

      // Stop any ongoing inertia scroll
      stopInertia();

      didDragRef.current = false;
      const state = dragStateRef.current;
      Object.assign(state, {
        isDragging: true,
        startX: event.clientX,
        startScrollLeft: viewport.scrollLeft,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
        pointerId: event.pointerId,
      });

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== state.pointerId) return;

        const deltaX = moveEvent.clientX - state.startX;
        if (!didDragRef.current && Math.abs(deltaX) > DRAG_CLICK_THRESHOLD_PX) {
          didDragRef.current = true;
        }

        const maxScroll = maxScrollLeftRef.current;
        viewport.scrollLeft = Math.max(
          0,
          Math.min(state.startScrollLeft - deltaX, maxScroll)
        );

        const elapsed = moveEvent.timeStamp - state.lastTime;
        if (elapsed > 0) {
          const instantaneous =
            (-(moveEvent.clientX - state.lastX) / elapsed) * 16.67;
          state.velocity = 0.7 * instantaneous + 0.3 * state.velocity;
        }

        state.lastX = moveEvent.clientX;
        state.lastTime = moveEvent.timeStamp;
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== state.pointerId) return;

        state.isDragging = false;
        try {
          if (event.currentTarget.hasPointerCapture(upEvent.pointerId)) {
            event.currentTarget.releasePointerCapture(upEvent.pointerId);
          }
        } catch {}

        // Remove listeners
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);

        // Click suppression if we dragged
        if (didDragRef.current) {
          suppressClickUntilRef.current =
            performance.now() + SCROLL_CLICK_SUPPRESSION_MS;
        }

        // Run inertia
        if (didDragRef.current && Math.abs(state.velocity) > 1) {
          runInertia();
        }

        state.pointerId = -1;
      };

      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== state.pointerId) return;

        state.isDragging = false;
        try {
          if (event.currentTarget.hasPointerCapture(cancelEvent.pointerId)) {
            event.currentTarget.releasePointerCapture(cancelEvent.pointerId);
          }
        } catch {}

        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);

        state.pointerId = -1;
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    },
    [getViewport, updateScrollBounds, stopInertia, runInertia]
  );

  const handleClickCapture = useCallback((event: React.MouseEvent) => {
    if (performance.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  // Clean up any pending animation frames on unmount
  useEffect(() => {
    return () => {
      if (inertiaFrameRef.current !== null) {
        cancelAnimationFrame(inertiaFrameRef.current);
      }
    };
  }, []);

  return {
    maxScrollLeft,
    handlePointerDown,
    handleClickCapture,
  };
}
