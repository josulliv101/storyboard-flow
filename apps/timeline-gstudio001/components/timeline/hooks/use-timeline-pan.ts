import { useCallback, useRef, useState } from "react";

import { DRAG_THRESHOLD_PX, THUMBNAIL_GAP, TIMELINE_ITEM_TOP } from "../constants";
import {
  getTimelineGridItemLayout,
  getTimelineGridTargetIndex,
  type TimelineGridMetrics,
} from "../timeline-grid";
import type { TimelineClip } from "../types";
import { clamp } from "../utils";
import type {
  SetScrollLeft,
  SetSelectedIndex,
  WindowDragCoordinator,
} from "./timeline-interaction-types";
import { reorderClipsFromBaseline } from "./use-timeline-clips";

const REORDER_AUTO_SCROLL_ZONE_PX = 96;
const REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME = 28;

type UseTimelinePanOptions = {
  applyClipsNow: (clips: TimelineClip[]) => void;
  clips: TimelineClip[];
  parentRef: React.RefObject<HTMLDivElement | null>;
  safePixelsPerSecond: number;
  setScrollLeft: SetScrollLeft;
  setSelectedIndex: SetSelectedIndex;
  gridMetrics: TimelineGridMetrics;
  thumbnailMode: boolean;
  thumbnailWidth: number;
  windowDrag: WindowDragCoordinator;
};

export type ReorderPreview = {
  activeClipId: string;
  dragLeft: number;
  dragTop: number;
  dragOffsetY: number;
  targetIndex: number;
};

