'use client';

import React from 'react';
import { Grid2X2, Pause, Play, ChevronLeft, ChevronRight, GripVertical, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CollectionFrame } from '../Frame';
import { CollectionProgressBar } from '../CollectionProgressBar';
import type { SceneLaunchBeat, SceneLaunchMediaItem } from './useSceneLaunchBoard';

interface SceneLaunchCollectionTileProps {
  beat: SceneLaunchBeat;
  dragKey: string;
  isTimelinePlaying: boolean;
  activeItemKey: string | null;
  collectionScrubbingId: string | null;
  setCollectionScrubbingId: (id: string | null) => void;
  sceneLaunchPreviewHover: { collectionId: string; startedAt: number } | null;
  setSceneLaunchPreviewHover: (hover: { collectionId: string; startedAt: number } | null) => void;
  sceneLaunchManuallyPaused: string | null;
  setSceneLaunchManuallyPaused: (paused: string | null) => void;
  sceneLaunchPreviewPausedOffset: number;
  setSceneLaunchPreviewPausedOffset: React.Dispatch<React.SetStateAction<number>>;
  openBeatDetail: (id: string) => void;
  changeCollectionPreviewItem: (beat: SceneLaunchBeat, direction: 'next' | 'prev') => void;
  getGridItemTimelineState: (itemId: string, itemType: 'media' | 'collection') => { status: 'past' | 'active' | 'future' | 'idle'; elapsed: number; duration: number };
  getSceneLaunchCollectionPreview: (collection: SceneLaunchBeat) => {
    item: SceneLaunchMediaItem;
    elapsedSeconds: number;
    durationSeconds: number;
    isPlaying: boolean;
    totalElapsedSeconds: number;
    totalDurationSeconds: number;
    itemStartOffset: number;
  } | null;
  getRecursiveCollectionDuration: (collection: SceneLaunchBeat) => number;
  getRecursiveMediaItems: (collection: SceneLaunchBeat) => SceneLaunchMediaItem[];
  getSceneLaunchCollectionTileStyle: () => React.CSSProperties;
  getSceneLaunchMediaPreviewStyle: () => React.CSSProperties;
  gridDragOverInfo: { targetKey: string; position: 'before' | 'after' | 'inside' } | null;
  handleGridDragOver: (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
  handleGridDragLeave: () => void;
  handleGridDrop: (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
  syncTimelinePlayheadToCollectionPreview: (beatId: string, elapsedSeconds: number) => void;
  handleItemContextMenu: (event: React.MouseEvent<HTMLElement>, key: string) => void;
}

export function SceneLaunchCollectionTile({
  beat,
  dragKey,
  isTimelinePlaying,
  activeItemKey,
  collectionScrubbingId,
  setCollectionScrubbingId,
  sceneLaunchPreviewHover,
  setSceneLaunchPreviewHover,
  sceneLaunchManuallyPaused,
  setSceneLaunchManuallyPaused,
  sceneLaunchPreviewPausedOffset,
  setSceneLaunchPreviewPausedOffset,
  openBeatDetail,
  changeCollectionPreviewItem,
  getGridItemTimelineState,
  getSceneLaunchCollectionPreview,
  getRecursiveCollectionDuration,
  getRecursiveMediaItems,
  getSceneLaunchCollectionTileStyle,
  getSceneLaunchMediaPreviewStyle,
  gridDragOverInfo,
  handleGridDragOver,
  handleGridDragLeave,
  handleGridDrop,
  syncTimelinePlayheadToCollectionPreview,
  handleItemContextMenu,
}: SceneLaunchCollectionTileProps) {

  const preview = getSceneLaunchCollectionPreview(beat);
  const orderedMediaItems = getRecursiveMediaItems(beat);
  const totalItems = orderedMediaItems.length;
  const activeItemIndex = preview ? orderedMediaItems.findIndex(x => x.id === preview.item.id) + 1 : 0;

  return (
    <article
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
                const totalDuration = orderedMediaItems.reduce((sum, item) => sum + (item.durationSeconds || 3), 0);
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
          <div className="flex items-center gap-1.5 truncate text-sm font-bold text-zinc-200">
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500/60 mr-1" />
            <span className="truncate">{beat.name}</span>
          </div>
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
                  : `${totalItems} ${totalItems === 1 ? 'item' : 'items'}`}
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
            <span className="text-zinc-700 font-bold select-none">•</span>
            <span className="text-zinc-400 font-medium font-mono text-[11px] select-none">
              {(getRecursiveCollectionDuration(beat) || 0).toFixed(1)}s
            </span>
          </div>
        </div>
        <GripVertical className="h-4.5 w-4.5 text-zinc-500 group-hover:text-zinc-300" />
      </div>
    </article>
  );
}
