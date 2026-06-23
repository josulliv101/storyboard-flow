'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '../core/button';
import { cn } from '../lib/utils';

type SmoothScrollImage = {
  src: string;
  alt?: string;
  width?: number;
};

export interface SmoothScrollListProps
  extends React.HTMLAttributes<HTMLDivElement> {
  itemCount?: number;
  width?: number | string;
  images?: SmoothScrollImage[];
}

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const randomWidth = (() => {
  const cache = new Map<string, number>();

  return (id: string) => {
    const value = cache.get(id);

    if (value !== undefined) {
      return value;
    }

    const v = getRandomInt(90, 220);
    cache.set(id, v);

    return v;
  };
})();

const ITEM_HEIGHT = 120;
const MIN_ITEM_WIDTH = 72;
const MAX_ITEM_WIDTH = 420;

type DragState = {
  pointerId: number | null;
  isDragging: boolean;
  startX: number;
  lastX: number;
  lastTime: number;
  velocity: number;
  moved: boolean;
  pressedIndex: number | null;
};

type ResizeState = {
  pointerId: number | null;
  isResizing: boolean;
  index: number;
  edge: 'left' | 'right';
  startX: number;
  startWidth: number;
  startScrollLeft: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function getFallbackImage(index: number, imageWidth: number) {
  return {
    src: `https://picsum.photos/seed/smooth-scroll-${index}/${imageWidth}/${ITEM_HEIGHT}`,
    alt: `Image ${index}`,
  };
}

export function SmoothScrollList({
  itemCount = 1002,
  width = '100%',
  images,
  className,
  ...props
}: SmoothScrollListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const inertiaFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const measureFrameRef = useRef<number | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [itemWidths, setItemWidths] = useState<Record<number, number>>({});

  const dragRef = useRef<DragState>({
    pointerId: null,
    isDragging: false,
    startX: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    moved: false,
    pressedIndex: null,
  });

  const resizeRef = useRef<ResizeState>({
    pointerId: null,
    isResizing: false,
    index: -1,
    edge: 'right',
    startX: 0,
    startWidth: 0,
    startScrollLeft: 0,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    overscan: 8,
  });

  const getImageForIndex = useCallback(
    (index: number) => {
      if (!images?.length) {
        return undefined;
      }

      return images[index % images.length];
    },
    [images]
  );

  const getItemWidth = useCallback(
    (index: number) => {
      const resizedWidth = itemWidths[index];

      if (resizedWidth !== undefined) {
        return resizedWidth;
      }

      const image = getImageForIndex(index);

      return image?.width ?? randomWidth(index.toString());
    },
    [getImageForIndex, itemWidths]
  );

  const scheduleMeasure = useCallback(() => {
    if (measureFrameRef.current !== null) {
      return;
    }

    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = null;
      columnVirtualizer.measure();
    });
  }, [columnVirtualizer]);

  useLayoutEffect(() => {
    scheduleMeasure();
  }, [itemWidths, scheduleMeasure]);

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }

    lastFrameTimeRef.current = null;
  }, []);

  const clampScrollLeft = useCallback((value: number) => {
    const el = parentRef.current;

    if (!el) {
      return value;
    }

    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);

    return clamp(value, 0, maxScrollLeft);
  }, []);

  const startInertia = useCallback(
    (initialVelocity: number) => {
      const el = parentRef.current;

      if (!el) {
        return;
      }

      stopInertia();

      let velocity = initialVelocity;

      const step = (time: number) => {
        const lastTime = lastFrameTimeRef.current ?? time;
        const deltaTime = time - lastTime;

        lastFrameTimeRef.current = time;

        if (Math.abs(velocity) < 0.02) {
          stopInertia();
          return;
        }

        const before = el.scrollLeft;
        const next = clampScrollLeft(before + velocity * deltaTime);

        el.scrollLeft = next;

        const hitLeft = next <= 0 && velocity < 0;
        const hitRight =
          next >= el.scrollWidth - el.clientWidth && velocity > 0;

        if (hitLeft || hitRight) {
          stopInertia();
          return;
        }

        const friction = Math.pow(0.95, deltaTime / 16.67);
        velocity *= friction;

        inertiaFrameRef.current = requestAnimationFrame(step);
      };

      inertiaFrameRef.current = requestAnimationFrame(step);
    },
    [clampScrollLeft, stopInertia]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = parentRef.current;

      if (!el || resizeRef.current.isResizing) {
        return;
      }

      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      const target = event.target;

      const clipElement =
        target instanceof Element
          ? target.closest<HTMLElement>('[data-clip-index]')
          : null;

      const rawIndex = clipElement?.dataset.clipIndex;
      const pressedIndex =
        rawIndex === undefined ? null : Number(rawIndex);

      stopInertia();

      dragRef.current = {
        pointerId: event.pointerId,
        isDragging: true,
        startX: event.clientX,
        lastX: event.clientX,
        lastTime: performance.now(),
        velocity: 0,
        moved: false,
        pressedIndex: Number.isFinite(pressedIndex) ? pressedIndex : null,
      };

      el.setPointerCapture(event.pointerId);
      setIsDragging(true);
    },
    [stopInertia]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = parentRef.current;
      const drag = dragRef.current;

      if (!el || !drag.isDragging || drag.pointerId !== event.pointerId) {
        return;
      }

      const now = performance.now();
      const dx = event.clientX - drag.lastX;

      if (dx === 0) {
        return;
      }

      const before = el.scrollLeft;
      const next = clampScrollLeft(before - dx);

      el.scrollLeft = next;

      const deltaTime = Math.max(1, now - drag.lastTime);
      const instantVelocity = (next - before) / deltaTime;

      drag.velocity = drag.velocity * 0.2 + instantVelocity * 0.8;
      drag.lastX = event.clientX;
      drag.lastTime = now;

      if (Math.abs(event.clientX - drag.startX) > 3) {
        drag.moved = true;
        event.preventDefault();
      }
    },
    [clampScrollLeft]
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = parentRef.current;
      const drag = dragRef.current;

      if (!drag.isDragging || drag.pointerId !== event.pointerId) {
        return;
      }

      const shouldSelect = !drag.moved && drag.pressedIndex !== null;
      const selectedItemIndex = drag.pressedIndex;

      drag.isDragging = false;
      drag.pointerId = null;
      drag.pressedIndex = null;

      setIsDragging(false);

      if (el?.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }

      if (shouldSelect) {
        setSelectedIndex(selectedItemIndex);
        return;
      }

      if (Math.abs(drag.velocity) > 0.05) {
        startInertia(drag.velocity);
      }
    },
    [startInertia]
  );

  const handleClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!dragRef.current.moved) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      dragRef.current.moved = false;
    },
    []
  );

  const handleResizePointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      index: number,
      edge: 'left' | 'right'
    ) => {
      const el = parentRef.current;

      if (!el) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      stopInertia();

      dragRef.current.isDragging = false;
      dragRef.current.pointerId = null;
      dragRef.current.moved = false;
      dragRef.current.pressedIndex = null;

      resizeRef.current = {
        pointerId: event.pointerId,
        isResizing: true,
        index,
        edge,
        startX: event.clientX,
        startWidth: getItemWidth(index),
        startScrollLeft: el.scrollLeft,
      };

      setSelectedIndex(index);
      setIsDragging(false);

      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [getItemWidth, stopInertia]
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;
      const el = parentRef.current;

      if (
        !el ||
        !resize.isResizing ||
        resize.pointerId !== event.pointerId
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const dx = event.clientX - resize.startX;

      let nextWidth =
        resize.edge === 'right'
          ? resize.startWidth + dx
          : resize.startWidth - dx;

      nextWidth = clamp(nextWidth, MIN_ITEM_WIDTH, MAX_ITEM_WIDTH);

      setItemWidths((current) => {
        if (current[resize.index] === nextWidth) {
          return current;
        }

        return {
          ...current,
          [resize.index]: nextWidth,
        };
      });

      if (resize.edge === 'left') {
        const appliedDelta = resize.startWidth - nextWidth;

        el.scrollLeft = clampScrollLeft(
          resize.startScrollLeft - appliedDelta
        );
      }

      scheduleMeasure();
    },
    [clampScrollLeft, scheduleMeasure]
  );

  const endResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;

      if (!resize.isResizing || resize.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      resizeRef.current = {
        pointerId: null,
        isResizing: false,
        index: -1,
        edge: 'right',
        startX: 0,
        startWidth: 0,
        startScrollLeft: 0,
      };

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      scheduleMeasure();
    },
    [scheduleMeasure]
  );

  useEffect(() => {
    return () => {
      stopInertia();

      if (measureFrameRef.current !== null) {
        cancelAnimationFrame(measureFrameRef.current);
      }
    };
  }, [stopInertia]);

  return (
    <div
      className={cn(
        'flex flex-col gap-4 w-[600px] max-w-full p-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl font-sans',
        className
      )}
      {...props}
    >
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-zinc-200">
          Image Strip
        </h3>

        <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">
          {itemCount.toLocaleString()} Images
        </span>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-100"
          className="flex-1"
          onClick={() => {
            stopInertia();
            columnVirtualizer.scrollToIndex(100, {
              behavior: 'smooth',
              align: 'start',
            });
          }}
        >
          To 100
        </Button>

        <Button
          variant="outline"
          size="sm"
          id="scroll-to-800"
          className="flex-1"
          onClick={() => {
            stopInertia();
            columnVirtualizer.scrollToIndex(Math.min(800, itemCount - 1), {
              behavior: 'smooth',
              align: 'start',
            });
          }}
        >
          To 800
        </Button>

        <Button
          variant="outline"
          size="sm"
          id="scroll-to-0"
          className="flex-1"
          onClick={() => {
            stopInertia();
            columnVirtualizer.scrollToIndex(0, {
              behavior: 'smooth',
              align: 'start',
            });
          }}
        >
          Start
        </Button>
      </div>

      <div
        ref={parentRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={handleClickCapture}
        className={cn(
          'w-full overflow-x-auto overflow-y-hidden border border-zinc-800 rounded-lg bg-zinc-950 select-none',
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{
          width,
          height: ITEM_HEIGHT,
          contain: 'strict',
          touchAction: 'none',
          userSelect: isDragging ? 'none' : undefined,
        }}
      >
        <div
          className="relative"
          style={{
            width: `${columnVirtualizer.getTotalSize()}px`,
            height: `${ITEM_HEIGHT}px`,
          }}
        >
          {columnVirtualizer.getVirtualItems().map((virtualCol) => {
            const index = virtualCol.index;
            const imageWidth = getItemWidth(index);
            const image = getImageForIndex(index);
            const finalImage =
              image ?? getFallbackImage(index, imageWidth);
            const isSelected = selectedIndex === index;

            return (
              <div
                key={index}
                ref={columnVirtualizer.measureElement}
                data-index={index}
                data-clip-index={index}
                className={cn(
                  'absolute top-0 left-0 h-full overflow-hidden border-r border-zinc-950 bg-zinc-900',
                  'transition-[box-shadow,outline-color] duration-150',
                  isSelected
                    ? 'z-10 outline outline-2 outline-white shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_0_24px_rgba(255,255,255,0.18)]'
                    : 'z-0'
                )}
                style={{
                  width: `${imageWidth}px`,
                  transform: `translateX(${virtualCol.start}px)`,
                }}
              >
                <img
                  src={finalImage.src}
                  alt={finalImage.alt ?? `Image ${index}`}
                  draggable={false}
                  className="h-full w-full object-cover pointer-events-none"
                />

                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/50 px-2 py-1 text-[10px] text-white/80">
                  <span className="truncate">Image {index}</span>

                  <span className="shrink-0 font-mono text-white/50">
                    {imageWidth}px
                  </span>
                </div>

                {isSelected && (
                  <>
                    <div className="pointer-events-none absolute inset-0 bg-white/5" />

                    <div
                      role="slider"
                      aria-label={`Resize image ${index} from left edge`}
                      tabIndex={0}
                      onPointerDown={(event) =>
                        handleResizePointerDown(event, index, 'left')
                      }
                      onPointerMove={handleResizePointerMove}
                      onPointerUp={endResize}
                      onPointerCancel={endResize}
                      className="absolute inset-y-0 left-0 z-20 flex w-5 cursor-ew-resize items-center justify-center bg-white/20 hover:bg-white/35"
                    >
                      <div className="h-12 w-1 rounded-full bg-white shadow" />
                    </div>

                    <div
                      role="slider"
                      aria-label={`Resize image ${index} from right edge`}
                      tabIndex={0}
                      onPointerDown={(event) =>
                        handleResizePointerDown(event, index, 'right')
                      }
                      onPointerMove={handleResizePointerMove}
                      onPointerUp={endResize}
                      onPointerCancel={endResize}
                      className="absolute inset-y-0 right-0 z-20 flex w-5 cursor-ew-resize items-center justify-center bg-white/20 hover:bg-white/35"
                    >
                      <div className="h-12 w-1 rounded-full bg-white shadow" />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}