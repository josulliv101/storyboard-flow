import React from 'react';
import {
  type SceneLaunchMediaItem,
  type SceneLaunchPreviewWheelV3Sizing,
  type SceneLaunchPreviewWheelV3Effect,
  type PreviewWheelUtilityAction,
  type ReorderPreview,
} from './SceneLaunchPreviewWheelV3';

const DRAG_SELECT_THRESHOLD = 5;
const REORDER_LIFT_THRESHOLD = 24;
const DROP_SETTLE_DURATION_MS = 180;
const REORDER_LIFT_HOLD_MS = 200;
const REORDER_SHRINK_DURATION_MS = 180;
const PREPARED_PREVIEW_HANDOFF_MS = 900;
const REORDER_EDGE_ZONE_MAX_PX = 140;
const REORDER_AUTO_PAN_MAX_PX_PER_FRAME = 16;
const MOMENTUM_MIN_VELOCITY = 0.035;
const MOMENTUM_FRICTION_PER_FRAME = 0.945;
const SNAP_DURATION_MS = 420;
const FAST_NAVIGATION_ENTER_VELOCITY = 0.9;
const FAST_NAVIGATION_EXIT_VELOCITY = 0.45;
const FAST_NAVIGATION_IDLE_RESET_MS = 120;

const clamp = (value: number, min: number, max: number) => (
  Math.max(min, Math.min(max, value))
);

