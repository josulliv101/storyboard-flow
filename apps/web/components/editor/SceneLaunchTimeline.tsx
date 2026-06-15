'use client';

import React from 'react';
import { Clock, Grid2X2, Pause, Play, Repeat, ZoomIn, ZoomOut } from 'lucide-react';

import { cn } from '@/lib/utils';

export type SceneLaunchTimelineMediaItem = {
  id: string;
  name: string;
  type: 'image' | 'video';
  previewUrl: string;
  durationSeconds?: number;
};

export type SceneLaunchTimelineItem<TCollection extends { id: string; name: string }> =
  | { id: string; type: 'media'; item: SceneLaunchTimelineMediaItem }
  | { id: string; type: 'collection'; collection: TCollection };

export type SceneLaunchTimelineResizeState = {
  id: string;
  initialDuration: number;
  startX: number;
  currentDuration: number;
} | null;

type SceneLaunchTimelineProps<TCollection extends { id: string; name: string }> = {
  title: string;
  totalDuration: number;
  timelineItems: Array<SceneLaunchTimelineItem<TCollection>>;
  activeItemKey: string | null;
  timelineCurrentTime: number;
  pxPerSecond: number;
  setPxPerSecond: React.Dispatch<React.SetStateAction<number>>;
  isTimelinePlaying: boolean;
  isTimelineLooping: boolean;
  onToggleLoop: () => void;
  onTogglePlayback: () => void;
  isScrubbing: boolean;
  setIsScrubbing: React.Dispatch<React.SetStateAction<boolean>>;
  onTimelineTimeChange: (time: number) => void;
  timelineDragOverKey: string | null;
  setTimelineDragOverKey: React.Dispatch<React.SetStateAction<string | null>>;
  resizingItem: SceneLaunchTimelineResizeState;
  setResizingItem: React.Dispatch<React.SetStateAction<SceneLaunchTimelineResizeState>>;
  getRecursiveCollectionDuration: (collection: TCollection) => number;
  getCollectionTimelineSplitPercents: (collection: TCollection) => number[];
  getSceneLaunchCollectionPreview: (collection: TCollection) => { item: SceneLaunchTimelineMediaItem } | null;
  reorderSceneLaunchGridItem: (draggedKey: string, targetKey: string) => void;
  handleItemContextMenu: (event: React.MouseEvent, dragKey: string) => void;
  updateSceneLaunchMediaDuration: (mediaId: string, durationSeconds: number) => void;
};

