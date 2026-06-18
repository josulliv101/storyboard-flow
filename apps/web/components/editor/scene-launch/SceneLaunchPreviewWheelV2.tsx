import React from 'react';

import { cn } from '@/lib/utils';
import type { SceneLaunchMediaItem } from './useSceneLaunchBoard';

const ITEM_GAP = 24;
const DRAG_SELECT_THRESHOLD = 5;
const MOMENTUM_MIN_VELOCITY = 0.035;
const MOMENTUM_FRICTION_PER_FRAME = 0.945;
const SNAP_DURATION_MS = 420;
const MAX_WHEEL_ANGLE = 54;
const DURATION_REFERENCE_SECONDS = 3;
const MAX_IMAGE_DURATION_SECONDS = 60 * 60;

type PreviewWheelDragState = {
  isDragging: boolean;
  startX: number;
  startOffset: number;
  lastX: number;
  lastTime: number;
  pointerId: number;
  didMove: boolean;
  velocity: number;
  targetMediaId: string | null;
};

export type SceneLaunchPreviewWheelV2Effect = 'cylinder' | 'cylinder2' | 'coverflow' | 'gallery' | 'stack';
export type SceneLaunchPreviewWheelV2Sizing = 'uniform' | 'duration';

interface SceneLaunchPreviewWheelV2Props {
  items: SceneLaunchMediaItem[];
  selectedMediaId: string;
  effect: SceneLaunchPreviewWheelV2Effect;
  sizing: SceneLaunchPreviewWheelV2Sizing;
  durationScale: number;
  selectedItemDurationSeconds?: number;
  selectedItemTrimStartSeconds?: number;
  onSelectedItemDurationChange?: (durationSeconds: number, trimStartSeconds: number) => void;
  onCenteredMediaChange: (mediaId: string) => void;
  renderSelectedItemOverlay?: (item: SceneLaunchMediaItem) => React.ReactNode;
}

const clamp = (value: number, min: number, max: number) => (
  Math.max(min, Math.min(max, value))
);

const easeOutBack = (value: number) => {
  const overshoot = 1.18;
  const shifted = value - 1;
  return 1 + shifted * shifted * ((overshoot + 1) * shifted + overshoot);
};

