import {
  useDragControls,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

const SCROLL_CLICK_SUPPRESSION_MS = 180;
const DRAG_CLICK_THRESHOLD_PX = 4;

export function useHorizontalDragScroll(viewportRef: React.RefObject<HTMLDivElement | null>, viewportContentRef: React.RefObject<HTMLDivElement | null>) {
  const didDragRef = useRef(false);
  // Ref is used for synchronous reads inside high-frequency drag event handlers
  // to avoid triggering component re-renders.
  const maxScrollLeftRef = useRef(0);
  const suppressClickUntilRef = useRef(0);

  const dragControls = useDragControls();
  const dragX = useMotionValue(0);
  const shouldReduceMotion = useReducedMotion();

  // State is used to feed Framer Motion's dragConstraints so the gesture engine
  // clamps internal pointer offsets and avoids drag dead zones on reversal.
  const [maxScrollLeft, setMaxScrollLeft] = useState(0);

  const getViewport = useCallback(() => {
    return (
      viewportRef.current
    );
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
      viewport.scrollWidth - viewport.clientWidth,
    );

    maxScrollLeftRef.current = nextMaxScrollLeft;

    setMaxScrollLeft((current) =>
      current === nextMaxScrollLeft ? current : nextMaxScrollLeft,
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

  useMotionValueEvent(dragX, "change", (latestX) => {
    const viewport = getViewport();

    if (!viewport) return;

    const clampedX = Math.min(
      0,
      Math.max(-maxScrollLeftRef.current, latestX),
    );

    if (clampedX !== latestX) {
      dragX.set(clampedX);
      return;
    }

    viewport.scrollLeft = -clampedX;
  });

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

      didDragRef.current = false;
      dragX.set(-viewport.scrollLeft);
      dragControls.start(event, { snapToCursor: false });
    },
    [dragControls, dragX, getViewport, updateScrollBounds],
  );

  const handleDrag = useCallback((offsetX: number) => {
    if (Math.abs(offsetX) > DRAG_CLICK_THRESHOLD_PX) {
      didDragRef.current = true;
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    if (didDragRef.current) {
      suppressClickUntilRef.current =
        performance.now() + SCROLL_CLICK_SUPPRESSION_MS;
    }
  }, []);

  const handleClickCapture = useCallback((event: React.MouseEvent) => {
    if (performance.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  return {
    dragControls,
    dragX,
    maxScrollLeft,
    shouldReduceMotion,
    handlePointerDown,
    handleClickCapture,
    handleDrag,
    handleDragEnd,
  };
}