export function useTimelinePan({
  applyClipsNow,
  clips,
  parentRef,
  safePixelsPerSecond,
  setScrollLeft,
  setSelectedIndex,
  gridMetrics,
  thumbnailMode,
  thumbnailWidth,
  windowDrag,
}: UseTimelinePanOptions) {
  const inertiaFrameRef = useRef<number | null>(null);
  const reorderAutoScrollFrameRef = useRef<number | null>(null);
  const [reorderPreview, setReorderPreview] = useState<ReorderPreview | null>(null);
  const dragState = useRef({
    isDragging: false,
    mode: "pending" as "pending" | "pan" | "reorder",
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
    lastClientX: 0,
    lastClientY: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    moved: false,
    pointerId: -1,
    pressedIndex: null as number | null,
    activeClipId: "",
    activeClipLeft: 0,
    activeClipTop: 0,
    contentOriginX: 0,
    contentOriginY: 0,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    targetIndex: -1,
    baselineClips: null as TimelineClip[] | null,
  });

  const getClipLeft = useCallback(
    (clip: TimelineClip) =>
      thumbnailMode && gridMetrics.enabled
        ? getTimelineGridItemLayout(clip.index, gridMetrics).left
        : thumbnailMode
        ? clip.index * (thumbnailWidth + THUMBNAIL_GAP)
        : clip.startTime * safePixelsPerSecond,
    [gridMetrics, safePixelsPerSecond, thumbnailMode, thumbnailWidth],
  );

  const getClipTop = useCallback(
    (clip: TimelineClip) =>
      thumbnailMode
        ? TIMELINE_ITEM_TOP +
          (gridMetrics.enabled
            ? getTimelineGridItemLayout(clip.index, gridMetrics).top
            : 0)
        : TIMELINE_ITEM_TOP,
    [gridMetrics, thumbnailMode],
  );

  const getClipWidth = useCallback(
    (clip: TimelineClip) =>
      thumbnailMode && gridMetrics.enabled
        ? getTimelineGridItemLayout(clip.index, gridMetrics).width
        : thumbnailMode
        ? thumbnailWidth
        : clip.duration * safePixelsPerSecond,
    [gridMetrics, safePixelsPerSecond, thumbnailMode, thumbnailWidth],
  );

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const stopReorderAutoScroll = useCallback(() => {
    if (reorderAutoScrollFrameRef.current !== null) {
      cancelAnimationFrame(reorderAutoScrollFrameRef.current);
      reorderAutoScrollFrameRef.current = null;
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
      const activeClip =
        pressedIndex === null
          ? null
          : clips.find((clip) => clip.index === pressedIndex) ?? null;
      const activeClipLeft = activeClip ? getClipLeft(activeClip) : 0;
      const activeClipTop = activeClip ? getClipTop(activeClip) : 0;
      const activeClipRect = clipElement?.getBoundingClientRect();
      const contentOriginX = activeClipRect
        ? activeClipRect.left - activeClipLeft
        : 0;
      const contentOriginY = activeClipRect
        ? activeClipRect.top - activeClipTop
        : 0;
      const state = dragState.current;

      Object.assign(state, {
        isDragging: true,
        mode: "pending",
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: element.scrollLeft,
        startScrollTop: gridMetrics.enabled ? window.scrollY : element.scrollTop,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
        pointerId: event.pointerId,
        pressedIndex,
        activeClipId: activeClip?.id ?? "",
        activeClipLeft,
        activeClipTop,
        contentOriginX,
        contentOriginY,
        pointerOffsetX: activeClip
          ? event.clientX - contentOriginX - activeClipLeft
          : 0,
        pointerOffsetY: activeClip
          ? event.clientY - contentOriginY - activeClipTop
          : 0,
        targetIndex: pressedIndex ?? -1,
        baselineClips: activeClip
          ? clips.map((currentClip) => ({ ...currentClip }))
          : null,
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

      const getPointerContentX = (clientX: number) => {
        const currentState = dragState.current;
        const currentElement = parentRef.current;
        const scrollDelta =
          (currentElement?.scrollLeft ?? currentState.startScrollLeft) -
          currentState.startScrollLeft;

        return clientX - currentState.contentOriginX + scrollDelta;
      };

      const getPointerContentY = (clientY: number) => {
        const currentState = dragState.current;
        const currentElement = parentRef.current;
        const scrollDelta =
          (gridMetrics.enabled
            ? window.scrollY
            : currentElement?.scrollTop ?? currentState.startScrollTop) -
          currentState.startScrollTop;

        return clientY - currentState.contentOriginY + scrollDelta;
      };

      const getReorderTargetIndex = (clientX: number, clientY: number) => {
        const currentState = dragState.current;
        if (!currentState.baselineClips || !currentState.activeClipId) {
          return currentState.pressedIndex ?? 0;
        }

        const pointerContentX = getPointerContentX(clientX);
        if (thumbnailMode && gridMetrics.enabled) {
          return getTimelineGridTargetIndex({
            contentX: pointerContentX,
            contentY: getPointerContentY(clientY) - TIMELINE_ITEM_TOP,
            itemCount: currentState.baselineClips.length,
            metrics: gridMetrics,
          });
        }

        const clipsWithoutActive = currentState.baselineClips.filter(
          (clip) => clip.id !== currentState.activeClipId,
        );
        const targetIndex = clipsWithoutActive.findIndex((clip) => {
          const center = getClipLeft(clip) + getClipWidth(clip) / 2;
          return pointerContentX < center;
        });

        return clamp(
          targetIndex === -1 ? clipsWithoutActive.length : targetIndex,
          0,
          currentState.baselineClips.length - 1,
        );
      };

      const previewReorder = (clientX: number, clientY: number) => {
        const currentState = dragState.current;
        if (!currentState.baselineClips || !currentState.activeClipId) return;

        const targetIndex = getReorderTargetIndex(clientX, clientY);
        currentState.targetIndex = targetIndex;
        currentState.lastClientX = clientX;
        currentState.lastClientY = clientY;

        setReorderPreview({
          activeClipId: currentState.activeClipId,
          dragLeft: getPointerContentX(clientX) - currentState.pointerOffsetX,
          dragTop: getPointerContentY(clientY) - currentState.pointerOffsetY,
          dragOffsetY: clientY - currentState.startY,
          targetIndex,
        });
        applyClipsNow(
          reorderClipsFromBaseline({
            activeClipId: currentState.activeClipId,
            baselineClips: currentState.baselineClips,
            targetIndex,
          }),
        );
      };

      const startReorder = (clientX: number, clientY: number) => {
        const currentState = dragState.current;
        currentState.mode = "reorder";
        currentState.moved = true;
        currentState.velocity = 0;
        if (currentState.pressedIndex !== null) {
          setSelectedIndex(currentState.pressedIndex);
        }
        previewReorder(clientX, clientY);
      };

      const getReorderAutoScrollVelocity = (clientX: number, clientY: number) => {
        const currentElement = parentRef.current;
        if (!currentElement) return { x: 0, y: 0 };

        const rect = currentElement.getBoundingClientRect();
        const maxScrollLeft = Math.max(
          0,
          currentElement.scrollWidth - currentElement.clientWidth,
        );
        const maxScrollTop = gridMetrics.enabled
          ? Math.max(
              0,
              document.documentElement.scrollHeight - window.innerHeight,
            )
          : Math.max(
              0,
              currentElement.scrollHeight - currentElement.clientHeight,
            );
        let x = 0;
        let y = 0;

        const leftDistance = clientX - rect.left;
        if (maxScrollLeft > 0 && leftDistance < REORDER_AUTO_SCROLL_ZONE_PX) {
          const intensity =
            (REORDER_AUTO_SCROLL_ZONE_PX - leftDistance) /
            REORDER_AUTO_SCROLL_ZONE_PX;
          x = -REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME * clamp(intensity, 0, 1.5);
        }

        const rightDistance = rect.right - clientX;
        if (maxScrollLeft > 0 && rightDistance < REORDER_AUTO_SCROLL_ZONE_PX) {
          const intensity =
            (REORDER_AUTO_SCROLL_ZONE_PX - rightDistance) /
            REORDER_AUTO_SCROLL_ZONE_PX;
          x = REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME * clamp(intensity, 0, 1.5);
        }

        const topDistance = clientY - rect.top;
        if (maxScrollTop > 0 && topDistance < REORDER_AUTO_SCROLL_ZONE_PX) {
          const intensity =
            (REORDER_AUTO_SCROLL_ZONE_PX - topDistance) /
            REORDER_AUTO_SCROLL_ZONE_PX;
          y = -REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME * clamp(intensity, 0, 1.5);
        }

        const bottomDistance = rect.bottom - clientY;
        if (maxScrollTop > 0 && bottomDistance < REORDER_AUTO_SCROLL_ZONE_PX) {
          const intensity =
            (REORDER_AUTO_SCROLL_ZONE_PX - bottomDistance) /
            REORDER_AUTO_SCROLL_ZONE_PX;
          y = REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME * clamp(intensity, 0, 1.5);
        }

        return { x, y };
      };

      const runReorderAutoScroll = () => {
        const currentState = dragState.current;
        const currentElement = parentRef.current;
        if (
          !currentElement ||
          !currentState.isDragging ||
          currentState.mode !== "reorder"
        ) {
          reorderAutoScrollFrameRef.current = null;
          return;
        }

        const velocity = getReorderAutoScrollVelocity(
          currentState.lastClientX,
          currentState.lastClientY,
        );
        if (velocity.x === 0 && velocity.y === 0) {
          reorderAutoScrollFrameRef.current = null;
          return;
        }

        const maxScrollLeft = Math.max(
          0,
          currentElement.scrollWidth - currentElement.clientWidth,
        );
        const currentScrollTop = gridMetrics.enabled
          ? window.scrollY
          : currentElement.scrollTop;
        const maxScrollTop = gridMetrics.enabled
          ? Math.max(
              0,
              document.documentElement.scrollHeight - window.innerHeight,
            )
          : Math.max(
              0,
              currentElement.scrollHeight - currentElement.clientHeight,
            );
        const nextScrollLeft = clamp(
          currentElement.scrollLeft + velocity.x,
          0,
          maxScrollLeft,
        );
        const nextScrollTop = clamp(
          currentScrollTop + velocity.y,
          0,
          maxScrollTop,
        );

        if (
          nextScrollLeft !== currentElement.scrollLeft ||
          nextScrollTop !== currentScrollTop
        ) {
          currentElement.scrollLeft = nextScrollLeft;
          if (gridMetrics.enabled) {
            window.scrollTo({ top: nextScrollTop });
          } else {
            currentElement.scrollTop = nextScrollTop;
          }
          setScrollLeft(nextScrollLeft);
          previewReorder(currentState.lastClientX, currentState.lastClientY);
        }

        reorderAutoScrollFrameRef.current =
          (velocity.x < 0 && nextScrollLeft === 0) ||
          (velocity.x > 0 && nextScrollLeft === maxScrollLeft) ||
          (velocity.y < 0 && nextScrollTop === 0) ||
          (velocity.y > 0 && nextScrollTop === maxScrollTop)
            ? null
            : requestAnimationFrame(runReorderAutoScroll);
      };

      const scheduleReorderAutoScroll = () => {
        if (reorderAutoScrollFrameRef.current !== null) return;
        reorderAutoScrollFrameRef.current = requestAnimationFrame(runReorderAutoScroll);
      };

      const finishTimelineDrag = (pointerId: number, timeStamp: number) => {
        const currentState = dragState.current;
        const currentElement = parentRef.current;
        if (!currentState.isDragging || !currentElement) return;

        if (
          currentState.mode === "reorder" &&
          currentState.baselineClips &&
          currentState.activeClipId
        ) {
          stopReorderAutoScroll();
          const targetIndex = currentState.targetIndex;
          applyClipsNow(
            reorderClipsFromBaseline({
              activeClipId: currentState.activeClipId,
              baselineClips: currentState.baselineClips,
              targetIndex,
            }),
          );
          setSelectedIndex(targetIndex);
          setReorderPreview(null);
        }

        currentState.isDragging = false;
        try {
          if (currentElement.hasPointerCapture(pointerId)) {
            currentElement.releasePointerCapture(pointerId);
          }
        } catch {}

        if (currentState.mode !== "reorder" && timeStamp - currentState.lastTime > 50) {
          currentState.velocity = 0;
        }

        if (!currentState.moved && currentState.pressedIndex !== null) {
          const index = currentState.pressedIndex;
          setSelectedIndex((previous) => (previous === index ? null : index));
        } else if (
          currentState.mode === "pan" &&
          Math.abs(currentState.velocity) > 1
        ) {
          runInertia();
        }

        currentState.mode = "pending";
        currentState.pointerId = -1;
        currentState.pressedIndex = null;
        currentState.activeClipId = "";
        currentState.targetIndex = -1;
        currentState.baselineClips = null;
        windowDrag.cleanup();
      };

      const onPointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== dragState.current.pointerId) return;
        pointerEvent.preventDefault();
        const currentState = dragState.current;
        const deltaX = pointerEvent.clientX - currentState.startX;
        const deltaY = pointerEvent.clientY - currentState.startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (currentState.mode === "pending") {
          if (absX <= DRAG_THRESHOLD_PX && absY <= DRAG_THRESHOLD_PX) return;

          if (
            currentState.pressedIndex !== null &&
            currentState.baselineClips &&
            deltaY < -DRAG_THRESHOLD_PX &&
            absY > absX
          ) {
            startReorder(pointerEvent.clientX, pointerEvent.clientY);
            return;
          }

          currentState.mode = "pan";
        }

        if (currentState.mode === "reorder") {
          previewReorder(pointerEvent.clientX, pointerEvent.clientY);
          scheduleReorderAutoScroll();
          return;
        }

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
        stopReorderAutoScroll();
      });
    },
    [
      applyClipsNow,
      clips,
      getClipLeft,
      getClipTop,
      getClipWidth,
      gridMetrics,
      parentRef,
      runInertia,
      setScrollLeft,
      setSelectedIndex,
      stopInertia,
      stopReorderAutoScroll,
      thumbnailMode,
      windowDrag,
    ],
  );

  const cancelPan = useCallback(() => {
    const state = dragState.current;
    state.isDragging = false;
    state.mode = "pending";
    state.pointerId = -1;
    state.pressedIndex = null;
    state.activeClipId = "";
    state.targetIndex = -1;
    state.baselineClips = null;
    stopReorderAutoScroll();
    setReorderPreview(null);
  }, [stopReorderAutoScroll]);

  return {
    handlePointerDown,
    cancelPan,
    stopInertia,
    runInertia,
    isReordering: reorderPreview !== null,
    reorderPreview,
  };
}
