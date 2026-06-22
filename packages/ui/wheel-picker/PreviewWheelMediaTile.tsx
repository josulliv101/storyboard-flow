import React from 'react';
import { Folder, Clapperboard } from 'lucide-react';
import { cn } from '../lib/utils';
import { 
  type SceneLaunchMediaItem, 
  VIDEO_PLACEHOLDER,
  usePreviewWheelSettings,
  type PreviewWheelLayoutData,
  type PreviewWheelPlaybackData,
  type PreviewWheelDragDropData,
  type PreviewWheelActions
} from './SceneLaunchPreviewWheelV3';
import { UniformItemProgress } from './UniformItemProgress';
import { PreviewWheelCollectionThumbnail } from './PreviewWheelCollectionThumbnail';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export interface PreviewWheelMediaTileProps {
  item: SceneLaunchMediaItem;
  index: number;
  thumbnailItem: SceneLaunchMediaItem;
  isActive: boolean;
  disabled: boolean;
  isCollection: boolean;
  collectionMultiCircleEnabled: boolean;
  collectionMediaItems: SceneLaunchMediaItem[];
  collectionDirectCount: number;
  itemSequenceThumbnails?: Record<string, Record<string, SceneLaunchMediaItem>>;
  thumbnailSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  reorderPreviewActive: boolean;
  
  // Grouped props
  layout: PreviewWheelLayoutData;
  playback: PreviewWheelPlaybackData;
  dragDrop: PreviewWheelDragDropData;
  actions: PreviewWheelActions;
  
  // Derived/Computed layout properties
  brightness: number;
  opacity: number;
  x: number;
  translateY: number;
  z: number;
  rotateY: number;
  scale: number;
  shouldRender: boolean;
  itemProgress: number;
  isItemProgressPlaying: boolean;
  progressTimelineTime: number;
  onTransitionEnd: (event: React.TransitionEvent<HTMLDivElement>) => void;
}

