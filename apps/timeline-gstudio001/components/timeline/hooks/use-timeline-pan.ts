import { useCallback, useRef } from "react";

import { DRAG_THRESHOLD_PX } from "../constants";
import { clamp } from "../utils";
import type {
  SetScrollLeft,
  SetSelectedIndex,
  WindowDragCoordinator,
} from "./timeline-interaction-types";

type UseTimelinePanOptions = {
  parentRef: React.RefObject<HTMLDivElement | null>;
  setScrollLeft: SetScrollLeft;
  setSelectedIndex: SetSelectedIndex;
  windowDrag: WindowDragCoordinator;
};

export function useTimelinePan({
  parentRef,
  setScrollLeft,
  setSelectedIndex,
  windowDrag,
}: UseTimelinePanOptions) {
  const inertiaFrameRef = useRef<number | null>(null);
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startScrollLeft: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    moved: false,
    pointerId: -1,
    pressedIndex: null as number | null,
  });

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const runInertia = useCallback(() => {
    const element = parentRef.current;
    if (!element) return;

    const step = () => {
      const state = dragState.current;
      state.velocity *= 0.95;

      if (Math.abs(state.velocity) < 0.1) {
        inertiaFrameRef.current = null;
        return;
      }

      const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
      const nextScrollLeft = clamp(
        element.scrollLeft + state.velocity,
        0,
        maxScroll,
      );
      element.scrollLeft = nextScrollLeft;
      setScrollLeft(nextScrollLeft);

      if (nextScrollLeft === 0 || nextScrollLeft === maxScroll) {
        state.velocity = 0;
        inertiaFrameRef.current = null;
        return;
      }

      inertiaFrameRef.current = requestAnimationFrame(step);
    };

    inertiaFrameRef.current = requestAnimationFrame(step);
  }, [parentRef, setScrollLeft]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const element = parentRef.current;
      if (!element) return;
      if ((event.target as HTMLElement).closest("[data-trim-handle]")) return;

      stopInertia();
      windowDrag.cleanup();

      const clipElement = (event.target as HTMLElement).closest(
        "[data-clip-index]",
      ) as HTMLElement | null;
      const parsedIndex = Number(clipElement?.dataset.clipIndex);
      const pressedIndex = Number.isFinite(parsedIndex) ? parsedIndex : null;
      const state = dragState.current;

      Object.assign(state, {
        isDragging: true,
        moved: false,
        startX: event.clientX,
        startScrollLeft: element.scrollLeft,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
        pointerId: event.pointerId,
        pressedIndex,
      });

      try {
        element.setPointerCapture(event.pointerId);
      } catch {}

      const moveTimeline = (clientX: number, timeStamp: number) => {
        const currentState = dragState.current;
        const currentElement = parentRef.current;
        if (!currentState.isDragging || !currentElement) return;

        const deltaX = clientX - currentState.startX;
        if (
          !currentState.moved &&
          Math.abs(deltaX) <= DRAG_THRESHOLD_PX
        ) {
          return;
        }

        currentState.moved = true;
        const maxScroll = Math.max(
          0,
          currentElement.scrollWidth - currentElement.clientWidth,
        );
        const nextScrollLeft = clamp(
          currentState.startScrollLeft - deltaX,
          0,
          maxScroll,
        );
        currentElement.scrollLeft = nextScrollLeft;
        setScrollLeft(nextScrollLeft);

        const elapsed = timeStamp - currentState.lastTime;
        if (elapsed > 0) {
          const instantaneous =
            (-(clientX - currentState.lastX) / elapsed) * 16.67;
          currentState.velocity =
            0.7 * instantaneous + 0.3 * currentState.velocity;
        }

        currentState.lastX = clientX;
        currentState.lastTime = timeStamp;
      };

      const finishTimelineDrag = (pointerId: number, timeStamp: number) => {
        const currentState = dragState.current;
        const currentElement = parentRef.current;
        if (!currentState.isDragging || !currentElement) return;

        currentState.isDragging = false;
        try {
          if (currentElement.hasPointerCapture(pointerId)) {
            currentElement.releasePointerCapture(pointerId);
          }
        } catch {}

        if (timeStamp - currentState.lastTime > 50) {
          currentState.velocity = 0;
        }

        if (!currentState.moved && currentState.pressedIndex !== null) {
          const index = currentState.pressedIndex;
          setSelectedIndex((previous) => (previous === index ? null : index));
        } else if (Math.abs(currentState.velocity) > 1) {
          runInertia();
        }

        currentState.pointerId = -1;
        currentState.pressedIndex = null;
        windowDrag.cleanup();
      };

      const onPointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== dragState.current.pointerId) return;
        pointerEvent.preventDefault();
        moveTimeline(pointerEvent.clientX, pointerEvent.timeStamp);
      };
      const onPointerUp = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== dragState.current.pointerId) return;
        finishTimelineDrag(pointerEvent.pointerId, pointerEvent.timeStamp);
      };
      const onPointerCancel = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== dragState.current.pointerId) return;
        finishTimelineDrag(pointerEvent.pointerId, pointerEvent.timeStamp);
      };

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      windowDrag.setCleanup(() => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
      });
    },
    [
      parentRef,
      runInertia,
      setScrollLeft,
      setSelectedIndex,
      stopInertia,
      windowDrag,
    ],
  );

  const cancelPan = useCallback(() => {
    const state = dragState.current;
    state.isDragging = false;
    state.pointerId = -1;
    state.pressedIndex = null;
  }, []);

  return {
    handlePointerDown,
    cancelPan,
    stopInertia,
    runInertia,
  };
}
