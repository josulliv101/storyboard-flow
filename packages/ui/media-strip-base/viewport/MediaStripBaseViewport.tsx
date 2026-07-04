import { ScrollArea } from "@base-ui/react/scroll-area";
import type { BaseUIEvent } from "@base-ui/react/internals/types";
import * as React from "react";

import { MediaStripBaseViewportDataAttributes } from "./MediaStripBaseViewportDataAttributes";

/**
 * The draggable scrollable viewport for media strip content.
 * Renders an unstyled Base UI `ScrollArea.Viewport` element.
 */
export const MediaStripBaseViewport = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseViewport.Props
>(function MediaStripBaseViewport(
  {
    inertialDrag = false,
    momentumFriction = 0.94,
    minMomentumVelocity = 0.01,
    onClickCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    ...props
  },
  forwardedRef,
) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const dragStateRef = React.useRef({
    active: false,
    moved: false,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
  });
  const [isDragging, setIsDragging] = React.useState(false);

  React.useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const setViewportRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;

      if (typeof forwardedRef === "function") {
        forwardedRef(node);
        return;
      }

      if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef],
  );

  function stopMomentum() {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }

  function startMomentum(initialVelocity: number) {
    let velocity = initialVelocity;

    const animate = () => {
      const viewportElement = viewportRef.current;
      if (!viewportElement || Math.abs(velocity) < minMomentumVelocity) {
        animationFrameRef.current = null;
        return;
      }

      viewportElement.scrollLeft -= velocity * 16;
      velocity *= momentumFriction;
      animationFrameRef.current = window.requestAnimationFrame(animate);
    };

    animationFrameRef.current = window.requestAnimationFrame(animate);
  }

  function handlePointerDown(
    event: BaseUIEvent<React.PointerEvent<HTMLDivElement>>,
  ) {
    onPointerDown?.(event);
    if (!inertialDrag || event.defaultPrevented || event.button !== 0) {
      return;
    }

    stopMomentum();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      active: true,
      moved: false,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0,
    };
    setIsDragging(true);
  }

  function handlePointerMove(
    event: BaseUIEvent<React.PointerEvent<HTMLDivElement>>,
  ) {
    onPointerMove?.(event);

    const viewportElement = viewportRef.current;
    const dragState = dragStateRef.current;
    if (!inertialDrag || !viewportElement || !dragState.active) {
      return;
    }

    const now = performance.now();
    const deltaX = event.clientX - dragState.lastX;
    const deltaTime = Math.max(now - dragState.lastTime, 1);

    if (Math.abs(deltaX) > 2) {
      dragState.moved = true;
    }

    viewportElement.scrollLeft -= deltaX;
    dragState.velocity = deltaX / deltaTime;
    dragState.lastX = event.clientX;
    dragState.lastTime = now;
  }

  function endDrag(event: BaseUIEvent<React.PointerEvent<HTMLDivElement>>) {
    const nextVelocity = dragStateRef.current.velocity;
    const wasActive = dragStateRef.current.active;

    dragStateRef.current.active = false;
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (wasActive && inertialDrag) {
      startMomentum(nextVelocity);
    }
  }

  function handlePointerUp(
    event: BaseUIEvent<React.PointerEvent<HTMLDivElement>>,
  ) {
    onPointerUp?.(event);
    endDrag(event);
  }

  function handlePointerCancel(
    event: BaseUIEvent<React.PointerEvent<HTMLDivElement>>,
  ) {
    onPointerCancel?.(event);
    endDrag(event);
  }

  function handleClickCapture(
    event: BaseUIEvent<React.MouseEvent<HTMLDivElement>>,
  ) {
    onClickCapture?.(event);
    if (!dragStateRef.current.moved) {
      return;
    }

    dragStateRef.current.moved = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <ScrollArea.Viewport
      ref={setViewportRef}
      {...props}
      data-dragging={isDragging ? "" : undefined}
      data-inertial-drag={inertialDrag ? "" : undefined}
      onClickCapture={handleClickCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
});

export interface MediaStripBaseViewportState
  extends ScrollArea.Viewport.State {
  /**
   * Whether the user is currently dragging the viewport.
   */
  dragging: boolean;
}

export interface MediaStripBaseViewportProps
  extends ScrollArea.Viewport.Props {
  /**
   * Enables pointer drag scrolling with decaying momentum after release.
   *
   * @default false
   */
  inertialDrag?: boolean | undefined;
  /**
   * Multiplier applied to velocity on each animation frame.
   *
   * @default 0.94
   */
  momentumFriction?: number | undefined;
  /**
   * Velocity threshold at which momentum stops.
   *
   * @default 0.01
   */
  minMomentumVelocity?: number | undefined;
}

export namespace MediaStripBaseViewport {
  export type State = MediaStripBaseViewportState;
  export type Props = MediaStripBaseViewportProps;
}
