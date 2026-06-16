'use client';

import React from 'react';
import { Video, Image as ImageIcon, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SceneLaunchMediaItem } from './useSceneLaunchBoard';

interface SceneLaunchMediaTileProps {
  item: SceneLaunchMediaItem;
  dragKey: string;
  isTimelinePlaying: boolean;
  activeItemKey: string | null;
  trimmingItemId: string | null;
  setTrimmingItemId: (id: string | null) => void;
  getGridItemTimelineState: (itemId: string, itemType: 'media' | 'collection') => { status: 'past' | 'active' | 'future' | 'idle'; elapsed: number; duration: number };
  updateSceneLaunchMediaOriginalDuration: (mediaId: string, duration: number) => void;
  updateSceneLaunchMediaDuration: (mediaId: string, duration: number) => void;
  updateSceneLaunchMediaTrim: (mediaId: string, trimStart: number, duration: number) => void;
  handleItemContextMenu: (event: React.MouseEvent, dragKey: string) => void;
  getSceneLaunchMediaTileStyle: (item: SceneLaunchMediaItem) => React.CSSProperties;
  getSceneLaunchMediaPreviewStyle: () => React.CSSProperties;
  gridDragOverInfo: { targetKey: string; position: 'before' | 'after' | 'inside' } | null;
  handleGridDragOver: (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
  handleGridDragLeave: () => void;
  handleGridDrop: (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
}

export function SceneLaunchMediaTile({
  item,
  dragKey,
  isTimelinePlaying,
  activeItemKey,
  trimmingItemId,
  setTrimmingItemId,
  getGridItemTimelineState,
  updateSceneLaunchMediaOriginalDuration,
  updateSceneLaunchMediaDuration,
  updateSceneLaunchMediaTrim,
  handleItemContextMenu,
  getSceneLaunchMediaTileStyle,
  getSceneLaunchMediaPreviewStyle,
  gridDragOverInfo,
  handleGridDragOver,
  handleGridDragLeave,
  handleGridDrop,
}: SceneLaunchMediaTileProps) {

  const formatFileSize = (mediaItem: SceneLaunchMediaItem) => {
    if (mediaItem.fileSize) {
      if (mediaItem.fileSize >= 1024 * 1024) {
        return `${(mediaItem.fileSize / (1024 * 1024)).toFixed(1)} MB`;
      }
      return `${(mediaItem.fileSize / 1024).toFixed(0)} KB`;
    }
    return mediaItem.type === 'video' ? '4.5 MB' : '320 KB';
  };

  const handleStartPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();

    const trackEl = e.currentTarget.parentElement?.querySelector('.relative.flex-1');
    if (!trackEl) return;

    const rect = trackEl.getBoundingClientRect();
    const trackWidth = rect.width;
    const trackLeft = rect.left;

    const totalDur = item.mediaDurationSeconds || item.durationSeconds || 10;
    const currentTrimStart = item.trimStartSeconds || 0;
    const currentDuration = item.durationSeconds || totalDur;
    const currentTrimEnd = currentTrimStart + currentDuration;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const clientX = moveEvent.clientX;
      const relativeX = Math.max(0, Math.min(trackWidth, clientX - trackLeft));
      const newTrimStart = (relativeX / trackWidth) * totalDur;

      const constrainedStart = Math.max(0, Math.min(currentTrimEnd - 0.5, newTrimStart));
      const newDuration = currentTrimEnd - constrainedStart;

      updateSceneLaunchMediaTrim(item.id, Number(constrainedStart.toFixed(1)), Number(newDuration.toFixed(1)));

      const videoEl = document.querySelector(`video[data-trim-video-id="${item.id}"]`) as HTMLVideoElement;
      if (videoEl) {
        videoEl.currentTime = constrainedStart;
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const handleEndPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();

    const trackEl = e.currentTarget.parentElement?.querySelector('.relative.flex-1');
    if (!trackEl) return;

    const rect = trackEl.getBoundingClientRect();
    const trackWidth = rect.width;
    const trackLeft = rect.left;

    const totalDur = item.mediaDurationSeconds || item.durationSeconds || 10;
    const currentTrimStart = item.trimStartSeconds || 0;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const clientX = moveEvent.clientX;
      const relativeX = Math.max(0, Math.min(trackWidth, clientX - trackLeft));
      const newTrimEnd = (relativeX / trackWidth) * totalDur;

      const constrainedEnd = Math.max(currentTrimStart + 0.5, Math.min(totalDur, newTrimEnd));
      const newDuration = constrainedEnd - currentTrimStart;

      updateSceneLaunchMediaTrim(item.id, currentTrimStart, Number(newDuration.toFixed(1)));

      const videoEl = document.querySelector(`video[data-trim-video-id="${item.id}"]`) as HTMLVideoElement;
      if (videoEl) {
        videoEl.currentTime = constrainedEnd;
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <article
      id={`grid-item-${dragKey}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragKey);
      }}
      onDragOver={(event) => handleGridDragOver(event, dragKey, false)}
      onDragLeave={handleGridDragLeave}
      onDrop={(event) => handleGridDrop(event, dragKey, false)}
      style={getSceneLaunchMediaTileStyle(item)}
      className={cn(
        "group cursor-grab overflow-hidden rounded-lg border border-zinc-900 bg-black transition-all duration-300 active:cursor-grabbing scroll-mt-24 relative",
        isTimelinePlaying && activeItemKey && activeItemKey !== dragKey ? "opacity-30" : "opacity-100"
      )}
      onContextMenu={(event) => handleItemContextMenu(event, dragKey)}
    >
      {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'before' && (
        <div className="absolute top-0 bottom-0 left-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
      )}
      {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'after' && (
        <div className="absolute top-0 bottom-0 right-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
      )}
      <div className="relative h-36 sm:h-40 lg:h-44" style={getSceneLaunchMediaPreviewStyle()}>
        {item.type === 'video' ? (
          <>
            <video
              data-trim-video-id={item.id}
              ref={(el) => {
                if (el) {
                  if (trimmingItemId === item.id) {
                    if (el.paused) {
                      const trimStart = item.trimStartSeconds || 0;
                      if (Math.abs(el.currentTime - trimStart) > 0.05) {
                        el.currentTime = trimStart;
                      }
                    }
                    return;
                  }
                  const state = getGridItemTimelineState(item.id, 'media');
                  const trimStart = item.trimStartSeconds || 0;

                  let targetTime = trimStart;
                  if (state.status === 'past') {
                    targetTime = trimStart + state.duration;
                  } else if (state.status === 'active') {
                    targetTime = trimStart + state.elapsed;
                  }

                  const diff = Math.abs(el.currentTime - targetTime);
                  const threshold = isTimelinePlaying ? 1.0 : 0.05;
                  if (diff > threshold) {
                    el.currentTime = targetTime;
                  }

                  if (isTimelinePlaying && state.status === 'active') {
                    if (el.paused) {
                      if (Math.abs(el.currentTime - targetTime) > 0.1) {
                        el.currentTime = targetTime;
                      }
                      el.play().catch(() => {});
                    }
                  } else {
                    if (!el.paused) {
                      el.pause();
                    }
                  }
                }
              }}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                const duration = el.duration;
                if (duration && duration > 0) {
                  const currentMediaDur = item.mediaDurationSeconds;
                  if (!currentMediaDur) {
                    updateSceneLaunchMediaOriginalDuration(item.id, duration);
                  }
                }
              }}
              src={item.previewUrl}
              className="h-full w-full object-cover"
              muted
              playsInline
              controls={trimmingItemId !== item.id}
            />
            {trimmingItemId === item.id && (
              <div className="absolute inset-0 bg-black/10 flex flex-col justify-end z-30 pointer-events-auto">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTrimmingItemId(null);
                  }}
                  className="absolute top-2 right-2 z-40 flex h-6 items-center justify-center rounded bg-indigo-600 px-2 text-[10px] font-bold text-white shadow hover:bg-indigo-500 transition-colors"
                >
                  Done
                </button>
                <div className="h-10 bg-zinc-950/90 border-t border-zinc-800/80 flex flex-col justify-between py-0.5 relative select-none">
                  <div className="h-1 w-full opacity-40" style={{
                    backgroundImage: 'repeating-linear-gradient(to right, #e4e4e7 0px, #e4e4e7 3px, transparent 3px, transparent 7px)',
                  }} />
                  <div className="relative flex-1 mx-2 bg-zinc-900/50 rounded border border-zinc-800/50 overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-black/60 z-10"
                      style={{ width: `${(item.trimStartSeconds || 0) / (item.mediaDurationSeconds || item.durationSeconds || 10) * 100}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 right-0 bg-black/60 z-10"
                      style={{
                        width: `${(1 - ((item.trimStartSeconds || 0) + (item.durationSeconds || (item.mediaDurationSeconds || 10))) / (item.mediaDurationSeconds || item.durationSeconds || 10)) * 100}%`
                      }}
                    />
                    <div
                      className="absolute top-0 bottom-0 border border-indigo-500 bg-indigo-500/10 z-10"
                      style={{
                        left: `${(item.trimStartSeconds || 0) / (item.mediaDurationSeconds || item.durationSeconds || 10) * 100}%`,
                        width: `${(item.durationSeconds || 3) / (item.mediaDurationSeconds || item.durationSeconds || 10) * 100}%`
                      }}
                    />
                  </div>
                  {(() => {
                    const totalDur = item.mediaDurationSeconds || item.durationSeconds || 10;
                    const startPercent = ((item.trimStartSeconds || 0) / totalDur) * 100;
                    const durationPercent = ((item.durationSeconds || totalDur) / totalDur) * 100;
                    return (
                      <>
                        <div
                          onPointerDown={handleStartPointerDown}
                          className="absolute top-1 bottom-1 w-3 bg-indigo-500 hover:bg-indigo-400 cursor-ew-resize z-20 flex items-center justify-center rounded-l shadow border-r border-indigo-600"
                          style={{ left: `calc(${startPercent}% + 8px)`, transform: 'translateX(-50%)' }}
                        >
                          <div className="h-3 w-0.5 bg-white/70 rounded-full" />
                        </div>
                        <div
                          onPointerDown={handleEndPointerDown}
                          className="absolute top-1 bottom-1 w-3 bg-indigo-500 hover:bg-indigo-400 cursor-ew-resize z-20 flex items-center justify-center rounded-r shadow border-l border-indigo-600"
                          style={{ left: `calc(${startPercent + durationPercent}% + 8px)`, transform: 'translateX(-50%)' }}
                        >
                          <div className="h-3 w-0.5 bg-white/70 rounded-full" />
                        </div>
                      </>
                    );
                  })()}
                  <div className="h-1 w-full opacity-40" style={{
                    backgroundImage: 'repeating-linear-gradient(to right, #e4e4e7 0px, #e4e4e7 3px, transparent 3px, transparent 7px)',
                  }} />
                </div>
              </div>
            )}
          </>
        ) : (
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute top-2 right-2 z-20 flex h-7 items-center justify-end rounded-full border border-zinc-800 bg-zinc-950/90 text-zinc-450 shadow-md backdrop-blur-[2px] transition-all duration-300 w-7 hover:w-max max-w-[28px] hover:max-w-[120px] hover:pl-2.5 pr-[7px] group/sizeicon cursor-default overflow-hidden">
          <span className="font-sans text-[10px] font-semibold select-none text-zinc-200 hidden group-hover/sizeicon:inline whitespace-nowrap pr-2">
            {formatFileSize(item)}
          </span>
          {item.type === 'video' ? (
            <Video className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-zinc-200">{item.name}</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 font-mono tracking-wider uppercase">
            <span>{item.type}</span>
            {(item.type === 'image' || item.type === 'video') && (
              <>
                <span className="text-zinc-700 font-bold select-none">•</span>
                <label className="flex items-center gap-0.5 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors focus-within:text-indigo-400 cursor-pointer">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={item.durationSeconds ?? 3}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => updateSceneLaunchMediaDuration(item.id, Number(event.target.value))}
                    className="h-4 w-6 bg-transparent text-right text-[11px] font-bold text-zinc-300 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:text-indigo-400"
                    aria-label={`${item.name} duration in seconds`}
                  />
                  <span className="text-zinc-500 select-none">s</span>
                </label>
              </>
            )}
            {item.type === 'video' && (
              <>
                <span className="text-zinc-700 font-bold select-none">•</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTrimmingItemId(trimmingItemId === item.id ? null : item.id);
                  }}
                  className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors uppercase tracking-wider",
                    trimmingItemId === item.id
                      ? "bg-indigo-600 text-white hover:bg-indigo-500"
                      : "text-zinc-400 hover:text-indigo-400 hover:bg-white/5"
                  )}
                >
                  {trimmingItemId === item.id ? 'Done' : 'Trim'}
                </button>
              </>
            )}
          </div>
        </div>
        <GripVertical className="h-4.5 w-4.5 shrink-0 text-zinc-500 group-hover:text-zinc-300" />
      </div>
    </article>
  );
}
