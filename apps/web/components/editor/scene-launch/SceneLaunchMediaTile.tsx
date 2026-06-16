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
  hoveredItemKey: string | null;
  setHoveredItemKey: React.Dispatch<React.SetStateAction<string | null>>;
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
  hoveredItemKey,
  setHoveredItemKey,
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

  const [tempTrimStart, setTempTrimStart] = React.useState(item.trimStartSeconds || 0);
  const [tempDuration, setTempDuration] = React.useState(item.durationSeconds || item.mediaDurationSeconds || 3);

  React.useEffect(() => {
    if (trimmingItemId === item.id) {
      setTempTrimStart(item.trimStartSeconds || 0);
      setTempDuration(item.durationSeconds || item.mediaDurationSeconds || 3);
    }
  }, [trimmingItemId, item.id, item.trimStartSeconds, item.durationSeconds, item.mediaDurationSeconds]);

  const totalDur = item.mediaDurationSeconds || item.durationSeconds || 10;
  const startPercent = (tempTrimStart / totalDur) * 100;
  const durationPercent = (tempDuration / totalDur) * 100;

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
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = e.currentTarget;
    const pointerId = e.pointerId;

    const trackEl = e.currentTarget.closest('.trim-overlay-container');
    if (!trackEl) return;

    const rect = trackEl.getBoundingClientRect();
    const trackWidth = rect.width;
    const trackLeft = rect.left;

    const currentTrimStart = tempTrimStart;
    const currentDuration = tempDuration;
    const currentTrimEnd = currentTrimStart + currentDuration;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const clientX = moveEvent.clientX;
      const relativeX = Math.max(0, Math.min(trackWidth, clientX - trackLeft));
      const newTrimStart = (relativeX / trackWidth) * totalDur;

      const constrainedStart = Math.max(0, Math.min(currentTrimEnd - 0.5, newTrimStart));
      const newDuration = currentTrimEnd - constrainedStart;

      setTempTrimStart(Number(constrainedStart.toFixed(1)));
      setTempDuration(Number(newDuration.toFixed(1)));

      const videoEl = document.querySelector(`video[data-trim-video-id="${item.id}"]`) as HTMLVideoElement;
      if (videoEl) {
        videoEl.currentTime = constrainedStart;
      }
    };

    const onPointerUp = () => {
      target.releasePointerCapture(pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const handleEndPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = e.currentTarget;
    const pointerId = e.pointerId;

    const trackEl = e.currentTarget.closest('.trim-overlay-container');
    if (!trackEl) return;

    const rect = trackEl.getBoundingClientRect();
    const trackWidth = rect.width;
    const trackLeft = rect.left;

    const currentTrimStart = tempTrimStart;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const clientX = moveEvent.clientX;
      const relativeX = Math.max(0, Math.min(trackWidth, clientX - trackLeft));
      const newTrimEnd = (relativeX / trackWidth) * totalDur;

      const constrainedEnd = Math.max(currentTrimStart + 0.5, Math.min(totalDur, newTrimEnd));
      const newDuration = constrainedEnd - currentTrimStart;

      setTempDuration(Number(newDuration.toFixed(1)));

      const videoEl = document.querySelector(`video[data-trim-video-id="${item.id}"]`) as HTMLVideoElement;
      if (videoEl) {
        videoEl.currentTime = constrainedEnd;
      }
    };

    const onPointerUp = () => {
      target.releasePointerCapture(pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const handleCenterPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = e.currentTarget;
    const pointerId = e.pointerId;

    const trackEl = e.currentTarget.closest('.trim-overlay-container');
    if (!trackEl) return;

    const rect = trackEl.getBoundingClientRect();
    const trackWidth = rect.width;

    const initialTrimStart = tempTrimStart;
    const duration = tempDuration;
    const startX = e.clientX;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaSeconds = (deltaX / trackWidth) * totalDur;
      const targetTrimStart = initialTrimStart + deltaSeconds;

      const constrainedStart = Math.max(0, Math.min(totalDur - duration, targetTrimStart));

      setTempTrimStart(Number(constrainedStart.toFixed(1)));

      const videoEl = document.querySelector(`video[data-trim-video-id="${item.id}"]`) as HTMLVideoElement;
      if (videoEl) {
        videoEl.currentTime = constrainedStart;
      }
    };

    const onPointerUp = () => {
      target.releasePointerCapture(pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <article
      id={`grid-item-${dragKey}`}
      draggable={trimmingItemId !== item.id}
      onDragStart={(event) => {
        if (trimmingItemId === item.id) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragKey);
      }}
      onDragOver={(event) => handleGridDragOver(event, dragKey, false)}
      onDragLeave={handleGridDragLeave}
      onDrop={(event) => handleGridDrop(event, dragKey, false)}
      onMouseEnter={() => setHoveredItemKey(dragKey)}
      onMouseLeave={() => setHoveredItemKey(null)}
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
                      const trimStart = tempTrimStart;
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
              <div className="absolute inset-0 z-30 pointer-events-none select-none rounded-lg overflow-hidden">
                {/* Done/Cancel actions floating at top-right */}
                <div className="absolute top-2 right-2 z-45 flex items-center gap-1.5 pointer-events-auto">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTrimmingItemId(null); // Cancel: discard local state changes
                    }}
                    className="flex h-6 items-center justify-center rounded bg-zinc-950/90 px-2 text-[10px] font-bold text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 shadow-md border border-zinc-850 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateSceneLaunchMediaTrim(item.id, tempTrimStart, tempDuration); // Save changes
                      setTrimmingItemId(null);
                    }}
                    className="flex h-6 items-center justify-center rounded bg-indigo-600 px-2.5 text-[10px] font-bold text-white shadow-md hover:bg-indigo-500 transition-colors"
                  >
                    Done
                  </button>
                </div>

                {/* Duration Tooltip centered above active trim window */}
                <div
                  className="absolute bottom-18 z-45 bg-zinc-950/90 border border-zinc-800 text-zinc-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded shadow-lg backdrop-blur-[2px] pointer-events-none transition-all duration-75 select-none"
                  style={{
                    left: `calc(8px + ((${startPercent} + ${durationPercent} / 2) / 100) * (100% - 16px))`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  {tempDuration.toFixed(1)}s
                </div>

                {/* Floating Trim Filmstrip Track (with padding) */}
                <div className="absolute bottom-2 left-2 right-2 h-14 bg-zinc-950/95 border border-zinc-850 rounded-lg overflow-hidden z-40 flex items-stretch pointer-events-auto trim-overlay-container shadow-2xl">
                  {/* Filmstrip Background Sequence */}
                  <div className="absolute inset-0 z-0 flex items-stretch overflow-hidden">
                    {[0, 1, 2, 3, 4].map((index) => (
                      <div key={index} className="flex-1 h-full relative border-r border-zinc-950/20 last:border-r-0 overflow-hidden bg-zinc-950">
                        <video
                          ref={(el) => {
                            if (el) {
                              const targetTime = (index / 4) * totalDur;
                              if (Math.abs(el.currentTime - targetTime) > 0.1) {
                                el.currentTime = targetTime;
                              }
                            }
                          }}
                          src={item.previewUrl}
                          className="h-full w-full object-cover pointer-events-none opacity-40"
                          muted
                          playsInline
                        />
                      </div>
                    ))}
                  </div>

                  {/* Left dimmed region */}
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-black/60 z-10"
                    style={{ width: `${startPercent}%` }}
                  />

                  {/* Active trim region with white border and handles */}
                  <div
                    onPointerDown={handleCenterPointerDown}
                    className="absolute top-0 bottom-0 z-20 cursor-grab active:cursor-grabbing flex items-stretch"
                    style={{
                      left: `${startPercent}%`,
                      width: `${durationPercent}%`,
                    }}
                  >
                    {/* Left rounded white drag handle */}
                    <div
                      onPointerDown={handleStartPointerDown}
                      className="w-3.5 bg-white rounded-l-md flex items-center justify-center cursor-ew-resize select-none shrink-0 border-t-2 border-b-2 border-l-2 border-white"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="w-[1.5px] h-6 bg-zinc-400/60 rounded-full" />
                    </div>

                    {/* Top and bottom borders */}
                    <div className="flex-1 border-t-2 border-b-2 border-white pointer-events-none" />

                    {/* Right rounded white drag handle */}
                    <div
                      onPointerDown={handleEndPointerDown}
                      className="w-3.5 bg-white rounded-r-md flex items-center justify-center cursor-ew-resize select-none shrink-0 border-t-2 border-b-2 border-r-2 border-white"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="w-[1.5px] h-6 bg-zinc-400/60 rounded-full" />
                    </div>
                  </div>

                  {/* Right dimmed region */}
                  <div
                    className="absolute top-0 bottom-0 right-0 bg-black/60 z-10"
                    style={{ width: `${100 - (startPercent + durationPercent)}%` }}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-bold text-zinc-200">
            {item.type === 'video' ? (
              <Video className="h-3.5 w-3.5 shrink-0 text-amber-500/60 mr-1" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5 shrink-0 text-amber-500/60 mr-1" />
            )}
            <span className="truncate">{item.name}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 font-mono tracking-wider uppercase">
            <span>{item.type}</span>
            <span className="text-zinc-700 font-bold select-none">•</span>
            <span>{formatFileSize(item)}</span>
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
            {item.type === 'video' && trimmingItemId !== item.id && (
              <>
                <span className="text-zinc-700 font-bold select-none">•</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTrimmingItemId(item.id);
                  }}
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors uppercase tracking-wider text-zinc-400 hover:text-indigo-400 hover:bg-white/5"
                >
                  Trim
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
