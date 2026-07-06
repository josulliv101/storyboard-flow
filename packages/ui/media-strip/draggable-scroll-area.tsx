import { type RefObject, type ReactNode } from "react";

import { ScrollArea, ScrollBar } from "../core/scroll-area";
import { useHorizontalDragScroll } from "./use-horizontal-drag-scroll";

type DraggableScrollAreaProps = {
  children: ReactNode;
  label: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportContentRef: RefObject<HTMLDivElement | null>;
  testId?: string;
};

export function DraggableScrollArea({
  children,
  label,
  viewportRef,
  viewportContentRef,
  testId,
}: DraggableScrollAreaProps) {
  const {
    handlePointerDown,
    handleClickCapture,
  } = useHorizontalDragScroll(viewportRef, viewportContentRef);

  const derivedTestId = testId ?? `media-strip-drag-scroll-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div
      className="relative min-w-0 cursor-grab touch-pan-y select-none active:cursor-grabbing"
      data-testid={derivedTestId}
      // Intercepts click events at the capture phase to suppress click propagation
      // for a short window after a drag finishes, preventing accidental item selection.
      onClickCapture={handleClickCapture}
      onPointerDown={handlePointerDown}
    >
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