function SceneLaunchTimelineRuler({
  totalDuration,
  pxPerSecond,
  isScrubbing,
  setIsScrubbing,
  onTimelineTimeChange,
}: {
  totalDuration: number;
  pxPerSecond: number;
  isScrubbing: boolean;
  setIsScrubbing: React.Dispatch<React.SetStateAction<boolean>>;
  onTimelineTimeChange: (time: number) => void;
}) {
  const totalSec = Math.max(10, Math.ceil(totalDuration));
  const ticks = Array.from({ length: totalSec + 1 }, (_, index) => index);
  const widthPx = Math.max(10, totalDuration) * pxPerSecond;

  const setTimeFromPointer = (target: HTMLDivElement, clientX: number) => {
    const rect = target.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    onTimelineTimeChange(Math.max(0, Math.min(totalDuration, offsetX / pxPerSecond)));
  };

  return (
    <div
      className="relative h-6 border-b border-zinc-800 text-[9px] font-mono text-zinc-500 select-none cursor-ew-resize"
      style={{ width: `${widthPx}px`, minWidth: '100%' }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsScrubbing(true);
        setTimeFromPointer(event.currentTarget, event.clientX);
      }}
      onPointerMove={(event) => {
        if (!isScrubbing) return;
        setTimeFromPointer(event.currentTarget, event.clientX);
      }}
      onPointerUp={(event) => {
        if (isScrubbing) {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setIsScrubbing(false);
        }
      }}
    >
      {ticks.map((sec) => {
        const left = sec * pxPerSecond;
        const isMajor = sec % 5 === 0;
        return (
          <div
            key={sec}
            className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${left}px` }}
          >
            {isMajor && <span className="mb-0.5 text-[8px] text-zinc-500 font-semibold">{sec}s</span>}
            <div className={cn("w-px bg-zinc-800/80", isMajor ? "h-2.5 bg-zinc-600/80" : "h-1 bg-zinc-800/40")} />
          </div>
        );
      })}
    </div>
  );
}

export function SceneLaunchTimeline<TCollection extends { id: string; name: string }>({
  title,
  totalDuration,
  timelineItems,
  activeItemKey,
  timelineCurrentTime,
  pxPerSecond,
  setPxPerSecond,
  isTimelinePlaying,
  isTimelineLooping,
  onToggleLoop,
  onTogglePlayback,
  isScrubbing,
  setIsScrubbing,
  onTimelineTimeChange,
  timelineDragOverKey,
  setTimelineDragOverKey,
  resizingItem,
  setResizingItem,
  getRecursiveCollectionDuration,
  getCollectionTimelineSplitPercents,
  getSceneLaunchCollectionPreview,
  reorderSceneLaunchGridItem,
  handleItemContextMenu,
  updateSceneLaunchMediaDuration,
}: SceneLaunchTimelineProps<TCollection>) {
  const widthPx = Math.max(10, totalDuration) * pxPerSecond;

  return (
    <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 w-[95%] max-w-[76rem] bg-zinc-950/85 border border-zinc-800/80 backdrop-blur-xl rounded-2xl shadow-2xl p-4 flex flex-col gap-2.5 select-none">
      <style dangerouslySetInnerHTML={{ __html: `
        .timeline-track-scroll::-webkit-scrollbar {
          height: 6px;
        }
        .timeline-track-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .timeline-track-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 9999px;
        }
        .timeline-track-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.25);
        }
      `}} />

      <div className="flex items-center justify-between text-zinc-400 px-1">
        <div className="flex flex-1 items-center gap-2">
          <Clock className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 truncate max-w-[12rem] md:max-w-[18rem]">
            {title}
          </span>
          <span className="text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0">
            {totalDuration.toFixed(1)}s
          </span>
        </div>

        <div className="flex items-center justify-center shrink-0 gap-2.5">
          <button
            type="button"
            onClick={onToggleLoop}
            className={cn(
              "p-1 rounded transition-colors cursor-pointer",
              isTimelineLooping ? "text-indigo-400 hover:text-indigo-300" : "text-zinc-650 hover:text-zinc-400"
            )}
            title={isTimelineLooping ? "Disable Loop" : "Enable Loop"}
          >
            <Repeat className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePlayback}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full transition-all text-white shadow-md cursor-pointer",
              isTimelinePlaying ? "bg-red-650 hover:bg-red-700 animate-pulse" : "bg-indigo-600 hover:bg-indigo-700"
            )}
            title={isTimelinePlaying ? "Pause Timeline" : "Play Timeline"}
          >
            {isTimelinePlaying ? (
              <Pause className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
            )}
          </button>
          <span className="text-[10px] font-mono text-zinc-300 bg-zinc-900 border border-zinc-800/80 px-2 py-0.5 rounded-full font-bold">
            {timelineCurrentTime.toFixed(1)}s
          </span>
        </div>

        <div className="flex flex-1 items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setPxPerSecond(prev => Math.max(5, prev - 5))}
            className="p-1 rounded hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-[10px] font-mono text-zinc-500 w-8 text-center select-none font-semibold">
            {Math.round(pxPerSecond * 5)}%
          </span>
          <button
            type="button"
            onClick={() => setPxPerSecond(prev => Math.min(60, prev + 5))}
            className="p-1 rounded hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative border border-zinc-800/80 bg-[#09090b]/40 rounded-xl flex flex-col overflow-hidden">
        <div className="overflow-x-auto overflow-y-hidden timeline-track-scroll flex flex-col flex-1 relative" id="timeline-track-scrub-zone">
          <SceneLaunchTimelineRuler
            totalDuration={totalDuration}
            pxPerSecond={pxPerSecond}
            isScrubbing={isScrubbing}
            setIsScrubbing={setIsScrubbing}
            onTimelineTimeChange={onTimelineTimeChange}
          />

          <div
            className="flex items-stretch h-20 bg-zinc-950/20 relative"
            style={{ width: `${widthPx}px`, minWidth: '100%' }}
          >
            {timelineItems.length === 0 ? (
              <div className="flex items-center justify-center w-full h-full text-zinc-600 text-xs py-4">
                Timeline is empty. Drag media items or collections here.
              </div>
            ) : (
              timelineItems.map((gridItem) => {
                const dragKey = `${gridItem.type}:${gridItem.id}`;
                let duration = 3;
                let name = '';
                let previewUrl = '';
                let isImage = false;
                let isVideo = false;

                if (gridItem.type === 'media') {
                  duration = resizingItem && resizingItem.id === gridItem.id
                    ? resizingItem.currentDuration
                    : gridItem.item.durationSeconds || 3;
                  name = gridItem.item.name;
                  previewUrl = gridItem.item.previewUrl;
                  isImage = gridItem.item.type === 'image';
                  isVideo = gridItem.item.type === 'video';
                } else {
                  duration = getRecursiveCollectionDuration(gridItem.collection) || 3;
                  name = gridItem.collection.name;
                  const collectionPreview = getSceneLaunchCollectionPreview(gridItem.collection);
                  if (collectionPreview) {
                    previewUrl = collectionPreview.item.previewUrl;
                    isImage = collectionPreview.item.type === 'image';
                    isVideo = collectionPreview.item.type === 'video';
                  }
                }

                const blockWidth = duration * pxPerSecond;
                const isItemActive = activeItemKey === dragKey;
                const collectionSplitPercents = gridItem.type === 'collection' && isItemActive
                  ? getCollectionTimelineSplitPercents(gridItem.collection)
                  : [];

                return (
                  <div
                    key={dragKey}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', dragKey);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDragEnter={() => setTimelineDragOverKey(dragKey)}
                    onDragLeave={() => setTimelineDragOverKey(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setTimelineDragOverKey(null);
                      const draggedKey = event.dataTransfer.getData('text/plain');
                      if (draggedKey) {
                        reorderSceneLaunchGridItem(draggedKey, dragKey);
                      }
                    }}
                    onContextMenu={(event) => handleItemContextMenu(event, dragKey)}
                    style={{ width: `${blockWidth}px` }}
                    className={cn(
                      "relative group flex-shrink-0 flex items-stretch border-r border-zinc-800/80 bg-zinc-950/30 select-none overflow-hidden transition-all duration-150 cursor-grab active:cursor-grabbing",
                      timelineDragOverKey === dragKey && "border-l-2 border-l-indigo-500 bg-indigo-950/20",
                      gridItem.type === 'collection' && "bg-zinc-900/10 border-b-2 border-b-zinc-800",
                      isItemActive ? "bg-indigo-955/10 border-t border-t-indigo-500/40" : ""
                    )}
                  >
                    {collectionSplitPercents.map((leftPercent) => (
                      <div
                        key={`collection-split-${dragKey}-${leftPercent.toFixed(3)}`}
                        className="absolute top-0 bottom-0 z-[12] w-0 -translate-x-1/2 border-l-2 border-dashed border-black shadow-[0_0_8px_rgba(0,0,0,0.8)] pointer-events-none"
                        style={{ left: `${leftPercent}%` }}
                      />
                    ))}

                    {previewUrl ? (
                      <div className={cn(
                        "absolute inset-0 pointer-events-none transition-opacity duration-300",
                        isItemActive ? "opacity-100" : "opacity-25"
                      )}>
                        {isVideo ? (
                          <video src={previewUrl} className="h-full w-full object-cover" muted />
                        ) : (
                          <img src={previewUrl} className="h-full w-full object-cover" alt="" />
                        )}
                      </div>
                    ) : (
                      <div className="absolute inset-0 opacity-10 bg-zinc-800 pointer-events-none flex items-center justify-center">
                        <Grid2X2 className="h-5 w-5" />
                      </div>
                    )}

                    <div className="relative z-10 flex flex-col justify-between p-2 w-full h-full pointer-events-none text-left">
                      <div className={cn("truncate text-[10px] font-bold text-zinc-300", isItemActive && "text-indigo-200")}>
                        {name}
                      </div>
                      <div className="flex items-center justify-between gap-1 text-[9px] font-mono font-medium text-zinc-500">
                        <span className={cn("bg-black/60 border border-zinc-800 px-1 rounded text-zinc-300", isItemActive && "border-indigo-900/50 text-indigo-300 bg-indigo-950/40")}>
                          {duration.toFixed(1)}s
                        </span>
                        <span className="uppercase text-[8px] tracking-wider font-extrabold text-zinc-600">
                          {gridItem.type}
                        </span>
                      </div>
                    </div>

                    {gridItem.type === 'media' && (isImage || isVideo) && (
                      <div
                        style={{ touchAction: 'none' }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setResizingItem({
                            id: gridItem.id,
                            initialDuration: duration,
                            startX: event.clientX,
                            currentDuration: duration,
                          });
                        }}
                        onPointerMove={(event) => {
                          if (!resizingItem || resizingItem.id !== gridItem.id) return;
                          event.stopPropagation();
                          const deltaX = event.clientX - resizingItem.startX;
                          const deltaDuration = deltaX / pxPerSecond;
                          const newDuration = Math.max(1, Math.min(60, resizingItem.initialDuration + deltaDuration));
                          setResizingItem({
                            ...resizingItem,
                            currentDuration: newDuration,
                          });
                        }}
                        onPointerUp={(event) => {
                          if (resizingItem && resizingItem.id === gridItem.id) {
                            event.currentTarget.releasePointerCapture(event.pointerId);
                            updateSceneLaunchMediaDuration(gridItem.id, Number(resizingItem.currentDuration.toFixed(1)));
                            setResizingItem(null);
                          }
                        }}
                        className={cn(
                          "absolute right-0 top-0 w-2.5 h-full cursor-col-resize z-20 transition-all hover:bg-indigo-500/70 bg-zinc-800/10 border-r border-r-zinc-700/50 group-hover:border-r-indigo-500/50",
                          resizingItem?.id === gridItem.id && "bg-indigo-500 border-r-indigo-400"
                        )}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500/80 z-30 pointer-events-none"
            style={{ left: `${timelineCurrentTime * pxPerSecond}px` }}
          >
            <div
              className="absolute -top-0.5 -translate-x-1/2 w-6 h-6 flex items-center justify-center cursor-ew-resize pointer-events-auto group/playhead"
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsScrubbing(true);
              }}
              onPointerMove={(event) => {
                if (!isScrubbing) return;
                const track = document.getElementById('timeline-track-scrub-zone');
                if (!track) return;
                const rect = track.getBoundingClientRect();
                const offsetX = event.clientX - rect.left;
                onTimelineTimeChange(Math.max(0, Math.min(totalDuration, offsetX / pxPerSecond)));
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                setIsScrubbing(false);
              }}
            >
              <div className="w-3.5 h-4 bg-red-500 rounded-t-full rounded-b-sm border border-red-400 shadow-[0_1px_4px_rgba(0,0,0,0.5),0_0_8px_rgba(239,68,68,0.4)] group-hover/playhead:bg-red-400 group-hover/playhead:scale-110 transition-all duration-150" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
