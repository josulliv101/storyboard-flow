import React, { useRef } from "react";
import type {
  VideoSourceWindowEditMode,
  VideoTimelineClip,
  TimelineClip,
} from "./types";
import { clamp, formatSeconds } from "./utils";
import { FILMSTRIP_HEIGHT, FILMSTRIP_MAX_FRAMES, FILMSTRIP_TARGET_FRAME_WIDTH } from "./constants";
import { cn } from "@/lib/utils";
import { VideoTile } from "./video-tile";
import {
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "./timeline-grid";
import { getCollectionFramePreview } from "@/lib/timeline-documents";

type VideoSourceFilmStripProps = {
  clip: TimelineClip;
  pixelsPerSecond: number;
  gridMetrics?: TimelineGridMetrics;
  thumbnailMode?: boolean;
  thumbnailWidth?: number;
  thumbnailGap?: number;
  editingMode?: VideoSourceWindowEditMode | null;
  onSourceWindowPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
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
  
  const sourceDuration = clip.kind === "collection" ? clip.duration : (clip as VideoTimelineClip).sourceDuration;
  const trimIn = clip.kind === "collection" ? 0 : (clip as VideoTimelineClip).trimIn;

  const selectedWidth = clip.duration * pixelsPerSecond;
  const sourceWidth = sourceDuration * pixelsPerSecond;
  const trimInWidth = trimIn * pixelsPerSecond;
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
  const frameEpsilon = Math.min(1 / 30, sourceDuration / 100);
  const lastFrameTime = Math.max(0, sourceDuration - frameEpsilon);
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
        {frameTimes.map((time, index) => {
          if (clip.kind === "collection") {
            const preview = getCollectionFramePreview(clip.childTimelineId, time);
            return (
              <div
                key={`${clip.id}-film-frame-${index}`}
                className="relative h-full min-w-0 overflow-hidden border-r border-black/70 last:border-r-0"
                style={{ flex: `0 0 ${100 / frameTimes.length}%` }}
              >
                {preview ? (
                  preview.kind === "video" ? (
                    <VideoTile
                      src={preview.src}
                      poster={preview.poster}
                      alt=""
                      previewTime={preview.previewTime}
                      sourceDuration={preview.sourceDuration}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview.src}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-zinc-900/60 text-[10px] text-zinc-500 font-medium">
                    Empty
                  </div>
                )}
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
            );
          }

          if (clip.kind === "image") {
            return (
              <div
                key={`${clip.id}-film-frame-${index}`}
                className="relative h-full min-w-0 overflow-hidden border-r border-black/70 last:border-r-0"
                style={{ flex: `0 0 ${100 / frameTimes.length}%` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={(clip as any).src}
                  alt={`${clip.alt} frame ${index + 1}`}
                  className="h-full w-full object-cover"
                  draggable={false}
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
            );
          }

          return (
            <div
              key={`${clip.id}-film-frame-${index}`}
              className="relative h-full min-w-0 overflow-hidden border-r border-black/70 last:border-r-0"
              style={{ flex: `0 0 ${100 / frameTimes.length}%` }}
            >
              <VideoTile
                src={(clip as VideoTimelineClip).src}
                poster={(clip as VideoTimelineClip).poster}
                alt={`${clip.alt} source frame ${index + 1}`}
                previewTime={time}
                sourceDuration={(clip as VideoTimelineClip).sourceDuration}
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
          );
        })}
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
        {clip.kind === "collection" ? "collection" : "full clip"} {formatSeconds(sourceDuration)}
      </div>
    </div>
  );
}

type PassiveVideoFilmStripProps = {
  clip: TimelineClip;
  pixelsPerSecond: number;
  gridMetrics?: TimelineGridMetrics;
  thumbnailMode?: boolean;
  thumbnailWidth?: number;
  thumbnailGap?: number;
  onPointerDown?: (
    event: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
  ) => void;
  showFilmstrip?: boolean;
};

export function PassiveVideoFilmStrip({
  clip,
  pixelsPerSecond,
  gridMetrics,
  thumbnailMode = false,
  thumbnailWidth = (200 * 16) / 9,
  thumbnailGap = 16,
  onPointerDown,
  showFilmstrip = true,
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
  
  const sourceDuration = clip.kind === "collection" ? clip.duration : (clip as VideoTimelineClip).sourceDuration;
  const trimIn = clip.kind === "collection" ? 0 : (clip as VideoTimelineClip).trimIn;

  const frameCount = clamp(
    Math.ceil(width / FILMSTRIP_TARGET_FRAME_WIDTH),
    2,
    FILMSTRIP_MAX_FRAMES,
  );
  const frameEpsilon = Math.min(1 / 30, sourceDuration / 100);
  const visibleStart = trimIn;
  const visibleEnd = Math.min(
    sourceDuration - frameEpsilon,
    trimIn + clip.duration,
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
      className={cn(
        "absolute left-0 top-0 touch-none overflow-hidden rounded-md border shadow-[0_6px_18px_rgba(0,0,0,0.28)] transition-all duration-200 group/playbar",
        showFilmstrip 
          ? "border-zinc-700/80 bg-zinc-950" 
          : "border-zinc-700/40 bg-zinc-800/90 hover:bg-zinc-800/95 hover:border-zinc-600/70"
      )}
      onPointerDown={(event) => onPointerDown?.(event, clip)}
      onPointerCancel={(event) => event.stopPropagation()}
      onDragStart={(event) => event.preventDefault()}
      style={{
        width: `${width}px`,
        height: `${FILMSTRIP_HEIGHT}px`,
        transform: `translate(${left}px, ${top}px)`,
        zIndex: 10,
        cursor: showFilmstrip ? "ew-resize" : "pointer",
      }}
      aria-hidden="true"
    >
      {!showFilmstrip ? (
        <div className="flex h-full w-full items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5 text-zinc-400/80 transition-transform group-hover/playbar:scale-110 group-hover/playbar:text-zinc-200 duration-200"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      ) : (
        <div className="flex h-full w-full select-none overflow-hidden rounded-md">
          {frameTimes.map((time, index) => {
            if (clip.kind === "collection") {
              const preview = getCollectionFramePreview(clip.childTimelineId, time);
              return (
                <div
                  key={`${clip.id}-passive-film-frame-${index}`}
                  className="relative h-full min-w-0 overflow-hidden border-r border-black/70 last:border-r-0"
                  style={{ flex: `0 0 ${100 / frameTimes.length}%` }}
                >
                  {preview ? (
                    preview.kind === "video" ? (
                      <VideoTile
                        src={preview.src}
                        poster={preview.poster}
                        alt=""
                        previewTime={preview.previewTime}
                        sourceDuration={preview.sourceDuration}
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview.src}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    )
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-zinc-900/60 text-[10px] text-zinc-500 font-medium">
                      Empty
                    </div>
                  )}
                </div>
              );
            }

            if (clip.kind === "image") {
              return (
                <div
                  key={`${clip.id}-passive-film-frame-${index}`}
                  className="relative h-full min-w-0 overflow-hidden border-r border-black/70 last:border-r-0"
                  style={{ flex: `0 0 ${100 / frameTimes.length}%` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={(clip as any).src}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </div>
              );
            }

            return (
              <div
                key={`${clip.id}-passive-film-frame-${index}`}
                className="relative h-full min-w-0 overflow-hidden border-r border-black/70 last:border-r-0"
                style={{ flex: `0 0 ${100 / frameTimes.length}%` }}
              >
                <VideoTile
                  src={(clip as VideoTimelineClip).src}
                  poster={(clip as VideoTimelineClip).poster}
                  alt=""
                  previewTime={time}
                  sourceDuration={(clip as VideoTimelineClip).sourceDuration}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