export function PreviewWheelMediaTile({
  item,
  index,
  thumbnailItem,
  isActive,
  disabled,
  isCollection,
  collectionMultiCircleEnabled,
  collectionMediaItems,
  collectionDirectCount,
  itemSequenceThumbnails,
  thumbnailSize = 'md',
  reorderPreviewActive,
  layout,
  playback,
  dragDrop,
  actions,
  brightness,
  opacity,
  x,
  translateY,
  z,
  rotateY,
  scale,
  shouldRender,
  itemProgress,
  isItemProgressPlaying,
  progressTimelineTime,
  onTransitionEnd,
}: PreviewWheelMediaTileProps) {
  
  // Consume configuration settings from Context
  const {
    sizing,
    effect,
    collectionItemIds,
    hidePreview,
    selectedMediaId,
  } = usePreviewWheelSettings();

  // Destructure layout parameters
  const {
    uniformItemWidth,
    itemGap,
    itemHeight,
    itemCenterY,
    viewportSize,
    itemWidths,
    itemStartPixels,
    timelineOriginOffset,
    isGaplessGallery,
  } = layout;
  const itemWidth = itemWidths[index] ?? uniformItemWidth;

  // Destructure playback parameters
  const {
    scrubSnapshot,
    playheadX,
    playbackTimeRef,
    skipNextSelectedAlignmentRef,
    setTrimOverlayMediaId,
  } = playback;

  // Destructure drag drop parameters
  const {
    isSnapping,
    isWheelMoving,
    collectionDropTargetId,
    clickGuardRef,
    offsetRef,
  } = dragDrop;

  // Destructure actions parameters
  const {
    snapToIndex,
    setDirectPreviewMediaId,
    updateFastNavigation,
    setGridPlayheadRatio,
    onCenteredMediaChange,
    onCollectionOpen,
    renderSelectedItemOverlay,
    onSelectedItemDurationChange,
    beginDurationResize,
    handleDurationResizeKey,
    slideOnClick,
    selectItemsWhilePreviewHidden,
    syncPreviewToPlayhead,
  } = actions;

  const renderCollectionContent = () => (
    <PreviewWheelCollectionThumbnail
      collectionId={item.id}
      fallbackItem={item}
      collectionMultiCircleEnabled={collectionMultiCircleEnabled}
      collectionMediaItems={collectionMediaItems}
      collectionDirectCount={collectionDirectCount}
      scrubSnapshot={scrubSnapshot}
      itemSequenceThumbnails={itemSequenceThumbnails}
      thumbnailSize={thumbnailSize}
    />
  );

  const distance = Math.abs(x / (itemWidth + itemGap));
  const isCentered = distance < 0.08;

  const handleTileClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (clickGuardRef.current) {
      event.preventDefault();
      return;
    }
    if (event.detail === 0) {
      if (collectionItemIds.includes(item.id) && onCollectionOpen) {
        onCollectionOpen(item.id);
      } else if (hidePreview) {
        if (selectItemsWhilePreviewHidden) {
          if (syncPreviewToPlayhead) {
            const itemCenterPixel = (itemStartPixels[index] ?? 0) + itemWidth / 2;
            const itemScreenX = playheadX + (offsetRef.current ?? 0) - timelineOriginOffset + itemCenterPixel;
            setGridPlayheadRatio(clamp(itemScreenX, 8, Math.max(8, viewportSize.width - 8)) / Math.max(1, viewportSize.width));
          }
          updateFastNavigation(0);
          setDirectPreviewMediaId(item.id);
          if (playbackTimeRef.current !== undefined) {
            playbackTimeRef.current = layout.itemStartTimes[index] ?? 0;
          }
          if (item.id !== selectedMediaId) {
            if (skipNextSelectedAlignmentRef.current !== undefined) {
              skipNextSelectedAlignmentRef.current = true;
            }
            setTrimOverlayMediaId(null);
          }
          onCenteredMediaChange(item.id);
        }
        return;
      } else if (slideOnClick) {
        snapToIndex(index);
      } else {
        const targetItem = layout.itemWidths[index] !== undefined ? item : null;
        if (targetItem) {
          updateFastNavigation(0);
          setDirectPreviewMediaId(targetItem.id);
          if (playbackTimeRef.current !== undefined) {
            playbackTimeRef.current = layout.itemStartTimes[index] ?? 0;
          }
          if (targetItem.id !== selectedMediaId) {
            if (skipNextSelectedAlignmentRef.current !== undefined) {
              skipNextSelectedAlignmentRef.current = true;
            }
            setTrimOverlayMediaId(null);
            onCenteredMediaChange(targetItem.id);
          }
        }
      }
    }
  };

  return (
    <div
      className={cn(
        "group/nav absolute left-1/2 shrink-0 overflow-hidden border bg-zinc-900 shadow-lg",
        (thumbnailSize === 'xs' || isGaplessGallery) ? 'rounded-none' : 'rounded-md',
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
        filter: `brightness(${brightness}) ${disabled ? 'grayscale(1)' : ''}`,
        top: itemCenterY,
        width: itemWidth,
        height: itemHeight,
        opacity: reorderPreviewActive
          ? 0.12
          : disabled
            ? 0.42
            : opacity,
        pointerEvents: shouldRender ? 'auto' : 'none',
        transform: `translate3d(${(x - itemWidth / 2).toFixed(2)}px, ${(translateY - itemHeight / 2).toFixed(2)}px, ${z}px) rotateY(${rotateY}deg) scale(${scale})`,
        transformOrigin: 'center center',
        zIndex: Math.round(100 - distance * 10),
      }}
      onTransitionEnd={onTransitionEnd}
    >
      <button
        type="button"
        title={item.name}
        aria-current={isActive ? 'true' : undefined}
        aria-label={`Preview ${item.name}`}
        data-preview-wheel-item-id={item.id}
        data-preview-wheel-index={index}
        onClick={handleTileClick}
        className="absolute inset-0 overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
      >
        {isCollection ? (
          renderCollectionContent()
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
          durationSeconds={item.durationSeconds ?? 3}
          isPlaying={isItemProgressPlaying}
          timelineTimeSeconds={progressTimelineTime}
        />
      )}

      {collectionDropTargetId === item.id && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-emerald-950/45">
          <span className="rounded-full border border-emerald-300/60 bg-emerald-950/90 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-100 shadow-xl">
            Move into collection
          </span>
        </div>
      )}
      {disabled && (
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
          {renderSelectedItemOverlay(item, index)}
        </div>
      )}
      {isActive && sizing === 'duration' && onSelectedItemDurationChange && beginDurationResize && (
        <>
          <button
            type="button"
            aria-label={`Trim start of ${item.name}`}
            title="Trim start"
            onPointerDown={(event) => beginDurationResize(event, item, index, 'start')}
            onKeyDown={(event) => handleDurationResizeKey && handleDurationResizeKey(event, item, 'start')}
            onClick={(event) => event.stopPropagation()}
            className="absolute inset-y-0 left-0 z-30 flex w-4 cursor-ew-resize touch-none items-center justify-center border-y-2 border-l-2 border-white bg-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.35),4px_0_14px_rgba(0,0,0,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <span className="h-9 w-0.5 rounded-full bg-zinc-500/70" />
          </button>
          <button
            type="button"
            aria-label={`Trim end of ${item.name}`}
            title="Trim end"
            onPointerDown={(event) => beginDurationResize(event, item, index, 'end')}
            onKeyDown={(event) => handleDurationResizeKey && handleDurationResizeKey(event, item, 'end')}
            onClick={(event) => event.stopPropagation()}
            className="absolute inset-y-0 right-0 z-30 flex w-4 cursor-ew-resize touch-none items-center justify-center border-y-2 border-r-2 border-white bg-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.35),-4px_0_14px_rgba(0,0,0,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <span className="h-9 w-0.5 rounded-full bg-zinc-500/70" />
          </button>
        </>
      )}
    </div>
  );
}
