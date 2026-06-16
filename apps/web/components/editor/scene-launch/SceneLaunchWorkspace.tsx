'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Clapperboard, Grid2X2, Plus } from 'lucide-react';
import { Button } from '@storyboard/ui';
import { toast } from 'sonner';

import { useSceneLaunchBoard, type SceneLaunchBeat, type SceneLaunchMediaItem } from './useSceneLaunchBoard';
import { SceneLaunchSidebar } from '../SceneLaunchSidebar';
import { SceneLaunchHeader } from '../SceneLaunchHeader';
import { SceneLaunchGrid } from './SceneLaunchGrid';
import { SceneLaunchTimeline } from '../SceneLaunchTimeline';
import { SceneLaunchContextMenu } from '../SceneLaunchContextMenu';
import type { SidebarTab } from '../EditorSidebarRail';
import type { Scene, TimelineClip, ClipType, TimelineAspectRatio } from '@/lib/timeline-context';

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
}: SceneLaunchWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();

  const activeSceneObject = scenes.find(s => s.id === activeSceneId) || scenes[0];

  const board = useSceneLaunchBoard({
    activeScene: activeSceneObject,
    scenes,
    updateScene,
    handleAddClip,
    updateClip,
  });

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
    moveSceneLaunchCollectionToCollection,
    moveSceneLaunchItemToParent,
    moveItemToTrash,
    restoreItemFromTrash,
    permanentlyDeleteItem,
    emptyTrash,
    updateSceneLaunchMediaDuration,
    updateSceneLaunchMediaOriginalDuration,
    updateSceneLaunchMediaTrim,
    handleItemContextMenu,
  } = board;

  const [pxPerSecond, setPxPerSecond] = React.useState(20);
  const [resizingItem, setResizingItem] = React.useState<any>(null);
  const [timelineDragOverKey, setTimelineDragOverKey] = React.useState<string | null>(null);
  const [gridDragOverInfo, setGridDragOverInfo] = React.useState<{ targetKey: string; position: 'before' | 'after' | 'inside' } | null>(null);
  const [isEditingHeaderName, setIsEditingHeaderName] = React.useState(false);
  const [editingHeaderNameValue, setEditingHeaderNameValue] = React.useState('');
  const [isTimelinePlaying, setIsTimelinePlaying] = React.useState(false);
  const [isTimelineLooping, setIsTimelineLooping] = React.useState(true);
  const [timelineCurrentTime, setTimelineCurrentTime] = React.useState(0);
  const [isScrubbing, setIsScrubbing] = React.useState(false);
  const [sceneLaunchPreviewNow, setSceneLaunchPreviewNow] = React.useState(() => Date.now());
  const [sceneComposerText, setSceneComposerText] = React.useState('');

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
          : (m.durationSeconds || 3);
        return sum + d;
      } else {
        const childBeat = sceneLaunchBeats.find(b => b.id === orderItem.id);
        if (!childBeat) return sum;
        return sum + getRecursiveCollectionDuration(childBeat, visited);
      }
    }, 0);
  }, [sceneLaunchBeats, resizingItem]);

  const getCollectionTimelineSplitPercents = React.useCallback((collection: SceneLaunchBeat) => {
    const orderedMediaItems = getRecursiveMediaItems(collection);
    if (orderedMediaItems.length <= 1) return [];

    const durations = orderedMediaItems.map(item => {
      if (resizingItem && resizingItem.id === item.id) {
        return resizingItem.currentDuration;
      }
      return item.durationSeconds || 3;
    });
    const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
    if (totalDuration <= 0) return [];

    let accumulatedDuration = 0;
    return durations.slice(0, -1).map((duration) => {
      accumulatedDuration += duration;
      return (accumulatedDuration / totalDuration) * 100;
    });
  }, [getRecursiveMediaItems, resizingItem]);

  const getSceneLaunchMediaPreviewDuration = (item: SceneLaunchMediaItem) => (
    Math.max(1, item.durationSeconds ?? 3)
  );

  const getSceneLaunchMediaTimelineDuration = React.useCallback((item: SceneLaunchMediaItem) => {
    if (resizingItem && resizingItem.id === item.id) {
      return resizingItem.currentDuration;
    }
    return Math.max(1, item.durationSeconds ?? 3);
  }, [resizingItem]);

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

  const getAspectRatioValue = (ratio: string): number => {
    const [w, h] = ratio.split(':').map(Number);
    return w / h;
  };

  const getSceneLaunchMediaTileStyle = React.useCallback((item: SceneLaunchMediaItem): React.CSSProperties => {
    const ratioValue = getAspectRatioValue(aspectRatio);
    const ratioMultiplier = ratioValue / (16 / 9);

    const duration = item.type === 'image'
      ? Math.max(1, Math.min(12, item.durationSeconds ?? 3))
      : 3;

    const baseBasis = duration * 3.2;
    const scaledBasis = Math.max(5.0, baseBasis * ratioMultiplier);

    const baseMin = item.type === 'image' ? 5 : 7;
    const scaledMin = Math.max(5.0, baseMin * ratioMultiplier);

    return {
      flex: `${duration} 1 ${scaledBasis}rem`,
      minWidth: `${scaledMin}rem`,
      maxWidth: '100%',
    };
  }, [aspectRatio]);

  const getSceneLaunchCollectionTileStyle = React.useCallback((): React.CSSProperties => {
    const ratioValue = getAspectRatioValue(aspectRatio);
    const ratioMultiplier = ratioValue / (16 / 9);

    const scaledBasis = Math.max(7, 9.6 * ratioMultiplier);
    const scaledMin = Math.max(5.5, 6.4 * ratioMultiplier);

    return {
      flex: `3 1 ${scaledBasis}rem`,
      minWidth: `${scaledMin}rem`,
      maxWidth: '100%',
    };
  }, [aspectRatio]);

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

  const activeItemInfo = getActiveTimelineItemInfo(timelineCurrentTime);
  const activeItemKey = activeItemInfo ? `${activeItemInfo.type}:${activeItemInfo.id}` : null;
  const sceneLaunchTimelineTitle = activeSceneLaunchBeatId === 'trash'
    ? 'Trash Timeline'
    : activeSceneLaunchBeat
      ? `${activeSceneLaunchBeat.name} Timeline`
      : 'Project Timeline';

  const setSceneLaunchTimelineTime = React.useCallback((time: number) => {
    setTimelineCurrentTime(time);
    currentTimeRef.current = time;
  }, []);

  const toggleSceneLaunchTimelinePlayback = React.useCallback(() => {
    setIsTimelinePlaying((currentPlaying) => {
      const nextPlaying = !currentPlaying;
      if (nextPlaying) {
        setSceneLaunchTimelineTime(0);
        setSceneLaunchPreviewPausedOffset(0);
        setSceneLaunchManuallyPaused(null);
      }
      return nextPlaying;
    });
  }, [setSceneLaunchTimelineTime]);

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
        const totalDuration = mediaItems.reduce((sum, item) => sum + (item.durationSeconds || 3), 0);
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
  }, [sceneLaunchPreviewHover, isTimelinePlaying, isScrubbing, timelineItems, sceneLaunchBeats, sceneLaunchManuallyPaused, sceneLaunchPreviewPausedOffset, getRecursiveMediaItems, syncTimelinePlayheadToCollectionPreview]);

  // Timeline playback tick effect
  React.useEffect(() => {
    if (!isTimelinePlaying) return;

    let lastTime = performance.now();
    let frameId: number;

    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      const current = currentTimeRef.current;
      const next = current + delta;

      if (next >= timelineTotalDuration) {
        setTimelineCurrentTime(0);
        currentTimeRef.current = 0;
        if (!isTimelineLooping) {
          setIsTimelinePlaying(false);
          return;
        }
      } else {
        setTimelineCurrentTime(next);
        currentTimeRef.current = next;
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isTimelinePlaying, timelineTotalDuration, isTimelineLooping]);

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
    e.dataTransfer.dropEffect = 'move';

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

    if (!gridDragOverInfo || gridDragOverInfo.targetKey !== targetKey || gridDragOverInfo.position !== position) {
      setGridDragOverInfo({ targetKey, position });
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
    if (!draggedKey || draggedKey === targetKey) return;

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

    if (isCollection && position === 'inside') {
      const collectionId = targetKey.slice('collection:'.length);
      if (draggedKey.startsWith('media:')) {
        moveSceneLaunchMediaToCollection(draggedKey.slice('media:'.length), collectionId);
      } else if (draggedKey.startsWith('collection:')) {
        moveSceneLaunchCollectionToCollection(draggedKey.slice('collection:'.length), collectionId);
      }
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
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
        />

        <main className="relative flex min-h-0 flex-1 flex-col px-6 pb-56 overflow-y-auto">
          {!activeSceneLaunchBeat && rootSceneLaunchGridItemsCount === 0 && (projectHasSceneContent || visibleProjectScenes.length > 1) ? (
            <div className="mx-auto mt-8 w-full max-w-6xl">
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
          ) : sceneLaunchGridItems.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center">
                  <Grid2X2 className="h-12 w-12 text-zinc-600" />
                </div>
                <h2 className="mt-5 text-lg font-medium text-zinc-500">Start creating or drop scene media</h2>
                <p className="mt-2 max-w-sm text-xs leading-5 text-zinc-700">
                  Add a video, image, or scene note to begin building this project.
                </p>
              </div>
            </div>
          ) : (
            <SceneLaunchGrid
              activeSceneLaunchBeatId={activeSceneLaunchBeatId}
              activeSceneLaunchBeat={activeSceneLaunchBeat || null}
              sceneLaunchGridItems={sceneLaunchGridItems}
              isTimelinePlaying={isTimelinePlaying}
              activeItemKey={activeItemKey}
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
              emptyTrash={emptyTrash}
              createSceneLaunchBeat={createSceneLaunchBeat}
              handleAddClipClick={handleAddClipClick}
              handleBeatDrop={(event, beatId) => {
                event.preventDefault();
                event.stopPropagation();
                addFilesToBeat(beatId, Array.from(event.dataTransfer.files || []));
              }}
            />
          )}
        </main>

        <SceneLaunchTimeline
          title={sceneLaunchTimelineTitle}
          totalDuration={timelineTotalDuration}
          timelineItems={timelineItems}
          activeItemKey={activeItemKey}
          timelineCurrentTime={timelineCurrentTime}
          pxPerSecond={pxPerSecond}
          setPxPerSecond={setPxPerSecond}
          isTimelinePlaying={isTimelinePlaying}
          isTimelineLooping={isTimelineLooping}
          onToggleLoop={() => setIsTimelineLooping(current => !current)}
          onTogglePlayback={toggleSceneLaunchTimelinePlayback}
          isScrubbing={isScrubbing}
          setIsScrubbing={setIsScrubbing}
          onTimelineTimeChange={setSceneLaunchTimelineTime}
          timelineDragOverKey={timelineDragOverKey}
          setTimelineDragOverKey={setTimelineDragOverKey}
          resizingItem={resizingItem}
          setResizingItem={setResizingItem}
          getRecursiveCollectionDuration={getRecursiveCollectionDuration}
          getCollectionTimelineSplitPercents={getCollectionTimelineSplitPercents}
          getSceneLaunchCollectionPreview={getSceneLaunchCollectionPreview}
          reorderSceneLaunchGridItem={reorderSceneLaunchGridItem}
          handleItemContextMenu={handleItemContextMenu}
          updateSceneLaunchMediaDuration={updateSceneLaunchMediaDuration}
        />
      </div>

      <SceneLaunchContextMenu
        menu={sceneLaunchContextMenu}
        isTrashOpen={activeSceneLaunchBeatId === 'trash'}
        onOpenChange={(open) => !open && setSceneLaunchContextMenu(null)}
        onMoveToTrash={moveItemToTrash}
        onRestoreFromTrash={restoreItemFromTrash}
        onDeletePermanently={permanentlyDeleteItem}
      />
    </div>
  );
}