const getNearestIndexForOffset = (offset: number, centerPositions: number[]) => {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  centerPositions.forEach((position, index) => {
    const distance = Math.abs(position + offset);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
};

export type PreviewWheelDragState = {
  isDragging: boolean;
  startX: number;
  startY: number;
  startOffset: number;
  lastX: number;
  lastTime: number;
  pointerId: number;
  didMove: boolean;
  velocity: number;
  targetMediaId: string | null;
  mode: 'pending' | 'wheel' | 'reorder';
  lastReorderTarget: string | null;
  reorderTargetMediaId: string | null;
  reorderPosition: 'before' | 'after' | 'inside' | null;
  utilityAction: PreviewWheelUtilityAction | null;
};

export interface UsePreviewWheelDragDropProps {
  items: SceneLaunchMediaItem[];
  disabledItemIds: string[];
  itemSequences?: Record<string, SceneLaunchMediaItem[]>;
  selectedMediaId: string;
  sizing: SceneLaunchPreviewWheelV3Sizing;
  durationScale: number;
  effect: SceneLaunchPreviewWheelV3Effect;
  hidePreview: boolean;
  viewportSize: { width: number; height: number };
  gridView: boolean;
  customChunks?: SceneLaunchMediaItem[][];
  breakoutTitles?: string[];
  breakoutIsCollection?: boolean[];
  breakoutRepresentativeUrls?: (string | null)[];
  breakoutCollectionsEnabled?: boolean;
  breakoutNestingLevels?: number[];
  allCollections?: any[];
  getRecursiveMediaItems?: (collection: any) => any[];
  thumbnailSize: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showRuler: boolean;
  subRowIndex: number;
  nestingLevel: number;
  gridNestingLevels: number[];
  rowIndex: number;
  gridDisplayPanelHeight: number;
  gridColumnCount?: number;
  
  offset: number;
  setOffset: (offset: number) => void;
  offsetRef: React.MutableRefObject<number>;
  playheadX: number;
  renderedPlayheadX: number;
  playheadPositionRatio: number;
  setPlayheadPositionRatio: (ratio: number) => void;
  setGridPlayheadRatio: (ratio: number | null) => void;
  onCenteredMediaChange: (mediaId: string) => void;
  onCollectionOpen?: (representativeMediaId: string) => void;
  onItemsReorder?: (draggedMediaId: string, targetMediaId: string, position: 'before' | 'after') => void;
  onItemMoveIntoCollection?: (draggedMediaId: string, targetCollectionMediaId: string) => void;
  onUtilityDrop?: (action: PreviewWheelUtilityAction, draggedMediaId: string) => void;
  selectReorderedItem?: boolean;
  slideOnClick?: boolean;
  selectItemsWhilePreviewHidden?: boolean;
  syncPreviewToPlayhead?: boolean;
  onScrubUpdateRef: React.MutableRefObject<((mediaId: string | null, sourceTimeSeconds: number | null, timelineTimeSeconds?: number | null) => void) | undefined>;
  resolveItemSnapshot: (item: SceneLaunchMediaItem, elapsedSeconds: number) => { media: SceneLaunchMediaItem; sourceTimeSeconds: number };
  playbackTimeRef: React.MutableRefObject<number>;
  preparedPreviewMediaIdRef: React.MutableRefObject<string | null>;
  preparedPreviewHandoffTimeoutRef: React.MutableRefObject<number | null>;
  setPreparedPreviewMediaId: (mediaId: string | null) => void;
  setPreparedPreviewReady: (ready: boolean) => void;
  setVisiblePreparedPreviewMediaId: (mediaId: string | null) => void;
  setDirectPreviewMediaId: (mediaId: string | null) => void;
  setTrimOverlayMediaId: (mediaId: string | null) => void;
  isPreviewPlaying: boolean;

  viewportRef: React.RefObject<HTMLDivElement | null>;
  reorderGhostRef: React.RefObject<HTMLDivElement | null>;
  reorderGhostContentRef: React.RefObject<HTMLDivElement | null>;

  isGallery: boolean;
  uniformItemWidth: number;
  itemDurations: number[];
  itemWidths: number[];
  isGaplessGallery: boolean;
  itemGap: number;
  itemStartTimes: number[];
  totalDurationSeconds: number;
  itemCenterPositions: number[];
  itemStartPixels: number[];
  selectedIndex: number;
  childGridItemWidth: number;
  verticalLineX: number;
  indentOffset: number;
  maxOffset: number;
  minOffset: number;
  timelineOriginOffset: number;
  stripEndPixel: number;
  finalIndex: number;
  gridLeftAlignOffset: number;
  snapReferencePositions: number[];
  collectionItemIds: string[];
  reorderPreview: ReorderPreview | null;
  setReorderPreview: (preview: ReorderPreview | null) => void;
  reorderPreviewOrder: string[] | null;
  setReorderPreviewOrder: (order: string[] | null) => void;
  freeDrag: boolean;
  dragRef: React.MutableRefObject<PreviewWheelDragState>;
  clickGuardRef: React.MutableRefObject<boolean>;
}

export function usePreviewWheelDragDrop({
  items,
  disabledItemIds,
  itemSequences,
  selectedMediaId,
  sizing,
  durationScale,
  effect,
  hidePreview,
  viewportSize,
  gridView,
  customChunks,
  breakoutTitles,
  breakoutIsCollection,
  breakoutRepresentativeUrls,
  breakoutCollectionsEnabled,
  breakoutNestingLevels,
  allCollections,
  getRecursiveMediaItems,
  thumbnailSize,
  showRuler,
  subRowIndex,
  nestingLevel,
  gridNestingLevels,
  rowIndex,
  gridDisplayPanelHeight,
  gridColumnCount,
  offset,
  setOffset,
  offsetRef,
  playheadX,
  renderedPlayheadX,
  playheadPositionRatio,
  setPlayheadPositionRatio,
  setGridPlayheadRatio,
  onCenteredMediaChange,
  onCollectionOpen,
  onItemsReorder,
  onItemMoveIntoCollection,
  onUtilityDrop,
  selectReorderedItem = true,
  slideOnClick = true,
  selectItemsWhilePreviewHidden = false,
  syncPreviewToPlayhead = false,
  onScrubUpdateRef,
  resolveItemSnapshot,
  playbackTimeRef,
  preparedPreviewMediaIdRef,
  preparedPreviewHandoffTimeoutRef,
  setPreparedPreviewMediaId,
  setPreparedPreviewReady,
  setVisiblePreparedPreviewMediaId,
  setDirectPreviewMediaId,
  setTrimOverlayMediaId,
  isPreviewPlaying,
  viewportRef,
  reorderGhostRef,
  reorderGhostContentRef,
  isGallery,
  uniformItemWidth,
  itemDurations,
  itemWidths,
  isGaplessGallery,
  itemGap,
  itemStartTimes,
  totalDurationSeconds,
  itemCenterPositions,
  itemStartPixels,
  selectedIndex,
  childGridItemWidth,
  verticalLineX,
  indentOffset,
  maxOffset,
  minOffset,
  timelineOriginOffset,
  stripEndPixel,
  finalIndex,
  gridLeftAlignOffset,
  snapReferencePositions,
  collectionItemIds,
  reorderPreview,
  setReorderPreview,
  reorderPreviewOrder,
  setReorderPreviewOrder,
  freeDrag,
  dragRef,
  clickGuardRef,
}: UsePreviewWheelDragDropProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const [collectionDropTargetId, setCollectionDropTargetId] = React.useState<string | null>(null);
  const [utilityDropTarget, setUtilityDropTarget] = React.useState<PreviewWheelUtilityAction | null>(null);
  const [isSpinning, setIsSpinning] = React.useState(false);
  const [isSnapping, setIsSnapping] = React.useState(false);
  const clickGuardTimeoutRef = React.useRef<number | null>(null);
  const momentumFrameRef = React.useRef<number | null>(null);
  const snapFrameRef = React.useRef<number | null>(null);
  const dragFrameRef = React.useRef<number | null>(null);
  const pendingDragOffsetRef = React.useRef<number | null>(null);
  const dropSettleTimeoutRef = React.useRef<number | null>(null);
  const pendingReorderSelectionRef = React.useRef<string | null>(null);
  const skipNextReorderAlignmentRef = React.useRef(false);
  const skipNextSelectedAlignmentRef = React.useRef(false);
  const snapCompletionRef = React.useRef<{ mediaId: string; finish: () => void } | null>(null);
  const reorderAutoPanFrameRef = React.useRef<number | null>(null);
  const reorderPointerRef = React.useRef({ clientX: 0, clientY: 0 });
  const reorderPreviewOrderRef = React.useRef<string[] | null>(null);
  const fastNavigationRef = React.useRef(false);
  const fastNavigationIdleTimeoutRef = React.useRef<number | null>(null);

  const updateFastNavigation = React.useCallback((velocity: number) => {
    const speed = Math.abs(velocity);
    const nextFastNavigation = fastNavigationRef.current
      ? speed > FAST_NAVIGATION_EXIT_VELOCITY
      : speed >= FAST_NAVIGATION_ENTER_VELOCITY;

    if (nextFastNavigation === fastNavigationRef.current) return;
    fastNavigationRef.current = nextFastNavigation;
  }, []);

  React.useEffect(() => () => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
    }
    if (momentumFrameRef.current !== null) {
      window.cancelAnimationFrame(momentumFrameRef.current);
    }
    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
    }
    if (clickGuardTimeoutRef.current !== null) {
      window.clearTimeout(clickGuardTimeoutRef.current);
    }
    if (fastNavigationIdleTimeoutRef.current !== null) {
      window.clearTimeout(fastNavigationIdleTimeoutRef.current);
    }
    if (dropSettleTimeoutRef.current !== null) {
      window.clearTimeout(dropSettleTimeoutRef.current);
    }
    if (reorderAutoPanFrameRef.current !== null) {
      window.cancelAnimationFrame(reorderAutoPanFrameRef.current);
    }
    if (preparedPreviewHandoffTimeoutRef.current !== null) {
      window.clearTimeout(preparedPreviewHandoffTimeoutRef.current);
    }
  }, [preparedPreviewHandoffTimeoutRef]);


  const stopAnimation = React.useCallback(() => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingDragOffsetRef.current = null;
    if (fastNavigationIdleTimeoutRef.current !== null) {
      window.clearTimeout(fastNavigationIdleTimeoutRef.current);
      fastNavigationIdleTimeoutRef.current = null;
    }
    updateFastNavigation(0);
    if (momentumFrameRef.current !== null) {
      window.cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = null;
    }
    snapCompletionRef.current = null;
    setIsSpinning(false);
    setIsSnapping(false);
  }, [updateFastNavigation]);

  const clearClickGuardSoon = React.useCallback(() => {
    if (clickGuardTimeoutRef.current !== null) {
      window.clearTimeout(clickGuardTimeoutRef.current);
    }
    clickGuardTimeoutRef.current = window.setTimeout(() => {
      clickGuardRef.current = false;
      clickGuardTimeoutRef.current = null;
    }, 140);
  }, []);

  const getCenteredMediaIdForOrder = React.useCallback((order: string[]) => {
    const firstItemIndex = items.findIndex(item => item.id === order[0]);
    const durationOrigin = (itemWidths[firstItemIndex] ?? uniformItemWidth) / 2;
    let cursor = 0;
    let nearestMediaId: string | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    order.forEach((mediaId, orderIndex) => {
      const itemIndex = items.findIndex(item => item.id === mediaId);
      const width = itemWidths[itemIndex] ?? uniformItemWidth;
      const referencePosition = (sizing === 'duration' || isGallery)
        ? cursor - durationOrigin
        : cursor + width / 2;
      const distance = Math.abs(referencePosition + offsetRef.current);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestMediaId = mediaId;
      }
      cursor += width + (orderIndex < order.length - 1 ? itemGap : 0);
    });

    return nearestMediaId;
  }, [itemGap, itemWidths, items, sizing, uniformItemWidth, offsetRef]);

  const prepareFixedCenterPreview = React.useCallback((order: string[]) => {
    if (selectReorderedItem) return;
    const mediaId = getCenteredMediaIdForOrder(order);
    if (!mediaId || mediaId === preparedPreviewMediaIdRef.current) return;

    preparedPreviewMediaIdRef.current = mediaId;
    setPreparedPreviewMediaId(mediaId);
    setPreparedPreviewReady(false);
    setVisiblePreparedPreviewMediaId(null);
  }, [getCenteredMediaIdForOrder, selectReorderedItem, preparedPreviewMediaIdRef, setPreparedPreviewMediaId, setPreparedPreviewReady, setVisiblePreparedPreviewMediaId]);

  const updateReorderTarget = React.useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (drag.mode !== 'reorder' || !drag.targetMediaId) return;

    const candidates = Array.from(
      viewportRef.current?.querySelectorAll<HTMLElement>('[data-preview-wheel-item-id]') ?? [],
    ).filter(element => element.dataset.previewWheelItemId !== drag.targetMediaId);
    const target = candidates.reduce<{ element: HTMLElement; distance: number } | null>((nearest, element) => {
      const bounds = element.getBoundingClientRect();
      const distance = Math.abs(clientX - (bounds.left + bounds.width / 2));
      return !nearest || distance < nearest.distance ? { element, distance } : nearest;
    }, null);
    const targetMediaId = target?.element.dataset.previewWheelItemId;
    if (!target || !targetMediaId) return;

    const bounds = target.element.getBoundingClientRect();
    const isCollectionTarget = collectionItemIds.includes(targetMediaId);
    const isInsideTarget = isCollectionTarget &&
      clientX >= bounds.left + bounds.width * 0.25 &&
      clientX <= bounds.right - bounds.width * 0.25 &&
      clientY >= bounds.top - 24 &&
      clientY <= bounds.bottom + 24;
    if (isInsideTarget) {
      const reorderTarget = `${targetMediaId}:inside`;
      if (drag.lastReorderTarget === reorderTarget) return;
      drag.lastReorderTarget = reorderTarget;
      drag.reorderTargetMediaId = targetMediaId;
      drag.reorderPosition = 'inside';
      setCollectionDropTargetId(targetMediaId);
      const initialOrder = items.map(item => item.id);
      reorderPreviewOrderRef.current = initialOrder;
      setReorderPreviewOrder(initialOrder);
      return;
    }

    setCollectionDropTargetId(null);
    const position = clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
    const reorderTarget = `${targetMediaId}:${position}`;
    if (drag.lastReorderTarget === reorderTarget) return;

    drag.lastReorderTarget = reorderTarget;
    drag.reorderTargetMediaId = targetMediaId;
    drag.reorderPosition = position;
    const next = [...(reorderPreviewOrderRef.current ?? items.map(item => item.id))];
    const draggedIndex = next.indexOf(drag.targetMediaId);
    if (draggedIndex >= 0) next.splice(draggedIndex, 1);
    const targetIndex = next.indexOf(targetMediaId);
    if (targetIndex < 0) return;
    next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, drag.targetMediaId);
    reorderPreviewOrderRef.current = next;
    prepareFixedCenterPreview(next);
    setReorderPreviewOrder(next);
  }, [collectionItemIds, items, prepareFixedCenterPreview, viewportRef, reorderPreviewOrderRef]);

  const startReorderAutoPan = React.useCallback(() => {
    if (reorderAutoPanFrameRef.current !== null) return;
    let previousTime = performance.now();
    let previousHitTestTime = 0;

    const step = (time: number) => {
      const drag = dragRef.current;
      const viewport = viewportRef.current;
      if (drag.mode !== 'reorder' || !viewport) {
        reorderAutoPanFrameRef.current = null;
        return;
      }

      const deltaFrames = Math.min(2, Math.max(0.25, (time - previousTime) / 16.67));
      previousTime = time;
      const bounds = viewport.getBoundingClientRect();
      const edgeZone = Math.min(REORDER_EDGE_ZONE_MAX_PX, bounds.width * 0.18);
      const pointerX = reorderPointerRef.current.clientX;
      const leftStrength = clamp((bounds.left + edgeZone - pointerX) / edgeZone, 0, 1);
      const rightStrength = clamp((pointerX - (bounds.right - edgeZone)) / edgeZone, 0, 1);
      const panDelta = (
        leftStrength * leftStrength - rightStrength * rightStrength
      ) * REORDER_AUTO_PAN_MAX_PX_PER_FRAME * deltaFrames;

      if (Math.abs(panDelta) > 0.01) {
        const previousOffset = offsetRef.current;
        setOffset(previousOffset + panDelta);
        if (offsetRef.current !== previousOffset && time - previousHitTestTime >= 48) {
          previousHitTestTime = time;
          updateReorderTarget(pointerX, reorderPointerRef.current.clientY);
          const previewOrder = reorderPreviewOrderRef.current;
          if (previewOrder) prepareFixedCenterPreview(previewOrder);
        }
      }

      reorderAutoPanFrameRef.current = window.requestAnimationFrame(step);
    };

    reorderAutoPanFrameRef.current = window.requestAnimationFrame(step);
  }, [prepareFixedCenterPreview, setOffset, updateReorderTarget, viewportRef, offsetRef]);

  const snapToIndex = React.useCallback((
    index: number,
    {
      commit = true,
      scrubPreview = false,
      deferPreview = false,
    }: {
      commit?: boolean;
      scrubPreview?: boolean;
      deferPreview?: boolean;
    } = {},
  ) => {
    const boundedIndex = clamp(index, 0, Math.max(0, items.length - 1));
    const targetItem = items[boundedIndex];
    if (!scrubPreview && !deferPreview) {
      updateFastNavigation(0);
      setDirectPreviewMediaId(targetItem?.id ?? null);
      playbackTimeRef.current = itemStartTimes[boundedIndex] ?? 0;
    }
    const targetOffset = clamp(
      (sizing === 'duration' || isGallery)
        ? timelineOriginOffset - (itemStartPixels[boundedIndex] ?? 0)
        : -(itemCenterPositions[boundedIndex] ?? 0),
      minOffset,
      maxOffset,
    );
    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = null;
    }

    setIsSpinning(true);
    setIsSnapping(true);
    let didFinish = false;
    const finish = () => {
      if (didFinish) return;
      didFinish = true;
      if (snapFrameRef.current !== null) {
        window.cancelAnimationFrame(snapFrameRef.current);
        snapFrameRef.current = null;
      }
      snapCompletionRef.current = null;
      setIsSpinning(false);
      setIsSnapping(false);
      if (commit) {
        if (deferPreview) {
          setDirectPreviewMediaId(targetItem?.id ?? null);
          if (targetItem?.id === preparedPreviewMediaIdRef.current) {
            setVisiblePreparedPreviewMediaId(targetItem.id);
            if (preparedPreviewHandoffTimeoutRef.current !== null) {
              window.clearTimeout(preparedPreviewHandoffTimeoutRef.current);
            }
            preparedPreviewHandoffTimeoutRef.current = window.setTimeout(() => {
              preparedPreviewHandoffTimeoutRef.current = null;
              preparedPreviewMediaIdRef.current = null;
              setVisiblePreparedPreviewMediaId(null);
              setPreparedPreviewMediaId(null);
            }, PREPARED_PREVIEW_HANDOFF_MS);
          }
        }
        if (targetItem && targetItem.id !== selectedMediaId) {
          setTrimOverlayMediaId(null);
          onCenteredMediaChange(targetItem.id);
        }
      }
    };
    if (targetItem) snapCompletionRef.current = { mediaId: targetItem.id, finish };
    snapFrameRef.current = window.requestAnimationFrame(() => {
      setOffset(targetOffset);
      const transitionStart = performance.now();
      const finishAfterTransition = (time: number) => {
        if (time - transitionStart < SNAP_DURATION_MS + 80) {
          snapFrameRef.current = window.requestAnimationFrame(finishAfterTransition);
          return;
        }
        finish();
      };
      snapFrameRef.current = window.requestAnimationFrame(finishAfterTransition);
    });
  }, [itemCenterPositions, itemStartPixels, items, maxOffset, minOffset, onCenteredMediaChange, selectedMediaId, setOffset, sizing, timelineOriginOffset, updateFastNavigation, playbackTimeRef, preparedPreviewMediaIdRef, setPreparedPreviewMediaId, setPreparedPreviewReady, setVisiblePreparedPreviewMediaId, setDirectPreviewMediaId, setTrimOverlayMediaId]);

  const snapToNearest = React.useCallback(() => {
    snapToIndex(
      getNearestIndexForOffset(offsetRef.current, snapReferencePositions),
      { scrubPreview: true },
    );
  }, [snapReferencePositions, snapToIndex, offsetRef]);

  const snapToGridLeftAlign = React.useCallback(() => {
    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = null;
    }
    setIsSpinning(true);
    setIsSnapping(true);
    let didFinish = false;
    const finish = () => {
      if (didFinish) return;
      didFinish = true;
      setIsSpinning(false);
      setIsSnapping(false);
    };
    snapCompletionRef.current = {
      mediaId: items[0]?.id ?? 'grid-left',
      finish,
    };
    setOffset(gridLeftAlignOffset);
  }, [gridLeftAlignOffset, setOffset, items]);

  const alignItemToOffset = React.useCallback((targetIndex: number, targetOffset: number, progress: number) => {
    const boundedOffset = clamp(targetOffset, minOffset, maxOffset);
    const targetItem = items[targetIndex];
    if (!targetItem) return;

    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = null;
    }

    setIsSpinning(true);
    setIsSnapping(true);
    let didFinish = false;
    const finish = () => {
      if (didFinish) return;
      didFinish = true;
      if (snapFrameRef.current !== null) {
        window.cancelAnimationFrame(snapFrameRef.current);
        snapFrameRef.current = null;
      }
      snapCompletionRef.current = null;
      setIsSpinning(false);
      setIsSnapping(false);
      
      skipNextSelectedAlignmentRef.current = true;
      if (targetItem.id !== selectedMediaId) {
        setTrimOverlayMediaId(null);
        onCenteredMediaChange(targetItem.id);
      }
    };

    if (targetItem) snapCompletionRef.current = { mediaId: targetItem.id, finish };
    setDirectPreviewMediaId(targetItem.id);
    const itemDuration = itemDurations[targetIndex] ?? 0.5;
    playbackTimeRef.current = (itemStartTimes[targetIndex] ?? 0) + progress * itemDuration;

    snapFrameRef.current = window.requestAnimationFrame(() => {
      setOffset(boundedOffset);
      const transitionStart = performance.now();
      const finishAfterTransition = (time: number) => {
        if (time - transitionStart < SNAP_DURATION_MS + 80) {
          snapFrameRef.current = window.requestAnimationFrame(finishAfterTransition);
          return;
        }
        finish();
      };
      snapFrameRef.current = window.requestAnimationFrame(finishAfterTransition);
    });
  }, [items, minOffset, maxOffset, selectedMediaId, setOffset, onCenteredMediaChange, itemDurations, itemStartTimes, playbackTimeRef, setDirectPreviewMediaId, setTrimOverlayMediaId]);

  const spinWithMomentum = React.useCallback((initialVelocity: number, snapWhenStopped = true) => {
    if (Math.abs(initialVelocity) < MOMENTUM_MIN_VELOCITY) {
      if (snapWhenStopped) {
        snapToNearest();
      } else {
        setIsSpinning(false);
        updateFastNavigation(0);
      }
      return;
    }

    let velocity = initialVelocity;
    let previousTime = performance.now();
    setIsSpinning(true);

    const step = (time: number) => {
      const deltaMs = Math.min(34, time - previousTime);
      previousTime = time;
      const nextOffset = offsetRef.current + velocity * deltaMs;
      const boundedOffset = clamp(nextOffset, minOffset, maxOffset);
      setOffset(boundedOffset);
      updateFastNavigation(velocity);

      const hitBounds = boundedOffset !== nextOffset;
      velocity *= Math.pow(MOMENTUM_FRICTION_PER_FRAME, deltaMs / 16.67);

      if (hitBounds || Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) {
        momentumFrameRef.current = null;
        updateFastNavigation(0);
        if (snapWhenStopped) {
          snapToNearest();
        } else {
          setIsSpinning(false);
        }
        return;
      }

      momentumFrameRef.current = window.requestAnimationFrame(step);
    };

    momentumFrameRef.current = window.requestAnimationFrame(step);
  }, [maxOffset, minOffset, setOffset, snapToNearest, updateFastNavigation, offsetRef]);

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    stopAnimation();
    if (preparedPreviewHandoffTimeoutRef.current !== null) {
      window.clearTimeout(preparedPreviewHandoffTimeoutRef.current);
      preparedPreviewHandoffTimeoutRef.current = null;
    }
    preparedPreviewMediaIdRef.current = null;
    setPreparedPreviewMediaId(null);
    setPreparedPreviewReady(false);
    setVisiblePreparedPreviewMediaId(null);
    const targetMediaId = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-preview-wheel-item-id]')
      ?.dataset.previewWheelItemId ?? null;

    dragRef.current = {
      isDragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offsetRef.current,
      lastX: event.clientX,
      lastTime: performance.now(),
      pointerId: event.pointerId,
      didMove: false,
      velocity: 0,
      targetMediaId,
      mode: 'pending',
      lastReorderTarget: null,
      reorderTargetMediaId: null,
      reorderPosition: null,
      utilityAction: null,
    };
    clickGuardRef.current = false;
    viewport.setPointerCapture(event.pointerId);
  }, [stopAnimation, viewportRef, offsetRef, preparedPreviewHandoffTimeoutRef, preparedPreviewMediaIdRef, setPreparedPreviewMediaId, setPreparedPreviewReady, setVisiblePreparedPreviewMediaId]);

  const moveDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.isDragging || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (
      drag.mode === 'pending' &&
      drag.targetMediaId &&
      onItemsReorder &&
      deltaY <= -REORDER_LIFT_THRESHOLD &&
      Math.abs(deltaY) > Math.abs(deltaX) * 1.1
    ) {
      const itemElement = viewportRef.current?.querySelector<HTMLElement>(
        `[data-preview-wheel-item-id="${CSS.escape(drag.targetMediaId)}"]`,
      );
      const bounds = itemElement?.getBoundingClientRect();
      const sourceWidth = bounds?.width ?? 240;
      const sourceHeight = bounds?.height ?? 135;
      const previewWidth = Math.min(sourceWidth * 0.72, clamp(sourceWidth * 0.55, 88, 180));
      const previewHeight = previewWidth * sourceHeight / Math.max(1, sourceWidth);
      drag.mode = 'reorder';
      drag.didMove = true;
      setIsDragging(true);
      clickGuardRef.current = true;
      updateFastNavigation(0);
      setReorderPreview({
        mediaId: drag.targetMediaId,
        clientX: event.clientX,
        clientY: event.clientY,
        width: previewWidth,
        height: previewHeight,
        liftScale: sourceWidth / previewWidth,
        trayX: bounds ? bounds.left + bounds.width / 2 : event.clientX,
        trayY: bounds ? bounds.top - 16 : event.clientY - sourceHeight / 2 - 16,
      });
      const initialOrder = items.map(item => item.id);
      setCollectionDropTargetId(null);
      reorderPreviewOrderRef.current = initialOrder;
      setReorderPreviewOrder(initialOrder);
      prepareFixedCenterPreview(initialOrder);
      reorderPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      startReorderAutoPan();
    } else if (drag.mode === 'pending' && Math.abs(deltaX) > DRAG_SELECT_THRESHOLD) {
      drag.mode = 'wheel';
      setIsDragging(true);
      setDirectPreviewMediaId(null);
    }

    if (drag.mode === 'reorder' && drag.targetMediaId && onItemsReorder) {
      reorderPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (reorderGhostRef.current) {
        reorderGhostRef.current.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0) translate(-50%, -50%) scale(1.03)`;
      }

      const utilityElement = Array.from(document.querySelectorAll<HTMLElement>('[data-wheel-utility-target]'))
        .find(element => {
          const bounds = element.getBoundingClientRect();
          return event.clientX >= bounds.left && event.clientX <= bounds.right &&
            event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        });
      const utilityAction = utilityElement?.dataset.wheelUtilityTarget as PreviewWheelUtilityAction | undefined;
      drag.utilityAction = utilityAction ?? null;
      setUtilityDropTarget(utilityAction ?? null);
      if (utilityAction) {
        setCollectionDropTargetId(null);
        event.preventDefault();
        return;
      }

      updateReorderTarget(event.clientX, event.clientY);
      event.preventDefault();
      return;
    }

    if (drag.mode !== 'wheel') return;
    const now = performance.now();
    const frameDeltaMs = Math.max(1, now - drag.lastTime);
    const instantVelocity = (event.clientX - drag.lastX) / frameDeltaMs;
    drag.velocity = drag.velocity * 0.72 + instantVelocity * 0.28;
    updateFastNavigation(drag.velocity);
    if (fastNavigationIdleTimeoutRef.current !== null) {
      window.clearTimeout(fastNavigationIdleTimeoutRef.current);
    }
    if (fastNavigationRef.current) {
      fastNavigationIdleTimeoutRef.current = window.setTimeout(() => {
        fastNavigationIdleTimeoutRef.current = null;
        updateFastNavigation(0);
      }, FAST_NAVIGATION_IDLE_RESET_MS);
    }
    drag.lastX = event.clientX;
    drag.lastTime = now;

    if (Math.abs(deltaX) > DRAG_SELECT_THRESHOLD) {
      drag.didMove = true;
      clickGuardRef.current = true;
    }

    pendingDragOffsetRef.current = drag.startOffset + deltaX;
    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const pendingOffset = pendingDragOffsetRef.current;
        pendingDragOffsetRef.current = null;
        if (pendingOffset !== null) {
          setOffset(pendingOffset);
          if (onScrubUpdateRef.current && items.length > 0) {
            const currentOffset = clamp(pendingOffset, minOffset, maxOffset);
            const playheadPixel = clamp(
              hidePreview
                ? renderedPlayheadX - playheadX - currentOffset + timelineOriginOffset
                : (sizing === 'duration' || isGallery) ? timelineOriginOffset - currentOffset : -currentOffset,
              0,
              stripEndPixel,
            );
            let scrubbedIdx = finalIndex;
            for (let idx = 0; idx < items.length; idx += 1) {
              const itemEndPx = (itemStartPixels[idx] ?? 0) + (itemWidths[idx] ?? 0);
              if (playheadPixel <= itemEndPx) {
                scrubbedIdx = idx;
                break;
              }
            }
            const media = items[scrubbedIdx];
            if (media && !disabledItemIds.includes(media.id)) {
              const itemStartPx = itemStartPixels[scrubbedIdx] ?? 0;
              const itemW = Math.max(1, itemWidths[scrubbedIdx] ?? 1);
              const progress = clamp((playheadPixel - itemStartPx) / itemW, 0, 1);
              const itemDur = itemDurations[scrubbedIdx] ?? 0.5;
              const resolved = resolveItemSnapshot(media, progress * itemDur);
              onScrubUpdateRef.current(
                resolved.media.id,
                resolved.sourceTimeSeconds,
                (itemStartTimes[scrubbedIdx] ?? 0) + progress * itemDur,
              );
            }
          }
        }
      });
    }
    event.preventDefault();
  }, [items, onItemsReorder, prepareFixedCenterPreview, setOffset, startReorderAutoPan, updateFastNavigation, updateReorderTarget, minOffset, maxOffset, sizing, isGallery, hidePreview, playheadX, renderedPlayheadX, timelineOriginOffset, stripEndPixel, finalIndex, itemStartPixels, itemStartTimes, itemWidths, itemDurations, disabledItemIds, resolveItemSnapshot, viewportRef, reorderGhostRef, onScrubUpdateRef, setDirectPreviewMediaId]);

  const endDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag.isDragging || drag.pointerId !== event.pointerId) return;

    if (reorderAutoPanFrameRef.current !== null) {
      window.cancelAnimationFrame(reorderAutoPanFrameRef.current);
      reorderAutoPanFrameRef.current = null;
    }

    if (fastNavigationIdleTimeoutRef.current !== null) {
      window.clearTimeout(fastNavigationIdleTimeoutRef.current);
      fastNavigationIdleTimeoutRef.current = null;
    }

    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const pendingOffset = pendingDragOffsetRef.current;
    pendingDragOffsetRef.current = null;
    if (pendingOffset !== null) setOffset(pendingOffset);

    dragRef.current = {
      isDragging: false,
      startX: 0,
      startY: 0,
      startOffset: 0,
      lastX: 0,
      lastTime: 0,
      pointerId: -1,
      didMove: false,
      velocity: 0,
      targetMediaId: null,
      mode: 'pending',
      lastReorderTarget: null,
      reorderTargetMediaId: null,
      reorderPosition: null,
      utilityAction: null,
    };
    setIsDragging(false);
    setCollectionDropTargetId(null);
    setUtilityDropTarget(null);
    if (drag.mode !== 'reorder') {
      setReorderPreview(null);
      setReorderPreviewOrder(null);
    }

    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }

    if (drag.mode === 'reorder') {
      if (drag.utilityAction && drag.targetMediaId) {
        onUtilityDrop?.(drag.utilityAction, drag.targetMediaId);
        reorderPreviewOrderRef.current = null;
        setReorderPreview(null);
        setReorderPreviewOrder(null);
        clickGuardRef.current = true;
        clearClickGuardSoon();
        return;
      }
      if (drag.targetMediaId && drag.reorderTargetMediaId && drag.reorderPosition) {
        if (selectReorderedItem) {
          preparedPreviewMediaIdRef.current = drag.targetMediaId;
          setPreparedPreviewMediaId(drag.targetMediaId);
          setPreparedPreviewReady(false);
          setVisiblePreparedPreviewMediaId(null);
        }
        const destinationMediaId = drag.reorderPosition === 'inside'
          ? drag.reorderTargetMediaId
          : drag.targetMediaId;
        const draggedElement = viewport?.querySelector<HTMLElement>(
          `[data-preview-wheel-item-id="${CSS.escape(destinationMediaId)}"]`,
        );
        const destinationBounds = draggedElement?.getBoundingClientRect();
        if (reorderGhostRef.current && destinationBounds) {
          reorderGhostRef.current.style.transition = `transform ${DROP_SETTLE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          reorderGhostRef.current.style.transform = `translate3d(${destinationBounds.left + destinationBounds.width / 2}px, ${destinationBounds.top + destinationBounds.height / 2}px, 0) translate(-50%, -50%) scale(1)`;
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && reorderPreview) {
            reorderGhostContentRef.current?.animate(
              [
                { transform: 'scale(1)' },
                { transform: `scale(${destinationBounds.width / reorderPreview.width})` },
              ],
              {
                duration: DROP_SETTLE_DURATION_MS,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'both',
              },
            );
          }
        }

        if (!selectReorderedItem) {
          const centeredMediaId = reorderPreviewOrderRef.current
            ? getCenteredMediaIdForOrder(reorderPreviewOrderRef.current)
            : null;
          if (centeredMediaId && centeredMediaId === preparedPreviewMediaIdRef.current) {
            setVisiblePreparedPreviewMediaId(centeredMediaId);
            if (preparedPreviewHandoffTimeoutRef.current !== null) {
              window.clearTimeout(preparedPreviewHandoffTimeoutRef.current);
            }
            preparedPreviewHandoffTimeoutRef.current = window.setTimeout(() => {
              preparedPreviewHandoffTimeoutRef.current = null;
              preparedPreviewMediaIdRef.current = null;
              setVisiblePreparedPreviewMediaId(null);
              setPreparedPreviewMediaId(null);
            }, PREPARED_PREVIEW_HANDOFF_MS);
          }
          if (centeredMediaId && centeredMediaId !== selectedMediaId) {
            skipNextSelectedAlignmentRef.current = true;
            setDirectPreviewMediaId(centeredMediaId);
            setTrimOverlayMediaId(null);
            onCenteredMediaChange(centeredMediaId);
          }
          skipNextReorderAlignmentRef.current = true;
          if (drag.reorderPosition === 'inside') {
            onItemMoveIntoCollection?.(drag.targetMediaId, drag.reorderTargetMediaId);
          } else {
            onItemsReorder?.(drag.targetMediaId, drag.reorderTargetMediaId, drag.reorderPosition);
          }
        }

        dropSettleTimeoutRef.current = window.setTimeout(() => {
          dropSettleTimeoutRef.current = null;
          if (selectReorderedItem) {
            pendingReorderSelectionRef.current = drag.targetMediaId;
            if (drag.reorderPosition === 'inside') {
              onItemMoveIntoCollection?.(drag.targetMediaId!, drag.reorderTargetMediaId!);
            } else {
              onItemsReorder?.(drag.targetMediaId!, drag.reorderTargetMediaId!, drag.reorderPosition!);
            }
          }
          reorderPreviewOrderRef.current = null;
          setReorderPreview(null);
          setReorderPreviewOrder(null);
        }, destinationBounds ? DROP_SETTLE_DURATION_MS : 0);
      } else {
        reorderPreviewOrderRef.current = null;
        setReorderPreview(null);
        setReorderPreviewOrder(null);
      }
      clickGuardRef.current = true;
      clearClickGuardSoon();
      return;
    }

    if (drag.didMove) {
      clickGuardRef.current = true;
      clearClickGuardSoon();
      if (hidePreview) {
        if (freeDrag) {
          spinWithMomentum(drag.velocity, false);
        } else {
          snapToGridLeftAlign();
        }
        return;
      }
      if (sizing === 'duration' || isGallery) {
        return;
      }
      spinWithMomentum(drag.velocity);
      return;
    }

    if (drag.targetMediaId) {
      const targetIndex = items.findIndex(item => item.id === drag.targetMediaId);
      if (targetIndex >= 0) {
        const targetItem = items[targetIndex];
        if (targetItem && collectionItemIds.includes(targetItem.id) && onCollectionOpen) {
          onCollectionOpen(targetItem.id);
        } else if (hidePreview) {
          if (selectItemsWhilePreviewHidden && targetItem) {
            if (syncPreviewToPlayhead) {
              const itemCenterPixel = (itemStartPixels[targetIndex] ?? 0) + (itemWidths[targetIndex] ?? 0) / 2;
              const itemScreenX = playheadX + offsetRef.current - timelineOriginOffset + itemCenterPixel;
              setGridPlayheadRatio(clamp(itemScreenX, 8, Math.max(8, viewportSize.width - 8)) / Math.max(1, viewportSize.width));
            }
            updateFastNavigation(0);
            setDirectPreviewMediaId(targetItem.id);
            playbackTimeRef.current = itemStartTimes[targetIndex] ?? 0;
            if (targetItem.id !== selectedMediaId) {
              skipNextSelectedAlignmentRef.current = true;
              setTrimOverlayMediaId(null);
            }
            onCenteredMediaChange(targetItem.id);
          }
          return;
        } else {
          if (slideOnClick) {
            snapToIndex(targetIndex);
          } else {
            if (targetItem) {
              updateFastNavigation(0);
              setDirectPreviewMediaId(targetItem.id);
              playbackTimeRef.current = itemStartTimes[targetIndex] ?? 0;
              if (targetItem.id !== selectedMediaId) {
                skipNextSelectedAlignmentRef.current = true;
                setTrimOverlayMediaId(null);
                onCenteredMediaChange(targetItem.id);
              }
            }
          }
        }
      }
    }
  }, [clearClickGuardSoon, collectionItemIds, freeDrag, getCenteredMediaIdForOrder, hidePreview, itemStartPixels, itemStartTimes, itemWidths, items, onCenteredMediaChange, onCollectionOpen, onItemMoveIntoCollection, onItemsReorder, onUtilityDrop, playheadX, reorderPreview, selectItemsWhilePreviewHidden, selectReorderedItem, selectedMediaId, setOffset, sizing, slideOnClick, snapToIndex, spinWithMomentum, snapToGridLeftAlign, syncPreviewToPlayhead, timelineOriginOffset, updateFastNavigation, viewportSize.width, viewportRef, reorderGhostRef, reorderGhostContentRef, reorderPreviewOrderRef, preparedPreviewHandoffTimeoutRef, preparedPreviewMediaIdRef, setPreparedPreviewMediaId, setPreparedPreviewReady, setVisiblePreparedPreviewMediaId, setDirectPreviewMediaId, setTrimOverlayMediaId, playbackTimeRef, skipNextSelectedAlignmentRef, skipNextReorderAlignmentRef, pendingReorderSelectionRef, offsetRef, setGridPlayheadRatio]);

  return {
    isDragging,
    reorderPreview,
    reorderPreviewOrder,
    collectionDropTargetId,
    utilityDropTarget,
    isSpinning,
    isSnapping,
    dragRef,
    clickGuardRef,
    clickGuardTimeoutRef,
    momentumFrameRef,
    snapFrameRef,
    dragFrameRef,
    pendingDragOffsetRef,
    dropSettleTimeoutRef,
    pendingReorderSelectionRef,
    skipNextReorderAlignmentRef,
    skipNextSelectedAlignmentRef,
    snapCompletionRef,
    reorderAutoPanFrameRef,
    reorderPointerRef,
    reorderPreviewOrderRef,
    
    beginDrag,
    moveDrag,
    endDrag,
    snapToIndex,
    snapToNearest,
    snapToGridLeftAlign,
    alignItemToOffset,
    spinWithMomentum,
    stopAnimation,
    clearClickGuardSoon,
    getCenteredMediaIdForOrder,
    prepareFixedCenterPreview,
    updateFastNavigation,
  };
}
