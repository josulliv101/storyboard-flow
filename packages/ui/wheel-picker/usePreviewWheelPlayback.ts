import React from 'react';
import { type SceneLaunchMediaItem, type SceneLaunchPreviewWheelV3Sizing } from './SceneLaunchPreviewWheelV3';
import { type GalleryScrubSnapshot } from './GalleryCanvasPreview';

const clamp = (value: number, min: number, max: number) => (
  Math.max(min, Math.min(max, value))
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

export interface PreviewWheelPlayheadDragState {
  isDragging: boolean;
  pointerId: number;
  startClientX: number;
  startPlayheadX: number;
  startOffset: number;
}

export interface UsePreviewWheelPlaybackProps {
  isPreviewPlaying: boolean;
  loopPreviewPlayback: boolean;
  totalDurationSeconds: number;
  itemDurations: number[];
  itemStartTimes: number[];
  items: SceneLaunchMediaItem[];
  sizing: SceneLaunchPreviewWheelV3Sizing;
  isGallery: boolean;
  timelineOriginOffset: number;
  itemStartPixels: number[];
  itemCenterPositions: number[];
  finalIndex: number;
  selectedMediaId: string;
  onPreviewPlaybackComplete?: () => void;
  onPlaybackMediaChange?: (mediaId: string) => void;
  onPlaybackTimeUpdate?: (mediaId: string, elapsedSeconds: number) => void;
  setOffset: (offset: number) => void;
  resolveItemSnapshot: (item: SceneLaunchMediaItem, elapsedSeconds: number) => { media: SceneLaunchMediaItem; sourceTimeSeconds: number };
  effectiveScrubSnapshot: GalleryScrubSnapshot | null;
  hidePreview: boolean;
  viewportSize: { width: number; height: number };
  playheadX: number;
  renderedPlayheadX: number;
  gridPlayheadRatio: number | null;
  setGridPlayheadRatio: (ratio: number | null) => void;
  stopAnimation: () => void;
  offsetRef: React.MutableRefObject<number>;
  playheadPositionRatio: number;
  setPlayheadPositionRatio: (ratio: number) => void;
  onCenteredMediaChange: (mediaId: string) => void;
  setTrimOverlayMediaId: (mediaId: string | null) => void;
  setDirectPreviewMediaId: (mediaId: string | null) => void;
  playbackTimeRef: React.MutableRefObject<number>;
  wasPreviewPlayingRef: React.MutableRefObject<boolean>;
  playbackSelectedMediaIdRef: React.MutableRefObject<string | null>;
  playbackResolvedMediaKeyRef: React.MutableRefObject<string | null>;
  prominentTimestampRef: React.RefObject<HTMLDivElement | null>;
  playbackSnapshotTime: number | null;
  setPlaybackSnapshotTime: (time: number | null) => void;
}

export function usePreviewWheelPlayback({
  isPreviewPlaying,
  loopPreviewPlayback,
  totalDurationSeconds,
  itemDurations,
  itemStartTimes,
  items,
  sizing,
  isGallery,
  timelineOriginOffset,
  itemStartPixels,
  itemCenterPositions,
  finalIndex,
  selectedMediaId,
  onPreviewPlaybackComplete,
  onPlaybackMediaChange,
  onPlaybackTimeUpdate,
  setOffset,
  resolveItemSnapshot,
  effectiveScrubSnapshot,
  hidePreview,
  viewportSize,
  playheadX,
  renderedPlayheadX,
  gridPlayheadRatio,
  setGridPlayheadRatio,
  stopAnimation,
  offsetRef,
  setPlayheadPositionRatio,
  onCenteredMediaChange,
  setTrimOverlayMediaId,
  setDirectPreviewMediaId,
  playbackTimeRef,
  wasPreviewPlayingRef,
  playbackSelectedMediaIdRef,
  playbackResolvedMediaKeyRef,
  prominentTimestampRef,
  playbackSnapshotTime,
  setPlaybackSnapshotTime,
}: UsePreviewWheelPlaybackProps) {
  const playbackFrameRef = React.useRef<number | null>(null);
  const [isPlayheadDragging, setIsPlayheadDragging] = React.useState(false);

  const playheadDragRef = React.useRef<PreviewWheelPlayheadDragState>({
    isDragging: false,
    pointerId: -1,
    startClientX: 0,
    startPlayheadX: 0,
    startOffset: 0,
  });

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
    setPlayheadPositionRatio(nextRatio);
    if (hidePreview) setGridPlayheadRatio(nextRatio);
    setOffset(originOffset - (boundedPlayheadX - originPlayheadX));
    setDirectPreviewMediaId(null);
  }, [hidePreview, setOffset, viewportSize.width, setPlayheadPositionRatio, setGridPlayheadRatio, setDirectPreviewMediaId]);

  const seekGridPlayheadToXRef = React.useRef<(playheadX: number) => void>(() => undefined);

  // Sync snapshot times when preview is not playing
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
  }, [effectiveScrubSnapshot?.timelineTimeSeconds, isPreviewPlaying, selectedMediaId, totalDurationSeconds, playbackTimeRef, wasPreviewPlayingRef, playbackSelectedMediaIdRef, prominentTimestampRef]);

  // Main playback tick animation loop
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
    playbackResolvedMediaKeyRef,
    playbackSelectedMediaIdRef,
    playbackTimeRef,
    prominentTimestampRef,
  ]);

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
  }, [renderedPlayheadX, stopAnimation, offsetRef]);

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
      playheadX,
      drag.startOffset,
    );
  }, [hidePreview, playheadX, scrubWithPlayhead]);

  const endPlayheadDrag = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = playheadDragRef.current;
    if (!drag.isDragging || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    drag.isDragging = false;
    drag.pointerId = -1;
    setIsPlayheadDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const nextPlayheadX = drag.startPlayheadX + event.clientX - drag.startClientX;
    if (hidePreview) {
      seekGridPlayheadToXRef.current(nextPlayheadX);
      return;
    }
    scrubWithPlayhead(nextPlayheadX, playheadX, drag.startOffset);
    const nextRatio = clamp(nextPlayheadX, 32, Math.max(32, viewportSize.width - 32)) /
      Math.max(1, viewportSize.width);
    localStorage.setItem('scene-launch-playhead-position', String(nextRatio));
  }, [hidePreview, playheadX, scrubWithPlayhead, viewportSize.width]);

  return {
    playbackSnapshotTime,
    isPlayheadDragging,
    playheadDragRef,
    beginPlayheadDrag,
    movePlayheadDrag,
    endPlayheadDrag,
    seekGridPlayheadToXRef,
    scrubWithPlayhead,
  };
}
