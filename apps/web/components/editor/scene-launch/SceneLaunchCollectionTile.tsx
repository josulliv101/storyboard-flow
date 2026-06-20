'use client';

import React from 'react';
import { Grid2X2, Pause, Play, ChevronLeft, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CollectionFrame } from '../Frame';
import { CollectionProgressBar } from '../CollectionProgressBar';
import { type SceneLaunchBeat, type SceneLaunchMediaItem, VIDEO_PLACEHOLDER } from './useSceneLaunchBoard';

interface SceneLaunchCollectionTileProps {
  beat: SceneLaunchBeat;
  dragKey: string;
  isTimelinePlaying: boolean;
  activeItemKey: string | null;
  hoveredItemKey: string | null;
  setHoveredItemKey: React.Dispatch<React.SetStateAction<string | null>>;
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
  isBeingDragged: boolean;
  onGridDragStart: (event: React.DragEvent<HTMLElement>, dragKey: string) => void;
  onGridDragEnd: () => void;
  dragPlaceholderContent?: React.ReactNode;
  allCollections: SceneLaunchBeat[];
  aspectRatio: number;
}

export function SceneLaunchCollectionTile({
  beat,
  dragKey,
  isTimelinePlaying,
  activeItemKey,
  hoveredItemKey,
  setHoveredItemKey,
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
  isBeingDragged,
  onGridDragStart,
  onGridDragEnd,
  dragPlaceholderContent,
  allCollections,
  aspectRatio,
}: SceneLaunchCollectionTileProps) {

  const preview = getSceneLaunchCollectionPreview(beat);
  const orderedMediaItems = getRecursiveMediaItems(beat);
  const totalItems = orderedMediaItems.length;
  const activeItemIndex = preview ? orderedMediaItems.findIndex(x => x.id === preview.item.id) + 1 : 0;

  const findMediaItemInCollection = React.useCallback((mediaId: string): SceneLaunchMediaItem | null => {
    return orderedMediaItems.find(m => m.id === mediaId) || null;
  }, [orderedMediaItems]);

  const prevItemsRef = React.useRef<SceneLaunchMediaItem[]>([]);
  const firstFourItems = React.useMemo(() => {
    const items: SceneLaunchMediaItem[] = [];

    const gather = (collection: SceneLaunchBeat) => {
      for (const key of collection.gridOrder) {
        if (items.length >= 4) return;

        if (key.type === 'media') {
          const mediaItem = findMediaItemInCollection(key.id);
          if (mediaItem) {
            items.push(mediaItem);
          }
        } else {
          const subBeat = allCollections.find(b => b.id === key.id);
          if (subBeat) {
            gather(subBeat);
          }
        }
      }
    };

    gather(beat);

    const prevItems = prevItemsRef.current;
    const isSame = prevItems.length === items.length &&
      items.every((item, idx) => item.id === prevItems[idx].id && item.previewUrl === prevItems[idx].previewUrl);

    if (isSame) {
      return prevItems;
    }
    prevItemsRef.current = items;
    return items;
  }, [beat, allCollections, findMediaItemInCollection]);

  return (
    <article
      data-scene-grid-item="true"
      id={`grid-item-${dragKey}`}
      draggable
      onDragStart={(event) => {
        const ghostEl = document.getElementById(`drag-ghost-${dragKey}`);
        if (ghostEl) {
          event.dataTransfer.setDragImage(ghostEl, 48, 36);
        }
        onGridDragStart(event, dragKey);
      }}
      onDragEnd={onGridDragEnd}
      onDragOver={(event) => handleGridDragOver(event, dragKey, true)}
      onDragLeave={handleGridDragLeave}
      onDrop={(event) => handleGridDrop(event, dragKey, true)}
      onMouseEnter={() => setHoveredItemKey(dragKey)}
      onMouseLeave={() => setHoveredItemKey(null)}
      style={getSceneLaunchCollectionTileStyle()}
      className={cn(
        "group cursor-grab overflow-visible rounded-lg border border-zinc-900 bg-zinc-950/80 transition-all duration-300 active:cursor-grabbing scroll-mt-24 relative",
        isTimelinePlaying && activeItemKey && activeItemKey !== dragKey ? "opacity-30" : "opacity-100",
        gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'inside' && "ring-2 ring-indigo-500 border-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.3)]"
      )}
      onContextMenu={(event) => handleItemContextMenu(event, dragKey)}
    >
      {/* Hidden drag image template */}
      <div
        id={`drag-ghost-${dragKey}`}
        className="fixed pointer-events-none bg-zinc-950 border border-zinc-700/60 rounded-md overflow-hidden flex flex-col items-center justify-center shadow-2xl z-[9999]"
        style={{
          width: '96px',
          height: '72px',
          left: '-9999px',
          top: '-9999px',
        }}
      >
        {firstFourItems.length > 0 ? (
          <div className="relative w-full h-full overflow-hidden rounded-md">
            <>
              <div className="w-full h-full relative z-10">
                {firstFourItems[0].type === 'video' ? (
                  <img src={firstFourItems[0].posterUrl || VIDEO_PLACEHOLDER} alt="" className="h-full w-full object-cover" />
                ) : (
                  <img src={firstFourItems[0].previewUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              {orderedMediaItems.length >= 1 && (
                <>
                  <svg 
                    width="36" 
                    height="36" 
                    viewBox="0 0 36 36" 
                    className="absolute top-0 right-0 z-20 pointer-events-none overflow-visible"
                    style={{
                      filter: 'drop-shadow(-1px 1px 1.5px rgba(0,0,0,0.45))'
                    }}
                  >
                    <path 
                      d="M 0,0 L 36,0 L 36,36 Z" 
                      fill="#18181b" 
                      stroke="#27272a" 
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div
                    className="absolute top-0 right-0 w-[36px] h-[36px] z-30 flex items-start justify-end pt-1 pr-1.5 select-none pointer-events-none"
                  >
                    <span className="text-[9px] font-extrabold text-white font-sans tracking-tight">
                      +{orderedMediaItems.length - 1}
                    </span>
                  </div>
                </>
              )}
            </>
          </div>
        ) : (
          <Folder className="h-6 w-6 text-amber-500" />
        )}
        <div className="absolute inset-0 bg-black/10" />
        <span className="absolute bottom-1 left-1 right-1 truncate text-[8px] bg-black/60 px-1 rounded text-center text-zinc-350 font-medium">
          {beat.name}
        </span>
      </div>

      {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'before' && (
        <div className="absolute top-1/2 -translate-y-1/2 -left-[8px] w-1 h-[85%] bg-gradient-to-b from-indigo-400 to-violet-500 rounded-full shadow-[0_0_12px_rgba(99,102,241,0.85)] z-50 pointer-events-none animate-pulse" />
      )}
      {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'after' && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[8px] w-1 h-[85%] bg-gradient-to-b from-indigo-400 to-violet-500 rounded-full shadow-[0_0_12px_rgba(99,102,241,0.85)] z-50 pointer-events-none animate-pulse" />
      )}

      <div className="w-full h-full rounded-lg overflow-hidden flex flex-col relative">
        {isBeingDragged && (
          dragPlaceholderContent
        )}
        <div
          className="group/thumb relative bg-black h-36 sm:h-40 lg:h-44"
          style={getSceneLaunchMediaPreviewStyle()}
        >
        <button
          type="button"
          className="block h-full w-full relative"
          onClick={() => openBeatDetail(beat.id)}
          aria-label={`Open ${beat.name}`}
        >
          {preview?.isPlaying ? (
            <CollectionFrame
              collectionId={beat.id}
              orderedItems={orderedMediaItems}
              elapsedSeconds={preview.totalElapsedSeconds}
              isPlaying={preview.isPlaying}
              className="h-full w-full object-cover"
            />
          ) : firstFourItems.length > 0 ? (
            <div className="relative w-full h-full">
                <>
                  <div className="w-full h-full relative z-10">
                    {firstFourItems[0].type === 'video' ? (
                      <img src={firstFourItems[0].posterUrl || VIDEO_PLACEHOLDER} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <img src={firstFourItems[0].previewUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  {orderedMediaItems.length >= 1 && (
                    <>
                      <svg 
                        width="52" 
                        height="52" 
                        viewBox="0 0 52 52" 
                        className="absolute top-0 right-0 z-20 pointer-events-none overflow-visible"
                        style={{
                          filter: 'drop-shadow(-1.5px 1.5px 2px rgba(0,0,0,0.5))'
                        }}
                      >
                        <path 
                          d="M 0,0 L 52,0 L 52,52 Z" 
                          fill="#18181b" 
                          stroke="#27272a" 
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <div
                        className="absolute top-0 right-0 w-[52px] h-[52px] z-30 flex items-start justify-end pt-1.5 pr-2 select-none pointer-events-none"
                      >
                        <span className="text-[11px] font-extrabold text-white font-sans tracking-tight">
                          +{orderedMediaItems.length - 1}
                        </span>
                      </div>
                    </>
                  )}
                </>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center text-center text-zinc-650 transition-colors hover:bg-white/[0.03] hover:text-zinc-300">
              <Grid2X2 className="h-6 w-6" />
              <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest">Open collection</span>
            </div>
          )}
          {/* Drill-down hover overlay — hidden when playing */}
          {!(preview?.isPlaying) && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/thumb:bg-black/40 transition-all duration-200 pointer-events-none">
              <div className="flex items-center gap-1.5 rounded-full bg-zinc-950/90 border border-zinc-700/80 px-3 py-1.5 opacity-0 group-hover/thumb:opacity-100 scale-90 group-hover/thumb:scale-100 transition-all duration-200 shadow-lg backdrop-blur-sm">
                <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-200">Open</span>
              </div>
            </div>
          )}
        </button>

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
        {preview ? (
          <button
            type="button"
            title={preview.isPlaying ? 'Pause preview' : 'Play preview'}
            onClick={(event) => {
              event.stopPropagation();
              if (preview.isPlaying) {
                const totalDuration = preview.totalDurationSeconds;
                const currentElapsed = totalDuration > 0 && sceneLaunchPreviewHover
                  ? ((Date.now() - sceneLaunchPreviewHover.startedAt) / 1000) % totalDuration
                  : 0;

                setSceneLaunchPreviewPausedOffset(currentElapsed);
                setSceneLaunchManuallyPaused(beat.id);

                const article = event.currentTarget.closest('article');
                const video = article?.querySelector('video');
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
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all cursor-pointer outline-none",
              preview.isPlaying
                ? "border-indigo-500/60 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
                : "border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
            )}
          >
            {preview.isPlaying ? (
              <Pause className="h-3 w-3 fill-current" />
            ) : (
              <Play className="h-3 w-3 fill-current ml-0.5" />
            )}
          </button>
        ) : (
          <Play className="h-4.5 w-4.5 shrink-0 fill-current text-zinc-500 group-hover:text-zinc-300" />
        )}
      </div>
    </div>
  </article>
  );
}
