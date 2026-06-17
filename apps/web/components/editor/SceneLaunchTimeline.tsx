'use client';

import React from 'react';
import { Clock, Grid2X2, ImageIcon, Maximize2, MonitorPlay, MoreVertical, Pause, Play, Repeat, Video, ZoomIn, ZoomOut } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@storyboard/ui';

export type SceneLaunchPlaybackMode = 'inline' | 'preview';

export type SceneLaunchTimelineMediaItem = {
  id: string;
  name: string;
  type: 'image' | 'video';
  previewUrl: string;
  durationSeconds?: number;
  trimStartSeconds?: number;
  mediaDurationSeconds?: number;
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
  hoveredItemKey: string | null;
  setHoveredItemKey: React.Dispatch<React.SetStateAction<string | null>>;
  timelineCurrentTime: number;
  pxPerSecond: number;
  setPxPerSecond: React.Dispatch<React.SetStateAction<number>>;
  isTimelinePlaying: boolean;
  playbackMode: SceneLaunchPlaybackMode;
  isTimelineLooping: boolean;
  onToggleLoop: () => void;
  onTogglePlayback: () => void;
  onTogglePreview: () => void;
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
  getCollectionTimelineMediaItems: (collection: TCollection) => SceneLaunchTimelineMediaItem[];
  reorderSceneLaunchGridItem: (draggedKey: string, targetKey: string) => void;
  handleItemContextMenu: (event: React.MouseEvent, dragKey: string) => void;
  updateSceneLaunchMediaDuration: (mediaId: string, durationSeconds: number) => void;
  updateSceneLaunchMediaTrim: (mediaId: string, trimStartSeconds: number, durationSeconds: number) => void;
  centerSlot?: React.ReactNode;
};

const getTimelineMediaDuration = (item: SceneLaunchTimelineMediaItem) => {
  const sourceDuration = item.mediaDurationSeconds ?? item.durationSeconds ?? 3;
  const trimStart = Math.max(0, item.trimStartSeconds ?? 0);
  const fallbackDuration = Math.max(0.5, sourceDuration - trimStart);
  const requestedDuration = item.durationSeconds ?? fallbackDuration;
  return Math.max(0.5, Math.min(requestedDuration, Math.max(0.5, sourceDuration - trimStart)));
};

const getTimelineMediaSourceDuration = (item: SceneLaunchTimelineMediaItem) => (
  Math.max(0.5, item.mediaDurationSeconds ?? item.durationSeconds ?? 3)
);

