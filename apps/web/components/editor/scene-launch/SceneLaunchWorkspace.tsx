'use client';

import React from 'react';
import Image from 'next/image';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Clapperboard, Grid2X2, Pause, Play, Plus, Ratio, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@storyboard/ui';
import { toast } from 'sonner';

import { useSceneLaunchBoard, type SceneLaunchBeat, type SceneLaunchMediaItem } from './useSceneLaunchBoard';
import { SceneLaunchSidebar } from '../SceneLaunchSidebar';
import { SceneLaunchHeader } from '../SceneLaunchHeader';
import { SceneLaunchCanvasPreview, type SceneLaunchCanvasPreviewSnapshot } from './SceneLaunchCanvasPreview';
import { SceneLaunchGrid } from './SceneLaunchGrid';
import {
  SceneLaunchPreviewWheelV3,
  type SceneLaunchPreviewWheelV3Effect,
  type SceneLaunchPreviewWheelV3Sizing,
} from './SceneLaunchPreviewWheelV3';
import { VideoFrameFilmstrip } from './VideoFrameFilmstrip';
import type { SceneLaunchPlaybackMode } from '../SceneLaunchTimeline';
import { SceneLaunchContextMenu } from '../SceneLaunchContextMenu';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import type { SidebarTab } from '../EditorSidebarRail';
import { type Scene, type TimelineClip, type ClipType, type TimelineAspectRatio } from '@/lib/timeline-context';

const MAX_IMAGE_DURATION_SECONDS = 60 * 60;
const COLLECTION_WHEEL_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='225' viewBox='0 0 400 225'><rect width='400' height='225' fill='%2309090b'/><g fill='none' stroke='%2352525b' stroke-width='8'><rect x='142' y='72' width='116' height='82' rx='8'/><path d='M150 72v-14h42l14 14'/></g></svg>";
type PreviewWheelSequence = 'media' | 'collections';

interface SceneLaunchWorkspaceProps {
  activeTab: SidebarTab;
  setActiveTab: React.Dispatch<React.SetStateAction<SidebarTab>>;
  openSceneLibrary: () => void;
  aspectRatio: TimelineAspectRatio;
  setAspectRatio: (ratio: TimelineAspectRatio) => void;
  scenes: Scene[];
  activeSceneId: string;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  deleteScene: (sceneId: string) => void;
  addScene: (name: string) => void;
  setActiveScene: (sceneId: string) => void;
  updateClip: (clipId: string, updates: Partial<TimelineClip>) => void;
  handleAddClip: (type: ClipType, character?: string, file?: File, customId?: string, customDurationSeconds?: number) => string;
  isDraggingItem?: boolean;
  onDropItem?: (dragKey: string) => void;
  board: ReturnType<typeof useSceneLaunchBoard>;
  headerVariant?: 'default' | 'prompt';
}

