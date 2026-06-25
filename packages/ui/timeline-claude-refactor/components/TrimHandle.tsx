import type React from "react";
import type { TrimEdge } from "../types";
import { MAX_WIDTH, MIN_WIDTH } from "../constants";
import { cn } from "../../lib/utils";

export type TrimHandleProps = {
  edge: TrimEdge;
  currentWidth: number;
} & Pick<
  React.HTMLAttributes<HTMLDivElement>,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onKeyDown"
>;

export function TrimHandle({ edge, currentWidth, ...handlers }: TrimHandleProps) {
  return (
    <div
      data-trim-handle="true"
      role="slider"
      tabIndex={0}
      aria-label={`Trim ${edge} edge`}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={Math.round(currentWidth)}
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
