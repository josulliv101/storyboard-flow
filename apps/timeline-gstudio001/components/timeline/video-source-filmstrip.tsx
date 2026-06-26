import React, { useRef } from "react";
import type {
  VideoSourceWindowEditMode,
  VideoTimelineClip,
} from "./types";
import { clamp, formatSeconds } from "./utils";
import { FILMSTRIP_HEIGHT, FILMSTRIP_MAX_FRAMES, FILMSTRIP_TARGET_FRAME_WIDTH } from "./constants";
import { cn } from "@/lib/utils";
import { VideoTile } from "./video-tile";
import {
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "./timeline-grid";

type VideoSourceFilmStripProps = {
  clip: VideoTimelineClip;
  pixelsPerSecond: number;
  gridMetrics?: TimelineGridMetrics;
  thumbnailMode?: boolean;
  thumbnailWidth?: number;
  thumbnailGap?: number;
  editingMode?: VideoSourceWindowEditMode | null;
  onSourceWindowPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    clip: VideoTimelineClip,
    mode: VideoSourceWindowEditMode,
  ) => void;
};

export function VideoSourceFilmStrip({
  clip,
  pixelsPerSecond,
  gridMetrics,
  thumbnailMode = false,
  thumbnailWidth = (200 * 16) / 9,
  thumbnailGap = 16,
  editingMode = null,
  onSourceWindowPointerDown,
}: VideoSourceFilmStripProps) {
  const gridLayout =
    thumbnailMode && gridMetrics?.enabled
      ? getTimelineGridItemLayout(clip.index, gridMetrics)
      : null;
  const selectedLeft = gridLayout
    ? gridLayout.left
    : thumbnailMode
    ? clip.index * (thumbnailWidth + thumbnailGap)
    : clip.startTime * pixelsPerSecond;
  const top = gridLayout?.top ?? 0;
  const selectedWidth = clip.duration * pixelsPerSecond;
  const sourceWidth = clip.sourceDuration * pixelsPerSecond;
  const trimInWidth = clip.trimIn * pixelsPerSecond;
  const clipDisplayWidth = gridLayout
    ? gridLayout.width
    : thumbnailMode
    ? thumbnailWidth
    : selectedWidth;
  const computedSourceLeft = selectedLeft + clipDisplayWidth / 2 - (trimInWidth + selectedWidth / 2);

  const [frozenState, setFrozenState] = React.useState<{ editingMode: VideoSourceWindowEditMode | null, sourceLeft: number | null }>({
    editingMode,
    sourceLeft: null,
  });

  if (editingMode !== frozenState.editingMode) {
    setFrozenState({
      editingMode,
      sourceLeft: (thumbnailMode && (editingMode === "left" || editingMode === "right")) ? computedSourceLeft : null,
    });
  }

  const sourceLeft = frozenState.sourceLeft !== null ? frozenState.sourceLeft : computedSourceLeft;

  const frameCount = clamp(
    Math.ceil(sourceWidth / FILMSTRIP_TARGET_FRAME_WIDTH),
    2,
    FILMSTRIP_MAX_FRAMES,
  );
  const frameEpsilon = Math.min(1 / 30, clip.sourceDuration / 100);
  const lastFrameTime = Math.max(0, clip.sourceDuration - frameEpsilon);
  const frameTimes = Array.from({ length: frameCount }, (_, index) => {
    if (frameCount === 1) return 0;
    return (index / (frameCount - 1)) * lastFrameTime;
  });

  return (
    <div
      data-video-filmstrip="true"
      data-testid="timeline-source-filmstrip"
      data-clip-index={clip.index}
      className="absolute left-0 top-0 touch-none rounded-md border border-zinc-600 bg-zinc-950 shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
      onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "move")}
      onPointerCancel={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
      style={{
        width: `${sourceWidth}px`,
        height: `${FILMSTRIP_HEIGHT}px`,
        transform: `translate(${sourceLeft}px, ${top}px)`,
        transition: editingMode ? "none" : "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        zIndex: 35,
      }}
      aria-label={`${clip.alt} full source filmstrip`}
    >
      <div className="absolute inset-0 flex overflow-hidden rounded-md touch-none select-none">
        {frameTimes.map((time, index) => (
          <div
            key={`${clip.id}-film-frame-${index}`}
            className="relative h-full min-w-0 overflow-hidden border-r border-black/70 last:border-r-0"
            style={{ flex: `0 0 ${100 / frameTimes.length}%` }}
          >
            <VideoTile
              src={clip.src}
              poster={clip.poster}
              alt={`${clip.alt} source frame ${index + 1}`}
              previewTime={time}
              sourceDuration={clip.sourceDuration}
            />
            {(index === 0 || index === frameTimes.length - 1) && (
              <span
                className={cn(
                  "absolute bottom-0.5 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] text-zinc-100",
                  index === 0 ? "left-0.5" : "right-0.5",
                )}
              >
                {index === 0 ? "start" : "end"}
              </span>
            )}
          </div>
        ))}
      </div>

      <div
        data-testid="timeline-source-window"
        className="absolute inset-y-0 cursor-grab touch-none select-none rounded-sm border-2 border-amber-300 bg-amber-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)] active:cursor-grabbing"
        style={{
          width: `${selectedWidth}px`,
          transform: `translateX(${trimInWidth}px)`,
        }}
        onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "move")}
        onPointerCancel={(e) => e.stopPropagation()}
        onDragStart={(e) => e.preventDefault()}
        title="Drag to move the source window"
      >
        <div
          data-testid="timeline-source-trim-left"
          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize touch-none rounded-l-sm bg-amber-200/90"
          onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "left")}
          title="Adjust source start"
        />
        <div
          data-testid="timeline-source-trim-right"
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none rounded-r-sm bg-amber-200/90"
          onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "right")}
          title="Adjust source end"
        />
      </div>

      <div className="pointer-events-none absolute left-1/2 top-0.5 -translate-x-1/2 rounded-full bg-black/75 px-2 py-0.5 font-mono text-[9px] text-zinc-100">
        full clip {formatSeconds(clip.sourceDuration)}
      </div>
    </div>
  );
}

