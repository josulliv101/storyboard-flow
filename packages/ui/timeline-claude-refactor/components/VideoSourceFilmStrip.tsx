import type React from "react";
import type { TimelineClip, VideoSourceWindowEditMode } from "../types";
import { clamp, formatSeconds } from "../utils/math";
import {
  FILMSTRIP_HEIGHT,
  FILMSTRIP_MAX_FRAMES,
  FILMSTRIP_TARGET_FRAME_WIDTH,
} from "../constants";
import { cn } from "../../lib/utils";
import { VideoTile } from "./VideoTile";

export type VideoSourceFilmStripProps = {
  clip: TimelineClip;
  pixelsPerSecond: number;
  onSourceWindowPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
    mode: VideoSourceWindowEditMode,
  ) => void;
};

export function VideoSourceFilmStrip({
  clip,
  pixelsPerSecond,
  onSourceWindowPointerDown,
}: VideoSourceFilmStripProps) {
  const selectedLeft = clip.startTime * pixelsPerSecond;
  const selectedWidth = clip.duration * pixelsPerSecond;
  const sourceWidth = clip.sourceDuration * pixelsPerSecond;
  const trimInWidth = clip.trimIn * pixelsPerSecond;
  const sourceLeft = selectedLeft - trimInWidth;
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
      className="absolute left-0 top-0 touch-none rounded-md border border-zinc-600 bg-zinc-950 shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
      onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "center")}
      style={{
        width: `${sourceWidth}px`,
        height: `${FILMSTRIP_HEIGHT}px`,
        transform: `translateX(${sourceLeft}px)`,
        zIndex: 35,
      }}
      aria-label={`${clip.alt} full source filmstrip`}
    >
      <div className="absolute inset-0 flex overflow-hidden rounded-md">
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
        className="absolute inset-y-0 cursor-grab touch-none rounded-sm border-2 border-amber-300 bg-amber-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)] active:cursor-grabbing"
        style={{
          width: `${selectedWidth}px`,
          transform: `translateX(${trimInWidth}px)`,
        }}
        onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "move")}
        title="Drag to move the source window"
      >
        <div
          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-sm bg-amber-200/90"
          onPointerDown={(e) => onSourceWindowPointerDown(e, clip, "left")}
          title="Adjust source start"
        />
        <div
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-sm bg-amber-200/90"
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
