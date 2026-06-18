'use client';

import React from 'react';
import { Button } from '@storyboard/ui';
import { CornerUpLeft, FolderInput, FolderOpen, Grid2X2, Plus, Trash2 } from 'lucide-react';
import { SceneLaunchMediaTile } from './SceneLaunchMediaTile';
import { SceneLaunchCollectionTile } from './SceneLaunchCollectionTile';
import type { SceneLaunchBeat, SceneLaunchMediaItem } from './useSceneLaunchBoard';
import type { TimelineAspectRatio } from '@/lib/timeline-context';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface SceneLaunchGridProps {
  activeSceneLaunchBeatId: string | null;
  activeSceneLaunchBeat: SceneLaunchBeat | null;
  sceneLaunchGridItems: Array<
    | { id: string; type: 'media'; item: SceneLaunchMediaItem }
    | { id: string; type: 'collection'; collection: SceneLaunchBeat }
  >;
  isTimelinePlaying: boolean;
  activeItemKey: string | null;
  hoveredItemKey: string | null;
  setHoveredItemKey: React.Dispatch<React.SetStateAction<string | null>>;
  trimmingItemId: string | null;
  setTrimmingItemId: (id: string | null) => void;
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
  getSceneLaunchMediaTileStyle: (item: SceneLaunchMediaItem) => React.CSSProperties;
  gridDragOverInfo: { targetKey: string; position: 'before' | 'after' | 'inside' } | null;
  handleGridDragOver: (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
  handleGridDragLeave: () => void;
  handleGridDrop: (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
  syncTimelinePlayheadToCollectionPreview: (beatId: string, elapsedSeconds: number) => void;
  updateSceneLaunchMediaOriginalDuration: (mediaId: string, duration: number) => void;
  updateSceneLaunchMediaDuration: (mediaId: string, duration: number) => void;
  updateSceneLaunchMediaTrim: (mediaId: string, trimStart: number, duration: number) => void;
  handleItemContextMenu: (event: React.MouseEvent, dragKey: string) => void;
  handleBoardContextMenu: (event: React.MouseEvent<HTMLElement>, insertionIndex: number) => void;
  onPreviewMedia: (item: SceneLaunchMediaItem) => void;
  emptyTrash: () => void;
  createSceneLaunchBeat: () => void;
  handleBeatDrop: (event: React.DragEvent<HTMLDivElement>, beatId: string) => void;
  aspectRatio: TimelineAspectRatio;
  allCollections: SceneLaunchBeat[];
  draggedGridItemKey: string | null;
  setDraggedGridItemKey: React.Dispatch<React.SetStateAction<string | null>>;
  moveSceneLaunchItemToParent: (dragKey: string) => void;
  moveSceneLaunchItemToTargetCollection: (dragKey: string, targetId: string) => void;
}

export function SceneLaunchGrid({
  activeSceneLaunchBeatId,
  activeSceneLaunchBeat,
  sceneLaunchGridItems,
  isTimelinePlaying,
  activeItemKey,
  hoveredItemKey,
  setHoveredItemKey,
  trimmingItemId,
  setTrimmingItemId,
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
  getSceneLaunchMediaTileStyle,
  gridDragOverInfo,
  handleGridDragOver,
  handleGridDragLeave,
  handleGridDrop,
  syncTimelinePlayheadToCollectionPreview,
  updateSceneLaunchMediaOriginalDuration,
  updateSceneLaunchMediaDuration,
  updateSceneLaunchMediaTrim,
  handleItemContextMenu,
  handleBoardContextMenu,
  onPreviewMedia,
  emptyTrash,
  createSceneLaunchBeat,
  handleBeatDrop,
  aspectRatio,
  allCollections,
  draggedGridItemKey,
  setDraggedGridItemKey,
  moveSceneLaunchItemToParent,
  moveSceneLaunchItemToTargetCollection,
}: SceneLaunchGridProps) {

  const [utilityDropZone, setUtilityDropZone] = React.useState<'parent' | 'directory' | null>(null);
  const [directoryPendingKey, setDirectoryPendingKey] = React.useState<string | null>(null);
  const [isDirectoryPickerOpen, setIsDirectoryPickerOpen] = React.useState(false);
  const dropHandledRef = React.useRef(false);
  const directoryMoveCommittedRef = React.useRef(false);

  const getAspectRatioValue = (ratio: string): number => {
    const [w, h] = ratio.split(':').map(Number);
    return w / h;
  };
  const ratioValue = getAspectRatioValue(aspectRatio);
  const calculatedWidth = 10 * ratioValue;
  const finalWidth = Math.max(7.5, calculatedWidth);
  const canMoveToParent = !!activeSceneLaunchBeatId && activeSceneLaunchBeatId !== 'trash';
  const draggedCollectionId = draggedGridItemKey?.startsWith('collection:')
    ? draggedGridItemKey.slice('collection:'.length)
    : directoryPendingKey?.startsWith('collection:')
      ? directoryPendingKey.slice('collection:'.length)
      : null;
  const unavailableCollectionIds = React.useMemo(() => {
    const unavailable = new Set<string>();
    if (!draggedCollectionId) return unavailable;

    const visit = (collectionId: string) => {
      if (unavailable.has(collectionId)) return;
      unavailable.add(collectionId);
      const collection = allCollections.find(candidate => candidate.id === collectionId);
      collection?.childIds.forEach(visit);
    };
    visit(draggedCollectionId);
    return unavailable;
  }, [allCollections, draggedCollectionId]);
  const availableDirectoryCollections = allCollections.filter(collection => (
    collection.id !== 'trash' && !unavailableCollectionIds.has(collection.id)
  ));
  const handleGridItemDragStart = (event: React.DragEvent<HTMLElement>, dragKey: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragKey);
    setDirectoryPendingKey(null);
    setIsDirectoryPickerOpen(false);
    dropHandledRef.current = false;
    directoryMoveCommittedRef.current = false;
    // Defer the state update so the browser captures the drag ghost image
    // before the DOM is modified by the placeholder overlay.
    requestAnimationFrame(() => {
      setDraggedGridItemKey(dragKey);
    });
  };

  const handleGridItemDragEnd = () => {
    setDraggedGridItemKey(null);
    setUtilityDropZone(null);
    handleGridDragLeave();
  };

  const getDraggedKey = (event: React.DragEvent<HTMLElement>) => (
    event.dataTransfer.getData('text/plain') || draggedGridItemKey || ''
  );

  const claimNativeDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (dropHandledRef.current) return false;
    dropHandledRef.current = true;
    return true;
  };

  const handleParentDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!claimNativeDrop(event)) return;
    const dragKey = getDraggedKey(event);
    if (dragKey && canMoveToParent) moveSceneLaunchItemToParent(dragKey);
    setDraggedGridItemKey(null);
    setUtilityDropZone(null);
  };

  const handleDirectoryDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!claimNativeDrop(event)) return;
    const dragKey = getDraggedKey(event);
    if (!dragKey) return;
    setDirectoryPendingKey(dragKey);
    setDraggedGridItemKey(null);
    setUtilityDropZone(null);
    setIsDirectoryPickerOpen(true);
  };

  const chooseDirectory = (collectionId: string) => {
    if (!directoryPendingKey || directoryMoveCommittedRef.current) return;
    directoryMoveCommittedRef.current = true;
    moveSceneLaunchItemToTargetCollection(directoryPendingKey, collectionId);
    setDirectoryPendingKey(null);
    setIsDirectoryPickerOpen(false);
  };

  const handleItemDrop = (
    event: React.DragEvent<HTMLElement>,
    targetKey: string,
    isCollection: boolean,
  ) => {
    if (!claimNativeDrop(event)) return;
    handleGridDrop(event, targetKey, isCollection);
    setDraggedGridItemKey(null);
    setUtilityDropZone(null);
  };

  const handleGridItemContextMenu = (event: React.MouseEvent, dragKey: string) => {
    setDraggedGridItemKey(null);
    setDirectoryPendingKey(null);
    setIsDirectoryPickerOpen(false);
    handleItemContextMenu(event, dragKey);
  };

  const renderOriginPlaceholder = (dragKey: string) => (
    <div className="absolute inset-0 z-50 grid grid-cols-2 gap-2 rounded-lg border border-dashed border-indigo-400/70 bg-zinc-950/95 p-2 shadow-inner shadow-indigo-500/10 backdrop-blur-sm">
      <div
        role="button"
        aria-disabled={!canMoveToParent}
        onDragOver={(event) => {
          if (!canMoveToParent) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setUtilityDropZone('parent');
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setUtilityDropZone(current => current === 'parent' ? null : current);
        }}
        onDrop={handleParentDrop}
        className={cn(
          "flex min-w-0 flex-col items-center justify-center rounded-md border border-dashed p-2 text-center transition-all",
          !canMoveToParent && "border-zinc-800 bg-zinc-900/40 text-zinc-600",
          canMoveToParent && utilityDropZone !== 'parent' && "border-zinc-700 bg-zinc-900/70 text-zinc-300",
          utilityDropZone === 'parent' && "border-indigo-400 bg-indigo-500/20 text-indigo-100 shadow-lg shadow-indigo-500/10",
        )}
      >
        <CornerUpLeft className="size-5" />
        <span className="mt-2 text-[9px] font-black uppercase tracking-widest">Parent</span>
        <span className="mt-1 text-[9px] leading-3 text-zinc-500">
          {canMoveToParent ? 'Move up one level' : 'Top level'}
        </span>
      </div>

      <Popover
        open={isDirectoryPickerOpen && directoryPendingKey === dragKey}
        onOpenChange={(open) => {
          setIsDirectoryPickerOpen(open);
          if (!open) setDirectoryPendingKey(null);
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'move';
                setUtilityDropZone('directory');
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setUtilityDropZone(current => current === 'directory' ? null : current);
              }}
              onDrop={handleDirectoryDrop}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center rounded-md border border-dashed p-2 text-center transition-all",
                utilityDropZone !== 'directory' && "border-zinc-700 bg-zinc-900/70 text-zinc-300",
                utilityDropZone === 'directory' && "border-indigo-400 bg-indigo-500/20 text-indigo-100 shadow-lg shadow-indigo-500/10",
              )}
            />
          }
        >
          <FolderInput className="size-5" />
          <span className="mt-2 text-[9px] font-black uppercase tracking-widest">Directory</span>
          <span className="mt-1 text-[9px] leading-3 text-zinc-500">Choose collection</span>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="w-80 p-0">
          <PopoverHeader className="px-3 pt-3">
            <PopoverTitle>Move to collection</PopoverTitle>
            <PopoverDescription>Select a directory for the dropped item.</PopoverDescription>
          </PopoverHeader>
          <Command>
            <CommandInput placeholder="Search collections..." autoFocus />
            <CommandList>
              <CommandEmpty>No available collections.</CommandEmpty>
              <CommandGroup heading="Collections">
                {availableDirectoryCollections.map(collection => (
                  <CommandItem
                    key={collection.id}
                    value={`${collection.name} ${collection.id}`}
                    onSelect={() => chooseDirectory(collection.id)}
                  >
                    <FolderOpen />
                    <span className="truncate">{collection.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
  const getGridInsertionIndex = (
    event: React.MouseEvent<HTMLElement>,
    container: HTMLElement,
  ) => {
    const itemElements = Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-scene-grid-item="true"]'));
    if (itemElements.length === 0) return 0;

    const entries = itemElements
      .map((element, index) => ({ element, index, rect: element.getBoundingClientRect() }))
      .sort((a, b) => (Math.abs(a.rect.top - b.rect.top) > 8 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left));
    const rows: Array<typeof entries> = [];

    for (const entry of entries) {
      const row = rows.find(items => Math.abs(items[0].rect.top - entry.rect.top) <= 8);
      if (row) {
        row.push(entry);
      } else {
        rows.push([entry]);
      }
    }

    const y = event.clientY;
    const x = event.clientX;
    const targetRow = rows.find(row => {
      const top = Math.min(...row.map(item => item.rect.top));
      const bottom = Math.max(...row.map(item => item.rect.bottom));
      return y <= bottom || y < top;
    }) ?? rows[rows.length - 1];

    for (const entry of targetRow) {
      if (x < entry.rect.left + entry.rect.width / 2) {
        return entry.index;
      }
    }

    return targetRow[targetRow.length - 1].index + 1;
  };

  const handleGridBackgroundContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (activeSceneLaunchBeatId === 'trash') return;
    if ((event.target as HTMLElement).closest('[data-scene-grid-item="true"]')) return;

    event.preventDefault();
    event.stopPropagation();
    const gridContainer = event.currentTarget.matches('[data-scene-grid-container="true"]')
      ? event.currentTarget
      : event.currentTarget.querySelector<HTMLElement>('[data-scene-grid-container="true"]') ?? event.currentTarget;
    handleBoardContextMenu(event, getGridInsertionIndex(event, gridContainer));
  };

  return (
    <section className="relative mt-6 w-full shrink-0">
      {activeSceneLaunchBeat ? (
        <>
          {activeSceneLaunchBeatId === 'trash' && (
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-zinc-200">Trash Folder</h2>
                <p className="mt-1 text-[11px] text-zinc-700">
                  Items moved here can be restored or permanently deleted
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-red-950 bg-red-950/10 text-xs text-red-450 hover:bg-red-950 hover:text-white transition-colors"
                onClick={emptyTrash}
                disabled={activeSceneLaunchBeat.gridOrder.length === 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Empty Trash
              </Button>
            </div>
          )}

          <div
            className="rounded-lg border border-zinc-900 bg-zinc-950/30 p-3"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleBeatDrop(event, activeSceneLaunchBeat.id)}
            onContextMenu={handleGridBackgroundContextMenu}
          >
            {sceneLaunchGridItems.length > 0 ? (
              <div
                data-scene-grid-container="true"
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${finalWidth}rem, 1fr))`,
                }}
                onContextMenu={handleGridBackgroundContextMenu}
              >
                {sceneLaunchGridItems.map((gridItem) => {
                  const dragKey = `${gridItem.type}:${gridItem.id}`;

                  if (gridItem.type === 'media') {
                    return (
                      <SceneLaunchMediaTile
                        key={dragKey}
                        item={gridItem.item}
                        dragKey={dragKey}
                        isTimelinePlaying={isTimelinePlaying}
                        activeItemKey={activeItemKey}
                        hoveredItemKey={hoveredItemKey}
                        setHoveredItemKey={setHoveredItemKey}
                        trimmingItemId={trimmingItemId}
                        setTrimmingItemId={setTrimmingItemId}
                        getGridItemTimelineState={getGridItemTimelineState}
                        updateSceneLaunchMediaOriginalDuration={updateSceneLaunchMediaOriginalDuration}
                        updateSceneLaunchMediaDuration={updateSceneLaunchMediaDuration}
                        updateSceneLaunchMediaTrim={updateSceneLaunchMediaTrim}
                        handleItemContextMenu={handleGridItemContextMenu}
                        getSceneLaunchMediaTileStyle={getSceneLaunchMediaTileStyle}
                        getSceneLaunchMediaPreviewStyle={getSceneLaunchMediaPreviewStyle}
                        gridDragOverInfo={gridDragOverInfo}
                        handleGridDragOver={handleGridDragOver}
                        handleGridDragLeave={handleGridDragLeave}
                        handleGridDrop={handleItemDrop}
                        onPreviewMedia={onPreviewMedia}
                        isBeingDragged={draggedGridItemKey === dragKey || directoryPendingKey === dragKey}
                        onGridDragStart={handleGridItemDragStart}
                        onGridDragEnd={handleGridItemDragEnd}
                        dragPlaceholderContent={renderOriginPlaceholder(dragKey)}
                      />
                    );
                  }

                  return (
                    <SceneLaunchCollectionTile
                      key={dragKey}
                      beat={gridItem.collection}
                      dragKey={dragKey}
                      isTimelinePlaying={isTimelinePlaying}
                      activeItemKey={activeItemKey}
                      hoveredItemKey={hoveredItemKey}
                      setHoveredItemKey={setHoveredItemKey}
                      collectionScrubbingId={collectionScrubbingId}
                      setCollectionScrubbingId={setCollectionScrubbingId}
                      sceneLaunchPreviewHover={sceneLaunchPreviewHover}
                      setSceneLaunchPreviewHover={setSceneLaunchPreviewHover}
                      sceneLaunchManuallyPaused={sceneLaunchManuallyPaused}
                      setSceneLaunchManuallyPaused={setSceneLaunchManuallyPaused}
                      sceneLaunchPreviewPausedOffset={sceneLaunchPreviewPausedOffset}
                      setSceneLaunchPreviewPausedOffset={setSceneLaunchPreviewPausedOffset}
                      openBeatDetail={openBeatDetail}
                      changeCollectionPreviewItem={changeCollectionPreviewItem}
                      getGridItemTimelineState={getGridItemTimelineState}
                      getSceneLaunchCollectionPreview={getSceneLaunchCollectionPreview}
                      getRecursiveCollectionDuration={getRecursiveCollectionDuration}
                      getRecursiveMediaItems={getRecursiveMediaItems}
                      getSceneLaunchCollectionTileStyle={getSceneLaunchCollectionTileStyle}
                      getSceneLaunchMediaPreviewStyle={getSceneLaunchMediaPreviewStyle}
                      gridDragOverInfo={gridDragOverInfo}
                      handleGridDragOver={handleGridDragOver}
                      handleGridDragLeave={handleGridDragLeave}
                      handleGridDrop={handleItemDrop}
                      syncTimelinePlayheadToCollectionPreview={syncTimelinePlayheadToCollectionPreview}
                      handleItemContextMenu={handleGridItemContextMenu}
                      isBeingDragged={draggedGridItemKey === dragKey || directoryPendingKey === dragKey}
                      onGridDragStart={handleGridItemDragStart}
                      onGridDragEnd={handleGridItemDragEnd}
                      dragPlaceholderContent={renderOriginPlaceholder(dragKey)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-64 w-full flex-col items-center justify-center rounded-md border border-dashed border-zinc-900 text-center text-zinc-650 transition-colors">
                {activeSceneLaunchBeatId === 'trash' ? (
                  <>
                    <Trash2 className="h-7 w-7 text-zinc-700" />
                    <span className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">Trash is empty</span>
                    <span className="mt-2 max-w-xs text-[11px] leading-5 text-zinc-700">Drag items to the Trash icon in the sidebar or right-click to delete them.</span>
                  </>
                ) : (
                  <>
                    <Grid2X2 className="h-7 w-7 text-zinc-700" />
                    <span className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">Collection is empty</span>
                    <span className="mt-2 max-w-xs text-[11px] leading-5 text-zinc-700">Drag and drop media here or add a child collection to begin.</span>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div
            data-scene-grid-container="true"
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${finalWidth}rem, 1fr))`,
            }}
            onContextMenu={handleGridBackgroundContextMenu}
          >
            {sceneLaunchGridItems.map((gridItem) => {
              const dragKey = `${gridItem.type}:${gridItem.id}`;

              if (gridItem.type === 'media') {
                return (
                  <SceneLaunchMediaTile
                    key={dragKey}
                    item={gridItem.item}
                    dragKey={dragKey}
                    isTimelinePlaying={isTimelinePlaying}
                    activeItemKey={activeItemKey}
                    hoveredItemKey={hoveredItemKey}
                    setHoveredItemKey={setHoveredItemKey}
                    trimmingItemId={trimmingItemId}
                    setTrimmingItemId={setTrimmingItemId}
                    getGridItemTimelineState={getGridItemTimelineState}
                    updateSceneLaunchMediaOriginalDuration={updateSceneLaunchMediaOriginalDuration}
                    updateSceneLaunchMediaDuration={updateSceneLaunchMediaDuration}
                    updateSceneLaunchMediaTrim={updateSceneLaunchMediaTrim}
                    handleItemContextMenu={handleGridItemContextMenu}
                    getSceneLaunchMediaTileStyle={getSceneLaunchMediaTileStyle}
                    getSceneLaunchMediaPreviewStyle={getSceneLaunchMediaPreviewStyle}
                    gridDragOverInfo={gridDragOverInfo}
                    handleGridDragOver={handleGridDragOver}
                    handleGridDragLeave={handleGridDragLeave}
                    handleGridDrop={handleItemDrop}
                    onPreviewMedia={onPreviewMedia}
                    isBeingDragged={draggedGridItemKey === dragKey || directoryPendingKey === dragKey}
                    onGridDragStart={handleGridItemDragStart}
                    onGridDragEnd={handleGridItemDragEnd}
                    dragPlaceholderContent={renderOriginPlaceholder(dragKey)}
                  />
                );
              }

              return (
                <SceneLaunchCollectionTile
                  key={dragKey}
                  beat={gridItem.collection}
                  dragKey={dragKey}
                  isTimelinePlaying={isTimelinePlaying}
                  activeItemKey={activeItemKey}
                  hoveredItemKey={hoveredItemKey}
                  setHoveredItemKey={setHoveredItemKey}
                  collectionScrubbingId={collectionScrubbingId}
                  setCollectionScrubbingId={setCollectionScrubbingId}
                  sceneLaunchPreviewHover={sceneLaunchPreviewHover}
                  setSceneLaunchPreviewHover={setSceneLaunchPreviewHover}
                  sceneLaunchManuallyPaused={sceneLaunchManuallyPaused}
                  setSceneLaunchManuallyPaused={setSceneLaunchManuallyPaused}
                  sceneLaunchPreviewPausedOffset={sceneLaunchPreviewPausedOffset}
                  setSceneLaunchPreviewPausedOffset={setSceneLaunchPreviewPausedOffset}
                  openBeatDetail={openBeatDetail}
                  changeCollectionPreviewItem={changeCollectionPreviewItem}
                  getGridItemTimelineState={getGridItemTimelineState}
                  getSceneLaunchCollectionPreview={getSceneLaunchCollectionPreview}
                  getRecursiveCollectionDuration={getRecursiveCollectionDuration}
                  getRecursiveMediaItems={getRecursiveMediaItems}
                  getSceneLaunchCollectionTileStyle={getSceneLaunchCollectionTileStyle}
                  getSceneLaunchMediaPreviewStyle={getSceneLaunchMediaPreviewStyle}
                  gridDragOverInfo={gridDragOverInfo}
                  handleGridDragOver={handleGridDragOver}
                  handleGridDragLeave={handleGridDragLeave}
                  handleGridDrop={handleItemDrop}
                  syncTimelinePlayheadToCollectionPreview={syncTimelinePlayheadToCollectionPreview}
                  handleItemContextMenu={handleGridItemContextMenu}
                  isBeingDragged={draggedGridItemKey === dragKey || directoryPendingKey === dragKey}
                  onGridDragStart={handleGridItemDragStart}
                  onGridDragEnd={handleGridItemDragEnd}
                  dragPlaceholderContent={renderOriginPlaceholder(dragKey)}
                />
              );
            })}

            <button
              type="button"
              style={getSceneLaunchCollectionTileStyle()}
              className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 text-zinc-650 transition-colors hover:border-zinc-700 hover:bg-zinc-950 hover:text-zinc-300 h-36 sm:h-40 lg:h-44"
              onClick={createSceneLaunchBeat}
            >
              <Plus className="h-6 w-6" />
              <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest">Add collection</span>
            </button>
          </div>
        </>
      )}
    </section>
  );
}
