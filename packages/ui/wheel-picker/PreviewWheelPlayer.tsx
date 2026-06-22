import React from 'react';
import { 
  ChevronsLeft, 
  ChevronLeft, 
  Play, 
  Pause, 
  ChevronRight, 
  ChevronsRight, 
  Repeat, 
  AlignCenter 
} from 'lucide-react';
import { cn } from '../lib/utils';
import { GalleryCanvasPreview, type GalleryScrubSnapshot } from './GalleryCanvasPreview';
import { type SceneLaunchMediaItem } from './SceneLaunchPreviewWheelV3';

const formatPlaybackTime = (seconds: number) => {
  const totalTenths = Math.round(Math.max(0, seconds) * 10);
  const minutes = Math.floor(totalTenths / 600);
  const remainingSeconds = (totalTenths % 600) / 10;
  return `${String(minutes).padStart(2, '0')}:${remainingSeconds.toFixed(1).padStart(4, '0')}`;
};

export const formatPlaybackTimestamp = (currentSeconds: number, totalSeconds: number) => (
  `${formatPlaybackTime(currentSeconds)} / ${formatPlaybackTime(totalSeconds)}`
);

export interface PreviewWheelPlayerProps {
  isGallery: boolean;
  hidePreview: boolean;
  effectiveScrubSnapshot: GalleryScrubSnapshot | null;
  gridView: boolean;
  isPreviewPlaying: boolean;
  loopPreviewPlayback: boolean;
  playheadPositionRatio: number;
  centeredIndex: number;
  itemsCount: number;
  selectedMediaId: string;
  showSelectedTrimOverlay: boolean;
  trimOverlayMediaId: string | null;
  galleryPreviewHeight: number;
  galleryPreviewWidth: number;
  totalDurationSeconds: number;
  
  // Callbacks
  snapToIndex: (index: number) => void;
  onTogglePlayback?: () => void;
  onToggleLoop?: () => void;
  centerPlayhead: () => void;
  
  // Custom renders and refs
  renderGalleryTrimOverlay?: (item: SceneLaunchMediaItem) => React.ReactNode;
  trimOverlayRef?: React.RefObject<HTMLDivElement | null>;
  prominentTimestampRef?: React.RefObject<HTMLDivElement | null>;
  galleryPreviewRef?: React.RefObject<HTMLDivElement | null>;
}

export function PreviewWheelPlayer({
  isGallery,
  hidePreview,
  effectiveScrubSnapshot,
  gridView,
  isPreviewPlaying,
  loopPreviewPlayback,
  playheadPositionRatio,
  centeredIndex,
  itemsCount,
  selectedMediaId,
  showSelectedTrimOverlay,
  trimOverlayMediaId,
  galleryPreviewHeight,
  galleryPreviewWidth,
  totalDurationSeconds,
  snapToIndex,
  onTogglePlayback,
  onToggleLoop,
  centerPlayhead,
  renderGalleryTrimOverlay,
  trimOverlayRef,
  prominentTimestampRef,
  galleryPreviewRef,
}: PreviewWheelPlayerProps) {
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
            disabled={centeredIndex === itemsCount - 1}
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
            onClick={() => snapToIndex(itemsCount - 1)}
            disabled={centeredIndex === itemsCount - 1}
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
                showSelectedTrimOverlay || trimOverlayMediaId === selectedMediaId
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
}