type PassiveVideoFilmStripProps = {
  clip: VideoTimelineClip;
  pixelsPerSecond: number;
  gridMetrics?: TimelineGridMetrics;
  thumbnailMode?: boolean;
  thumbnailWidth?: number;
  thumbnailGap?: number;
  onPointerDown?: (
    event: React.PointerEvent<HTMLDivElement>,
    clip: VideoTimelineClip,
  ) => void;
};

export function PassiveVideoFilmStrip({
  clip,
  pixelsPerSecond,
  gridMetrics,
  thumbnailMode = false,
  thumbnailWidth = (200 * 16) / 9,
  thumbnailGap = 16,
  onPointerDown,
}: PassiveVideoFilmStripProps) {
  const gridLayout =
    thumbnailMode && gridMetrics?.enabled
      ? getTimelineGridItemLayout(clip.index, gridMetrics)
      : null;
  const left = gridLayout
    ? gridLayout.left
    : thumbnailMode
    ? clip.index * (thumbnailWidth + thumbnailGap)
    : clip.startTime * pixelsPerSecond;
  const top = gridLayout?.top ?? 0;
  const width = gridLayout
    ? gridLayout.width
    : thumbnailMode
    ? thumbnailWidth
    : clip.duration * pixelsPerSecond;
  const frameCount = clamp(
    Math.ceil(width / FILMSTRIP_TARGET_FRAME_WIDTH),
    2,
    FILMSTRIP_MAX_FRAMES,
  );
  const frameEpsilon = Math.min(1 / 30, clip.sourceDuration / 100);
  const visibleStart = clip.trimIn;
  const visibleEnd = Math.min(
    clip.sourceDuration - frameEpsilon,
    clip.trimIn + clip.duration,
  );
  const frameTimes = Array.from({ length: frameCount }, (_, index) => {
    if (frameCount === 1) return visibleStart;
    const progress = index / (frameCount - 1);
    return visibleStart + (visibleEnd - visibleStart) * progress;
  });

  return (
    <div
      data-testid="timeline-passive-filmstrip"
      data-clip-index={clip.index}
      className="absolute left-0 top-0 touch-none overflow-hidden rounded-md border border-zinc-700/80 bg-zinc-950 shadow-[0_6px_18px_rgba(0,0,0,0.28)]"
      onPointerDown={(event) => onPointerDown?.(event, clip)}
      onPointerCancel={(event) => event.stopPropagation()}
      onDragStart={(event) => event.preventDefault()}
      style={{
        width: `${width}px`,
        height: `${FILMSTRIP_HEIGHT}px`,
        transform: `translate(${left}px, ${top}px)`,
        zIndex: 10,
      }}
      aria-hidden="true"
    >
      <div className="flex h-full w-full select-none overflow-hidden rounded-md">
        {frameTimes.map((time, index) => (
          <div
            key={`${clip.id}-passive-film-frame-${index}`}
            className="relative h-full min-w-0 overflow-hidden border-r border-black/70 last:border-r-0"
            style={{ flex: `0 0 ${100 / frameTimes.length}%` }}
          >
            <VideoTile
              src={clip.src}
              poster={clip.poster}
              alt=""
              previewTime={time}
              sourceDuration={clip.sourceDuration}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
