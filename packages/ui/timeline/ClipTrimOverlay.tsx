import React from "react";

import type { TimelineClip } from "./types";
import { TrimHandle } from "./TrimHandle";

export type ClipTrimOverlayProps = {
  isSelected: boolean;
  thumbnailMode?: boolean;
  isCollectionCollapseCard?: boolean;
  width: number;
  clip: TimelineClip;
  onResizeDown: (
    e: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: "left" | "right",
  ) => void;
  onResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (
    e: React.KeyboardEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: "left" | "right",
  ) => void;
};

export function ClipTrimOverlay({
  isSelected,
  thumbnailMode = false,
  isCollectionCollapseCard = false,
  width,
  clip,
  onResizeDown,
  onResizeMove,
  onResizeUp,
  onResizeKeyDown,
}: ClipTrimOverlayProps) {
  if (!isSelected) return null;

  // In thumbnail mode only render the selection ring — no trim handles.
  if (thumbnailMode) {
    return (
      <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
    );
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
      {!isCollectionCollapseCard ? (
        <>
          <TrimHandle
            edge="left"
            currentWidth={width}
            currentDuration={clip.duration}
            onPointerDown={(e) => onResizeDown(e, clip, "left")}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            onKeyDown={(e) => onResizeKeyDown(e, clip, "left")}
          />
          <TrimHandle
            edge="right"
            currentWidth={width}
            currentDuration={clip.duration}
            onPointerDown={(e) => onResizeDown(e, clip, "right")}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            onKeyDown={(e) => onResizeKeyDown(e, clip, "right")}
          />
        </>
      ) : null}
    </>
  );
}