const getNearestIndexForOffset = (offset: number, centerPositions: number[]) => {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  centerPositions.forEach((position, index) => {
    const distance = Math.abs(position + offset);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
};

const degreesToRadians = (value: number) => (
  value * Math.PI / 180
);

export function SceneLaunchPreviewWheelV2({
  items,
  selectedMediaId,
  effect,
  sizing,
  durationScale,
  selectedItemDurationSeconds,
  selectedItemTrimStartSeconds,
  onSelectedItemDurationChange,
  onCenteredMediaChange,
  renderSelectedItemOverlay,
}: SceneLaunchPreviewWheelV2Props) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<PreviewWheelDragState>({
    isDragging: false,
    startX: 0,
    startOffset: 0,
    lastX: 0,
    lastTime: 0,
    pointerId: -1,
    didMove: false,
    velocity: 0,
    targetMediaId: null,
  });
  const momentumFrameRef = React.useRef<number | null>(null);
  const snapFrameRef = React.useRef<number | null>(null);
  const clickGuardTimeoutRef = React.useRef<number | null>(null);
  const clickGuardRef = React.useRef(false);
  const offsetRef = React.useRef(0);
  const [offset, setOffsetState] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isSpinning, setIsSpinning] = React.useState(false);
  const [viewportSize, setViewportSize] = React.useState({ width: 960, height: 520 });

  const itemHeight = Math.round(clamp(viewportSize.height - 64, 220, 620));
  const uniformItemWidth = Math.round(clamp(
    itemHeight * 1.6,
    320,
    Math.min(760, viewportSize.width * 0.72),
  ));
  const itemWidths = React.useMemo(() => {
    if (sizing === 'uniform') {
      return items.map(() => uniformItemWidth);
    }

    const durations = items.map(item => Math.max(
      0.5,
      item.id === selectedMediaId && selectedItemDurationSeconds !== undefined
        ? selectedItemDurationSeconds
        : item.durationSeconds ?? 3,
    ));
    const pixelsPerSecond = uniformItemWidth / DURATION_REFERENCE_SECONDS;

    return durations.map(duration => duration * pixelsPerSecond * durationScale);
  }, [durationScale, items, selectedItemDurationSeconds, selectedMediaId, sizing, uniformItemWidth]);
  const itemGap = ITEM_GAP * (sizing === 'duration' ? durationScale : 1);
  const itemCenterPositions = React.useMemo(() => {
    const positions: number[] = [];
    let center = 0;
    itemWidths.forEach((width, index) => {
      if (index > 0) {
        center += itemWidths[index - 1] / 2 + itemGap + width / 2;
      }
      positions.push(center);
    });
    return positions;
  }, [itemGap, itemWidths]);
  const itemStride = uniformItemWidth + itemGap;
  const maxOffset = 0;
  const minOffset = -(itemCenterPositions[itemCenterPositions.length - 1] ?? 0);
  const selectedIndex = React.useMemo(() => (
    items.findIndex(item => item.id === selectedMediaId)
  ), [items, selectedMediaId]);
  const centeredIndex = getNearestIndexForOffset(offset, itemCenterPositions);
  const centeredItem = items[centeredIndex] ?? null;
  const isWheelMoving = isDragging || isSpinning;

  const setOffset = React.useCallback((nextOffset: number) => {
    const boundedOffset = clamp(nextOffset, minOffset, maxOffset);
    offsetRef.current = boundedOffset;
    setOffsetState(boundedOffset);
  }, [maxOffset, minOffset]);

  const stopAnimation = React.useCallback(() => {
    if (momentumFrameRef.current !== null) {
      window.cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = null;
    }
    setIsSpinning(false);
  }, []);

  const snapToIndex = React.useCallback((index: number, { commit = true }: { commit?: boolean } = {}) => {
    const boundedIndex = clamp(index, 0, Math.max(0, items.length - 1));
    const targetOffset = clamp(-(itemCenterPositions[boundedIndex] ?? 0), minOffset, maxOffset);
    const startOffset = offsetRef.current;
    const startTime = performance.now();

    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = null;
    }

    const step = (time: number) => {
      const progress = clamp((time - startTime) / SNAP_DURATION_MS, 0, 1);
      const easedProgress = easeOutBack(progress);
      setOffset(startOffset + (targetOffset - startOffset) * easedProgress);

      if (progress < 1) {
        snapFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      snapFrameRef.current = null;
      setOffset(targetOffset);
      setIsSpinning(false);
      if (commit) {
        const targetItem = items[boundedIndex];
        if (targetItem && targetItem.id !== selectedMediaId) {
          onCenteredMediaChange(targetItem.id);
        }
      }
    };

    setIsSpinning(true);
    snapFrameRef.current = window.requestAnimationFrame(step);
  }, [itemCenterPositions, items, maxOffset, minOffset, onCenteredMediaChange, selectedMediaId, setOffset]);

  const snapToNearest = React.useCallback(() => {
    snapToIndex(getNearestIndexForOffset(offsetRef.current, itemCenterPositions));
  }, [itemCenterPositions, snapToIndex]);

  const snapToIndexRef = React.useRef(snapToIndex);
  React.useEffect(() => {
    snapToIndexRef.current = snapToIndex;
  }, [snapToIndex]);

  React.useEffect(() => {
    if (selectedIndex < 0) return;
    snapToIndexRef.current(selectedIndex, { commit: false });
  }, [selectedIndex, selectedMediaId]);

  const previousCenterPositionsRef = React.useRef(itemCenterPositions);
  React.useLayoutEffect(() => {
    const geometryChanged = previousCenterPositionsRef.current !== itemCenterPositions;
    previousCenterPositionsRef.current = itemCenterPositions;

    if (
      !geometryChanged ||
      selectedIndex < 0 ||
      dragRef.current.isDragging ||
      momentumFrameRef.current !== null ||
      snapFrameRef.current !== null
    ) {
      return;
    }

    setOffset(-(itemCenterPositions[selectedIndex] ?? 0));
  }, [itemCenterPositions, selectedIndex, setOffset]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;

    const updateSize = () => {
      const bounds = viewport.getBoundingClientRect();
      setViewportSize({
        width: bounds.width || 960,
        height: bounds.height || 520,
      });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => () => {
    if (momentumFrameRef.current !== null) {
      window.cancelAnimationFrame(momentumFrameRef.current);
    }
    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
    }
    if (clickGuardTimeoutRef.current !== null) {
      window.clearTimeout(clickGuardTimeoutRef.current);
    }
  }, []);

  const clearClickGuardSoon = React.useCallback(() => {
    if (clickGuardTimeoutRef.current !== null) {
      window.clearTimeout(clickGuardTimeoutRef.current);
    }
    clickGuardTimeoutRef.current = window.setTimeout(() => {
      clickGuardRef.current = false;
      clickGuardTimeoutRef.current = null;
    }, 140);
  }, []);

  const spinWithMomentum = React.useCallback((initialVelocity: number) => {
    if (Math.abs(initialVelocity) < MOMENTUM_MIN_VELOCITY) {
      snapToNearest();
      return;
    }

    let velocity = initialVelocity;
    let previousTime = performance.now();
    setIsSpinning(true);

    const step = (time: number) => {
      const deltaMs = Math.min(34, time - previousTime);
      previousTime = time;
      const nextOffset = offsetRef.current + velocity * deltaMs;
      const boundedOffset = clamp(nextOffset, minOffset, maxOffset);
      setOffset(boundedOffset);

      const hitBounds = boundedOffset !== nextOffset;
      velocity *= Math.pow(MOMENTUM_FRICTION_PER_FRAME, deltaMs / 16.67);

      if (hitBounds || Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) {
        momentumFrameRef.current = null;
        snapToNearest();
        return;
      }

      momentumFrameRef.current = window.requestAnimationFrame(step);
    };

    momentumFrameRef.current = window.requestAnimationFrame(step);
  }, [maxOffset, minOffset, setOffset, snapToNearest]);

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    stopAnimation();
    const targetMediaId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-preview-wheel-item-id]')
      ?.dataset.previewWheelItemId ?? null;

    dragRef.current = {
      isDragging: true,
      startX: event.clientX,
      startOffset: offsetRef.current,
      lastX: event.clientX,
      lastTime: performance.now(),
      pointerId: event.pointerId,
      didMove: false,
      velocity: 0,
      targetMediaId,
    };
    clickGuardRef.current = false;
    setIsDragging(true);
    viewport.setPointerCapture(event.pointerId);
  }, [stopAnimation]);

  const moveDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.isDragging || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const now = performance.now();
    const frameDeltaMs = Math.max(1, now - drag.lastTime);
    const instantVelocity = (event.clientX - drag.lastX) / frameDeltaMs;
    drag.velocity = drag.velocity * 0.72 + instantVelocity * 0.28;
    drag.lastX = event.clientX;
    drag.lastTime = now;

    if (Math.abs(deltaX) > DRAG_SELECT_THRESHOLD) {
      drag.didMove = true;
      clickGuardRef.current = true;
    }

    setOffset(drag.startOffset + deltaX);
    event.preventDefault();
  }, [setOffset]);

  const endDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag.isDragging || drag.pointerId !== event.pointerId) return;

    dragRef.current = {
      isDragging: false,
      startX: 0,
      startOffset: 0,
      lastX: 0,
      lastTime: 0,
      pointerId: -1,
      didMove: false,
      velocity: 0,
      targetMediaId: null,
    };
    setIsDragging(false);

    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }

    if (drag.didMove) {
      clickGuardRef.current = true;
      clearClickGuardSoon();
      spinWithMomentum(drag.velocity);
      return;
    }

    if (drag.targetMediaId) {
      const targetIndex = items.findIndex(item => item.id === drag.targetMediaId);
      if (targetIndex >= 0) {
        snapToIndex(targetIndex);
      }
    }
  }, [clearClickGuardSoon, items, snapToIndex, spinWithMomentum]);

  const focusItem = React.useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      viewportRef.current
        ?.querySelector<HTMLButtonElement>(`[data-preview-wheel-index="${index}"]`)
        ?.focus({ preventScroll: true });
    });
  }, []);

  const moveKeyboardFocus = React.useCallback((nextIndex: number) => {
    const boundedIndex = clamp(nextIndex, 0, Math.max(0, items.length - 1));
    stopAnimation();
    snapToIndex(boundedIndex);
    focusItem(boundedIndex);
  }, [focusItem, items.length, snapToIndex, stopAnimation]);

  const handleKeyboardNavigation = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).matches('input, select, textarea, [contenteditable="true"]')) {
      return;
    }

    const focusedIndexValue = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-preview-wheel-index]')
      ?.dataset.previewWheelIndex;
    const focusedIndex = focusedIndexValue === undefined
      ? centeredIndex
      : Number(focusedIndexValue);

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveKeyboardFocus(focusedIndex + 1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveKeyboardFocus(focusedIndex - 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      moveKeyboardFocus(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      moveKeyboardFocus(items.length - 1);
    }
  }, [centeredIndex, items.length, moveKeyboardFocus]);

  const applyDurationResize = React.useCallback((
    item: SceneLaunchMediaItem,
    edge: 'start' | 'end',
    initialDuration: number,
    initialTrimStart: number,
    deltaSeconds: number,
  ) => {
    if (!onSelectedItemDurationChange) return;

    if (edge === 'start' && item.type === 'video') {
      const nextTrimStart = clamp(
        initialTrimStart + deltaSeconds,
        0,
        initialTrimStart + initialDuration - 0.5,
      );
      const nextDuration = initialDuration - (nextTrimStart - initialTrimStart);
      onSelectedItemDurationChange(
        Number(nextDuration.toFixed(2)),
        Number(nextTrimStart.toFixed(2)),
      );
      return;
    }

    const sourceDuration = item.type === 'video'
      ? Math.max(0.5, item.mediaDurationSeconds ?? initialTrimStart + initialDuration)
      : MAX_IMAGE_DURATION_SECONDS;
    const durationDelta = edge === 'start' ? -deltaSeconds : deltaSeconds;
    const nextDuration = clamp(
      initialDuration + durationDelta,
      0.5,
      item.type === 'video' ? sourceDuration - initialTrimStart : MAX_IMAGE_DURATION_SECONDS,
    );
    onSelectedItemDurationChange(Number(nextDuration.toFixed(2)), initialTrimStart);
  }, [onSelectedItemDurationChange]);

  const beginDurationResize = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    item: SceneLaunchMediaItem,
    index: number,
    edge: 'start' | 'end',
  ) => {
    if (sizing !== 'duration' || !onSelectedItemDurationChange) return;

    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);

    const initialDuration = Math.max(
      0.5,
      selectedItemDurationSeconds ?? item.durationSeconds ?? 3,
    );
    const initialTrimStart = Math.max(
      0,
      selectedItemTrimStartSeconds ?? item.trimStartSeconds ?? 0,
    );
    const secondsPerPixel = initialDuration / Math.max(1, itemWidths[index] ?? 1);
    const startX = event.clientX;

    const onPointerMove = (moveEvent: PointerEvent) => {
      applyDurationResize(
        item,
        edge,
        initialDuration,
        initialTrimStart,
        (moveEvent.clientX - startX) * secondsPerPixel,
      );
    };
    const onPointerUp = () => {
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, [
    applyDurationResize,
    itemWidths,
    onSelectedItemDurationChange,
    selectedItemDurationSeconds,
    selectedItemTrimStartSeconds,
    sizing,
  ]);

  const handleDurationResizeKey = React.useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    item: SceneLaunchMediaItem,
    edge: 'start' | 'end',
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();

    const initialDuration = Math.max(0.5, selectedItemDurationSeconds ?? item.durationSeconds ?? 3);
    const initialTrimStart = Math.max(0, selectedItemTrimStartSeconds ?? item.trimStartSeconds ?? 0);
    const deltaSeconds = event.key === 'ArrowRight' ? 0.1 : -0.1;
    applyDurationResize(item, edge, initialDuration, initialTrimStart, deltaSeconds);
  }, [applyDurationResize, selectedItemDurationSeconds, selectedItemTrimStartSeconds]);

  if (selectedIndex < 0) return null;

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black px-4 py-6">
      <div className="h-full min-h-0 w-full overflow-hidden rounded-md border border-zinc-800/90 bg-zinc-950/85 shadow-2xl shadow-black/60 backdrop-blur-xl">
        <div
          ref={viewportRef}
          aria-label="Timeline media wheel"
          className={cn(
            "relative flex h-full min-h-0 items-center overflow-hidden",
            isDragging ? "cursor-grabbing select-none" : "cursor-grab"
          )}
          style={{
            perspective: 1200,
            touchAction: 'pan-y',
          }}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={handleKeyboardNavigation}
        >
          <div className="sr-only" aria-live="polite">
            {centeredItem ? `Centered media ${centeredItem.name}` : 'Timeline media wheel'}
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-lg border-x border-white/10 bg-zinc-800/72 shadow-[inset_14px_0_26px_rgba(0,0,0,0.28),inset_-14px_0_26px_rgba(0,0,0,0.28)]"
            style={{ width: (itemWidths[selectedIndex] ?? uniformItemWidth) + itemGap }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1/5 bg-gradient-to-r from-black/62 via-black/28 to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-1/5 bg-gradient-to-l from-black/62 via-black/28 to-transparent"
          />
          <div className="absolute inset-0 will-change-transform" style={{ transformStyle: 'preserve-3d' }}>
            {items.map((item, index) => {
              const itemWidth = itemWidths[index] ?? uniformItemWidth;
              const itemCenterOffset = (itemCenterPositions[index] ?? 0) + offset;
              const offsetFromCenter = itemCenterOffset / itemStride;
              const absOffsetFromCenter = Math.abs(offsetFromCenter);
              const distance = Math.min(4, absOffsetFromCenter);
              const isCentered = distance < 0.08;
              const isActive = item.id === selectedMediaId;
              let x = itemCenterOffset;
              let z = 0;
              let rotateY = 0;
              let translateY = 0;
              let scale = 1 - distance * 0.035;
              let opacity = Math.max(0.32, 1 - distance * 0.14);
              let brightness = Math.max(0.68, 1 - distance * 0.07);
              let shouldRender = absOffsetFromCenter < 4.2;

              if (effect === 'cylinder') {
                const angle = clamp(offsetFromCenter * MAX_WHEEL_ANGLE / 2, -MAX_WHEEL_ANGLE, MAX_WHEEL_ANGLE);
                const angleRadians = degreesToRadians(angle);
                const radius = itemStride * 3.05;
                x = Math.sin(angleRadians) * radius;
                z = (Math.cos(angleRadians) - 1) * radius * 0.72;
                rotateY = -angle;
                translateY = distance * 4;
                scale = 1 - distance * 0.04;
                opacity = Math.max(0.2, 1 - distance * 0.18);
                brightness = Math.max(0.62, 1 - distance * 0.08);
                shouldRender = absOffsetFromCenter < 3.35;
              } else if (effect === 'cylinder2') {
                const angle = clamp(offsetFromCenter * 20, -54, 54);
                const angleRadians = degreesToRadians(angle);
                const radius = itemStride * 2.9;
                const centeredItemWidth = itemWidths[centeredIndex] ?? uniformItemWidth;
                const minimumCenterSpacing = (itemWidth + centeredItemWidth) / 2 + itemGap;
                x = Math.sin(angleRadians) * radius;
                if (absOffsetFromCenter >= 0.5) {
                  x =
                    Math.sign(offsetFromCenter) *
                    Math.max(
                      Math.abs(x),
                      minimumCenterSpacing +
                        Math.max(0, absOffsetFromCenter - 1) * itemWidth * 0.74,
                    );
                }
                z = (Math.cos(angleRadians) - 1) * radius * 0.36;
                rotateY = -angle * 0.18;
                translateY = 0;
                scale = 1 - distance * 0.065;
                opacity = Math.max(0.16, 1 - distance * 0.22);
                brightness = Math.max(0.54, 1 - distance * 0.1);
                shouldRender = absOffsetFromCenter < 3.7;
              } else if (effect === 'coverflow') {
                x = itemCenterOffset * 0.82;
                z = -distance * 74;
                rotateY = clamp(offsetFromCenter * -36, -58, 58);
                translateY = distance * 5;
                scale = 1 - distance * 0.055;
                opacity = Math.max(0.3, 1 - distance * 0.15);
                brightness = Math.max(0.66, 1 - distance * 0.075);
              } else if (effect === 'stack') {
                x = itemCenterOffset * 0.58;
                z = -distance * 96;
                rotateY = clamp(offsetFromCenter * -10, -20, 20);
                translateY = distance * 7;
                scale = 1 - distance * 0.08;
                opacity = Math.max(0.24, 1 - distance * 0.2);
                brightness = Math.max(0.58, 1 - distance * 0.1);
                shouldRender = absOffsetFromCenter < 4.8;
              }

              return (
                <div
                  key={`${item.id}-${index}`}
                  className={cn(
                    "group/nav absolute left-1/2 top-1/2 shrink-0 overflow-hidden rounded-md border bg-zinc-900 shadow-lg",
                    isWheelMoving
                      ? "transition-[border-color,box-shadow] duration-100"
                      : "transition-[border-color,box-shadow,filter,opacity,transform] duration-150",
                    isActive
                      ? "border-indigo-300 shadow-indigo-500/25 ring-1 ring-indigo-400/50"
                      : "border-zinc-700/70 hover:border-zinc-500 hover:shadow-xl hover:ring-1 hover:ring-indigo-500/40"
                  )}
                  style={{
                    filter: `brightness(${brightness})`,
                    width: itemWidth,
                    height: itemHeight,
                    opacity,
                    pointerEvents: shouldRender ? 'auto' : 'none',
                    transform: `translate3d(calc(-50% + ${x}px), calc(-50% + ${translateY}px), ${z}px) rotateY(${rotateY}deg) scale(${scale})`,
                    transformOrigin: 'center center',
                    zIndex: Math.round(100 - distance * 10),
                  }}
                >
                  <button
                    type="button"
                    title={item.name}
                    aria-current={isActive ? 'true' : undefined}
                    aria-label={`Preview ${item.name}`}
                    data-preview-wheel-item-id={item.id}
                    data-preview-wheel-index={index}
                    onClick={(event) => {
                      if (clickGuardRef.current) {
                        event.preventDefault();
                        return;
                      }
                      if (event.detail === 0) {
                        snapToIndex(index);
                      }
                    }}
                    className="absolute inset-0 overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                  >
                    {item.type === 'video' ? (
                      <video src={item.previewUrl} className="pointer-events-none h-full w-full object-cover" muted playsInline />
                    ) : (
                      <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                    )}
                    <div className={cn(
                      "absolute inset-0 transition-colors",
                      isActive ? "bg-indigo-500/10" : "bg-black/30 group-hover/nav:bg-black/10"
                    )} />
                    {!isActive && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2.5">
                        <div className="truncate text-xs font-black uppercase text-zinc-100">
                          {item.name}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-1 font-mono text-[9px] uppercase tracking-widest text-zinc-400">
                          <span>{item.type}</span>
                          {isCentered && <span className="text-indigo-200">Centered</span>}
                        </div>
                      </div>
                    )}
                  </button>
                  {isActive && renderSelectedItemOverlay && (
                    <div
                      className="pointer-events-none absolute inset-0 z-20"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {renderSelectedItemOverlay(item)}
                    </div>
                  )}
                  {isActive && sizing === 'duration' && onSelectedItemDurationChange && (
                    <>
                      <button
                        type="button"
                        aria-label={`Trim start of ${item.name}`}
                        title="Trim start"
                        onPointerDown={(event) => beginDurationResize(event, item, index, 'start')}
                        onKeyDown={(event) => handleDurationResizeKey(event, item, 'start')}
                        onClick={(event) => event.stopPropagation()}
                        className="absolute inset-y-0 left-0 z-30 flex w-4 cursor-ew-resize touch-none items-center justify-center border-y-2 border-l-2 border-white bg-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.35),4px_0_14px_rgba(0,0,0,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                      >
                        <span className="h-9 w-0.5 rounded-full bg-zinc-500/70" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Trim end of ${item.name}`}
                        title="Trim end"
                        onPointerDown={(event) => beginDurationResize(event, item, index, 'end')}
                        onKeyDown={(event) => handleDurationResizeKey(event, item, 'end')}
                        onClick={(event) => event.stopPropagation()}
                        className="absolute inset-y-0 right-0 z-30 flex w-4 cursor-ew-resize touch-none items-center justify-center border-y-2 border-r-2 border-white bg-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.35),-4px_0_14px_rgba(0,0,0,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                      >
                        <span className="h-9 w-0.5 rounded-full bg-zinc-500/70" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
