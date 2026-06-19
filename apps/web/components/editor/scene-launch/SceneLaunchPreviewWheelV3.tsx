import React from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { Clapperboard, Play, Pause, Repeat, AlignLeft, AlignCenter } from 'lucide-react';

import { cn } from '@/lib/utils';
import { VIDEO_PLACEHOLDER, type SceneLaunchMediaItem } from './useSceneLaunchBoard';

const ITEM_GAP = 24;
const DRAG_SELECT_THRESHOLD = 5;
const REORDER_LIFT_THRESHOLD = 24;
const DROP_SETTLE_DURATION_MS = 180;
const PREPARED_PREVIEW_HANDOFF_MS = 900;
const REORDER_EDGE_ZONE_MAX_PX = 140;
const REORDER_AUTO_PAN_MAX_PX_PER_FRAME = 16;
const MOMENTUM_MIN_VELOCITY = 0.035;
const MOMENTUM_FRICTION_PER_FRAME = 0.945;
const SNAP_DURATION_MS = 420;
const FAST_NAVIGATION_ENTER_VELOCITY = 0.9;
const FAST_NAVIGATION_EXIT_VELOCITY = 0.45;
const FAST_NAVIGATION_IDLE_RESET_MS = 120;
const MAX_WHEEL_ANGLE = 54;
const DURATION_REFERENCE_SECONDS = 3;
const MAX_IMAGE_DURATION_SECONDS = 60 * 60;
const GALLERY_ITEM_HEIGHT = 96;

type PreviewWheelDragState = {
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
  reorderPosition: 'before' | 'after' | null;
};

type ReorderPreview = {
  mediaId: string;
  clientX: number;
  clientY: number;
  width: number;
  height: number;
};

export type SceneLaunchPreviewWheelV3Effect = 'cylinder' | 'cylinder2' | 'coverflow' | 'gallery' | 'stack';
export type SceneLaunchPreviewWheelV3Sizing = 'uniform' | 'duration';

interface SceneLaunchPreviewWheelV3Props {
  items: SceneLaunchMediaItem[];
  selectedMediaId: string;
  effect: SceneLaunchPreviewWheelV3Effect;
  sizing: SceneLaunchPreviewWheelV3Sizing;
  durationScale: number;
  selectedItemDurationSeconds?: number;
  selectedItemTrimStartSeconds?: number;
  onSelectedItemDurationChange?: (durationSeconds: number, trimStartSeconds: number) => void;
  onSelectedItemDurationChangeEnd?: (durationSeconds: number, trimStartSeconds: number) => void;
  onCenteredMediaChange: (mediaId: string) => void;
  renderSelectedItemOverlay?: (item: SceneLaunchMediaItem) => React.ReactNode;
  renderGalleryTrimOverlay?: (item: SceneLaunchMediaItem) => React.ReactNode;
  isPreviewPlaying?: boolean;
  loopPreviewPlayback?: boolean;
  onPreviewPlaybackComplete?: () => void;
  onPlaybackMediaChange?: (mediaId: string) => void;
  onItemsReorder?: (draggedMediaId: string, targetMediaId: string, position: 'before' | 'after') => void;
  selectReorderedItem?: boolean;
  onTogglePlayback?: () => void;
  timelineCurrentTime?: number;
  onToggleLoop?: () => void;
}

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

const degreesToRadians = (value: number) => (
  value * Math.PI / 180
);

const formatRulerSeconds = (seconds: number) => (
  `${Number(seconds.toFixed(1))}s`
);

type GalleryScrubSnapshot = {
  media: SceneLaunchMediaItem;
  sourceTimeSeconds: number;
  timelineTimeSeconds: number;
};

function GalleryScrubPreview({
  snapshot,
  isPlaying = false,
  loopPlayback = false,
  onPlaybackComplete,
}: {
  snapshot: GalleryScrubSnapshot;
  isPlaying?: boolean;
  loopPlayback?: boolean;
  onPlaybackComplete?: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const targetTimeRef = React.useRef(snapshot.sourceTimeSeconds);
  const isSeekingRef = React.useRef(false);

  const seekToLatestTarget = React.useCallback((video: HTMLVideoElement) => {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const maximumTime = Number.isFinite(video.duration)
      ? Math.max(0, video.duration - 0.001)
      : targetTimeRef.current;
    const targetTime = clamp(targetTimeRef.current, 0, maximumTime);
    if (Math.abs(video.currentTime - targetTime) <= 0.001) {
      isSeekingRef.current = false;
      return;
    }

    isSeekingRef.current = true;
    video.currentTime = targetTime;
  }, []);

  React.useLayoutEffect(() => {
    targetTimeRef.current = snapshot.sourceTimeSeconds;
    if (snapshot.media.type !== 'video') {
      videoRef.current?.pause();
      return;
    }
    if (isPlaying) return;
    const video = videoRef.current;
    if (video && !isSeekingRef.current) seekToLatestTarget(video);
  }, [isPlaying, seekToLatestTarget, snapshot.media.type, snapshot.sourceTimeSeconds]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isPlaying || snapshot.media.type !== 'video') {
      video.pause();
      return;
    }

    seekToLatestTarget(video);
    void video.play().catch(() => undefined);
  }, [isPlaying, seekToLatestTarget, snapshot.media.id, snapshot.media.type]);

  const handleLoadedMetadata = React.useCallback(() => {
    const video = videoRef.current;
    if (!video || snapshot.media.type !== 'video') return;
    seekToLatestTarget(video);
    if (isPlaying) void video.play().catch(() => undefined);
  }, [isPlaying, seekToLatestTarget, snapshot.media.type]);

  const handleSeeked = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    isSeekingRef.current = false;
    if (Math.abs(video.currentTime - targetTimeRef.current) > 0.001) {
      seekToLatestTarget(video);
      return;
    }
    if (isPlaying && video.paused) void video.play().catch(() => undefined);
  }, [isPlaying, seekToLatestTarget]);

  const handleTimeUpdate = React.useCallback(() => {
    const video = videoRef.current;
    if (!video || snapshot.media.type !== 'video') return;
    const playbackStart = Math.max(0, snapshot.media.trimStartSeconds ?? 0);
    const playbackEnd = playbackStart + Math.max(0.5, snapshot.media.durationSeconds ?? 3);
    if (video.currentTime < playbackEnd - 0.02) return;

    if (loopPlayback) {
      video.currentTime = playbackStart;
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
    onPlaybackComplete?.();
  }, [loopPlayback, onPlaybackComplete, snapshot.media]);

  return (
    <div
      role="img"
      aria-label={`${snapshot.media.name} scrub preview`}
      className="relative h-full w-full overflow-hidden rounded-md bg-black"
    >
      <video
        ref={videoRef}
        src={snapshot.media.type === 'video' ? snapshot.media.previewUrl : undefined}
        preload="auto"
        muted={!isPlaying}
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onSeeked={handleSeeked}
        onTimeUpdate={handleTimeUpdate}
        className={cn(
          "h-full w-full object-contain",
          snapshot.media.type !== 'video' && "hidden",
        )}
      />
      {snapshot.media.type === 'image' && (
        <Image
          src={snapshot.media.previewUrl}
          alt=""
          fill
          sizes="288px"
          unoptimized
          className="object-contain"
        />
      )}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 font-mono text-[10px] text-zinc-200 backdrop-blur-sm">
        {formatRulerSeconds(snapshot.timelineTimeSeconds)}
      </div>
    </div>
  );
}

