import React from 'react';
import { 
  type SceneLaunchMediaItem,
  usePreviewWheelSettings,
  type PreviewWheelLayoutData,
  type PreviewWheelPlaybackData,
  type PreviewWheelDragDropData,
  type PreviewWheelActions,
  VIDEO_PLACEHOLDER
} from './SceneLaunchPreviewWheelV3';
import { PreviewWheelCollectionThumbnail } from './PreviewWheelCollectionThumbnail';
import { cn } from '../lib/utils';

export interface PreviewWheelAdjacentPreviewItemProps {
  item: SceneLaunchMediaItem;
  centerOffset: number;
  direction: 'prev' | 'next';
  layout: PreviewWheelLayoutData;
  playback: PreviewWheelPlaybackData;
  dragDrop: PreviewWheelDragDropData;
  actions: PreviewWheelActions;
}

export function PreviewWheelAdjacentPreviewItem({
  item,
  centerOffset,
  direction,
  layout,
  playback,
  dragDrop,
  actions,
}: PreviewWheelAdjacentPreviewItemProps) {
  const {
    collectionItemIds,
    isGaplessGallery,
    collectionMultiCircleEnabled,
    thumbnailSize,
    itemSequenceThumbnails,
  } = usePreviewWheelSettings();

  const {
    itemCenterY,
    uniformItemWidth,
    itemHeight,
    centerX,
  } = layout;

  const {
    scrubSnapshot,
    playheadX,
  } = playback;

  const {
    offset,
  } = dragDrop;

  const {
    getCollectionMediaItems,
    getCollectionDirectCount,
  } = actions;

  const playheadOffsetFromCenter = playheadX - centerX;
  const x = centerOffset + offset + playheadOffsetFromCenter;
  const isCollection = collectionItemIds.includes(item.id);

  const thumbnailItem = scrubSnapshot
    ? itemSequenceThumbnails?.[item.id]?.[scrubSnapshot.media.id] ?? item
    : item;

  return (
    <div
      className={cn(
        "group/nav absolute left-1/2 shrink-0 overflow-hidden border bg-zinc-900 shadow-lg pointer-events-none",
        isGaplessGallery ? 'rounded-none' : 'rounded-md',
        "border-zinc-800"
      )}
      style={{
        top: itemCenterY,
        width: uniformItemWidth,
        height: itemHeight,
        transform: `translate3d(${(x - uniformItemWidth / 2).toFixed(2)}px, ${(-itemHeight / 2).toFixed(2)}px, 0px)`,
        transformOrigin: 'center center',
        zIndex: 55,
        maskImage: direction === 'prev'
          ? 'linear-gradient(to right, transparent, black)'
          : 'linear-gradient(to left, transparent, black)',
        WebkitMaskImage: direction === 'prev'
          ? 'linear-gradient(to right, transparent, black)'
          : 'linear-gradient(to left, transparent, black)',
      }}
    >
      {isCollection ? (
        <PreviewWheelCollectionThumbnail
          collectionId={item.id}
          fallbackItem={thumbnailItem}
          collectionMultiCircleEnabled={collectionMultiCircleEnabled}
          collectionMediaItems={getCollectionMediaItems(item.id)}
          collectionDirectCount={getCollectionDirectCount(item.id)}
          scrubSnapshot={scrubSnapshot}
          itemSequenceThumbnails={itemSequenceThumbnails}
          thumbnailSize={thumbnailSize}
        />
      ) : (
        <>
          {thumbnailItem.type === 'video' ? (
            <img
              src={thumbnailItem.posterUrl || VIDEO_PLACEHOLDER}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <img src={thumbnailItem.previewUrl} alt="" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2.5">
            <div className="truncate text-xs font-black uppercase text-zinc-100">
              {item.name}
            </div>
            <div className="mt-1 flex items-center justify-between gap-1 font-mono text-[9px] uppercase tracking-widest text-zinc-400">
              <span>{item.type}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
