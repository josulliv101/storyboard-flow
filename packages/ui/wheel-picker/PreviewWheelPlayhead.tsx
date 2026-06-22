import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatRulerSeconds } from './TimelineRuler';

export interface PreviewWheelPlayheadProps {
  renderedPlayheadX: number;
  itemTop: number;
  itemHeight: number;
  rulerPlayheadTimeSeconds: number;
  isPlayheadDragging: boolean;
  beginPlayheadDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  movePlayheadDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  endPlayheadDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  handlePlayheadKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onNavigateBack?: () => void;
  canNavigateBack?: boolean;
  isFirstGridRow?: boolean;
  parentCollectionName?: string;
  parentCollectionThumbnailUrl?: string;
  shouldShowPlayhead: boolean;
  isSharedPlayheadPlaying: boolean;
  sizing: string;
  isGallery: boolean;
}

export function PreviewWheelPlayhead({
  renderedPlayheadX,
  itemTop,
  itemHeight,
  rulerPlayheadTimeSeconds,
  isPlayheadDragging,
  beginPlayheadDrag,
  movePlayheadDrag,
  endPlayheadDrag,
  handlePlayheadKeyDown,
  onNavigateBack,
  canNavigateBack = false,
  isFirstGridRow = false,
  parentCollectionName,
  parentCollectionThumbnailUrl,
  shouldShowPlayhead,
  isSharedPlayheadPlaying,
  sizing,
  isGallery,
}: PreviewWheelPlayheadProps) {
  if (!shouldShowPlayhead || (sizing !== 'duration' && !isGallery)) {
    return null;
  }

  if (isSharedPlayheadPlaying) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 z-[190] w-0"
        style={{ left: renderedPlayheadX }}
      >
        <div className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.95)]" />
      </div>
    );
  }

  return (
    <>
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
      <div className="sr-only" aria-live="polite">
        Playhead at {formatRulerSeconds(rulerPlayheadTimeSeconds)}
      </div>
    </>
  );
}
