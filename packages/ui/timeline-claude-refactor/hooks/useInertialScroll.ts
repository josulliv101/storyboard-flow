import { useCallback, useRef } from "react";
import { clamp } from "../utils/math";
import {
  DRAG_THRESHOLD_PX,
  INERTIA_FRICTION,
  INERTIA_MIN_VELOCITY,
} from "../constants";

type UseInertialScrollOptions = {
  elementRef: React.RefObject<HTMLDivElement | null>;
  setScrollLeft: (value: number) => void;
  /** Called on pointer-up when the press didn't move (i.e. a click/tap). */
  onClipPress: (clipIndex: number) => void;
};

/**
 * Drag-to-pan scrolling with inertial momentum on release, plus click vs.
 * drag disambiguation: a press that never crosses DRAG_THRESHOLD_PX is
 * treated as a click on whatever clip was under the pointer.
 *
 * Window-level listeners are used (rather than relying solely on pointer
 * capture) so dragging keeps working even if the browser releases capture
 * early, and so motion past the element's bounds is still tracked.
 */
export function useInertialScroll({
  elementRef,
  setScrollLeft,
  onClipPress,
}: UseInertialScrollOptions) {
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

  const inertiaFrameRef = useRef<number | null>(null);
  const windowCleanupRef = useRef<(() => void) | null>(null);

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const cleanupWindowListeners = useCallback(() => {
    windowCleanupRef.current?.();
    windowCleanupRef.current = null;
  }, []);

  const runInertia = useCallback(() => {
    const el = elementRef.current;
    if (!el) return;

    const step = () => {
      const state = dragState.current;
      state.velocity *= INERTIA_FRICTION;

      if (Math.abs(state.velocity) < INERTIA_MIN_VELOCITY) {
        inertiaFrameRef.current = null;
        return;
      }

      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const next = clamp(el.scrollLeft + state.velocity, 0, maxScroll);
      el.scrollLeft = next;
      setScrollLeft(next);

      if (next === 0 || next === maxScroll) {
        state.velocity = 0;
        inertiaFrameRef.current = null;
        return;
      }

      inertiaFrameRef.current = requestAnimationFrame(step);
    };

    inertiaFrameRef.current = requestAnimationFrame(step);
  }, [elementRef, setScrollLeft]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const el = elementRef.current;
      if (!el) return;

      const target = e.target as HTMLElement;
      if (target.closest("[data-trim-handle]")) return;
      if (target.closest("[data-video-filmstrip]")) return;

      stopInertia();
      cleanupWindowListeners();

      const item = target.closest("[data-clip-index]") as HTMLElement | null;
      const rawIndex = item?.dataset.clipIndex;
      const pressedIndex = rawIndex === undefined ? null : Number(rawIndex);
      const normalizedPressedIndex = Number.isFinite(pressedIndex)
        ? pressedIndex
        : null;

      const state = dragState.current;
      state.isDragging = true;
      state.moved = false;
      state.startX = e.clientX;
      state.startScrollLeft = el.scrollLeft;
      state.lastX = e.clientX;
      state.lastTime = e.timeStamp;
      state.velocity = 0;
      state.pointerId = e.pointerId;
      state.pressedIndex = normalizedPressedIndex;

      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers can reject capture in edge cases; the window
        // listeners below still keep drag scrolling alive.
      }

      const moveTimeline = (clientX: number, timeStamp: number) => {
        const currentState = dragState.current;
        const currentEl = elementRef.current;
        if (!currentState.isDragging || !currentEl) return;

        const dx = clientX - currentState.startX;

        if (!currentState.moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;

        currentState.moved = true;

        const maxScroll = Math.max(
          0,
          currentEl.scrollWidth - currentEl.clientWidth,
        );
        const nextScrollLeft = clamp(
          currentState.startScrollLeft - dx,
          0,
          maxScroll,
        );
        currentEl.scrollLeft = nextScrollLeft;
        setScrollLeft(nextScrollLeft);

        const dt = timeStamp - currentState.lastTime;
        if (dt > 0) {
          const instantaneous = (-(clientX - currentState.lastX) / dt) * 16.67;
          currentState.velocity =
            0.7 * instantaneous + 0.3 * currentState.velocity;
        }

        currentState.lastX = clientX;
        currentState.lastTime = timeStamp;
      };

      const finishTimelineDrag = (pointerId: number) => {
        const currentState = dragState.current;
        const currentEl = elementRef.current;
        if (!currentState.isDragging || !currentEl) return;

        currentState.isDragging = false;

        try {
          if (currentEl.hasPointerCapture(pointerId)) {
            currentEl.releasePointerCapture(pointerId);
          }
        } catch {
          // Ignore release errors from browsers that never captured the pointer.
        }

        if (!currentState.moved && currentState.pressedIndex !== null) {
          onClipPress(currentState.pressedIndex);
        } else if (Math.abs(currentState.velocity) > 1) {
          runInertia();
        }

        currentState.pointerId = -1;
        currentState.pressedIndex = null;
        cleanupWindowListeners();
      };

      const handleWindowPointerMove = (event: PointerEvent) => {
        if (event.pointerId !== dragState.current.pointerId) return;
        event.preventDefault();
        moveTimeline(event.clientX, event.timeStamp);
      };

      const handleWindowPointerUp = (event: PointerEvent) => {
        if (event.pointerId !== dragState.current.pointerId) return;
        finishTimelineDrag(event.pointerId);
      };

      const handleWindowPointerCancel = (event: PointerEvent) => {
        if (event.pointerId !== dragState.current.pointerId) return;
        finishTimelineDrag(event.pointerId);
      };

      window.addEventListener("pointermove", handleWindowPointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handleWindowPointerUp);
      window.addEventListener("pointercancel", handleWindowPointerCancel);

      windowCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleWindowPointerMove);
        window.removeEventListener("pointerup", handleWindowPointerUp);
        window.removeEventListener("pointercancel", handleWindowPointerCancel);
      };
    },
    [cleanupWindowListeners, elementRef, onClipPress, runInertia, setScrollLeft, stopInertia],
  );

  const handlePointerCancel = useCallback(() => {
    const state = dragState.current;
    state.isDragging = false;
    state.pointerId = -1;
    state.pressedIndex = null;
    cleanupWindowListeners();
  }, [cleanupWindowListeners]);

  return {
    handlePointerDown,
    handlePointerCancel,
    stopInertia,
    cleanupWindowListeners,
  };
}
