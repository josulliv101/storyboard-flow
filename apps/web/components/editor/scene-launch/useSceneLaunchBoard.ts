'use client';

import React from 'react';
import { toast } from 'sonner';
import type { Scene, TimelineClip, ClipType } from '@/lib/timeline-context';

const MAX_IMAGE_DURATION_SECONDS = 60 * 60;

export type SceneLaunchMediaItem = {
  id: string;
  clipId: string;
  name: string;
  type: 'image' | 'video';
  previewUrl: string;
  durationSeconds?: number;
  trimStartSeconds?: number;
  mediaDurationSeconds?: number;
  fileSize?: number;
};

export type SceneLaunchBeat = {
  id: string;
  name: string;
  items: SceneLaunchMediaItem[];
  childIds: string[];
  gridOrder: Array<{ id: string; type: 'media' | 'collection' }>;
};

export type SceneLaunchBoardState = {
  mediaItems: SceneLaunchMediaItem[];
  collections: SceneLaunchBeat[];
  gridOrder: Array<{ id: string; type: 'media' | 'collection' }>;
};

const sceneLaunchBoardStorageKey = 'storyboard-flow:scene-launch-board:v1';
const sceneLaunchBoardDbName = 'storyboard-flow-scene-launch-board';
const sceneLaunchBoardStoreName = 'boards';

const openSceneLaunchBoardDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    reject(new Error('IndexedDB is not available.'));
    return;
  }

  const request = window.indexedDB.open(sceneLaunchBoardDbName, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(sceneLaunchBoardStoreName)) {
      db.createObjectStore(sceneLaunchBoardStoreName);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not open board storage.'));
});

const readSceneLaunchBoardFromIndexedDb = async () => {
  const db = await openSceneLaunchBoardDb();
  return new Promise<Partial<SceneLaunchBoardState> | null>((resolve, reject) => {
    const transaction = db.transaction(sceneLaunchBoardStoreName, 'readonly');
    const request = transaction.objectStore(sceneLaunchBoardStoreName).get(sceneLaunchBoardStorageKey);
    request.onsuccess = () => resolve((request.result as Partial<SceneLaunchBoardState> | undefined) || null);
    request.onerror = () => reject(request.error || new Error('Could not read board storage.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('Could not read board storage.'));
    };
  });
};

const writeSceneLaunchBoardToIndexedDb = async (board: SceneLaunchBoardState) => {
  const db = await openSceneLaunchBoardDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(sceneLaunchBoardStoreName, 'readwrite');
    const request = transaction.objectStore(sceneLaunchBoardStoreName).put(board, sceneLaunchBoardStorageKey);
    request.onerror = () => reject(request.error || new Error('Could not write board storage.'));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('Could not write board storage.'));
    };
  });
};

const normalizeSceneLaunchBoard = (board: Partial<SceneLaunchBoardState> | null | undefined): SceneLaunchBoardState => ({
  mediaItems: Array.isArray(board?.mediaItems) ? board.mediaItems : [],
  collections: (() => {
    const cols = Array.isArray(board?.collections)
      ? board.collections.map(collection => {
          const items = Array.isArray(collection.items) ? collection.items : [];
          return {
            ...collection,
            items,
            childIds: Array.isArray(collection.childIds) ? collection.childIds : [],
            gridOrder: Array.isArray(collection.gridOrder)
              ? collection.gridOrder
              : items.map(item => ({ id: item.id, type: 'media' as const })),
          };
        })
      : [];
    if (!cols.some(c => c.id === 'trash')) {
      cols.push({
        id: 'trash',
        name: 'Trash',
        items: [],
        childIds: [],
        gridOrder: []
      });
    }
    return cols;
  })(),
  gridOrder: Array.isArray(board?.gridOrder) ? board.gridOrder : [],
});

interface UseSceneLaunchBoardParams {
  activeScene: Scene | undefined;
  scenes: Scene[];
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  handleAddClip: (type: ClipType, character?: string, file?: File, customId?: string, customDurationSeconds?: number) => string;
  updateClip: (clipId: string, updates: Partial<TimelineClip>) => void;
}