export function SceneLaunchWorkspace({
  activeTab,
  setActiveTab,
  openSceneLibrary,
  aspectRatio,
  setAspectRatio,
  scenes,
  activeSceneId,
  updateScene,
  deleteScene,
  addScene,
  setActiveScene,
  updateClip,
  handleAddClip,
  isDraggingItem = false,
  onDropItem = () => {},
  board,
  headerVariant = 'default',
}: SceneLaunchWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();

  const activeSceneObject = scenes.find(s => s.id === activeSceneId) || scenes[0];

  const {
    sceneLaunchMediaItems,
    sceneLaunchBeats,
    sceneLaunchGridOrder,
    setSceneLaunchBeats,
    setSceneLaunchGridOrder,
    hasLoadedSceneLaunchBoard,
    sceneLaunchBeatPath,
    setSceneLaunchBeatPath,
    sceneLaunchSearch,
    setSceneLaunchSearch,
    activeBeatUploadId,
    setActiveBeatUploadId,
    sceneLaunchPreviewHover,
    setSceneLaunchPreviewHover,
    sceneLaunchManuallyPaused,
    setSceneLaunchManuallyPaused,
    sceneLaunchPreviewPausedOffset,
    setSceneLaunchPreviewPausedOffset,
    collectionScrubbingId,
    setCollectionScrubbingId,
    trimmingItemId,
    setTrimmingItemId,
    sceneLaunchContextMenu,
    setSceneLaunchContextMenu,
    addFilesToSceneLaunchMedia,
    createSceneLaunchBeat,
    openBeatUpload,
    openBeatDetail,
    addFilesToBeat,
    findSceneLaunchMediaItem,
    moveSceneLaunchMediaToCollection,
    reorderSceneLaunchMedia,
    moveSceneLaunchCollectionToCollection,
    moveSceneLaunchItemToParent,
    moveSceneLaunchItemToTargetCollection,
    moveItemToTrash,
    setSceneLaunchItemDisabled,
    restoreItemFromTrash,
    permanentlyDeleteItem,
    emptyTrash,
    updateSceneLaunchMediaDuration,
    updateSceneLaunchMediaName,
    updateSceneLaunchMediaOriginalDuration,
    updateSceneLaunchMediaTrim,
    handleItemContextMenu,
  } = board;

  const [resizingItem] = React.useState<any>(null);
  const [gridDragOverInfo, setGridDragOverInfo] = React.useState<{ targetKey: string; position: 'before' | 'after' | 'inside' } | null>(null);
  const [draggedGridItemKey, setDraggedGridItemKey] = React.useState<string | null>(null);
  const [isEditingHeaderName, setIsEditingHeaderName] = React.useState(false);
  const [editingHeaderNameValue, setEditingHeaderNameValue] = React.useState('');
  const params = useParams();
  const searchParams = useSearchParams();

  const rawPath = React.useMemo(() => {
    const p = params?.path;
    if (!p) return [];
    return typeof p === 'string' ? [p] : p;
  }, [params?.path]);

  const workbenchIndex = rawPath.indexOf('workbench');
  const sceneLaunchPlaybackMode = workbenchIndex !== -1 ? 'preview' : 'inline';
  const selectedPreviewMediaId = workbenchIndex !== -1 ? searchParams.get('mediaId') || null : null;

  const navigateToPath = React.useCallback((nextPath: string[], mediaId?: string | null) => {
    const baseSegment = pathname ? pathname.split('/')[1] : 'editor';
    const baseRoute = `/${baseSegment}`;
    const pathString = nextPath.length > 0 ? '/' + nextPath.map(encodeURIComponent).join('/') : '';
    
    const currentParams = new URLSearchParams(searchParams ? searchParams.toString() : '');
    if (mediaId === null) {
      currentParams.delete('mediaId');
    } else if (mediaId !== undefined) {
      currentParams.set('mediaId', mediaId);
    }
    
    const querySuffix = currentParams.toString() ? `?${currentParams.toString()}` : '';
    router.push(`${baseRoute}${pathString}${querySuffix}`);
  }, [router, pathname, searchParams]);



  const [isTimelinePlaying, setIsTimelinePlaying] = React.useState(false);
  const [isWheelPreviewPlaying, setIsWheelPreviewPlaying] = React.useState(false);
  const [isTimelineLooping, setIsTimelineLooping] = React.useState(true);
  const [timelineCurrentTime, setTimelineCurrentTime] = React.useState(0);
  const [isScrubbing] = React.useState(false);
  const [sceneLaunchPreviewNow, setSceneLaunchPreviewNow] = React.useState(() => Date.now());
  const [sceneComposerText, setSceneComposerText] = React.useState('');
  const [hoveredItemKey, setHoveredItemKey] = React.useState<string | null>(null);
  const [thumbnailMode, setThumbnailMode] = React.useState<'grid' | 'single'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('scene-launch-thumbnail-mode');
      if (saved === 'single') return 'single';
    }
    return 'grid';
  });

  React.useEffect(() => {
    localStorage.setItem('scene-launch-thumbnail-mode', thumbnailMode);
  }, [thumbnailMode]);
  const [previewWheelEffect, setPreviewWheelEffect] = React.useState<SceneLaunchPreviewWheelV3Effect>('gallery');
  const [previewWheelSizing, setPreviewWheelSizing] = React.useState<SceneLaunchPreviewWheelV3Sizing>('uniform');
  const [previewWheelShowUniformRuler, setPreviewWheelShowUniformRuler] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('scene-launch-preview-wheel-show-uniform-ruler');
      return saved !== 'false';
    }
    return true;
  });

  React.useEffect(() => {
    localStorage.setItem('scene-launch-preview-wheel-show-uniform-ruler', String(previewWheelShowUniformRuler));
  }, [previewWheelShowUniformRuler]);
  const [previewWheelSequence, setPreviewWheelSequence] = React.useState<PreviewWheelSequence>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('scene-launch-preview-wheel-sequence');
      if (saved === 'collections') return 'collections';
    }
    return 'media';
  });
  const [previewWheelCollectionPath, setPreviewWheelCollectionPath] = React.useState<string[]>([]);
  const [wheelDirectoryPendingKey, setWheelDirectoryPendingKey] = React.useState<string | null>(null);
  const [previewWheelDurationScale, setPreviewWheelDurationScale] = React.useState(1);
  const [previewWheelSelectDroppedItem, setPreviewWheelSelectDroppedItem] = React.useState(false);
  const [previewEditDraft, setPreviewEditDraft] = React.useState<{
    mediaId: string;
    name: string;
    durationSeconds: number;
    trimStartSeconds: number;
  } | null>(null);

  React.useEffect(() => {
    localStorage.setItem('scene-launch-preview-wheel-sequence', previewWheelSequence);
  }, [previewWheelSequence]);

  const currentTimeRef = React.useRef(0);
  React.useEffect(() => {
    currentTimeRef.current = timelineCurrentTime;
  }, [timelineCurrentTime]);



  const activeSceneLaunchBeatId = sceneLaunchBeatPath[sceneLaunchBeatPath.length - 1] || null;
  const activeSceneLaunchBeat = activeSceneLaunchBeatId
    ? sceneLaunchBeats.find(beat => beat.id === activeSceneLaunchBeatId)
    : null;

  const activeSceneLaunchGridOrder = activeSceneLaunchBeat
    ? activeSceneLaunchBeat.gridOrder
    : sceneLaunchGridOrder.filter(item => item.id !== 'trash');

  const selectedPreviewMedia = React.useMemo(() => {
    if (!selectedPreviewMediaId) return null;

    const rootItem = sceneLaunchMediaItems.find(item => item.id === selectedPreviewMediaId);
    if (rootItem) return rootItem;

    const visited = new Set<string>();
    const findInCollection = (collection: SceneLaunchBeat): SceneLaunchMediaItem | null => {
      if (visited.has(collection.id)) return null;
      visited.add(collection.id);

      const directItem = collection.items.find(item => item.id === selectedPreviewMediaId);
      if (directItem) return directItem;

      const childIds = Array.from(new Set([
        ...collection.gridOrder
          .filter((item): item is { id: string; type: 'collection' } => item.type === 'collection')
          .map(item => item.id),
        ...collection.childIds,
      ]));

      for (const childId of childIds) {
        const childBeat = sceneLaunchBeats.find(beat => beat.id === childId);
        const childItem = childBeat ? findInCollection(childBeat) : null;
        if (childItem) return childItem;
      }

      return null;
    };

    for (const beat of sceneLaunchBeats) {
      const beatItem = findInCollection(beat);
      if (beatItem) return beatItem;
    }

    return null;
  }, [sceneLaunchBeats, sceneLaunchMediaItems, selectedPreviewMediaId]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const beatFileInputRef = React.useRef<HTMLInputElement>(null);

  // Helper selectors
  const getRecursiveMediaItems = React.useCallback((
    collection: SceneLaunchBeat,
    visited = new Set<string>()
  ): SceneLaunchMediaItem[] => {
    if (visited.has(collection.id)) return [];
    visited.add(collection.id);

    const items: SceneLaunchMediaItem[] = [];

    for (const gridItem of collection.gridOrder) {
      if (gridItem.type === 'media') {
        const found = collection.items.find(x => x.id === gridItem.id);
        if (found) {
          items.push(found);
        }
      } else if (gridItem.type === 'collection') {
        const childBeat = sceneLaunchBeats.find(b => b.id === gridItem.id);
        if (childBeat) {
          items.push(...getRecursiveMediaItems(childBeat, visited));
        }
      }
    }
    return items;
  }, [sceneLaunchBeats]);

  const getSceneLaunchMediaTrimmedDuration = React.useCallback((item: SceneLaunchMediaItem) => {
    const sourceDuration = item.mediaDurationSeconds ?? item.durationSeconds ?? 3;
    const trimStart = Math.max(0, item.trimStartSeconds ?? 0);
    const fallbackDuration = Math.max(0.5, sourceDuration - trimStart);
    const requestedDuration = item.durationSeconds ?? fallbackDuration;
    return Math.max(0.5, Math.min(requestedDuration, Math.max(0.5, sourceDuration - trimStart)));
  }, []);

  const getSceneLaunchMediaSourceTime = React.useCallback((item: SceneLaunchMediaItem, elapsedSeconds: number) => {
    const trimStart = Math.max(0, item.trimStartSeconds ?? 0);
    const trimmedDuration = getSceneLaunchMediaTrimmedDuration(item);
    const clampedElapsed = Math.max(0, Math.min(trimmedDuration - 0.001, elapsedSeconds));
    return trimStart + clampedElapsed;
  }, [getSceneLaunchMediaTrimmedDuration]);

  const getRecursiveCollectionDuration = React.useCallback((
    collection: SceneLaunchBeat,
    visited = new Set<string>()
  ): number => {
    if (visited.has(collection.id)) return 0;
    visited.add(collection.id);

    return collection.gridOrder.reduce((sum, orderItem) => {
      if (orderItem.type === 'media') {
        const m = collection.items.find(x => x.id === orderItem.id);
        if (!m) return sum;
        const d = resizingItem && resizingItem.id === m.id
          ? resizingItem.currentDuration
          : getSceneLaunchMediaTrimmedDuration(m);
        return sum + d;
      } else {
        const childBeat = sceneLaunchBeats.find(b => b.id === orderItem.id);
        if (!childBeat) return sum;
        return sum + getRecursiveCollectionDuration(childBeat, visited);
      }
    }, 0);
  }, [sceneLaunchBeats, resizingItem, getSceneLaunchMediaTrimmedDuration]);

  const getCollectionTimelineSplitPercents = React.useCallback((collection: SceneLaunchBeat) => {
    const orderedMediaItems = getRecursiveMediaItems(collection);
    if (orderedMediaItems.length <= 1) return [];

    const durations = orderedMediaItems.map(item => {
      if (resizingItem && resizingItem.id === item.id) {
        return resizingItem.currentDuration;
      }
      return getSceneLaunchMediaTrimmedDuration(item);
    });
    const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
    if (totalDuration <= 0) return [];

    let accumulatedDuration = 0;
    return durations.slice(0, -1).map((duration) => {
      accumulatedDuration += duration;
      return (accumulatedDuration / totalDuration) * 100;
    });
  }, [getRecursiveMediaItems, resizingItem, getSceneLaunchMediaTrimmedDuration]);

  const getSceneLaunchMediaPreviewDuration = React.useCallback((item: SceneLaunchMediaItem) => (
    getSceneLaunchMediaTrimmedDuration(item)
  ), [getSceneLaunchMediaTrimmedDuration]);

  const getSceneLaunchMediaTimelineDuration = React.useCallback((item: SceneLaunchMediaItem) => {
    if (resizingItem && resizingItem.id === item.id) {
      return resizingItem.currentDuration;
    }
    return getSceneLaunchMediaTrimmedDuration(item);
  }, [resizingItem, getSceneLaunchMediaTrimmedDuration]);

  // Construct Timeline items
  const timelineItems = React.useMemo(() => {
    return activeSceneLaunchGridOrder
      .map(orderItem => {
        if (orderItem.type === 'media') {
          const item = activeSceneLaunchBeat
            ? activeSceneLaunchBeat.items.find(mediaItem => mediaItem.id === orderItem.id)
            : sceneLaunchMediaItems.find(mediaItem => mediaItem.id === orderItem.id);
          if (!item) return null;
          return { ...orderItem, item };
        }

        const collection = sceneLaunchBeats.find(beat => beat.id === orderItem.id);
        if (!collection) return null;
        return { ...orderItem, collection };
      })
      .filter((item): item is (
        | { id: string; type: 'media'; item: SceneLaunchMediaItem }
        | { id: string; type: 'collection'; collection: SceneLaunchBeat }
      ) => !!item);
  }, [activeSceneLaunchGridOrder, activeSceneLaunchBeat, sceneLaunchMediaItems, sceneLaunchBeats]);

  const timelineTotalDuration = React.useMemo(() => {
    return timelineItems.reduce((sum, item) => {
      if (item.type === 'media') {
        return sum + getSceneLaunchMediaTimelineDuration(item.item);
      } else {
        return sum + (getRecursiveCollectionDuration(item.collection) || 3);
      }
    }, 0);
  }, [timelineItems, getSceneLaunchMediaTimelineDuration, getRecursiveCollectionDuration]);

  const getGridItemTimelineState = React.useCallback((
    itemId: string,
    itemType: 'media' | 'collection'
  ): { status: 'past' | 'active' | 'future' | 'idle'; elapsed: number; duration: number } => {
    if (!isTimelinePlaying && !isScrubbing) {
      return { status: 'idle', elapsed: 0, duration: 3 };
    }

    let accumulatedTime = 0;
    for (const item of timelineItems) {
      let duration = 3;
      if (item.type === 'media') {
        duration = getSceneLaunchMediaTimelineDuration(item.item);
      } else {
        duration = getRecursiveCollectionDuration(item.collection) || 3;
      }

      const isMatch = (item.type === itemType && item.id === itemId);

      let containsTarget = false;
      let relStart = 0;
      let relDuration = 0;

      if (!isMatch && item.type === 'collection') {
        const containsCollection = (parent: SceneLaunchBeat, targetId: string, visited = new Set<string>()): boolean => {
          if (visited.has(parent.id)) return false;
          visited.add(parent.id);
          for (const g of parent.gridOrder) {
            if (g.type === 'collection') {
              if (g.id === targetId) return true;
              const child = sceneLaunchBeats.find(b => b.id === g.id);
              if (child && containsCollection(child, targetId, visited)) return true;
            }
          }
          return false;
        };

        const containsMedia = (parent: SceneLaunchBeat, targetId: string, visited = new Set<string>()): boolean => {
          if (visited.has(parent.id)) return false;
          visited.add(parent.id);
          for (const g of parent.gridOrder) {
            if (g.type === 'media') {
              if (g.id === targetId) return true;
            } else {
              const child = sceneLaunchBeats.find(b => b.id === g.id);
              if (child && containsMedia(child, targetId, visited)) return true;
            }
          }
          return false;
        };

        const checkInside = itemType === 'collection'
          ? containsCollection(item.collection, itemId)
          : containsMedia(item.collection, itemId);

        if (checkInside) {
          containsTarget = true;
          const getRelativeStartAndDuration = (
            parent: SceneLaunchBeat,
            targetId: string,
            targetType: 'media' | 'collection',
            visited = new Set<string>()
          ): { start: number; duration: number } | null => {
            if (visited.has(parent.id)) return null;
            visited.add(parent.id);

            let relTime = 0;
            for (const g of parent.gridOrder) {
              if (g.type === 'media') {
                const m = parent.items.find(x => x.id === g.id);
                const d = m ? getSceneLaunchMediaTimelineDuration(m) : 3;
                if (targetType === 'media' && g.id === targetId) {
                  return { start: relTime, duration: d };
                }
                relTime += d;
              } else {
                const child = sceneLaunchBeats.find(b => b.id === g.id);
                if (!child) continue;
                if (targetType === 'collection' && g.id === targetId) {
                  return { start: relTime, duration: getRecursiveCollectionDuration(child) };
                }
                const res = getRelativeStartAndDuration(child, targetId, targetType, visited);
                if (res) {
                  return { start: relTime + res.start, duration: res.duration };
                }
                relTime += getRecursiveCollectionDuration(child);
              }
            }
            return null;
          };

          const rel = getRelativeStartAndDuration(item.collection, itemId, itemType);
          if (rel) {
            relStart = rel.start;
            relDuration = rel.duration;
          }
        }
      }

      if (isMatch) {
        if (timelineCurrentTime < accumulatedTime) {
          return { status: 'future', elapsed: 0, duration };
        } else if (timelineCurrentTime >= accumulatedTime + duration) {
          return { status: 'past', elapsed: duration, duration };
        } else {
          return { status: 'active', elapsed: timelineCurrentTime - accumulatedTime, duration };
        }
      } else if (containsTarget) {
        const absStart = accumulatedTime + relStart;
        const absEnd = absStart + relDuration;
        if (timelineCurrentTime < absStart) {
          return { status: 'future', elapsed: 0, duration: relDuration };
        } else if (timelineCurrentTime >= absEnd) {
          return { status: 'past', elapsed: relDuration, duration: relDuration };
        } else {
          return { status: 'active', elapsed: timelineCurrentTime - absStart, duration: relDuration };
        }
      }

      accumulatedTime += duration;
    }

    return { status: 'idle', elapsed: 0, duration: 3 };
  }, [timelineItems, isTimelinePlaying, isScrubbing, timelineCurrentTime, getSceneLaunchMediaTimelineDuration, getRecursiveCollectionDuration, sceneLaunchBeats]);

  const getSceneLaunchCollectionPreview = React.useCallback((collection: SceneLaunchBeat) => {
    const orderedMediaItems = getRecursiveMediaItems(collection);

    if (orderedMediaItems.length === 0) return null;

    const firstItem = orderedMediaItems[0];
    const isHoverActive = sceneLaunchPreviewHover?.collectionId === collection.id && sceneLaunchManuallyPaused !== collection.id;
    const timelineState = getGridItemTimelineState(collection.id, 'collection');
    const isPlaying = isHoverActive || timelineState.status !== 'idle';

    const totalDuration = orderedMediaItems.reduce((total, item) => (
      total + getSceneLaunchMediaPreviewDuration(item)
    ), 0);

    let elapsed = 0;
    if (isHoverActive) {
      const currentNow = Math.max(Date.now(), sceneLaunchPreviewHover.startedAt);
      elapsed = ((currentNow - sceneLaunchPreviewHover.startedAt) / 1000) % totalDuration;
    } else if (sceneLaunchManuallyPaused === collection.id) {
      elapsed = sceneLaunchPreviewPausedOffset % totalDuration;
    } else {
      if (timelineState.status === 'past') {
        elapsed = totalDuration - 0.001;
      } else if (timelineState.status === 'active') {
        elapsed = timelineState.elapsed % totalDuration;
      } else {
        elapsed = 0;
      }
    }

    const totalElapsed = elapsed;

    let accum = 0;
    for (const item of orderedMediaItems) {
      const durationSeconds = getSceneLaunchMediaPreviewDuration(item);
      if (elapsed >= accum - 0.001 && elapsed < accum + durationSeconds - 0.001) {
        return {
          item,
          elapsedSeconds: Math.max(0, elapsed - accum),
          durationSeconds,
          isPlaying,
          totalElapsedSeconds: totalElapsed,
          totalDurationSeconds: totalDuration,
          itemStartOffset: accum,
        };
      }
      accum += durationSeconds;
    }

    const lastItem = orderedMediaItems[orderedMediaItems.length - 1];
    return {
      item: lastItem,
      elapsedSeconds: getSceneLaunchMediaPreviewDuration(lastItem) - 0.001,
      durationSeconds: getSceneLaunchMediaPreviewDuration(lastItem),
      isPlaying,
      totalElapsedSeconds: totalElapsed,
      totalDurationSeconds: totalDuration,
      itemStartOffset: totalDuration - getSceneLaunchMediaPreviewDuration(lastItem),
    };
  }, [getRecursiveMediaItems, getGridItemTimelineState, sceneLaunchPreviewHover, sceneLaunchManuallyPaused, sceneLaunchPreviewPausedOffset]);

  const syncTimelinePlayheadToCollectionPreview = React.useCallback((beatId: string, elapsedSeconds: number) => {
    const getNestedCollectionOffset = (
      parent: SceneLaunchBeat,
      targetId: string,
      visited = new Set<string>()
    ): number | null => {
      if (visited.has(parent.id)) return null;
      visited.add(parent.id);

      let relTime = 0;
      for (const g of parent.gridOrder) {
        if (g.type === 'media') {
          const m = parent.items.find(x => x.id === g.id);
          const d = m ? getSceneLaunchMediaTimelineDuration(m) : 3;
          relTime += d;
        } else {
          if (g.id === targetId) {
            return relTime;
          }
          const child = sceneLaunchBeats.find(b => b.id === g.id);
          if (child) {
            const res = getNestedCollectionOffset(child, targetId, visited);
            if (res !== null) {
              return relTime + res;
            }
            relTime += getRecursiveCollectionDuration(child);
          }
        }
      }
      return null;
    };

    let startTime = 0;
    let found = false;
    let offsetInParent = 0;

    for (const item of timelineItems) {
      if (item.type === 'collection') {
        if (item.collection.id === beatId) {
          found = true;
          offsetInParent = 0;
          break;
        }
        const relOffset = getNestedCollectionOffset(item.collection, beatId);
        if (relOffset !== null) {
          found = true;
          offsetInParent = relOffset;
          break;
        }
      }

      if (item.type === 'media') {
        startTime += getSceneLaunchMediaTimelineDuration(item.item);
      } else {
        startTime += getRecursiveCollectionDuration(item.collection) || 3;
      }
    }

    if (found) {
      const nextTime = startTime + offsetInParent + elapsedSeconds;
      setTimelineCurrentTime(nextTime);
      currentTimeRef.current = nextTime;
    }
  }, [timelineItems, sceneLaunchBeats, getSceneLaunchMediaTimelineDuration, getRecursiveCollectionDuration]);

  const changeCollectionPreviewItem = (beat: SceneLaunchBeat, direction: 'next' | 'prev') => {
    const orderedMediaItems = getRecursiveMediaItems(beat);
    if (orderedMediaItems.length === 0) return;

    const preview = getSceneLaunchCollectionPreview(beat);
    const currentIndex = preview ? orderedMediaItems.findIndex(x => x.id === preview.item.id) : 0;
    const activeIndex = currentIndex !== -1 ? currentIndex : 0;

    let newIndex = 0;
    if (direction === 'next') {
      newIndex = (activeIndex + 1) % orderedMediaItems.length;
    } else {
      newIndex = (activeIndex - 1 + orderedMediaItems.length) % orderedMediaItems.length;
    }

    let targetStartOffset = 0;
    for (let j = 0; j < newIndex; j++) {
      targetStartOffset += getSceneLaunchMediaPreviewDuration(orderedMediaItems[j]);
    }

    setSceneLaunchManuallyPaused(beat.id);
    setSceneLaunchPreviewPausedOffset(targetStartOffset);
    syncTimelinePlayheadToCollectionPreview(beat.id, targetStartOffset);
  };

  const getSceneLaunchMediaTileStyle = React.useCallback((item: SceneLaunchMediaItem): React.CSSProperties => {
    return {
      width: '100%',
      maxWidth: '100%',
    };
  }, []);

  const getSceneLaunchCollectionTileStyle = React.useCallback((): React.CSSProperties => {
    return {
      width: '100%',
      maxWidth: '100%',
    };
  }, []);

  const getSceneLaunchMediaPreviewStyle = (): React.CSSProperties => {
    return {
      width: '100%',
    };
  };

  const getActiveTimelineItemInfo = React.useCallback((currentTime: number) => {
    let accumulatedTime = 0;
    for (const item of timelineItems) {
      let duration = 3;
      if (item.type === 'media') {
        duration = getSceneLaunchMediaTimelineDuration(item.item);
      } else {
        duration = getRecursiveCollectionDuration(item.collection) || 3;
      }
      if (currentTime >= accumulatedTime && currentTime < accumulatedTime + duration) {
        return { id: item.id, type: item.type };
      }
      accumulatedTime += duration;
    }
    if (timelineItems.length > 0 && currentTime >= accumulatedTime) {
      const last = timelineItems[timelineItems.length - 1];
      return { id: last.id, type: last.type };
    }
    return null;
  }, [timelineItems, getSceneLaunchMediaTimelineDuration, getRecursiveCollectionDuration]);

  const getCollectionPreviewSnapshotAtElapsed = React.useCallback((
    collection: SceneLaunchBeat,
    elapsedSeconds: number
  ): SceneLaunchCanvasPreviewSnapshot => {
    const orderedMediaItems = getRecursiveMediaItems(collection);
    const totalDuration = orderedMediaItems.reduce((total, item) => (
      total + getSceneLaunchMediaPreviewDuration(item)
    ), 0);

    if (orderedMediaItems.length === 0 || totalDuration <= 0) {
      return { media: null, previewTimeSeconds: 0 };
    }

    const normalizedElapsed = ((elapsedSeconds % totalDuration) + totalDuration) % totalDuration;
    let accumulatedTime = 0;

    for (const item of orderedMediaItems) {
      const duration = getSceneLaunchMediaPreviewDuration(item);
      const itemEnd = accumulatedTime + duration;

      if (normalizedElapsed < itemEnd) {
        return {
          media: item,
          previewTimeSeconds: getSceneLaunchMediaSourceTime(item, normalizedElapsed - accumulatedTime),
        };
      }

      accumulatedTime = itemEnd;
    }

    const lastItem = orderedMediaItems[orderedMediaItems.length - 1];
    return {
      media: lastItem,
      previewTimeSeconds: getSceneLaunchMediaSourceTime(lastItem, getSceneLaunchMediaPreviewDuration(lastItem) - 0.001),
    };
  }, [getRecursiveMediaItems, getSceneLaunchMediaPreviewDuration, getSceneLaunchMediaSourceTime]);

  const getPreviewSnapshotAtTime = React.useCallback((currentTime: number): SceneLaunchCanvasPreviewSnapshot => {
    let accumulatedTime = 0;

    for (const item of timelineItems) {
      const duration = item.type === 'media'
        ? getSceneLaunchMediaTimelineDuration(item.item)
        : getRecursiveCollectionDuration(item.collection) || 3;
      const itemEnd = accumulatedTime + duration;

      if (currentTime < itemEnd) {
        const elapsedSeconds = Math.max(0, currentTime - accumulatedTime);

        if (item.type === 'media') {
          return {
            media: item.item,
            previewTimeSeconds: getSceneLaunchMediaSourceTime(item.item, elapsedSeconds),
          };
        }

        return getCollectionPreviewSnapshotAtElapsed(item.collection, elapsedSeconds);
      }

      accumulatedTime = itemEnd;
    }

    if (timelineItems.length === 0) {
      return { media: null, previewTimeSeconds: 0 };
    }

    const lastItem = timelineItems[timelineItems.length - 1];
    if (lastItem.type === 'media') {
      return {
        media: lastItem.item,
        previewTimeSeconds: getSceneLaunchMediaSourceTime(
          lastItem.item,
          getSceneLaunchMediaTimelineDuration(lastItem.item) - 0.001
        ),
      };
    }

    return getCollectionPreviewSnapshotAtElapsed(
      lastItem.collection,
      Math.max(0, (getRecursiveCollectionDuration(lastItem.collection) || 3) - 0.001)
    );
  }, [
    timelineItems,
    getSceneLaunchMediaTimelineDuration,
    getRecursiveCollectionDuration,
    getSceneLaunchMediaSourceTime,
    getCollectionPreviewSnapshotAtElapsed,
  ]);

  const getLivePreviewSnapshot = React.useCallback(() => (
    getPreviewSnapshotAtTime(currentTimeRef.current)
  ), [getPreviewSnapshotAtTime]);

  const getSelectedMediaPreviewSnapshot = React.useCallback((): SceneLaunchCanvasPreviewSnapshot | null => {
    if (!selectedPreviewMedia) return null;

    return {
      media: selectedPreviewMedia,
      previewTimeSeconds: getSceneLaunchMediaSourceTime(selectedPreviewMedia, 0),
    };
  }, [getSceneLaunchMediaSourceTime, selectedPreviewMedia]);

  const getDisplayedPreviewSnapshot = React.useCallback(() => (
    getSelectedMediaPreviewSnapshot() ?? getLivePreviewSnapshot()
  ), [getLivePreviewSnapshot, getSelectedMediaPreviewSnapshot]);

  const activeItemInfo = getActiveTimelineItemInfo(timelineCurrentTime);
  const activeItemKey = activeItemInfo ? `${activeItemInfo.type}:${activeItemInfo.id}` : null;
  const isWheelSequencePreview =
    sceneLaunchPlaybackMode === 'preview' &&
    previewWheelEffect === 'gallery' &&
    Boolean(selectedPreviewMediaId);
  const setSceneLaunchTimelineTime = React.useCallback((time: number) => {
    setTimelineCurrentTime(time);
    currentTimeRef.current = time;
    setSceneLaunchPreviewHover(null);
    navigateToPath(board.sceneLaunchBeatPath, null);
  }, [setSceneLaunchPreviewHover, board.sceneLaunchBeatPath, navigateToPath]);

  const toggleSceneLaunchTimelinePlayback = React.useCallback(() => {
    if (isWheelSequencePreview) {
      setIsTimelinePlaying(false);
      setIsWheelPreviewPlaying(current => !current);
      return;
    }

    const nextPlaying = !isTimelinePlaying;
    setIsWheelPreviewPlaying(false);
    setIsTimelinePlaying(nextPlaying);
    if (nextPlaying) {
      setSceneLaunchTimelineTime(0);
      setSceneLaunchPreviewPausedOffset(0);
      setSceneLaunchManuallyPaused(null);
    }
  }, [isTimelinePlaying, isWheelSequencePreview, setSceneLaunchTimelineTime]);



  const handleBoardContextMenu = React.useCallback((event: React.MouseEvent<HTMLElement>, insertionIndex: number) => {
    event.preventDefault();
    setSceneLaunchContextMenu({
      type: 'board',
      x: event.clientX,
      y: event.clientY,
      insertionIndex,
    });
  }, [setSceneLaunchContextMenu]);

  // Preview animation tick effect
  React.useEffect(() => {
    if (!sceneLaunchPreviewHover) {
      return;
    }

    let frameId: number;
    const tick = () => {
      const now = Date.now();
      const hoveredId = sceneLaunchPreviewHover.collectionId;
      const isPaused = sceneLaunchManuallyPaused === hoveredId;

      if (!isPaused) {
        setSceneLaunchPreviewNow(now);
      }

      const hoveredBeat = sceneLaunchBeats.find(b => b.id === hoveredId);
      if (hoveredBeat && !isTimelinePlaying && !isScrubbing) {
        const mediaItems = getRecursiveMediaItems(hoveredBeat);
        const totalDuration = mediaItems.reduce((sum, item) => sum + getSceneLaunchMediaPreviewDuration(item), 0);
        if (totalDuration > 0) {
          const elapsed = isPaused
            ? sceneLaunchPreviewPausedOffset % totalDuration
            : ((now - sceneLaunchPreviewHover.startedAt) / 1000) % totalDuration;

          syncTimelinePlayheadToCollectionPreview(hoveredId, elapsed);
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [sceneLaunchPreviewHover, isTimelinePlaying, isScrubbing, timelineItems, sceneLaunchBeats, sceneLaunchManuallyPaused, sceneLaunchPreviewPausedOffset, getRecursiveMediaItems, syncTimelinePlayheadToCollectionPreview, getSceneLaunchMediaPreviewDuration]);

  // Timeline playback tick effect
  React.useEffect(() => {
    if (!isTimelinePlaying) return;

    let lastTime = performance.now();
    let lastPublishedTime = currentTimeRef.current;
    let frameId: number;

    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      const current = currentTimeRef.current;
      const next = current + delta;
      const isPreviewPlayback = sceneLaunchPlaybackMode === 'preview';
      const publishIntervalSeconds = isPreviewPlayback ? 1 / 8 : 0;

      if (next >= timelineTotalDuration) {
        setTimelineCurrentTime(0);
        currentTimeRef.current = 0;
        lastPublishedTime = 0;
        if (!isTimelineLooping) {
          setIsTimelinePlaying(false);
          return;
        }
      } else {
        currentTimeRef.current = next;
        if (!isPreviewPlayback || next - lastPublishedTime >= publishIntervalSeconds) {
          setTimelineCurrentTime(next);
          lastPublishedTime = next;
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isTimelinePlaying, timelineTotalDuration, isTimelineLooping, sceneLaunchPlaybackMode]);

  // Auto scroll timeline item into view
  React.useEffect(() => {
    if (!activeItemKey) return;
    const element = document.getElementById(`grid-item-${activeItemKey}`);
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [activeItemKey]);

  const closeSceneLaunchView = () => {
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.delete('new');
    const nextQuery = currentParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  };

  const handleAddClipClick = (type: ClipType) => {
    if (type === 'dialog') {
      handleAddClip('dialog', 'Narrator');
    } else if (type === 'note') {
      handleAddClip('note');
    } else {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      addFilesToSceneLaunchMedia(files);
    }
    e.target.value = '';
  };

  const handleBeatFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (activeBeatUploadId) {
      addFilesToBeat(activeBeatUploadId, files);
    }
    e.target.value = '';
    setActiveBeatUploadId(null);
  };

  const handleSceneLaunchDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.getData('text/plain')) return;
    addFilesToSceneLaunchMedia(Array.from(event.dataTransfer.files || []));
  };

  const openProjectScene = (sceneId: string) => {
    setActiveScene(sceneId);
    closeSceneLaunchView();
  };

  const getHeaderName = () => {
    if (activeSceneLaunchBeatId) {
      if (activeSceneLaunchBeatId === 'trash') return 'Trash';
      return activeSceneLaunchBeat?.name || 'Collection';
    }
    return activeSceneObject ? activeSceneObject.name : 'New scene project';
  };

  const saveHeaderName = () => {
    const trimmed = editingHeaderNameValue.trim();
    if (!trimmed) {
      setIsEditingHeaderName(false);
      return;
    }

    if (activeSceneLaunchBeatId && activeSceneLaunchBeatId !== 'trash') {
      setSceneLaunchBeats(prev => prev.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? { ...beat, name: trimmed }
          : beat
      )));
      toast.success(`Renamed collection to "${trimmed}"`);
    } else if (!activeSceneLaunchBeatId && activeSceneObject) {
      updateScene(activeSceneObject.id, { name: trimmed });
      toast.success(`Renamed project to "${trimmed}"`);
    }
    setIsEditingHeaderName(false);
  };

  const createSceneFromComposer = () => {
    const nextName = sceneComposerText.trim() || `Scene ${scenes.length + 1}`;
    const reusableBlankScene = activeSceneObject && scenes.length === 1 && activeSceneObject.clips.length === 0 && !activeSceneObject.description?.trim();

    if (reusableBlankScene) {
      updateScene(activeSceneObject.id, { name: nextName });
      setActiveScene(activeSceneObject.id);
    } else {
      addScene(nextName);
    }

    setSceneComposerText('');
    setActiveTab('scenes');
  };

  const handleGridDragOver = (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => {
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;

    let position: 'before' | 'after' | 'inside' = 'inside';
    if (isCollection) {
      if (ratio < 0.25) position = 'before';
      else if (ratio > 0.75) position = 'after';
    } else {
      position = ratio < 0.5 ? 'before' : 'after';
    }

    let finalTargetKey = targetKey;
    let finalPosition = position;
    let isNoOp = false;

    if (draggedGridItemKey) {
      if (draggedGridItemKey === targetKey) {
        isNoOp = true;
      } else {
        const draggedIndex = activeSceneLaunchGridOrder.findIndex(
          item => `${item.type}:${item.id}` === draggedGridItemKey
        );
        const targetIndex = activeSceneLaunchGridOrder.findIndex(
          item => `${item.type}:${item.id}` === targetKey
        );

        if (draggedIndex >= 0 && targetIndex >= 0) {
          if (position === 'inside') {
            const draggedCollectionId = draggedGridItemKey.startsWith('collection:')
              ? draggedGridItemKey.slice('collection:'.length)
              : null;
            if (draggedCollectionId && targetKey.slice('collection:'.length) === draggedCollectionId) {
              isNoOp = true;
            }
          } else {
            const gapIndex = position === 'before' ? targetIndex : targetIndex + 1;
            if (gapIndex === draggedIndex || gapIndex === draggedIndex + 1) {
              isNoOp = true;
            } else {
              // Normalize the visual indicator to the left edge of the next item
              // or the right edge of the last item if at the end of the grid.
              if (gapIndex < activeSceneLaunchGridOrder.length) {
                const normItem = activeSceneLaunchGridOrder[gapIndex];
                finalTargetKey = `${normItem.type}:${normItem.id}`;
                finalPosition = 'before';
              } else {
                const normItem = activeSceneLaunchGridOrder[gapIndex - 1];
                finalTargetKey = `${normItem.type}:${normItem.id}`;
                finalPosition = 'after';
              }
            }
          }
        }
      }
    }

    if (isNoOp) {
      e.dataTransfer.dropEffect = 'none';
      if (gridDragOverInfo !== null) {
        setGridDragOverInfo(null);
      }
    } else {
      e.dataTransfer.dropEffect = 'move';
      if (
        !gridDragOverInfo ||
        gridDragOverInfo.targetKey !== finalTargetKey ||
        gridDragOverInfo.position !== finalPosition
      ) {
        setGridDragOverInfo({ targetKey: finalTargetKey, position: finalPosition });
      }
    }
  };

  const handleGridDragLeave = () => {
    setGridDragOverInfo(null);
  };

  const handleGridDrop = (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setGridDragOverInfo(null);

    const draggedKey = e.dataTransfer.getData('text/plain');
    const isInternalDrag = draggedKey && (draggedKey.startsWith('media:') || draggedKey.startsWith('collection:'));

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;

    let position: 'before' | 'after' | 'inside' = 'inside';
    if (isCollection) {
      if (ratio < 0.25) position = 'before';
      else if (ratio > 0.75) position = 'after';
    } else {
      position = ratio < 0.5 ? 'before' : 'after';
    }

    if (!isInternalDrag && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (isCollection && position === 'inside') {
        const collectionId = targetKey.slice('collection:'.length);
        addFilesToBeat(collectionId, Array.from(e.dataTransfer.files));
      } else {
        if (activeSceneLaunchBeatId) {
          addFilesToBeat(activeSceneLaunchBeatId, Array.from(e.dataTransfer.files));
        } else {
          addFilesToSceneLaunchMedia(Array.from(e.dataTransfer.files));
        }
      }
      return;
    }

    if (!draggedKey || draggedKey === targetKey) return;

    if (isCollection && position === 'inside') {
      const collectionId = targetKey.slice('collection:'.length);
      const draggedCollectionId = draggedKey.startsWith('collection:')
        ? draggedKey.slice('collection:'.length)
        : null;
      if (draggedCollectionId && collectionId === draggedCollectionId) return;

      if (draggedKey.startsWith('media:')) {
        moveSceneLaunchMediaToCollection(draggedKey.slice('media:'.length), collectionId);
      } else if (draggedKey.startsWith('collection:')) {
        moveSceneLaunchCollectionToCollection(draggedKey.slice('collection:'.length), collectionId);
      }
      return;
    }

    const draggedIndex = activeSceneLaunchGridOrder.findIndex(
      item => `${item.type}:${item.id}` === draggedKey
    );
    const targetIndex = activeSceneLaunchGridOrder.findIndex(
      item => `${item.type}:${item.id}` === targetKey
    );

    if (draggedIndex >= 0 && targetIndex >= 0) {
      const gapIndex = position === 'before' ? targetIndex : targetIndex + 1;
      if (gapIndex === draggedIndex || gapIndex === draggedIndex + 1) {
        // No-move drop, ignore
        return;
      }
    }

    reorderSceneLaunchGridItemAtPosition(draggedKey, targetKey, position as 'before' | 'after');
  };

  const reorderSceneLaunchGridItemAtPosition = (draggedKey: string, targetKey: string, position: 'before' | 'after') => {
    if (!draggedKey || draggedKey === targetKey) return;

    const reorderItems = (previous: Array<{ id: string; type: 'media' | 'collection' }>) => {
      const draggedIndex = previous.findIndex(item => `${item.type}:${item.id}` === draggedKey);
      const targetIndex = previous.findIndex(item => `${item.type}:${item.id}` === targetKey);
      if (draggedIndex < 0 || targetIndex < 0) return previous;

      const next = [...previous];
      const [draggedItem] = next.splice(draggedIndex, 1);

      const newTargetIndex = next.findIndex(item => `${item.type}:${item.id}` === targetKey);
      const insertIndex = position === 'before' ? newTargetIndex : newTargetIndex + 1;

      next.splice(insertIndex, 0, draggedItem);
      return next;
    };

    if (activeSceneLaunchBeatId) {
      setSceneLaunchBeats(previous => previous.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? { ...beat, gridOrder: reorderItems(beat.gridOrder) }
          : beat
      )));
      return;
    }

    setSceneLaunchGridOrder(reorderItems);
  };

  const reorderSceneLaunchGridItem = (draggedKey: string, targetKey: string) => {
    reorderSceneLaunchGridItemAtPosition(draggedKey, targetKey, 'before');
  };

  const projectHasSceneContent = scenes.some(scene => (
    scene.clips.length > 0 ||
    !!scene.thumbnailUrl ||
    !!scene.description?.trim() ||
    (scenes.length > 1 && scene.name !== 'Untitled Scene')
  ));

  const sceneLaunchQuery = sceneLaunchSearch.trim().toLowerCase();
  const visibleProjectScenes = scenes.filter(scene => {
    if (!sceneLaunchQuery) return true;
    return `${scene.name} ${scene.description || ''}`.toLowerCase().includes(sceneLaunchQuery);
  });

  const rootSceneLaunchGridItemsCount = sceneLaunchGridOrder.length;

  const sceneLaunchGridItems = activeSceneLaunchGridOrder
    .map(orderItem => {
      if (orderItem.type === 'media') {
        const item = activeSceneLaunchBeat
          ? activeSceneLaunchBeat.items.find(mediaItem => mediaItem.id === orderItem.id)
          : sceneLaunchMediaItems.find(mediaItem => mediaItem.id === orderItem.id);
        if (!item) return null;
        return { ...orderItem, item };
      }

      const collection = sceneLaunchBeats.find(beat => beat.id === orderItem.id);
      if (!collection) return null;
      return { ...orderItem, collection };
    })
    .filter((item): item is (
      | { id: string; type: 'media'; item: SceneLaunchMediaItem }
      | { id: string; type: 'collection'; collection: SceneLaunchBeat }
    ) => !!item)
    .filter(item => {
      if (!sceneLaunchQuery) return true;
      if (item.type === 'media') return item.item.name.toLowerCase().includes(sceneLaunchQuery);
      return `${item.collection.name} ${item.collection.items.map(collectionItem => collectionItem.name).join(' ')}`.toLowerCase().includes(sceneLaunchQuery);
    });

  const activePreviewItem = (() => {
    if (selectedPreviewMedia) {
      return {
        title: selectedPreviewMedia.name,
        label: selectedPreviewMedia.type === 'video' ? 'Video' : 'Image',
        media: selectedPreviewMedia,
        previewTimeSeconds: getSceneLaunchMediaSourceTime(selectedPreviewMedia, 0),
      };
    }

    const activeTimelineItem = activeItemInfo
      ? timelineItems.find(item => item.type === activeItemInfo.type && item.id === activeItemInfo.id)
      : timelineItems[0];

    if (!activeTimelineItem) return null;

    if (activeTimelineItem.type === 'media') {
      const timelineState = getGridItemTimelineState(activeTimelineItem.id, 'media');
      const elapsedSeconds = timelineState.status === 'past'
        ? timelineState.duration
        : timelineState.status === 'active'
          ? timelineState.elapsed
          : 0;

      return {
        title: activeTimelineItem.item.name,
        label: 'Media',
        media: activeTimelineItem.item,
        previewTimeSeconds: getSceneLaunchMediaSourceTime(activeTimelineItem.item, elapsedSeconds),
      };
    }

    const collectionPreview = getSceneLaunchCollectionPreview(activeTimelineItem.collection);
    return {
      title: activeTimelineItem.collection.name,
      label: 'Collection',
      media: collectionPreview?.item ?? null,
      previewTimeSeconds: collectionPreview
        ? getSceneLaunchMediaSourceTime(collectionPreview.item, collectionPreview.elapsedSeconds)
      : 0,
    };
  })();
  const activePreviewMedia = activePreviewItem?.media ?? null;

  // Flattened list of all media items in timeline order for preview navigation.
  const flattenedTimelineMediaItems = React.useMemo(() => {
    const items: SceneLaunchMediaItem[] = [];
    const flattenItem = (gridItem: typeof timelineItems[number]) => {
      if (gridItem.type === 'media') {
        items.push(gridItem.item);
      } else {
        const collectionMedia = getRecursiveMediaItems(gridItem.collection);
        items.push(...collectionMedia);
      }
    };
    timelineItems.forEach(flattenItem);
    return items;
  }, [timelineItems, getRecursiveMediaItems]);

  const previewWheelSourceItems = React.useMemo(() => {
    const collectionId = previewWheelCollectionPath[previewWheelCollectionPath.length - 1];
    const collection = collectionId
      ? sceneLaunchBeats.find(beat => beat.id === collectionId)
      : null;
    if (!collection) return timelineItems;

    return collection.gridOrder.map(orderItem => {
      if (orderItem.type === 'media') {
        const item = collection.items.find(media => media.id === orderItem.id);
        return item ? { ...orderItem, item } : null;
      }
      const childCollection = sceneLaunchBeats.find(beat => beat.id === orderItem.id);
      return childCollection ? { ...orderItem, collection: childCollection } : null;
    }).filter((item): item is typeof timelineItems[number] => item !== null);
  }, [previewWheelCollectionPath, sceneLaunchBeats, timelineItems]);

  const getCollectionWheelRepresentative = React.useCallback((collection: SceneLaunchBeat): SceneLaunchMediaItem => (
    getRecursiveMediaItems(collection)[0] ?? {
      id: `collection-placeholder:${collection.id}`,
      clipId: '',
      name: collection.name,
      type: 'image',
      previewUrl: COLLECTION_WHEEL_PLACEHOLDER,
      durationSeconds: 3,
    }
  ), [getRecursiveMediaItems]);

  const collectionAwareWheelItems = React.useMemo(() => previewWheelSourceItems.flatMap(item => {
    if (item.type === 'media') return [item.item];

    const collectionMedia = getRecursiveMediaItems(item.collection);
    const representative = getCollectionWheelRepresentative(item.collection);

    return [{
      ...representative,
      name: item.collection.name,
      disabled: item.collection.disabled,
      durationSeconds: collectionMedia.reduce((total, media) => (
        total + getSceneLaunchMediaPreviewDuration(media)
      ), 0),
    }];
  }), [previewWheelSourceItems, getCollectionWheelRepresentative, getRecursiveMediaItems, getSceneLaunchMediaPreviewDuration]);

  const collectionAwareWheelSequences = React.useMemo(() => {
    const sequences: Record<string, SceneLaunchMediaItem[]> = {};
    previewWheelSourceItems.forEach(item => {
      if (item.type !== 'collection') return;
      const collectionMedia = getRecursiveMediaItems(item.collection);
      const representative = getCollectionWheelRepresentative(item.collection);
      sequences[representative.id] = collectionMedia;
    });
    return sequences;
  }, [previewWheelSourceItems, getCollectionWheelRepresentative, getRecursiveMediaItems]);

  const collectionAwareWheelThumbnails = React.useMemo(() => {
    const thumbnails: Record<string, Record<string, SceneLaunchMediaItem>> = {};

    previewWheelSourceItems.forEach(item => {
      if (item.type !== 'collection') return;
      const representative = getCollectionWheelRepresentative(item.collection);

      const childThumbnails: Record<string, SceneLaunchMediaItem> = {};
      item.collection.gridOrder.forEach(orderItem => {
        if (orderItem.type === 'media') {
          const media = item.collection.items.find(candidate => candidate.id === orderItem.id);
          if (media) childThumbnails[media.id] = media;
          return;
        }

        const childCollection = sceneLaunchBeats.find(beat => beat.id === orderItem.id);
        if (!childCollection) return;
        const childRepresentative = getRecursiveMediaItems(childCollection)[0];
        if (!childRepresentative) return;
        getRecursiveMediaItems(childCollection).forEach(media => {
          childThumbnails[media.id] = childRepresentative;
        });
      });
      thumbnails[representative.id] = childThumbnails;
    });

    return thumbnails;
  }, [getCollectionWheelRepresentative, getRecursiveMediaItems, previewWheelSourceItems, sceneLaunchBeats]);

  const wheelCollectionIds = React.useMemo(() => {
    const ids: Record<string, string> = {};
    previewWheelSourceItems.forEach(item => {
      if (item.type !== 'collection') return;
      const representative = getCollectionWheelRepresentative(item.collection);
      ids[representative.id] = item.collection.id;
    });
    return ids;
  }, [getCollectionWheelRepresentative, previewWheelSourceItems]);

  const reorderCollectionAwareWheelItem = React.useCallback((
    draggedWheelId: string,
    targetWheelId: string,
    position: 'before' | 'after',
  ) => {
    const getGridKey = (wheelId: string) => {
      const sourceItem = previewWheelSourceItems.find(item => (
        item.type === 'media'
          ? item.item.id === wheelId
          : getCollectionWheelRepresentative(item.collection).id === wheelId
      ));
      return sourceItem ? `${sourceItem.type}:${sourceItem.id}` : null;
    };

    const draggedKey = getGridKey(draggedWheelId);
    const targetKey = getGridKey(targetWheelId);
    if (!draggedKey || !targetKey) return;

    const drilledCollectionId = previewWheelCollectionPath[previewWheelCollectionPath.length - 1];
    if (!drilledCollectionId) {
      reorderSceneLaunchGridItemAtPosition(draggedKey, targetKey, position);
      return;
    }

    setSceneLaunchBeats(previous => previous.map(collection => {
      if (collection.id !== drilledCollectionId) return collection;
      const nextOrder = [...collection.gridOrder];
      const draggedIndex = nextOrder.findIndex(item => `${item.type}:${item.id}` === draggedKey);
      const targetIndex = nextOrder.findIndex(item => `${item.type}:${item.id}` === targetKey);
      if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return collection;

      const [draggedItem] = nextOrder.splice(draggedIndex, 1);
      const adjustedTargetIndex = nextOrder.findIndex(item => `${item.type}:${item.id}` === targetKey);
      nextOrder.splice(position === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1, 0, draggedItem);
      return { ...collection, gridOrder: nextOrder };
    }));
  }, [getCollectionWheelRepresentative, previewWheelCollectionPath, previewWheelSourceItems, setSceneLaunchBeats]);

  const moveWheelItemIntoCollection = React.useCallback((
    draggedWheelId: string,
    targetCollectionWheelId: string,
  ) => {
    const draggedItem = previewWheelSourceItems.find(item => (
      item.type === 'media'
        ? item.item.id === draggedWheelId
        : getCollectionWheelRepresentative(item.collection).id === draggedWheelId
    ));
    const targetCollectionId = wheelCollectionIds[targetCollectionWheelId];
    if (!draggedItem || !targetCollectionId || draggedItem.id === targetCollectionId) return;

    moveSceneLaunchItemToTargetCollection(
      `${draggedItem.type}:${draggedItem.id}`,
      targetCollectionId,
    );
  }, [getCollectionWheelRepresentative, moveSceneLaunchItemToTargetCollection, previewWheelSourceItems, wheelCollectionIds]);

  const disabledWheelItemIds = React.useMemo(() => {
    const ids = new Set<string>();
    sceneLaunchMediaItems.forEach(item => item.disabled && ids.add(item.id));
    sceneLaunchBeats.forEach(beat => {
      beat.items.forEach(item => item.disabled && ids.add(item.id));
      if (beat.disabled) ids.add(getCollectionWheelRepresentative(beat).id);
    });
    return Array.from(ids);
  }, [getCollectionWheelRepresentative, sceneLaunchBeats, sceneLaunchMediaItems]);

  const handleWheelUtilityDrop = React.useCallback((action: 'parent' | 'directory' | 'trash' | 'disable', draggedWheelId: string) => {
    const draggedItem = previewWheelSourceItems.find(item => (
      item.type === 'media'
        ? item.item.id === draggedWheelId
        : getCollectionWheelRepresentative(item.collection).id === draggedWheelId
    ));
    if (!draggedItem) return;
    const dragKey = `${draggedItem.type}:${draggedItem.id}`;

    if (action === 'directory') {
      setWheelDirectoryPendingKey(dragKey);
    } else if (action === 'trash') {
      moveItemToTrash(dragKey);
    } else if (action === 'disable') {
      const isDisabled = draggedItem.type === 'media'
        ? Boolean(draggedItem.item.disabled)
        : Boolean(draggedItem.collection.disabled);
      setSceneLaunchItemDisabled(dragKey, !isDisabled);
    } else {
      moveSceneLaunchItemToParent(dragKey);
    }
  }, [getCollectionWheelRepresentative, moveItemToTrash, moveSceneLaunchItemToParent, previewWheelSourceItems, setSceneLaunchItemDisabled]);

  const wheelReflectsCollections = previewWheelSizing === 'uniform' && previewWheelSequence === 'collections';
  const previewWheelItems = React.useMemo(() => {
    const sourceItems = wheelReflectsCollections
      ? collectionAwareWheelItems
      : flattenedTimelineMediaItems;
    const seenIds = new Set<string>();
    return sourceItems.filter(item => {
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    });
  }, [collectionAwareWheelItems, flattenedTimelineMediaItems, wheelReflectsCollections]);

  const previewWheelSelectedMediaId = React.useMemo(() => {
    if (!wheelReflectsCollections || !selectedPreviewMediaId) return selectedPreviewMediaId || '';

    const containingItem = previewWheelSourceItems.find(item => (
      item.type === 'media'
        ? item.id === selectedPreviewMediaId
        : getRecursiveMediaItems(item.collection).some(media => media.id === selectedPreviewMediaId)
    ));

    if (!containingItem) return selectedPreviewMediaId;
    if (containingItem.type === 'media') return containingItem.item.id;
    return getCollectionWheelRepresentative(containingItem.collection).id;
  }, [getCollectionWheelRepresentative, getRecursiveMediaItems, previewWheelSourceItems, selectedPreviewMediaId, wheelReflectsCollections]);


  const previewSceneLaunchMediaId = React.useCallback((mediaId: string) => {
    setIsTimelinePlaying(false);
    setIsWheelPreviewPlaying(false);
    setSceneLaunchPreviewHover(null);
    setSceneLaunchManuallyPaused(null);
    setSceneLaunchPreviewPausedOffset(0);
    setPreviewEditDraft(null);
    navigateToPath([...board.sceneLaunchBeatPath, 'workbench'], mediaId);
  }, [setSceneLaunchPreviewHover, board.sceneLaunchBeatPath, navigateToPath]);

  const previewSceneLaunchMedia = React.useCallback((item: SceneLaunchMediaItem) => {
    previewSceneLaunchMediaId(item.id);
  }, [previewSceneLaunchMediaId]);

  const openPreviewWheelCollection = React.useCallback((representativeMediaId: string) => {
    const collectionId = wheelCollectionIds[representativeMediaId];
    const collection = collectionId
      ? sceneLaunchBeats.find(beat => beat.id === collectionId)
      : null;
    if (!collection) return;

    const firstMedia = getRecursiveMediaItems(collection)[0];
    if (!firstMedia) return;
    setPreviewWheelCollectionPath(current => [...current, collection.id]);
    previewSceneLaunchMediaId(firstMedia.id);
  }, [getRecursiveMediaItems, previewSceneLaunchMediaId, sceneLaunchBeats, wheelCollectionIds]);

  const closePreviewWheelCollection = React.useCallback(() => {
    if (previewWheelCollectionPath.length === 0) {
      const parentPath = board.sceneLaunchBeatPath.slice(0, -1);
      const parentId = parentPath[parentPath.length - 1];
      const parent = parentId ? sceneLaunchBeats.find(beat => beat.id === parentId) : null;
      let firstMedia = parent ? getRecursiveMediaItems(parent)[0] : undefined;

      if (!parent) {
        for (const orderItem of sceneLaunchGridOrder) {
          if (orderItem.type === 'media') {
            firstMedia = sceneLaunchMediaItems.find(media => media.id === orderItem.id);
          } else {
            const collection = sceneLaunchBeats.find(beat => beat.id === orderItem.id);
            firstMedia = collection ? getRecursiveMediaItems(collection)[0] : undefined;
          }
          if (firstMedia) break;
        }
      }

      if (firstMedia) navigateToPath([...parentPath, 'workbench'], firstMedia.id);
      return;
    }

    const next = previewWheelCollectionPath.slice(0, -1);
    const parentId = next[next.length - 1];
    const parent = parentId ? sceneLaunchBeats.find(beat => beat.id === parentId) : null;
    const firstMedia = parent
      ? getRecursiveMediaItems(parent)[0]
      : flattenedTimelineMediaItems[0];
    setPreviewWheelCollectionPath(next);
    if (firstMedia) previewSceneLaunchMediaId(firstMedia.id);
  }, [board.sceneLaunchBeatPath, flattenedTimelineMediaItems, getRecursiveMediaItems, navigateToPath, previewSceneLaunchMediaId, previewWheelCollectionPath, sceneLaunchBeats, sceneLaunchGridOrder, sceneLaunchMediaItems]);

  const createPreviewWheelCollection = React.useCallback(() => {
    const drilledCollectionId = previewWheelCollectionPath[previewWheelCollectionPath.length - 1];
    createSceneLaunchBeat(undefined, drilledCollectionId ?? activeSceneLaunchBeatId);
    setPreviewWheelSequence('collections');
    setPreviewWheelSizing('uniform');
    toast.success('Collection added to the wheel');
  }, [activeSceneLaunchBeatId, createSceneLaunchBeat, previewWheelCollectionPath]);

  const selectPreviewMediaDuringPlayback = React.useCallback((mediaId: string) => {
    setPreviewEditDraft(null);
    navigateToPath([...board.sceneLaunchBeatPath, 'workbench'], mediaId);
  }, [board.sceneLaunchBeatPath, navigateToPath]);

  const setViewMode = React.useCallback((mode: 'storyboard' | 'workbench') => {
    if (mode === 'storyboard') {
      navigateToPath(board.sceneLaunchBeatPath, null);
    } else {
      const firstMediaId = flattenedTimelineMediaItems[0]?.id || '';
      navigateToPath([...board.sceneLaunchBeatPath, 'workbench'], firstMediaId);
    }
  }, [navigateToPath, board.sceneLaunchBeatPath, flattenedTimelineMediaItems]);

  const viewMode = sceneLaunchPlaybackMode === 'preview' ? 'workbench' : 'storyboard';



  const previewCanvasKey = activePreviewMedia
    ? [
        activePreviewMedia.id,
        activePreviewMedia.previewUrl,
        activePreviewMedia.trimStartSeconds ?? 0,
        activePreviewMedia.durationSeconds ?? 0,
        activePreviewMedia.mediaDurationSeconds ?? 0,
      ].join(':')
    : 'empty';
  const getPreviewEditDefaults = React.useCallback((media: SceneLaunchMediaItem) => {
    const trimStartSeconds = Math.max(0, media.trimStartSeconds ?? 0);
    const sourceDuration = media.type === 'image'
      ? MAX_IMAGE_DURATION_SECONDS
      : Math.max(0.5, media.mediaDurationSeconds ?? media.durationSeconds ?? 3);
    const fallbackDuration = Math.max(0.5, sourceDuration - trimStartSeconds);
    const durationSeconds = Math.max(
      0.5,
      Math.min(media.durationSeconds ?? fallbackDuration, fallbackDuration)
    );

    return {
      mediaId: media.id,
      name: media.name,
      durationSeconds,
      trimStartSeconds,
    };
  }, []);
  const activePreviewDraft = activePreviewMedia
    ? previewEditDraft?.mediaId === activePreviewMedia.id
      ? previewEditDraft
      : getPreviewEditDefaults(activePreviewMedia)
    : null;
  const updateActivePreviewDraft = React.useCallback((
    updater: (draft: { mediaId: string; name: string; durationSeconds: number; trimStartSeconds: number }) => {
      mediaId: string;
      name: string;
      durationSeconds: number;
      trimStartSeconds: number;
    }
  ) => {
    if (!activePreviewMedia) return;
    setPreviewEditDraft(previous => updater(
      previous?.mediaId === activePreviewMedia.id
        ? previous
        : getPreviewEditDefaults(activePreviewMedia)
    ));
  }, [activePreviewMedia, getPreviewEditDefaults]);
  const beginPreviewTrimDrag = React.useCallback((
    event: React.PointerEvent<HTMLElement>,
    mode: 'start' | 'end' | 'move'
  ) => {
    if (!activePreviewMedia || activePreviewMedia.type !== 'video' || !activePreviewDraft) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerTarget = event.currentTarget;
    const pointerId = event.pointerId;

    const track = event.currentTarget.closest('[data-preview-trim-track="true"]') as HTMLElement | null;
    const trackWidth = Math.max(1, track?.getBoundingClientRect().width ?? 1);
    const sourceDuration = Math.max(0.5, activePreviewMedia.mediaDurationSeconds ?? activePreviewMedia.durationSeconds ?? 3);
    const initialStart = activePreviewDraft.trimStartSeconds;
    const initialDuration = activePreviewDraft.durationSeconds;
    const startX = event.clientX;
    let latestTrimStart = initialStart;
    let latestDuration = initialDuration;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaSeconds = ((moveEvent.clientX - startX) / trackWidth) * sourceDuration;

      updateActivePreviewDraft((draft) => {
        if (mode === 'start') {
          const nextStart = Math.max(
            0,
            Math.min(
              initialStart + initialDuration - 0.5,
              initialStart + deltaSeconds,
              sourceDuration - 0.5
            )
          );
          latestTrimStart = Number(nextStart.toFixed(2));
          latestDuration = Number(Math.max(0.5, initialDuration - (nextStart - initialStart)).toFixed(2));
          return {
            ...draft,
            trimStartSeconds: latestTrimStart,
            durationSeconds: latestDuration,
          };
        }

        if (mode === 'move') {
          const nextStart = Math.max(
            0,
            Math.min(sourceDuration - initialDuration, initialStart + deltaSeconds)
          );
          latestTrimStart = Number(nextStart.toFixed(2));
          return {
            ...draft,
            trimStartSeconds: latestTrimStart,
          };
        }

        const nextDuration = Math.max(
          0.5,
          Math.min(sourceDuration - initialStart, initialDuration + deltaSeconds)
        );
        latestDuration = Number(nextDuration.toFixed(2));
        return {
          ...draft,
          durationSeconds: latestDuration,
        };
      });
    };

    const onPointerUp = () => {
      updateSceneLaunchMediaTrim(activePreviewMedia.id, latestTrimStart, latestDuration);
      if (pointerTarget.hasPointerCapture(pointerId)) {
        pointerTarget.releasePointerCapture(pointerId);
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, [activePreviewDraft, activePreviewMedia, updateActivePreviewDraft, updateSceneLaunchMediaTrim]);
  const activePreviewSourceDuration = activePreviewMedia
    ? activePreviewMedia.type === 'image'
      ? MAX_IMAGE_DURATION_SECONDS
      : Math.max(0.5, activePreviewMedia.mediaDurationSeconds ?? activePreviewMedia.durationSeconds ?? 3)
    : 0;
  const activePreviewTrimStartPercent = activePreviewDraft && activePreviewSourceDuration > 0
    ? (activePreviewDraft.trimStartSeconds / activePreviewSourceDuration) * 100
    : 0;
  const activePreviewTrimWidthPercent = activePreviewDraft && activePreviewSourceDuration > 0
    ? (activePreviewDraft.durationSeconds / activePreviewSourceDuration) * 100
    : 0;

  const isPlaybackActive = isWheelSequencePreview ? isWheelPreviewPlaying : isTimelinePlaying;
  const headerPlaybackControls = (
    <div className="flex h-11 items-center justify-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/85 px-3 text-zinc-300 shadow-[0_12px_36px_rgba(0,0,0,0.32)] ring-1 ring-black/30 backdrop-blur-xl">
      <div className="flex h-8 items-center rounded-full border border-zinc-800 bg-zinc-900 p-0.5 shrink-0 select-none">
        <button
          type="button"
          onClick={() => setViewMode('storyboard')}
          className={cn(
            'flex h-7 items-center rounded-full px-3 text-[9px] font-black uppercase tracking-widest outline-none transition-colors cursor-pointer',
            viewMode === 'storyboard'
              ? 'bg-indigo-500/20 text-indigo-100 font-extrabold'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Grid2X2 className="mr-1.5 h-3.5 w-3.5" />
          Storyboard
        </button>

        <button
          type="button"
          onClick={() => setViewMode('workbench')}
          className={cn(
            'flex h-7 items-center rounded-full px-3 text-[9px] font-black uppercase tracking-widest outline-none transition-colors cursor-pointer',
            viewMode === 'workbench'
              ? 'bg-indigo-500/20 text-indigo-100 font-extrabold'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
          Workbench
        </button>
      </div>
    </div>
  );

  const timelineSearch = headerVariant === 'prompt' ? (
    <form
      className="flex h-10 w-[min(42rem,48vw)] min-w-0 items-center gap-2 rounded-full border border-white/10 bg-[#171717]/95 px-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.28)] ring-1 ring-black/30"
      onSubmit={(event) => {
        event.preventDefault();
        setSceneLaunchSearch(sceneLaunchSearch.trim());
      }}
    >
      <label htmlFor="scene-launch-floating-prompt-search" className="sr-only">Search scenes</label>
      <button
        type="button"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
        onClick={() => handleAddClipClick('video')}
        title="Add video scene media"
        aria-label="Add video scene media"
      >
        <Plus className="h-4 w-4 stroke-[1.8]" />
      </button>

      <input
        id="scene-launch-floating-prompt-search"
        name="sceneLaunchSearch"
        value={sceneLaunchSearch}
        onChange={(event) => setSceneLaunchSearch(event.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-xs font-semibold text-zinc-200 outline-none placeholder:text-zinc-500/90"
        placeholder="What do you want to create?"
        enterKeyHint="search"
      />

      <button
        type="button"
        className="hidden h-7 shrink-0 items-center rounded-full bg-zinc-800/80 px-3 text-[10px] font-bold text-zinc-300 transition-colors hover:bg-zinc-700/70 hover:text-white sm:flex"
        onClick={() => setActiveTab('analyze')}
      >
        Agent
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="hidden h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-zinc-800/80 px-2.5 text-[10px] font-bold text-zinc-300 outline-none transition-colors hover:bg-zinc-700/70 hover:text-white focus-visible:ring-2 focus-visible:ring-zinc-500 md:flex"
          title={`Change aspect ratio (currently ${aspectRatio})`}
          aria-label="Change aspect ratio"
        >
          <span className="max-w-24 truncate">Banana 2</span>
          <Ratio className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <span className="shrink-0 text-zinc-400">x4</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-50 w-36 border-zinc-800 bg-[#111114] text-zinc-300">
          <div className="select-none px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">Aspect Ratio</div>
          {(['16:9', '21:9', '1:1', '9:16'] as const).map((ratio) => (
            <DropdownMenuItem
              key={ratio}
              onClick={() => setAspectRatio(ratio)}
              className="cursor-pointer justify-between font-mono text-xs focus:bg-zinc-800 focus:text-white"
            >
              {ratio}
              {aspectRatio === ratio && <span className="text-indigo-300">•</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="submit"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-500 transition-colors hover:bg-zinc-700/70 hover:text-zinc-200"
        aria-label="Submit search"
      >
        <ArrowRight className="h-4 w-4 stroke-[1.8]" />
      </button>
    </form>
  ) : (
    <div className="flex h-9 w-[min(34rem,42vw)] min-w-0 items-center gap-2.5 rounded-full bg-zinc-900/95 px-4 text-zinc-500 ring-1 ring-white/10">
      <Search className="h-4.5 w-4.5 shrink-0" />
      <label htmlFor="scene-launch-floating-search" className="sr-only">Search scenes</label>
      <input
        id="scene-launch-floating-search"
        value={sceneLaunchSearch}
        onChange={(event) => setSceneLaunchSearch(event.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
        placeholder="Search scenes"
      />
    </div>
  );

  return (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden bg-black text-zinc-100 animate-fade-in"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleSceneLaunchDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*,video/*"
        onChange={handleFileChange}
      />
      <input
        type="file"
        ref={beatFileInputRef}
        className="hidden"
        accept="image/*,video/*"
        multiple
        onChange={handleBeatFileChange}
      />

      <SceneLaunchSidebar
        activeTab={activeTab}
        activeSceneLaunchBeatId={activeSceneLaunchBeatId}
        setActiveTab={setActiveTab}
        setSceneLaunchBeatPath={setSceneLaunchBeatPath}
        openSceneLibrary={openSceneLibrary}
        moveItemToTrash={moveItemToTrash}
        isDraggingItem={isDraggingItem}
        onDropItem={onDropItem}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <SceneLaunchHeader
          activeSceneLaunchBeatId={activeSceneLaunchBeatId}
          setSceneLaunchBeatPath={setSceneLaunchBeatPath}
          onNavigateHome={() => router.push('/')}
          moveSceneLaunchItemToParent={moveSceneLaunchItemToParent}
          headerName={getHeaderName()}
          isEditingHeaderName={isEditingHeaderName}
          setIsEditingHeaderName={setIsEditingHeaderName}
          editingHeaderNameValue={editingHeaderNameValue}
          setEditingHeaderNameValue={setEditingHeaderNameValue}
          saveHeaderName={saveHeaderName}
          sceneLaunchSearch={sceneLaunchSearch}
          setSceneLaunchSearch={setSceneLaunchSearch}
          handleAddClipClick={handleAddClipClick}
          aspectRatio={aspectRatio}
          setAspectRatio={setAspectRatio}
          setActiveTab={setActiveTab}
          openSceneLibrary={openSceneLibrary}
          searchVariant={headerVariant === 'prompt' ? 'prompt' : 'default'}
          hideSearch
          centerSlot={headerPlaybackControls}
          thumbnailMode={thumbnailMode}
          setThumbnailMode={setThumbnailMode}
        />

        <main className="relative min-h-0 flex-1 overflow-hidden">
          <motion.div
            className="absolute inset-0 overflow-y-auto px-6 pb-6"
            animate={{
              x: '0%',
              opacity: sceneLaunchPlaybackMode === 'preview' ? 0.18 : 1,
            }}
            transition={{
              x: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
              opacity: sceneLaunchPlaybackMode === 'preview'
                ? { duration: 0.22, ease: 'easeOut' }
                : { duration: 0.48, delay: 0.12, ease: 'easeOut' },
            }}
          >
          {!activeSceneLaunchBeat && rootSceneLaunchGridItemsCount === 0 && (projectHasSceneContent || visibleProjectScenes.length > 1) ? (
            <div className="mt-8 w-full">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">Project scenes</h2>
                  <p className="mt-1 text-xs text-zinc-600">Open an existing scene or add a new scene to this project.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
                  onClick={createSceneFromComposer}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Scene
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleProjectScenes.map((scene, index) => (
                  <article
                    key={scene.id}
                    className="group overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950/70 transition-colors hover:border-zinc-700"
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => openProjectScene(scene.id)}
                    >
                      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-zinc-950">
                        {scene.thumbnailUrl ? (
                          <img src={scene.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Clapperboard className="h-8 w-8 text-zinc-700" />
                        )}
                        <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-zinc-400">
                          Scene {index + 1}
                        </span>
                      </div>
                      <div className="p-3">
                        <h3 className="truncate text-sm font-semibold text-zinc-100">{scene.name}</h3>
                        <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                          {scene.clips.length} {scene.clips.length === 1 ? 'clip' : 'clips'}
                        </p>
                      </div>
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <SceneLaunchGrid
              aspectRatio={aspectRatio}
              activeSceneLaunchBeatId={activeSceneLaunchBeatId}
              activeSceneLaunchBeat={activeSceneLaunchBeat || null}
              sceneLaunchGridItems={sceneLaunchGridItems}
              thumbnailMode={thumbnailMode}
              isTimelinePlaying={sceneLaunchPlaybackMode !== 'preview' && isTimelinePlaying}
              activeItemKey={activeItemKey}
              hoveredItemKey={hoveredItemKey}
              setHoveredItemKey={setHoveredItemKey}
              trimmingItemId={trimmingItemId}
              setTrimmingItemId={setTrimmingItemId}
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
              getSceneLaunchMediaTileStyle={getSceneLaunchMediaTileStyle}
              gridDragOverInfo={gridDragOverInfo}
              handleGridDragOver={handleGridDragOver}
              handleGridDragLeave={handleGridDragLeave}
              handleGridDrop={handleGridDrop}
              syncTimelinePlayheadToCollectionPreview={syncTimelinePlayheadToCollectionPreview}
              updateSceneLaunchMediaOriginalDuration={updateSceneLaunchMediaOriginalDuration}
              updateSceneLaunchMediaDuration={updateSceneLaunchMediaDuration}
              updateSceneLaunchMediaTrim={updateSceneLaunchMediaTrim}
              handleItemContextMenu={handleItemContextMenu}
              handleBoardContextMenu={handleBoardContextMenu}
              onPreviewMedia={previewSceneLaunchMedia}
              emptyTrash={emptyTrash}
              createSceneLaunchBeat={createSceneLaunchBeat}
              handleBeatDrop={(event, beatId) => {
                event.preventDefault();
                event.stopPropagation();
                const draggedKey = event.dataTransfer.getData('text/plain');
                const isInternalDrag = draggedKey && (draggedKey.startsWith('media:') || draggedKey.startsWith('collection:'));
                if (isInternalDrag) return;
                addFilesToBeat(beatId, Array.from(event.dataTransfer.files || []));
              }}
              allCollections={sceneLaunchBeats}
              draggedGridItemKey={draggedGridItemKey}
              setDraggedGridItemKey={setDraggedGridItemKey}
              moveSceneLaunchItemToParent={moveSceneLaunchItemToParent}
              moveSceneLaunchItemToTargetCollection={moveSceneLaunchItemToTargetCollection}
              moveItemToTrash={moveItemToTrash}
            />
          )}
          </motion.div>

          <motion.div
            className="absolute inset-0 z-10 flex items-center justify-center p-6"
            initial={false}
            animate={{
              y: sceneLaunchPlaybackMode === 'preview' ? '0%' : '100%',
              boxShadow: sceneLaunchPlaybackMode === 'preview'
                ? '0 -32px 80px rgba(0,0,0,0.5)'
                : '0 -32px 80px rgba(0,0,0,0)',
            }}
            transition={{ type: 'spring', stiffness: 145, damping: 18, mass: 1.15 }}
            aria-hidden={sceneLaunchPlaybackMode !== 'preview'}
          >
            <section className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black/50">

              <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center bg-black">
                {selectedPreviewMediaId ? (
                  <>
                    <div className="min-h-0 w-full flex-1">
                      <SceneLaunchPreviewWheelV3
                      items={previewWheelItems}
                      itemSequences={wheelReflectsCollections ? collectionAwareWheelSequences : undefined}
                      itemSequenceThumbnails={wheelReflectsCollections ? collectionAwareWheelThumbnails : undefined}
                      onCollectionOpen={wheelReflectsCollections ? openPreviewWheelCollection : undefined}
                      collectionItemIds={wheelReflectsCollections ? Object.keys(wheelCollectionIds) : undefined}
                      onItemMoveIntoCollection={wheelReflectsCollections ? moveWheelItemIntoCollection : undefined}
                      disabledItemIds={disabledWheelItemIds}
                      onUtilityDrop={handleWheelUtilityDrop}
                      canNavigateBack={previewWheelCollectionPath.length > 0 || board.sceneLaunchBeatPath.length > 0}
                      onNavigateBack={closePreviewWheelCollection}
                      selectedMediaId={previewWheelSelectedMediaId}
                      effect={previewWheelEffect}
                      sizing={previewWheelSizing}
                      showUniformRuler={previewWheelShowUniformRuler}
                      durationScale={previewWheelDurationScale}
                      selectedItemDurationSeconds={activePreviewDraft?.durationSeconds}
                      selectedItemTrimStartSeconds={activePreviewDraft?.trimStartSeconds}
                      onSelectedItemDurationChange={(durationSeconds, trimStartSeconds) => {
                        updateActivePreviewDraft(draft => ({
                          ...draft,
                          durationSeconds,
                          trimStartSeconds,
                        }));
                      }}
                      onSelectedItemDurationChangeEnd={(durationSeconds, trimStartSeconds) => {
                        if (!activePreviewMedia) return;
                        if (activePreviewMedia.type === 'video') {
                          updateSceneLaunchMediaTrim(activePreviewMedia.id, trimStartSeconds, durationSeconds);
                        } else {
                          updateSceneLaunchMediaDuration(activePreviewMedia.id, durationSeconds);
                        }
                      }}
                      onCenteredMediaChange={previewSceneLaunchMediaId}
                      onItemsReorder={wheelReflectsCollections ? reorderCollectionAwareWheelItem : reorderSceneLaunchMedia}
                      selectReorderedItem={previewWheelSelectDroppedItem}
                      renderGalleryTrimOverlay={(item) => {
                        if (wheelReflectsCollections || !activePreviewDraft || activePreviewMedia?.id !== item.id || item.type !== 'video') return null;

                        return (
                          <div>
                            <div className="mb-1.5 flex items-center justify-between gap-3 text-[9px] font-black uppercase tracking-widest text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                              <span>Trim</span>
                              <span className="font-mono normal-case tracking-normal text-zinc-200">
                                {activePreviewDraft.trimStartSeconds.toFixed(1)}s - {(activePreviewDraft.trimStartSeconds + activePreviewDraft.durationSeconds).toFixed(1)}s
                              </span>
                            </div>
                            <div
                              data-preview-trim-track="true"
                              className="relative h-16 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900"
                            >
                              <VideoFrameFilmstrip
                                key={activePreviewMedia.id}
                                src={activePreviewMedia.previewUrl}
                                durationSeconds={activePreviewSourceDuration}
                                frameCount={6}
                              />
                              <div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: `${activePreviewTrimStartPercent}%` }} />
                              <div
                                className="absolute inset-y-0 right-0 bg-black/65"
                                style={{ width: `${Math.max(0, 100 - activePreviewTrimStartPercent - activePreviewTrimWidthPercent)}%` }}
                              />
                              <div
                                onPointerDown={(event) => beginPreviewTrimDrag(event, 'move')}
                                className="absolute inset-y-0 cursor-grab rounded-md border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_0_14px_rgba(255,255,255,0.2)] active:cursor-grabbing"
                                style={{
                                  left: `${activePreviewTrimStartPercent}%`,
                                  width: `${Math.min(Math.max(4, activePreviewTrimWidthPercent), 100 - activePreviewTrimStartPercent)}%`,
                                }}
                              >
                                <div
                                  onPointerDown={(event) => beginPreviewTrimDrag(event, 'start')}
                                  className="absolute inset-y-0 left-0 flex w-5 cursor-ew-resize items-center justify-center rounded-l bg-white"
                                >
                                  <div className="h-8 w-[1.5px] rounded-full bg-zinc-400" />
                                </div>
                                <div
                                  onPointerDown={(event) => beginPreviewTrimDrag(event, 'end')}
                                  className="absolute inset-y-0 right-0 flex w-5 cursor-ew-resize items-center justify-center rounded-r bg-white"
                                >
                                  <div className="h-8 w-[1.5px] rounded-full bg-zinc-400" />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }}
                      renderSelectedItemOverlay={(item) => {
                        if (wheelReflectsCollections || !activePreviewDraft || activePreviewMedia?.id !== item.id) return null;

                        return (
                          <>
                            <label className="pointer-events-auto absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-md border border-white/15 bg-black/72 px-2.5 py-2 shadow-xl backdrop-blur-md">
                              <span className="sr-only">Item name</span>
                              <input
                                type="text"
                                value={activePreviewDraft.name}
                                onChange={(event) => updateActivePreviewDraft(draft => ({
                                  ...draft,
                                  name: event.target.value,
                                }))}
                                onBlur={(event) => updateSceneLaunchMediaName(item.id, event.target.value)}
                                className="w-full min-w-40 bg-transparent text-xs font-black uppercase text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                              />
                            </label>

                          </>
                        );
                      }}
                      isPreviewPlaying={isWheelPreviewPlaying}
                      loopPreviewPlayback={isTimelineLooping}
                      onPreviewPlaybackComplete={() => setIsWheelPreviewPlaying(false)}
                      onPlaybackMediaChange={selectPreviewMediaDuringPlayback}
                      onTogglePlayback={toggleSceneLaunchTimelinePlayback}
                      timelineCurrentTime={timelineCurrentTime}
                      onToggleLoop={() => setIsTimelineLooping(current => !current)}
                      />
                    </div>
                    {previewWheelEffect === 'gallery' && activePreviewMedia && activePreviewDraft && (
                      <div className="grid h-24 w-full shrink-0 grid-cols-[minmax(12rem,32rem)_1fr] items-center gap-5 border-t border-zinc-800 bg-zinc-950/95 px-5 pr-80">
                        <label className="min-w-0 rounded-md border border-zinc-700 bg-black/55 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                          <span className="mb-1 block">Name</span>
                          <input
                            type="text"
                            value={activePreviewDraft.name}
                            onChange={(event) => updateActivePreviewDraft(draft => ({
                              ...draft,
                              name: event.target.value,
                            }))}
                            onBlur={(event) => updateSceneLaunchMediaName(activePreviewMedia.id, event.target.value)}
                            className="h-8 w-full min-w-0 bg-transparent text-sm font-bold normal-case tracking-normal text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                          />
                        </label>
                        {activePreviewMedia.type === 'image' && (
                          <label className="justify-self-end rounded-md border border-zinc-700 bg-black/55 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                            <span className="mb-1 block">Duration</span>
                            <span className="flex h-8 items-center rounded-md border border-zinc-700 bg-black/70 px-2">
                              <input
                                type="number"
                                min={0.5}
                                max={MAX_IMAGE_DURATION_SECONDS}
                                step={0.5}
                                value={Number(activePreviewDraft.durationSeconds.toFixed(1))}
                                onChange={(event) => {
                                  const nextDuration = Number(Math.max(0.5, Math.min(MAX_IMAGE_DURATION_SECONDS, Number(event.target.value) || 0.5)).toFixed(2));
                                  updateActivePreviewDraft(draft => ({
                                    ...draft,
                                    durationSeconds: nextDuration,
                                  }));
                                  updateSceneLaunchMediaDuration(activePreviewMedia.id, nextDuration);
                                }}
                                className="w-16 bg-transparent text-right font-mono text-sm font-bold normal-case tracking-normal text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              />
                              <span className="ml-1.5 font-mono text-xs normal-case tracking-normal text-zinc-400">s</span>
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                    <div className="absolute left-4 top-4 z-40 rounded-lg border border-zinc-700/80 bg-zinc-950/92 p-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-400 shadow-2xl shadow-black/50 backdrop-blur-xl">
                      <div className="mb-1 px-1.5 text-[9px] text-zinc-500">Wheel items</div>
                      <div className="flex rounded-md bg-black/70 p-0.5" role="group" aria-label="Wheel items">
                        {([
                          ['media', 'All media'],
                          ['collections', 'Collections'],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={previewWheelSequence === value}
                            onClick={() => {
                              setPreviewWheelSequence(value);
                              setPreviewWheelSizing('uniform');
                              if (value === 'media') setPreviewWheelCollectionPath([]);
                            }}
                            className={cn(
                              'h-7 rounded px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
                              previewWheelSequence === value
                                ? 'bg-indigo-500 text-white shadow-sm'
                                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {previewWheelSizing === 'uniform' && (
                        <button
                          type="button"
                          onClick={createPreviewWheelCollection}
                          className="mt-1.5 flex h-7 w-full items-center justify-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[9px] text-zinc-200 transition-colors hover:border-indigo-400 hover:bg-indigo-500/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        >
                          <Plus className="h-3 w-3" />
                          Collection
                        </button>
                      )}
                    </div>
                    <div className="absolute right-4 top-4 z-40 flex items-center gap-3 rounded-md border border-zinc-700/80 bg-zinc-950/88 px-2.5 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 shadow-2xl shadow-black/50 backdrop-blur-xl">
                      <label className="flex items-center gap-2">
                        <span>Effect</span>
                        <select
                          value={previewWheelEffect}
                          onChange={(event) => setPreviewWheelEffect(event.target.value as SceneLaunchPreviewWheelV3Effect)}
                          className="h-7 rounded-md border border-zinc-700 bg-black/70 px-2 text-[10px] font-black uppercase tracking-widest text-zinc-100 outline-none focus:border-indigo-400"
                        >
                          <option value="cylinder">Cylinder</option>
                          <option value="cylinder2">Cylinder 2</option>
                          <option value="coverflow">Coverflow</option>
                          <option value="gallery">Gallery</option>
                          <option value="stack">Stack</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2">
                        <span>Width</span>
                        <select
                          value={previewWheelSizing}
                          onChange={(event) => setPreviewWheelSizing(event.target.value as SceneLaunchPreviewWheelV3Sizing)}
                          className="h-7 rounded-md border border-zinc-700 bg-black/70 px-2 text-[10px] font-black uppercase tracking-widest text-zinc-100 outline-none focus:border-indigo-400"
                        >
                          <option value="uniform">Uniform</option>
                          <option value="duration">Duration</option>
                        </select>
                      </label>
                      {previewWheelSizing === 'uniform' && (
                        <label className="flex items-center gap-2">
                          <span>Ruler</span>
                          <Switch
                            size="sm"
                            checked={previewWheelShowUniformRuler}
                            onCheckedChange={setPreviewWheelShowUniformRuler}
                            aria-label="Show or hide interactive ruler in uniform mode"
                          />
                        </label>
                      )}
                      {!wheelReflectsCollections && (
                        <label className="flex items-center gap-2">
                          <span>Center drop</span>
                          <Switch
                            size="sm"
                            checked={previewWheelSelectDroppedItem}
                            onCheckedChange={setPreviewWheelSelectDroppedItem}
                            aria-label="Center and select dropped timeline item"
                          />
                        </label>
                      )}
                      {previewWheelSizing === 'duration' && (
                        <label className="flex items-center gap-2">
                          <span>Scale</span>
                          <input
                            type="range"
                            min={0.5}
                            max={4}
                            step={0.25}
                            value={previewWheelDurationScale}
                            onChange={(event) => setPreviewWheelDurationScale(Number(event.target.value))}
                            className="h-5 w-24 cursor-ew-resize accent-indigo-500"
                          />
                          <output className="w-9 text-right font-mono text-zinc-200">
                            {previewWheelDurationScale.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x
                          </output>
                        </label>
                      )}
                    </div>
                  </>
                ) : (
                  <SceneLaunchCanvasPreview
                    key={previewCanvasKey}
                    media={activePreviewItem?.media ?? null}
                    previewTimeSeconds={activePreviewItem?.previewTimeSeconds ?? 0}
                    isPlaying={sceneLaunchPlaybackMode === 'preview' && isTimelinePlaying}
                    isVisible={sceneLaunchPlaybackMode === 'preview'}
                    getPlaybackSnapshot={getDisplayedPreviewSnapshot}
                  />
                )}
              </div>
            </section>
          </motion.div>
        </main>
      </div>

      {wheelDirectoryPendingKey && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm" onClick={() => setWheelDirectoryPendingKey(null)}>
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">Move to directory</h2>
                <p className="mt-1 text-xs text-zinc-500">Choose a collection for the dropped item.</p>
              </div>
              <button type="button" aria-label="Close directory chooser" onClick={() => setWheelDirectoryPendingKey(null)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 max-h-72 space-y-1 overflow-y-auto">
              {sceneLaunchBeats.filter(beat => beat.id !== 'trash').map(beat => (
                <button
                  key={beat.id}
                  type="button"
                  onClick={() => {
                    moveSceneLaunchItemToTargetCollection(wheelDirectoryPendingKey, beat.id);
                    setWheelDirectoryPendingKey(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-2 text-left text-xs font-semibold text-zinc-300 hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-white"
                >
                  <Grid2X2 className="h-3.5 w-3.5 text-indigo-400" />
                  <span className="truncate">{beat.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <SceneLaunchContextMenu
        menu={sceneLaunchContextMenu}
        isTrashOpen={activeSceneLaunchBeatId === 'trash'}
        onOpenChange={(open) => !open && setSceneLaunchContextMenu(null)}
        onMoveToTrash={moveItemToTrash}
        onRestoreFromTrash={restoreItemFromTrash}
        onDeletePermanently={permanentlyDeleteItem}
        onAddCollection={(insertionIndex) => createSceneLaunchBeat(insertionIndex)}
      />
    </div>
  );
}
