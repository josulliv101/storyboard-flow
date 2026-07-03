"use client";

import {
  motion,
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
  type ComponentPropsWithoutRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Badge } from "../core/badge";
import { Button } from "../core/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "../core/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../core/empty";
import { ScrollArea, ScrollBar } from "../core/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "../core/toggle-group";
import { cn } from "../lib/utils";

export type MediaStripItem = {
  id: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  videoSrc?: string;
  width?: number;
  alt?: string;
};

export type MediaStripProps = ComponentPropsWithoutRef<"div"> & {
  actionLabel?: string;
  emptyLabel?: string;
  items: MediaStripItem[];
  onAction?: () => void;
  onSelectItem?: (item: MediaStripItem) => void;
  selectedId?: string;
  title?: string;
};

function DraggableMediaStripScrollArea({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const dragSurfaceRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const dragControls = useDragControls();
  const dragX = useMotionValue(0);
  const maxScrollLeftRef = useRef(0);
  const suppressClickUntilRef = useRef(0);
  const shouldReduceMotion = useReducedMotion();
  const [maxScrollLeft, setMaxScrollLeft] = useState(0);

  const getViewport = useCallback(
    () =>
      dragSurfaceRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      ) ?? null,
    [],
  );

  const updateScrollBounds = useCallback(() => {
    const viewport = getViewport();

    if (!viewport) {
      return 0;
    }

    const nextMaxScrollLeft = Math.max(
      0,
      viewport.scrollWidth - viewport.clientWidth,
    );

    maxScrollLeftRef.current = nextMaxScrollLeft;
    setMaxScrollLeft((currentMaxScrollLeft) =>
      currentMaxScrollLeft === nextMaxScrollLeft
        ? currentMaxScrollLeft
        : nextMaxScrollLeft,
    );

    return nextMaxScrollLeft;
  }, [getViewport]);

  useEffect(() => {
    const viewport = getViewport();

    if (!viewport) {
      return;
    }

    updateScrollBounds();

    const resizeObserver = new ResizeObserver(updateScrollBounds);

    resizeObserver.observe(viewport);

    if (viewport.firstElementChild) {
      resizeObserver.observe(viewport.firstElementChild);
    }

    return () => resizeObserver.disconnect();
  }, [getViewport, updateScrollBounds]);

  useMotionValueEvent(dragX, "change", (latestX) => {
    const viewport = getViewport();

    if (!viewport) {
      return;
    }

    const clampedX = Math.min(
      0,
      Math.max(-maxScrollLeftRef.current, latestX),
    );

    if (clampedX !== latestX) {
      dragX.set(clampedX);
    }

    viewport.scrollLeft = -clampedX;
  });

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      const target = event.target;

      if (
        target instanceof HTMLElement &&
        target.closest('[data-slot="scroll-area-scrollbar"]')
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

  return (
    <div
      ref={dragSurfaceRef}
      className="relative min-w-0 cursor-grab touch-pan-y select-none active:cursor-grabbing"
      data-testid="media-strip-drag-scroll"
      onClickCapture={(event) => {
        if (performance.now() < suppressClickUntilRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDown={handlePointerDown}
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 size-px opacity-0"
        drag="x"
        dragControls={dragControls}
        dragConstraints={{ left: -maxScrollLeft, right: 0 }}
        dragElastic={0}
        dragListener={false}
        dragMomentum={shouldReduceMotion !== true}
        dragTransition={{
          bounceDamping: 40,
          bounceStiffness: 600,
          power: 0.24,
          timeConstant: 420,
        }}
        onDrag={(_, info) => {
          if (Math.abs(info.offset.x) > 4) {
            didDragRef.current = true;
          }
        }}
        onDragEnd={() => {
          if (didDragRef.current) {
            suppressClickUntilRef.current = performance.now() + 180;
          }
        }}
        style={{ x: dragX }}
      />

      <ScrollArea
        aria-label={label}
        className="h-[11rem] w-full max-w-full overflow-hidden"
      >
        {children}
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

export function MediaStrip({
  actionLabel = "Add media",
  className,
  emptyLabel = "No media items yet.",
  items,
  onAction,
  onSelectItem,
  selectedId,
  title = "Media strip",
  ...props
}: MediaStripProps) {
  return (
    <Card
      aria-label={title}
      role="region"
      size="sm"
      className={cn(
        "min-w-0 w-full",
        className,
      )}
      {...props}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Button size="sm" variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="min-w-0">
        {items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>{title}</EmptyTitle>
              <EmptyDescription>{emptyLabel}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <DraggableMediaStripScrollArea label={`${title} items`}>
            <ToggleGroup
              aria-label={`${title} selection`}
              className="w-max max-w-none items-stretch p-1"
              value={selectedId ? [selectedId] : []}
              onValueChange={(value) => {
                const item = items.find(({ id }) => id === value[0]);

                if (item) {
                  onSelectItem?.(item);
                }
              }}
              spacing={3}
              variant="outline"
            >
              {items.map((item) => (
                <ToggleGroupItem
                  key={item.id}
                  aria-label={
                    item.subtitle
                      ? `${item.title}, ${item.subtitle}`
                      : item.title
                  }
                  className="h-auto flex-col items-stretch justify-start gap-2 whitespace-normal p-2 text-left data-pressed:border-primary data-pressed:bg-primary/5"
                  style={{ width: item.width ?? 144 }}
                  value={item.id}
                >
                  <span
                    className="block h-24 w-full overflow-hidden rounded-md bg-muted"
                    data-slot="media-strip-thumbnail"
                  >
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt={item.alt ?? item.title}
                        className="size-full object-cover"
                        draggable={false}
                        loading="lazy"
                      />
                    ) : item.videoSrc ? (
                      <video
                        src={item.videoSrc}
                        aria-hidden="true"
                        className="size-full object-cover"
                        draggable={false}
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
                        No poster
                      </span>
                    )}
                  </span>

                  <span className="min-w-0 truncate text-xs font-medium text-foreground">
                    {item.title}
                  </span>

                  {item.subtitle ? (
                    <Badge
                      className="max-w-full self-start truncate"
                      variant="secondary"
                    >
                      {item.subtitle}
                    </Badge>
                  ) : null}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </DraggableMediaStripScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
