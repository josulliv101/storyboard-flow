import { motion } from "motion/react";
import { type RefObject, type ReactNode } from "react";

import { ScrollArea, ScrollBar } from "../core/scroll-area";
import { useHorizontalDragScroll } from "./use-horizontal-drag-scroll";

type DraggableScrollAreaProps = {
  children: ReactNode;
  label: string;
  viewportRef: RefObject<HTMLDivElement | null>;
};

export function DraggableScrollArea({
  children,
  label,
  viewportRef,
}: DraggableScrollAreaProps) {
  const {
    dragControls,
    dragX,
    maxScrollLeft,
    shouldReduceMotion,
    handlePointerDown,
    handleClickCapture,
    handleDrag,
    handleDragEnd,
  } = useHorizontalDragScroll(viewportRef);

  return (
    <div
      className="relative min-w-0 cursor-grab touch-pan-y select-none active:cursor-grabbing"
      data-testid="media-strip-drag-scroll"
      onClickCapture={handleClickCapture}
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
          handleDrag(info.offset.x);
        }}
        onDragEnd={handleDragEnd}
        style={{ x: dragX }}
      />

      <ScrollArea
        aria-label={label}
        className="h-[11rem] w-full max-w-full overflow-hidden"
        viewportRef={viewportRef}
      >
        {children}
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