export function useSceneLaunchBoard({
  activeScene,
  scenes,
  updateScene,
  handleAddClip,
  updateClip,
}: UseSceneLaunchBoardParams) {
  const [sceneLaunchMediaItems, setSceneLaunchMediaItems] = React.useState<SceneLaunchMediaItem[]>([]);
  const [sceneLaunchBeats, setSceneLaunchBeats] = React.useState<SceneLaunchBeat[]>([]);
  const [sceneLaunchGridOrder, setSceneLaunchGridOrder] = React.useState<Array<{ id: string; type: 'media' | 'collection' }>>([]);
  const [hasLoadedSceneLaunchBoard, setHasLoadedSceneLaunchBoard] = React.useState(false);

  const [sceneLaunchBeatPath, setSceneLaunchBeatPath] = React.useState<string[]>([]);
  const [sceneLaunchSearch, setSceneLaunchSearch] = React.useState('');
  const [activeBeatUploadId, setActiveBeatUploadId] = React.useState<string | null>(null);

  // Hover states & custom preview timer logic
  const [sceneLaunchPreviewHover, setSceneLaunchPreviewHover] = React.useState<{ collectionId: string; startedAt: number } | null>(null);
  const [sceneLaunchManuallyPaused, setSceneLaunchManuallyPaused] = React.useState<string | null>(null);
  const [sceneLaunchPreviewPausedOffset, setSceneLaunchPreviewPausedOffset] = React.useState<number>(0);
  const [collectionScrubbingId, setCollectionScrubbingId] = React.useState<string | null>(null);
  const [trimmingItemId, setTrimmingItemId] = React.useState<string | null>(null);

  // Context Menu state
  const [sceneLaunchContextMenu, setSceneLaunchContextMenu] = React.useState<
    | { type: 'item'; x: number; y: number; dragKey: string }
    | { type: 'board'; x: number; y: number; insertionIndex: number }
    | null
  >(null);

  const sceneLaunchMediaItemsRef = React.useRef(sceneLaunchMediaItems);
  const sceneLaunchBeatsRef = React.useRef(sceneLaunchBeats);

  React.useEffect(() => {
    sceneLaunchMediaItemsRef.current = sceneLaunchMediaItems;
  }, [sceneLaunchMediaItems]);

  React.useEffect(() => {
    sceneLaunchBeatsRef.current = sceneLaunchBeats;
  }, [sceneLaunchBeats]);

  // Load state from IndexedDB/localStorage
  React.useEffect(() => {
    let isCancelled = false;

    const loadSceneLaunchBoard = async () => {
      try {
        let storedBoard = await readSceneLaunchBoardFromIndexedDb();

        if (!storedBoard) {
          const localStorageBoard = window.localStorage.getItem(sceneLaunchBoardStorageKey);
          storedBoard = localStorageBoard ? JSON.parse(localStorageBoard) as Partial<SceneLaunchBoardState> : null;
        }

        if (isCancelled) return;

        const normalizedBoard = normalizeSceneLaunchBoard(storedBoard);
        setSceneLaunchMediaItems(normalizedBoard.mediaItems);
        setSceneLaunchBeats(normalizedBoard.collections);
        setSceneLaunchGridOrder(normalizedBoard.gridOrder);
      } catch {
        if (isCancelled) return;
        setSceneLaunchMediaItems([]);
        setSceneLaunchBeats([]);
        setSceneLaunchGridOrder([]);
      } finally {
        if (!isCancelled) setHasLoadedSceneLaunchBoard(true);
      }
    };

    void loadSceneLaunchBoard();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Save changes to IndexedDB/localStorage
  React.useEffect(() => {
    if (!hasLoadedSceneLaunchBoard) return;

    const saveSceneLaunchBoard = async () => {
      try {
        await writeSceneLaunchBoardToIndexedDb({
          mediaItems: sceneLaunchMediaItems,
          collections: sceneLaunchBeats,
          gridOrder: sceneLaunchGridOrder,
        });
      } catch {
        try {
          window.localStorage.setItem(sceneLaunchBoardStorageKey, JSON.stringify({
            mediaItems: sceneLaunchMediaItems,
            collections: sceneLaunchBeats,
            gridOrder: sceneLaunchGridOrder,
          }));
        } catch {
          toast.error('Could not save this scene board in browser storage.', { id: 'scene-board-storage-error' });
        }
      }
    };

    void saveSceneLaunchBoard();
  }, [hasLoadedSceneLaunchBoard, sceneLaunchBeats, sceneLaunchGridOrder, sceneLaunchMediaItems]);

  // Cleanup object URLs on unmount
  React.useEffect(() => (
    () => {
      sceneLaunchMediaItemsRef.current.forEach(item => {
        if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      });
      sceneLaunchBeatsRef.current.forEach(beat => {
        beat.items.forEach(item => {
          if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
        });
      });
    }
  ), []);

  const readSceneLaunchFilePreview = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Could not read file preview.'));
    });
    reader.addEventListener('error', () => reject(reader.error || new Error('Could not read file preview.')));
    reader.readAsDataURL(file);
  });

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const url = URL.createObjectURL(file);
      video.src = url;

      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number(video.duration.toFixed(1)) || 3);
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(3);
      };
    });
  };

  const activeSceneLaunchBeatId = sceneLaunchBeatPath[sceneLaunchBeatPath.length - 1] || null;
  const activeSceneLaunchBeat = activeSceneLaunchBeatId
    ? sceneLaunchBeats.find(beat => beat.id === activeSceneLaunchBeatId)
    : null;

  const addFilesToSceneLaunchMedia = async (files: File[]) => {
    const validFiles = files.filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
    const invalidCount = files.length - validFiles.length;

    if (invalidCount > 0) {
      toast.error('Only image and video files can be added here.');
    }

    if (validFiles.length === 0) return;

    const nextItems = await Promise.all(validFiles.map(async file => {
      const isVideo = file.type.startsWith('video/');
      const durationSeconds = isVideo ? await getVideoDuration(file) : 3;
      const clipId = `clip-${Math.random().toString(36).substr(2, 9)}`;
      return {
        id: `scene-media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        clipId,
        name: file.name,
        type: isVideo ? 'video' as const : 'image' as const,
        previewUrl: await readSceneLaunchFilePreview(file),
        durationSeconds,
        mediaDurationSeconds: isVideo ? durationSeconds : undefined,
        fileSize: file.size,
      };
    }));

    if (activeSceneLaunchBeatId) {
      setSceneLaunchBeats(previous => previous.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? {
              ...beat,
              items: [...beat.items, ...nextItems],
              gridOrder: [
                ...beat.gridOrder,
                ...nextItems.map(item => ({ id: item.id, type: 'media' as const })),
              ],
            }
          : beat
      )));
    } else {
      setSceneLaunchMediaItems(previous => [...previous, ...nextItems]);
      setSceneLaunchGridOrder(previous => [
        ...previous,
        ...nextItems.map(item => ({ id: item.id, type: 'media' as const })),
      ]);
    }

    nextItems.forEach((item, index) => {
      const file = validFiles[index];
      handleAddClip(item.type, undefined, file, item.clipId, item.durationSeconds);
    });
  };

  const createSceneLaunchBeat = (insertionIndex?: number) => {
    const id = `beat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const insertGridItem = (
      order: Array<{ id: string; type: 'media' | 'collection' }>,
      item: { id: string; type: 'collection' },
    ) => {
      if (typeof insertionIndex !== 'number') {
        return [...order, item];
      }
      const nextIndex = Math.max(0, Math.min(insertionIndex, order.length));
      return [
        ...order.slice(0, nextIndex),
        item,
        ...order.slice(nextIndex),
      ];
    };

    if (activeSceneLaunchBeatId) {
      setSceneLaunchBeats(previous => previous.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? {
              ...beat,
              childIds: [...beat.childIds, id],
              gridOrder: insertGridItem(beat.gridOrder, { id, type: 'collection' as const }),
            }
          : beat
      )));
    } else {
      setSceneLaunchGridOrder(previous => insertGridItem(previous, { id, type: 'collection' }));
    }
    setSceneLaunchBeats(previous => [
      ...previous,
      {
        id,
        name: `Collection ${previous.length + 1}`,
        items: [],
        childIds: [],
        gridOrder: [],
      },
    ]);
  };

  const openBeatUpload = (beatId: string) => {
    setActiveBeatUploadId(beatId);
  };

  const openBeatDetail = (beatId: string) => {
    setSceneLaunchBeatPath(previous => [...previous, beatId]);
  };

  const addFilesToBeat = async (beatId: string, files: File[]) => {
    const validFiles = files.filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
    const invalidCount = files.length - validFiles.length;

    if (invalidCount > 0) {
      toast.error('Only image and video files can be added to a collection.');
    }

    if (validFiles.length === 0) return;

    const nextItems = await Promise.all(validFiles.map(async file => {
      const isVideo = file.type.startsWith('video/');
      const durationSeconds = isVideo ? await getVideoDuration(file) : 3;
      const clipId = `clip-${Math.random().toString(36).substr(2, 9)}`;
      return {
        id: `beat-item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        clipId,
        name: file.name,
        type: isVideo ? 'video' as const : 'image' as const,
        previewUrl: await readSceneLaunchFilePreview(file),
        durationSeconds,
        mediaDurationSeconds: isVideo ? durationSeconds : undefined,
        fileSize: file.size,
      };
    }));

    setSceneLaunchBeats(previous => previous.map(beat => (
      beat.id === beatId
        ? {
            ...beat,
            items: [...beat.items, ...nextItems],
            gridOrder: [
              ...beat.gridOrder,
              ...nextItems.map(item => ({ id: item.id, type: 'media' as const })),
            ],
          }
        : beat
    )));

    nextItems.forEach((item, index) => {
      const file = validFiles[index];
      handleAddClip(item.type, undefined, file, item.clipId, item.durationSeconds);
    });
  };

  const findSceneLaunchMediaItem = (mediaId: string) => {
    const rootItem = sceneLaunchMediaItems.find(item => item.id === mediaId);
    if (rootItem) return rootItem;
    return sceneLaunchBeats.flatMap(beat => beat.items).find(item => item.id === mediaId) || null;
  };

  const removeSceneLaunchMediaFromCurrentLevel = (mediaId: string) => {
    if (activeSceneLaunchBeatId) {
      setSceneLaunchBeats(previous => previous.map(beat => {
        if (beat.id === activeSceneLaunchBeatId) {
          const items = Array.isArray(beat.items) ? beat.items : [];
          const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
          return {
            ...beat,
            items: items.filter(item => item.id !== mediaId),
            gridOrder: gridOrder.filter(item => !(item.type === 'media' && item.id === mediaId)),
          };
        }
        return beat;
      }));
    } else {
      setSceneLaunchMediaItems(previous => previous.filter(item => item.id !== mediaId));
      setSceneLaunchGridOrder(previous => previous.filter(item => !(item.type === 'media' && item.id === mediaId)));
    }
  };

  const moveSceneLaunchMediaToCollection = (mediaId: string, beatId: string) => {
    const mediaItem = findSceneLaunchMediaItem(mediaId);
    if (!mediaItem) return;

    removeSceneLaunchMediaFromCurrentLevel(mediaId);
    setSceneLaunchBeats(previous => previous.map(beat => (
      beat.id === beatId
        ? {
            ...beat,
            items: beat.items.some(item => item.id === mediaId) ? beat.items : [...beat.items, mediaItem],
            gridOrder: beat.gridOrder.some(item => item.type === 'media' && item.id === mediaId)
              ? beat.gridOrder
              : [...beat.gridOrder, { id: mediaId, type: 'media' as const }],
          }
        : beat
    )));
  };

  const isDescendantCollection = (parentCollectionId: string, potentialDescendantId: string): boolean => {
    const parent = sceneLaunchBeats.find(b => b.id === parentCollectionId);
    if (!parent) return false;
    const childIds = Array.isArray(parent.childIds) ? parent.childIds : [];
    if (childIds.includes(potentialDescendantId)) return true;
    return childIds.some(childId => isDescendantCollection(childId, potentialDescendantId));
  };

  const moveSceneLaunchCollectionToCollection = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    if (isDescendantCollection(draggedId, targetId)) {
      toast.error('Cannot move a collection inside its own sub-collection.');
      return;
    }

    const draggedBeat = sceneLaunchBeats.find(b => b.id === draggedId);
    const targetBeat = sceneLaunchBeats.find(b => b.id === targetId);
    if (!draggedBeat || !targetBeat) {
      toast.error('Collection not found.');
      return;
    }

    // 1. Remove from current parent / level
    const isAtRoot = sceneLaunchGridOrder.some(item => item.type === 'collection' && item.id === draggedId);
    if (isAtRoot) {
      setSceneLaunchGridOrder(prev => prev.filter(item => !(item.type === 'collection' && item.id === draggedId)));
    } else {
      let parentBeatId: string | null = null;
      for (const beat of sceneLaunchBeats) {
        const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
        if (childIds.includes(draggedId)) {
          parentBeatId = beat.id;
          break;
        }
      }

      if (parentBeatId) {
        if (parentBeatId === targetId) return;

        setSceneLaunchBeats(prev => prev.map(beat => {
          if (beat.id === parentBeatId) {
            const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
            const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
            return {
              ...beat,
              childIds: childIds.filter(cid => cid !== draggedId),
              gridOrder: gridOrder.filter(item => !(item.type === 'collection' && item.id === draggedId))
            };
          }
          return beat;
        }));
      }
    }

    // 2. Add to target parent
    setSceneLaunchBeats(prev => prev.map(beat => {
      if (beat.id === targetId) {
        const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
        const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
        const exists = childIds.includes(draggedId);
        const newChildIds = exists ? childIds : [...childIds, draggedId];
        const newGridOrder = exists ? gridOrder : [...gridOrder, { id: draggedId, type: 'collection' as const }];
        return {
          ...beat,
          childIds: newChildIds,
          gridOrder: newGridOrder
        };
      }
      return beat;
    }));

    toast.success(`Moved collection "${draggedBeat.name}" to "${targetBeat.name}"`);
  };

  const moveSceneLaunchItemToParent = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if (!type || !id) return;

    if (!activeSceneLaunchBeatId) return; // Already at root

    let parentBeatId: string | null = null;
    if (activeSceneLaunchBeatId !== 'trash') {
      for (const beat of sceneLaunchBeats) {
        const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
        if (childIds.includes(activeSceneLaunchBeatId)) {
          parentBeatId = beat.id;
          break;
        }
      }
    }

    if (type === 'media') {
      const mediaItem = findSceneLaunchMediaItem(id);
      if (!mediaItem) return;

      removeSceneLaunchMediaFromCurrentLevel(id);

      if (parentBeatId) {
        setSceneLaunchBeats(previous => previous.map(beat => {
          if (beat.id === parentBeatId) {
            const items = Array.isArray(beat.items) ? beat.items : [];
            const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
            return {
              ...beat,
              items: items.some(item => item.id === id) ? items : [...items, mediaItem],
              gridOrder: gridOrder.some(item => item.type === 'media' && item.id === id)
                ? gridOrder
                : [...gridOrder, { id, type: 'media' as const }],
            };
          }
          return beat;
        }));
        const parentBeat = sceneLaunchBeats.find(b => b.id === parentBeatId);
        toast.success(`Moved "${mediaItem.name}" to "${parentBeat?.name || 'parent folder'}"`);
      } else {
        setSceneLaunchMediaItems(prev => [...prev, mediaItem]);
        setSceneLaunchGridOrder(prev => [...prev, { id, type: 'media' }]);
        toast.success(`Moved "${mediaItem.name}" to root`);
      }
    } else if (type === 'collection') {
      const draggedBeat = sceneLaunchBeats.find(b => b.id === id);
      if (!draggedBeat) return;

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === activeSceneLaunchBeatId) {
          const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
          const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
          return {
            ...beat,
            childIds: childIds.filter(cid => cid !== id),
            gridOrder: gridOrder.filter(item => !(item.type === 'collection' && item.id === id))
          };
        }
        return beat;
      }));

      if (parentBeatId) {
        setSceneLaunchBeats(prev => prev.map(beat => {
          if (beat.id === parentBeatId) {
            const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
            const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
            const exists = childIds.includes(id);
            const newChildIds = exists ? childIds : [...childIds, id];
            const newGridOrder = exists ? gridOrder : [...gridOrder, { id: draggedBeat.id, type: 'collection' as const }];
            return {
              ...beat,
              childIds: newChildIds,
              gridOrder: newGridOrder
            };
          }
          return beat;
        }));
        const parentBeat = sceneLaunchBeats.find(b => b.id === parentBeatId);
        toast.success(`Moved collection "${draggedBeat.name}" to "${parentBeat?.name || 'parent folder'}"`);
      } else {
        setSceneLaunchGridOrder(prev => [...prev, { id, type: 'collection' }]);
        toast.success(`Moved collection "${draggedBeat.name}" to root`);
      }
    }
  };

  const moveSceneLaunchItemToTargetCollection = (dragKey: string, targetId: string) => {
    console.log('[moveSceneLaunchItemToTargetCollection] Invoked with dragKey:', dragKey, 'targetId:', targetId);
    const [type, id] = dragKey.split(':');
    if (!type || !id) {
      console.error('[moveSceneLaunchItemToTargetCollection] Invalid type/id:', type, id);
      return;
    }

    if (targetId === 'trash') {
      console.log('[moveSceneLaunchItemToTargetCollection] Routing to trash');
      moveItemToTrash(dragKey);
      return;
    }

    if (type === 'media') {
      const mediaItem = findSceneLaunchMediaItem(id);
      console.log('[moveSceneLaunchItemToTargetCollection] findSceneLaunchMediaItem returned:', mediaItem);
      if (!mediaItem) {
        console.error('[moveSceneLaunchItemToTargetCollection] Media item not found for id:', id);
        return;
      }

      // 1. Remove from current level
      const isAtRoot = sceneLaunchGridOrder.some(item => item.type === 'media' && item.id === id);
      if (isAtRoot) {
        setSceneLaunchGridOrder(prev => prev.filter(item => !(item.type === 'media' && item.id === id)));
        setSceneLaunchMediaItems(prev => prev.filter(item => item.id !== id));
      } else {
        setSceneLaunchBeats(previous => previous.map(beat => {
          const items = Array.isArray(beat.items) ? beat.items : [];
          const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
          return {
            ...beat,
            items: items.filter(item => item.id !== id),
            gridOrder: gridOrder.filter(item => !(item.type === 'media' && item.id === id)),
          };
        }));
      }

      // 2. Add to target level
      if (targetId === '__root__' || targetId === 'root') {
        setSceneLaunchMediaItems(prev => [...prev, mediaItem]);
        setSceneLaunchGridOrder(prev => [...prev, { id, type: 'media' }]);
        toast.success(`Moved "${mediaItem.name}" to Scene Board`);
      } else {
        setSceneLaunchBeats(previous => previous.map(beat => {
          if (beat.id === targetId) {
            const items = Array.isArray(beat.items) ? beat.items : [];
            const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
            return {
              ...beat,
              items: items.some(item => item.id === id) ? items : [...items, mediaItem],
              gridOrder: gridOrder.some(item => item.type === 'media' && item.id === id)
                ? gridOrder
                : [...gridOrder, { id, type: 'media' as const }],
            };
          }
          return beat;
        }));
        const targetBeat = sceneLaunchBeats.find(b => b.id === targetId);
        toast.success(`Moved "${mediaItem.name}" to "${targetBeat?.name || 'collection'}"`);
      }
    } else if (type === 'collection') {
      if (id === targetId) return;

      if (targetId !== '__root__' && targetId !== 'root' && isDescendantCollection(id, targetId)) {
        toast.error('Cannot move a collection inside its own sub-collection.');
        return;
      }

      const draggedBeat = sceneLaunchBeats.find(b => b.id === id);
      if (!draggedBeat) return;

      // 1. Remove from current level
      const isAtRoot = sceneLaunchGridOrder.some(item => item.type === 'collection' && item.id === id);
      if (isAtRoot) {
        setSceneLaunchGridOrder(prev => prev.filter(item => !(item.type === 'collection' && item.id === id)));
      } else {
        setSceneLaunchBeats(previous => previous.map(beat => {
          const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
          const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
          return {
            ...beat,
            childIds: childIds.filter(cid => cid !== id),
            gridOrder: gridOrder.filter(item => !(item.type === 'collection' && item.id === id)),
          };
        }));
      }

      // 2. Add to target level
      if (targetId === '__root__' || targetId === 'root') {
        setSceneLaunchGridOrder(prev => [...prev, { id, type: 'collection' }]);
        toast.success(`Moved collection "${draggedBeat.name}" to Scene Board`);
      } else {
        setSceneLaunchBeats(previous => previous.map(beat => {
          if (beat.id === targetId) {
            const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
            const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
            return {
              ...beat,
              childIds: [...childIds, id],
              gridOrder: [...gridOrder, { id, type: 'collection' as const }],
            };
          }
          return beat;
        }));
        const targetBeat = sceneLaunchBeats.find(b => b.id === targetId);
        toast.success(`Moved collection "${draggedBeat.name}" to "${targetBeat?.name || 'collection'}"`);
      }
    }
  };

  const moveItemToTrash = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if (!type || !id) return;
    if (activeSceneLaunchBeatId === 'trash') return;

    let itemTitle = '';

    if (type === 'media') {
      const foundMedia = findSceneLaunchMediaItem(id);
      if (!foundMedia) return;
      itemTitle = foundMedia.name;

      removeSceneLaunchMediaFromCurrentLevel(id);

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            items: [...beat.items, foundMedia],
            gridOrder: [...beat.gridOrder, { id, type: 'media' as const }]
          };
        }
        return beat;
      }));
    } else if (type === 'collection') {
      if (id === 'trash') return;

      const targetBeat = sceneLaunchBeats.find(b => b.id === id);
      if (!targetBeat) return;
      itemTitle = targetBeat.name;

      const isAtRoot = sceneLaunchGridOrder.some(item => item.type === 'collection' && item.id === id);
      if (isAtRoot) {
        setSceneLaunchGridOrder(prev => prev.filter(item => !(item.type === 'collection' && item.id === id)));
      } else {
        let parentBeatId: string | null = null;
        for (const beat of sceneLaunchBeats) {
          const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
          if (childIds.includes(id)) {
            parentBeatId = beat.id;
            break;
          }
        }
        if (parentBeatId) {
          setSceneLaunchBeats(prev => prev.map(beat => {
            if (beat.id === parentBeatId) {
              const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
              const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
              return {
                ...beat,
                childIds: childIds.filter(cid => cid !== id),
                gridOrder: gridOrder.filter(item => !(item.type === 'collection' && item.id === id))
              };
            }
            return beat;
          }));
        }
      }

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            childIds: [...beat.childIds, id],
            gridOrder: [...beat.gridOrder, { id, type: 'collection' as const }]
          };
        }
        return beat;
      }));
    }

    toast.success(`Moved "${itemTitle}" to Trash`);
  };

  const restoreItemFromTrash = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if (!type || !id) return;

    const trashBeat = sceneLaunchBeats.find(b => b.id === 'trash');
    if (!trashBeat) return;

    let itemTitle = '';

    if (type === 'media') {
      const foundMedia = trashBeat.items.find(m => m.id === id);
      if (!foundMedia) return;
      itemTitle = foundMedia.name;

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            items: beat.items.filter(m => m.id !== id),
            gridOrder: beat.gridOrder.filter(item => !(item.type === 'media' && item.id === id))
          };
        }
        return beat;
      }));

      setSceneLaunchMediaItems(prev => [...prev, foundMedia]);
      setSceneLaunchGridOrder(prev => [...prev, { id, type: 'media' as const }]);
    } else if (type === 'collection') {
      const targetBeat = sceneLaunchBeats.find(b => b.id === id);
      if (!targetBeat) return;
      itemTitle = targetBeat.name;

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            childIds: beat.childIds.filter(cid => cid !== id),
            gridOrder: beat.gridOrder.filter(item => !(item.type === 'collection' && item.id === id))
          };
        }
        return beat;
      }));

      setSceneLaunchGridOrder(prev => [...prev, { id, type: 'collection' as const }]);
    }

    toast.success(`Restored "${itemTitle}" to main view`);
  };

  const permanentlyDeleteItem = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if (!type || !id) return;

    const trashBeat = sceneLaunchBeats.find(b => b.id === 'trash');
    if (!trashBeat) return;

    let itemTitle = '';

    if (type === 'media') {
      const foundMedia = trashBeat.items.find(m => m.id === id);
      if (!foundMedia) return;
      itemTitle = foundMedia.name;

      if (foundMedia.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(foundMedia.previewUrl);
      }

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            items: beat.items.filter(m => m.id !== id),
            gridOrder: beat.gridOrder.filter(item => !(item.type === 'media' && item.id === id))
          };
        }
        return beat;
      }));
    } else if (type === 'collection') {
      const targetBeat = sceneLaunchBeats.find(b => b.id === id);
      if (!targetBeat) return;
      itemTitle = targetBeat.name;

      targetBeat.items.forEach(item => {
        if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      });

      setSceneLaunchBeats(prev => prev
        .filter(beat => beat.id !== id)
        .map(beat => {
          if (beat.id === 'trash') {
            return {
              ...beat,
              childIds: beat.childIds.filter(cid => cid !== id),
              gridOrder: beat.gridOrder.filter(item => !(item.type === 'collection' && item.id === id))
            };
          }
          return beat;
        })
      );
    }

    toast.success(`Permanently deleted "${itemTitle}"`);
  };

  const emptyTrash = () => {
    const trashBeat = sceneLaunchBeats.find(b => b.id === 'trash');
    if (!trashBeat) return;

    const collectionsToPermanentlyDelete = new Set<string>(trashBeat.childIds);

    trashBeat.items.forEach(item => {
      if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
    });

    sceneLaunchBeats.forEach(beat => {
      if (collectionsToPermanentlyDelete.has(beat.id)) {
        beat.items.forEach(item => {
          if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
        });
      }
    });

    setSceneLaunchBeats(prev => prev
      .filter(beat => !collectionsToPermanentlyDelete.has(beat.id))
      .map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            items: [],
            childIds: [],
            gridOrder: []
          };
        }
        return beat;
      })
    );

    toast.success('Trash emptied permanently');
  };

  const updateSceneLaunchMediaDuration = (mediaId: string, durationSeconds: number) => {
    const updateItem = (item: SceneLaunchMediaItem) => {
      if (item.id !== mediaId) return item;

      const trimStart = Math.max(0, item.trimStartSeconds ?? 0);
      const sourceDuration = item.type === 'image'
        ? MAX_IMAGE_DURATION_SECONDS
        : item.mediaDurationSeconds ?? Math.max(trimStart + 0.5, item.durationSeconds ?? durationSeconds ?? 1);
      const maxDuration = Math.max(0.5, sourceDuration - trimStart);
      const nextDuration = Math.max(0.5, Math.min(maxDuration, durationSeconds || 1));

      return { ...item, durationSeconds: nextDuration };
    };

    setSceneLaunchMediaItems(previous => previous.map(updateItem));
    setSceneLaunchBeats(previous => previous.map(beat => ({
      ...beat,
      items: beat.items.map(updateItem),
    })));
  };

  const updateSceneLaunchMediaName = (mediaId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) return;

    const updateItem = (item: SceneLaunchMediaItem) => (
      item.id === mediaId
        ? { ...item, name: nextName }
        : item
    );

    const mediaItem = findSceneLaunchMediaItem(mediaId);
    if (mediaItem?.clipId) {
      updateClip(mediaItem.clipId, { name: nextName });
    }

    setSceneLaunchMediaItems(previous => previous.map(updateItem));
    setSceneLaunchBeats(previous => previous.map(beat => ({
      ...beat,
      items: beat.items.map(updateItem),
    })));
  };

  const updateSceneLaunchMediaOriginalDuration = (mediaId: string, originalDuration: number) => {
    const updateItem = (item: SceneLaunchMediaItem) => (
      item.id === mediaId
        ? {
            ...item,
            mediaDurationSeconds: originalDuration,
            durationSeconds: item.durationSeconds ?? originalDuration,
          }
        : item
    );

    setSceneLaunchMediaItems(previous => previous.map(updateItem));
    setSceneLaunchBeats(previous => previous.map(beat => ({
      ...beat,
      items: beat.items.map(updateItem),
    })));
  };

  const updateSceneLaunchMediaTrim = (mediaId: string, trimStartSeconds: number, durationSeconds: number) => {
    const updateItem = (item: SceneLaunchMediaItem) => {
      if (item.id === mediaId) {
        const sourceDuration = item.mediaDurationSeconds ?? Math.max(0.5, item.durationSeconds ?? durationSeconds ?? 0.5);
        const nextTrimStart = Math.max(0, Math.min(sourceDuration - 0.5, trimStartSeconds));
        const maxDuration = Math.max(0.5, sourceDuration - nextTrimStart);
        const nextDuration = Math.max(0.5, Math.min(maxDuration, durationSeconds));
        const updated = {
          ...item,
          trimStartSeconds: nextTrimStart,
          durationSeconds: nextDuration,
        };

        if (activeScene) {
          const correspondingClip = activeScene.clips.find(clip =>
            (item.clipId && clip.id === item.clipId) ||
            (clip.name === item.name && clip.type === 'video')
          );
          if (correspondingClip) {
            updateClip(correspondingClip.id, {
              trimStart: Math.round(nextTrimStart * 30),
              duration: Math.round(nextDuration * 30),
            });
          }
        }
        return updated;
      }
      return item;
    };

    setSceneLaunchMediaItems(previous => previous.map(updateItem));
    setSceneLaunchBeats(previous => previous.map(beat => ({
      ...beat,
      items: beat.items.map(updateItem),
    })));
  };

  const handleItemContextMenu = (event: React.MouseEvent, dragKey: string) => {
    event.preventDefault();
    setSceneLaunchContextMenu({
      type: 'item',
      x: event.clientX,
      y: event.clientY,
      dragKey,
    });
  };

  return {
    sceneLaunchMediaItems,
    setSceneLaunchBeats,
    sceneLaunchBeats,
    sceneLaunchGridOrder,
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
    updateSceneLaunchMediaName,
    updateSceneLaunchMediaOriginalDuration,
    updateSceneLaunchMediaTrim,
    handleItemContextMenu,
    moveSceneLaunchItemToTargetCollection,
  };
}
