import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Ban, Clapperboard, Folder, CornerUpLeft, FolderInput, Play, Pause, Repeat, AlignLeft, AlignCenter, AlignRight, Trash2, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { VIDEO_PLACEHOLDER, type SceneLaunchMediaItem } from './useSceneLaunchBoard';

const ITEM_GAP = 24;
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
const MAX_WHEEL_ANGLE = 54;
const DURATION_REFERENCE_SECONDS = 3;
const MAX_IMAGE_DURATION_SECONDS = 60 * 60;
const GALLERY_ITEM_HEIGHT = 120;

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
  reorderPosition: 'before' | 'after' | 'inside' | null;
  utilityAction: PreviewWheelUtilityAction | null;
};

type PreviewWheelPlayheadDragState = {
  isDragging: boolean;
  pointerId: number;
  startClientX: number;
  startPlayheadX: number;
  startOffset: number;
};

export type PreviewWheelUtilityAction = 'parent' | 'directory' | 'trash' | 'disable';

type ReorderPreview = {
  mediaId: string;
  clientX: number;
  clientY: number;
  width: number;
  height: number;
  liftScale: number;
  trayX: number;
  trayY: number;
};

export type SceneLaunchPreviewWheelV3Effect = 'cylinder' | 'cylinder2' | 'coverflow' | 'gallery' | 'stack';
export type SceneLaunchPreviewWheelV3Sizing = 'uniform' | 'duration';

interface SceneLaunchPreviewWheelV3Props {
  items: SceneLaunchMediaItem[];
  itemSequences?: Record<string, SceneLaunchMediaItem[]>;
  itemSequenceThumbnails?: Record<string, Record<string, SceneLaunchMediaItem>>;
  onCollectionOpen?: (representativeMediaId: string) => void;
  canNavigateBack?: boolean;
  onNavigateBack?: () => void;
  parentCollectionThumbnailUrl?: string;
  parentCollectionName?: string;
  breadcrumbs?: { id: string; name: string }[];
  onBreadcrumbClick?: (index: number) => void;
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
  customChunks?: SceneLaunchMediaItem[][];
  breakoutTitles?: string[];
  breakoutIsCollection?: boolean[];
  breakoutRepresentativeUrls?: (string | null)[];
  currentCollectionName?: string;
  breakoutCollectionsEnabled?: boolean;
  onBreakoutCollectionsChange?: (enabled: boolean) => void;
  rowTitle?: string;
  rowIconUrl?: string;
  rowIsCollection?: boolean;
  isFirstGridRow?: boolean;
  isPreviewPlaying?: boolean;
  loopPreviewPlayback?: boolean;
  onPreviewPlaybackComplete?: () => void;
  onPlaybackMediaChange?: (mediaId: string) => void;
  onItemsReorder?: (draggedMediaId: string, targetMediaId: string, position: 'before' | 'after') => void;
  collectionItemIds?: string[];
  onItemMoveIntoCollection?: (draggedMediaId: string, targetCollectionMediaId: string) => void;
  disabledItemIds?: string[];
  onUtilityDrop?: (action: PreviewWheelUtilityAction, draggedMediaId: string) => void;
  selectReorderedItem?: boolean;
  onTogglePlayback?: () => void;
  onToggleLoop?: () => void;
  showUniformRuler?: boolean;
  slideOnClick?: boolean;
  gridView?: boolean;
  gridColumnCount?: number;
  showPlayhead?: boolean;
  playheadIsPlaying?: boolean;
  hidePreview?: boolean;
  hideTrack?: boolean;
  activePlayingMediaId?: string | null;
  activePlayingElapsedSeconds?: number;
  onPlaybackTimeUpdate?: (mediaId: string, elapsedSeconds: number) => void;
  externalScrubMediaId?: string | null;
  externalScrubSourceTime?: number | null;
  externalScrubTimelineTime?: number | null;
  onScrubUpdate?: (
    mediaId: string | null,
    sourceTimeSeconds: number | null,
    timelineTimeSeconds?: number | null,
  ) => void;
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

const formatPlaybackTime = (seconds: number) => {
  const totalTenths = Math.round(Math.max(0, seconds) * 10);
  const minutes = Math.floor(totalTenths / 600);
  const remainingSeconds = (totalTenths % 600) / 10;
  return `${String(minutes).padStart(2, '0')}:${remainingSeconds.toFixed(1).padStart(4, '0')}`;
};

const formatPlaybackTimestamp = (currentSeconds: number, totalSeconds: number) => (
  `${formatPlaybackTime(currentSeconds)} / ${formatPlaybackTime(totalSeconds)}`
);

function UniformItemProgress({
  progress,
  durationSeconds,
  isPlaying,
  timelineTimeSeconds,
}: {
  progress: number;
  durationSeconds: number;
  isPlaying: boolean;
  timelineTimeSeconds: number;
}) {
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const wasPlayingRef = React.useRef(false);
  const pausedInputProgressRef = React.useRef<number | null>(null);
  const previousTimelineTimeRef = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const boundedProgress = clamp(progress, 0, 1);
    const wasPlaying = wasPlayingRef.current;
    const previousTimelineTime = previousTimelineTimeRef.current;
    const didTimelineReset =
      previousTimelineTime !== null &&
      timelineTimeSeconds < previousTimelineTime - 0.001;
    wasPlayingRef.current = isPlaying;
    previousTimelineTimeRef.current = timelineTimeSeconds;

    if (!didTimelineReset && !isPlaying && wasPlaying) {
      const computedTransform = window.getComputedStyle(bar).transform;
      pausedInputProgressRef.current = boundedProgress;
      bar.style.transition = 'none';
      if (computedTransform !== 'none') bar.style.transform = computedTransform;
      return;
    }

    if (
      !isPlaying &&
      pausedInputProgressRef.current !== null &&
      Math.abs(pausedInputProgressRef.current - boundedProgress) < 0.0001
    ) {
      return;
    }

    pausedInputProgressRef.current = isPlaying ? null : boundedProgress;

    let startingProgress = boundedProgress;
    if (isPlaying && !wasPlaying) {
      const computedTransform = window.getComputedStyle(bar).transform;
      const matrixMatch = computedTransform.match(/^matrix\(([^,]+),/);
      const computedScale = matrixMatch ? Number(matrixMatch[1]) : Number.NaN;
      if (Number.isFinite(computedScale)) startingProgress = clamp(computedScale, 0, 1);
    }

    bar.style.transition = 'none';
    bar.style.transform = `scaleX(${startingProgress})`;

    if (!isPlaying || startingProgress >= 1) return;

    const frame = window.requestAnimationFrame(() => {
      const remainingSeconds = Math.max(0, durationSeconds * (1 - startingProgress));
      bar.style.transition = `transform ${remainingSeconds}s linear`;
      bar.style.transform = 'scaleX(1)';
    });
    return () => window.cancelAnimationFrame(frame);
  }, [durationSeconds, isPlaying, progress, timelineTimeSeconds]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-0.5 overflow-hidden bg-black/35"
    >
      <div
        ref={barRef}
        className="h-full origin-left bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.85)] will-change-transform"
      />
    </div>
  );
}

type GalleryScrubSnapshot = {
  media: SceneLaunchMediaItem;
  sourceTimeSeconds: number;
  timelineTimeSeconds: number;
};

type CanvasVideoElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function GalleryCanvasPreview({
  snapshot,
  isPlaying = false,
}: {
  snapshot: GalleryScrubSnapshot;
  isPlaying?: boolean;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const videoRef = React.useRef<CanvasVideoElement | null>(null);
  const drawableRef = React.useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const imageCacheRef = React.useRef(new Map<string, HTMLImageElement>());
  const targetTimeRef = React.useRef(snapshot.sourceTimeSeconds);
  const mediaKeyRef = React.useRef('');
  const expectedVideoSourceRef = React.useRef('');
  const videoFrameHandleRef = React.useRef<number | null>(null);
  const animationFrameHandleRef = React.useRef<number | null>(null);
  const isPlayingRef = React.useRef(isPlaying);

  const drawCurrentFrame = React.useCallback(() => {
    const canvas = canvasRef.current;
    const drawable = drawableRef.current;
    if (!canvas || !drawable) return;

    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const renderWidth = Math.round(cssWidth * pixelRatio);
    const renderHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    if (
      drawable instanceof HTMLVideoElement &&
      (
        drawable.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        drawable.currentSrc !== expectedVideoSourceRef.current
      )
    ) return;
    const sourceWidth = drawable instanceof HTMLVideoElement ? drawable.videoWidth : drawable.naturalWidth;
    const sourceHeight = drawable instanceof HTMLVideoElement ? drawable.videoHeight : drawable.naturalHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const scale = Math.min(cssWidth / sourceWidth, cssHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = '#000';
    context.fillRect(0, 0, cssWidth, cssHeight);
    context.drawImage(
      drawable,
      (cssWidth - width) / 2,
      (cssHeight - height) / 2,
      width,
      height,
    );
  }, []);

  const stopFrameLoop = React.useCallback(() => {
    const video = videoRef.current;
    if (videoFrameHandleRef.current !== null && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(videoFrameHandleRef.current);
    }
    if (animationFrameHandleRef.current !== null) {
      window.cancelAnimationFrame(animationFrameHandleRef.current);
    }
    videoFrameHandleRef.current = null;
    animationFrameHandleRef.current = null;
  }, []);

  const startFrameLoop = React.useCallback(() => {
    stopFrameLoop();
    const video = videoRef.current;
    if (!video) return;
    const frameMediaKey = mediaKeyRef.current;
    const frameSource = expectedVideoSourceRef.current;

    if (video.requestVideoFrameCallback) {
      const drawVideoFrame = () => {
        if (mediaKeyRef.current !== frameMediaKey || video.currentSrc !== frameSource) return;
        drawCurrentFrame();
        if (!video.paused && !video.ended) {
          videoFrameHandleRef.current = video.requestVideoFrameCallback?.(drawVideoFrame) ?? null;
        }
      };
      videoFrameHandleRef.current = video.requestVideoFrameCallback(drawVideoFrame);
      return;
    }

    const drawAnimationFrame = () => {
      if (mediaKeyRef.current !== frameMediaKey || video.currentSrc !== frameSource) return;
      drawCurrentFrame();
      if (!video.paused && !video.ended) {
        animationFrameHandleRef.current = window.requestAnimationFrame(drawAnimationFrame);
      }
    };
    animationFrameHandleRef.current = window.requestAnimationFrame(drawAnimationFrame);
  }, [drawCurrentFrame, stopFrameLoop]);

  const seekToLatestTarget = React.useCallback((video: CanvasVideoElement) => {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA || video.seeking) return;

    const maximumTime = Number.isFinite(video.duration)
      ? Math.max(0, video.duration - 0.001)
      : targetTimeRef.current;
    const targetTime = clamp(targetTimeRef.current, 0, maximumTime);
    if (Math.abs(video.currentTime - targetTime) <= 0.001) {
      drawCurrentFrame();
      return;
    }
    video.currentTime = targetTime;
  }, [drawCurrentFrame]);

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(drawCurrentFrame);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawCurrentFrame]);

  React.useEffect(() => {
    const video = document.createElement('video') as CanvasVideoElement;
    video.preload = 'auto';
    video.playsInline = true;
    videoRef.current = video;
    const isCurrentSource = () => (
      expectedVideoSourceRef.current !== '' &&
      video.currentSrc === expectedVideoSourceRef.current
    );

    video.addEventListener('loadedmetadata', () => {
      if (!isCurrentSource()) return;
      seekToLatestTarget(video);
      if (isPlayingRef.current) void video.play().catch(() => undefined);
    });
    video.addEventListener('loadeddata', () => {
      if (!isCurrentSource()) return;
      if (Math.abs(video.currentTime - targetTimeRef.current) <= 0.001) drawCurrentFrame();
      else seekToLatestTarget(video);
    });
    video.addEventListener('seeked', () => {
      if (!isCurrentSource()) return;
      drawCurrentFrame();
      if (Math.abs(video.currentTime - targetTimeRef.current) > 0.001) {
        seekToLatestTarget(video);
      }
    });
    video.addEventListener('playing', startFrameLoop);
    video.addEventListener('pause', drawCurrentFrame);

    return () => {
      stopFrameLoop();
      video.pause();
      video.removeAttribute('src');
      video.load();
      videoRef.current = null;
    };
  }, [drawCurrentFrame, seekToLatestTarget, startFrameLoop, stopFrameLoop]);

  React.useLayoutEffect(() => {
    targetTimeRef.current = snapshot.sourceTimeSeconds;
    const mediaKey = `${snapshot.media.type}:${snapshot.media.id}:${snapshot.media.previewUrl}`;
    if (mediaKey === mediaKeyRef.current) {
      if (!isPlaying && snapshot.media.type === 'video' && videoRef.current) {
        seekToLatestTarget(videoRef.current);
      }
      return;
    }
    mediaKeyRef.current = mediaKey;

    const video = videoRef.current;
    if (snapshot.media.type === 'video') {
      if (!video) return;
      stopFrameLoop();
      video.pause();
      drawableRef.current = video;
      video.muted = !isPlaying;
      expectedVideoSourceRef.current = new URL(snapshot.media.previewUrl, document.baseURI).href;
      video.src = snapshot.media.previewUrl;
      video.load();
      return;
    }

    video?.pause();
    stopFrameLoop();
    expectedVideoSourceRef.current = '';
    let image = imageCacheRef.current.get(snapshot.media.previewUrl);
    if (!image) {
      image = new window.Image();
      image.decoding = 'async';
      image.src = snapshot.media.previewUrl;
      imageCacheRef.current.set(snapshot.media.previewUrl, image);
    }
    const targetImage = image;
    const drawImage = () => {
      if (mediaKeyRef.current !== mediaKey) return;
      drawableRef.current = targetImage;
      drawCurrentFrame();
    };
    if (targetImage.complete && targetImage.naturalWidth > 0) drawImage();
    else targetImage.addEventListener('load', drawImage, { once: true });
  }, [drawCurrentFrame, isPlaying, seekToLatestTarget, snapshot.media.id, snapshot.media.previewUrl, snapshot.media.type, snapshot.sourceTimeSeconds, stopFrameLoop]);

  React.useEffect(() => {
    const video = videoRef.current;
    isPlayingRef.current = isPlaying;
    if (!video || snapshot.media.type !== 'video') return;
    video.muted = !isPlaying;
    if (!isPlaying || snapshot.media.type !== 'video') {
      video.pause();
      stopFrameLoop();
      seekToLatestTarget(video);
      return;
    }

    seekToLatestTarget(video);
    void video.play().catch(() => undefined);
  }, [isPlaying, seekToLatestTarget, snapshot.media.type, startFrameLoop, stopFrameLoop]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`${snapshot.media.name} scrub preview`}
      className="block h-full w-full rounded-md bg-black"
    />
  );
}

