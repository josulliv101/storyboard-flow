import React from "react";
import { cn } from "../lib/utils";

export type TrimHandleProps = {
  edge: "left" | "right";
  currentWidth: number;
  currentDuration?: number;
} & Pick<
  React.HTMLAttributes<HTMLDivElement>,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onKeyDown"
>;

export function TrimHandle({ edge, currentWidth, currentDuration, ...handlers }: TrimHandleProps) {
  return (
    <div
      data-trim-handle="true"
      data-testid={`timeline-trim-${edge}`}
      data-trim-edge={edge}
      role="slider"
      tabIndex={0}
      aria-label={`Trim ${edge} edge`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={currentDuration !== undefined ? Math.round(currentDuration) : Math.round(currentWidth)}
      className={cn(
        "absolute top-0 z-10 flex h-full w-4 cursor-ew-resize touch-none items-center justify-center bg-amber-400 outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        edge === "left" ? "left-0 rounded-l-md" : "right-0 rounded-r-md",
      )}
      onClick={(e) => e.stopPropagation()}
      {...handlers}
    >
      <span className="h-8 w-0.5 rounded bg-zinc-900/70" />
    </div>
  );
}