function SceneLaunchTimelineCollectionMenu({
  collectionName,
  mediaItems,
  updateSceneLaunchMediaDuration,
  updateSceneLaunchMediaTrim,
}: {
  collectionName: string;
  mediaItems: SceneLaunchTimelineMediaItem[];
  updateSceneLaunchMediaDuration: (mediaId: string, durationSeconds: number) => void;
  updateSceneLaunchMediaTrim: (mediaId: string, trimStartSeconds: number, durationSeconds: number) => void;
}) {
  const dragStateRef = React.useRef<{
    item: SceneLaunchTimelineMediaItem;
    mode: 'start' | 'end' | 'move';
    startX: number;
    trackWidth: number;
    initialStart: number;
    initialDuration: number;
    sourceDuration: number;
  } | null>(null);

  const beginTrimDrag = (
    event: React.PointerEvent<HTMLElement>,
    item: SceneLaunchTimelineMediaItem,
    mode: 'start' | 'end' | 'move'
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const track = event.currentTarget.closest('[data-collection-trim-track="true"]') as HTMLElement | null;
    const sourceDuration = item.type === 'video'
      ? getTimelineMediaSourceDuration(item)
      : 60;

    dragStateRef.current = {
      item,
      mode,
      startX: event.clientX,
      trackWidth: Math.max(1, track?.getBoundingClientRect().width ?? 1),
      initialStart: item.type === 'video' ? Math.max(0, item.trimStartSeconds ?? 0) : 0,
      initialDuration: getTimelineMediaDuration(item),
      sourceDuration,
    };
  };

  const updateTrimDrag = (event: React.PointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    event.preventDefault();
    event.stopPropagation();

    const deltaSeconds = ((event.clientX - dragState.startX) / dragState.trackWidth) * dragState.sourceDuration;

    if (dragState.item.type === 'video') {
      if (dragState.mode === 'start') {
        const nextStart = Math.max(
          0,
          Math.min(
            dragState.initialStart + dragState.initialDuration - 0.5,
            dragState.initialStart + deltaSeconds,
            dragState.sourceDuration - 0.5
          )
        );
        const nextDuration = Math.max(
          0.5,
          Math.min(
            dragState.sourceDuration - nextStart,
            dragState.initialDuration - (nextStart - dragState.initialStart)
          )
        );
        updateSceneLaunchMediaTrim(
          dragState.item.id,
          Number(nextStart.toFixed(2)),
          Number(nextDuration.toFixed(2))
        );
        return;
      }

      if (dragState.mode === 'move') {
        const nextStart = Math.max(
          0,
          Math.min(
            dragState.sourceDuration - dragState.initialDuration,
            dragState.initialStart + deltaSeconds
          )
        );
        updateSceneLaunchMediaTrim(
          dragState.item.id,
          Number(nextStart.toFixed(2)),
          Number(dragState.initialDuration.toFixed(2))
        );
        return;
      }

      const nextDuration = Math.max(
        0.5,
        Math.min(
          dragState.sourceDuration - dragState.initialStart,
          dragState.initialDuration + deltaSeconds
        )
      );
      updateSceneLaunchMediaTrim(
        dragState.item.id,
        Number(dragState.initialStart.toFixed(2)),
        Number(nextDuration.toFixed(2))
      );
      return;
    }

    const nextDuration = Math.max(0.5, Math.min(60, dragState.initialDuration + deltaSeconds));
    updateSceneLaunchMediaDuration(dragState.item.id, Number(nextDuration.toFixed(2)));
  };

  const endTrimDrag = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = null;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="absolute right-1.5 top-1.5 z-40 flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-black/65 text-zinc-400 opacity-0 shadow-lg outline-none backdrop-blur transition-opacity hover:bg-zinc-900 hover:text-zinc-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-indigo-400/70 group-hover:opacity-100 data-[state=open]:opacity-100"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={`Edit media in ${collectionName}`}
        title="Collection media"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="z-50 max-h-[26rem] w-[23rem] overflow-y-auto border border-zinc-800 bg-zinc-950/98 p-2 text-zinc-200 shadow-2xl shadow-black/60 backdrop-blur-xl"
      >
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <div className="truncate text-[10px] font-black uppercase tracking-widest text-zinc-400">
              {collectionName}
            </div>
            <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
              {mediaItems.length} {mediaItems.length === 1 ? 'item' : 'items'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {mediaItems.length === 0 ? (
            <div className="rounded-md border border-zinc-850 bg-zinc-950 p-3 text-center text-xs text-zinc-600">
              No media in this collection.
            </div>
          ) : mediaItems.map((item, index) => {
            const sourceDuration = getTimelineMediaSourceDuration(item);
            const trimStart = Math.max(0, item.trimStartSeconds ?? 0);
            const duration = getTimelineMediaDuration(item);
            const startPercent = item.type === 'video'
              ? (trimStart / sourceDuration) * 100
              : 0;
            const durationPercent = item.type === 'video'
              ? (duration / sourceDuration) * 100
              : Math.min(100, (duration / 60) * 100);
            const rightDimPercent = item.type === 'video'
              ? Math.max(0, 100 - startPercent - durationPercent)
              : 0;
            const stripLeft = item.type === 'video' ? startPercent : 0;
            const stripWidth = Math.max(4, item.type === 'video' ? durationPercent : Math.min(100, durationPercent));

            if (item.type === 'image') {
              const setImageDuration = (nextDuration: number) => {
                const clampedDuration = Math.max(0.5, Math.min(60, nextDuration));
                updateSceneLaunchMediaDuration(item.id, Number(clampedDuration.toFixed(2)));
              };

              return (
                <div
                  key={`${item.id}-${index}`}
                  className="rounded-lg border border-zinc-850 bg-zinc-950/80 p-2 shadow-inner shadow-black/30"
                >
                  <div className="rounded-md border border-zinc-850 bg-black/45 p-2">
                    <div className="relative flex h-16 w-full items-center justify-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
                      <img
                        src={item.previewUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover opacity-80"
                      />
                      <div className="absolute inset-0 bg-black/35" />
                      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:18px_100%]" />
                      <div className="relative flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 shadow-lg">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setImageDuration(duration - 0.5);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                          aria-label={`Decrease ${item.name} duration`}
                        >
                          -
                        </button>
                        <label className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
                          <input
                            type="number"
                            min={0.5}
                            max={60}
                            step={0.5}
                            value={Number(duration.toFixed(1))}
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) => setImageDuration(Number(event.target.value))}
                            className="h-6 w-12 bg-transparent text-right text-xs font-bold text-zinc-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            aria-label={`${item.name} duration`}
                          />
                          <span>s</span>
                        </label>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setImageDuration(duration + 0.5);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                          aria-label={`Increase ${item.name} duration`}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex min-w-0 items-center justify-between gap-3 px-0.5 py-0.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <ImageIcon className="h-3 w-3 shrink-0 text-emerald-400/80" />
                        <span className="min-w-0 truncate text-[11px] font-semibold text-zinc-400">
                          {index + 1}. {item.name}
                        </span>
                      </div>
                      <div className="ml-auto shrink-0 rounded border border-zinc-850 bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-300">
                        image · {duration.toFixed(1)}s
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`${item.id}-${index}`}
                className="rounded-lg border border-zinc-850 bg-zinc-950/80 p-2 shadow-inner shadow-black/30"
              >
                <div className="rounded-md border border-zinc-850 bg-black/45 p-2">
                  <div
                    data-collection-trim-track="true"
                    className="relative h-16 overflow-hidden rounded-md bg-zinc-900"
                  >
                    {item.type === 'video' && (
                      <div className="absolute inset-0 flex opacity-35">
                        {[0, 1, 2, 3, 4].map((thumbIndex) => (
                          <video
                            key={thumbIndex}
                            ref={(video) => {
                              if (!video) return;
                              const targetTime = (thumbIndex / 4) * sourceDuration;
                              if (Math.abs(video.currentTime - targetTime) > 0.1) {
                                video.currentTime = targetTime;
                              }
                            }}
                            src={item.previewUrl}
                            className="h-full min-w-0 flex-1 object-cover"
                            muted
                            playsInline
                          />
                        ))}
                      </div>
                    )}
                    {item.type === 'video' && (
                      <>
                        <div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: `${startPercent}%` }} />
                        <div className="absolute inset-y-0 right-0 bg-black/65" style={{ width: `${rightDimPercent}%` }} />
                      </>
                    )}
                    <div
                      onPointerDown={(event) => beginTrimDrag(event, item, item.type === 'video' ? 'move' : 'end')}
                      onPointerMove={updateTrimDrag}
                      onPointerUp={endTrimDrag}
                      onPointerCancel={endTrimDrag}
                      className={cn(
                        'absolute inset-y-0 rounded-md border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_0_14px_rgba(255,255,255,0.18)]',
                        item.type === 'video' ? 'cursor-grab active:cursor-grabbing' : 'cursor-ew-resize'
                      )}
                      style={{
                        left: `${stripLeft}%`,
                        width: `${stripWidth}%`,
                      }}
                    >
                      {item.type === 'video' && (
                        <div
                          onPointerDown={(event) => beginTrimDrag(event, item, 'start')}
                          onPointerMove={updateTrimDrag}
                          onPointerUp={endTrimDrag}
                          onPointerCancel={endTrimDrag}
                          className="absolute inset-y-0 left-0 flex w-4 cursor-ew-resize items-center justify-center rounded-l bg-white"
                        >
                          <div className="h-7 w-[1.5px] rounded-full bg-zinc-400" />
                        </div>
                      )}
                      <div
                        onPointerDown={(event) => beginTrimDrag(event, item, 'end')}
                        onPointerMove={updateTrimDrag}
                        onPointerUp={endTrimDrag}
                        onPointerCancel={endTrimDrag}
                        className="absolute inset-y-0 right-0 flex w-4 cursor-ew-resize items-center justify-center rounded-r bg-white"
                      >
                        <div className="h-7 w-[1.5px] rounded-full bg-zinc-400" />
                      </div>
                      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white shadow">
                        {duration.toFixed(1)}s
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex min-w-0 items-center justify-between gap-3 px-0.5 py-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {item.type === 'video' ? (
                        <Video className="h-3 w-3 shrink-0 text-amber-400/80" />
                      ) : (
                        <ImageIcon className="h-3 w-3 shrink-0 text-emerald-400/80" />
                      )}
                      <span className="min-w-0 truncate text-[11px] font-semibold text-zinc-400">
                        {index + 1}. {item.name}
                      </span>
                    </div>
                    <div className="ml-auto shrink-0 rounded border border-zinc-850 bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-300">
                      {item.type === 'video'
                        ? `${trimStart.toFixed(1)}s - ${(trimStart + duration).toFixed(1)}s`
                        : `${duration.toFixed(1)}s`}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  hoveredItemKey,
  setHoveredItemKey,
  timelineCurrentTime,
  pxPerSecond,
  setPxPerSecond,
  isTimelinePlaying,
  playbackMode,
  isTimelineLooping,
  onToggleLoop,
  onTogglePlayback,
  onTogglePreview,
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
  getCollectionTimelineMediaItems,
  reorderSceneLaunchGridItem,
  handleItemContextMenu,
  updateSceneLaunchMediaDuration,
  updateSceneLaunchMediaTrim,
  centerSlot,
}: SceneLaunchTimelineProps<TCollection>) {
  const widthPx = Math.max(10, totalDuration) * pxPerSecond;
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const handleFitToScreen = () => {
    if (scrollContainerRef.current && totalDuration > 0) {
      const containerWidth = scrollContainerRef.current.clientWidth;
      const effectiveDuration = Math.max(10, totalDuration);
      const availableWidth = containerWidth - 8;
      const calculatedPxPerSecond = availableWidth / effectiveDuration;
      const finalPxPerSecond = Math.max(1, Math.min(60, calculatedPxPerSecond));
      setPxPerSecond(finalPxPerSecond);
    }
  };

  const lastFittedTitleRef = React.useRef<string | null>(null);
  const [isFitted, setIsFitted] = React.useState(false);

  React.useEffect(() => {
    setIsFitted(false);
  }, [title]);

  React.useEffect(() => {
    if (lastFittedTitleRef.current === title) {
      return;
    }

    if (totalDuration === 0) {
      setIsFitted(true);
      lastFittedTitleRef.current = title;
      return;
    }

    if (scrollContainerRef.current && scrollContainerRef.current.clientWidth > 0) {
      handleFitToScreen();
      setIsFitted(true);
      lastFittedTitleRef.current = title;
    }
  }, [title, totalDuration]);

  return (
    <div className="absolute inset-x-6 bottom-5 z-20 bg-zinc-950/85 border border-zinc-800/80 backdrop-blur-xl rounded-2xl shadow-2xl p-4 flex flex-col gap-2.5 select-none">
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

        {centerSlot ? (
          <div className="flex min-w-0 shrink items-center justify-center px-2">
            {centerSlot}
          </div>
        ) : (
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
            title={playbackMode === 'preview'
              ? isTimelinePlaying ? "Pause Preview" : "Play Preview"
              : isTimelinePlaying ? "Pause Timeline" : "Play Timeline"}
          >
            {isTimelinePlaying ? (
              <Pause className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onTogglePreview}
            aria-pressed={playbackMode === 'preview'}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-black uppercase tracking-widest shadow-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400/70",
              playbackMode === 'preview'
                ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/25"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
            )}
            title={playbackMode === 'preview' ? "Hide preview" : "Show preview"}
          >
            <MonitorPlay className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Preview</span>
          </button>
          <span className="text-[10px] font-mono text-zinc-300 bg-zinc-900 border border-zinc-800/80 px-2 py-0.5 rounded-full font-bold">
            {timelineCurrentTime.toFixed(1)}s
          </span>
        </div>
        )}

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
          <div className="w-px h-3 bg-zinc-800 mx-0.5" />
          <button
            type="button"
            onClick={handleFitToScreen}
            className="p-1 rounded hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
            title="Fit to screen"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative border border-zinc-800/80 bg-[#09090b]/40 rounded-xl flex flex-col overflow-hidden">
        <div
          ref={scrollContainerRef}
          className={cn(
            "overflow-x-auto overflow-y-hidden timeline-track-scroll flex flex-col flex-1 relative transition-opacity duration-300",
            isFitted ? "opacity-100" : "opacity-0"
          )}
          id="timeline-track-scrub-zone"
        >
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
              <div className="flex items-center justify-center w-full h-full text-zinc-650 text-xs py-4">
                Timeline is empty. Drag media items or collections here.
              </div>
            ) : (() => {
              let currentStartOffset = 0;
              return timelineItems.map((gridItem) => {
                const dragKey = `${gridItem.type}:${gridItem.id}`;
                let duration = 3;
                let name = '';
                let previewUrl = '';
                let isImage = false;
                let isVideo = false;

                if (gridItem.type === 'media') {
                  duration = resizingItem && resizingItem.id === gridItem.id
                    ? resizingItem.currentDuration
                    : getTimelineMediaDuration(gridItem.item);
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

                const itemStartOffset = currentStartOffset;
                currentStartOffset += duration;

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
                    onMouseEnter={() => setHoveredItemKey(dragKey)}
                    onMouseLeave={() => setHoveredItemKey(null)}
                    onClick={() => onTimelineTimeChange(itemStartOffset)}
                    style={{ width: `${blockWidth}px` }}
                    className={cn(
                      "relative group flex-shrink-0 flex items-stretch border-r border-zinc-800/80 bg-zinc-950/30 select-none overflow-hidden transition-colors duration-150 cursor-grab active:cursor-grabbing",
                      timelineDragOverKey === dragKey && "border-l-2 border-l-indigo-500 bg-indigo-950/20",
                      gridItem.type === 'collection' && "bg-zinc-900/10 border-b-2 border-b-zinc-800",
                      isItemActive ? "bg-indigo-955/10 border-t border-t-indigo-500/40" : ""
                    )}
                  >
                    {hoveredItemKey === dragKey && (
                      <div className="absolute inset-0 border border-indigo-500/45 pointer-events-none z-[25] rounded-[inherit] bg-indigo-500/5 shadow-[inset_0_0_6px_rgba(99,102,241,0.25)]" />
                    )}
                    {collectionSplitPercents.map((leftPercent) => (
                      <div
                        key={`collection-split-${dragKey}-${leftPercent.toFixed(3)}`}
                        className="absolute top-0 bottom-0 z-[12] w-0 -translate-x-1/2 border-l-2 border-dashed border-black shadow-[0_0_8px_rgba(0,0,0,0.8)] pointer-events-none"
                        style={{ left: `${leftPercent}%` }}
                      />
                    ))}

                    {gridItem.type === 'collection' && (
                      <SceneLaunchTimelineCollectionMenu
                        collectionName={gridItem.collection.name}
                        mediaItems={getCollectionTimelineMediaItems(gridItem.collection)}
                        updateSceneLaunchMediaDuration={updateSceneLaunchMediaDuration}
                        updateSceneLaunchMediaTrim={updateSceneLaunchMediaTrim}
                      />
                    )}

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
                        className={cn(
                          "absolute inset-y-0 left-0 right-0 z-20 flex items-stretch opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                          isItemActive && "opacity-100",
                          resizingItem?.id === gridItem.id && "opacity-100"
                        )}
                      >
                        <div className="pointer-events-none flex w-3.5 shrink-0 select-none items-center justify-center rounded-l-md border-y-2 border-l-2 border-white bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.28),0_6px_18px_rgba(0,0,0,0.35)]">
                          <div className="h-6 w-[1.5px] rounded-full bg-zinc-400/60" />
                        </div>

                        <div className="pointer-events-none flex-1 border-y-2 border-white" />

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
                          className="flex w-3.5 shrink-0 cursor-col-resize select-none items-center justify-center rounded-r-md border-y-2 border-r-2 border-white bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.28),0_6px_18px_rgba(0,0,0,0.35)] transition-[width,box-shadow] duration-150 hover:w-4 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.7),0_0_18px_rgba(255,255,255,0.22),0_8px_22px_rgba(0,0,0,0.45)]"
                          aria-label="Resize timeline item duration"
                          title="Resize duration"
                        >
                          <div className="h-6 w-[1.5px] rounded-full bg-zinc-400/60" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
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
