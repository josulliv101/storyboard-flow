'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, Grid2X2, Image as ImageIcon, Pause, Play, Plus, Video } from 'lucide-react';

import { Button } from '@storyboard/ui';
import { CollectionFrame } from './Frame';
import { CollectionProgressBar } from './CollectionProgressBar';
import { cn } from '@/lib/utils';
import type { ClipType } from '@/lib/timeline-context';
import { VIDEO_PLACEHOLDER } from './scene-launch/useSceneLaunchBoard';

type SceneLaunchBoardGridProps = {
  sceneLaunchGridItems: any[];
  activeItemKey: string | null;
  isTimelinePlaying: boolean;
  gridDragOverInfo: { targetKey: string; position: 'before' | 'after' | 'inside' } | null;
  trimmingItemId: string | null;
  sceneLaunchPreviewHover: { collectionId: string; startedAt: number } | null;
  sceneLaunchManuallyPaused: string | null;
  sceneLaunchPreviewPausedOffset: number;
  collectionScrubbingId: string | null;
  handleAddClipClick: (type: ClipType) => void;
  createSceneLaunchBeat: () => void;
  handleGridDragOver: (event: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
  handleGridDragLeave: () => void;
  handleGridDrop: (event: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
  getSceneLaunchMediaTileStyle: (item: any) => React.CSSProperties;
  getSceneLaunchMediaPreviewStyle: () => React.CSSProperties;
  getGridItemTimelineState: (id: string, type: 'media' | 'collection') => any;
  updateSceneLaunchMediaOriginalDuration: (mediaId: string, originalDuration: number) => void;
  setTrimmingItemId: React.Dispatch<React.SetStateAction<string | null>>;
  handleStartPointerDown: (event: React.PointerEvent<HTMLDivElement>, item: any) => void;
  handleEndPointerDown: (event: React.PointerEvent<HTMLDivElement>, item: any) => void;
  formatFileSize: (item: { type: 'image' | 'video'; fileSize?: number }) => string;
  updateSceneLaunchMediaDuration: (mediaId: string, durationSeconds: number) => void;
  getSceneLaunchCollectionPreview: (collection: any) => any;
  getRecursiveMediaItems: (collection: any) => any[];
  getSceneLaunchCollectionTileStyle: () => React.CSSProperties;
  openBeatDetail: (beatId: string) => void;
  setSceneLaunchPreviewPausedOffset: React.Dispatch<React.SetStateAction<number>>;
  setSceneLaunchManuallyPaused: React.Dispatch<React.SetStateAction<string | null>>;
  setSceneLaunchPreviewHover: React.Dispatch<React.SetStateAction<{ collectionId: string; startedAt: number } | null>>;
  setCollectionScrubbingId: React.Dispatch<React.SetStateAction<string | null>>;
  syncTimelinePlayheadToCollectionPreview: (beatId: string, elapsedSeconds: number) => void;
  changeCollectionPreviewItem: (beat: any, direction: 'next' | 'prev') => void;
  getRecursiveCollectionDuration: (collection: any) => number;
  handleItemContextMenu: (event: React.MouseEvent, dragKey: string) => void;
};

export function SceneLaunchBoardGrid({
  sceneLaunchGridItems,
  activeItemKey,
  isTimelinePlaying,
  gridDragOverInfo,
  trimmingItemId,
  sceneLaunchPreviewHover,
  sceneLaunchManuallyPaused,
  sceneLaunchPreviewPausedOffset,
  collectionScrubbingId,
  handleAddClipClick,
  createSceneLaunchBeat,
  handleGridDragOver,
  handleGridDragLeave,
  handleGridDrop,
  getSceneLaunchMediaTileStyle,
  getSceneLaunchMediaPreviewStyle,
  getGridItemTimelineState,
  updateSceneLaunchMediaOriginalDuration,
  setTrimmingItemId,
  handleStartPointerDown,
  handleEndPointerDown,
  formatFileSize,
  updateSceneLaunchMediaDuration,
  getSceneLaunchCollectionPreview,
  getRecursiveMediaItems,
  getSceneLaunchCollectionTileStyle,
  openBeatDetail,
  setSceneLaunchPreviewPausedOffset,
  setSceneLaunchManuallyPaused,
  setSceneLaunchPreviewHover,
  setCollectionScrubbingId,
  syncTimelinePlayheadToCollectionPreview,
  changeCollectionPreviewItem,
  getRecursiveCollectionDuration,
  handleItemContextMenu,
}: SceneLaunchBoardGridProps) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Scene board</h2>
          <p className="mt-1 text-[11px] text-zinc-700">Media items and collections share one rearrangeable grid.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
            onClick={() => handleAddClipClick('image')}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Media
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
            onClick={createSceneLaunchBeat}
          >
            <Grid2X2 className="h-3.5 w-3.5" />
            Add Collection
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        {sceneLaunchGridItems.map((gridItem, index) => {
          const dragKey = `${gridItem.type}:${gridItem.id}`;

          if (gridItem.type === 'media') {
            const item = gridItem.item;
            return (
              <article
                key={dragKey}
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
                    (() => {
                      const state = getGridItemTimelineState(item.id, 'media');
                      const shouldRenderVideo = state.status === 'active' || trimmingItemId === item.id;
                      if (shouldRenderVideo) {
                        return (
                          <>
                            <video
                              data-trim-video-id={item.id}
                              poster={item.posterUrl}
                              preload="metadata"
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
                                          onPointerDown={(e) => handleStartPointerDown(e, item)}
                                          className="absolute top-1 bottom-1 w-3 bg-indigo-500 hover:bg-indigo-400 cursor-ew-resize z-20 flex items-center justify-center rounded-l shadow border-r border-indigo-600"
                                          style={{ left: `calc(${startPercent}% + 8px)`, transform: 'translateX(-50%)' }}
                                        >
                                          <div className="h-3 w-0.5 bg-white/70 rounded-full" />
                                        </div>
                                        <div
                                          onPointerDown={(e) => handleEndPointerDown(e, item)}
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
                        );
                      }
                      return (
                        <img
                          src={item.posterUrl || VIDEO_PLACEHOLDER}
                          className="h-full w-full object-cover"
                          alt=""
                        />
                      );
                    })()
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
                          <span className="text-zinc-700 font-bold select-none">&bull;</span>
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
                          <span className="text-zinc-700 font-bold select-none">&bull;</span>
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
                </div>
              </article>
            );
          }

          const beat = gridItem.collection;
          const preview = getSceneLaunchCollectionPreview(beat);
          const orderedMediaItems = getRecursiveMediaItems(beat);
          const totalItems = orderedMediaItems.length;
          const activeItemIndex = preview ? orderedMediaItems.findIndex(x => x.id === preview.item.id) + 1 : 0;
          return (
            <article
              key={dragKey}
              id={`grid-item-${dragKey}`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', dragKey);
              }}
              onDragOver={(event) => handleGridDragOver(event, dragKey, true)}
              onDragLeave={handleGridDragLeave}
              onDrop={(event) => handleGridDrop(event, dragKey, true)}
              style={getSceneLaunchCollectionTileStyle()}
              className={cn(
                "group cursor-grab overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950/80 transition-all duration-300 active:cursor-grabbing scroll-mt-24 relative",
                isTimelinePlaying && activeItemKey && activeItemKey !== dragKey ? "opacity-30" : "opacity-100",
                gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'inside' && "ring-2 ring-indigo-500 border-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.3)]"
              )}
              onContextMenu={(event) => handleItemContextMenu(event, dragKey)}
            >
              {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'before' && (
                <div className="absolute top-0 bottom-0 left-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
              )}
              {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'after' && (
                <div className="absolute top-0 bottom-0 right-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
              )}
              <div
                className="relative bg-black h-36 sm:h-40 lg:h-44"
                style={getSceneLaunchMediaPreviewStyle()}
              >
                <button
                  type="button"
                  className="block h-full w-full"
                  onClick={() => openBeatDetail(beat.id)}
                  aria-label={`Open ${beat.name}`}
                >
                  {preview ? (
                    <CollectionFrame
                      collectionId={beat.id}
                      orderedItems={orderedMediaItems}
                      elapsedSeconds={preview.totalElapsedSeconds}
                      isPlaying={preview.isPlaying}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center text-center text-zinc-600 transition-colors hover:bg-white/[0.03] hover:text-zinc-300">
                      <Grid2X2 className="h-6 w-6" />
                      <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest">Open collection</span>
                    </div>
                  )}
                </button>
                {preview ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (preview.isPlaying) {
                        const mediaItems = getRecursiveMediaItems(beat);
                        const totalDuration = mediaItems.reduce((sum, item) => sum + (item.durationSeconds || 3), 0);
                        const currentElapsed = totalDuration > 0 && sceneLaunchPreviewHover
                          ? ((Date.now() - sceneLaunchPreviewHover.startedAt) / 1000) % totalDuration
                          : 0;

                        setSceneLaunchPreviewPausedOffset(currentElapsed);
                        setSceneLaunchManuallyPaused(beat.id);

                        const video = event.currentTarget.parentElement?.querySelector('video');
                        if (video) {
                          video.pause();
                        }
                      } else {
                        const resumedStartedAt = Date.now() - (sceneLaunchPreviewPausedOffset * 1000);
                        setSceneLaunchManuallyPaused(null);
                        setSceneLaunchPreviewHover({ collectionId: beat.id, startedAt: resumedStartedAt });
                      }
                    }}
                    className={cn(
                      "absolute top-2 right-2 z-20 flex h-7 items-center justify-center border border-zinc-800 bg-zinc-950/90 text-zinc-350 shadow-md backdrop-blur-[2px] transition-all cursor-pointer hover:border-zinc-600 hover:bg-zinc-900 hover:scale-105 outline-none p-0",
                      preview.isPlaying
                        ? "rounded-full px-2.5 gap-1.5 border-indigo-500/80 bg-zinc-950 opacity-100"
                        : "w-7 h-7 rounded-full opacity-0 group-hover:opacity-100"
                    )}
                  >
                    {preview.isPlaying ? (
                      <>
                        <span className="font-mono text-[10px] select-none text-zinc-300">
                          {Math.min(preview.durationSeconds, preview.elapsedSeconds).toFixed(1)}s / {preview.durationSeconds.toFixed(1)}s
                        </span>
                        <Pause className="h-3 w-3 animate-pulse text-indigo-400 fill-current" />
                      </>
                    ) : (
                      <Play className="h-3 w-3 fill-current text-zinc-350 ml-0.5" />
                    )}
                  </button>
                ) : null}
                {preview ? (
                  <div
                    className={cn(
                      "absolute bottom-0 left-0 right-0 h-[3px] z-30 transition-opacity duration-300 pointer-events-none progress-bar-container",
                      (preview.isPlaying || sceneLaunchPreviewHover?.collectionId === beat.id || (sceneLaunchManuallyPaused === beat.id && sceneLaunchPreviewPausedOffset > 0))
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    )}
                  >
                    <div className="w-full h-full bg-zinc-950/40 relative">
                      <CollectionProgressBar
                        itemStartedAt={preview.isPlaying ? (Date.now() - preview.elapsedSeconds * 1000) : Date.now()}
                        durationSeconds={preview.durationSeconds}
                        isPlaying={preview.isPlaying}
                        pausedOffset={preview.elapsedSeconds}
                        isScrubbing={collectionScrubbingId === beat.id}
                      >
                        {sceneLaunchManuallyPaused === beat.id && (
                          <div
                            className="absolute left-full top-[1.5px] -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] z-40 cursor-grab active:cursor-grabbing pointer-events-auto transition-transform hover:scale-125"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              setCollectionScrubbingId(beat.id);

                              const itemDuration = preview.durationSeconds;
                              const startOffset = preview.itemStartOffset ?? 0;

                              const container = e.currentTarget.closest('.progress-bar-container');
                              if (!container) return;
                              const rect = container.getBoundingClientRect();
                              const offsetX = e.clientX - rect.left;
                              const percent = Math.max(0, Math.min(1, offsetX / rect.width));
                              const newElapsed = startOffset + Math.max(0, Math.min(itemDuration - 0.001, percent * itemDuration));

                              setSceneLaunchPreviewPausedOffset(newElapsed);

                              // Sync timeline playhead if this collection or any parent is on the timeline
                              syncTimelinePlayheadToCollectionPreview(beat.id, newElapsed);
                            }}
                            onPointerMove={(e) => {
                              if (collectionScrubbingId !== beat.id) return;
                              e.preventDefault();
                              e.stopPropagation();

                              const itemDuration = preview.durationSeconds;
                              const startOffset = preview.itemStartOffset ?? 0;

                              const container = e.currentTarget.closest('.progress-bar-container');
                              if (!container) return;
                              const rect = container.getBoundingClientRect();
                              const offsetX = e.clientX - rect.left;
                              const percent = Math.max(0, Math.min(1, offsetX / rect.width));
                              const newElapsed = startOffset + Math.max(0, Math.min(itemDuration - 0.001, percent * itemDuration));

                              setSceneLaunchPreviewPausedOffset(newElapsed);

                              // Sync timeline playhead if this collection or any parent is on the timeline
                              syncTimelinePlayheadToCollectionPreview(beat.id, newElapsed);
                            }}
                            onPointerUp={(e) => {
                              if (collectionScrubbingId === beat.id) {
                                e.stopPropagation();
                                e.currentTarget.releasePointerCapture(e.pointerId);
                                setCollectionScrubbingId(null);
                              }
                            }}
                          />
                        )}
                      </CollectionProgressBar>
                    </div>
                  </div>
                ) : null}
              </div>
              <div
                role="button"
                tabIndex={0}
                className="flex w-full items-center justify-between gap-2 p-2.5 text-left cursor-pointer focus:outline-none"
                onClick={() => openBeatDetail(beat.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openBeatDetail(beat.id);
                  }
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-zinc-200">{beat.name}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 font-mono tracking-wider uppercase">
                    <div className="flex items-center gap-1">
                      {activeItemIndex > 0 && totalItems > 1 && (
                        <button
                          type="button"
                          title="Previous Item"
                          onClick={(e) => {
                            e.stopPropagation();
                            changeCollectionPreviewItem(beat, 'prev');
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors border border-zinc-850/40"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <span className="text-zinc-400 font-semibold text-[11px] select-none">
                        {activeItemIndex > 0
                          ? `${activeItemIndex}/${totalItems} items`
                          : `${totalItems} ${totalItems === 1 ? 'item' : 'items'}`
                        }
                      </span>
                      {activeItemIndex > 0 && totalItems > 1 && (
                        <button
                          type="button"
                          title="Next Item"
                          onClick={(e) => {
                            e.stopPropagation();
                            changeCollectionPreviewItem(beat, 'next');
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors border border-zinc-850/40"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <span className="text-zinc-700 font-bold select-none">&bull;</span>
                    <span className="text-zinc-400 font-medium font-mono text-[11px] select-none">
                      {(getRecursiveCollectionDuration(beat) || 0).toFixed(1)}s
                    </span>
                  </div>
                </div>
                <Play className="h-4.5 w-4.5 shrink-0 fill-current text-zinc-500 group-hover:text-zinc-300" />
              </div>
            </article>
          );
        })}

        <button
          type="button"
          style={getSceneLaunchCollectionTileStyle()}
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 text-zinc-600 transition-colors hover:border-zinc-700 hover:bg-zinc-950 hover:text-zinc-300 h-36 sm:h-40 lg:h-44"
          onClick={createSceneLaunchBeat}
        >
          <Plus className="h-6 w-6" />
          <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest">Add collection</span>
        </button>
      </div>
    </>
  );
}
