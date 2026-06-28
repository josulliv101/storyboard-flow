import React from "react";
import type {
  VideoSourceWindowEditMode,
  VideoTimelineClip,
  TimelineClip,
} from "./types";
import { formatSeconds } from "./utils";
import { FILMSTRIP_HEIGHT, FILMSTRIP_MAX_FRAMES } from "./constants";
import { cn } from "@/lib/utils";
import {
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "./timeline-grid";
import {
  getCollectionClipFramePreview,
  getCollectionClipSourceDuration,
  getCollectionFramePreview,
} from "@/lib/timeline-documents";

const CLOUDINARY_CLOUD_NAME = "drrxyckxi";

function getCloudinaryVersionedVideoPath(uploadPath: string) {
  const pathWithoutQuery = uploadPath.split(/[?#]/)[0];
  const segments = pathWithoutQuery.split("/");
  const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));
  const sourceSegments = versionIndex >= 0 ? segments.slice(versionIndex) : segments;

  return sourceSegments.join("/").replace(/\.[^/.]+$/, ".jpg");
}

function handleImageFallback(
  event: React.SyntheticEvent<HTMLImageElement>,
  fallbackSrc?: string,
) {
  if (!fallbackSrc || event.currentTarget.src === fallbackSrc) return;
  event.currentTarget.src = fallbackSrc;
}

export function getThumbnailSlotCount(availableWidth: number, frameSize: number) {
  return Math.min(
    FILMSTRIP_MAX_FRAMES,
    Math.max(1, Math.floor(Math.max(1, availableWidth) / Math.max(1, frameSize))),
  );
}

export function getEndpointFrameTimes({
  count,
  endTime,
  startTime = 0,
}: {
  count: number;
  endTime: number;
  startTime?: number;
}) {
  const frameCount = Math.max(1, Math.floor(count));
  const start = Math.max(0, startTime);
  const end = Math.max(start, endTime);

  if (frameCount === 1) return [start];
  if (frameCount === 2) return [start, end];

  return Array.from({ length: frameCount }, (_, index) => {
    const progress = index / (frameCount - 1);
    return start + (end - start) * progress;
  });
}

export function getVideoThumbnailUrl(src: string, second: number, width = 480, height = 270): string {
  const roundedSecond = Math.max(0, Number(second.toFixed(2)));
  
  if (src.includes("res.cloudinary.com") && src.includes("/video/upload/")) {
    // Cloudinary native transformation for uploaded videos
    const parts = src.split("/video/upload/");
    if (parts.length === 2) {
      const baseUrl = parts[0];
      const videoPath = getCloudinaryVersionedVideoPath(parts[1]);
      return `${baseUrl}/video/upload/so_${roundedSecond},w_${width},h_${height},c_fill,q_auto,f_jpg/${videoPath}`;
    }
  }
  
  // Cloudinary fetch transformation for remote fallback videos
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/fetch/so_${roundedSecond},w_${width},h_${height},c_fill,q_auto,f_jpg/${encodeURIComponent(src)}`;
}

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
  
  const sourceDuration = clip.kind === "collection" ? getCollectionClipSourceDuration(clip) : (clip as VideoTimelineClip).sourceDuration;
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

  const frameSize = FILMSTRIP_HEIGHT;
  const frameTimes = getEndpointFrameTimes({
    count: getThumbnailSlotCount(sourceWidth, frameSize),
    endTime: Math.max(0, sourceDuration - 0.05),
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
                className="relative h-full shrink-0 overflow-hidden border-r border-black/70 last:border-r-0"
                style={{ width: `${frameSize}px` }}
              >
                {preview ? (
                  preview.kind === "video" ? (
                    <img
                      src={getVideoThumbnailUrl(preview.src, preview.previewTime)}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                      onError={(event) => handleImageFallback(event, preview.poster)}
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
                className="relative h-full shrink-0 overflow-hidden border-r border-black/70 last:border-r-0"
                style={{ width: `${frameSize}px` }}
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
              className="relative h-full shrink-0 overflow-hidden border-r border-black/70 last:border-r-0"
              style={{ width: `${frameSize}px` }}
            >
              <img
                src={getVideoThumbnailUrl((clip as VideoTimelineClip).src, time)}
                alt={`${clip.alt} source frame ${index + 1}`}
                className="h-full w-full object-cover"
                draggable={false}
                onError={(event) => handleImageFallback(event, (clip as VideoTimelineClip).poster)}
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
  
  const sourceDuration = clip.kind === "collection" ? getCollectionClipSourceDuration(clip) : (clip as VideoTimelineClip).sourceDuration;
  const trimIn = clip.kind === "collection" ? 0 : (clip as VideoTimelineClip).trimIn;

  const frameSize = FILMSTRIP_HEIGHT;
  const frameTimes = getEndpointFrameTimes({
    count: getThumbnailSlotCount(width, frameSize),
    startTime: clip.kind === "collection" ? 0 : trimIn,
    endTime:
      clip.kind === "collection"
        ? Math.max(0, clip.duration - 0.001)
        : Math.min(Math.max(0, sourceDuration - 0.05), trimIn + clip.duration),
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
              const preview = getCollectionClipFramePreview(clip, time);
              return (
                <div
                  key={`${clip.id}-passive-film-frame-${index}`}
                  className="relative h-full shrink-0 overflow-hidden border-r border-black/70 last:border-r-0"
                  style={{ width: `${frameSize}px` }}
                >
                  {preview ? (
                    preview.kind === "video" ? (
                      <img
                        src={getVideoThumbnailUrl(preview.src, preview.previewTime)}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                        onError={(event) => handleImageFallback(event, preview.poster)}
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
                  className="relative h-full shrink-0 overflow-hidden border-r border-black/70 last:border-r-0"
                  style={{ width: `${frameSize}px` }}
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
                className="relative h-full shrink-0 overflow-hidden border-r border-black/70 last:border-r-0"
                style={{ width: `${frameSize}px` }}
              >
                <img
                  src={getVideoThumbnailUrl((clip as VideoTimelineClip).src, time)}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                  onError={(event) => handleImageFallback(event, (clip as VideoTimelineClip).poster)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
