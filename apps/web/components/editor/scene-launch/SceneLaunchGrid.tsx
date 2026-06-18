'use client';

import React from 'react';
import { Button } from '@storyboard/ui';
import { CornerUpLeft, Folder, FolderInput, FolderOpen, Grid2X2, Plus, Trash2, X } from 'lucide-react';
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
  moveItemToTrash: (dragKey: string) => void;
  thumbnailMode: 'grid' | 'single';
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
  moveItemToTrash,
  thumbnailMode,
}: SceneLaunchGridProps) {

  const [utilityDropZone, setUtilityDropZone] = React.useState<'parent' | 'directory' | 'trash' | 'cancel' | null>(null);
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

  const flatDirectoryTree = React.useMemo(() => {
    const parentMap = new Map<string, string>();
    allCollections.forEach(p => {
      p.childIds.forEach(cId => {
        parentMap.set(cId, p.id);
      });
    });

    const itemMap = new Map<string, SceneLaunchBeat>();
    availableDirectoryCollections.forEach(item => itemMap.set(item.id, item));

    const roots = availableDirectoryCollections.filter(item => {
      const pId = parentMap.get(item.id);
      return !pId || !itemMap.has(pId);
    });

    interface TempTreeNode {
      id: string;
      name: string;
      children: TempTreeNode[];
      depth: number;
    }

    const getChildren = (nodeId: string, depth: number): TempTreeNode[] => {
      const node = itemMap.get(nodeId);
      if (!node) return [];
      const childNodes: TempTreeNode[] = [];
      node.childIds.forEach(cId => {
        if (itemMap.has(cId)) {
          childNodes.push({
            id: cId,
            name: itemMap.get(cId)!.name,
            children: getChildren(cId, depth + 1),
            depth: depth + 1
          });
        }
      });
      return childNodes;
    };

    const tree = roots.map(r => ({
      id: r.id,
      name: r.name,
      children: getChildren(r.id, 0),
      depth: 0
    }));

    interface FlatTreeNode {
      id: string;
      name: string;
      depth: number;
      hasChildren: boolean;
    }

    const flatList: FlatTreeNode[] = [];
    const traverse = (node: TempTreeNode) => {
      flatList.push({
        id: node.id,
        name: node.name,
        depth: node.depth,
        hasChildren: node.children.length > 0
      });
      node.children.forEach(traverse);
    };
    tree.forEach(traverse);
    return flatList;
  }, [allCollections, availableDirectoryCollections]);
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

  const handleTrashDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!claimNativeDrop(event)) return;
    const dragKey = getDraggedKey(event);
    if (dragKey && activeSceneLaunchBeatId !== 'trash') moveItemToTrash(dragKey);
    setDraggedGridItemKey(null);
    setUtilityDropZone(null);
  };

  const handleCancelDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!claimNativeDrop(event)) return;
    setDraggedGridItemKey(null);
    setUtilityDropZone(null);
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

  const renderOriginPlaceholder = (dragKey: string) => {
    const canMoveToTrash = activeSceneLaunchBeatId !== 'trash';
    return (
      <div
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute inset-0 z-50 grid grid-cols-2 grid-rows-2 gap-1.5 rounded-lg border border-dashed border-indigo-400/70 bg-zinc-950/95 p-1.5 shadow-inner shadow-indigo-500/10 backdrop-blur-sm"
      >
        {/* Option 1: Parent */}
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
            "flex min-w-0 flex-col items-center justify-center rounded-md border border-dashed p-1 text-center transition-all",
            !canMoveToParent && "border-zinc-800 bg-zinc-900/40 text-zinc-600",
            canMoveToParent && utilityDropZone !== 'parent' && "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-indigo-450 hover:bg-indigo-950/20 hover:text-indigo-200",
            utilityDropZone === 'parent' && "border-indigo-400 bg-indigo-500/25 text-indigo-100 shadow-lg shadow-indigo-500/10",
          )}
        >
          <CornerUpLeft className="size-4" />
          <span className="mt-1 text-[8px] font-black uppercase tracking-widest leading-none">Parent</span>
          <span className="mt-0.5 text-[7px] leading-none text-zinc-500 truncate max-w-full px-1">
            {canMoveToParent ? 'Move up' : 'Top level'}
          </span>
        </div>

        {/* Option 2: Directory */}
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
                  "flex w-full min-w-0 flex-col items-center justify-center rounded-md border border-dashed p-1 text-center transition-all",
                  utilityDropZone !== 'directory' && "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-indigo-450 hover:bg-indigo-950/20 hover:text-indigo-200",
                  utilityDropZone === 'directory' && "border-indigo-400 bg-indigo-500/25 text-indigo-100 shadow-lg shadow-indigo-500/10",
                )}
              />
            }
          >
            <FolderInput className="size-4" />
            <span className="mt-1 text-[8px] font-black uppercase tracking-widest leading-none">Directory</span>
            <span className="mt-0.5 text-[7px] leading-none text-zinc-500 truncate max-w-full px-1">Choose folder</span>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-80 p-0 bg-zinc-950 border-zinc-800 shadow-2xl">
            <PopoverHeader className="px-3 pt-3">
              <PopoverTitle className="text-zinc-200">Move to collection</PopoverTitle>
              <PopoverDescription className="text-zinc-550">Select a directory for the dropped item.</PopoverDescription>
            </PopoverHeader>
            <Command className="bg-transparent">
              <CommandInput placeholder="Search collections..." autoFocus className="text-zinc-250" />
              <CommandList className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-850 scrollbar-track-transparent">
                <CommandEmpty className="text-zinc-500 text-xs py-4 text-center">No available collections.</CommandEmpty>
                <CommandGroup heading="Collections" className="text-zinc-550 text-[10px] uppercase font-bold tracking-wider px-2">
                  <div className="flex flex-col gap-0.5 py-1">
                    {flatDirectoryTree.map(node => (
                      <CommandItem
                        key={node.id}
                        value={`${node.name} ${node.id}`}
                        onSelect={() => chooseDirectory(node.id)}
                        className="relative group flex items-center gap-2.5 py-2 pr-3 text-xs text-zinc-300 hover:text-white cursor-pointer select-none outline-none data-[selected=true]:bg-zinc-900 data-[selected=true]:text-white transition-colors rounded-md overflow-hidden"
                        style={{ paddingLeft: `${12 + node.depth * 16}px` }}
                      >
                        {/* Indentation lines */}
                        {node.depth > 0 && (
                          <>
                            {/* Vertical lines for parents */}
                            {Array.from({ length: node.depth }).map((_, i) => (
                              <div
                                key={i}
                                className="absolute top-0 bottom-0 w-px border-l border-dashed border-zinc-800/80 group-hover:border-zinc-700/60 transition-colors"
                                style={{ left: `${8 + i * 16}px` }}
                              />
                            ))}
                            {/* Horizontal connector line */}
                            <div
                              className="absolute top-1/2 -translate-y-1/2 h-px w-2 border-t border-dashed border-zinc-800/80 group-hover:border-zinc-700/60 transition-colors"
                              style={{ left: `${8 + (node.depth - 1) * 16}px` }}
                            />
                          </>
                        )}
                        
                        {node.hasChildren ? (
                          <FolderOpen className="size-3.5 shrink-0 text-indigo-400/80 group-hover:text-indigo-400 transition-colors z-10" />
                        ) : (
                          <Folder className="size-3.5 shrink-0 text-zinc-500 group-hover:text-zinc-350 transition-colors z-10" />
                        )}
                        <span className="truncate font-semibold z-10">{node.name}</span>
                      </CommandItem>
                    ))}
                  </div>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Option 3: Trash */}
        <div
          role="button"
          aria-disabled={!canMoveToTrash}
          onDragOver={(event) => {
            if (!canMoveToTrash) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setUtilityDropZone('trash');
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setUtilityDropZone(current => current === 'trash' ? null : current);
          }}
          onDrop={handleTrashDrop}
          className={cn(
            "flex min-w-0 flex-col items-center justify-center rounded-md border border-dashed p-1 text-center transition-all",
            !canMoveToTrash && "border-zinc-800 bg-zinc-900/40 text-zinc-600",
            canMoveToTrash && utilityDropZone !== 'trash' && "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-red-900/50 hover:bg-red-950/10 hover:text-red-400",
            utilityDropZone === 'trash' && "border-red-500 bg-red-950/30 text-red-200 shadow-lg shadow-red-900/20",
          )}
        >
          <Trash2 className="size-4" />
          <span className="mt-1 text-[8px] font-black uppercase tracking-widest leading-none">Trash</span>
          <span className="mt-0.5 text-[7px] leading-none text-zinc-500 truncate max-w-full px-1">
            {canMoveToTrash ? 'Move to trash' : 'In trash'}
          </span>
        </div>

        {/* Option 4: Cancel */}
        <div
          role="button"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setUtilityDropZone('cancel');
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setUtilityDropZone(current => current === 'cancel' ? null : current);
          }}
          onDrop={handleCancelDrop}
          className={cn(
            "flex min-w-0 flex-col items-center justify-center rounded-md border border-dashed p-1 text-center transition-all",
            utilityDropZone !== 'cancel' && "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-850/40 hover:text-zinc-200",
            utilityDropZone === 'cancel' && "border-zinc-400 bg-zinc-800/80 text-zinc-100 shadow-lg shadow-zinc-500/10",
          )}
        >
          <X className="size-4" />
          <span className="mt-1 text-[8px] font-black uppercase tracking-widest leading-none">Cancel</span>
          <span className="mt-0.5 text-[7px] leading-none text-zinc-500 truncate max-w-full px-1">Cancel drag</span>
        </div>
      </div>
    );
  };
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
                className="grid gap-5"
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
                      allCollections={allCollections}
                      aspectRatio={ratioValue}
                      thumbnailMode={thumbnailMode}
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
            className="grid gap-5"
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
                  allCollections={allCollections}
                  aspectRatio={ratioValue}
                  thumbnailMode={thumbnailMode}
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