function PreparedGalleryPreview({
  media,
  onReady,
}: {
  media: SceneLaunchMediaItem;
  onReady: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  if (media.type === 'image') {
    return (
      <Image
        src={media.previewUrl}
        alt=""
        fill
        sizes="288px"
        unoptimized
        onLoad={onReady}
        className="object-contain"
      />
    );
  }

  const prepareFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    const targetTime = Math.max(0, media.trimStartSeconds ?? 0);
    if (targetTime <= 0.001 || Math.abs(video.currentTime - targetTime) <= 0.001) {
      onReady();
      return;
    }
    video.currentTime = Math.min(targetTime, Math.max(0, video.duration - 0.001));
  };

  return (
    <video
      ref={videoRef}
      src={media.previewUrl}
      preload="auto"
      muted
      playsInline
      onLoadedData={prepareFrame}
      onSeeked={onReady}
      className="h-full w-full object-contain"
    />
  );
}

export function SceneLaunchPreviewWheelV3({
  items,
  selectedMediaId,
  effect,
  sizing,
  durationScale,
  selectedItemDurationSeconds,
  selectedItemTrimStartSeconds,
  onSelectedItemDurationChange,
  onSelectedItemDurationChangeEnd,
  onCenteredMediaChange,
  renderSelectedItemOverlay,
  renderGalleryTrimOverlay,
  isPreviewPlaying = false,
  loopPreviewPlayback = false,
  onPreviewPlaybackComplete,
  onPlaybackMediaChange,
  onItemsReorder,
  selectReorderedItem = true,
  onTogglePlayback,
  timelineCurrentTime = 0,
  onToggleLoop,
}: SceneLaunchPreviewWheelV3Props) {
  const containerResizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const viewportResizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);

  const containerRefCallback = React.useCallback((node: HTMLDivElement | null) => {
    if (containerResizeObserverRef.current) {
      containerResizeObserverRef.current.disconnect();
      containerResizeObserverRef.current = null;
    }

    if (node) {
      const updateSize = () => {
        const bounds = node.getBoundingClientRect();
        setViewportSize(prev => {
          const nextHeight = bounds.height || 520;
          if (prev.height === nextHeight) return prev;
          return { ...prev, height: nextHeight };
        });
      };
      updateSize();

      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(updateSize);
        observer.observe(node);
        containerResizeObserverRef.current = observer;
      }
    }
  }, []);

  const viewportRefCallback = React.useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;

    if (viewportResizeObserverRef.current) {
      viewportResizeObserverRef.current.disconnect();
      viewportResizeObserverRef.current = null;
    }

    if (node) {
      const updateSize = () => {
        const bounds = node.getBoundingClientRect();
        setViewportSize(prev => {
          const nextWidth = bounds.width || 960;
          if (prev.width === nextWidth) return prev;
          return { ...prev, width: nextWidth };
        });
      };
      updateSize();

      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(updateSize);
        observer.observe(node);
        viewportResizeObserverRef.current = observer;
      }
    }
  }, []);

  const galleryPreviewRef = React.useRef<HTMLDivElement | null>(null);
  const trimOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const reorderGhostRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<PreviewWheelDragState>({
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
  });
  const momentumFrameRef = React.useRef<number | null>(null);
  const snapFrameRef = React.useRef<number | null>(null);
  const clickGuardTimeoutRef = React.useRef<number | null>(null);
  const clickGuardRef = React.useRef(false);
  const offsetRef = React.useRef(0);
  const dragFrameRef = React.useRef<number | null>(null);
  const pendingDragOffsetRef = React.useRef<number | null>(null);
  const playbackFrameRef = React.useRef<number | null>(null);
  const playbackTimeRef = React.useRef(0);
  const playbackSelectedMediaIdRef = React.useRef<string | null>(selectedMediaId);
  const fastNavigationRef = React.useRef(false);
  const fastNavigationIdleTimeoutRef = React.useRef<number | null>(null);
  const dropSettleTimeoutRef = React.useRef<number | null>(null);
  const pendingReorderSelectionRef = React.useRef<string | null>(null);
  const skipNextReorderAlignmentRef = React.useRef(false);
  const skipNextSelectedAlignmentRef = React.useRef(false);
  const snapCompletionRef = React.useRef<{ mediaId: string; finish: () => void } | null>(null);
  const preparedPreviewMediaIdRef = React.useRef<string | null>(null);
  const preparedPreviewHandoffTimeoutRef = React.useRef<number | null>(null);
  const reorderAutoPanFrameRef = React.useRef<number | null>(null);
  const reorderPointerRef = React.useRef({ clientX: 0, clientY: 0 });
  const reorderPreviewOrderRef = React.useRef<string[] | null>(null);
  const [offset, setOffsetState] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isSpinning, setIsSpinning] = React.useState(false);
  const [isSnapping, setIsSnapping] = React.useState(false);
  const [isFastNavigating, setIsFastNavigating] = React.useState(false);
  const [reorderPreview, setReorderPreview] = React.useState<ReorderPreview | null>(null);
  const [reorderPreviewOrder, setReorderPreviewOrder] = React.useState<string[] | null>(null);
  const [preparedPreviewMediaId, setPreparedPreviewMediaId] = React.useState<string | null>(null);
  const [preparedPreviewReady, setPreparedPreviewReady] = React.useState(false);
  const [visiblePreparedPreviewMediaId, setVisiblePreparedPreviewMediaId] = React.useState<string | null>(null);
  const [directPreviewMediaId, setDirectPreviewMediaId] = React.useState<string | null>(selectedMediaId);
  const [trimOverlayMediaId, setTrimOverlayMediaId] = React.useState<string | null>(null);
  const [viewportSize, setViewportSize] = React.useState({ width: 960, height: 520 });
  const [playheadAlignment, setPlayheadAlignment] = React.useState<'center' | 'left'>('center');

  React.useEffect(() => {
    const saved = localStorage.getItem('scene-launch-playhead-alignment');
    if (saved === 'left' || saved === 'center') {
      setPlayheadAlignment(saved);
    }
  }, []);

  const togglePlayheadAlignment = React.useCallback(() => {
    setPlayheadAlignment(prev => {
      const next = prev === 'center' ? 'left' : 'center';
      localStorage.setItem('scene-launch-playhead-alignment', next);
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!trimOverlayMediaId) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !trimOverlayRef.current?.contains(target)) {
        setTrimOverlayMediaId(null);
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [trimOverlayMediaId]);

  const itemHeight = effect === 'gallery'
    ? GALLERY_ITEM_HEIGHT
    : Math.round(clamp(
        sizing === 'uniform'
          ? Math.min(viewportSize.height - 64, viewportSize.width * 0.72 * 9 / 16)
          : viewportSize.height - 64,
        220,
        620,
      ));
  const isGallery = effect === 'gallery';
  const rowHeight = isGallery
    ? itemHeight + 66
    : itemHeight + 36;
  const itemCenterY = isGallery
    ? rowHeight - 12 - itemHeight / 2
    : Math.max(
        itemHeight / 2 + 32,
        viewportSize.height - itemHeight / 2 - 24,
      );
  const rulerTop = isGallery
    ? 22
    : Math.max(2, itemCenterY - itemHeight / 2 - 28);
  const playheadOffsetFromCenter = isGallery && playheadAlignment === 'left'
    ? 96 - viewportSize.width / 2
    : 0;
  const galleryPreviewHeight = Math.max(0, Math.min(
    360,
    viewportSize.width * 9 / 16,
    viewportSize.height - rowHeight - 88,
  ));
  const galleryPreviewWidth = galleryPreviewHeight * 16 / 9;
  const uniformItemWidth = sizing === 'uniform'
    ? Math.round(itemHeight * 16 / 9)
    : Math.round(clamp(
        itemHeight * 1.6,
        320,
        Math.min(760, viewportSize.width * 0.72),
      ));
  const itemDurations = React.useMemo(() => items.map(item => Math.max(
    0.5,
    item.id === selectedMediaId && selectedItemDurationSeconds !== undefined
      ? selectedItemDurationSeconds
      : item.durationSeconds ?? 3,
  )), [items, selectedItemDurationSeconds, selectedMediaId]);
  const durationPixelsPerSecond = uniformItemWidth / DURATION_REFERENCE_SECONDS * durationScale;
  const itemWidths = React.useMemo(() => {
    if (sizing === 'uniform') {
      return items.map(() => uniformItemWidth);
    }

    return itemDurations.map(duration => duration * durationPixelsPerSecond);
  }, [durationPixelsPerSecond, itemDurations, items, sizing, uniformItemWidth]);
  const isGaplessGallery = effect === 'gallery' && sizing === 'duration';
  const itemGap = isGaplessGallery
    ? 0
    : ITEM_GAP * (sizing === 'duration' ? durationScale : 1);
  const itemStartTimes = React.useMemo(() => itemDurations.map((_, index) => (
    itemDurations.slice(0, index).reduce((sum, duration) => sum + duration, 0)
  )), [itemDurations]);
  const totalDurationSeconds = itemDurations.reduce((sum, duration) => sum + duration, 0);
  const rulerTickStep = React.useMemo(() => {
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return candidates.find(step => (
      step * durationPixelsPerSecond >= 52 && totalDurationSeconds / step <= 300
    )) ?? candidates[candidates.length - 1];
  }, [durationPixelsPerSecond, totalDurationSeconds]);
  const itemCenterPositions = React.useMemo(() => {
    const positions: number[] = [];
    let center = 0;
    itemWidths.forEach((width, index) => {
      if (index > 0) {
        center += itemWidths[index - 1] / 2 + itemGap + width / 2;
      }
      positions.push(center);
    });
    return positions;
  }, [itemGap, itemWidths]);
  const reorderItemCenterPositions = React.useMemo(() => {
    if (!reorderPreviewOrder) return null;

    const positions = new Map<string, number>();
    let center = 0;
    reorderPreviewOrder.forEach((mediaId, orderIndex) => {
      const itemIndex = items.findIndex(item => item.id === mediaId);
      const width = itemWidths[itemIndex] ?? uniformItemWidth;
      if (orderIndex > 0) {
        const previousId = reorderPreviewOrder[orderIndex - 1];
        const previousIndex = items.findIndex(item => item.id === previousId);
        const previousWidth = itemWidths[previousIndex] ?? uniformItemWidth;
        center += previousWidth / 2 + itemGap + width / 2;
      }
      positions.set(mediaId, center);
    });
    return positions;
  }, [itemGap, itemWidths, items, reorderPreviewOrder, uniformItemWidth]);
  const itemStartPixels = React.useMemo(() => {
    const firstItemHalfWidth = (itemWidths[0] ?? 0) / 2;
    return itemWidths.map((width, index) => (
      (itemCenterPositions[index] ?? 0) + firstItemHalfWidth - width / 2
    ));
  }, [itemCenterPositions, itemWidths]);
  const selectedIndex = React.useMemo(() => (
    items.findIndex(item => item.id === selectedMediaId)
  ), [items, selectedMediaId]);
  const selectedItemType = items[selectedIndex]?.type;
  const itemStride = uniformItemWidth + itemGap;
  const finalIndex = items.length - 1;
  const finalCenterOffset = -(itemCenterPositions[finalIndex] ?? 0);
  const stripEndPixel = (itemStartPixels[finalIndex] ?? 0) + (itemWidths[finalIndex] ?? 0);
  const timelineOriginOffset = (itemWidths[0] ?? 0) / 2;
  const selectedScrubOriginOffset = selectedIndex >= 0
    ? (itemStartPixels[selectedIndex] ?? 0) - (itemCenterPositions[selectedIndex] ?? 0)
    : 0;
  const maxOffset = (sizing === 'duration' || isGallery)
    ? timelineOriginOffset
    : Math.max(0, selectedScrubOriginOffset);
  const minOffset = (sizing === 'duration' || isGallery)
    ? timelineOriginOffset - stripEndPixel
    : Math.min(finalCenterOffset, selectedScrubOriginOffset - stripEndPixel);
  const snapReferencePositions = React.useMemo(() => (
    (sizing === 'duration' || isGallery)
      ? itemStartPixels.map(startPixel => startPixel - timelineOriginOffset)
      : itemCenterPositions
  ), [itemCenterPositions, itemStartPixels, sizing, isGallery, timelineOriginOffset]);
  const centeredIndex = getNearestIndexForOffset(offset, snapReferencePositions);
  const centeredItem = items[centeredIndex] ?? null;
  const preparedPreviewMedia = preparedPreviewMediaId
    ? items.find(item => item.id === preparedPreviewMediaId) ?? null
    : null;
  const isWheelMoving = isDragging || isSpinning;
  const scrubSnapshot = React.useMemo<GalleryScrubSnapshot | null>(() => {
    if (selectedIndex < 0 || items.length === 0) return null;

    if (directPreviewMediaId && !isPreviewPlaying) {
      const directIndex = items.findIndex(item => item.id === directPreviewMediaId);
      const media = items[directIndex];
      if (media) {
        return {
          media,
          sourceTimeSeconds: media.type === 'video' ? Math.max(0, media.trimStartSeconds ?? 0) : 0,
          timelineTimeSeconds: itemStartTimes[directIndex] ?? 0,
        };
      }
    }

    const playheadPixel = clamp(
      (sizing === 'duration' || isGallery) ? timelineOriginOffset - offset : -offset,
      0,
      stripEndPixel,
    );
    let scrubbedIndex = finalIndex;

    for (let index = 0; index < items.length; index += 1) {
      const itemStartPixel = itemStartPixels[index] ?? 0;
      const itemEndPixel = (itemStartPixels[index] ?? 0) + (itemWidths[index] ?? 0);
      if (playheadPixel < itemStartPixel) {
        scrubbedIndex = Math.max(0, index - 1);
        break;
      }
      if (playheadPixel <= itemEndPixel) {
        scrubbedIndex = index;
        break;
      }
    }

    const media = items[scrubbedIndex];
    if (!media) return null;

    const itemStartPixel = itemStartPixels[scrubbedIndex] ?? 0;
    const itemWidth = Math.max(1, itemWidths[scrubbedIndex] ?? 1);
    const progress = clamp((playheadPixel - itemStartPixel) / itemWidth, 0, 1);
    const itemDuration = itemDurations[scrubbedIndex] ?? 0.5;
    const timelineTimeSeconds = (itemStartTimes[scrubbedIndex] ?? 0) + progress * itemDuration;
    const sourceTimeSeconds = media.type === 'video'
      ? Math.max(0, media.trimStartSeconds ?? 0) + progress * itemDuration
      : 0;

    return { media, sourceTimeSeconds, timelineTimeSeconds };
  }, [
    directPreviewMediaId,
    finalIndex,
    itemDurations,
    itemStartPixels,
    itemStartTimes,
    itemWidths,
    items,
    isPreviewPlaying,
    offset,
    selectedIndex,
    sizing,
    stripEndPixel,
    timelineOriginOffset,
  ]);
  const rulerPlayheadTimeSeconds = React.useMemo(() => {
    if (items.length === 0) return 0;

    const playheadPixel = clamp(timelineOriginOffset - offset, 0, stripEndPixel);
    let playheadIndex = finalIndex;

    for (let index = 0; index < items.length; index += 1) {
      const itemEndPixel = (itemStartPixels[index] ?? 0) + (itemWidths[index] ?? 0);
      if (playheadPixel <= itemEndPixel) {
        playheadIndex = index;
        break;
      }
    }

    const itemStartPixel = itemStartPixels[playheadIndex] ?? 0;
    const itemWidth = Math.max(1, itemWidths[playheadIndex] ?? 1);
    const progress = clamp((playheadPixel - itemStartPixel) / itemWidth, 0, 1);
    return (itemStartTimes[playheadIndex] ?? 0) + progress * (itemDurations[playheadIndex] ?? 0.5);
  }, [finalIndex, itemDurations, itemStartPixels, itemStartTimes, itemWidths, items.length, offset, stripEndPixel, timelineOriginOffset]);

  React.useEffect(() => {
    if (effect !== 'gallery') return;

    const handleDisplayHover = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const bounds = galleryPreviewRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const isInsideDisplay =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      const canShowTrim =
        isInsideDisplay &&
        selectedItemType === 'video' &&
        scrubSnapshot?.media.id === selectedMediaId;

      setTrimOverlayMediaId(current => {
        const next = canShowTrim ? selectedMediaId : null;
        return current === next ? current : next;
      });
    };

    document.addEventListener('pointermove', handleDisplayHover, true);
    return () => document.removeEventListener('pointermove', handleDisplayHover, true);
  }, [effect, scrubSnapshot?.media.id, selectedItemType, selectedMediaId]);

  const setOffset = React.useCallback((nextOffset: number) => {
    const boundedOffset = clamp(nextOffset, minOffset, maxOffset);
    offsetRef.current = boundedOffset;
    setOffsetState(boundedOffset);
  }, [maxOffset, minOffset]);

  React.useEffect(() => {
    if (isPreviewPlaying) return;
    playbackTimeRef.current = scrubSnapshot?.timelineTimeSeconds ?? 0;
    playbackSelectedMediaIdRef.current = selectedMediaId;
  }, [isPreviewPlaying, scrubSnapshot?.timelineTimeSeconds, selectedMediaId]);

  React.useEffect(() => {
    if (!isPreviewPlaying || totalDurationSeconds <= 0) return;

    let lastTime = performance.now();
    const tick = (now: number) => {
      const deltaSeconds = Math.max(0, (now - lastTime) / 1000);
      lastTime = now;
      let nextTime = playbackTimeRef.current + deltaSeconds;

      if (nextTime >= totalDurationSeconds) {
        if (loopPreviewPlayback) {
          nextTime %= totalDurationSeconds;
        } else {
          playbackTimeRef.current = totalDurationSeconds;
          onPreviewPlaybackComplete?.();
          return;
        }
      }

      playbackTimeRef.current = nextTime;
      let playbackIndex = finalIndex;
      for (let index = 0; index < itemDurations.length; index += 1) {
        const itemEndTime = (itemStartTimes[index] ?? 0) + (itemDurations[index] ?? 0.5);
        if (nextTime < itemEndTime) {
          playbackIndex = index;
          break;
        }
      }

      const playbackItem = items[playbackIndex];
      if (playbackItem && playbackSelectedMediaIdRef.current !== playbackItem.id) {
        playbackSelectedMediaIdRef.current = playbackItem.id;
        setOffset(
          (sizing === 'duration' || isGallery)
            ? timelineOriginOffset - (itemStartPixels[playbackIndex] ?? 0)
            : -(itemCenterPositions[playbackIndex] ?? 0),
        );
        onPlaybackMediaChange?.(playbackItem.id);
      }

      playbackFrameRef.current = window.requestAnimationFrame(tick);
    };

    playbackFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (playbackFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackFrameRef.current);
        playbackFrameRef.current = null;
      }
    };
  }, [
    finalIndex,
    isPreviewPlaying,
    itemCenterPositions,
    itemDurations,
    itemStartPixels,
    itemStartTimes,
    items,
    loopPreviewPlayback,
    onPlaybackMediaChange,
    onPreviewPlaybackComplete,
    setOffset,
    sizing,
    timelineOriginOffset,
    totalDurationSeconds,
  ]);

  const updateFastNavigation = React.useCallback((velocity: number) => {
    const speed = Math.abs(velocity);
    const nextFastNavigation = fastNavigationRef.current
      ? speed > FAST_NAVIGATION_EXIT_VELOCITY
      : speed >= FAST_NAVIGATION_ENTER_VELOCITY;

    if (nextFastNavigation === fastNavigationRef.current) return;
    fastNavigationRef.current = nextFastNavigation;
    setIsFastNavigating(nextFastNavigation);
  }, []);

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
  }, [itemCenterPositions, itemStartPixels, items, maxOffset, minOffset, onCenteredMediaChange, selectedMediaId, setOffset, sizing, timelineOriginOffset, updateFastNavigation]);

  const snapToNearest = React.useCallback(() => {
    snapToIndex(
      getNearestIndexForOffset(offsetRef.current, snapReferencePositions),
      { scrubPreview: true },
    );
  }, [snapReferencePositions, snapToIndex]);

  const snapToIndexRef = React.useRef(snapToIndex);
  React.useEffect(() => {
    snapToIndexRef.current = snapToIndex;
  }, [snapToIndex]);

  React.useEffect(() => {
    if (skipNextSelectedAlignmentRef.current) {
      skipNextSelectedAlignmentRef.current = false;
      return;
    }
    if (
      selectedIndex < 0 ||
      isPreviewPlaying ||
      pendingReorderSelectionRef.current ||
      skipNextReorderAlignmentRef.current
    ) return;
    snapToIndexRef.current(selectedIndex, { commit: false });
  }, [isPreviewPlaying, selectedIndex, selectedMediaId, playheadAlignment]);

  React.useEffect(() => {
    if (skipNextReorderAlignmentRef.current) {
      skipNextReorderAlignmentRef.current = false;
      const nextCenteredIndex = getNearestIndexForOffset(offsetRef.current, snapReferencePositions);
      const nextCenteredItem = items[nextCenteredIndex];
      if (nextCenteredItem && nextCenteredItem.id !== selectedMediaId) {
        skipNextSelectedAlignmentRef.current = true;
        setDirectPreviewMediaId(nextCenteredItem.id);
        setTrimOverlayMediaId(null);
        onCenteredMediaChange(nextCenteredItem.id);
      }
      return;
    }
    const mediaId = pendingReorderSelectionRef.current;
    if (!mediaId) return;
    const index = items.findIndex(item => item.id === mediaId);
    if (index < 0) return;

    pendingReorderSelectionRef.current = null;
    snapToIndexRef.current(index, { deferPreview: true });
  }, [items, onCenteredMediaChange, selectedMediaId, snapReferencePositions]);

  const previousCenterPositionsRef = React.useRef(itemCenterPositions);
  React.useLayoutEffect(() => {
    const geometryChanged = previousCenterPositionsRef.current !== itemCenterPositions;
    previousCenterPositionsRef.current = itemCenterPositions;

    if (
      !geometryChanged ||
      selectedIndex < 0 ||
      isPreviewPlaying ||
      pendingReorderSelectionRef.current ||
      skipNextReorderAlignmentRef.current ||
      skipNextSelectedAlignmentRef.current ||
      dragRef.current.isDragging ||
      momentumFrameRef.current !== null ||
      snapFrameRef.current !== null
    ) {
      return;
    }

    setOffset((sizing === 'duration' || isGallery)
      ? timelineOriginOffset - (itemStartPixels[selectedIndex] ?? 0)
      : -(itemCenterPositions[selectedIndex] ?? 0));
  }, [isPreviewPlaying, itemCenterPositions, itemStartPixels, selectedIndex, setOffset, sizing, isGallery, timelineOriginOffset]);

  React.useEffect(() => {
    return () => {
      if (containerResizeObserverRef.current) {
        containerResizeObserverRef.current.disconnect();
      }
      if (viewportResizeObserverRef.current) {
        viewportResizeObserverRef.current.disconnect();
      }
    };
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
  }, []);

  const clearClickGuardSoon = React.useCallback(() => {
    if (clickGuardTimeoutRef.current !== null) {
      window.clearTimeout(clickGuardTimeoutRef.current);
    }
    clickGuardTimeoutRef.current = window.setTimeout(() => {
      clickGuardRef.current = false;
      clickGuardTimeoutRef.current = null;
    }, 140);
  }, []);

  const spinWithMomentum = React.useCallback((initialVelocity: number) => {
    if (Math.abs(initialVelocity) < MOMENTUM_MIN_VELOCITY) {
      snapToNearest();
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
        snapToNearest();
        return;
      }

      momentumFrameRef.current = window.requestAnimationFrame(step);
    };

    momentumFrameRef.current = window.requestAnimationFrame(step);
  }, [maxOffset, minOffset, setOffset, snapToNearest, updateFastNavigation]);

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
  }, [itemGap, itemWidths, items, sizing, uniformItemWidth]);

  const prepareFixedCenterPreview = React.useCallback((order: string[]) => {
    if (selectReorderedItem) return;
    const mediaId = getCenteredMediaIdForOrder(order);
    if (!mediaId || mediaId === preparedPreviewMediaIdRef.current) return;

    preparedPreviewMediaIdRef.current = mediaId;
    setPreparedPreviewMediaId(mediaId);
    setPreparedPreviewReady(false);
    setVisiblePreparedPreviewMediaId(null);
  }, [getCenteredMediaIdForOrder, selectReorderedItem]);

  const updateReorderTarget = React.useCallback((clientX: number) => {
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
  }, [items, prepareFixedCenterPreview]);

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
          updateReorderTarget(pointerX);
          const previewOrder = reorderPreviewOrderRef.current;
          if (previewOrder) prepareFixedCenterPreview(previewOrder);
        }
      }

      reorderAutoPanFrameRef.current = window.requestAnimationFrame(step);
    };

    reorderAutoPanFrameRef.current = window.requestAnimationFrame(step);
  }, [prepareFixedCenterPreview, setOffset, updateReorderTarget]);

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
    };
    clickGuardRef.current = false;
    setIsDragging(true);
    viewport.setPointerCapture(event.pointerId);
  }, [stopAnimation]);

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
      drag.mode = 'reorder';
      drag.didMove = true;
      clickGuardRef.current = true;
      updateFastNavigation(0);
      setReorderPreview({
        mediaId: drag.targetMediaId,
        clientX: event.clientX,
        clientY: event.clientY,
        width: bounds?.width ?? 240,
        height: bounds?.height ?? 135,
      });
      const initialOrder = items.map(item => item.id);
      reorderPreviewOrderRef.current = initialOrder;
      setReorderPreviewOrder(initialOrder);
      prepareFixedCenterPreview(initialOrder);
      reorderPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      startReorderAutoPan();
    } else if (drag.mode === 'pending' && Math.abs(deltaX) > DRAG_SELECT_THRESHOLD) {
      drag.mode = 'wheel';
      setDirectPreviewMediaId(null);
    }

    if (drag.mode === 'reorder' && drag.targetMediaId && onItemsReorder) {
      reorderPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (reorderGhostRef.current) {
        reorderGhostRef.current.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0) translate(-50%, -50%) scale(1.03)`;
      }

      updateReorderTarget(event.clientX);
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
        if (pendingOffset !== null) setOffset(pendingOffset);
      });
    }
    event.preventDefault();
  }, [items, onItemsReorder, prepareFixedCenterPreview, setOffset, startReorderAutoPan, updateFastNavigation, updateReorderTarget]);

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
    };
    setIsDragging(false);
    if (drag.mode !== 'reorder') {
      setReorderPreview(null);
      setReorderPreviewOrder(null);
    }

    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }

    if (drag.mode === 'reorder') {
      if (drag.targetMediaId && drag.reorderTargetMediaId && drag.reorderPosition) {
        if (selectReorderedItem) {
          preparedPreviewMediaIdRef.current = drag.targetMediaId;
          setPreparedPreviewMediaId(drag.targetMediaId);
          setPreparedPreviewReady(false);
          setVisiblePreparedPreviewMediaId(null);
        }
        const draggedElement = viewport?.querySelector<HTMLElement>(
          `[data-preview-wheel-item-id="${CSS.escape(drag.targetMediaId)}"]`,
        );
        const destinationBounds = draggedElement?.getBoundingClientRect();
        if (reorderGhostRef.current && destinationBounds) {
          reorderGhostRef.current.style.transition = `transform ${DROP_SETTLE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          reorderGhostRef.current.style.transform = `translate3d(${destinationBounds.left + destinationBounds.width / 2}px, ${destinationBounds.top + destinationBounds.height / 2}px, 0) translate(-50%, -50%) scale(1)`;
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
          onItemsReorder?.(drag.targetMediaId, drag.reorderTargetMediaId, drag.reorderPosition);
        }

        dropSettleTimeoutRef.current = window.setTimeout(() => {
          dropSettleTimeoutRef.current = null;
          if (selectReorderedItem) {
            pendingReorderSelectionRef.current = drag.targetMediaId;
            onItemsReorder?.(drag.targetMediaId!, drag.reorderTargetMediaId!, drag.reorderPosition!);
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
      if (sizing === 'duration' || isGallery) {
        return;
      }
      spinWithMomentum(drag.velocity);
      return;
    }

    if (drag.targetMediaId) {
      const targetIndex = items.findIndex(item => item.id === drag.targetMediaId);
      if (targetIndex >= 0) {
        snapToIndex(targetIndex);
      }
    }
  }, [clearClickGuardSoon, getCenteredMediaIdForOrder, items, onCenteredMediaChange, onItemsReorder, selectReorderedItem, selectedMediaId, setOffset, sizing, snapToIndex, spinWithMomentum]);

  const focusItem = React.useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      viewportRef.current
        ?.querySelector<HTMLButtonElement>(`[data-preview-wheel-index="${index}"]`)
        ?.focus({ preventScroll: true });
    });
  }, []);

  const moveKeyboardFocus = React.useCallback((nextIndex: number) => {
    const boundedIndex = clamp(nextIndex, 0, Math.max(0, items.length - 1));
    stopAnimation();
    snapToIndex(boundedIndex);
    focusItem(boundedIndex);
  }, [focusItem, items.length, snapToIndex, stopAnimation]);

  const handleKeyboardNavigation = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).matches('input, select, textarea, [contenteditable="true"]')) {
      return;
    }

    const focusedIndexValue = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-preview-wheel-index]')
      ?.dataset.previewWheelIndex;
    const focusedIndex = focusedIndexValue === undefined
      ? centeredIndex
      : Number(focusedIndexValue);

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveKeyboardFocus(focusedIndex + 1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveKeyboardFocus(focusedIndex - 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      moveKeyboardFocus(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      moveKeyboardFocus(items.length - 1);
    }
  }, [centeredIndex, items.length, moveKeyboardFocus]);

  const applyDurationResize = React.useCallback((
    item: SceneLaunchMediaItem,
    edge: 'start' | 'end',
    initialDuration: number,
    initialTrimStart: number,
    deltaSeconds: number,
  ) => {
    if (!onSelectedItemDurationChange) return null;

    if (edge === 'start' && item.type === 'video') {
      const nextTrimStart = clamp(
        initialTrimStart + deltaSeconds,
        0,
        initialTrimStart + initialDuration - 0.5,
      );
      const nextDuration = initialDuration - (nextTrimStart - initialTrimStart);
      const result = {
        durationSeconds: Number(nextDuration.toFixed(2)),
        trimStartSeconds: Number(nextTrimStart.toFixed(2)),
      };
      onSelectedItemDurationChange(result.durationSeconds, result.trimStartSeconds);
      return result;
    }

    const sourceDuration = item.type === 'video'
      ? Math.max(0.5, item.mediaDurationSeconds ?? initialTrimStart + initialDuration)
      : MAX_IMAGE_DURATION_SECONDS;
    const durationDelta = edge === 'start' ? -deltaSeconds : deltaSeconds;
    const nextDuration = clamp(
      initialDuration + durationDelta,
      0.5,
      item.type === 'video' ? sourceDuration - initialTrimStart : MAX_IMAGE_DURATION_SECONDS,
    );
    const result = {
      durationSeconds: Number(nextDuration.toFixed(2)),
      trimStartSeconds: initialTrimStart,
    };
    onSelectedItemDurationChange(result.durationSeconds, result.trimStartSeconds);
    return result;
  }, [onSelectedItemDurationChange]);

  const beginDurationResize = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    item: SceneLaunchMediaItem,
    index: number,
    edge: 'start' | 'end',
  ) => {
    if (sizing !== 'duration' || !onSelectedItemDurationChange) return;

    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);

    const initialDuration = Math.max(
      0.5,
      selectedItemDurationSeconds ?? item.durationSeconds ?? 3,
    );
    const initialTrimStart = Math.max(
      0,
      selectedItemTrimStartSeconds ?? item.trimStartSeconds ?? 0,
    );
    const secondsPerPixel = initialDuration / Math.max(1, itemWidths[index] ?? 1);
    const startX = event.clientX;
    let latestResult: { durationSeconds: number; trimStartSeconds: number } | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      latestResult = applyDurationResize(
        item,
        edge,
        initialDuration,
        initialTrimStart,
        (moveEvent.clientX - startX) * secondsPerPixel,
      );
    };
    const onPointerUp = () => {
      if (latestResult) {
        onSelectedItemDurationChangeEnd?.(
          latestResult.durationSeconds,
          latestResult.trimStartSeconds,
        );
      }
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, [
    applyDurationResize,
    itemWidths,
    onSelectedItemDurationChange,
    onSelectedItemDurationChangeEnd,
    selectedItemDurationSeconds,
    selectedItemTrimStartSeconds,
    sizing,
  ]);

  const handleDurationResizeKey = React.useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    item: SceneLaunchMediaItem,
    edge: 'start' | 'end',
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();

    const initialDuration = Math.max(0.5, selectedItemDurationSeconds ?? item.durationSeconds ?? 3);
    const initialTrimStart = Math.max(0, selectedItemTrimStartSeconds ?? item.trimStartSeconds ?? 0);
    const deltaSeconds = event.key === 'ArrowRight' ? 0.1 : -0.1;
    const result = applyDurationResize(item, edge, initialDuration, initialTrimStart, deltaSeconds);
    if (result) {
      onSelectedItemDurationChangeEnd?.(result.durationSeconds, result.trimStartSeconds);
    }
  }, [applyDurationResize, onSelectedItemDurationChangeEnd, selectedItemDurationSeconds, selectedItemTrimStartSeconds]);

  if (selectedIndex < 0) return null;

  return (
    <div ref={containerRefCallback} className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black px-4 py-6">
      <div className={cn(
        "min-h-0 w-full overflow-hidden rounded-md border border-zinc-800/90 bg-zinc-950/85 shadow-2xl shadow-black/60 backdrop-blur-xl",
        isGallery ? "flex h-full flex-col" : "h-full"
      )}>
        {isGallery && scrubSnapshot && (
          <div className="relative flex flex-1 flex-col min-h-0 items-center justify-center p-4 pb-2">
            {/* Top area control capsule above preview */}
            <div className="mb-2.5 flex items-center justify-center gap-2 rounded-full border border-white/5 bg-zinc-900/40 px-2 py-1 shadow-md backdrop-blur-md shrink-0">
              {/* Play/Pause Button */}
              <button
                type="button"
                onClick={onTogglePlayback}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-white transition-all cursor-pointer hover:scale-105 active:scale-95',
                  isPreviewPlaying ? 'bg-red-650/80 hover:bg-red-700/90' : 'bg-indigo-600/80 hover:bg-indigo-700/90'
                )}
                title={isPreviewPlaying ? 'Pause Preview' : 'Play Preview'}
                aria-label={isPreviewPlaying ? 'Pause Preview' : 'Play Preview'}
              >
                {isPreviewPlaying ? (
                  <Pause className="h-3.5 w-3.5 fill-current" />
                ) : (
                  <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
                )}
              </button>

              <div className="h-3.5 w-px bg-zinc-800" />

              {/* Loop Toggle */}
              <button
                type="button"
                onClick={onToggleLoop}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 cursor-pointer',
                  loopPreviewPlayback
                    ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                    : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                )}
                title={loopPreviewPlayback ? 'Disable Loop' : 'Enable Loop'}
                aria-label={loopPreviewPlayback ? 'Disable Loop' : 'Enable Loop'}
              >
                <Repeat className="h-3.5 w-3.5" />
              </button>

              <div className="h-3.5 w-px bg-zinc-800" />

              {/* Time display */}
              <span className="font-mono text-[10px] font-bold text-zinc-300 select-none px-1.5">
                {timelineCurrentTime.toFixed(1)}s
              </span>

              <div className="h-3.5 w-px bg-zinc-800" />

              {/* Playhead Alignment Toggle */}
              <button
                type="button"
                onClick={togglePlayheadAlignment}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 cursor-pointer',
                  playheadAlignment === 'left'
                    ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                    : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                )}
                title={playheadAlignment === 'left' ? 'Align Playhead to Center' : 'Align Playhead to Left'}
                aria-label={playheadAlignment === 'left' ? 'Align Playhead to Center' : 'Align Playhead to Left'}
              >
                {playheadAlignment === 'left' ? (
                  <AlignLeft className="h-3.5 w-3.5" />
                ) : (
                  <AlignCenter className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <div
              ref={galleryPreviewRef}
              className="relative overflow-hidden rounded-md border border-white/10 bg-black shadow-2xl shadow-black/60"
              style={{ height: galleryPreviewHeight, width: galleryPreviewWidth }}
            >
              {isFastNavigating ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 px-6 text-center"
                >
                  <span className="text-xs font-black uppercase tracking-widest text-zinc-200">
                    Moving quickly
                  </span>
                  <span className="mt-2 text-[10px] font-medium text-zinc-500">
                    Slow down to resume frame preview
                  </span>
                </div>
              ) : (
                <GalleryScrubPreview
                  snapshot={scrubSnapshot}
                  isPlaying={isPreviewPlaying}
                  loopPlayback={loopPreviewPlayback}
                  onPlaybackComplete={onPreviewPlaybackComplete}
                />
              )}
              {preparedPreviewMedia && !isPreviewPlaying && (
                <div
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-0 bg-black transition-opacity duration-75",
                    visiblePreparedPreviewMediaId === preparedPreviewMedia.id && preparedPreviewReady
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                >
                  <PreparedGalleryPreview
                    key={preparedPreviewMedia.id}
                    media={preparedPreviewMedia}
                    onReady={() => setPreparedPreviewReady(true)}
                  />
                </div>
              )}
              {scrubSnapshot.media.id === selectedMediaId &&
                scrubSnapshot.media.type === 'video' &&
                renderGalleryTrimOverlay && (
                  <div
                    ref={trimOverlayRef}
                    className={cn(
                      "absolute inset-x-3 bottom-3 z-20",
                      trimOverlayMediaId === selectedMediaId
                        ? "pointer-events-auto visible"
                        : "pointer-events-none invisible",
                    )}
                  >
                    {renderGalleryTrimOverlay(scrubSnapshot.media)}
                  </div>
                )}
            </div>
          </div>
        )}



        <div
          ref={viewportRefCallback}
          aria-label="Timeline media wheel"
          className={cn(
            "relative flex items-center overflow-hidden",
            isGallery ? "shrink-0 border-t border-zinc-900 bg-zinc-950/20" : "h-full min-h-0",
            reorderPreview ? "cursor-grabbing select-none" : isDragging ? "cursor-grabbing select-none" : "cursor-grab"
          )}
          style={{
            perspective: 1200,
            touchAction: 'none',
            ...(isGallery ? { height: rowHeight } : {}),
          }}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={handleKeyboardNavigation}
        >
          <div className="sr-only" aria-live="polite">
            {centeredItem ? `Centered media ${centeredItem.name}` : 'Timeline media wheel'}
          </div>
          {reorderPreview && typeof document !== 'undefined' && (() => {
            const item = items.find(candidate => candidate.id === reorderPreview.mediaId);
            if (!item) return null;
            return createPortal(
              <div
                ref={reorderGhostRef}
                aria-hidden="true"
                className="pointer-events-none fixed z-[300] overflow-hidden rounded-md border-2 border-indigo-300 bg-zinc-900 shadow-2xl shadow-black/70 ring-2 ring-indigo-400/40"
                style={{
                  left: 0,
                  top: 0,
                  width: reorderPreview.width,
                  height: reorderPreview.height,
                  transform: `translate3d(${reorderPreview.clientX}px, ${reorderPreview.clientY}px, 0) translate(-50%, -50%) scale(1.03)`,
                  willChange: 'transform',
                }}
              >
                {item.type === 'video' ? (
                  <img src={item.posterUrl || VIDEO_PLACEHOLDER} alt="" className="h-full w-full object-cover" />
                ) : (
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                )}
                <div className="absolute inset-0 bg-indigo-500/10" />
              </div>,
              document.body,
            );
          })()}
          {(sizing === 'duration' || isGallery) && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-[190]"
              style={{
                left: playheadAlignment === 'left' ? '96px' : '50%',
                top: rulerTop,
                height: itemCenterY + itemHeight / 2 - rulerTop,
                width: 0,
              }}
            >
              <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-indigo-500 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white shadow-lg shadow-black/50">
                {formatRulerSeconds(rulerPlayheadTimeSeconds)}
              </div>
              <div className="absolute left-0 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-indigo-400" />
              <div className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-indigo-300 shadow-[0_0_8px_rgba(165,180,252,0.9)]" />
            </div>
          )}
          {(sizing === 'duration' || isGallery) && (
            <div className="sr-only" aria-live="polite">
              Playhead at {formatRulerSeconds(rulerPlayheadTimeSeconds)}
            </div>
          )}
          {sizing !== 'duration' && !isGallery && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-lg border-x border-white/10 bg-zinc-800/72 shadow-[inset_14px_0_26px_rgba(0,0,0,0.28),inset_-14px_0_26px_rgba(0,0,0,0.28)]"
              style={{ width: (itemWidths[selectedIndex] ?? uniformItemWidth) + itemGap }}
            />
          )}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1/5 bg-gradient-to-r from-black/62 via-black/28 to-transparent"
          />
          <div className="absolute inset-0 will-change-transform" style={{ transformStyle: 'preserve-3d' }}>
            {items.map((item, index) => {
              const itemWidth = itemWidths[index] ?? uniformItemWidth;
              const itemCenterOffset = (reorderItemCenterPositions?.get(item.id) ?? itemCenterPositions[index] ?? 0) + offset;
              const offsetFromCenter = itemCenterOffset / itemStride;
              const absOffsetFromCenter = Math.abs(offsetFromCenter);
              const distance = Math.min(4, absOffsetFromCenter);
              const isCentered = distance < 0.08;
              const isActive = item.id === selectedMediaId;
              const itemDuration = itemDurations[index] ?? 0.5;
              const itemStartTime = itemStartTimes[index] ?? 0;
              const itemEndTime = itemStartTime + itemDuration;
              let x = itemCenterOffset + playheadOffsetFromCenter;
              let z = 0;
              let rotateY = 0;
              let translateY = 0;
              let scale = 1 - distance * 0.035;
              let opacity = Math.max(0.32, 1 - distance * 0.14);
              let brightness = Math.max(0.68, 1 - distance * 0.07);
              let shouldRender = absOffsetFromCenter < 4.2;

              if (effect === 'cylinder') {
                const angle = clamp(offsetFromCenter * MAX_WHEEL_ANGLE / 2, -MAX_WHEEL_ANGLE, MAX_WHEEL_ANGLE);
                const angleRadians = degreesToRadians(angle);
                const radius = itemStride * 3.05;
                x = Math.sin(angleRadians) * radius + playheadOffsetFromCenter;
                z = (Math.cos(angleRadians) - 1) * radius * 0.72;
                rotateY = -angle;
                translateY = distance * 4;
                scale = 1 - distance * 0.04;
                opacity = Math.max(0.2, 1 - distance * 0.18);
                brightness = Math.max(0.62, 1 - distance * 0.08);
                shouldRender = absOffsetFromCenter < 3.35;
              } else if (effect === 'cylinder2') {
                const angle = clamp(offsetFromCenter * 20, -54, 54);
                const angleRadians = degreesToRadians(angle);
                const radius = itemStride * 2.9;
                const centeredItemWidth = itemWidths[centeredIndex] ?? uniformItemWidth;
                const minimumCenterSpacing = (itemWidth + centeredItemWidth) / 2 + itemGap;
                x = Math.sin(angleRadians) * radius;
                if (absOffsetFromCenter >= 0.5) {
                  x =
                    Math.sign(offsetFromCenter) *
                    Math.max(
                      Math.abs(x),
                      minimumCenterSpacing +
                        Math.max(0, absOffsetFromCenter - 1) * itemWidth * 0.74,
                    );
                }
                x += playheadOffsetFromCenter;
                z = (Math.cos(angleRadians) - 1) * radius * 0.36;
                rotateY = -angle * 0.18;
                translateY = 0;
                scale = 1 - distance * 0.065;
                opacity = Math.max(0.16, 1 - distance * 0.22);
                brightness = Math.max(0.54, 1 - distance * 0.1);
                shouldRender = absOffsetFromCenter < 3.7;
              } else if (effect === 'coverflow') {
                x = itemCenterOffset * 0.82 + playheadOffsetFromCenter;
                z = -distance * 74;
                rotateY = clamp(offsetFromCenter * -36, -58, 58);
                translateY = distance * 5;
                scale = 1 - distance * 0.055;
                opacity = Math.max(0.3, 1 - distance * 0.15);
                brightness = Math.max(0.66, 1 - distance * 0.075);
              } else if (effect === 'gallery') {
                scale = 1;
                translateY = 0;
              } else if (effect === 'stack') {
                x = itemCenterOffset * 0.58 + playheadOffsetFromCenter;
                z = -distance * 96;
                rotateY = clamp(offsetFromCenter * -10, -20, 20);
                translateY = distance * 7;
                scale = 1 - distance * 0.08;
                opacity = Math.max(0.24, 1 - distance * 0.2);
                brightness = Math.max(0.58, 1 - distance * 0.1);
                shouldRender = absOffsetFromCenter < 4.8;
              }

              const firstRulerTick = Math.ceil((itemStartTime - 0.001) / rulerTickStep) * rulerTickStep;
              const rulerTicks: number[] = [];
              for (
                let tickSeconds = firstRulerTick;
                tickSeconds < itemEndTime - 0.001 || (
                  index === items.length - 1 && tickSeconds <= itemEndTime + 0.001
                );
                tickSeconds += rulerTickStep
              ) {
                rulerTicks.push(tickSeconds);
              }

              return (
                <React.Fragment key={item.id}>
                  {sizing === 'duration' && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute left-1/2 h-7 border-b border-zinc-600/80 text-[9px] font-mono text-zinc-400"
                      style={{
                        top: rulerTop,
                        width: itemWidth,
                        opacity: effect === 'gallery' ? 1 : opacity,
                        transform: `translate3d(${(x - itemWidth / 2).toFixed(2)}px, 0px, ${z}px) rotateY(${rotateY}deg) scale(${scale})`,
                        transformOrigin: 'center bottom',
                        zIndex: effect === 'gallery' ? 150 : Math.round(100 - distance * 10),
                      }}
                    >
                      {rulerTicks.map(tickSeconds => (
                        <div
                          key={tickSeconds}
                          className="absolute inset-y-0"
                          style={{ left: `${((tickSeconds - itemStartTime) / itemDuration) * 100}%` }}
                        >
                          <span className="absolute left-0 top-0 -translate-x-1/2 whitespace-nowrap">
                            {formatRulerSeconds(tickSeconds)}
                          </span>
                          <span className="absolute bottom-0 left-0 h-2 w-px bg-zinc-400/80" />
                        </div>
                      ))}
                    </div>
                  )}
                  <div
                  className={cn(
                    "group/nav absolute left-1/2 shrink-0 overflow-hidden border bg-zinc-900 shadow-lg",
                    isGaplessGallery ? 'rounded-none' : 'rounded-md',
                    isSnapping
                      ? "transition-[border-color,box-shadow,filter,opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                      : isWheelMoving
                        ? "transition-[border-color,box-shadow] duration-100"
                        : "transition-[border-color,box-shadow,filter,opacity,transform] duration-150",
                    isActive
                      ? "border-indigo-300 shadow-indigo-500/25 ring-1 ring-indigo-400/50"
                      : "border-zinc-700/70 hover:border-zinc-500 hover:shadow-xl hover:ring-1 hover:ring-indigo-500/40"
                  )}
                  style={{
                    filter: `brightness(${brightness})`,
                    top: itemCenterY,
                    width: itemWidth,
                    height: itemHeight,
                    opacity: reorderPreview?.mediaId === item.id ? 0.12 : opacity,
                    pointerEvents: shouldRender ? 'auto' : 'none',
                    transform: `translate3d(${(x - itemWidth / 2).toFixed(2)}px, ${(translateY - itemHeight / 2).toFixed(2)}px, ${z}px) rotateY(${rotateY}deg) scale(${scale})`,
                    transformOrigin: 'center center',
                    zIndex: Math.round(100 - distance * 10),
                  }}
                  onTransitionEnd={(event) => {
                    const completion = snapCompletionRef.current;
                    if (
                      event.target === event.currentTarget &&
                      event.propertyName === 'transform' &&
                      completion?.mediaId === item.id
                    ) {
                      completion.finish();
                    }
                  }}
                >
                  <button
                    type="button"
                    title={item.name}
                    aria-current={isActive ? 'true' : undefined}
                    aria-label={`Preview ${item.name}`}
                    data-preview-wheel-item-id={item.id}
                    data-preview-wheel-index={index}
                    onClick={(event) => {
                      if (clickGuardRef.current) {
                        event.preventDefault();
                        return;
                      }
                      if (event.detail === 0) {
                        snapToIndex(index);
                      }
                    }}
                    className="absolute inset-0 overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                  >
                    {item.type === 'video' ? (
                      <img
                        src={item.posterUrl || VIDEO_PLACEHOLDER}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                    )}
                    <div className={cn(
                      "absolute inset-0 transition-colors",
                      isActive ? "bg-indigo-500/10" : "bg-black/30 group-hover/nav:bg-black/10"
                    )} />
                    {!isActive && effect !== 'gallery' && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2.5">
                        <div className="truncate text-xs font-black uppercase text-zinc-100">
                          {item.name}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-1 font-mono text-[9px] uppercase tracking-widest text-zinc-400">
                          <span>{item.type}</span>
                          {isCentered && <span className="text-indigo-200">Centered</span>}
                        </div>
                      </div>
                    )}
                  </button>
                  {isActive && effect !== 'gallery' && renderSelectedItemOverlay && (
                    <div
                      className="pointer-events-none absolute inset-0 z-20"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {renderSelectedItemOverlay(item)}
                    </div>
                  )}
                  {isActive && sizing === 'duration' && onSelectedItemDurationChange && (
                    <>
                      <button
                        type="button"
                        aria-label={`Trim start of ${item.name}`}
                        title="Trim start"
                        onPointerDown={(event) => beginDurationResize(event, item, index, 'start')}
                        onKeyDown={(event) => handleDurationResizeKey(event, item, 'start')}
                        onClick={(event) => event.stopPropagation()}
                        className="absolute inset-y-0 left-0 z-30 flex w-4 cursor-ew-resize touch-none items-center justify-center border-y-2 border-l-2 border-white bg-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.35),4px_0_14px_rgba(0,0,0,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                      >
                        <span className="h-9 w-0.5 rounded-full bg-zinc-500/70" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Trim end of ${item.name}`}
                        title="Trim end"
                        onPointerDown={(event) => beginDurationResize(event, item, index, 'end')}
                        onKeyDown={(event) => handleDurationResizeKey(event, item, 'end')}
                        onClick={(event) => event.stopPropagation()}
                        className="absolute inset-y-0 right-0 z-30 flex w-4 cursor-ew-resize touch-none items-center justify-center border-y-2 border-r-2 border-white bg-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.35),-4px_0_14px_rgba(0,0,0,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                      >
                        <span className="h-9 w-0.5 rounded-full bg-zinc-500/70" />
                      </button>
                    </>
                  )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