export function SceneLaunchPreviewWheelV3({
  items,
  itemSequences,
  itemSequenceThumbnails,
  onCollectionOpen,
  canNavigateBack = false,
  onNavigateBack,
  parentCollectionThumbnailUrl,
  parentCollectionName,
  breadcrumbs,
  onBreadcrumbClick,
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
  customChunks,
  breakoutTitles,
  breakoutIsCollection,
  breakoutRepresentativeUrls,
  currentCollectionName,
  breakoutCollectionsEnabled = false,
  onBreakoutCollectionsChange,
  rowTitle,
  rowIsCollection,
  isFirstGridRow = false,
  isPreviewPlaying = false,
  loopPreviewPlayback = false,
  onPreviewPlaybackComplete,
  onPlaybackMediaChange,
  onItemsReorder,
  collectionItemIds = [],
  onItemMoveIntoCollection,
  disabledItemIds = [],
  onUtilityDrop,
  selectReorderedItem = true,
  onTogglePlayback,
  onToggleLoop,
  showUniformRuler = true,
  slideOnClick = true,
  gridView = false,
  gridColumnCount,
  showPlayhead = true,
  playheadIsPlaying,
  hidePreview = false,
  hideTrack = false,
  activePlayingMediaId = null,
  activePlayingElapsedSeconds = 0,
  onPlaybackTimeUpdate,
  externalScrubMediaId = null,
  externalScrubSourceTime = null,
  externalScrubTimelineTime = null,
  onScrubUpdate,
}: SceneLaunchPreviewWheelV3Props) {
  const containerResizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const viewportResizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = React.useState({ width: 960, height: 520 });

  const containerRefCallback = React.useCallback((node: HTMLDivElement | null) => {
    if (containerResizeObserverRef.current) {
      containerResizeObserverRef.current.disconnect();
      containerResizeObserverRef.current = null;
    }

    if (node) {
      const updateSize = () => {
        const bounds = node.getBoundingClientRect();
        setViewportSize(prev => {
          const nextWidth = node.clientWidth || bounds.width || prev.width;
          const nextHeight = bounds.height || 520;
          if (prev.width === nextWidth && prev.height === nextHeight) return prev;
          return { width: nextWidth, height: nextHeight };
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
          const nextWidth = node.clientWidth || bounds.width || 960;
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
  const reorderGhostContentRef = React.useRef<HTMLDivElement | null>(null);
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
    utilityAction: null,
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
  const wasPreviewPlayingRef = React.useRef(false);
  const prominentTimestampRef = React.useRef<HTMLDivElement | null>(null);
  const playbackSelectedMediaIdRef = React.useRef<string | null>(selectedMediaId);
  const playbackResolvedMediaKeyRef = React.useRef<string | null>(null);
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
  const activeGridScrubRowRef = React.useRef<number | null>(null);
  const playheadDragRef = React.useRef<PreviewWheelPlayheadDragState>({
    isDragging: false,
    pointerId: -1,
    startClientX: 0,
    startPlayheadX: 0,
    startOffset: 0,
  });
  const seekGridPlayheadToXRef = React.useRef<(playheadX: number) => void>(() => undefined);
  const [offset, setOffsetState] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const [activeGridPlayheadRow, setActiveGridPlayheadRow] = React.useState<number | null>(null);
  const [gridPlayheadRatio, setGridPlayheadRatio] = React.useState<number | null>(null);
  const [rulerHoveredX, setRulerHoveredX] = React.useState<number | null>(null);
  const handleRulerMouseMove = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setRulerHoveredX(event.clientX - rect.left);
  }, []);
  const handleRulerMouseLeave = React.useCallback(() => {
    setRulerHoveredX(null);
  }, []);
  const [isPlayheadDragging, setIsPlayheadDragging] = React.useState(false);
  const [isSpinning, setIsSpinning] = React.useState(false);
  const [isSnapping, setIsSnapping] = React.useState(false);
  const [reorderPreview, setReorderPreview] = React.useState<ReorderPreview | null>(null);
  const [reorderPreviewOrder, setReorderPreviewOrder] = React.useState<string[] | null>(null);
  const [collectionDropTargetId, setCollectionDropTargetId] = React.useState<string | null>(null);
  const [utilityDropTarget, setUtilityDropTarget] = React.useState<PreviewWheelUtilityAction | null>(null);
  const isSharedPlayheadPlaying = playheadIsPlaying ?? isPreviewPlaying;

  React.useLayoutEffect(() => {
    const content = reorderGhostContentRef.current;
    if (!reorderPreview || !content || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const animation = content.animate(
      [
        { transform: `scale(${reorderPreview.liftScale})`, offset: 0 },
        {
          transform: `scale(${reorderPreview.liftScale})`,
          offset: REORDER_LIFT_HOLD_MS / (REORDER_LIFT_HOLD_MS + REORDER_SHRINK_DURATION_MS),
          easing: 'cubic-bezier(0.42, 0, 1, 1)',
        },
        { transform: 'scale(1)' },
      ],
      {
        duration: REORDER_LIFT_HOLD_MS + REORDER_SHRINK_DURATION_MS,
        easing: 'linear',
        fill: 'both',
      },
    );
    return () => animation.cancel();
  }, [reorderPreview]);
  const [, setPreparedPreviewMediaId] = React.useState<string | null>(null);
  const [, setPreparedPreviewReady] = React.useState(false);
  const [, setVisiblePreparedPreviewMediaId] = React.useState<string | null>(null);
  const [directPreviewMediaId, setDirectPreviewMediaId] = React.useState<string | null>(selectedMediaId);
  const [playbackSnapshotTime, setPlaybackSnapshotTime] = React.useState<number | null>(null);
  const [trimOverlayMediaId, setTrimOverlayMediaId] = React.useState<string | null>(null);
  const playheadPositionRatioRef = React.useRef(0.5);
  const [playheadPositionRatio, setPlayheadPositionRatio] = React.useState(0.5);
  const gridPanelResizeRef = React.useRef({
    isDragging: false,
    pointerId: -1,
    startClientY: 0,
    startHeight: 280,
  });
  const [isGridPanelResizing, setIsGridPanelResizing] = React.useState(false);
  const [gridDisplayPanelHeight, setGridDisplayPanelHeight] = React.useState(() => {
    if (typeof window === 'undefined') return 280;
    const savedHeight = Number(localStorage.getItem('scene-launch-grid-display-panel-height'));
    return Number.isFinite(savedHeight) ? savedHeight : 280;
  });


  React.useEffect(() => {
    if (hidePreview) return;
    const savedPosition = Number(localStorage.getItem('scene-launch-playhead-position'));
    const nextPosition = Number.isFinite(savedPosition) && savedPosition > 0 && savedPosition < 1
      ? savedPosition
      : localStorage.getItem('scene-launch-playhead-alignment') === 'left'
        ? 0.1
        : null;
    if (nextPosition === null) return;

    const frame = window.requestAnimationFrame(() => {
      playheadPositionRatioRef.current = nextPosition;
      setPlayheadPositionRatio(nextPosition);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hidePreview]);

  const centerPlayhead = React.useCallback(() => {
    playheadPositionRatioRef.current = 0.5;
    setPlayheadPositionRatio(0.5);
    localStorage.setItem('scene-launch-playhead-position', '0.5');
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

  const isGallery = effect === 'gallery';
  const gridItemGap = 6;
  const responsiveGridItemWidth = hidePreview && gridColumnCount
    ? Math.max(1, (viewportSize.width - 16 - gridItemGap * (gridColumnCount - 1)) / gridColumnCount)
    : null;
  const itemHeight = responsiveGridItemWidth !== null
    ? responsiveGridItemWidth * 9 / 16
    : isGallery
      ? GALLERY_ITEM_HEIGHT
    : Math.round(clamp(
        sizing === 'uniform'
          ? Math.min(viewportSize.height - 64, viewportSize.width * 0.72 * 9 / 16)
          : viewportSize.height - 64,
        220,
        620,
      ));
  const rowHeight = hidePreview
    ? itemHeight + 40
    : isGallery
      ? itemHeight + 66
      : itemHeight + 36;
  const itemCenterY = hidePreview
    ? itemHeight / 2 + 32
    : isGallery
      ? rowHeight - 12 - itemHeight / 2
      : Math.max(
          itemHeight / 2 + 32,
          viewportSize.height - itemHeight / 2 - 24,
        );
  const rulerTop = hidePreview
    ? 4
    : isGallery
      ? 22
      : Math.max(2, itemCenterY - itemHeight / 2 - 28);
  const itemTop = itemCenterY - itemHeight / 2;
  const centerX = viewportSize.width > 0 ? viewportSize.width / 2 : 480;
  const playheadX = clamp(
    viewportSize.width * playheadPositionRatio,
    32,
    Math.max(32, viewportSize.width - 32),
  );
  const playheadOffsetFromCenter = playheadX - centerX;
  const minGridDisplayPanelHeight = 180;
  const maxGridDisplayPanelHeight = Math.max(
    minGridDisplayPanelHeight,
    viewportSize.height - 190,
  );
  const boundedGridDisplayPanelHeight = clamp(
    gridDisplayPanelHeight,
    minGridDisplayPanelHeight,
    maxGridDisplayPanelHeight,
  );
  const galleryPreviewHeight = Math.max(0, Math.min(
    gridView ? Math.max(96, boundedGridDisplayPanelHeight - 70) : 360,
    viewportSize.width * 9 / 16,
    gridView
      ? Math.max(96, boundedGridDisplayPanelHeight - 70)
      : viewportSize.height - rowHeight - 72,
  ));
  const galleryPreviewWidth = galleryPreviewHeight * 16 / 9;
  const uniformItemWidth = hidePreview
    ? responsiveGridItemWidth ?? Math.round(itemHeight * 16 / 9)
    : sizing === 'uniform'
      ? Math.round(itemHeight * 16 / 9)
      : Math.round(clamp(
          itemHeight * 1.6,
          320,
          Math.min(760, viewportSize.width * 0.72),
        ));
  const getMediaDuration = React.useCallback((item: SceneLaunchMediaItem) => Math.max(
    0.5,
    item.durationSeconds ?? 3,
  ), []);
  const itemDurations = React.useMemo(() => items.map(item => {
    if (disabledItemIds.includes(item.id)) return 0;
    const sequence = itemSequences?.[item.id];
    if (sequence?.length) {
      return sequence.reduce((total, media) => (
        total + (disabledItemIds.includes(media.id) ? 0 : getMediaDuration(media))
      ), 0);
    }
    return Math.max(
      0.5,
      item.id === selectedMediaId && selectedItemDurationSeconds !== undefined
        ? selectedItemDurationSeconds
        : item.durationSeconds ?? 3,
    );
  }), [disabledItemIds, getMediaDuration, itemSequences, items, selectedItemDurationSeconds, selectedMediaId]);

  const resolveItemSnapshot = React.useCallback((
    item: SceneLaunchMediaItem,
    elapsedSeconds: number,
  ) => {
    const sequence = itemSequences?.[item.id]?.filter(media => !disabledItemIds.includes(media.id));
    if (!sequence?.length) {
      return {
        media: item,
        sourceTimeSeconds: item.type === 'video'
          ? Math.max(0, item.trimStartSeconds ?? 0) + elapsedSeconds
          : 0,
      };
    }

    let remaining = Math.max(0, elapsedSeconds);
    for (const media of sequence) {
      const duration = getMediaDuration(media);
      if (remaining < duration) {
        return {
          media,
          sourceTimeSeconds: media.type === 'video'
            ? Math.max(0, media.trimStartSeconds ?? 0) + remaining
            : 0,
        };
      }
      remaining -= duration;
    }

    const media = sequence[sequence.length - 1];
    const duration = getMediaDuration(media);
    return {
      media,
      sourceTimeSeconds: media.type === 'video'
        ? Math.max(0, media.trimStartSeconds ?? 0) + Math.max(0, duration - 0.001)
        : 0,
    };
  }, [disabledItemIds, getMediaDuration, itemSequences]);
  const durationPixelsPerSecond = uniformItemWidth / DURATION_REFERENCE_SECONDS * durationScale;
  const itemWidths = React.useMemo(() => {
    if (sizing === 'uniform') {
      return items.map(() => uniformItemWidth);
    }

    return itemDurations.map(duration => duration * durationPixelsPerSecond);
  }, [durationPixelsPerSecond, itemDurations, items, sizing, uniformItemWidth]);
  const isGaplessGallery = effect === 'gallery' && sizing === 'duration';
  const itemGap = hidePreview
    ? gridItemGap
    : isGaplessGallery
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

  const gridItemWidth = Math.round(GALLERY_ITEM_HEIGHT * 16 / 9);
  const gridColStride = gridItemWidth + gridItemGap;
  const colStride = uniformItemWidth + itemGap;
  const itemsPerRow = React.useMemo(() => {
    return Math.max(1, Math.floor((viewportSize.width - 16 + gridItemGap) / gridColStride));
  }, [viewportSize.width, gridColStride]);

  const chunks = React.useMemo(() => {
    if (customChunks) return customChunks;
    if (!gridView) return [];
    const result: SceneLaunchMediaItem[][] = [];
    for (let i = 0; i < items.length; i += itemsPerRow) {
      result.push(items.slice(i, i + itemsPerRow));
    }
    return result;
  }, [customChunks, items, itemsPerRow, gridView]);

  const getGridRowForMedia = React.useCallback((mediaId: string | null | undefined) => {
    if (!mediaId) return -1;
    const itemIndex = items.findIndex(item => (
      item.id === mediaId || itemSequences?.[item.id]?.some(sequenceItem => sequenceItem.id === mediaId)
    ));
    return itemIndex < 0 ? -1 : Math.floor(itemIndex / itemsPerRow);
  }, [itemSequences, items, itemsPerRow]);
  const playbackGridRow = getGridRowForMedia(activePlayingMediaId);
  const externalScrubGridRow = getGridRowForMedia(externalScrubMediaId);
  const selectedGridRow = getGridRowForMedia(selectedMediaId);
  const visibleGridPlayheadRow = isPreviewPlaying && playbackGridRow >= 0
    ? playbackGridRow
    : externalScrubGridRow >= 0
      ? externalScrubGridRow
      : activeGridPlayheadRow ?? Math.max(0, selectedGridRow);

  const selectedItemType = items[selectedIndex]?.type;
  const itemStride = uniformItemWidth + itemGap;
  const finalIndex = items.length - 1;
  const finalCenterOffset = -(itemCenterPositions[finalIndex] ?? 0);
  const stripEndPixel = (itemStartPixels[finalIndex] ?? 0) + (itemWidths[finalIndex] ?? 0);
  const timelineOriginOffset = (itemWidths[0] ?? 0) / 2;
  const selectedScrubOriginOffset = selectedIndex >= 0
    ? (itemStartPixels[selectedIndex] ?? 0) - (itemCenterPositions[selectedIndex] ?? 0)
    : 0;
  const maxOffset = (sizing === 'duration')
    ? timelineOriginOffset
    : (sizing === 'uniform')
      ? Math.max(
          centerX - ((itemWidths[0] ?? uniformItemWidth) / 2),
          centerX - ((itemWidths[0] ?? uniformItemWidth) / 2) - playheadOffsetFromCenter
        ) + 120
      : isGallery
        ? timelineOriginOffset
        : Math.max(0, selectedScrubOriginOffset);

  const minOffset = (sizing === 'duration')
    ? timelineOriginOffset - stripEndPixel
    : (sizing === 'uniform')
      ? Math.min(
          -centerX - ((itemCenterPositions[finalIndex] ?? 0) - (itemWidths[finalIndex] ?? uniformItemWidth) / 2),
          -itemCenterPositions[finalIndex] - playheadOffsetFromCenter
        ) - 120
      : isGallery
        ? timelineOriginOffset - stripEndPixel
        : Math.min(finalCenterOffset, selectedScrubOriginOffset - stripEndPixel);
  const snapReferencePositions = React.useMemo(() => (
    (sizing === 'duration' || isGallery)
      ? itemStartPixels.map(startPixel => startPixel - timelineOriginOffset)
      : itemCenterPositions
  ), [itemCenterPositions, itemStartPixels, sizing, isGallery, timelineOriginOffset]);
  // For grid child rows: offset that places the first item at the left edge with small padding
  const gridLeftAlignOffset = hidePreview
    ? clamp(8 - centerX + (uniformItemWidth / 2), minOffset, maxOffset)
    : maxOffset;
  const centeredIndex = getNearestIndexForOffset(offset, snapReferencePositions);
  const centeredItem = items[centeredIndex] ?? null;
  const activePlayingIndex = activePlayingMediaId
    ? items.findIndex(item => item.id === activePlayingMediaId)
    : -1;
  const activePlayingProgress = activePlayingIndex >= 0
    ? clamp(activePlayingElapsedSeconds / Math.max(0.001, itemDurations[activePlayingIndex] ?? 0.5), 0, 1)
    : 0;
  const playbackPlayheadX = activePlayingIndex >= 0
    ? playheadX + offset + (itemStartPixels[activePlayingIndex] ?? 0) - timelineOriginOffset +
      activePlayingProgress * (itemWidths[activePlayingIndex] ?? 0)
    : playheadX;
  const renderedPlayheadX = isSharedPlayheadPlaying && activePlayingIndex >= 0
    ? playbackPlayheadX
    : hidePreview && gridPlayheadRatio !== null
      ? gridPlayheadRatio * viewportSize.width
      : playheadX;
  const stripVisualLeft = playheadX + offset - timelineOriginOffset;
  const isWheelMoving = isDragging || isPlayheadDragging || isSpinning;
  const scrubSnapshot = React.useMemo<GalleryScrubSnapshot | null>(() => {
    if (selectedIndex < 0 || items.length === 0) return null;

    if (isPreviewPlaying && playbackSnapshotTime !== null) {
      const timelineTimeSeconds = clamp(playbackSnapshotTime, 0, totalDurationSeconds);
      let playbackIndex = finalIndex;
      for (let index = 0; index < itemDurations.length; index += 1) {
        const itemEndTime = (itemStartTimes[index] ?? 0) + (itemDurations[index] ?? 0.5);
        if (timelineTimeSeconds < itemEndTime) {
          playbackIndex = index;
          break;
        }
      }

      const media = items[playbackIndex];
      if (media) {
        const elapsedSeconds = Math.max(
          0,
          timelineTimeSeconds - (itemStartTimes[playbackIndex] ?? 0),
        );
        return {
          ...resolveItemSnapshot(media, elapsedSeconds),
          timelineTimeSeconds,
        };
      }
    }

    if (directPreviewMediaId && !isPreviewPlaying) {
      const directIndex = items.findIndex(item => item.id === directPreviewMediaId);
      const media = items[directIndex];
      if (media && !disabledItemIds.includes(media.id)) {
        const resolved = resolveItemSnapshot(media, 0);
        return {
          ...resolved,
          timelineTimeSeconds: itemStartTimes[directIndex] ?? 0,
        };
      }
    }

    const playheadPixel = clamp(
      hidePreview
        ? renderedPlayheadX - playheadX - offset + timelineOriginOffset
        : (sizing === 'duration' || isGallery) ? timelineOriginOffset - offset : -offset,
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

    if (disabledItemIds.includes(items[scrubbedIndex]?.id)) {
      const nextEnabled = items.findIndex((candidate, index) => index > scrubbedIndex && !disabledItemIds.includes(candidate.id));
      if (nextEnabled >= 0) {
        scrubbedIndex = nextEnabled;
      } else {
        for (let index = scrubbedIndex - 1; index >= 0; index -= 1) {
          if (!disabledItemIds.includes(items[index].id)) {
            scrubbedIndex = index;
            break;
          }
        }
      }
    }

    const media = items[scrubbedIndex];
    if (!media) return null;

    const itemStartPixel = itemStartPixels[scrubbedIndex] ?? 0;
    const itemWidth = Math.max(1, itemWidths[scrubbedIndex] ?? 1);
    const progress = clamp((playheadPixel - itemStartPixel) / itemWidth, 0, 1);
    const itemDuration = itemDurations[scrubbedIndex] ?? 0.5;
    const timelineTimeSeconds = (itemStartTimes[scrubbedIndex] ?? 0) + progress * itemDuration;
    const resolved = resolveItemSnapshot(media, progress * itemDuration);

    return { ...resolved, timelineTimeSeconds };
  }, [
    directPreviewMediaId,
    disabledItemIds,
    finalIndex,
    hidePreview,
    itemDurations,
    itemStartPixels,
    itemStartTimes,
    itemWidths,
    items,
    isGallery,
    isPreviewPlaying,
    offset,
    playheadX,
    playbackSnapshotTime,
    renderedPlayheadX,
    resolveItemSnapshot,
    selectedIndex,
    sizing,
    stripEndPixel,
    timelineOriginOffset,
    totalDurationSeconds,
  ]);

  const effectiveScrubSnapshot = React.useMemo<GalleryScrubSnapshot | null>(() => {
    if (externalScrubMediaId && externalScrubSourceTime !== null && externalScrubSourceTime !== undefined) {
      const media = items.find(item => item.id === externalScrubMediaId) ??
        Object.values(itemSequences ?? {})
          .flat()
          .find(item => item.id === externalScrubMediaId);
      if (media) {
        return {
          media,
          sourceTimeSeconds: externalScrubSourceTime,
          timelineTimeSeconds: externalScrubTimelineTime ?? 0,
        };
      }
    }
    return scrubSnapshot;
  }, [externalScrubMediaId, externalScrubSourceTime, externalScrubTimelineTime, itemSequences, scrubSnapshot, items]);

  const onScrubUpdateRef = React.useRef(onScrubUpdate);
  React.useEffect(() => { onScrubUpdateRef.current = onScrubUpdate; }, [onScrubUpdate]);

  const handleGridScrubUpdate = React.useCallback((
    rowIndex: number,
    mediaId: string | null,
    sourceTimeSeconds: number | null,
    rowTimelineTimeSeconds?: number | null,
  ) => {
    if (mediaId !== null && sourceTimeSeconds !== null) {
      activeGridScrubRowRef.current = rowIndex;
      setActiveGridPlayheadRow(rowIndex);
      const rowStartIndex = rowIndex * itemsPerRow;
      const rowStartTime = itemDurations
        .slice(0, rowStartIndex)
        .reduce((sum, duration) => sum + duration, 0);
      onScrubUpdateRef.current?.(
        mediaId,
        sourceTimeSeconds,
        rowStartTime + (rowTimelineTimeSeconds ?? 0),
      );
      return;
    }
    if (activeGridScrubRowRef.current !== rowIndex) return;
    activeGridScrubRowRef.current = null;
  }, [itemDurations, itemsPerRow]);

  React.useEffect(() => {
    if (gridView) return;
    const publishScrubUpdate = onScrubUpdateRef.current;
    if (publishScrubUpdate) {
      if (scrubSnapshot && isWheelMoving) {
        publishScrubUpdate(
          scrubSnapshot.media.id,
          scrubSnapshot.sourceTimeSeconds,
          scrubSnapshot.timelineTimeSeconds,
        );
      } else if (!isWheelMoving) {
        publishScrubUpdate(null, null);
      }
    }
  }, [gridView, scrubSnapshot, isWheelMoving]);

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
        effectiveScrubSnapshot?.media.id === selectedMediaId;

      setTrimOverlayMediaId(current => {
        const next = canShowTrim ? selectedMediaId : null;
        return current === next ? current : next;
      });
    };

    document.addEventListener('pointermove', handleDisplayHover, true);
    return () => document.removeEventListener('pointermove', handleDisplayHover, true);
  }, [effect, effectiveScrubSnapshot?.media.id, selectedItemType, selectedMediaId]);

  const setOffset = React.useCallback((nextOffset: number) => {
    const boundedOffset = clamp(nextOffset, minOffset, maxOffset);
    offsetRef.current = boundedOffset;
    setOffsetState(boundedOffset);
  }, [maxOffset, minOffset]);

  const scrubWithPlayhead = React.useCallback((
    nextPlayheadX: number,
    originPlayheadX: number,
    originOffset: number,
  ) => {
    const boundedPlayheadX = clamp(
      nextPlayheadX,
      32,
      Math.max(32, viewportSize.width - 32),
    );
    const nextRatio = boundedPlayheadX / Math.max(1, viewportSize.width);
    playheadPositionRatioRef.current = nextRatio;
    setPlayheadPositionRatio(nextRatio);
    if (hidePreview) setGridPlayheadRatio(nextRatio);
    setOffset(originOffset - (boundedPlayheadX - originPlayheadX));
    setDirectPreviewMediaId(null);
  }, [hidePreview, setOffset, viewportSize.width]);

  React.useLayoutEffect(() => {
    const wasPlaying = wasPreviewPlayingRef.current;
    wasPreviewPlayingRef.current = isPreviewPlaying;
    if (isPreviewPlaying) return;

    const nextTime = wasPlaying
      ? playbackTimeRef.current
      : effectiveScrubSnapshot?.timelineTimeSeconds ?? 0;
    playbackTimeRef.current = nextTime;
    playbackSelectedMediaIdRef.current = selectedMediaId;
    if (prominentTimestampRef.current) {
      prominentTimestampRef.current.textContent = formatPlaybackTimestamp(
        nextTime,
        totalDurationSeconds,
      );
    }
  }, [effectiveScrubSnapshot?.timelineTimeSeconds, isPreviewPlaying, selectedMediaId, totalDurationSeconds]);

  React.useEffect(() => {
    if (hidePreview) return;
    if (!isPreviewPlaying || totalDurationSeconds <= 0) {
      playbackResolvedMediaKeyRef.current = null;
      return;
    }

    let lastTime = performance.now();
    const tick = (now: number) => {
      const deltaSeconds = Math.max(0, (now - lastTime) / 1000);
      lastTime = now;
      let nextTime = playbackTimeRef.current + deltaSeconds;
      let didLoop = false;

      if (nextTime >= totalDurationSeconds) {
        if (loopPreviewPlayback) {
          nextTime %= totalDurationSeconds;
          didLoop = true;
        } else {
          playbackTimeRef.current = totalDurationSeconds;
          if (prominentTimestampRef.current) {
            prominentTimestampRef.current.textContent = formatPlaybackTimestamp(
              totalDurationSeconds,
              totalDurationSeconds,
            );
          }
          onPreviewPlaybackComplete?.();
          return;
        }
      }

      playbackTimeRef.current = nextTime;
      if (prominentTimestampRef.current) {
        prominentTimestampRef.current.textContent = formatPlaybackTimestamp(
          nextTime,
          totalDurationSeconds,
        );
      }
      let playbackIndex = finalIndex;
      for (let index = 0; index < itemDurations.length; index += 1) {
        const itemEndTime = (itemStartTimes[index] ?? 0) + (itemDurations[index] ?? 0.5);
        if (nextTime < itemEndTime) {
          playbackIndex = index;
          break;
        }
      }

      const playbackItem = items[playbackIndex];
      if (playbackItem) {
        const itemElapsedSeconds = Math.max(
          0,
          nextTime - (itemStartTimes[playbackIndex] ?? 0),
        );
        onPlaybackTimeUpdate?.(playbackItem.id, itemElapsedSeconds);
        const resolvedMedia = resolveItemSnapshot(playbackItem, itemElapsedSeconds).media;
        const resolvedMediaKey = `${playbackIndex}:${resolvedMedia.id}`;
        if (didLoop || playbackResolvedMediaKeyRef.current !== resolvedMediaKey) {
          playbackResolvedMediaKeyRef.current = resolvedMediaKey;
          setPlaybackSnapshotTime(nextTime);
        }
      }

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
    resolveItemSnapshot,
    setOffset,
    sizing,
    timelineOriginOffset,
    totalDurationSeconds,
    hidePreview,
    onPlaybackTimeUpdate,
  ]);

  const updateFastNavigation = React.useCallback((velocity: number) => {
    const speed = Math.abs(velocity);
    const nextFastNavigation = fastNavigationRef.current
      ? speed > FAST_NAVIGATION_EXIT_VELOCITY
      : speed >= FAST_NAVIGATION_ENTER_VELOCITY;

    if (nextFastNavigation === fastNavigationRef.current) return;
    fastNavigationRef.current = nextFastNavigation;
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

  const beginPlayheadDrag = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopAnimation();
    playheadDragRef.current = {
      isDragging: true,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startPlayheadX: renderedPlayheadX,
      startOffset: offsetRef.current,
    };
    setIsPlayheadDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [renderedPlayheadX, stopAnimation]);

  const movePlayheadDrag = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = playheadDragRef.current;
    if (!drag.isDragging || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (hidePreview) {
      seekGridPlayheadToXRef.current(
        drag.startPlayheadX + event.clientX - drag.startClientX,
      );
      return;
    }
    scrubWithPlayhead(
      drag.startPlayheadX + event.clientX - drag.startClientX,
      drag.startPlayheadX,
      drag.startOffset,
    );
  }, [hidePreview, scrubWithPlayhead]);

  const endPlayheadDrag = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = playheadDragRef.current;
    if (!drag.isDragging || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    playheadDragRef.current.isDragging = false;
    setIsPlayheadDragging(false);
    localStorage.setItem(
      'scene-launch-playhead-position',
      String(hidePreview ? gridPlayheadRatio ?? playheadPositionRatioRef.current : playheadPositionRatioRef.current),
    );
  }, [gridPlayheadRatio, hidePreview]);

  const handlePlayheadKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextPlayheadX: number | null = null;
    const currentPlayheadX = hidePreview ? renderedPlayheadX : playheadX;
    const edgeInset = hidePreview ? 8 : 32;
    if (event.key === 'ArrowLeft') nextPlayheadX = currentPlayheadX - (event.shiftKey ? 24 : 8);
    if (event.key === 'ArrowRight') nextPlayheadX = currentPlayheadX + (event.shiftKey ? 24 : 8);
    if (event.key === 'Home') nextPlayheadX = edgeInset;
    if (event.key === 'End') nextPlayheadX = Math.max(edgeInset, viewportSize.width - edgeInset);
    if (nextPlayheadX === null) return;

    event.preventDefault();
    event.stopPropagation();
    stopAnimation();
    if (hidePreview) {
      seekGridPlayheadToXRef.current(nextPlayheadX);
      return;
    }
    scrubWithPlayhead(nextPlayheadX, playheadX, offsetRef.current);
    const nextRatio = clamp(nextPlayheadX, 32, Math.max(32, viewportSize.width - 32)) /
      Math.max(1, viewportSize.width);
    localStorage.setItem('scene-launch-playhead-position', String(nextRatio));
  }, [hidePreview, playheadX, renderedPlayheadX, scrubWithPlayhead, stopAnimation, viewportSize.width]);

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
  }, [itemCenterPositions, itemStartPixels, items, maxOffset, minOffset, onCenteredMediaChange, selectedMediaId, setOffset, sizing, timelineOriginOffset, updateFastNavigation]);

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
  }, [items, minOffset, maxOffset, selectedMediaId, setOffset, onCenteredMediaChange, itemDurations, itemStartTimes]);

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
      (isPreviewPlaying && !hidePreview) ||
      pendingReorderSelectionRef.current ||
      skipNextReorderAlignmentRef.current
    ) return;
    if (hidePreview) {
      const frame = window.requestAnimationFrame(() => setOffset(gridLeftAlignOffset));
      return () => window.cancelAnimationFrame(frame);
    }
    if (selectedIndex < 0) {
      return;
    }
    snapToIndexRef.current(selectedIndex, { commit: false });
  }, [isPreviewPlaying, selectedIndex, selectedMediaId, hidePreview, gridLeftAlignOffset, setOffset]);

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
      (isPreviewPlaying && !hidePreview) ||
      pendingReorderSelectionRef.current ||
      skipNextReorderAlignmentRef.current ||
      skipNextSelectedAlignmentRef.current ||
      dragRef.current.isDragging ||
      momentumFrameRef.current !== null ||
      snapFrameRef.current !== null
    ) {
      return;
    }

    if (hidePreview) {
      const frame = window.requestAnimationFrame(() => setOffset(gridLeftAlignOffset));
      return () => window.cancelAnimationFrame(frame);
    }

    if (selectedIndex < 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setOffset((sizing === 'duration' || isGallery)
        ? timelineOriginOffset - (itemStartPixels[selectedIndex] ?? 0)
        : -(itemCenterPositions[selectedIndex] ?? 0));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isPreviewPlaying, itemCenterPositions, itemStartPixels, selectedIndex, setOffset, sizing, isGallery, timelineOriginOffset, hidePreview, gridLeftAlignOffset]);

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
  }, [collectionItemIds, items, prepareFixedCenterPreview]);

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
      utilityAction: null,
    };
    clickGuardRef.current = false;
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
          // Imperatively compute scrub position and notify parent immediately
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
  }, [items, onItemsReorder, prepareFixedCenterPreview, setOffset, startReorderAutoPan, updateFastNavigation, updateReorderTarget, minOffset, maxOffset, sizing, isGallery, hidePreview, playheadX, renderedPlayheadX, timelineOriginOffset, stripEndPixel, finalIndex, itemStartPixels, itemStartTimes, itemWidths, itemDurations, disabledItemIds, resolveItemSnapshot]);

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
  }, [clearClickGuardSoon, collectionItemIds, getCenteredMediaIdForOrder, hidePreview, itemStartTimes, items, onCenteredMediaChange, onCollectionOpen, onItemMoveIntoCollection, onItemsReorder, onUtilityDrop, reorderPreview, selectReorderedItem, selectedMediaId, setOffset, sizing, slideOnClick, snapToIndex, spinWithMomentum]);

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
    if (!hidePreview) snapToIndex(boundedIndex);
    focusItem(boundedIndex);
  }, [focusItem, hidePreview, items.length, snapToIndex, stopAnimation]);

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

  const seekGridPlayheadToX = React.useCallback((nextPlayheadX: number) => {
    const boundedPlayheadX = clamp(nextPlayheadX, 8, Math.max(8, viewportSize.width - 8));
    const timelinePixel = clamp(
      boundedPlayheadX - playheadX - offsetRef.current + timelineOriginOffset,
      0,
      stripEndPixel,
    );
    let itemIndex = finalIndex;
    for (let index = 0; index < items.length; index += 1) {
      const itemEndPixel = (itemStartPixels[index] ?? 0) + (itemWidths[index] ?? 0);
      if (timelinePixel <= itemEndPixel) {
        itemIndex = index;
        break;
      }
    }

    const media = items[itemIndex];
    setGridPlayheadRatio(boundedPlayheadX / Math.max(1, viewportSize.width));
    if (!media || disabledItemIds.includes(media.id)) return;
    const itemStartPixel = itemStartPixels[itemIndex] ?? 0;
    const itemWidth = Math.max(1, itemWidths[itemIndex] ?? 1);
    const progress = clamp((timelinePixel - itemStartPixel) / itemWidth, 0, 1);
    const itemDuration = itemDurations[itemIndex] ?? 0.5;
    const elapsedSeconds = progress * itemDuration;
    const resolved = resolveItemSnapshot(media, elapsedSeconds);

    playbackTimeRef.current = (itemStartTimes[itemIndex] ?? 0) + elapsedSeconds;
    onScrubUpdateRef.current?.(
      resolved.media.id,
      resolved.sourceTimeSeconds,
      playbackTimeRef.current,
    );
  }, [disabledItemIds, finalIndex, itemDurations, itemStartPixels, itemStartTimes, itemWidths, items, playheadX, resolveItemSnapshot, stripEndPixel, timelineOriginOffset, viewportSize.width]);

  React.useLayoutEffect(() => {
    seekGridPlayheadToXRef.current = seekGridPlayheadToX;
  }, [seekGridPlayheadToX]);

  const handleGridSeekRailClick = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.detail === 0) return;
    const viewportBounds = viewportRef.current?.getBoundingClientRect();
    if (!viewportBounds) return;
    seekGridPlayheadToX(event.clientX - viewportBounds.left);
  }, [seekGridPlayheadToX]);

  const handleGridSeekRailKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    const currentX = (gridPlayheadRatio ?? playheadPositionRatioRef.current) * viewportSize.width;
    let nextX: number | null = null;
    if (event.key === 'ArrowLeft') nextX = currentX - (event.shiftKey ? 24 : 8);
    if (event.key === 'ArrowRight') nextX = currentX + (event.shiftKey ? 24 : 8);
    if (event.key === 'Home') nextX = 8;
    if (event.key === 'End') nextX = Math.max(8, viewportSize.width - 8);
    if (nextX === null) return;
    event.preventDefault();
    event.stopPropagation();
    seekGridPlayheadToX(nextX);
  }, [gridPlayheadRatio, seekGridPlayheadToX, viewportSize.width]);

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

  const resizeGridDisplayPanel = React.useCallback((nextHeight: number) => {
    setGridDisplayPanelHeight(clamp(
      nextHeight,
      minGridDisplayPanelHeight,
      maxGridDisplayPanelHeight,
    ));
  }, [maxGridDisplayPanelHeight]);

  const beginGridPanelResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    gridPanelResizeRef.current = {
      isDragging: true,
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startHeight: boundedGridDisplayPanelHeight,
    };
    setIsGridPanelResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [boundedGridDisplayPanelHeight]);

  const moveGridPanelResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const resize = gridPanelResizeRef.current;
    if (!resize.isDragging || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    resizeGridDisplayPanel(resize.startHeight + event.clientY - resize.startClientY);
  }, [resizeGridDisplayPanel]);

  const endGridPanelResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const resize = gridPanelResizeRef.current;
    if (!resize.isDragging || resize.pointerId !== event.pointerId) return;
    resize.isDragging = false;
    setIsGridPanelResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    localStorage.setItem(
      'scene-launch-grid-display-panel-height',
      String(gridDisplayPanelHeight),
    );
  }, [gridDisplayPanelHeight]);

  const handleGridPanelResizeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextHeight: number | null = null;
    if (event.key === 'ArrowUp') nextHeight = boundedGridDisplayPanelHeight - (event.shiftKey ? 32 : 8);
    if (event.key === 'ArrowDown') nextHeight = boundedGridDisplayPanelHeight + (event.shiftKey ? 32 : 8);
    if (event.key === 'Home') nextHeight = minGridDisplayPanelHeight;
    if (event.key === 'End') nextHeight = maxGridDisplayPanelHeight;
    if (nextHeight === null) return;
    event.preventDefault();
    resizeGridDisplayPanel(nextHeight);
    localStorage.setItem('scene-launch-grid-display-panel-height', String(nextHeight));
  }, [boundedGridDisplayPanelHeight, maxGridDisplayPanelHeight, resizeGridDisplayPanel]);

  const renderPlayer = () => {
    if (!isGallery || hidePreview || !effectiveScrubSnapshot) return null;
    return (
      <div
        className={cn(
          "relative flex min-h-0 flex-col items-center justify-center p-2 pb-1.5",
          gridView ? "w-full bg-[#0c0c0e] pt-1 pb-1 px-1.5" : "flex-1"
        )}
      >
        {/* Playback Controls above display area */}
        <div className={cn("mb-2 flex shrink-0 justify-center", gridView && "mb-1")}>
          <div className="flex items-center justify-center gap-2 rounded-full border border-white/5 bg-zinc-900/40 px-2.5 py-1 shadow-md backdrop-blur-md">
            {/* Go to First Button */}
            <button
              type="button"
              onClick={() => snapToIndex(0)}
              disabled={centeredIndex === 0}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30',
                'text-zinc-400 hover:bg-white/5 hover:text-white'
              )}
              title="Go to First Item"
              aria-label="Go to First Item"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>

            {/* Go to Previous Button */}
            <button
              type="button"
              onClick={() => snapToIndex(centeredIndex - 1)}
              disabled={centeredIndex === 0}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30',
                'text-zinc-400 hover:bg-white/5 hover:text-white'
              )}
              title="Go to Previous Item"
              aria-label="Go to Previous Item"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>

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

            {/* Go to Next Button */}
            <button
              type="button"
              onClick={() => snapToIndex(centeredIndex + 1)}
              disabled={centeredIndex === items.length - 1}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30',
                'text-zinc-400 hover:bg-white/5 hover:text-white'
              )}
              title="Go to Next Item"
              aria-label="Go to Next Item"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>

            {/* Go to Last Button */}
            <button
              type="button"
              onClick={() => snapToIndex(items.length - 1)}
              disabled={centeredIndex === items.length - 1}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30',
                'text-zinc-400 hover:bg-white/5 hover:text-white'
              )}
              title="Go to Last Item"
              aria-label="Go to Last Item"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
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

            {/* Playhead Center Reset */}
            <button
              type="button"
              onClick={centerPlayhead}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 cursor-pointer',
                Math.abs(playheadPositionRatio - 0.5) > 0.001
                  ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                  : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
              )}
              title="Center playhead"
              aria-label="Center playhead"
            >
              <AlignCenter className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Display Area */}
        <div
          ref={galleryPreviewRef}
          className="relative overflow-hidden rounded-md border border-white/10 bg-black shadow-2xl shadow-black/60"
          style={{ height: galleryPreviewHeight, width: galleryPreviewWidth }}
        >
          <GalleryCanvasPreview
            snapshot={effectiveScrubSnapshot}
            isPlaying={isPreviewPlaying}
          />
          {effectiveScrubSnapshot.media.id === selectedMediaId &&
            effectiveScrubSnapshot.media.type === 'video' &&
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
                {renderGalleryTrimOverlay(effectiveScrubSnapshot.media)}
              </div>
            )}
        </div>

        {/* Timestamp below player */}
        <div className={cn("mt-2 text-center", gridView && "mt-1")}>
          <div
            ref={prominentTimestampRef}
            role="timer"
            aria-live="off"
            aria-label="Playback time"
            className="inline-block rounded border border-indigo-400/20 bg-black/70 px-3 py-1 font-mono text-xs font-black tabular-nums tracking-wide text-indigo-100 shadow-lg shadow-black/40"
          >
            {formatPlaybackTimestamp(effectiveScrubSnapshot.timelineTimeSeconds, totalDurationSeconds)}
          </div>
        </div>
      </div>
    );
  };

  if (items.length === 0) return null;

  return (
    <div
      ref={containerRefCallback}
      className={cn(
        "relative flex min-h-0 w-full",
        hidePreview
          ? "h-auto items-center justify-center overflow-hidden py-0.5 px-0 bg-transparent"
          : gridView
            ? "h-full items-start justify-start overflow-y-auto px-4 [scrollbar-gutter:stable]"
            : "items-center justify-center overflow-hidden px-4",
        !hidePreview && gridView
          ? "h-full pt-1.5 pb-2.5 bg-black"
          : !hidePreview
            ? "h-full py-3 bg-black"
            : ""
      )}
    >
      <div className={cn(
        "min-h-0 w-full overflow-hidden rounded-md",
        hidePreview
          ? "bg-transparent shadow-none border-none h-auto"
          : "bg-[#0c0c0e]/85 shadow-lg",
        hidePreview
          ? "h-auto"
          : gridView
            ? "flex min-h-full flex-col overflow-visible"
            : isGallery
              ? "flex h-full flex-col"
              : "h-full"
      )}>
        {gridView && !hidePreview ? (
          <div className="sticky top-0 z-40 flex w-full shrink-0 flex-col bg-[#0c0c0e] shadow-md">
            <div
              className="flex w-full shrink-0 items-center justify-center overflow-hidden bg-[#0c0c0e]"
              style={{ height: boundedGridDisplayPanelHeight }}
            >
              {renderPlayer()}
            </div>
            <div
              role="separator"
              aria-label="Resize display and wheel panels"
              aria-orientation="horizontal"
              aria-valuemin={minGridDisplayPanelHeight}
              aria-valuemax={maxGridDisplayPanelHeight}
              aria-valuenow={Math.round(boundedGridDisplayPanelHeight)}
              tabIndex={0}
              onPointerDown={beginGridPanelResize}
              onPointerMove={moveGridPanelResize}
              onPointerUp={endGridPanelResize}
              onPointerCancel={endGridPanelResize}
              onLostPointerCapture={endGridPanelResize}
              onKeyDown={handleGridPanelResizeKeyDown}
              className={cn(
                'group relative z-40 flex h-3 w-full shrink-0 touch-none cursor-row-resize items-center justify-center border-y border-zinc-800 bg-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400',
                isGridPanelResizing && 'bg-zinc-900',
              )}
            >
              <span className="h-1 w-12 rounded-full bg-zinc-600 transition-colors group-hover:bg-zinc-400 group-focus-visible:bg-indigo-300" />
            </div>
            <div className="z-30 flex w-full shrink-0 items-center border-b border-zinc-800/60 bg-[#0c0c0e] px-4 py-2 shadow-md">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {onNavigateBack && !isFirstGridRow && (
                  <button
                    type="button"
                    title={canNavigateBack ? (parentCollectionName ? `Back to ${parentCollectionName}` : 'Back to parent collection') : 'No parent collection'}
                    aria-label={canNavigateBack ? (parentCollectionName ? `Back to ${parentCollectionName}` : 'Back to parent collection') : 'No parent collection'}
                    disabled={!canNavigateBack}
                    onClick={(event) => {
                      event.stopPropagation();
                      onNavigateBack();
                    }}
                    className="group relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {canNavigateBack && parentCollectionThumbnailUrl ? (
                      <>
                        <img
                          src={parentCollectionThumbnailUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover opacity-60 transition-opacity duration-200 group-hover:opacity-80"
                        />
                        <div className="absolute inset-0 bg-black/40 transition-colors duration-200 group-hover:bg-black/25" />
                        <ArrowLeft className="relative z-10 h-4 w-4 text-white drop-shadow-[0_1.5px_2px_rgba(0,0,0,0.85)] transition-transform duration-200 group-hover:-translate-x-0.5" />
                      </>
                    ) : (
                      <ArrowLeft className="h-4 w-4" />
                    )}
                  </button>
                )}
                {breadcrumbs && breadcrumbs.length > 0 ? (
                  <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs font-bold text-zinc-400 select-none">
                    {breadcrumbs.map((crumb, idx) => {
                      const isLast = idx === breadcrumbs.length - 1;
                      return (
                        <React.Fragment key={crumb.id}>
                          {idx > 0 && <span className="text-zinc-600 text-[10px] select-none font-mono">/</span>}
                          {isLast ? (
                            <span className="text-zinc-100 font-black truncate max-w-[150px]">
                              {crumb.name}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onBreadcrumbClick?.(idx)}
                              className="hover:text-zinc-200 transition-colors truncate max-w-[120px] font-black"
                            >
                              {crumb.name}
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                      {rowTitle || 'Current Collection'}
                    </span>
                    <span className="text-xs font-black text-zinc-200">
                      {currentCollectionName || 'Workspace'}
                    </span>
                  </div>
                )}
              </div>
              {onBreakoutCollectionsChange && (
                <div className="ml-auto flex shrink-0 items-center gap-2 pl-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  <span>Break out by collection</span>
                  <Switch
                    size="sm"
                    checked={breakoutCollectionsEnabled}
                    onCheckedChange={onBreakoutCollectionsChange}
                    aria-label="Break out by collection"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          renderPlayer()
        )}



        {gridView ? (
          <div className={cn(
            "flex shrink-0 flex-col overflow-visible px-0 bg-zinc-950/40",
            customChunks ? "gap-10 py-6" : "gap-6 py-4",
            !hidePreview && "border-t border-zinc-900",
          )}>
            {chunks.map((chunk, chunkIndex) => (
              <SceneLaunchPreviewWheelV3
                key={`chunk-${chunkIndex}`}
                items={chunk}
                itemSequences={itemSequences}
                itemSequenceThumbnails={itemSequenceThumbnails}
                onCollectionOpen={onCollectionOpen}
                selectedMediaId={selectedMediaId}
                effect={effect}
                sizing="uniform"
                durationScale={durationScale}
                selectedItemDurationSeconds={selectedItemDurationSeconds}
                selectedItemTrimStartSeconds={selectedItemTrimStartSeconds}
                onSelectedItemDurationChange={onSelectedItemDurationChange}
                onSelectedItemDurationChangeEnd={onSelectedItemDurationChangeEnd}
                onCenteredMediaChange={onCenteredMediaChange}
                renderSelectedItemOverlay={renderSelectedItemOverlay}
                renderGalleryTrimOverlay={renderGalleryTrimOverlay}
                isPreviewPlaying={false}
                playheadIsPlaying={isPreviewPlaying}
                loopPreviewPlayback={loopPreviewPlayback}
                onPreviewPlaybackComplete={onPreviewPlaybackComplete}
                onPlaybackMediaChange={onPlaybackMediaChange}
                onItemsReorder={onItemsReorder}
                collectionItemIds={collectionItemIds}
                onItemMoveIntoCollection={onItemMoveIntoCollection}
                disabledItemIds={disabledItemIds}
                onUtilityDrop={onUtilityDrop}
                selectReorderedItem={selectReorderedItem}
                onTogglePlayback={onTogglePlayback}
                onToggleLoop={onToggleLoop}
                showUniformRuler={showUniformRuler}
                slideOnClick={slideOnClick}
                rowTitle={breakoutTitles?.[chunkIndex]}
                rowIconUrl={breakoutRepresentativeUrls?.[chunkIndex] || undefined}
                rowIsCollection={breakoutIsCollection?.[chunkIndex]}
                gridView={false}
                gridColumnCount={itemsPerRow}
                showPlayhead={visibleGridPlayheadRow === chunkIndex}
                hidePreview={true}
                hideTrack={false}
                activePlayingMediaId={activePlayingMediaId}
                activePlayingElapsedSeconds={activePlayingElapsedSeconds}
                onScrubUpdate={(mediaId, sourceTimeSeconds, timelineTimeSeconds) => {
                  handleGridScrubUpdate(chunkIndex, mediaId, sourceTimeSeconds, timelineTimeSeconds);
                }}
              />
            ))}
          </div>
        ) : (
          !hideTrack && (
            <div
              ref={viewportRefCallback}
              aria-label="Timeline media wheel"
              className={cn(
                "relative flex items-center overflow-hidden",
                (isGallery || hidePreview) ? cn("shrink-0 bg-zinc-950/20", !hidePreview && "border-t border-zinc-900") : "h-full min-h-0",
                reorderPreview ? "cursor-grabbing select-none" : isDragging ? "cursor-grabbing select-none" : "cursor-grab"
              )}
              style={{
                perspective: 1200,
                touchAction: hidePreview ? 'pan-y' : 'none',
                ...((isGallery || hidePreview) ? { height: rowHeight } : {}),
              }}
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onKeyDown={handleKeyboardNavigation}
            >
              {hidePreview && (
                <>
                  <div
                    className={cn(
                      "absolute left-0 right-0 top-0 z-[20] h-8 cursor-ew-resize pointer-events-auto flex items-center pl-4",
                      rowIsCollection
                        ? "bg-zinc-900/35 border-b border-indigo-950/45"
                        : "bg-zinc-900/60 border-b border-zinc-800"
                    )}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseMove={handleRulerMouseMove}
                    onMouseLeave={handleRulerMouseLeave}
                      onClick={handleGridSeekRailClick}
                    >
                      {rowIsCollection && (
                        <div className="absolute inset-y-0 left-0 w-1 rounded-r bg-indigo-400" />
                      )}
                      {rowTitle && (
                        <span className={cn(
                          "pointer-events-none flex select-none items-center font-mono font-black uppercase",
                          rowIsCollection
                            ? "gap-2 text-xs tracking-widest text-indigo-100"
                            : "gap-1.5 text-[10px] tracking-wider text-zinc-500/95"
                        )}>
                          {rowIsCollection ? (
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-indigo-400/50 bg-indigo-500/20 shadow-sm shadow-indigo-950/60">
                              <Folder className="size-4 text-indigo-200" />
                            </span>
                          ) : (
                            <Clapperboard className="h-3.5 w-3.5 text-zinc-500/80" />
                          )}
                          <span className={cn(rowIsCollection && "[text-box:trim-both_cap_alphabetic]")}>
                            {rowTitle}
                          </span>
                        </span>
                      )}
                  </div>
                  {rulerHoveredX !== null && (
                    <div
                      className="pointer-events-none absolute bottom-0 z-[195] w-px bg-indigo-400/50 shadow-[0_0_6px_rgba(129,140,248,0.7)]"
                      style={{
                        left: rulerHoveredX,
                        top: 0,
                        height: rowHeight,
                      }}
                    />
                  )}
                </>
              )}
          <div className="sr-only" aria-live="polite">
            {centeredItem ? `Centered media ${centeredItem.name}` : 'Timeline media wheel'}
          </div>
          {reorderPreview && typeof document !== 'undefined' && (() => {
            const item = items.find(candidate => candidate.id === reorderPreview.mediaId);
            if (!item) return null;
            return createPortal(
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none fixed left-0 top-0 z-[310] grid w-[360px] grid-cols-4 gap-2 rounded-xl border border-zinc-700/90 bg-zinc-950/95 p-3 shadow-2xl shadow-black/70"
                  style={{
                    transform: `translate3d(${reorderPreview.trayX}px, ${reorderPreview.trayY}px, 0) translate(-50%, -100%)`,
                  }}
                >
                  {([
                    ['parent', 'Parent', CornerUpLeft],
                    ['trash', 'Trash', Trash2],
                    ['disable', 'Disable', Ban],
                    ['directory', 'Directory', FolderInput],
                  ] as const).map(([action, label, Icon]) => (
                    <div
                      key={action}
                      data-wheel-utility-target={action}
                      className={cn(
                        'flex h-16 min-w-0 flex-col items-center justify-center rounded-lg border border-dashed text-zinc-300 transition-colors',
                        utilityDropTarget === action
                          ? action === 'trash'
                            ? 'border-red-400 bg-red-500/25 text-red-100'
                            : action === 'disable'
                              ? 'border-amber-400 bg-amber-500/25 text-amber-100'
                              : 'border-indigo-400 bg-indigo-500/25 text-indigo-100'
                          : 'border-zinc-700 bg-zinc-900/90',
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="mt-1.5 text-[9px] font-black uppercase tracking-wider">
                        {action === 'disable' && disabledItemIds.includes(reorderPreview.mediaId) ? 'Enable' : label}
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  ref={reorderGhostRef}
                  aria-hidden="true"
                  className="pointer-events-none fixed z-[300]"
                  style={{
                    left: 0,
                    top: 0,
                    width: reorderPreview.width,
                    height: reorderPreview.height,
                    transform: `translate3d(${reorderPreview.clientX}px, ${reorderPreview.clientY}px, 0) translate(-50%, -50%) scale(1.03)`,
                    willChange: 'transform',
                  }}
                >
                  <div
                    ref={reorderGhostContentRef}
                    className="relative h-full w-full overflow-hidden rounded-md border-2 border-indigo-300 bg-zinc-900 shadow-2xl shadow-black/70 ring-2 ring-indigo-400/40"
                    style={{ transformOrigin: 'center center', willChange: 'transform' }}
                  >
                    {collectionItemIds.includes(item.id) ? (
                      <div className="absolute inset-0 bg-zinc-900/40 p-1 select-none pointer-events-none flex items-center justify-center">
                        <div className="h-[96%] aspect-square relative flex items-center justify-center">
                          {/* Stack Circle 4 (bottom-most) */}
                          <div className="absolute inset-0 rounded-full border border-zinc-800 bg-zinc-900/80 translate-x-[6px] -translate-y-[6px] opacity-50 scale-[0.97] shadow-sm z-0" />
                          {/* Stack Circle 3 (middle-bottom) */}
                          <div className="absolute inset-0 rounded-full border border-zinc-800/80 bg-zinc-900/90 translate-x-[4px] -translate-y-[4px] opacity-75 scale-[0.98] shadow-sm z-[3]" />
                          {/* Stack Circle 2 (middle-top) */}
                          <div className="absolute inset-0 rounded-full border border-zinc-700 bg-zinc-800 translate-x-[2px] -translate-y-[2px] opacity-90 scale-[0.99] shadow-md z-[6]" />
                          {/* Top Circle 1 (main cover) */}
                          <div className="relative w-full h-full rounded-full border-2 border-zinc-600/70 shadow-lg overflow-hidden bg-zinc-950 z-10 flex items-center justify-center">
                            {item.type === 'video' ? (
                              <img src={item.posterUrl || VIDEO_PLACEHOLDER} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                            )}
                          </div>
                        </div>
                        <div className="absolute top-2 left-2 flex items-center justify-center rounded-full bg-black/60 p-1.5 text-indigo-300 border border-zinc-800/30 z-20">
                          <Folder className="h-2.5 w-2.5" />
                        </div>
                      </div>
                    ) : (
                      item.type === 'video' ? (
                        <img src={item.posterUrl || VIDEO_PLACEHOLDER} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                      )
                    )}
                    <div className="absolute inset-0 bg-indigo-500/10" />
                  </div>
                </div>
              </>,
              document.body,
            );
          })()}

          {showPlayhead && isSharedPlayheadPlaying && (sizing === 'duration' || isGallery) && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-[190] w-0"
              style={{ left: renderedPlayheadX }}
            >
              <div className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.95)]" />
            </div>
          )}
          {showPlayhead && !isSharedPlayheadPlaying && (sizing === 'duration' || isGallery) && (
            <div
              className="pointer-events-none absolute z-[190]"
              style={{
                left: renderedPlayheadX,
                top: itemTop,
                height: itemHeight,
                width: 0,
              }}
            >
              <button
                type="button"
                aria-label={`Drag playhead, currently ${formatRulerSeconds(rulerPlayheadTimeSeconds)}`}
                title="Drag to scrub. Use arrow keys for fine adjustment."
                onPointerDown={beginPlayheadDrag}
                onPointerMove={movePlayheadDrag}
                onPointerUp={endPlayheadDrag}
                onPointerCancel={endPlayheadDrag}
                onLostPointerCapture={endPlayheadDrag}
                onKeyDown={handlePlayheadKeyDown}
                className={cn(
                  'pointer-events-auto absolute left-0 top-0 flex h-8 w-10 -translate-x-1/2 -translate-y-full touch-none items-end justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200',
                  isPlayheadDragging ? 'cursor-grabbing' : 'cursor-ew-resize',
                )}
              >
                <span className="h-0 w-0 border-x-[15px] border-t-[20px] border-x-transparent border-t-indigo-500 drop-shadow-[0_3px_4px_rgba(0,0,0,0.7)]" />
              </button>
              {onNavigateBack && !isFirstGridRow && (
                <button
                  type="button"
                  title={canNavigateBack ? (parentCollectionName ? `Back to ${parentCollectionName}` : 'Back to parent collection') : 'No parent collection'}
                  aria-label={canNavigateBack ? (parentCollectionName ? `Back to ${parentCollectionName}` : 'Back to parent collection') : 'No parent collection'}
                  disabled={!canNavigateBack}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNavigateBack();
                  }}
                  className="group pointer-events-auto absolute right-7 top-0 flex h-6 w-6 -translate-y-full items-center justify-center overflow-hidden rounded-full border border-indigo-300/40 bg-indigo-500 text-white shadow-lg shadow-black/50 transition-colors hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {canNavigateBack && parentCollectionThumbnailUrl ? (
                    <>
                      <img
                        src={parentCollectionThumbnailUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover opacity-60 transition-opacity duration-200 group-hover:opacity-85"
                      />
                      <div className="absolute inset-0 bg-black/35 transition-colors duration-200 group-hover:bg-black/20" />
                      <ArrowLeft className="relative z-10 h-3.5 w-3.5 text-white drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.85)] transition-transform duration-200 group-hover:-translate-x-0.5" />
                    </>
                  ) : (
                    <ArrowLeft className="h-3 w-3" />
                  )}
                </button>
              )}
              <div aria-hidden="true" className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-indigo-300 shadow-[0_0_8px_rgba(165,180,252,0.9)]" />
            </div>
          )}
          {showPlayhead && !isSharedPlayheadPlaying && (sizing === 'duration' || isGallery) && (
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
          {!hidePreview && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-1/5 bg-gradient-to-r from-black/62 via-black/28 to-transparent"
            />
          )}
          <div className="absolute inset-0 will-change-transform" style={{ transformStyle: 'preserve-3d' }}>
            {items.map((item, index) => {
              const thumbnailItem = scrubSnapshot
                ? itemSequenceThumbnails?.[item.id]?.[scrubSnapshot.media.id] ?? item
                : item;
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
              const progressTimelineTime = scrubSnapshot?.timelineTimeSeconds ?? 0;
              const isCurrentPlaying = activePlayingMediaId !== null && item.id === activePlayingMediaId;
              const itemElapsedSeconds = isCurrentPlaying
                ? activePlayingElapsedSeconds
                : clamp(
                    progressTimelineTime - itemStartTime,
                    0,
                    itemDuration,
                  );
              const itemProgress = itemDuration > 0
                ? clamp(itemElapsedSeconds / itemDuration, 0, 1)
                : 0;
              const isItemProgressPlaying = isCurrentPlaying
                ? isPreviewPlaying
                : isPreviewPlaying &&
                  itemDuration > 0 &&
                  progressTimelineTime >= itemStartTime &&
                  progressTimelineTime < itemEndTime;
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

              if (sizing === 'uniform') {
                opacity = 1;
                brightness = 1;
              }

              if (sizing === 'uniform' || effect === 'gallery') {
                shouldRender = true;
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
                <React.Fragment key={`${item.id}-${index}`}>
                  {(sizing === 'duration' || (sizing === 'uniform' && showUniformRuler)) && (
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
                    collectionDropTargetId === item.id
                      ? "border-emerald-300 shadow-emerald-500/30 ring-2 ring-emerald-400/80"
                      : isActive
                        ? "border-indigo-300 shadow-indigo-500/25 ring-1 ring-indigo-400/50"
                        : "border-zinc-700/70 hover:border-zinc-500 hover:shadow-xl hover:ring-1 hover:ring-indigo-500/40"
                  )}
                  style={{
                    filter: `brightness(${brightness}) ${disabledItemIds.includes(item.id) ? 'grayscale(1)' : ''}`,
                    top: itemCenterY,
                    width: itemWidth,
                    height: itemHeight,
                    opacity: reorderPreview?.mediaId === item.id
                      ? 0.12
                      : disabledItemIds.includes(item.id)
                        ? 0.42
                        : opacity,
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
                        if (collectionItemIds.includes(item.id) && onCollectionOpen) {
                          onCollectionOpen(item.id);
                        } else if (hidePreview) {
                          return;
                        } else if (slideOnClick) {
                          snapToIndex(index);
                        } else {
                          const targetItem = items[index];
                          if (targetItem) {
                            updateFastNavigation(0);
                            setDirectPreviewMediaId(targetItem.id);
                            playbackTimeRef.current = itemStartTimes[index] ?? 0;
                            if (targetItem.id !== selectedMediaId) {
                              skipNextSelectedAlignmentRef.current = true;
                              setTrimOverlayMediaId(null);
                              onCenteredMediaChange(targetItem.id);
                            }
                          }
                        }
                      }
                    }}
                    className="absolute inset-0 overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                  >
                    {collectionItemIds.includes(item.id) ? (
                      <div className="absolute inset-0 bg-zinc-900/40 p-1 select-none pointer-events-none flex items-center justify-center">
                        <div className="h-[96%] aspect-square relative flex items-center justify-center">
                          {/* Stack Circle 4 (bottom-most) */}
                          <div className="absolute inset-0 rounded-full border border-zinc-800 bg-zinc-900/80 translate-x-[6px] -translate-y-[6px] opacity-50 scale-[0.97] shadow-sm z-0" />
                          {/* Stack Circle 3 (middle-bottom) */}
                          <div className="absolute inset-0 rounded-full border border-zinc-800/80 bg-zinc-900/90 translate-x-[4px] -translate-y-[4px] opacity-75 scale-[0.98] shadow-sm z-[3]" />
                          {/* Stack Circle 2 (middle-top) */}
                          <div className="absolute inset-0 rounded-full border border-zinc-700 bg-zinc-800 translate-x-[2px] -translate-y-[2px] opacity-90 scale-[0.99] shadow-md z-[6]" />
                          {/* Top Circle 1 (main cover) */}
                          <div className="relative w-full h-full rounded-full border-2 border-zinc-600/70 shadow-lg overflow-hidden bg-zinc-950 z-10 flex items-center justify-center">
                            {thumbnailItem.type === 'video' ? (
                              <img
                                src={thumbnailItem.posterUrl || VIDEO_PLACEHOLDER}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <img src={thumbnailItem.previewUrl} alt="" className="h-full w-full object-cover" />
                            )}
                          </div>
                        </div>
                        <div className="absolute top-2 left-2 flex items-center justify-center rounded-full bg-black/60 p-1.5 text-indigo-300 border border-zinc-800/30 z-20">
                          <Folder className="h-2.5 w-2.5" />
                        </div>
                      </div>
                    ) : (
                      thumbnailItem.type === 'video' ? (
                        <img
                          src={thumbnailItem.posterUrl || VIDEO_PLACEHOLDER}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <img src={thumbnailItem.previewUrl} alt="" className="h-full w-full object-cover" />
                      )
                    )}
                    <div className={cn(
                      "absolute inset-0 transition-colors",
                      isActive
                        ? "bg-indigo-500/10"
                        : sizing === 'uniform'
                          ? "bg-transparent group-hover/nav:bg-white/5"
                          : "bg-black/30 group-hover/nav:bg-black/10"
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
                  {sizing === 'uniform' && (
                    <UniformItemProgress
                      progress={itemProgress}
                      durationSeconds={itemDuration}
                      isPlaying={isItemProgressPlaying}
                      timelineTimeSeconds={progressTimelineTime}
                    />
                  )}
                  {collectionItemIds.includes(item.id) && onCollectionOpen ? (
                    <div
                      className="absolute right-0 top-0 z-40 h-[52px] w-[52px] pointer-events-none"
                    >
                      <svg
                        width="52"
                        height="52"
                        viewBox="0 0 52 52"
                        aria-hidden="true"
                        className="absolute right-0 top-0 overflow-visible"
                        style={{ filter: 'drop-shadow(-1.5px 1.5px 2px rgba(0,0,0,0.5))' }}
                      >
                        <path
                          d="M 0,0 L 52,0 L 52,52 Z"
                          fill="#18181b"
                          stroke="#27272a"
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="absolute right-2 top-1.5 font-sans text-[11px] font-extrabold tracking-tight text-white">
                        {itemSequences?.[item.id]?.length ?? 0}
                      </span>
                    </div>
                  ) : null}
                  {collectionDropTargetId === item.id && (
                    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-emerald-950/45">
                      <span className="rounded-full border border-emerald-300/60 bg-emerald-950/90 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-100 shadow-xl">
                        Move into collection
                      </span>
                    </div>
                  )}
                  {disabledItemIds.includes(item.id) && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                      <span className="rounded-full border border-amber-400/60 bg-black/80 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-amber-200">Disabled</span>
                    </div>
                  )}
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
          )
        )}
      </div>
    </div>
  );
}
