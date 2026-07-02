import React from "react";

import type { TimelineClip } from "../types";
import { TrimHandle } from "./TrimHandle";
import { useTimelineClipItemContext } from "./TimelineClipItemContext";
import type { TimelineClipTrimView } from "./TimelineClipItemModel";

export type ClipTrimOverlayProps = {
  clip: TimelineClip;
  view: TimelineClipTrimView;
};

export function ClipTrimOverlay({ clip, view }: ClipTrimOverlayProps) {
  const { resizeHandlers } = useTimelineClipItemContext();

  if (!view.isSelected) return null;

  // In thumbnail mode only render the selection ring, no trim handles.
  if (view.thumbnailMode) {
    return (
      <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
    );
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
      <TrimHandle
        edge="left"
        currentWidth={view.width}
        currentDuration={clip.duration}
        onPointerDown={(event) => resizeHandlers.onResizeDown(event, clip, "left")}
        onPointerMove={resizeHandlers.onResizeMove}
        onPointerUp={resizeHandlers.onResizeUp}
        onPointerCancel={resizeHandlers.onResizeUp}
        onKeyDown={(event) => resizeHandlers.onResizeKeyDown(event, clip, "left")}
      />
      <TrimHandle
        edge="right"
        currentWidth={view.width}
        currentDuration={clip.duration}
        onPointerDown={(event) => resizeHandlers.onResizeDown(event, clip, "right")}
        onPointerMove={resizeHandlers.onResizeMove}
        onPointerUp={resizeHandlers.onResizeUp}
        onPointerCancel={resizeHandlers.onResizeUp}
        onKeyDown={(event) => resizeHandlers.onResizeKeyDown(event, clip, "right")}
      />
    </>
  );
}
